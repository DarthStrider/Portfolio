// Package events defines the messages services exchange and the transactional outbox
// that publishes them.
//
// The problem the outbox solves: "save the order, then publish order.placed" has a gap.
// If the process dies between the two, the order exists but nobody hears about it.
// Instead, the event is written to an outbox collection in the same database transaction
// as the order, and a relay loop publishes whatever is in the outbox. Delivery becomes
// at-least-once, so every consumer must be idempotent.
package events

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"shop/internal/platform/id"
)

// Event types. The routing key on RabbitMQ is the type itself.
const (
	ProductUpdated   = "product.updated"
	ProductDeleted   = "product.deleted"
	StockChanged     = "stock.changed"
	OrderPlaced      = "order.placed" // paid; the sale is real
	OrderShipped     = "order.shipped"
	OrderDelivered   = "order.delivered"
	OrderCancelled   = "order.cancelled"
	PaymentSucceeded = "payment.succeeded"
	PaymentFailed    = "payment.failed"
	RefundIssued     = "refund.issued"
	PasswordReset    = "user.password_reset_requested"
)

// Event is the envelope every message uses, in Go and PHP alike.
type Event struct {
	ID         string          `json:"eventId"`
	Type       string          `json:"type"`
	OccurredAt time.Time       `json:"occurredAt"`
	Data       json.RawMessage `json:"data"`
}

// New wraps data in an envelope with a fresh ID.
func New(typ string, data any) (Event, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return Event{}, err
	}
	return Event{ID: id.New(), Type: typ, OccurredAt: time.Now().UTC(), Data: raw}, nil
}

// Must is New for data that always marshals (plain structs).
func Must(typ string, data any) Event {
	ev, err := New(typ, data)
	if err != nil {
		panic(err)
	}
	return ev
}

// Publisher sends an event to the broker.
type Publisher interface {
	Publish(ctx context.Context, ev Event) error
}

// Outbox is the read side of the outbox collection.
type Outbox interface {
	Pending(ctx context.Context, limit int) ([]Event, error)
	MarkSent(ctx context.Context, eventID string) error
}

// Relay publishes pending outbox events until ctx ends. Events go out in the order they
// were written; if publishing fails the loop stops for this tick and retries the same
// event next time, so nothing is skipped.
func Relay(ctx context.Context, ob Outbox, pub Publisher, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		if err := RelayOnce(ctx, ob, pub); err != nil && ctx.Err() == nil {
			slog.Warn("outbox relay", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// RelayOnce publishes one batch. Exposed for tests.
func RelayOnce(ctx context.Context, ob Outbox, pub Publisher) error {
	evs, err := ob.Pending(ctx, 100)
	if err != nil {
		return err
	}
	for _, ev := range evs {
		if err := pub.Publish(ctx, ev); err != nil {
			return err
		}
		if err := ob.MarkSent(ctx, ev.ID); err != nil {
			return err // published but not marked: it goes out again, consumers dedupe
		}
	}
	return nil
}

// Handler processes one event. Returning an error asks the broker to redeliver it.
type Handler func(ctx context.Context, ev Event) error

// MemOutbox is an in-memory outbox for tests and the database-free mode.
type MemOutbox struct {
	mu   sync.Mutex
	list []Event
	sent map[string]bool
}

func (m *MemOutbox) Add(evs ...Event) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.list = append(m.list, evs...)
}

func (m *MemOutbox) Pending(_ context.Context, limit int) ([]Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Event
	for _, ev := range m.list {
		if !m.sent[ev.ID] && len(out) < limit {
			out = append(out, ev)
		}
	}
	return out, nil
}

func (m *MemOutbox) MarkSent(_ context.Context, eventID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sent == nil {
		m.sent = map[string]bool{}
	}
	m.sent[eventID] = true
	return nil
}

// All returns every event written so far, sent or not. Tests assert on it.
func (m *MemOutbox) All() []Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Event(nil), m.list...)
}

// OfType filters All by type.
func (m *MemOutbox) OfType(typ string) []Event {
	var out []Event
	for _, ev := range m.All() {
		if ev.Type == typ {
			out = append(out, ev)
		}
	}
	return out
}

// Recorder is a Publisher that keeps what it was given.
type Recorder struct {
	mu  sync.Mutex
	Got []Event
}

func (r *Recorder) Publish(_ context.Context, ev Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Got = append(r.Got, ev)
	return nil
}
