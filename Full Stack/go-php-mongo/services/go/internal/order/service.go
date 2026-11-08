package order

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"slices"
	"strings"
	"time"

	"shop/internal/platform/events"
	"shop/internal/platform/httpx"
	"shop/internal/platform/id"
)

const (
	MaxQtyPerLine  = 20
	MaxCartLines   = 50
	ReservationTTL = 15 * time.Minute
	CartTTL        = 30 * 24 * time.Hour
)

// Service holds order-service's rules.
type Service struct {
	Store Store
	Now   func() time.Time
}

// ---------- Cart ----------

// CartLineView is a cart line joined with live product and stock data.
type CartLineView struct {
	SKU            string            `json:"sku"`
	Qty            int               `json:"qty"`
	ProductID      string            `json:"productId"`
	Slug           string            `json:"slug"`
	Name           string            `json:"name"`
	Options        map[string]string `json:"options"`
	Image          string            `json:"image"`
	UnitPriceCents int64             `json:"unitPriceCents"`
	LineTotalCents int64             `json:"lineTotalCents"`
	Available      int               `json:"available"`
	Problem        string            `json:"problem,omitempty"`
}

type CartView struct {
	Lines         []CartLineView `json:"lines"`
	ItemCount     int            `json:"itemCount"`
	SubtotalCents int64          `json:"subtotalCents"`
	CanCheckout   bool           `json:"canCheckout"`
}

// GetCart prices the cart from the current catalog copy. Problems (a product
// discontinued, stock sold out since it was added) are flagged per line rather than
// silently dropped, so the shopper sees what changed.
func (s *Service) GetCart(ctx context.Context, owner string) (*CartView, error) {
	c, err := s.Store.Cart(ctx, owner)
	if err != nil {
		return nil, err
	}
	skus := skusOf(c.Lines)
	products, err := s.Store.Products(ctx, skus)
	if err != nil {
		return nil, err
	}
	stock, err := s.Store.Stock(ctx, skus)
	if err != nil {
		return nil, err
	}
	v := &CartView{Lines: []CartLineView{}, CanCheckout: len(c.Lines) > 0}
	for _, l := range c.Lines {
		p, ok := products[l.SKU]
		lv := CartLineView{SKU: l.SKU, Qty: l.Qty, Available: stock[l.SKU].Available()}
		if ok {
			lv.ProductID, lv.Slug, lv.Name, lv.Options, lv.Image = p.ProductID, p.Slug, p.Name, p.Options, p.Image
			lv.UnitPriceCents = p.PriceCents
			lv.LineTotalCents = p.PriceCents * int64(l.Qty)
		}
		switch {
		case !ok || !p.Active:
			lv.Problem = "no longer available"
		case lv.Available <= 0:
			lv.Problem = "sold out"
		case lv.Available < l.Qty:
			lv.Problem = fmt.Sprintf("only %d left", lv.Available)
		}
		if lv.Problem != "" {
			v.CanCheckout = false
		} else {
			v.SubtotalCents += lv.LineTotalCents
		}
		v.ItemCount += l.Qty
		v.Lines = append(v.Lines, lv)
	}
	return v, nil
}

// AddToCart adds qty of a SKU (merging with an existing line).
func (s *Service) AddToCart(ctx context.Context, owner, sku string, qty int) (*CartView, error) {
	if qty < 1 || qty > MaxQtyPerLine {
		return nil, httpx.Invalid(map[string]string{"qty": fmt.Sprintf("choose 1 to %d", MaxQtyPerLine)})
	}
	c, err := s.Store.Cart(ctx, owner)
	if err != nil {
		return nil, err
	}
	current := 0
	if i := lineIndex(c.Lines, sku); i >= 0 {
		current = c.Lines[i].Qty
	}
	return s.setQty(ctx, c, sku, current+qty)
}

