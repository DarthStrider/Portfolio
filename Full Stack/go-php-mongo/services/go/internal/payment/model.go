// Package payment is payment-service: it charges for orders through a payment provider
// and turns the provider's answers into payment.* and refund.* events.
package payment

import (
	"context"
	"errors"
	"time"

	"shop/internal/platform/events"
)

const (
	StatusRequiresPayment   = "requires_payment"
	StatusSucceeded         = "succeeded"
	StatusFailed            = "failed"
	StatusPartiallyRefunded = "partially_refunded"
	StatusRefunded          = "refunded"
)

type Refund struct {
	ID          string    `bson:"id" json:"id"`
	AmountCents int64     `bson:"amountCents" json:"amountCents"`
	At          time.Time `bson:"at" json:"at"`
}

type Payment struct {
	ID            string    `bson:"_id" json:"id"`
	OrderID       string    `bson:"orderId" json:"orderId"`
	OrderNumber   string    `bson:"orderNumber" json:"orderNumber"`
	Provider      string    `bson:"provider" json:"provider"`
	ProviderRef   string    `bson:"providerRef" json:"providerRef"`
	ClientSecret  string    `bson:"clientSecret" json:"-"`
	AmountCents   int64     `bson:"amountCents" json:"amountCents"`
	Currency      string    `bson:"currency" json:"currency"`
	Status        string    `bson:"status" json:"status"`
	RefundedCents int64     `bson:"refundedCents" json:"refundedCents"`
	Refunds       []Refund  `bson:"refunds" json:"refunds"`
	FailureReason string    `bson:"failureReason,omitempty" json:"failureReason,omitempty"`
	CreatedAt     time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt     time.Time `bson:"updatedAt" json:"updatedAt"`
}

// Update is a compare-and-set on a payment's status, like order-service's StatusUpdate.
type Update struct {
	From          []string
	To            string
	At            time.Time
	FailureReason string
	Refund        *Refund
}

var (
	ErrNotFound = errors.New("not found")
	ErrStatus   = errors.New("payment status changed")
)

type Store interface {
	Tx(ctx context.Context, fn func(ctx context.Context) error) error
	Insert(ctx context.Context, p *Payment) error
	Get(ctx context.Context, id string) (*Payment, error)
	ByOrder(ctx context.Context, orderID string) (*Payment, error) // most recent
	ByRef(ctx context.Context, provider, ref string) (*Payment, error)
	Apply(ctx context.Context, id string, u Update) (*Payment, error)
	List(ctx context.Context, orderID string, limit int) ([]Payment, error)
	// FirstSeen records a provider webhook event ID and reports whether this is the
	// first delivery. Providers retry webhooks, sometimes many times.
	FirstSeen(ctx context.Context, eventID string) (bool, error)
	AddEvents(ctx context.Context, evs ...events.Event) error
}
