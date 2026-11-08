package payment

import (
	"cmp"
	"context"
	"slices"
	"sync"

	"shop/internal/platform/events"
)

// MemStore is the in-memory Store used by tests.
type MemStore struct {
	txMu     sync.Mutex
	mu       sync.Mutex
	payments map[string]Payment
	seen     map[string]bool
	Outbox   events.MemOutbox
}

func NewMemStore() *MemStore {
	return &MemStore{payments: map[string]Payment{}, seen: map[string]bool{}}
}

func (m *MemStore) Tx(ctx context.Context, fn func(ctx context.Context) error) error {
	m.txMu.Lock()
	defer m.txMu.Unlock()
	return fn(ctx)
}

func clonePayment(p Payment) *Payment {
	p.Refunds = slices.Clone(p.Refunds)
	return &p
}

func (m *MemStore) Insert(_ context.Context, p *Payment) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.payments[p.ID] = *clonePayment(*p)
	return nil
}

func (m *MemStore) Get(_ context.Context, id string) (*Payment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.payments[id]
	if !ok {
		return nil, ErrNotFound
	}
	return clonePayment(p), nil
}

func (m *MemStore) find(match func(Payment) bool) (*Payment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var best *Payment
	for _, p := range m.payments {
		if match(p) && (best == nil || p.CreatedAt.After(best.CreatedAt)) {
			best = clonePayment(p)
		}
	}
	if best == nil {
		return nil, ErrNotFound
	}
	return best, nil
}

func (m *MemStore) ByOrder(_ context.Context, orderID string) (*Payment, error) {
	return m.find(func(p Payment) bool { return p.OrderID == orderID })
}

func (m *MemStore) ByRef(_ context.Context, provider, ref string) (*Payment, error) {
	return m.find(func(p Payment) bool { return p.Provider == provider && p.ProviderRef == ref })
}

func (m *MemStore) Apply(_ context.Context, id string, u Update) (*Payment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.payments[id]
	if !ok {
		return nil, ErrNotFound
	}
	if !slices.Contains(u.From, p.Status) {
		return nil, ErrStatus
	}
	p.Status, p.UpdatedAt = u.To, u.At
	if u.FailureReason != "" {
		p.FailureReason = u.FailureReason
	}
	if u.Refund != nil {
		p.Refunds = append(slices.Clone(p.Refunds), *u.Refund)
		p.RefundedCents += u.Refund.AmountCents
	}
	m.payments[id] = p
	return clonePayment(p), nil
}

func (m *MemStore) List(_ context.Context, orderID string, limit int) ([]Payment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Payment{}
	for _, p := range m.payments {
		if orderID == "" || p.OrderID == orderID {
			out = append(out, *clonePayment(p))
		}
	}
	slices.SortFunc(out, func(a, b Payment) int { return cmp.Compare(b.CreatedAt.UnixNano(), a.CreatedAt.UnixNano()) })
	return out[:min(len(out), limit)], nil
}

func (m *MemStore) FirstSeen(_ context.Context, eventID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.seen[eventID] {
		return false, nil
	}
	m.seen[eventID] = true
	return true, nil
}

func (m *MemStore) AddEvents(_ context.Context, evs ...events.Event) error {
	m.Outbox.Add(evs...)
	return nil
}
