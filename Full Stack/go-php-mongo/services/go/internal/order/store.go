package order

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"shop/internal/platform/events"
)

var (
	ErrNotFound = errors.New("not found")
	// ErrStatus means the order wasn't in a status the update allowed: someone else
	// (a webhook, the expiry sweeper, another admin) changed it first.
	ErrStatus = errors.New("order status changed")
)

// ErrInsufficient lists SKUs that don't have enough available stock.
type ErrInsufficient struct{ SKUs []string }

func (e *ErrInsufficient) Error() string {
	return fmt.Sprintf("not enough stock for %s", strings.Join(e.SKUs, ", "))
}

// StatusUpdate is a compare-and-set on an order's status: it only applies when the
// order is currently in one of From.
type StatusUpdate struct {
	From        []string
	To          string
	Note        string
	At          time.Time
	PaymentID   string // set when To is paid
	Tracking    string // set when To is shipped
	AddRefunded int64  // added to refundedCents
	KeepStatus  bool   // partial refund: record money, leave status alone
}

type OrderQuery struct {
	UserID string
	Status string
	Search string // order number or email
	Limit  int
	Skip   int
}

// Store is order-service's persistence. Tx runs fn atomically: MongoStore uses a
// multi-document transaction, MemStore a lock.
type Store interface {
	Tx(ctx context.Context, fn func(ctx context.Context) error) error

	UpsertProduct(ctx context.Context, p Product) error
	Products(ctx context.Context, skus []string) (map[string]Product, error)
	// DeactivateProduct marks a product's SKUs inactive, except those in keep.
	DeactivateProduct(ctx context.Context, productID string, keep []string) error

	// EnsureStock creates a stock record if the SKU has none yet.
	EnsureStock(ctx context.Context, sku string, initial, lowAt int) (bool, error)
	Stock(ctx context.Context, skus []string) (map[string]Stock, error)
	ListStock(ctx context.Context) ([]Stock, error)
	AdjustStock(ctx context.Context, sku string, delta int) (Stock, error)
	// Reserve moves qty from available to reserved for every line, or for none.
	Reserve(ctx context.Context, lines []Line) error
	Release(ctx context.Context, lines []Line) error // reserved -= qty
	Commit(ctx context.Context, lines []Line) error  // onHand -= qty, reserved -= qty
	Restock(ctx context.Context, lines []Line) error // onHand += qty

	Cart(ctx context.Context, owner string) (Cart, error)
	SaveCart(ctx context.Context, c Cart) error
	DeleteCart(ctx context.Context, owner string) error

	NextOrderNumber(ctx context.Context) (int64, error)
	InsertOrder(ctx context.Context, o *Order) error
	Order(ctx context.Context, id string) (*Order, error)
	UpdateStatus(ctx context.Context, id string, u StatusUpdate) (*Order, error)
	ListOrders(ctx context.Context, q OrderQuery) ([]Order, int, error)
	PendingOrders(ctx context.Context, owner string) ([]Order, error)
	ExpiredPending(ctx context.Context, before time.Time, limit int) ([]Order, error)

	Coupon(ctx context.Context, code string) (*Coupon, error)
	SaveCoupon(ctx context.Context, c Coupon) error
	ListCoupons(ctx context.Context) ([]Coupon, error)
	UseCoupon(ctx context.Context, code string) error

	AddEvents(ctx context.Context, evs ...events.Event) error
	Stats(ctx context.Context, since time.Time) (Stats, error)
}
