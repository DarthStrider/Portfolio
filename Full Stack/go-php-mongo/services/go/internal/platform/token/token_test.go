package token

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newPair(t *testing.T) (*Signer, *Verifier) {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return NewSigner(k), NewVerifier(&k.PublicKey)
}

func TestSignVerifyRoundTrip(t *testing.T) {
	s, v := newPair(t)
	now := time.Now()
	tok, err := s.Sign(Claims{Subject: "u1", Email: "a@b.co", Roles: []string{"customer"}}, time.Minute, now)
	if err != nil {
		t.Fatal(err)
	}
	c, err := v.Verify(tok, now)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if c.Subject != "u1" || c.Email != "a@b.co" || c.Roles[0] != "customer" || c.Issuer != Issuer {
		t.Fatalf("claims = %+v", c)
	}
}

func TestVerifyRejects(t *testing.T) {
	s, v := newPair(t)
	_, otherV := newPair(t)
	now := time.Now()
	tok, _ := s.Sign(Claims{Subject: "u1"}, time.Minute, now)
	parts := strings.Split(tok, ".")

	// A payload swapped for one claiming admin keeps the old signature: must fail.
	forged := b64([]byte(`{"sub":"u1","roles":["admin"],"iss":"shop-auth","exp":9999999999}`))
	none := b64([]byte(`{"alg":"none","typ":"JWT"}`))

	cases := map[string]struct {
		tok string
		v   *Verifier
		at  time.Time
	}{
		"expired":     {tok, v, now.Add(2 * time.Minute)},
		"other key":   {tok, otherV, now},
		"tampered":    {parts[0] + "." + forged + "." + parts[2], v, now},
		"alg none":    {none + "." + parts[1] + ".", v, now},
		"two parts":   {parts[0] + "." + parts[1], v, now},
		"garbage sig": {parts[0] + "." + parts[1] + "." + base64.RawURLEncoding.EncodeToString([]byte("x")), v, now},
	}
	for name, c := range cases {
		if _, err := c.v.Verify(c.tok, c.at); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestLoadOrCreateKeyPersists(t *testing.T) {
	dir := t.TempDir()
	k1, err := LoadOrCreateKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	k2, err := LoadOrCreateKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !k1.Equal(k2) {
		t.Fatal("second load generated a new key")
	}
	pub, err := WaitForPublicKey(filepath.Join(dir, "jwt_public.pem"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if !pub.Equal(&k1.PublicKey) {
		t.Fatal("public key file doesn't match the private key")
	}
	if info, _ := os.Stat(filepath.Join(dir, "jwt_private.pem")); info.Mode().Perm() != 0o600 {
		t.Fatalf("private key mode = %v, want 0600", info.Mode().Perm())
	}
}
