package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"shop/internal/platform/httpx"
	"shop/internal/platform/mail"
	"shop/internal/platform/token"
)

// testServer wires the real handlers to a MemStore, the same way main.go wires MongoStore.
type testServer struct {
	srv  *httptest.Server
	mail *mail.Recorder
	svc  *Service
}

func newTestServer(t *testing.T) *testServer {
	t.Helper()
	Iterations = 1000 // fast hashing in tests
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	rec := &mail.Recorder{}
	svc := &Service{Store: NewMemStore(), Signer: token.NewSigner(key), Mail: rec, AppURL: "http://shop.test",
		AccessTTL: 15 * time.Minute, RefreshTTL: 24 * time.Hour, Now: time.Now}
	mux := http.NewServeMux()
	(&Handlers{Svc: svc}).Routes(mux)
	srv := httptest.NewServer(httpx.Authenticate(token.NewVerifier(&key.PublicKey), mux))
	t.Cleanup(srv.Close)
	return &testServer{srv: srv, mail: rec, svc: svc}
}

type resp struct {
	status int
	body   map[string]any
	cookie *http.Cookie
}

func (ts *testServer) do(t *testing.T, method, path, body, bearer string, cookie *http.Cookie) resp {
	t.Helper()
	req, _ := http.NewRequest(method, ts.srv.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	out := resp{status: res.StatusCode}
	_ = json.NewDecoder(res.Body).Decode(&out.body)
	for _, c := range res.Cookies() {
		if c.Name == refreshCookie {
			out.cookie = c
		}
	}
	return out
}

func TestRegisterLoginMe(t *testing.T) {
	ts := newTestServer(t)
	r := ts.do(t, "POST", "/api/v1/auth/register", `{"email":" Ana@Example.com ","password":"correct horse","name":"Ana"}`, "", nil)
	if r.status != 201 {
		t.Fatalf("register: %d %v", r.status, r.body)
	}
	if r.cookie == nil || !r.cookie.HttpOnly || r.cookie.Path != "/api/v1/auth" {
		t.Fatalf("refresh cookie = %+v", r.cookie)
	}
	user := r.body["user"].(map[string]any)
	if user["email"] != "ana@example.com" {
		t.Fatalf("email not normalized: %v", user["email"])
	}
	if _, leaked := user["passwordHash"]; leaked {
		t.Fatal("password hash in response")
	}

	dup := ts.do(t, "POST", "/api/v1/auth/register", `{"email":"ana@example.com","password":"correct horse","name":"Ana"}`, "", nil)
	if dup.status != 422 {
		t.Fatalf("duplicate register: %d", dup.status)
	}

	bad := ts.do(t, "POST", "/api/v1/auth/login", `{"email":"ana@example.com","password":"wrong password"}`, "", nil)
	missing := ts.do(t, "POST", "/api/v1/auth/login", `{"email":"nobody@example.com","password":"wrong password"}`, "", nil)
	if bad.status != 401 || missing.status != 401 || bad.body["error"].(map[string]any)["message"] != missing.body["error"].(map[string]any)["message"] {
		t.Fatal("wrong password and unknown email must look identical")
	}

	login := ts.do(t, "POST", "/api/v1/auth/login", `{"email":"ana@example.com","password":"correct horse"}`, "", nil)
	if login.status != 200 {
		t.Fatalf("login: %d", login.status)
	}
	me := ts.do(t, "GET", "/api/v1/me", "", login.body["accessToken"].(string), nil)
	if me.status != 200 || me.body["name"] != "Ana" {
		t.Fatalf("me: %d %v", me.status, me.body)
	}
	if anon := ts.do(t, "GET", "/api/v1/me", "", "", nil); anon.status != 401 {
		t.Fatalf("anonymous /me: %d", anon.status)
	}
}

func TestValidation(t *testing.T) {
	ts := newTestServer(t)
	r := ts.do(t, "POST", "/api/v1/auth/register", `{"email":"nope","password":"short","name":""}`, "", nil)
	if r.status != 422 {
		t.Fatalf("status %d", r.status)
	}
	fields := r.body["error"].(map[string]any)["fields"].(map[string]any)
	for _, f := range []string{"email", "password", "name"} {
		if fields[f] == nil {
			t.Errorf("missing field error for %s", f)
		}
	}
	if u := ts.do(t, "POST", "/api/v1/auth/login", `{"email":"a@b.co","password":"x","extra":1}`, "", nil); u.status != 400 {
		t.Errorf("unknown JSON field accepted: %d", u.status)
	}
}

// Refresh rotation: each refresh retires the old cookie. Presenting a retired cookie
// again (as a thief replaying a stolen copy would) kills the whole session.
func TestRefreshRotationAndReuseDetection(t *testing.T) {
	ts := newTestServer(t)
	first := ts.do(t, "POST", "/api/v1/auth/register", `{"email":"bo@example.com","password":"correct horse","name":"Bo"}`, "", nil).cookie

	second := ts.do(t, "POST", "/api/v1/auth/refresh", "", "", first)
	if second.status != 200 || second.cookie == nil || second.cookie.Value == first.Value {
		t.Fatalf("refresh didn't rotate: %d", second.status)
	}
	if replay := ts.do(t, "POST", "/api/v1/auth/refresh", "", "", first); replay.status != 401 {
		t.Fatalf("replayed token accepted: %d", replay.status)
	}
	// The legitimate newer token died with the family.
	if after := ts.do(t, "POST", "/api/v1/auth/refresh", "", "", second.cookie); after.status != 401 {
		t.Fatalf("family not revoked after reuse: %d", after.status)
	}
}

func TestLogoutRevokes(t *testing.T) {
	ts := newTestServer(t)
	c := ts.do(t, "POST", "/api/v1/auth/register", `{"email":"cy@example.com","password":"correct horse","name":"Cy"}`, "", nil).cookie
	if r := ts.do(t, "POST", "/api/v1/auth/logout", "", "", c); r.status != 204 {
		t.Fatalf("logout %d", r.status)
	}
	if r := ts.do(t, "POST", "/api/v1/auth/refresh", "", "", c); r.status != 401 {
		t.Fatalf("refresh after logout: %d", r.status)
	}
}

func TestPasswordReset(t *testing.T) {
	ts := newTestServer(t)
	ts.do(t, "POST", "/api/v1/auth/register", `{"email":"di@example.com","password":"correct horse","name":"Di"}`, "", nil)
	if r := ts.do(t, "POST", "/api/v1/auth/forgot-password", `{"email":"unknown@example.com"}`, "", nil); r.status != 202 {
		t.Fatalf("unknown email should still be 202, got %d", r.status)
	}
	if len(ts.mail.Sent) != 0 {
		t.Fatal("email sent for unknown address")
	}
	ts.do(t, "POST", "/api/v1/auth/forgot-password", `{"email":"di@example.com"}`, "", nil)
	msg, ok := ts.mail.Last()
	if !ok {
		t.Fatal("no reset email")
	}
	tok := msg.Body[strings.Index(msg.Body, "token=")+6:]
	tok = strings.Fields(tok)[0]

	body := `{"token":"` + tok + `","password":"a brand new secret"}`
	if r := ts.do(t, "POST", "/api/v1/auth/reset-password", body, "", nil); r.status != 204 {
		t.Fatalf("reset: %d %v", r.status, r.body)
	}
	if r := ts.do(t, "POST", "/api/v1/auth/reset-password", body, "", nil); r.status != 400 {
		t.Fatalf("reset link worked twice: %d", r.status)
	}
	if r := ts.do(t, "POST", "/api/v1/auth/login", `{"email":"di@example.com","password":"a brand new secret"}`, "", nil); r.status != 200 {
		t.Fatalf("login with new password: %d", r.status)
	}
}

func TestAdminRoles(t *testing.T) {
	ts := newTestServer(t)
	if err := ts.svc.EnsureAdmin(t.Context(), "admin@shop.test", "admin password 1"); err != nil {
		t.Fatal(err)
	}
	admin := ts.do(t, "POST", "/api/v1/auth/login", `{"email":"admin@shop.test","password":"admin password 1"}`, "", nil)
	cust := ts.do(t, "POST", "/api/v1/auth/register", `{"email":"ed@example.com","password":"correct horse","name":"Ed"}`, "", nil)
	adminTok := admin.body["accessToken"].(string)
	custTok := cust.body["accessToken"].(string)
	custID := cust.body["user"].(map[string]any)["id"].(string)
	adminID := admin.body["user"].(map[string]any)["id"].(string)

	if r := ts.do(t, "GET", "/api/v1/admin/users", "", custTok, nil); r.status != 403 {
		t.Fatalf("customer reached admin: %d", r.status)
	}
	r := ts.do(t, "PUT", "/api/v1/admin/users/"+custID+"/roles", `{"roles":["staff"]}`, adminTok, nil)
	roles := r.body["roles"].([]any)
	if r.status != 200 || len(roles) != 2 || roles[1] != "staff" {
		t.Fatalf("set roles: %d %v", r.status, r.body)
	}
	if r := ts.do(t, "PUT", "/api/v1/admin/users/"+adminID+"/roles", `{"roles":["staff"]}`, adminTok, nil); r.status != 400 {
		t.Fatalf("admin removed own admin role: %d", r.status)
	}
}

func TestAddressValidation(t *testing.T) {
	a := Address{Name: "Ana", Line1: "1 King St W", City: "Toronto", Province: "on", PostalCode: "m5h1a1"}
	if f := ValidateAddress(&a); len(f) != 0 {
		t.Fatalf("valid address rejected: %v", f)
	}
	if a.PostalCode != "M5H 1A1" || a.Province != "ON" || a.Country != "CA" {
		t.Fatalf("not normalized: %+v", a)
	}
	b := Address{Name: "x", Line1: "x", City: "x", Province: "ZZ", PostalCode: "12345"}
	f := ValidateAddress(&b)
	if f["province"] == "" || f["postalCode"] == "" {
		t.Fatalf("bad address accepted: %v", f)
	}
}