// SetCartQty sets a line's quantity; 0 removes it.
func (s *Service) SetCartQty(ctx context.Context, owner, sku string, qty int) (*CartView, error) {
	if qty < 0 || qty > MaxQtyPerLine {
		return nil, httpx.Invalid(map[string]string{"qty": fmt.Sprintf("choose 0 to %d", MaxQtyPerLine)})
	}
	c, err := s.Store.Cart(ctx, owner)
	if err != nil {
		return nil, err
	}
	return s.setQty(ctx, c, sku, qty)
}

func (s *Service) setQty(ctx context.Context, c Cart, sku string, qty int) (*CartView, error) {
	i := lineIndex(c.Lines, sku)
	if qty == 0 {
		if i >= 0 {
			c.Lines = slices.Delete(c.Lines, i, i+1)
		}
	} else {
		p, err := s.Store.Products(ctx, []string{sku})
		if err != nil {
			return nil, err
		}
		if prod, ok := p[sku]; !ok || !prod.Active {
			return nil, httpx.NotFound("product")
		}
		st, err := s.Store.Stock(ctx, []string{sku})
		if err != nil {
			return nil, err
		}
		qty = min(qty, MaxQtyPerLine)
		if avail := st[sku].Available(); qty > avail {
			if avail <= 0 {
				return nil, httpx.Conflict("out_of_stock", "this item is sold out")
			}
			return nil, httpx.Conflict("insufficient_stock", fmt.Sprintf("only %d left in stock", avail))
		}
		if i >= 0 {
			c.Lines[i].Qty = qty
		} else {
			if len(c.Lines) >= MaxCartLines {
				return nil, httpx.BadRequest("your cart is full")
			}
			c.Lines = append(c.Lines, Line{SKU: sku, Qty: qty})
		}
	}
	if err := s.saveCart(ctx, c); err != nil {
		return nil, err
	}
	return s.GetCart(ctx, c.Owner)
}

// MergeCarts moves a guest's cart into the user's cart after sign-in. Quantities for
// the same SKU are added, capped at the per-line limit.
func (s *Service) MergeCarts(ctx context.Context, guestOwner, userOwner string) (*CartView, error) {
	if guestOwner == "" || guestOwner == userOwner {
		return s.GetCart(ctx, userOwner)
	}
	g, err := s.Store.Cart(ctx, guestOwner)
	if err != nil {
		return nil, err
	}
	if len(g.Lines) > 0 {
		u, err := s.Store.Cart(ctx, userOwner)
		if err != nil {
			return nil, err
		}
		for _, l := range g.Lines {
			if i := lineIndex(u.Lines, l.SKU); i >= 0 {
				u.Lines[i].Qty = min(u.Lines[i].Qty+l.Qty, MaxQtyPerLine)
			} else if len(u.Lines) < MaxCartLines {
				u.Lines = append(u.Lines, l)
			}
		}
		if err := s.saveCart(ctx, u); err != nil {
			return nil, err
		}
		if err := s.Store.DeleteCart(ctx, guestOwner); err != nil {
			return nil, err
		}
	}
	return s.GetCart(ctx, userOwner)
}

func (s *Service) saveCart(ctx context.Context, c Cart) error {
	now := s.Now().UTC()
	c.UpdatedAt, c.ExpiresAt = now, now.Add(CartTTL)
	return s.Store.SaveCart(ctx, c)
}

// ---------- Checkout ----------

type CheckoutInput struct {
	Email      string  `json:"email"`
	Address    Address `json:"address"`
	CouponCode string  `json:"couponCode"`
}

type QuoteView struct {
	Totals       Totals `json:"totals"`
	CouponError  string `json:"couponError,omitempty"`
	FreeShipping int64  `json:"freeShippingOverCents"`
}

