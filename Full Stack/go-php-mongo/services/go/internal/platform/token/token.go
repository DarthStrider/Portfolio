// Package token signs and verifies RS256 JSON Web Tokens with the standard library only.
//
// auth-service holds the private key and signs. Every other service (Go and PHP) holds
// only the public key and verifies, so none of them has to call auth-service per request,
// and none of them can mint tokens.
package token

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Issuer is checked on every token, so a token from some other system that happens
// to use the same key format is still rejected.
const Issuer = "shop-auth"

// Claims is the token payload. Field names follow the JWT registered claims.
type Claims struct {
	Subject   string   `json:"sub"`
	Email     string   `json:"email"`
	Roles     []string `json:"roles"`
	Issuer    string   `json:"iss"`
	IssuedAt  int64    `json:"iat"`
	ExpiresAt int64    `json:"exp"`
}

var (
	ErrMalformed = errors.New("token: malformed")
	ErrSignature = errors.New("token: bad signature")
	ErrExpired   = errors.New("token: expired")
	ErrClaims    = errors.New("token: invalid claims")
)

var header = b64(mustJSON(map[string]string{"alg": "RS256", "typ": "JWT"}))

// Signer makes tokens. Only auth-service constructs one.
type Signer struct{ key *rsa.PrivateKey }

func NewSigner(key *rsa.PrivateKey) *Signer { return &Signer{key: key} }

// Sign fills in iss/iat/exp and returns header.payload.signature.
func (s *Signer) Sign(c Claims, ttl time.Duration, now time.Time) (string, error) {
	c.Issuer = Issuer
	c.IssuedAt = now.Unix()
	c.ExpiresAt = now.Add(ttl).Unix()
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	signingInput := header + "." + b64(payload)
	digest := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, s.key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return signingInput + "." + b64(sig), nil
}

// Verifier checks tokens with the public key.
type Verifier struct{ pub *rsa.PublicKey }

func NewVerifier(pub *rsa.PublicKey) *Verifier { return &Verifier{pub: pub} }

// Verify returns the claims if the signature, algorithm, issuer and expiry are all valid.
func (v *Verifier) Verify(tok string, now time.Time) (Claims, error) {
	var c Claims
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return c, ErrMalformed
	}
	// Pin the algorithm. Trusting the header's "alg" is the classic JWT hole:
	// a token claiming "none" or HS256 must never reach the signature check.
	if parts[0] != header {
		var h struct{ Alg string }
		raw, err := unb64(parts[0])
		if err != nil || json.Unmarshal(raw, &h) != nil || h.Alg != "RS256" {
			return c, ErrMalformed
		}
	}
	sig, err := unb64(parts[2])
	if err != nil {
		return c, ErrMalformed
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(v.pub, crypto.SHA256, digest[:], sig); err != nil {
		return c, ErrSignature
	}
	payload, err := unb64(parts[1])
	if err != nil || json.Unmarshal(payload, &c) != nil {
		return c, ErrMalformed
	}
	if c.Issuer != Issuer || c.Subject == "" {
		return c, ErrClaims
	}
	if now.Unix() >= c.ExpiresAt {
		return c, ErrExpired
	}
	return c, nil
}

// LoadOrCreateKey reads dir/jwt_private.pem, or generates a 2048-bit key pair on
// first start and writes both halves. The public half lands in a shared Docker volume
// that the other services mount read-only.
func LoadOrCreateKey(dir string) (*rsa.PrivateKey, error) {
	privPath := filepath.Join(dir, "jwt_private.pem")
	if raw, err := os.ReadFile(privPath); err == nil {
		block, _ := pem.Decode(raw)
		if block == nil {
			return nil, fmt.Errorf("token: %s is not PEM", privPath)
		}
		k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		rk, ok := k.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("token: %s is not an RSA key", privPath)
		}
		return rk, nil
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	privDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	pubDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	// Public key first: readers poll for the public file, and the private
	// file existing first could let a restart race skip writing it.
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})
	if err := writeAtomic(filepath.Join(dir, "jwt_public.pem"), pubPEM, 0o644); err != nil {
		return nil, err
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})
	if err := writeAtomic(privPath, privPEM, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

// WaitForPublicKey polls until auth-service has written the public key, so services can
// start in any order.
func WaitForPublicKey(path string, timeout time.Duration) (*rsa.PublicKey, error) {
	deadline := time.Now().Add(timeout)
	for {
		raw, err := os.ReadFile(path)
		if err == nil {
			return ParsePublicKey(raw)
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("token: public key %s not found after %s", path, timeout)
		}
		time.Sleep(time.Second)
	}
}

// ParsePublicKey decodes a PEM "PUBLIC KEY" block.
func ParsePublicKey(raw []byte) (*rsa.PublicKey, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, errors.New("token: public key is not PEM")
	}
	k, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	pub, ok := k.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("token: public key is not RSA")
	}
	return pub, nil
}

// writeAtomic writes to a temp file and renames, so a reader never sees half a key.
func writeAtomic(path string, data []byte, mode os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func b64(b []byte) string            { return base64.RawURLEncoding.EncodeToString(b) }
func unb64(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }
func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
