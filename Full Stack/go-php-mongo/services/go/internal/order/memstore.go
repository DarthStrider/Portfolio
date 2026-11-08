package order

import (
	"cmp"
	"context"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"

	"shop/internal/platform/events"
)

// MemStore is an in-memory Store for tests. Tx serializes transactions with a lock
// but does not roll back; the multi-step operations that can fail halfway (Reserve)
// are all-or-nothing on their own, which is what the tests rely on.
type MemStore struct {
	txMu     sync.Mutex
	mu       sync.Mutex
	products map[string]Product
	stock    map[string]Stock
	carts    map[string]Cart
	orders   map[string]Order
	coupons  map[string]Coupon
	counter  int64
	Outbox   events.MemOutbox
}

func NewMemStore() *MemStore {
	return &MemStore{products: map[string]Product{}, stock: map[string]Stock{}, carts: map[string]Cart{},
		orders: map[string]Order{}, coupons: map[string]Coupon{}}
}

func (m *MemStore) Tx(ctx context.Context, fn func(ctx context.Context) error) error {
	m.txMu.Lock()
	defer m.txMu.Unlock()
	return fn(ctx)
}

func (m *MemStore) UpsertProduct(_ context.Context, p Product) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p.Options = maps.Clone(p.Options)
	m.products[p.SKU] = p
	return nil
}

func (m *MemStore) Products(_ context.Context, skus []string) (map[string]Product, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]Product{}
	for _, s := range skus {
		if p, ok := m.products[s]; ok {
			out[s] = p
		}
	}
	return out, nil
}

func (m *MemStore) DeactivateProduct(_ context.Context, productID string, keep []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, p := range m.products {
		if p.ProductID == productID && !slices.Contains(keep, k) {
			p.Active = false
			m.products[k] = p
		}
	}
	return nil
}

func (m *MemStore) EnsureStock(_ context.Context, sku string, initial, lowAt int) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.stock[sku]; ok {
		return false, nil
	}
	m.stock[sku] = Stock{SKU: sku, OnHand: initial, LowStockAt: lowAt, UpdatedAt: time.Now()}
	return true, nil
}

func (m *MemStore) Stock(_ context.Context, skus []string) (map[string]Stock, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]Stock{}
	for _, s := range skus {
		if st, ok := m.stock[s]; ok {
			out[s] = st
		}
	}
	return out, nil
}

func (m *MemStore) ListStock(_ context.Context) ([]Stock, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := slices.Collect(maps.Values(m.stock))
	slices.SortFunc(out, func(a, b Stock) int { return cmp.Compare(a.SKU, b.SKU) })
	return out, nil
}

func (m *MemStore) AdjustStock(_ context.Context, sku string, delta int) (Stock, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	st, ok := m.stock[sku]
	if !ok {
		return st, ErrNotFound
	}
	if st.OnHand+delta < st.Reserved {
		return st, &ErrInsufficient{SKUs: []string{sku}}
	}
	st.OnHand += delta
	m.stock[sku] = st
	return st, nil
}

func (m *MemStore) Reserve(_ context.Context, lines []Line) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	var short []string
	for _, l := range lines {
		if st, ok := m.stock[l.SKU]; !ok || st.Available() < l.Qty {
			short = append(short, l.SKU)
		}
	}
	if len(short) > 0 {
		return &ErrInsufficient{SKUs: short}
	}
	for _, l := range lines {
		st := m.stock[l.SKU]
		st.Reserved += l.Qty
		m.stock[l.SKU] = st
	}
	return nil
}

func (m *MemStore) move(lines []Line, onHand, reserved int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, l := range lines {
		st := m.stock[l.SKU]
		st.OnHand += onHand * l.Qty
		st.Reserved = max(st.Reserved+reserved*l.Qty, 0)
		m.stock[l.SKU] = st
	}
}

func (m *MemStore) Release(_ context.Context, lines []Line) error { m.move(lines, 0, -1); return nil }
func (m *MemStore) Commit(_ context.Context, lines []Line) error  { m.move(lines, -1, -1); return nil }
func (m *MemStore) Restock(_ context.Context, lines []Line) error { m.move(lines, 1, 0); return nil }

func (m *MemStore) Cart(_ context.Context, owner string) (Cart, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.carts[owner]
	if !ok {
		return Cart{Owner: owner, Lines: []Line{}}, nil
	}
	c.Lines = slices.Clone(c.Lines)
	return c, nil
}

func (m *MemStore) SaveCart(_ context.Context, c Cart) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c.Lines = slices.Clone(c.Lines)
	m.carts[c.Owner] = c
	return nil
}

func (m *MemStore) DeleteCart(_ context.Context, owner string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.carts, owner)
	return nil
}

func (m *MemStore) NextOrderNumber(_ context.Context) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.counter++
	return 1000 + m.counter, nil
}

func cloneOrder(o Order) Order {
	o.Lines = slices.Clone(o.Lines)
	o.History = slices.Clone(o.History)
	return o
}

func (m *MemStore) InsertOrder(_ context.Context, o *Order) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.orders[o.ID] = cloneOrder(*o)
	return nil
}

func (m *MemStore) Order(_ context.Context, id string) (*Order, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[id]
	if !ok {
		return nil, ErrNotFound
	}
	c := cloneOrder(o)
	return &c, nil
}

