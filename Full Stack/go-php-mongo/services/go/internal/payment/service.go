package payment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"shop/internal/platform/events"
	"shop/internal/platform/httpx"
	"shop/internal/platform/id"
)

type Service struct {
	Store         Store
	Provider      Provider
	Orders        OrderLookup
	WebhookSecret string
	Now           func() time.Time
}

// IntentView is what the checkout page needs to collect payment.
type IntentView struct {
	PaymentID      string `json:"paymentId"`
	Provider       string `json:"provider"`
	ClientSecret   string `json:"clientSecret"`
	PublishableKey string `json:"publishableKey,omitempty"`
	AmountCents    int64  `json:"amountCents"`
	Currency       string `json:"currency"`
}

// CreateIntent starts (or resumes) payment for an order. The amount always comes from
// order-service, never from the browser. Reloading the payment page reuses the open
// payment instead of creating a second one.
func (s *Service) CreateIntent(ctx context.Context, user *httpx.Principal, orderID, guestKey string) (*IntentView, error) {
	o, err := s.Orders.Order(ctx, orderID)
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.NotFound("order")
	}
	if err != nil {
		return nil, err
	}
	owns := (o.UserID != "" && user != nil && user.UserID == o.UserID) ||
		(o.UserID == "" && guestKey != "" && id.Hash(guestKey) == o.GuestKeyHash)
	if !owns {
		return nil, httpx.NotFound("order")
	}
	if o.Status != "pending_payment" {
		return nil, httpx.Conflict("order_not_payable", "this order is "+o.Status+" and can't be paid")
	}
	if p, err := s.Store.ByOrder(ctx, o.ID); err == nil &&
		(p.Status == StatusRequiresPayment || p.Status == StatusFailed) && p.AmountCents == o.TotalCents && p.Provider == s.Provider.Name() {
		return s.view(p), nil
	}
	now := s.Now().UTC()
	p := &Payment{ID: id.New(), OrderID: o.ID, OrderNumber: o.Number, Provider: s.Provider.Name(),
		AmountCents: o.TotalCents, Currency: o.Currency, Status: StatusRequiresPayment,
		Refunds: []Refund{}, CreatedAt: now, UpdatedAt: now}
	in, err := s.Provider.CreateIntent(ctx, p.AmountCents, p.Currency, o.ID, "intent-"+p.ID)
	if err != nil {
		return nil, fmt.Errorf("create intent: %w", err)
	}
	p.ProviderRef, p.ClientSecret = in.Ref, in.ClientSecret
	if err := s.Store.Insert(ctx, p); err != nil {
		return nil, err
	}
	return s.view(p), nil
}

func (s *Service) view(p *Payment) *IntentView {
	return &IntentView{PaymentID: p.ID, Provider: p.Provider, ClientSecret: p.ClientSecret,
		PublishableKey: s.Provider.PublishableKey(), AmountCents: p.AmountCents, Currency: p.Currency}
}

// succeed records a successful payment and emits payment.succeeded in one transaction.
// Duplicate notifications (the provider retrying, or a webhook plus a page poll) are no-ops.
func (s *Service) succeed(ctx context.Context, p *Payment) error {
	return s.Store.Tx(ctx, func(ctx context.Context) error {
		_, err := s.Store.Apply(ctx, p.ID, Update{From: []string{StatusRequiresPayment, StatusFailed},
			To: StatusSucceeded, At: s.Now().UTC()})
		if errors.Is(err, ErrStatus) {
			return nil
		}
		if err != nil {
			return err
		}
		return s.Store.AddEvents(ctx, events.Must(events.PaymentSucceeded, map[string]any{
			"paymentId": p.ID, "orderId": p.OrderID, "amountCents": p.AmountCents}))
	})
}

func (s *Service) fail(ctx context.Context, p *Payment, reason string) error {
	return s.Store.Tx(ctx, func(ctx context.Context) error {
		_, err := s.Store.Apply(ctx, p.ID, Update{From: []string{StatusRequiresPayment},
			To: StatusFailed, FailureReason: reason, At: s.Now().UTC()})
		if errors.Is(err, ErrStatus) {
			return nil
		}
		if err != nil {
			return err
		}
		return s.Store.AddEvents(ctx, events.Must(events.PaymentFailed, map[string]any{
			"paymentId": p.ID, "orderId": p.OrderID, "reason": reason}))
	})
}

// MockConfirm lets the demo checkout finish without Stripe. It only exists while the
// mock provider is active; with Stripe configured the route returns 404.
func (s *Service) MockConfirm(ctx context.Context, paymentID string, succeed bool) (*Payment, error) {
	if s.Provider.Name() != "mock" {
		return nil, httpx.NotFound("route")
	}
	p, err := s.Store.Get(ctx, paymentID)
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.NotFound("payment")
	}
	if err != nil {
		return nil, err
	}
	if succeed {
		err = s.succeed(ctx, p)
	} else {
		err = s.fail(ctx, p, "Your card was declined (test).")
	}
	if err != nil {
		return nil, err
	}
	return s.Store.Get(ctx, paymentID)
}

