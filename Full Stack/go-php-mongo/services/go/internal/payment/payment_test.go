package payment

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"shop/internal/platform/events"
	"shop/internal/platform/httpx"
	"shop/internal/platform/id"
)

type fakeOrders map[string]*OrderInfo

func (f fakeOrders) Order(_ context.Context, orderID string) (*OrderInfo, error) {
	o, ok := f[orderID]
	if !ok {
		return nil, ErrNotFound
	}
	c := *o
	return &c, nil
}

const guestKey = "guest-secret"

func newSvc(p Provider) (*Service, *MemStore, fakeOrders) {
	orders := fakeOrders{
		"o1": {ID: "o1", Number: "NL-000001", Status: "pending_payment", TotalCents: 6777, Currency: "CAD", UserID: "u1"},
		"o2": {ID: "o2", Number: "NL-000002", Status: "pending_payment", TotalCents: 1000, Currency: "CAD", GuestKeyHash: id.Hash(guestKey)},
		"o3": {ID: "o3", Number: "NL-000003", Status: "paid", TotalCents: 1000, Currency: "CAD", UserID: "u1"},
	}
	st := NewMemStore()
	return &Service{Store: st, Provider: p, Orders: orders, WebhookSecret: "whsec_test", Now: time.Now}, st, orders
}

var ana = &httpx.Principal{UserID: "u1", Roles: []string{"customer"}}

func TestIntentOwnershipAndReuse(t *testing.T) {
	svc, _, _ := newSvc(Mock{})
	ctx := context.Background()
	a, err := svc.CreateIntent(ctx, ana, "o1", "")
	if err != nil || a.AmountCents != 6777 || a.Provider != "mock" {
		t.Fatalf("%+v %v", a, err)
	}
	b, _ := svc.CreateIntent(ctx, ana, "o1", "")
	if a.PaymentID != b.PaymentID {
		t.Fatal("reloading the payment page created a second payment")
	}
	if _, err := svc.CreateIntent(ctx, &httpx.Principal{UserID: "u2"}, "o1", ""); err == nil {
		t.Fatal("another user could pay for (and so see) someone's order")
	}
	if _, err := svc.CreateIntent(ctx, nil, "o2", "wrong"); err == nil {
		t.Fatal("wrong guest key accepted")
	}
	if _, err := svc.CreateIntent(ctx, nil, "o2", guestKey); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateIntent(ctx, ana, "o3", ""); err == nil {
		t.Fatal("paid order accepted a new payment")
	}
}

func TestMockConfirmEmitsOnce(t *testing.T) {
	svc, st, _ := newSvc(Mock{})
	ctx := context.Background()
	in, _ := svc.CreateIntent(ctx, ana, "o1", "")
	if p, _ := svc.MockConfirm(ctx, in.PaymentID, false); p.Status != StatusFailed || p.FailureReason == "" {
		t.Fatalf("decline: %+v", p)
	}
	// A declined card can be retried on the same payment.
	p, err := svc.MockConfirm(ctx, in.PaymentID, true)
	if err != nil || p.Status != StatusSucceeded {
		t.Fatalf("%+v %v", p, err)
	}
	svc.MockConfirm(ctx, in.PaymentID, true)
	if n := len(st.Outbox.OfType(events.PaymentSucceeded)); n != 1 {
		t.Fatalf("payment.succeeded emitted %d times", n)
	}
}

func TestStripeSignature(t *testing.T) {
	body := []byte(`{"id":"evt_1"}`)
	now := time.Now()
	h := SignStripePayload(body, "whsec_test", now)
	if err := VerifyStripeSignature(body, h, "whsec_test", now, 5*time.Minute); err != nil {
		t.Fatal(err)
	}
	bad := map[string]string{
		"tampered body": "",
		"wrong secret":  SignStripePayload(body, "whsec_other", now),
		"too old":       SignStripePayload(body, "whsec_test", now.Add(-10*time.Minute)),
		"no v1":         "t=123",
	}
	for name, hdr := range bad {
		payload := body
		if name == "tampered body" {
			hdr, payload = h, []byte(`{"id":"evt_2"}`)
		}
		if err := VerifyStripeSignature(payload, hdr, "whsec_test", now, 5*time.Minute); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// fakeStripe records requests and answers like the real API's two endpoints.
type fakeStripe struct {
	mu   sync.Mutex
	reqs []*http.Request
	idem []string
}

func (f *fakeStripe) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.ParseForm()
	f.mu.Lock()
	f.reqs = append(f.reqs, r)
	f.idem = append(f.idem, r.Header.Get("Idempotency-Key"))
	f.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer sk_test_x" {
		w.WriteHeader(401)
		w.Write([]byte(`{"error":{"message":"bad key"}}`))
		return
	}
	switch r.URL.Path {
	case "/v1/payment_intents":
		json.NewEncoder(w).Encode(map[string]string{"id": "pi_123", "client_secret": "pi_123_secret_abc"})
	case "/v1/refunds":
		json.NewEncoder(w).Encode(map[string]string{"id": "re_" + r.Form.Get("amount")})
	}
}

