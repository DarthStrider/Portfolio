package order

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"shop/internal/platform/events"
	"shop/internal/platform/httpx"
	"shop/internal/platform/mail"
)

// ---------- pricing ----------

func TestQuoteOntarioWithShipping(t *testing.T) {
	lines := []OrderLine{{LineTotalCents: 2499 * 2}}
	got, err := Quote(lines, nil, "ON", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	// goods 49.98 + shipping 9.99 = 59.97; 13% = 7.7961 -> 7.80
	want := Totals{SubtotalCents: 4998, ShippingCents: 999, TaxCents: 780, TaxLabel: "HST 13%", TotalCents: 4998 + 999 + 780}
	if got != want {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestQuoteFreeShippingIsJudgedAfterDiscount(t *testing.T) {
	lines := []OrderLine{{LineTotalCents: 8000}}
	c := &Coupon{Code: "TEN", PercentOff: 10, Active: true}
	got, _ := Quote(lines, c, "AB", time.Now())
	// 80.00 - 8.00 = 72.00, under the 75.00 threshold, so shipping is charged.
	if got.DiscountCents != 800 || got.ShippingCents != FlatShippingCents {
		t.Fatalf("%+v", got)
	}
	got, _ = Quote(lines, nil, "AB", time.Now())
	if got.ShippingCents != 0 {
		t.Fatalf("80.00 should ship free: %+v", got)
	}
}

func TestQuoteQuebecExactRate(t *testing.T) {
	got, _ := Quote([]OrderLine{{LineTotalCents: 10000}}, nil, "QC", time.Now())
	// 100.00 * 14.975% = 14.975 -> rounds half up to 14.98
	if got.TaxCents != 1498 {
		t.Fatalf("tax = %d", got.TaxCents)
	}
}

func TestCouponRules(t *testing.T) {
	now := time.Now()
	past := now.Add(-time.Hour)
	cases := []struct {
		name string
		c    Coupon
		sub  int64
		want int64
		err  bool
	}{
		{"percent", Coupon{PercentOff: 15, Active: true}, 10000, 1500, false},
		{"fixed capped at subtotal", Coupon{AmountOffCents: 5000, Active: true}, 3000, 3000, false},
		{"inactive", Coupon{PercentOff: 10}, 10000, 0, true},
		{"expired", Coupon{PercentOff: 10, Active: true, ExpiresAt: &past}, 10000, 0, true},
		{"used up", Coupon{PercentOff: 10, Active: true, MaxUses: 1, Uses: 1}, 10000, 0, true},
		{"minimum", Coupon{PercentOff: 10, Active: true, MinSubtotalCents: 5000}, 4999, 0, true},
	}
	for _, c := range cases {
		got, err := c.c.Discount(c.sub, now)
		if (err != nil) != c.err || got != c.want {
			t.Errorf("%s: got %d, %v", c.name, got, err)
		}
	}
}

func TestStatusMachine(t *testing.T) {
	if !CanMove(StatusPaid, StatusShipped) || CanMove(StatusDelivered, StatusPaid) || CanMove(StatusCancelled, StatusPaid) {
		t.Fatal("transition table wrong")
	}
	for _, s := range NextStatuses(StatusPaid) {
		if s == StatusPaid || s == StatusRefunded {
			t.Fatalf("staff can set %s by hand", s)
		}
	}
}

// ---------- service flows ----------

type fixture struct {
	svc   *Service
	store *MemStore
	now   time.Time
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{store: NewMemStore(), now: time.Date(2026, 11, 8, 15, 0, 0, 0, time.UTC)}
	f.svc = &Service{Store: f.store, Now: func() time.Time { return f.now }}
	// Products arrive the way they do in production: as a product.updated event.
	f.productEvent(t, map[string]any{
		"productId": "p1", "slug": "tee", "name": "Classic Tee", "status": "active", "image": "/img/tee.svg",
		"variants": []map[string]any{
			{"sku": "TEE-M", "options": map[string]string{"size": "M"}, "priceCents": 2500, "initialStock": 3},
			{"sku": "TEE-L", "options": map[string]string{"size": "L"}, "priceCents": 2500, "initialStock": 1},
		},
	})
	return f
}

func (f *fixture) productEvent(t *testing.T, data map[string]any) {
	t.Helper()
	if err := f.svc.OnProductUpdated(context.Background(), events.Must(events.ProductUpdated, data)); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) stock(sku string) Stock {
	st, _ := f.store.Stock(context.Background(), []string{sku})
	return st[sku]
}

var onAddress = Address{Name: "Ana Diaz", Line1: "1 King St W", City: "Toronto", Province: "ON", PostalCode: "M5H 1A1"}

func (f *fixture) checkout(t *testing.T, owner string, user *httpx.Principal) (*Order, string) {
	t.Helper()
	o, key, err := f.svc.Checkout(context.Background(), owner, user, CheckoutInput{Email: "guest@example.com", Address: onAddress})
	if err != nil {
		t.Fatalf("checkout: %v", err)
	}
	return o, key
}

func (f *fixture) pay(t *testing.T, o *Order) {
	t.Helper()
	ev := events.Must(events.PaymentSucceeded, map[string]any{"paymentId": "pay_1", "orderId": o.ID, "amountCents": o.Totals.TotalCents})
	if err := f.svc.OnPaymentSucceeded(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
}

func TestReplayedProductEventDoesNotResetStock(t *testing.T) {
	f := newFixture(t)
	if _, err := f.svc.AdjustStock(context.Background(), "TEE-M", 7); err != nil {
		t.Fatal(err)
	}
	f.productEvent(t, map[string]any{"productId": "p1", "slug": "tee", "name": "Classic Tee v2", "status": "active",
		"variants": []map[string]any{{"sku": "TEE-M", "priceCents": 2700, "initialStock": 3}}})
	if f.stock("TEE-M").OnHand != 10 {
		t.Fatalf("stock reset by replayed event: %+v", f.stock("TEE-M"))
	}
	p, _ := f.store.Products(context.Background(), []string{"TEE-M", "TEE-L"})
	if p["TEE-M"].PriceCents != 2700 || p["TEE-M"].Name != "Classic Tee v2" {
		t.Fatalf("product copy not updated: %+v", p["TEE-M"])
	}
	if p["TEE-L"].Active {
		t.Fatal("variant dropped from the product should be inactive")
	}
}

func TestCartLimitsToAvailableStock(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	if _, err := f.svc.AddToCart(ctx, "g:a", "TEE-L", 2); err == nil {
		t.Fatal("added 2 of a SKU with 1 in stock")
	}
	v, err := f.svc.AddToCart(ctx, "g:a", "TEE-M", 2)
	if err != nil || v.SubtotalCents != 5000 || v.ItemCount != 2 {
		t.Fatalf("%+v %v", v, err)
	}
	if _, err := f.svc.AddToCart(ctx, "g:a", "NOPE", 1); err == nil {
		t.Fatal("added unknown SKU")
	}
}

func TestCheckoutReservesAndPaymentCommits(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.svc.AddToCart(ctx, "g:a", "TEE-M", 2)
	o, key := f.checkout(t, "g:a", nil)

	if o.Status != StatusPendingPayment || o.Number == "" || key == "" {
		t.Fatalf("order %+v", o)
	}
	if st := f.stock("TEE-M"); st.OnHand != 3 || st.Reserved != 2 {
		t.Fatalf("after checkout: %+v", st)
	}
	// 50.00 + 9.99 shipping, 13% HST
	if o.Totals.TotalCents != 5000+999+780 {
		t.Fatalf("totals %+v", o.Totals)
	}

	f.pay(t, o)
	f.pay(t, o) // the broker delivered it twice: nothing should change the second time

	got, _ := f.store.Order(ctx, o.ID)
	if got.Status != StatusPaid || got.PaymentID != "pay_1" {
		t.Fatalf("after payment: %+v", got)
	}
	if st := f.stock("TEE-M"); st.OnHand != 1 || st.Reserved != 0 {
		t.Fatalf("stock after payment: %+v", st)
	}
	if c, _ := f.store.Cart(ctx, "g:a"); len(c.Lines) != 0 {
		t.Fatal("cart not emptied after payment")
	}
	if n := len(f.store.Outbox.OfType(events.OrderPlaced)); n != 1 {
		t.Fatalf("order.placed emitted %d times", n)
	}
}

func TestLastUnitCanOnlyBeBoughtOnce(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.svc.AddToCart(ctx, "g:a", "TEE-L", 1)
	f.svc.AddToCart(ctx, "g:b", "TEE-L", 1) // both carts hold the last unit
	f.checkout(t, "g:a", nil)
	_, _, err := f.svc.Checkout(ctx, "g:b", nil, CheckoutInput{Email: "b@example.com", Address: onAddress})
	var he *httpx.Error
	if !errors.As(err, &he) || he.Status != 409 {
		t.Fatalf("second buyer got %v", err)
	}
	if st := f.stock("TEE-L"); st.Reserved != 1 {
		t.Fatalf("over-reserved: %+v", st)
	}
}

func TestCheckoutAgainReleasesEarlierUnpaidOrder(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.svc.AddToCart(ctx, "g:a", "TEE-M", 1)
	first, _ := f.checkout(t, "g:a", nil)
	second, _ := f.checkout(t, "g:a", nil)
	if st := f.stock("TEE-M"); st.Reserved != 1 {
		t.Fatalf("double reservation: %+v", st)
	}
	o, _ := f.store.Order(ctx, first.ID)
	if o.Status != StatusCancelled || second.Status != StatusPendingPayment {
		t.Fatalf("first=%s second=%s", o.Status, second.Status)
	}
}

func TestExpiryReleasesStock(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.svc.AddToCart(ctx, "g:a", "TEE-M", 2)
	o, _ := f.checkout(t, "g:a", nil)

	f.now = f.now.Add(ReservationTTL + time.Second)
	n, err := f.svc.ExpireStale(ctx)
	if err != nil || n != 1 {
		t.Fatalf("expired %d, %v", n, err)
	}
	if st := f.stock("TEE-M"); st.Reserved != 0 || st.OnHand != 3 {
		t.Fatalf("stock not released: %+v", st)
	}
	// The payment lands after expiry: the order stays cancelled and a refund is requested.
	f.pay(t, o)
	got, _ := f.store.Order(ctx, o.ID)
	cancels := f.store.Outbox.OfType(events.OrderCancelled)
	var last struct{ Refund bool }
	json.Unmarshal(cancels[len(cancels)-1].Data, &last)
	if got.Status != StatusCancelled || !last.Refund {
		t.Fatalf("late payment handling: status=%s refund=%v", got.Status, last.Refund)
	}
}

func TestStaffFlowAndCancelPaidRestocks(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.svc.AddToCart(ctx, "g:a", "TEE-M", 2)
	o, _ := f.checkout(t, "g:a", nil)
	f.pay(t, o)

	if _, err := f.svc.SetStatus(ctx, o.ID, StatusDelivered, ""); err == nil {
		t.Fatal("jumped from paid to delivered")
	}
	if _, err := f.svc.SetStatus(ctx, o.ID, StatusShipped, ""); err == nil {
		t.Fatal("shipped without tracking")
	}
	if _, err := f.svc.SetStatus(ctx, o.ID, StatusProcessing, ""); err != nil {
		t.Fatal(err)
	}
	a, err := f.svc.SetStatus(ctx, o.ID, StatusCancelled, "")
	if err != nil || a.Status != StatusCancelled {
		t.Fatalf("%v %v", a, err)
	}
	if st := f.stock("TEE-M"); st.OnHand != 3 {
		t.Fatalf("cancelled paid order didn't restock: %+v", st)
	}
	cancels := f.store.Outbox.OfType(events.OrderCancelled)
	var d struct{ Refund bool }
	json.Unmarshal(cancels[len(cancels)-1].Data, &d)
	if !d.Refund {
		t.Fatal("cancelling a paid order must request a refund")
	}
}

func TestRefundEvents(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.svc.AddToCart(ctx, "g:a", "TEE-M", 1)
	o, _ := f.checkout(t, "g:a", nil)
	f.pay(t, o)
	partial := events.Must(events.RefundIssued, map[string]any{"orderId": o.ID, "amountCents": 500, "full": false})
	f.svc.OnRefundIssued(ctx, partial)
	got, _ := f.store.Order(ctx, o.ID)
	if got.Status != StatusPaid || got.RefundedCents != 500 {
		t.Fatalf("partial refund: %+v", got)
	}
	full := events.Must(events.RefundIssued, map[string]any{"orderId": o.ID, "amountCents": o.Totals.TotalCents - 500, "full": true})
	f.svc.OnRefundIssued(ctx, full)
	got, _ = f.store.Order(ctx, o.ID)
	if got.Status != StatusRefunded || got.RefundedCents != o.Totals.TotalCents {
		t.Fatalf("full refund: %+v", got)
	}
}

func TestCouponAtCheckout(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.svc.SaveCoupon(ctx, Coupon{Code: "welcome10", PercentOff: 10, Active: true, MaxUses: 1})
	f.svc.AddToCart(ctx, "g:a", "TEE-M", 2)
	o, _, err := f.svc.Checkout(ctx, "g:a", nil, CheckoutInput{Email: "a@example.com", Address: onAddress, CouponCode: "Welcome10"})
	if err != nil || o.Totals.DiscountCents != 500 || o.CouponCode != "WELCOME10" {
		t.Fatalf("%+v %v", o, err)
	}
	f.svc.AddToCart(ctx, "g:b", "TEE-M", 1)
	_, _, err = f.svc.Checkout(ctx, "g:b", nil, CheckoutInput{Email: "b@example.com", Address: onAddress, CouponCode: "WELCOME10"})
	var he *httpx.Error
	if !errors.As(err, &he) || he.Fields["couponCode"] == "" {
		t.Fatalf("used-up coupon accepted: %v", err)
	}
}

func TestOrderAccess(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	ana := &httpx.Principal{UserID: "u1", Email: "ana@example.com", Roles: []string{"customer"}}
	f.svc.AddToCart(ctx, "u:u1", "TEE-M", 1)
	mine, _ := f.checkout(t, "u:u1", ana)
	if mine.Email != "ana@example.com" {
		t.Fatal("signed-in checkout should use the account email")
	}
	f.svc.AddToCart(ctx, "g:x", "TEE-M", 1)
	guestOrder, key := f.checkout(t, "g:x", nil)

	bob := &httpx.Principal{UserID: "u2", Roles: []string{"customer"}}
	staff := &httpx.Principal{UserID: "s1", Roles: []string{"staff"}}
	if _, err := f.svc.OrderFor(ctx, mine.ID, ana, ""); err != nil {
		t.Fatal("owner denied")
	}
	if _, err := f.svc.OrderFor(ctx, mine.ID, bob, ""); err == nil {
		t.Fatal("another customer read the order")
	}
	if _, err := f.svc.OrderFor(ctx, mine.ID, staff, ""); err != nil {
		t.Fatal("staff denied")
	}
	if _, err := f.svc.OrderFor(ctx, guestOrder.ID, nil, key); err != nil {
		t.Fatal("guest key rejected")
	}
	if _, err := f.svc.OrderFor(ctx, guestOrder.ID, nil, "wrong"); err == nil {
		t.Fatal("wrong guest key accepted")
	}
}

func TestMergeGuestCartAtSignIn(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.svc.AddToCart(ctx, "u:u1", "TEE-M", 1)
	f.svc.AddToCart(ctx, "g:a", "TEE-M", 1)
	f.svc.AddToCart(ctx, "g:a", "TEE-L", 1)
	v, err := f.svc.MergeCarts(ctx, "g:a", "u:u1")
	if err != nil || len(v.Lines) != 2 || v.ItemCount != 3 {
		t.Fatalf("%+v %v", v, err)
	}
	if g, _ := f.store.Cart(ctx, "g:a"); len(g.Lines) != 0 {
		t.Fatal("guest cart left behind")
	}
}

func TestStats(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.svc.AddToCart(ctx, "g:a", "TEE-M", 2)
	o, _ := f.checkout(t, "g:a", nil)
	f.pay(t, o)
	st, err := f.svc.Stats(ctx, 14)
	if err != nil || st.Orders != 1 || st.RevenueCents != o.Totals.TotalCents || st.TopProducts[0].SKU != "TEE-M" {
		t.Fatalf("%+v %v", st, err)
	}
}

func TestConfirmationEmail(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	rec := &mail.Recorder{}
	n := &Notifier{Store: f.store, Mail: rec, AppURL: "http://shop.test"}
	f.svc.AddToCart(ctx, "g:a", "TEE-M", 1)
	o, _ := f.checkout(t, "g:a", nil)
	f.pay(t, o)
	if err := n.OnPlaced(ctx, f.store.Outbox.OfType(events.OrderPlaced)[0]); err != nil {
		t.Fatal(err)
	}
	m, _ := rec.Last()
	if m.To != "guest@example.com" || !strings.Contains(m.Body, "1 x Classic Tee (size: M)") || !strings.Contains(m.Body, "HST 13%") {
		t.Fatalf("email:\n%s", m.Body)
	}
}

// One HTTP-level test: the guest cookie flow through the real handlers.
func TestHTTPGuestCartCookie(t *testing.T) {
	f := newFixture(t)
	mux := http.NewServeMux()
	(&Handlers{Svc: f.svc, InternalSecret: "s3cret"}).Routes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	res, err := http.Post(srv.URL+"/api/v1/cart/items", "application/json", strings.NewReader(`{"sku":"TEE-M","qty":1}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	var cookie *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == guestCookie {
			cookie = c
		}
	}
	if res.StatusCode != 200 || cookie == nil || !cookie.HttpOnly {
		t.Fatalf("status %d cookie %+v", res.StatusCode, cookie)
	}
	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/cart", nil)
	req.AddCookie(cookie)
	res, _ = http.DefaultClient.Do(req)
	var v CartView
	json.NewDecoder(res.Body).Decode(&v)
	res.Body.Close()
	if v.ItemCount != 1 {
		t.Fatalf("cart not found by cookie: %+v", v)
	}

	// /internal needs the shared secret.
	res, _ = http.Get(srv.URL + "/internal/orders/x")
	if res.StatusCode != 403 {
		t.Fatalf("internal route open: %d", res.StatusCode)
	}
}
