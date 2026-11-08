package auth

import (
	"net/http"
	"time"

	"shop/internal/platform/httpx"
)

const refreshCookie = "refresh_token"

// Handlers maps HTTP routes to the Service.
type Handlers struct {
	Svc          *Service
	SecureCookie bool // true behind HTTPS; false for http://localhost
}

// Routes registers every endpoint. Paths include the /api/v1 prefix the gateway forwards.
func (h *Handlers) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/register", httpx.Handle(h.register))
	mux.HandleFunc("POST /api/v1/auth/login", httpx.Handle(h.login))
	mux.HandleFunc("POST /api/v1/auth/refresh", httpx.Handle(h.refresh))
	mux.HandleFunc("POST /api/v1/auth/logout", httpx.Handle(h.logout))
	mux.HandleFunc("POST /api/v1/auth/forgot-password", httpx.Handle(h.forgot))
	mux.HandleFunc("POST /api/v1/auth/reset-password", httpx.Handle(h.reset))

	mux.HandleFunc("GET /api/v1/me", httpx.Handle(httpx.RequireUser(h.me)))
	mux.HandleFunc("PATCH /api/v1/me", httpx.Handle(httpx.RequireUser(h.updateMe)))
	mux.HandleFunc("POST /api/v1/me/password", httpx.Handle(httpx.RequireUser(h.changePassword)))
	mux.HandleFunc("POST /api/v1/me/addresses", httpx.Handle(httpx.RequireUser(h.addAddress)))
	mux.HandleFunc("DELETE /api/v1/me/addresses/{id}", httpx.Handle(httpx.RequireUser(h.deleteAddress)))

	mux.HandleFunc("GET /api/v1/admin/users", httpx.Handle(httpx.RequireRole("admin", h.listUsers)))
	mux.HandleFunc("PUT /api/v1/admin/users/{id}/roles", httpx.Handle(httpx.RequireRole("admin", h.setRoles)))
}

func (h *Handlers) register(w http.ResponseWriter, r *http.Request) error {
	var in struct{ Email, Password, Name string }
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	s, err := h.Svc.Register(r.Context(), in.Email, in.Password, in.Name)
	if err != nil {
		return err
	}
	h.writeSession(w, s, http.StatusCreated)
	return nil
}

func (h *Handlers) login(w http.ResponseWriter, r *http.Request) error {
	var in struct{ Email, Password string }
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	s, err := h.Svc.Login(r.Context(), in.Email, in.Password)
	if err != nil {
		return err
	}
	h.writeSession(w, s, http.StatusOK)
	return nil
}

func (h *Handlers) refresh(w http.ResponseWriter, r *http.Request) error {
	s, err := h.Svc.Refresh(r.Context(), cookieValue(r))
	if err != nil {
		h.clearCookie(w) // a dead cookie would only fail again on the next page load
		return err
	}
	h.writeSession(w, s, http.StatusOK)
	return nil
}

func (h *Handlers) logout(w http.ResponseWriter, r *http.Request) error {
	if err := h.Svc.Logout(r.Context(), cookieValue(r)); err != nil {
		return err
	}
	h.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handlers) forgot(w http.ResponseWriter, r *http.Request) error {
	var in struct{ Email string }
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if err := h.Svc.ForgotPassword(r.Context(), in.Email); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusAccepted, map[string]string{"message": "if that email has an account, a reset link is on its way"})
	return nil
}

func (h *Handlers) reset(w http.ResponseWriter, r *http.Request) error {
	var in struct{ Token, Password string }
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if err := h.Svc.ResetPassword(r.Context(), in.Token, in.Password); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handlers) me(w http.ResponseWriter, r *http.Request) error {
	u, err := h.Svc.Me(r.Context(), httpx.CurrentUser(r.Context()).UserID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, u)
	return nil
}

func (h *Handlers) updateMe(w http.ResponseWriter, r *http.Request) error {
	var in struct{ Name string }
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	u, err := h.Svc.UpdateProfile(r.Context(), httpx.CurrentUser(r.Context()).UserID, in.Name)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, u)
	return nil
}

func (h *Handlers) changePassword(w http.ResponseWriter, r *http.Request) error {
	var in struct{ CurrentPassword, NewPassword string }
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if err := h.Svc.ChangePassword(r.Context(), httpx.CurrentUser(r.Context()).UserID, in.CurrentPassword, in.NewPassword); err != nil {
		return err
	}
	h.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handlers) addAddress(w http.ResponseWriter, r *http.Request) error {
	var in Address
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	u, err := h.Svc.AddAddress(r.Context(), httpx.CurrentUser(r.Context()).UserID, in)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, u)
	return nil
}

func (h *Handlers) deleteAddress(w http.ResponseWriter, r *http.Request) error {
	u, err := h.Svc.DeleteAddress(r.Context(), httpx.CurrentUser(r.Context()).UserID, r.PathValue("id"))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, u)
	return nil
}

func (h *Handlers) listUsers(w http.ResponseWriter, r *http.Request) error {
	users, err := h.Svc.ListUsers(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": users})
	return nil
}

func (h *Handlers) setRoles(w http.ResponseWriter, r *http.Request) error {
	var in struct{ Roles []string }
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	u, err := h.Svc.SetRoles(r.Context(), httpx.CurrentUser(r.Context()), r.PathValue("id"), in.Roles)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, u)
	return nil
}

// writeSession sends the access token in JSON and the refresh token as a cookie scoped
// to /api/v1/auth: the browser only sends it to the refresh and logout endpoints, and
// JavaScript can never read it (httpOnly), so an XSS bug can't steal the long-lived session.
func (h *Handlers) writeSession(w http.ResponseWriter, s *Session, status int) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookie, Value: s.RefreshToken, Path: "/api/v1/auth",
		Expires: s.RefreshUntil, HttpOnly: true, Secure: h.SecureCookie, SameSite: http.SameSiteStrictMode,
	})
	httpx.JSON(w, status, s)
}

func (h *Handlers) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookie, Value: "", Path: "/api/v1/auth", Expires: time.Unix(0, 0), MaxAge: -1,
		HttpOnly: true, Secure: h.SecureCookie, SameSite: http.SameSiteStrictMode,
	})
}

func cookieValue(r *http.Request) string {
	c, err := r.Cookie(refreshCookie)
	if err != nil {
		return ""
	}
	return c.Value
}
