package payment

import (
	"io"
	"net/http"

	"shop/internal/platform/httpx"
)

type Handlers struct{ Svc *Service }

func (h *Handlers) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/payments/config", httpx.Handle(h.config))
	mux.HandleFunc("POST /api/v1/payments/intent", httpx.Handle(h.intent))
	mux.HandleFunc("GET /api/v1/payments/{id}", httpx.Handle(h.status))
	mux.HandleFunc("POST /api/v1/payments/mock/confirm", httpx.Handle(h.mockConfirm))
	mux.HandleFunc("POST /api/v1/payments/webhook", httpx.Handle(h.webhook))

	mux.HandleFunc("GET /api/v1/admin/payments", httpx.Handle(httpx.RequireRole("staff", h.list)))
	mux.HandleFunc("POST /api/v1/admin/payments/refund", httpx.Handle(httpx.RequireRole("admin", h.refund)))
}

func (h *Handlers) config(w http.ResponseWriter, _ *http.Request) error {
	httpx.JSON(w, http.StatusOK, map[string]string{
		"provider": h.Svc.Provider.Name(), "publishableKey": h.Svc.Provider.PublishableKey()})
	return nil
}

func (h *Handlers) intent(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		OrderID  string `json:"orderId"`
		GuestKey string `json:"guestKey"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	v, err := h.Svc.CreateIntent(r.Context(), httpx.CurrentUser(r.Context()), in.OrderID, in.GuestKey)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, v)
	return nil
}

func (h *Handlers) status(w http.ResponseWriter, r *http.Request) error {
	p, err := h.Svc.Status(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"id": p.ID, "status": p.Status, "failureReason": p.FailureReason})
	return nil
}

func (h *Handlers) mockConfirm(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		PaymentID string `json:"paymentId"`
		Outcome   string `json:"outcome"` // "succeed" or "fail"
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	p, err := h.Svc.MockConfirm(r.Context(), in.PaymentID, in.Outcome != "fail")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"id": p.ID, "status": p.Status, "failureReason": p.FailureReason})
	return nil
}

// webhook must read the raw bytes: the signature covers the exact body, and decoding
// then re-encoding JSON would change it.
func (h *Handlers) webhook(w http.ResponseWriter, r *http.Request) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 256<<10))
	if err != nil {
		return httpx.BadRequest("unreadable body")
	}
	if err := h.Svc.StripeWebhook(r.Context(), body, r.Header.Get("Stripe-Signature")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusOK)
	return nil
}

func (h *Handlers) list(w http.ResponseWriter, r *http.Request) error {
	list, err := h.Svc.List(r.Context(), r.URL.Query().Get("orderId"))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": list})
	return nil
}

func (h *Handlers) refund(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		OrderID     string `json:"orderId"`
		AmountCents int64  `json:"amountCents"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	p, err := h.Svc.Refund(r.Context(), in.OrderID, in.AmountCents)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, p)
	return nil
}
