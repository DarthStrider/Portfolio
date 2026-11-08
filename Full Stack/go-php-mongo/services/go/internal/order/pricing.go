package order

import (
	"fmt"
	"strings"
	"time"
)

// Tax is a sales tax rate in thousandths of a percent (13% = 13000), so Quebec's
// 14.975% is the exact integer 14975 and no float ever touches money.
type Tax struct {
	Rate  int64
	Label string
}

// TaxRates are the combined federal + provincial rates by province. They change from
// time to time (Nova Scotia's HST went from 15% to 14% in April 2025), so they live in
// one table and a real store would load them from configuration or a tax service.
var TaxRates = map[string]Tax{
	"AB": {5000, "GST 5%"},
	"BC": {12000, "GST 5% + PST 7%"},
	"MB": {12000, "GST 5% + RST 7%"},
	"NB": {15000, "HST 15%"},
	"NL": {15000, "HST 15%"},
	"NS": {14000, "HST 14%"},
	"NT": {5000, "GST 5%"},
	"NU": {5000, "GST 5%"},
	"ON": {13000, "HST 13%"},
	"PE": {15000, "HST 15%"},
	"QC": {14975, "GST 5% + QST 9.975%"},
	"SK": {11000, "GST 5% + PST 6%"},
	"YT": {5000, "GST 5%"},
}

const (
	FlatShippingCents     = 999
	FreeShippingOverCents = 7500
)

// pctOf returns amount * rate / 100000, rounded half up.
func pctOf(amount, rate int64) int64 {
	return (amount*rate + 50_000) / 100_000
}

// CouponError explains why a coupon can't be used, in words a shopper understands.
type CouponError struct{ Reason string }

func (e *CouponError) Error() string { return e.Reason }

// Discount returns what c takes off subtotal, or why it doesn't apply.
func (c *Coupon) Discount(subtotal int64, now time.Time) (int64, error) {
	switch {
	case c == nil || !c.Active:
		return 0, &CouponError{"this code isn't valid"}
	case c.ExpiresAt != nil && now.After(*c.ExpiresAt):
		return 0, &CouponError{"this code has expired"}
	case c.MaxUses > 0 && c.Uses >= c.MaxUses:
		return 0, &CouponError{"this code has been fully redeemed"}
	case subtotal < c.MinSubtotalCents:
		return 0, &CouponError{fmt.Sprintf("spend $%.2f or more to use this code", float64(c.MinSubtotalCents)/100)}
	}
	var d int64
	if c.PercentOff > 0 {
		d = (subtotal*int64(c.PercentOff) + 50) / 100
	} else {
		d = c.AmountOffCents
	}
	return min(d, subtotal), nil
}

// Quote prices a set of order lines. Order matters and matches how Canadian retailers
// charge: discount first, then shipping (free above the threshold, judged after the
// discount), then tax on the discounted goods plus shipping, since shipping is taxable.
func Quote(lines []OrderLine, coupon *Coupon, province string, now time.Time) (Totals, error) {
	var t Totals
	for _, l := range lines {
		t.SubtotalCents += l.LineTotalCents
	}
	if coupon != nil {
		d, err := coupon.Discount(t.SubtotalCents, now)
		if err != nil {
			return t, err
		}
		t.DiscountCents = d
	}
	goods := t.SubtotalCents - t.DiscountCents
	if goods < FreeShippingOverCents && len(lines) > 0 {
		t.ShippingCents = FlatShippingCents
	}
	if tax, ok := TaxRates[strings.ToUpper(province)]; ok {
		t.TaxCents = pctOf(goods+t.ShippingCents, tax.Rate)
		t.TaxLabel = tax.Label
	}
	t.TotalCents = goods + t.ShippingCents + t.TaxCents
	return t, nil
}

// Order statuses and the moves allowed between them. Keeping this as data means the
// rules are in one place, are easy to test, and the admin UI can ask which buttons to show.
const (
	StatusPendingPayment = "pending_payment"
	StatusPaid           = "paid"
	StatusProcessing     = "processing"
	StatusShipped        = "shipped"
	StatusDelivered      = "delivered"
	StatusCancelled      = "cancelled"
	StatusRefunded       = "refunded"
)

var transitions = map[string][]string{
	StatusPendingPayment: {StatusPaid, StatusCancelled},
	StatusPaid:           {StatusProcessing, StatusShipped, StatusCancelled, StatusRefunded},
	StatusProcessing:     {StatusShipped, StatusCancelled, StatusRefunded},
	StatusShipped:        {StatusDelivered, StatusRefunded},
	StatusDelivered:      {StatusRefunded},
}

// CanMove reports whether an order may go from one status to another.
func CanMove(from, to string) bool {
	for _, s := range transitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

// NextStatuses lists the moves staff can make by hand. "paid" and "refunded" only ever
// come from payment events, never from a button.
func NextStatuses(from string) []string {
	var out []string
	for _, s := range transitions[from] {
		if s != StatusPaid && s != StatusRefunded {
			out = append(out, s)
		}
	}
	return out
}

// stockIsCommitted reports whether an order's stock has left the shelf (paid or later),
// as opposed to only being reserved. Cancelling has to undo the right one.
func stockIsCommitted(status string) bool {
	return status == StatusPaid || status == StatusProcessing
}
