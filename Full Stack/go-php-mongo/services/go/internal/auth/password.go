package auth

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
)

// Iterations follows OWASP's guidance for PBKDF2-HMAC-SHA256. It is a variable so tests
// can lower it; the count is stored in each hash, so raising it later only affects new
// passwords and old ones keep verifying.
var Iterations = 600_000

// HashPassword returns "pbkdf2-sha256$<iterations>$<salt>$<key>".
// PBKDF2 is in Go's standard library since 1.24, which keeps this service dependency-free;
// Argon2id is the stronger choice when golang.org/x/crypto is acceptable.
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, Iterations, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", Iterations,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// CheckPassword compares in constant time so the response time doesn't leak how
// many bytes matched.
func CheckPassword(hash, password string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 1 {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iter, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

// dummyHash is checked when an email doesn't exist, so "no such user" takes as long as
// "wrong password" and response times don't reveal which emails have accounts.
var dummyHash string

func init() {
	dummyHash, _ = HashPassword("not-a-real-password")
}
