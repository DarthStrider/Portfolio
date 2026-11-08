package auth

import (
	"context"
	"errors"
	"net/mail"
	"slices"
	"strings"
	"time"

	"shop/internal/platform/httpx"
	"shop/internal/platform/id"
	mailer "shop/internal/platform/mail"
	"shop/internal/platform/token"
)

// Service holds auth-service's rules. Handlers only translate HTTP to these calls.
type Service struct {
	Store      Store
	Signer     *token.Signer
	Mail       mailer.Sender
	AppURL     string // used in password reset links
	AccessTTL  time.Duration
	RefreshTTL time.Duration
	Now        func() time.Time
}

// Session is what a successful sign-in returns: the access token goes in the JSON body
// (React keeps it in memory), the refresh token goes in an httpOnly cookie.
type Session struct {
	AccessToken  string    `json:"accessToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
	User         *User     `json:"user"`
	RefreshToken string    `json:"-"`
	RefreshUntil time.Time `json:"-"`
}

var validRoles = []string{"customer", "staff", "admin"}

var errBadLogin = &httpx.Error{Status: 401, Code: "invalid_credentials", Message: "invalid email or password"}

func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func validEmail(s string) bool {
	if len(s) > 254 {
		return false
	}
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && strings.Contains(s[strings.LastIndex(s, "@"):], ".")
}

func checkPasswordRules(p string, fields map[string]string, key string) {
	switch {
	case len(p) < 10:
		fields[key] = "use at least 10 characters"
	case len(p) > 200:
		fields[key] = "use at most 200 characters"
	}
}

// Register creates a customer account and signs it in.
func (s *Service) Register(ctx context.Context, email, password, name string) (*Session, error) {
	email = normalizeEmail(email)
	name = strings.TrimSpace(name)
	fields := map[string]string{}
	if !validEmail(email) {
		fields["email"] = "enter a valid email address"
	}
	if name == "" || len(name) > 80 {
		fields["name"] = "enter your name (up to 80 characters)"
	}
	checkPasswordRules(password, fields, "password")
	if len(fields) > 0 {
		return nil, httpx.Invalid(fields)
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	u := &User{ID: id.New(), Email: email, Name: name, PasswordHash: hash,
		Roles: []string{"customer"}, Addresses: []Address{}, CreatedAt: s.Now().UTC()}
	if err := s.Store.CreateUser(ctx, u); err != nil {
		if errors.Is(err, ErrEmailTaken) {
			return nil, httpx.Invalid(map[string]string{"email": "an account with this email already exists"})
		}
		return nil, err
	}
	return s.startSession(ctx, u, id.New())
}

// Login checks the password and starts a new session family.
func (s *Service) Login(ctx context.Context, email, password string) (*Session, error) {
	u, err := s.Store.UserByEmail(ctx, normalizeEmail(email))
	if errors.Is(err, ErrNotFound) {
		CheckPassword(dummyHash, password) // same work as a real check
		return nil, errBadLogin
	}
	if err != nil {
		return nil, err
	}
	if !CheckPassword(u.PasswordHash, password) {
		return nil, errBadLogin
	}
	return s.startSession(ctx, u, id.New())
}

// Refresh rotates a refresh token and issues a new access token with current roles,
// so a role change takes effect within one access-token lifetime.
func (s *Service) Refresh(ctx context.Context, refresh string) (*Session, error) {
	if refresh == "" {
		return nil, httpx.Unauthorized("no session")
	}
	now := s.Now()
	t, err := s.Store.RefreshByHash(ctx, id.Hash(refresh))
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.Unauthorized("session not found")
	}
	if err != nil {
		return nil, err
	}
	if t.RevokedAt != nil {
		// A retired token came back: treat the session as stolen.
		if err := s.Store.RevokeFamily(ctx, t.FamilyID, now); err != nil {
			return nil, err
		}
		return nil, httpx.Unauthorized("session revoked")
	}
	if now.After(t.ExpiresAt) {
		return nil, httpx.Unauthorized("session expired")
	}
	u, err := s.Store.UserByID(ctx, t.UserID)
	if err != nil {
		return nil, httpx.Unauthorized("account not found")
	}
	next := id.Secret(32)
	ok, err := s.Store.RetireRefresh(ctx, t.Hash, id.Hash(next), now)
	if err != nil {
		return nil, err
	}
	if !ok { // lost a race with another refresh using the same token
		_ = s.Store.RevokeFamily(ctx, t.FamilyID, now)
		return nil, httpx.Unauthorized("session revoked")
	}
	return s.issue(ctx, u, t.FamilyID, next)
}

// Logout ends the whole session family, on this device.
func (s *Service) Logout(ctx context.Context, refresh string) error {
	if refresh == "" {
		return nil
	}
	t, err := s.Store.RefreshByHash(ctx, id.Hash(refresh))
	if err != nil {
		return nil // already gone; logging out is idempotent
	}
	return s.Store.RevokeFamily(ctx, t.FamilyID, s.Now())
}

func (s *Service) startSession(ctx context.Context, u *User, family string) (*Session, error) {
	return s.issue(ctx, u, family, id.Secret(32))
}

func (s *Service) issue(ctx context.Context, u *User, family, refresh string) (*Session, error) {
	now := s.Now()
	access, err := s.Signer.Sign(token.Claims{Subject: u.ID, Email: u.Email, Roles: u.Roles}, s.AccessTTL, now)
	if err != nil {
		return nil, err
	}
	rt := RefreshToken{Hash: id.Hash(refresh), UserID: u.ID, FamilyID: family, ExpiresAt: now.Add(s.RefreshTTL)}
	if err := s.Store.SaveRefresh(ctx, rt); err != nil {
		return nil, err
	}
	return &Session{AccessToken: access, ExpiresAt: now.Add(s.AccessTTL), User: u,
		RefreshToken: refresh, RefreshUntil: rt.ExpiresAt}, nil
}

// Me returns the signed-in user's account.
func (s *Service) Me(ctx context.Context, userID string) (*User, error) {
	u, err := s.Store.UserByID(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		return nil, httpx.NotFound("account")
	}
	return u, err
}

// UpdateProfile changes the display name.
func (s *Service) UpdateProfile(ctx context.Context, userID, name string) (*User, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 80 {
		return nil, httpx.Invalid(map[string]string{"name": "enter your name (up to 80 characters)"})
	}
	u, err := s.Me(ctx, userID)
	if err != nil {
		return nil, err
	}
	u.Name = name
	return u, s.Store.SaveUser(ctx, u)
}

// ChangePassword requires the current password and signs out other sessions.
func (s *Service) ChangePassword(ctx context.Context, userID, current, next string) error {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return err
	}
	if !CheckPassword(u.PasswordHash, current) {
		return httpx.Invalid(map[string]string{"currentPassword": "current password is incorrect"})
	}
	fields := map[string]string{}
	checkPasswordRules(next, fields, "newPassword")
	if len(fields) > 0 {
		return httpx.Invalid(fields)
	}
	if u.PasswordHash, err = HashPassword(next); err != nil {
		return err
	}
	if err := s.Store.SaveUser(ctx, u); err != nil {
		return err
	}
	return s.Store.RevokeUserSessions(ctx, u.ID, s.Now())
}

// Canadian provinces and territories, the only shipping region in v1.
var Provinces = []string{"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"}

// ValidateAddress is shared by the address book and (mirrored) checkout.
func ValidateAddress(a *Address) map[string]string {
	f := map[string]string{}
	trim := func(p *string) { *p = strings.TrimSpace(*p) }
	for _, p := range []*string{&a.Name, &a.Line1, &a.Line2, &a.City, &a.Province, &a.PostalCode, &a.Phone} {
		trim(p)
	}
	a.Province = strings.ToUpper(a.Province)
	a.PostalCode = strings.ToUpper(strings.ReplaceAll(a.PostalCode, " ", ""))
	a.Country = "CA"
	if a.Name == "" {
		f["name"] = "required"
	}
	if a.Line1 == "" {
		f["line1"] = "required"
	}
	if a.City == "" {
		f["city"] = "required"
	}
	if !slices.Contains(Provinces, a.Province) {
		f["province"] = "choose a province or territory"
	}
	if !validPostal(a.PostalCode) {
		f["postalCode"] = "use the format A1A 1A1"
	} else {
		a.PostalCode = a.PostalCode[:3] + " " + a.PostalCode[3:]
	}
	return f
}

func validPostal(p string) bool {
	if len(p) != 6 {
		return false
	}
	for i, r := range p {
		letter := r >= 'A' && r <= 'Z'
		digit := r >= '0' && r <= '9'
		if (i%2 == 0 && !letter) || (i%2 == 1 && !digit) {
			return false
		}
	}
	return true
}

func (s *Service) AddAddress(ctx context.Context, userID string, a Address) (*User, error) {
	if f := ValidateAddress(&a); len(f) > 0 {
		return nil, httpx.Invalid(f)
	}
	u, err := s.Me(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(u.Addresses) >= 10 {
		return nil, httpx.BadRequest("an account can save up to 10 addresses")
	}
	a.ID = id.New()
	u.Addresses = append(u.Addresses, a)
	return u, s.Store.SaveUser(ctx, u)
}

func (s *Service) DeleteAddress(ctx context.Context, userID, addressID string) (*User, error) {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return nil, err
	}
	u.Addresses = slices.DeleteFunc(u.Addresses, func(a Address) bool { return a.ID == addressID })
	return u, s.Store.SaveUser(ctx, u)
}

// ForgotPassword emails a one-hour reset link. It reports success either way, so the
// endpoint can't be used to test which emails have accounts.
func (s *Service) ForgotPassword(ctx context.Context, email string) error {
	u, err := s.Store.UserByEmail(ctx, normalizeEmail(email))
	if err != nil {
		return nil
	}
	secret := id.Secret(32)
	if err := s.Store.SaveReset(ctx, ResetToken{Hash: id.Hash(secret), UserID: u.ID,
		ExpiresAt: s.Now().Add(time.Hour)}); err != nil {
		return err
	}
	link := s.AppURL + "/reset-password?token=" + secret
	return s.Mail.Send(u.Email, "Reset your password",
		"Hi "+u.Name+",\n\nUse this link within an hour to choose a new password:\n"+link+
			"\n\nIf you didn't ask for this, ignore this email.")
}

// ResetPassword sets a new password and ends every session for the account.
func (s *Service) ResetPassword(ctx context.Context, secret, password string) error {
	fields := map[string]string{}
	checkPasswordRules(password, fields, "password")
	if len(fields) > 0 {
		return httpx.Invalid(fields)
	}
	t, err := s.Store.UseReset(ctx, id.Hash(secret), s.Now())
	if errors.Is(err, ErrNotFound) {
		return httpx.BadRequest("this reset link is invalid or has expired")
	}
	if err != nil {
		return err
	}
	u, err := s.Me(ctx, t.UserID)
	if err != nil {
		return err
	}
	if u.PasswordHash, err = HashPassword(password); err != nil {
		return err
	}
	if err := s.Store.SaveUser(ctx, u); err != nil {
		return err
	}
	return s.Store.RevokeUserSessions(ctx, u.ID, s.Now())
}

// ListUsers is for the admin user list.
func (s *Service) ListUsers(ctx context.Context, q string) ([]User, error) {
	return s.Store.ListUsers(ctx, strings.TrimSpace(q), 100)
}

// SetRoles changes a user's roles. An admin can't remove their own admin role,
// which prevents locking the store out of its admin panel by accident.
func (s *Service) SetRoles(ctx context.Context, actor *httpx.Principal, userID string, roles []string) (*User, error) {
	clean := []string{"customer"}
	for _, r := range roles {
		if !slices.Contains(validRoles, r) {
			return nil, httpx.Invalid(map[string]string{"roles": "unknown role " + r})
		}
		if !slices.Contains(clean, r) {
			clean = append(clean, r)
		}
	}
	if actor.UserID == userID && !slices.Contains(clean, "admin") {
		return nil, httpx.BadRequest("you can't remove your own admin role")
	}
	u, err := s.Me(ctx, userID)
	if err != nil {
		return nil, err
	}
	u.Roles = clean
	if err := s.Store.SaveUser(ctx, u); err != nil {
		return nil, err
	}
	return u, s.Store.RevokeUserSessions(ctx, u.ID, s.Now()) // pick up new roles on next sign-in
}

// EnsureAdmin creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD on startup,
// so a fresh install has someone who can open the admin panel.
func (s *Service) EnsureAdmin(ctx context.Context, email, password string) error {
	email = normalizeEmail(email)
	if email == "" || password == "" {
		return nil
	}
	if _, err := s.Store.UserByEmail(ctx, email); err == nil {
		return nil
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	err = s.Store.CreateUser(ctx, &User{ID: id.New(), Email: email, Name: "Store Admin", PasswordHash: hash,
		Roles: []string{"customer", "staff", "admin"}, Addresses: []Address{}, CreatedAt: s.Now().UTC()})
	if errors.Is(err, ErrEmailTaken) {
		return nil
	}
	return err
}
