package order

import (
	"net/http"
	"strconv"
	"time"

	"shop/internal/platform/httpx"
	"shop/internal/platform/id"
)

const guestCookie = "guest_id"

type Handlers struct {
	Svc            *Service
	InternalSecret string
	SecureCookie   bool
}

func (h *Handlers) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/cart", httpx.Handle(h.getCart))
	mux.HandleFunc("POST /api/v1/cart/items", httpx.Handle(h.addItem))
	mux.HandleFunc("PATCH /api/v1/cart/items/{sku}", httpx.Handle(h.setQty))
	mux.HandleFunc("DELETE /api/v1/cart/items/{sku}", httpx.Handle(h.removeItem))
	mux.HandleFunc("POST /api/v1/cart/merge", httpx.Handle(httpx.RequireUser(h.merge)))

	mux.HandleFunc("GET /api/v1/checkout/quote", httpx.Handle(h.quote))
	mux.HandleFunc("POST /api/v1/checkout", httpx.Handle(h.checkout))

	mux.HandleFunc("GET /api/v1/orders", httpx.Handle(httpx.RequireUser(h.myOrders)))
	mux.HandleFunc("GET /api/v1/orders/{id}", httpx.Handle(h.getOrder))

	mux.HandleFunc("GET /api/v1/admin/orders", httpx.Handle(httpx.RequireRole("staff", h.adminOrders)))
	mux.HandleFunc("GET /api/v1/admin/orders/{id}", httpx.Handle(httpx.RequireRole("staff", h.adminOrder)))
	mux.HandleFunc("POST /api/v1/admin/orders/{id}/status", httpx.Handle(httpx.RequireRole("staff", h.adminSetStatus)))
	mux.HandleFunc("GET /api/v1/admin/inventory", httpx.Handle(httpx.RequireRole("staff", h.inventory)))
	mux.HandleFunc("POST /api/v1/admin/inventory/{sku}/adjust", httpx.Handle(httpx.RequireRole("staff", h.adjust)))
	mux.HandleFunc("GET /api/v1/admin/coupons", httpx.Handle(httpx.RequireRole("staff", h.coupons)))
	mux.HandleFunc("PUT /api/v1/admin/coupons", httpx.Handle(httpx.RequireRole("admin", h.saveCoupon)))
	mux.HandleFunc("GET /api/v1/admin/stats", httpx.Handle(httpx.RequireRole("staff", h.stats)))

	// Called by payment-service only; the gateway has no route to /internal.
	mux.HandleFunc("GET /internal/orders/{id}", httpx.Handle(httpx.RequireInternal(h.InternalSecret, h.internalOrder)))
}

// owner identifies whose cart this request is about. Signed-in users own "u:<id>".
// Guests get a random ID in an httpOnly cookie, created on first use, which is how
// shopping works before (or without) an account.
func (h *Handlers) owner(w http.ResponseWriter, r *http.Request) string {
	if p := httpx.CurrentUser(r.Context()); p != nil {
		return "u:" + p.UserID
	}
	if c, err := r.Cookie(guestCookie); err == nil && len(c.Value) == 24 {
		return "g:" + c.Value
	}
	gid := id.New()
	http.SetCookie(w, &http.Cookie{Name: guestCookie, Value: gid, Path: "/api/v1",
		Expires: time.Now().Add(CartTTL), HttpOnly: true, Secure: h.SecureCookie, SameSite: http.SameSiteLaxMode})
	return "g:" + gid
}

func (h *Handlers) getCart(w http.ResponseWriter, r *http.Request) error {
	v, err := h.Svc.GetCart(r.Context(), h.owner(w, r))
	return reply(w, http.StatusOK, v, err)
}

func (h *Handlers) addItem(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		SKU string `json:"sku"`
		Qty int    `json:"qty"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	v, err := h.Svc.AddToCart(r.Context(), h.owner(w, r), in.SKU, in.Qty)
	return reply(w, http.StatusOK, v, err)
}

func (h *Handlers) setQty(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Qty int `json:"qty"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	v, err := h.Svc.SetCartQty(r.Context(), h.owner(w, r), r.PathValue("sku"), in.Qty)
	return reply(w, http.StatusOK, v, err)
}

func (h *Handlers) removeItem(w http.ResponseWriter, r *http.Request) error {
	v, err := h.Svc.SetCartQty(r.Context(), h.owner(w, r), r.PathValue("sku"), 0)
	return reply(w, http.StatusOK, v, err)
}