// Status lets the confirmation page poll until the webhook has landed.
func (s *Service) Status(ctx context.Context, paymentID string) (*Payment, error) {
	p, err := s.Store.Get(ctx, paymentID)
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.NotFound("payment")
	}
	return p, err
}

// StripeWebhook verifies and handles one webhook delivery. A bad signature is a 400 and
// nothing is touched; a repeated event ID is acknowledged and ignored.
func (s *Service) StripeWebhook(ctx context.Context, payload []byte, sigHeader string) error {
	if err := VerifyStripeSignature(payload, sigHeader, s.WebhookSecret, s.Now(), 5*time.Minute); err != nil {
		return httpx.BadRequest(err.Error())
	}
	var ev struct {
		ID   string `json:"id"`
		Type string `json:"type"`
		Data struct {
			Object struct {
				ID               string `json:"id"`
				LastPaymentError *struct {
					Message string `json:"message"`
				} `json:"last_payment_error"`
			} `json:"object"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &ev); err != nil || ev.ID == "" {
		return httpx.BadRequest("unreadable event")
	}
	first, err := s.Store.FirstSeen(ctx, ev.ID)
	if err != nil {
		return err
	}
	if !first {
		return nil
	}
	if ev.Type != "payment_intent.succeeded" && ev.Type != "payment_intent.payment_failed" {
		return nil // we subscribe to more than we act on; acknowledge the rest
	}
	p, err := s.Store.ByRef(ctx, "stripe", ev.Data.Object.ID)
	if errors.Is(err, ErrNotFound) {
		slog.Warn("webhook for unknown payment intent", "intent", ev.Data.Object.ID)
		return nil
	}
	if err != nil {
		return err
	}
	if ev.Type == "payment_intent.succeeded" {
		return s.succeed(ctx, p)
	}
	reason := "payment failed"
	if e := ev.Data.Object.LastPaymentError; e != nil && e.Message != "" {
		reason = e.Message
	}
	return s.fail(ctx, p, reason)
}

// Refund returns money for an order; amount 0 means everything not yet refunded.
// The provider call happens first, with an idempotency key derived from the payment's
// refund history: if saving the result fails and staff click again, the provider
// returns the same refund instead of paying out twice.
func (s *Service) Refund(ctx context.Context, orderID string, amount int64) (*Payment, error) {
	p, err := s.Store.ByOrder(ctx, orderID)
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.NotFound("payment for this order")
	}
	if err != nil {
		return nil, err
	}
	if p.Status != StatusSucceeded && p.Status != StatusPartiallyRefunded {
		return nil, httpx.Conflict("not_refundable", "only a completed payment can be refunded")
	}
	remaining := p.AmountCents - p.RefundedCents
	if amount == 0 {
		amount = remaining
	}
	if amount < 0 || amount > remaining {
		return nil, httpx.Invalid(map[string]string{"amountCents": fmt.Sprintf("refund between 0.01 and %d.%02d", remaining/100, remaining%100)})
	}
	refID, err := s.Provider.Refund(ctx, p.ProviderRef, amount, fmt.Sprintf("refund-%s-%d-%d", p.ID, p.RefundedCents, amount))
	if err != nil {
		return nil, fmt.Errorf("provider refund: %w", err)
	}
	full := p.RefundedCents+amount == p.AmountCents
	to := StatusPartiallyRefunded
	if full {
		to = StatusRefunded
	}
	var out *Payment
	err = s.Store.Tx(ctx, func(ctx context.Context) error {
		var err error
		out, err = s.Store.Apply(ctx, p.ID, Update{From: []string{p.Status}, To: to, At: s.Now().UTC(),
			Refund: &Refund{ID: refID, AmountCents: amount, At: s.Now().UTC()}})
		if err != nil {
			return err
		}
		return s.Store.AddEvents(ctx, events.Must(events.RefundIssued, map[string]any{
			"paymentId": p.ID, "orderId": p.OrderID, "amountCents": amount, "full": full}))
	})
	if errors.Is(err, ErrStatus) {
		return nil, httpx.Conflict("status_changed", "this payment changed meanwhile; reload")
	}
	return out, err
}

// OnOrderCancelled refunds a cancelled order that had been paid.
func (s *Service) OnOrderCancelled(ctx context.Context, ev events.Event) error {
	var d struct {
		OrderID string `json:"orderId"`
		Refund  bool   `json:"refund"`
	}
	if err := json.Unmarshal(ev.Data, &d); err != nil || !d.Refund {
		return nil
	}
	p, err := s.Store.ByOrder(ctx, d.OrderID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if p.Status != StatusSucceeded && p.Status != StatusPartiallyRefunded {
		return nil // nothing captured, or already refunded
	}
	_, err = s.Refund(ctx, d.OrderID, 0)
	var he *httpx.Error
	if errors.As(err, &he) {
		slog.Warn("auto-refund skipped", "order", d.OrderID, "reason", he.Message)
		return nil
	}
	return err
}

func (s *Service) List(ctx context.Context, orderID string) ([]Payment, error) {
	return s.Store.List(ctx, orderID, 100)
}