func (m *MemStore) UpdateStatus(_ context.Context, id string, u StatusUpdate) (*Order, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[id]
	if !ok {
		return nil, ErrNotFound
	}
	if !slices.Contains(u.From, o.Status) {
		return nil, ErrStatus
	}
	applyUpdate(&o, u)
	m.orders[id] = o
	c := cloneOrder(o)
	return &c, nil
}

// applyUpdate is the in-memory twin of the $set/$push/$inc in MongoStore.UpdateStatus.
func applyUpdate(o *Order, u StatusUpdate) {
	if !u.KeepStatus {
		o.Status = u.To
		o.History = append(o.History, StatusChange{Status: u.To, At: u.At, Note: u.Note})
	} else if u.Note != "" {
		o.History = append(o.History, StatusChange{Status: o.Status, At: u.At, Note: u.Note})
	}
	if u.PaymentID != "" {
		o.PaymentID = u.PaymentID
	}
	if u.Tracking != "" {
		o.Tracking = u.Tracking
	}
	o.RefundedCents += u.AddRefunded
	o.UpdatedAt = u.At
}

func (m *MemStore) ListOrders(_ context.Context, q OrderQuery) ([]Order, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var all []Order
	for _, o := range m.orders {
		if q.UserID != "" && o.UserID != q.UserID {
			continue
		}
		if q.Status != "" && o.Status != q.Status {
			continue
		}
		if s := strings.ToLower(q.Search); s != "" && !strings.Contains(strings.ToLower(o.Number), s) && !strings.Contains(o.Email, s) {
			continue
		}
		all = append(all, cloneOrder(o))
	}
	slices.SortFunc(all, func(a, b Order) int { return b.CreatedAt.Compare(a.CreatedAt) })
	total := len(all)
	if q.Skip >= len(all) {
		return []Order{}, total, nil
	}
	all = all[q.Skip:]
	if q.Limit > 0 && len(all) > q.Limit {
		all = all[:q.Limit]
	}
	return all, total, nil
}

func (m *MemStore) PendingOrders(_ context.Context, owner string) ([]Order, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Order
	for _, o := range m.orders {
		if o.Owner == owner && o.Status == StatusPendingPayment {
			out = append(out, cloneOrder(o))
		}
	}
	return out, nil
}

func (m *MemStore) ExpiredPending(_ context.Context, before time.Time, limit int) ([]Order, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Order
	for _, o := range m.orders {
		if o.Status == StatusPendingPayment && o.ReservedUntil.Before(before) && len(out) < limit {
			out = append(out, cloneOrder(o))
		}
	}
	return out, nil
}

func (m *MemStore) Coupon(_ context.Context, code string) (*Coupon, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.coupons[code]
	if !ok {
		return nil, ErrNotFound
	}
	return &c, nil
}

func (m *MemStore) SaveCoupon(_ context.Context, c Coupon) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.coupons[c.Code] = c
	return nil
}

func (m *MemStore) ListCoupons(_ context.Context) ([]Coupon, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := slices.Collect(maps.Values(m.coupons))
	slices.SortFunc(out, func(a, b Coupon) int { return cmp.Compare(a.Code, b.Code) })
	return out, nil
}

func (m *MemStore) UseCoupon(_ context.Context, code string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.coupons[code]
	c.Uses++
	m.coupons[code] = c
	return nil
}

func (m *MemStore) AddEvents(_ context.Context, evs ...events.Event) error {
	m.Outbox.Add(evs...)
	return nil
}

// Stats computes in Go what MongoStore computes with an aggregation pipeline.
func (m *MemStore) Stats(_ context.Context, since time.Time) (Stats, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := Stats{ByDay: []DayStat{}, TopProducts: []TopProduct{}}
	days := map[string]*DayStat{}
	top := map[string]*TopProduct{}
	for _, o := range m.orders {
		if o.Status == StatusPendingPayment {
			st.PendingOrders++
		}
		if !countsAsSale(o.Status) || o.CreatedAt.Before(since) {
			continue
		}
		st.Orders++
		st.RevenueCents += o.Totals.TotalCents - o.RefundedCents
		d := o.CreatedAt.Format("2006-01-02")
		if days[d] == nil {
			days[d] = &DayStat{Date: d}
		}
		days[d].Orders++
		days[d].RevenueCents += o.Totals.TotalCents - o.RefundedCents
		for _, l := range o.Lines {
			if top[l.SKU] == nil {
				top[l.SKU] = &TopProduct{SKU: l.SKU, Name: l.Name}
			}
			top[l.SKU].Qty += l.Qty
			top[l.SKU].RevenueCents += l.LineTotalCents
		}
	}
	for _, d := range days {
		st.ByDay = append(st.ByDay, *d)
	}
	slices.SortFunc(st.ByDay, func(a, b DayStat) int { return cmp.Compare(a.Date, b.Date) })
	for _, t := range top {
		st.TopProducts = append(st.TopProducts, *t)
	}
	slices.SortFunc(st.TopProducts, func(a, b TopProduct) int { return cmp.Compare(b.Qty, a.Qty) })
	st.TopProducts = st.TopProducts[:min(len(st.TopProducts), 5)]
	if st.Orders > 0 {
		st.AvgOrderCents = st.RevenueCents / int64(st.Orders)
	}
	for _, s := range m.stock {
		if s.Available() <= s.LowStockAt {
			st.LowStock++
		}
	}
	return st, nil
}

// countsAsSale: paid and everything after it, except orders that were fully undone.
func countsAsSale(status string) bool {
	switch status {
	case StatusPaid, StatusProcessing, StatusShipped, StatusDelivered:
		return true
	}
	return false
}
