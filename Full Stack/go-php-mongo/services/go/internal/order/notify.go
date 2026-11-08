package order

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"

	"shop/internal/platform/events"
	"shop/internal/platform/mail"
)

// Notifier emails customers. It reacts to order-service's own events instead of being
// called inline from checkout, so a slow or failing mail server can never fail or
// slow down a payment, and a failed email is retried by the broker.
type Notifier struct {
	Store  Store
	Mail   mail.Sender
	AppURL string
}

type orderEvent struct {
	OrderID  string `json:"orderId"`
	Number   string `json:"number"`
	Email    string `json:"email"`
	Tracking string `json:"tracking"`
	Refund   bool   `json:"refund"`
}

func (n *Notifier) OnPlaced(ctx context.Context, ev events.Event) error {
	var d orderEvent
	if !decode(ev, &d) {
		return nil
	}
	o, err := n.Store.Order(ctx, d.OrderID)
	if err != nil {
		return skipMissing(err, ev)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Thanks for your order! Here's what you bought.\n\nOrder %s\n\n", o.Number)
	for _, l := range o.Lines {
		fmt.Fprintf(&b, "  %d x %s%s  %s\n", l.Qty, l.Name, optionText(l.Options), money(l.LineTotalCents))
	}
	t := o.Totals
	fmt.Fprintf(&b, "\nSubtotal  %s\n", money(t.SubtotalCents))
	if t.DiscountCents > 0 {
		fmt.Fprintf(&b, "Discount  -%s (%s)\n", money(t.DiscountCents), o.CouponCode)
	}
	fmt.Fprintf(&b, "Shipping  %s\n%s  %s\nTotal     %s CAD\n", money(t.ShippingCents), t.TaxLabel, money(t.TaxCents), money(t.TotalCents))
	a := o.ShippingAddress
	fmt.Fprintf(&b, "\nShipping to:\n%s\n%s %s\n%s, %s %s\n", a.Name, a.Line1, a.Line2, a.City, a.Province, a.PostalCode)
	fmt.Fprintf(&b, "\nTrack it any time: %s/orders/%s\n", n.AppURL, o.ID)
	return n.Mail.Send(o.Email, "Order "+o.Number+" confirmed", b.String())
}

func (n *Notifier) OnShipped(_ context.Context, ev events.Event) error {
	var d orderEvent
	if !decode(ev, &d) || d.Email == "" {
		return nil
	}
	return n.Mail.Send(d.Email, "Order "+d.Number+" has shipped",
		fmt.Sprintf("Good news: order %s is on its way.\n\nTracking number: %s\n\n%s/orders/%s\n", d.Number, d.Tracking, n.AppURL, d.OrderID))
}

func (n *Notifier) OnCancelled(_ context.Context, ev events.Event) error {
	var d orderEvent
	if !decode(ev, &d) || d.Email == "" {
		return nil
	}
	body := fmt.Sprintf("Order %s has been cancelled.\n", d.Number)
	if d.Refund {
		body += "\nYour payment is being refunded to the original card. Refunds usually appear within 5 to 10 business days.\n"
	}
	return n.Mail.Send(d.Email, "Order "+d.Number+" cancelled", body)
}

func optionText(o map[string]string) string {
	if len(o) == 0 {
		return ""
	}
	parts := make([]string, 0, len(o))
	for _, k := range slices.Sorted(maps.Keys(o)) { // maps iterate randomly; emails shouldn't
		parts = append(parts, k+": "+o[k])
	}
	return " (" + strings.Join(parts, ", ") + ")"
}
