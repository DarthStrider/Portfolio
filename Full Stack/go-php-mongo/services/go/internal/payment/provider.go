package payment

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"shop/internal/platform/id"
)

// Intent is the provider's handle for one attempt to collect money. The client secret
// goes to the browser, which completes the card step directly with the provider;
// card numbers never pass through this service.
type Intent struct {
	Ref          string
	ClientSecret string
}

// Provider is the seam between the store and a payment company.
type Provider interface {
	Name() string
	PublishableKey() string
	CreateIntent(ctx context.Context, amountCents int64, currency, orderID, idempotencyKey string) (Intent, error)
	Refund(ctx context.Context, ref string, amountCents int64, idempotencyKey string) (string, error)
}

// Mock is a stand-in provider so the whole store works with no Stripe account.
// The browser "pays" by calling /payments/mock/confirm, which plays the part of the
// provider's webhook.
type Mock struct{}

func (Mock) Name() string           { return "mock" }
func (Mock) PublishableKey() string { return "" }
func (Mock) CreateIntent(_ context.Context, _ int64, _, _, _ string) (Intent, error) {
	ref := id.New()
	return Intent{Ref: "mock_pi_" + ref, ClientSecret: "mock_secret_" + ref}, nil
}
func (Mock) Refund(_ context.Context, _ string, _ int64, _ string) (string, error) {
	return "mock_re_" + id.New(), nil
}

// Stripe talks to the Stripe REST API with net/http. The official stripe-go SDK would
// do the same; two endpoints don't justify the dependency, and calling the API directly
// shows exactly what goes over the wire.
type Stripe struct {
	SecretKey     string
	Publishable   string
	WebhookSecret string
	BaseURL       string // https://api.stripe.com; tests point it at a fake
	HTTP          *http.Client
}

func (s *Stripe) Name() string           { return "stripe" }
func (s *Stripe) PublishableKey() string { return s.Publishable }

func (s *Stripe) post(ctx context.Context, path string, form url.Values, idem string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.BaseURL+path, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.SecretKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	// Stripe's idempotency keys make retries safe: the same key returns the original
	// result instead of creating a second charge or refund.
	req.Header.Set("Idempotency-Key", idem)
	res, err := s.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		var e struct {
			Error struct{ Message string } `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		return fmt.Errorf("stripe %s: %d %s", path, res.StatusCode, e.Error.Message)
	}
	return json.Unmarshal(body, out)
}

func (s *Stripe) CreateIntent(ctx context.Context, amount int64, currency, orderID, idem string) (Intent, error) {
	form := url.Values{
		"amount":                             {strconv.FormatInt(amount, 10)},
		"currency":                           {strings.ToLower(currency)},
		"automatic_payment_methods[enabled]": {"true"},
		"metadata[order_id]":                 {orderID},
	}
	var out struct {
		ID           string `json:"id"`
		ClientSecret string `json:"client_secret"`
	}
	if err := s.post(ctx, "/v1/payment_intents", form, idem, &out); err != nil {
		return Intent{}, err
	}
	return Intent{Ref: out.ID, ClientSecret: out.ClientSecret}, nil
}

func (s *Stripe) Refund(ctx context.Context, ref string, amount int64, idem string) (string, error) {
	form := url.Values{"payment_intent": {ref}, "amount": {strconv.FormatInt(amount, 10)}}
	var out struct {
		ID string `json:"id"`
	}
	return out.ID, s.post(ctx, "/v1/refunds", form, idem, &out)
}

var ErrBadSignature = errors.New("webhook signature invalid")

// VerifyStripeSignature checks the Stripe-Signature header: "t=<unix>,v1=<hex hmac>".
// The HMAC-SHA256 covers "<t>.<raw body>", so both the body and the time are signed,
// and an old captured webhook can't be replayed after the tolerance window.
func VerifyStripeSignature(payload []byte, header, secret string, now time.Time, tolerance time.Duration) error {
	var ts int64
	var sigs [][]byte
	for _, part := range strings.Split(header, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch k {
		case "t":
			ts, _ = strconv.ParseInt(v, 10, 64)
		case "v1":
			if b, err := hex.DecodeString(v); err == nil {
				sigs = append(sigs, b)
			}
		}
	}
	if ts == 0 || len(sigs) == 0 {
		return ErrBadSignature
	}
	if d := now.Sub(time.Unix(ts, 0)); d > tolerance || d < -tolerance {
		return ErrBadSignature
	}
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d.", ts)
	mac.Write(payload)
	want := mac.Sum(nil)
	for _, s := range sigs { // during secret rotation Stripe sends one signature per secret
		if hmac.Equal(s, want) {
			return nil
		}
	}
	return ErrBadSignature
}

// SignStripePayload builds a valid header; used by tests and the local webhook tool.
func SignStripePayload(payload []byte, secret string, at time.Time) string {
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d.", at.Unix())
	mac.Write(payload)
	return fmt.Sprintf("t=%d,v1=%s", at.Unix(), hex.EncodeToString(mac.Sum(nil)))
}

// OrderInfo is order-service's answer to "what does this order cost, and whose is it?"
type OrderInfo struct {
	ID           string `json:"id"`
	Number       string `json:"number"`
	Status       string `json:"status"`
	TotalCents   int64  `json:"totalCents"`
	Currency     string `json:"currency"`
	UserID       string `json:"userId"`
	Email        string `json:"email"`
	GuestKeyHash string `json:"guestKeyHash"`
}

type OrderLookup interface {
	Order(ctx context.Context, id string) (*OrderInfo, error)
}

// OrderClient asks order-service over HTTP. This is the one synchronous call between
// services: the amount to charge must be current and authoritative at the moment the
// intent is created, so it can't come from an event that might not have arrived yet.
type OrderClient struct {
	BaseURL string
	Secret  string
	HTTP    *http.Client
}

func (c *OrderClient) Order(ctx context.Context, orderID string) (*OrderInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/internal/orders/"+url.PathEscape(orderID), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Internal-Token", c.Secret)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("order-service: status %d", res.StatusCode)
	}
	var o OrderInfo
	return &o, json.NewDecoder(res.Body).Decode(&o)
}