// Quote prices the current cart for a province and optional coupon, for the checkout
// page's summary. A bad coupon is reported but doesn't fail the quote.
func (s *Service) Quote(ctx context.Context, owner, province, coupon string) (*QuoteView, error) {
	lines, err := s.orderLines(ctx, owner)
	if err != nil {
		return nil, err
	}
	q := &QuoteView{FreeShipping: FreeShippingOverCents}
	var c *Coupon
	if coupon = normalizeCode(coupon); coupon != "" {
		c, _ = s.Store.Coupon(ctx, coupon)
	}
	t, err := Quote(lines, c, province, s.Now())
	var ce *CouponError
	if errors.As(err, &ce) {
		q.CouponError = ce.Reason
		t, _ = Quote(lines, nil, province, s.Now())
	}
	q.Totals = t
	return q, nil
}

// orderLines snapshots the cart into order lines at current prices, or explains
// why it can't be checked out.
func (s *Service) orderLines(ctx context.Context, owner string) ([]OrderLine, error) {
	v, err := s.GetCart(ctx, owner)
	if err != nil {
		return nil, err
	}
	if len(v.Lines) == 0 {
		return nil, httpx.BadRequest("your cart is empty")
	}
	if !v.CanCheckout {
		return nil, httpx.Conflict("cart_changed", "some items in your cart changed; review your cart")
	}
	out := make([]OrderLine, len(v.Lines))
	for i, l := range v.Lines {
		out[i] = OrderLine{SKU: l.SKU, ProductID: l.ProductID, Slug: l.Slug, Name: l.Name, Options: l.Options,
			Image: l.Image, UnitPriceCents: l.UnitPriceCents, Qty: l.Qty, LineTotalCents: l.LineTotalCents}
	}
	return out, nil
}

// Checkout turns the cart into a pending order and reserves its stock, all in one
// transaction: either the order exists and its stock is held, or neither happened.
// Prices come from the server's own product copy; nothing the browser sends about
// prices is trusted. Payment happens next, in payment-service.
func (s *Service) Checkout(ctx context.Context, owner string, user *httpx.Principal, in CheckoutInput) (*Order, string, error) {
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if user != nil {
		email = user.Email
	}
	fields := ValidateAddress(&in.Address)
	if a, err := mail.ParseAddress(email); err != nil || a.Address != email {
		fields["email"] = "enter a valid email address"
	}
	if len(fields) > 0 {
		return nil, "", httpx.Invalid(fields)
	}
	lines, err := s.orderLines(ctx, owner)
	if err != nil {
		return nil, "", err
	}
	now := s.Now().UTC()
	var coupon *Coupon
	if code := normalizeCode(in.CouponCode); code != "" {
		coupon, err = s.Store.Coupon(ctx, code)
		if errors.Is(err, ErrNotFound) {
			return nil, "", httpx.Invalid(map[string]string{"couponCode": "this code isn't valid"})
		} else if err != nil {
			return nil, "", err
		}
	}
	totals, err := Quote(lines, coupon, in.Address.Province, now)
	var ce *CouponError
	if errors.As(err, &ce) {
		return nil, "", httpx.Invalid(map[string]string{"couponCode": ce.Reason})
	}
	// Numbers come from a counter outside the transaction: a failed checkout leaves a gap
	// in the sequence, which is fine, and the counter doesn't become a hot spot that
	// every concurrent checkout transaction conflicts on.
	n, err := s.Store.NextOrderNumber(ctx)
	if err != nil {
		return nil, "", err
	}
	o := &Order{
		ID: id.New(), Number: fmt.Sprintf("NL-%06d", n), Owner: owner, Email: email,
		Lines: lines, Totals: totals, Currency: "CAD", ShippingAddress: in.Address,
		Status: StatusPendingPayment, History: []StatusChange{{Status: StatusPendingPayment, At: now}},
		ReservedUntil: now.Add(ReservationTTL), CreatedAt: now, UpdatedAt: now,
	}
	if coupon != nil {
		o.CouponCode = coupon.Code
	}
	guestKey := ""
	if user != nil {
		o.UserID = user.UserID
	} else {
		guestKey = id.Secret(24) // lets a guest view this order; only its hash is stored
		o.GuestKeyHash = id.Hash(guestKey)
	}

	err = s.Store.Tx(ctx, func(ctx context.Context) error {
		// A shopper who abandoned an earlier payment and checks out again shouldn't
		// hold stock twice: release their older unpaid orders first.
		if err := s.cancelOlderPending(ctx, owner, now); err != nil {
			return err
		}
		if err := s.Store.Reserve(ctx, o.StockLines()); err != nil {
			return err
		}
		if err := s.Store.InsertOrder(ctx, o); err != nil {
			return err
		}
		if coupon != nil {
			if err := s.Store.UseCoupon(ctx, coupon.Code); err != nil {
				return err
			}
		}
		return s.emitStock(ctx, skusOf(o.StockLines()))
	})
	var short *ErrInsufficient
	if errors.As(err, &short) {
		return nil, "", httpx.Conflict("insufficient_stock", "someone just bought the last of an item in your cart; review your cart")
	}
	if err != nil {
		return nil, "", err
	}
	return o, guestKey, nil
}

