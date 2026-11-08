package httpx

import (
	"context"
	"crypto/subtle"
	"net/http"
	"slices"
	"strings"
	"time"

	"shop/internal/platform/token"
)

// Principal is the signed-in user, taken from a verified access token.
type Principal struct {
	UserID string
	Email  string
	Roles  []string
}

// Has reports whether the user holds role. Admin implies staff.
func (p *Principal) Has(role string) bool {
	if p == nil {
		return false
	}
	if slices.Contains(p.Roles, role) {
		return true
	}
	return role == "staff" && slices.Contains(p.Roles, "admin")
}

// CurrentUser returns the principal, or nil for an anonymous request.
func CurrentUser(ctx context.Context) *Principal {
	p, _ := ctx.Value(principalKey).(*Principal)
	return p
}

// WithPrincipal is used by tests to act as a user without a token.
func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey, p)
}

// Authenticate reads "Authorization: Bearer <jwt>". No header means anonymous (guests can
// shop); a header with a bad or expired token is a 401, so the client knows to refresh.
func Authenticate(v *token.Verifier, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if h == "" {
			next.ServeHTTP(w, r)
			return
		}
		raw, ok := strings.CutPrefix(h, "Bearer ")
		if !ok {
			Fail(w, r, Unauthorized("expected a Bearer token"))
			return
		}
		c, err := v.Verify(raw, time.Now())
		if err != nil {
			Fail(w, r, &Error{Status: 401, Code: "invalid_token", Message: err.Error()})
			return
		}
		p := &Principal{UserID: c.Subject, Email: c.Email, Roles: c.Roles}
		next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
	})
}

// RequireUser rejects anonymous requests.
func RequireUser(h HandlerFunc) HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		if CurrentUser(r.Context()) == nil {
			return Unauthorized("sign in required")
		}
		return h(w, r)
	}
}

// RequireRole rejects users without role. Each service checks roles itself rather
// than trusting the gateway: defence in depth if a port is ever exposed by mistake.
func RequireRole(role string, h HandlerFunc) HandlerFunc {
	return RequireUser(func(w http.ResponseWriter, r *http.Request) error {
		if !CurrentUser(r.Context()).Has(role) {
			return Forbidden()
		}
		return h(w, r)
	})
}

// RequireInternal guards service-to-service endpoints with a shared secret header.
// These routes are also never forwarded by the gateway.
func RequireInternal(secret string, h HandlerFunc) HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		got := r.Header.Get("X-Internal-Token")
		if secret == "" || subtle.ConstantTimeCompare([]byte(got), []byte(secret)) != 1 {
			return Forbidden()
		}
		return h(w, r)
	}
}
