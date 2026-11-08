// Package order is order-service: carts, checkout, stock, orders and coupons.
package order

import (
	"time"
)

// Product is order-service's own copy of what it needs from the catalog, one per SKU,
// kept up to date from product.updated events. Checkout reads this copy, so customers
// can still pay while the PHP catalog service is down or being deployed.
type Product struct {
	SKU        string            `bson:"_id" json:"sku"`
	ProductID  string            `bson:"productId" json:"productId"`
	Slug       string            `bson:"slug" json:"slug"`
	Name       string            `bson:"name" json:"name"`
	Options    map[string]string `bson:"options" json:"options"`
	PriceCents int64             `bson:"priceCents" json:"priceCents"`
	Image      string            `bson:"image" json:"image"`
	Active     bool              `bson:"active" json:"active"`
	UpdatedAt  time.Time         `bson:"updatedAt" json:"updatedAt"`
}

// Stock separates what is on the shelf from what is promised to unpaid checkouts.
// Available = OnHand - Reserved is what a new customer can buy.
type Stock struct {
	SKU        string    `bson:"_id" json:"sku"`
	OnHand     int       `bson:"onHand" json:"onHand"`
	Reserved   int       `bson:"reserved" json:"reserved"`
	LowStockAt int       `bson:"lowStockAt" json:"lowStockAt"`
	UpdatedAt  time.Time `bson:"updatedAt" json:"updatedAt"`
}

func (s Stock) Available() int { return s.OnHand - s.Reserved }

// Line is a SKU and a quantity: a cart line, or the stock movement for an order line.
type Line struct {
	SKU string `bson:"sku" json:"sku"`
	Qty int    `bson:"qty" json:"qty"`
}

// Cart belongs to an owner: "u:<userId>" for signed-in shoppers, "g:<guestId>" for guests.
type Cart struct {
	Owner     string    `bson:"_id"`
	Lines     []Line    `bson:"lines"`
	UpdatedAt time.Time `bson:"updatedAt"`
	ExpiresAt time.Time `bson:"expiresAt"` // TTL index: abandoned carts clean themselves up
}

type Address struct {
	Name       string `bson:"name" json:"name"`
	Line1      string `bson:"line1" json:"line1"`
	Line2      string `bson:"line2" json:"line2"`
	City       string `bson:"city" json:"city"`
	Province   string `bson:"province" json:"province"`
	PostalCode string `bson:"postalCode" json:"postalCode"`
	Country    string `bson:"country" json:"country"`
	Phone      string `bson:"phone" json:"phone"`
}

// OrderLine is a snapshot taken at checkout. Later price or name changes in the
// catalog never rewrite what a customer actually bought.
type OrderLine struct {
	SKU            string            `bson:"sku" json:"sku"`
	ProductID      string            `bson:"productId" json:"productId"`
	Slug           string            `bson:"slug" json:"slug"`
	Name           string            `bson:"name" json:"name"`
	Options        map[string]string `bson:"options" json:"options"`
	Image          string            `bson:"image" json:"image"`
	UnitPriceCents int64             `bson:"unitPriceCents" json:"unitPriceCents"`
	Qty            int               `bson:"qty" json:"qty"`
	LineTotalCents int64             `bson:"lineTotalCents" json:"lineTotalCents"`
}

// Totals are integers in cents. Floating point can't represent 0.10 exactly, and
// money that drifts by a cent across thousands of orders is a real accounting problem.
type Totals struct {
	SubtotalCents int64  `bson:"subtotalCents" json:"subtotalCents"`
	DiscountCents int64  `bson:"discountCents" json:"discountCents"`
	ShippingCents int64  `bson:"shippingCents" json:"shippingCents"`
	TaxCents      int64  `bson:"taxCents" json:"taxCents"`
	TaxLabel      string `bson:"taxLabel" json:"taxLabel"`
	TotalCents    int64  `bson:"totalCents" json:"totalCents"`
}

type StatusChange struct {
	Status string    `bson:"status" json:"status"`
	At     time.Time `bson:"at" json:"at"`
	Note   string    `bson:"note,omitempty" json:"note,omitempty"`
}

type Order struct {
	ID              string         `bson:"_id" json:"id"`
	Number          string         `bson:"number" json:"number"`
	Owner           string         `bson:"owner" json:"-"`
	UserID          string         `bson:"userId,omitempty" json:"userId,omitempty"`
	Email           string         `bson:"email" json:"email"`
	GuestKeyHash    string         `bson:"guestKeyHash,omitempty" json:"-"`
	Lines           []OrderLine    `bson:"lines" json:"lines"`
	Totals          Totals         `bson:"totals" json:"totals"`
	Currency        string         `bson:"currency" json:"currency"`
	CouponCode      string         `bson:"couponCode,omitempty" json:"couponCode,omitempty"`
	ShippingAddress Address        `bson:"shippingAddress" json:"shippingAddress"`
	Status          string         `bson:"status" json:"status"`
	History         []StatusChange `bson:"history" json:"history"`
	PaymentID       string         `bson:"paymentId,omitempty" json:"paymentId,omitempty"`
	RefundedCents   int64          `bson:"refundedCents" json:"refundedCents"`
	Tracking        string         `bson:"tracking,omitempty" json:"tracking,omitempty"`
	ReservedUntil   time.Time      `bson:"reservedUntil" json:"reservedUntil"`
	CreatedAt       time.Time      `bson:"createdAt" json:"createdAt"`
	UpdatedAt       time.Time      `bson:"updatedAt" json:"updatedAt"`
}

// Lines returns the stock movement this order represents.
func (o *Order) StockLines() []Line {
	out := make([]Line, len(o.Lines))
	for i, l := range o.Lines {
		out[i] = Line{SKU: l.SKU, Qty: l.Qty}
	}
	return out
}

type Coupon struct {
	Code             string     `bson:"_id" json:"code"`
	PercentOff       int        `bson:"percentOff" json:"percentOff"`
	AmountOffCents   int64      `bson:"amountOffCents" json:"amountOffCents"`
	MinSubtotalCents int64      `bson:"minSubtotalCents" json:"minSubtotalCents"`
	MaxUses          int        `bson:"maxUses" json:"maxUses"` // 0 = unlimited
	Uses             int        `bson:"uses" json:"uses"`
	Active           bool       `bson:"active" json:"active"`
	ExpiresAt        *time.Time `bson:"expiresAt,omitempty" json:"expiresAt,omitempty"`
}

type Stats struct {
	RevenueCents  int64        `json:"revenueCents"`
	Orders        int          `json:"orders"`
	AvgOrderCents int64        `json:"avgOrderCents"`
	ByDay         []DayStat    `json:"byDay"`
	TopProducts   []TopProduct `json:"topProducts"`
	LowStock      int          `json:"lowStock"`
	PendingOrders int          `json:"pendingOrders"`
}

type DayStat struct {
	Date         string `bson:"_id" json:"date"`
	RevenueCents int64  `bson:"revenueCents" json:"revenueCents"`
	Orders       int    `bson:"orders" json:"orders"`
}

type TopProduct struct {
	SKU          string `bson:"_id" json:"sku"`
	Name         string `bson:"name" json:"name"`
	Qty          int    `bson:"qty" json:"qty"`
	RevenueCents int64  `bson:"revenueCents" json:"revenueCents"`
}