func (s *Service) cancelOlderPending(ctx context.Context, owner string, now time.Time) error {
	older, err := s.Store.PendingOrders(ctx, owner)
	if err != nil {
		return err
	}
	for _, p := range older {
		if _, err := s.Store.UpdateStatus(ctx, p.ID, StatusUpdate{From: []string{StatusPendingPayment},
			To: StatusCancelled, Note: "replaced by a newer checkout", At: now}); err != nil {
			if errors.Is(err, ErrStatus) {
				continue
			}
			return err
		}
		if err := s.Store.Release(ctx, p.StockLines()); err != nil {
			return err
		}
		if err := s.Store.AddEvents(ctx, cancelledEvent(&p, false)); err != nil {
			return err
		}
	}
	return nil
}

// ---------- Payment events ----------

type paymentData struct {
	PaymentID   string `json:"paymentId"`
	OrderID     string `json:"orderId"`
	AmountCents int64  `json:"amountCents"`
	Full        bool   `json:"full"`
}

// OnPaymentSucceeded marks the order paid, takes its stock off the shelf, empties the
// cart and announces order.placed. It is idempotent: the broker may deliver twice.
func (s *Service) OnPaymentSucceeded(ctx context.Context, ev events.Event) error {
	var d paymentData
	if !decode(ev, &d) {
		return nil
	}
	now := s.Now().UTC()
	return skipMissing(s.Store.Tx(ctx, func(ctx context.Context) error {
		o, err := s.Store.UpdateStatus(ctx, d.OrderID, StatusUpdate{From: []string{StatusPendingPayment},
			To: StatusPaid, PaymentID: d.PaymentID, At: now})
		if errors.Is(err, ErrStatus) {
			cur, err := s.Store.Order(ctx, d.OrderID)
			if err != nil {
				return err
			}
			if cur.Status == StatusCancelled && cur.PaymentID == "" {
				// The money arrived after the reservation expired and the stock was
				// released. Don't resurrect the order: ask payment-service to refund.
				slog.Warn("payment for an expired order; refunding", "order", cur.ID)
				return s.Store.AddEvents(ctx, events.Must(events.OrderCancelled, map[string]any{
					"orderId": cur.ID, "number": cur.Number, "email": cur.Email, "refund": true, "paymentId": d.PaymentID}))
			}
			return nil // already paid: a redelivery
		}
		if err != nil {
			return err
		}
		if err := s.Store.Commit(ctx, o.StockLines()); err != nil {
			return err
		}
		if err := s.Store.DeleteCart(ctx, o.Owner); err != nil {
			return err
		}
		items := make([]map[string]any, len(o.Lines))
		for i, l := range o.Lines {
			items[i] = map[string]any{"sku": l.SKU, "productId": l.ProductID, "name": l.Name,
				"qty": l.Qty, "unitPriceCents": l.UnitPriceCents}
		}
		return s.Store.AddEvents(ctx, events.Must(events.OrderPlaced, map[string]any{
			"orderId": o.ID, "number": o.Number, "userId": o.UserID, "email": o.Email,
			"totalCents": o.Totals.TotalCents, "items": items}))
	}), ev)
}