func TestStripeFlowWithWebhookAndRefunds(t *testing.T) {
	fake := &fakeStripe{}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	svc, st, _ := newSvc(&Stripe{SecretKey: "sk_test_x", Publishable: "pk_test_x", BaseURL: srv.URL, HTTP: srv.Client()})
	ctx := context.Background()

	in, err := svc.CreateIntent(ctx, ana, "o1", "")
	if err != nil || in.ClientSecret != "pi_123_secret_abc" || in.PublishableKey != "pk_test_x" {
		t.Fatalf("%+v %v", in, err)
	}
	form := fake.reqs[0].Form
	if form.Get("amount") != "6777" || form.Get("currency") != "cad" || form.Get("metadata[order_id]") != "o1" {
		t.Fatalf("intent form: %v", form)
	}

	payload := []byte(`{"id":"evt_1","type":"payment_intent.succeeded","data":{"object":{"id":"pi_123"}}}`)
	sig := SignStripePayload(payload, "whsec_test", time.Now())
	if err := svc.StripeWebhook(ctx, payload, sig); err != nil {
		t.Fatal(err)
	}
	if err := svc.StripeWebhook(ctx, payload, sig); err != nil { // Stripe retries
		t.Fatal(err)
	}
	if err := svc.StripeWebhook(ctx, payload, "t=1,v1=00"); err == nil {
		t.Fatal("unsigned webhook accepted")
	}
	if n := len(st.Outbox.OfType(events.PaymentSucceeded)); n != 1 {
		t.Fatalf("succeeded emitted %d times", n)
	}

	p, err := svc.Refund(ctx, "o1", 777)
	if err != nil || p.Status != StatusPartiallyRefunded || p.RefundedCents != 777 {
		t.Fatalf("partial: %+v %v", p, err)
	}
	if _, err := svc.Refund(ctx, "o1", 999_999); err == nil {
		t.Fatal("refunded more than was paid")
	}
	p, err = svc.Refund(ctx, "o1", 0)
	if err != nil || p.Status != StatusRefunded || p.RefundedCents != 6777 || len(p.Refunds) != 2 {
		t.Fatalf("rest: %+v %v", p, err)
	}
	refunds := st.Outbox.OfType(events.RefundIssued)
	var last struct {
		AmountCents int64
		Full        bool
	}
	json.Unmarshal(refunds[1].Data, &last)
	if last.AmountCents != 6000 || !last.Full {
		t.Fatalf("refund event %+v", last)
	}
	if fake.idem[len(fake.idem)-1] == fake.idem[len(fake.idem)-2] {
		t.Fatal("two different refunds shared an idempotency key")
	}
}

func TestAutoRefundOnCancel(t *testing.T) {
	svc, st, _ := newSvc(Mock{})
	ctx := context.Background()
	in, _ := svc.CreateIntent(ctx, ana, "o1", "")
	svc.MockConfirm(ctx, in.PaymentID, true)
	ev := events.Must(events.OrderCancelled, map[string]any{"orderId": "o1", "refund": true})
	if err := svc.OnOrderCancelled(ctx, ev); err != nil {
		t.Fatal(err)
	}
	svc.OnOrderCancelled(ctx, ev) // redelivered: already refunded, nothing more
	if n := len(st.Outbox.OfType(events.RefundIssued)); n != 1 {
		t.Fatalf("refunds: %d", n)
	}
}

func TestHTTPRefundNeedsAdmin(t *testing.T) {
	svc, _, _ := newSvc(Mock{})
	mux := http.NewServeMux()
	(&Handlers{Svc: svc}).Routes(mux)
	call := func(p *httpx.Principal) int {
		req := httptest.NewRequest("POST", "/api/v1/admin/payments/refund", strings.NewReader(`{"orderId":"o1"}`))
		if p != nil {
			req = req.WithContext(httpx.WithPrincipal(req.Context(), p))
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec.Code
	}
	if c := call(nil); c != 401 {
		t.Fatalf("anonymous: %d", c)
	}
	if c := call(&httpx.Principal{UserID: "s", Roles: []string{"staff"}}); c != 403 {
		t.Fatalf("staff: %d", c)
	}
	var he *httpx.Error
	_, err := svc.Refund(context.Background(), "o1", 0)
	if !errors.As(err, &he) || he.Status != 404 {
		t.Fatalf("refund with no payment: %v", err)
	}
}