// merge is called by the app right after sign-in: the guest cart (from the cookie)
// joins the user's cart, and the guest cookie is cleared.
func (h *Handlers) merge(w http.ResponseWriter, r *http.Request) error {
	guest := ""
	if c, err := r.Cookie(guestCookie); err == nil && c.Value != "" {
		guest = "g:" + c.Value
	}
	v, err := h.Svc.MergeCarts(r.Context(), guest, "u:"+httpx.CurrentUser(r.Context()).UserID)
	if err == nil {
		http.SetCookie(w, &http.Cookie{Name: guestCookie, Value: "", Path: "/api/v1", MaxAge: -1,
			HttpOnly: true, Secure: h.SecureCookie, SameSite: http.SameSiteLaxMode})
	}
	return reply(w, http.StatusOK, v, err)
}

func (h *Handlers) quote(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	v, err := h.Svc.Quote(r.Context(), h.owner(w, r), q.Get("province"), q.Get("coupon"))
	return reply(w, http.StatusOK, v, err)
}

func (h *Handlers) checkout(w http.ResponseWriter, r *http.Request) error {
	var in CheckoutInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	o, key, err := h.Svc.Checkout(r.Context(), h.owner(w, r), httpx.CurrentUser(r.Context()), in)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"order": o, "guestKey": key})
	return nil
}

func (h *Handlers) myOrders(w http.ResponseWriter, r *http.Request) error {
	list, err := h.Svc.MyOrders(r.Context(), httpx.CurrentUser(r.Context()).UserID)
	return reply(w, http.StatusOK, map[string]any{"items": list}, err)
}

func (h *Handlers) getOrder(w http.ResponseWriter, r *http.Request) error {
	o, err := h.Svc.OrderFor(r.Context(), r.PathValue("id"), httpx.CurrentUser(r.Context()), r.URL.Query().Get("key"))
	return reply(w, http.StatusOK, o, err)
}

func (h *Handlers) adminOrders(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	page = max(page, 1)
	const per = 25
	list, total, err := h.Svc.AdminOrders(r.Context(), OrderQuery{Status: q.Get("status"), Search: q.Get("q"),
		Limit: per, Skip: (page - 1) * per})
	return reply(w, http.StatusOK, map[string]any{"items": list, "total": total, "page": page, "perPage": per}, err)
}

func (h *Handlers) adminOrder(w http.ResponseWriter, r *http.Request) error {
	o, err := h.Svc.AdminOrder(r.Context(), r.PathValue("id"))
	return reply(w, http.StatusOK, o, err)
}

func (h *Handlers) adminSetStatus(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Status   string `json:"status"`
		Tracking string `json:"tracking"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	o, err := h.Svc.SetStatus(r.Context(), r.PathValue("id"), in.Status, in.Tracking)
	return reply(w, http.StatusOK, o, err)
}

func (h *Handlers) inventory(w http.ResponseWriter, r *http.Request) error {
	list, err := h.Svc.Inventory(r.Context(), r.URL.Query().Get("low") == "1")
	return reply(w, http.StatusOK, map[string]any{"items": list}, err)
}

func (h *Handlers) adjust(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Delta int `json:"delta"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	st, err := h.Svc.AdjustStock(r.Context(), r.PathValue("sku"), in.Delta)
	return reply(w, http.StatusOK, st, err)
}

func (h *Handlers) coupons(w http.ResponseWriter, r *http.Request) error {
	list, err := h.Svc.Coupons(r.Context())
	return reply(w, http.StatusOK, map[string]any{"items": list}, err)
}

func (h *Handlers) saveCoupon(w http.ResponseWriter, r *http.Request) error {
	var in Coupon
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	c, err := h.Svc.SaveCoupon(r.Context(), in)
	return reply(w, http.StatusOK, c, err)
}

func (h *Handlers) stats(w http.ResponseWriter, r *http.Request) error {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days == 0 {
		days = 14
	}
	st, err := h.Svc.Stats(r.Context(), days)
	return reply(w, http.StatusOK, st, err)
}

func (h *Handlers) internalOrder(w http.ResponseWriter, r *http.Request) error {
	o, err := h.Svc.Internal(r.Context(), r.PathValue("id"))
	return reply(w, http.StatusOK, o, err)
}

func reply(w http.ResponseWriter, status int, v any, err error) error {
	if err != nil {
		return err
	}
	httpx.JSON(w, status, v)
	return nil
}