// OnRefundIssued records a refund. A full refund moves the order to refunded unless
// it was already cancelled (cancel-then-refund keeps "cancelled").
func (s *Service) OnRefundIssued(ctx context.Context, ev events.Event) error {
	var d paymentData
	if !decode(ev, &d) {
		return nil
	}
	o, err := s.Store.Order(ctx, d.OrderID)
	if err != nil {
		return skipMissing(err, ev)
	}
	u := StatusUpdate{From: []string{o.Status}, AddRefunded: d.AmountCents, At: s.Now().UTC(),
		Note: fmt.Sprintf("refunded %s", money(d.AmountCents))}
	if d.Full && CanMove(o.Status, StatusRefunded) {
		u.To = StatusRefunded
	} else {
		u.To, u.KeepStatus = o.Status, true
	}
	_, err = s.Store.UpdateStatus(ctx, o.ID, u)
	return err
}

// ---------- Catalog events ----------

type productEvent struct {
	ProductID string `json:"productId"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Image     string `json:"image"`
	Variants  []struct {
		SKU          string            `json:"sku"`
		Options      map[string]string `json:"options"`
		PriceCents   int64             `json:"priceCents"`
		InitialStock int               `json:"initialStock"`
	} `json:"variants"`
}

// OnProductUpdated refreshes the local product copy and creates stock records for
// new SKUs. Upserts make it safe to receive the same event twice.
func (s *Service) OnProductUpdated(ctx context.Context, ev events.Event) error {
	var d productEvent
	if !decode(ev, &d) {
		return nil
	}
	now := s.Now().UTC()
	return s.Store.Tx(ctx, func(ctx context.Context) error {
		var keep, created []string
		for _, v := range d.Variants {
			p := Product{SKU: v.SKU, ProductID: d.ProductID, Slug: d.Slug, Name: d.Name, Options: v.Options,
				PriceCents: v.PriceCents, Image: d.Image, Active: d.Status == "active", UpdatedAt: now}
			if err := s.Store.UpsertProduct(ctx, p); err != nil {
				return err
			}
			keep = append(keep, v.SKU)
			isNew, err := s.Store.EnsureStock(ctx, v.SKU, max(v.InitialStock, 0), 5)
			if err != nil {
				return err
			}
			if isNew {
				created = append(created, v.SKU)
			}
		}
		if err := s.Store.DeactivateProduct(ctx, d.ProductID, keep); err != nil {
			return err
		}
		return s.emitStock(ctx, created)
	})
}

func (s *Service) OnProductDeleted(ctx context.Context, ev events.Event) error {
	var d productEvent
	if !decode(ev, &d) {
		return nil
	}
	return s.Store.DeactivateProduct(ctx, d.ProductID, nil)
}

// emitStock announces current availability so the catalog can show "sold out".
func (s *Service) emitStock(ctx context.Context, skus []string) error {
	if len(skus) == 0 {
		return nil
	}
	st, err := s.Store.Stock(ctx, skus)
	if err != nil {
		return err
	}
	items := make([]map[string]any, 0, len(skus))
	for _, sku := range skus {
		items = append(items, map[string]any{"sku": sku, "available": max(st[sku].Available(), 0)})
	}
	return s.Store.AddEvents(ctx, events.Must(events.StockChanged, map[string]any{"items": items}))
}

// ---------- Expiry ----------

// ExpireStale cancels unpaid orders whose reservation ran out and returns their
// stock to sale. main.go runs it every minute.
func (s *Service) ExpireStale(ctx context.Context) (int, error) {
	now := s.Now().UTC()
	stale, err := s.Store.ExpiredPending(ctx, now, 100)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, o := range stale {
		err := s.Store.Tx(ctx, func(ctx context.Context) error {
			if _, err := s.Store.UpdateStatus(ctx, o.ID, StatusUpdate{From: []string{StatusPendingPayment},
				To: StatusCancelled, Note: "payment not completed in time", At: now}); err != nil {
				return err
			}
			if err := s.Store.Release(ctx, o.StockLines()); err != nil {
				return err
			}
			if err := s.Store.AddEvents(ctx, cancelledEvent(&o, false)); err != nil {
				return err
			}
			return s.emitStock(ctx, skusOf(o.StockLines()))
		})
		if errors.Is(err, ErrStatus) {
			continue // paid at the last second: the payment wins
		}
		if err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// ---------- Customer orders ----------

func (s *Service) MyOrders(ctx context.Context, userID string) ([]Order, error) {
	list, _, err := s.Store.ListOrders(ctx, OrderQuery{UserID: userID, Limit: 50})
	return list, err
}

// OrderFor returns an order to its owner: the signed-in user who placed it, or anyone
// holding the guest key from checkout. Anything else is a 404, not a 403, so order IDs
// can't be probed.
func (s *Service) OrderFor(ctx context.Context, orderID string, user *httpx.Principal, guestKey string) (*Order, error) {
	o, err := s.Store.Order(ctx, orderID)
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.NotFound("order")
	}
	if err != nil {
		return nil, err
	}
	switch {
	case user != nil && o.UserID == user.UserID:
	case user.Has("staff"):
	case guestKey != "" && o.GuestKeyHash != "" && id.Hash(guestKey) == o.GuestKeyHash:
	default:
		return nil, httpx.NotFound("order")
	}
	return o, nil
}

// ---------- Admin ----------

// AdminOrder adds the moves staff may make next, so the UI only shows valid buttons.
type AdminOrder struct {
	*Order
	Next []string `json:"next"`
}

func (s *Service) AdminOrders(ctx context.Context, q OrderQuery) ([]Order, int, error) {
	q.Limit = min(max(q.Limit, 1), 100)
	return s.Store.ListOrders(ctx, q)
}

func (s *Service) AdminOrder(ctx context.Context, orderID string) (*AdminOrder, error) {
	o, err := s.Store.Order(ctx, orderID)
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.NotFound("order")
	}
	if err != nil {
		return nil, err
	}
	return &AdminOrder{Order: o, Next: NextStatuses(o.Status)}, nil
}

// SetStatus is staff moving an order along: processing, shipped, delivered, cancelled.
func (s *Service) SetStatus(ctx context.Context, orderID, to, tracking string) (*AdminOrder, error) {
	o, err := s.Store.Order(ctx, orderID)
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.NotFound("order")
	}
	if err != nil {
		return nil, err
	}
	if !slices.Contains(NextStatuses(o.Status), to) {
		return nil, httpx.Conflict("invalid_transition", fmt.Sprintf("can't move an order from %s to %s", o.Status, to))
	}
	tracking = strings.TrimSpace(tracking)
	if to == StatusShipped && tracking == "" {
		return nil, httpx.Invalid(map[string]string{"tracking": "add a tracking number"})
	}
	now := s.Now().UTC()
	err = s.Store.Tx(ctx, func(ctx context.Context) error {
		updated, err := s.Store.UpdateStatus(ctx, o.ID, StatusUpdate{From: []string{o.Status}, To: to, Tracking: tracking, At: now})
		if err != nil {
			return err
		}
		switch to {
		case StatusCancelled:
			if stockIsCommitted(o.Status) {
				err = s.Store.Restock(ctx, o.StockLines())
			} else {
				err = s.Store.Release(ctx, o.StockLines())
			}
			if err != nil {
				return err
			}
			// A paid order that is cancelled gets its money back: payment-service
			// listens for this event and refunds.
			if err := s.Store.AddEvents(ctx, cancelledEvent(updated, o.Status != StatusPendingPayment)); err != nil {
				return err
			}
			return s.emitStock(ctx, skusOf(o.StockLines()))
		case StatusShipped:
			return s.Store.AddEvents(ctx, events.Must(events.OrderShipped, map[string]any{
				"orderId": o.ID, "number": o.Number, "email": o.Email, "tracking": tracking}))
		case StatusDelivered:
			return s.Store.AddEvents(ctx, events.Must(events.OrderDelivered, map[string]any{
				"orderId": o.ID, "number": o.Number, "userId": o.UserID}))
		}
		return nil
	})
	if errors.Is(err, ErrStatus) {
		return nil, httpx.Conflict("status_changed", "this order changed while you were looking at it; reload")
	}
	if err != nil {
		return nil, err
	}
	return s.AdminOrder(ctx, orderID)
}

type StockView struct {
	Stock
	Name      string            `json:"name"`
	Options   map[string]string `json:"options"`
	Available int               `json:"available"`
	Low       bool              `json:"low"`
	Active    bool              `json:"active"`
}

func (s *Service) Inventory(ctx context.Context, lowOnly bool) ([]StockView, error) {
	all, err := s.Store.ListStock(ctx)
	if err != nil {
		return nil, err
	}
	products, err := s.Store.Products(ctx, skusOfStock(all))
	if err != nil {
		return nil, err
	}
	out := []StockView{}
	for _, st := range all {
		p := products[st.SKU]
		v := StockView{Stock: st, Name: p.Name, Options: p.Options, Available: st.Available(),
			Low: st.Available() <= st.LowStockAt, Active: p.Active}
		if !lowOnly || v.Low {
			out = append(out, v)
		}
	}
	return out, nil
}

// AdjustStock records a delivery (positive) or a write-off (negative).
func (s *Service) AdjustStock(ctx context.Context, sku string, delta int) (*Stock, error) {
	if delta == 0 || delta < -10_000 || delta > 10_000 {
		return nil, httpx.Invalid(map[string]string{"delta": "enter a non-zero change up to 10,000"})
	}
	var st Stock
	err := s.Store.Tx(ctx, func(ctx context.Context) error {
		var err error
		if st, err = s.Store.AdjustStock(ctx, sku, delta); err != nil {
			return err
		}
		return s.emitStock(ctx, []string{sku})
	})
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.NotFound("SKU")
	}
	var short *ErrInsufficient
	if errors.As(err, &short) {
		return nil, httpx.Conflict("below_reserved", "on-hand stock can't drop below what unpaid orders have reserved")
	}
	return &st, err
}

func (s *Service) Coupons(ctx context.Context) ([]Coupon, error) { return s.Store.ListCoupons(ctx) }

func (s *Service) SaveCoupon(ctx context.Context, c Coupon) (*Coupon, error) {
	c.Code = normalizeCode(c.Code)
	f := map[string]string{}
	if len(c.Code) < 3 || len(c.Code) > 30 {
		f["code"] = "use 3 to 30 letters or digits"
	}
	if (c.PercentOff > 0) == (c.AmountOffCents > 0) {
		f["percentOff"] = "set either a percentage or a fixed amount"
	}
	if c.PercentOff < 0 || c.PercentOff > 90 {
		f["percentOff"] = "use 1 to 90"
	}
	if c.AmountOffCents < 0 || c.MinSubtotalCents < 0 || c.MaxUses < 0 {
		f["amountOffCents"] = "amounts can't be negative"
	}
	if len(f) > 0 {
		return nil, httpx.Invalid(f)
	}
	if existing, err := s.Store.Coupon(ctx, c.Code); err == nil {
		c.Uses = existing.Uses // the use count belongs to the server
	} else {
		c.Uses = 0
	}
	return &c, s.Store.SaveCoupon(ctx, c)
}

func (s *Service) Stats(ctx context.Context, days int) (Stats, error) {
	days = min(max(days, 1), 90)
	since := s.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, -(days - 1))
	return s.Store.Stats(ctx, since)
}

// InternalOrder is what payment-service needs to charge for an order.
type InternalOrder struct {
	ID           string `json:"id"`
	Number       string `json:"number"`
	Status       string `json:"status"`
	TotalCents   int64  `json:"totalCents"`
	Currency     string `json:"currency"`
	UserID       string `json:"userId"`
	Email        string `json:"email"`
	GuestKeyHash string `json:"guestKeyHash"`
}

func (s *Service) Internal(ctx context.Context, orderID string) (*InternalOrder, error) {
	o, err := s.Store.Order(ctx, orderID)
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.NotFound("order")
	}
	if err != nil {
		return nil, err
	}
	return &InternalOrder{ID: o.ID, Number: o.Number, Status: o.Status, TotalCents: o.Totals.TotalCents,
		Currency: o.Currency, UserID: o.UserID, Email: o.Email, GuestKeyHash: o.GuestKeyHash}, nil
}

// ---------- helpers ----------

// ValidateAddress mirrors auth-service's rules. The two services deliberately don't
// share domain code: each can change on its own schedule.
func ValidateAddress(a *Address) map[string]string {
	f := map[string]string{}
	for _, p := range []*string{&a.Name, &a.Line1, &a.Line2, &a.City, &a.Province, &a.PostalCode, &a.Phone} {
		*p = strings.TrimSpace(*p)
	}
	a.Province = strings.ToUpper(a.Province)
	a.PostalCode = strings.ToUpper(strings.ReplaceAll(a.PostalCode, " ", ""))
	a.Country = "CA"
	if a.Name == "" {
		f["address.name"] = "required"
	}
	if a.Line1 == "" {
		f["address.line1"] = "required"
	}
	if a.City == "" {
		f["address.city"] = "required"
	}
	if _, ok := TaxRates[a.Province]; !ok {
		f["address.province"] = "choose a province or territory"
	}
	if !validPostal(a.PostalCode) {
		f["address.postalCode"] = "use the format A1A 1A1"
	} else {
		a.PostalCode = a.PostalCode[:3] + " " + a.PostalCode[3:]
	}
	return f
}

func validPostal(p string) bool {
	if len(p) != 6 {
		return false
	}
	for i, r := range p {
		if (i%2 == 0) != (r >= 'A' && r <= 'Z') || (i%2 == 1) != (r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

func cancelledEvent(o *Order, refund bool) events.Event {
	return events.Must(events.OrderCancelled, map[string]any{
		"orderId": o.ID, "number": o.Number, "email": o.Email, "refund": refund, "paymentId": o.PaymentID})
}

// decode reads an event's data. A malformed payload is logged and reported as not ok;
// the caller then acknowledges the event, because redelivering it can't fix it.
func decode(ev events.Event, v any) bool {
	if err := json.Unmarshal(ev.Data, v); err != nil {
		slog.Error("bad event payload, skipping", "type", ev.Type, "id", ev.ID, "err", err)
		return false
	}
	return true
}

// skipMissing turns "order not found" into success for event handlers: the event refers
// to an order this service never had (e.g. a test payment), and retrying won't create it.
func skipMissing(err error, ev events.Event) error {
	if errors.Is(err, ErrNotFound) {
		slog.Warn("event for unknown order, skipping", "type", ev.Type, "id", ev.ID)
		return nil
	}
	return err
}

func normalizeCode(c string) string { return strings.ToUpper(strings.TrimSpace(c)) }

func lineIndex(lines []Line, sku string) int {
	return slices.IndexFunc(lines, func(l Line) bool { return l.SKU == sku })
}

func skusOf(lines []Line) []string {
	out := make([]string, len(lines))
	for i, l := range lines {
		out[i] = l.SKU
	}
	return out
}

func skusOfStock(st []Stock) []string {
	out := make([]string, len(st))
	for i, s := range st {
		out[i] = s.SKU
	}
	return out
}

func money(cents int64) string { return fmt.Sprintf("$%d.%02d", cents/100, cents%100) }
