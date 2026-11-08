// Package id makes identifiers and secrets from crypto/rand.
package id

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

// New returns a 24-character hex ID: the same length as a MongoDB ObjectID, but random,
// so IDs can't be guessed from creation order. Used as the _id of documents.
func New() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand never fails on supported platforms
	}
	return hex.EncodeToString(b)
}

// Secret returns a URL-safe random string with n bytes of entropy, for tokens
// that are handed to a browser (refresh tokens, reset links, guest order keys).
func Secret(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// Hash returns the SHA-256 of a secret. Only hashes are stored, so a leaked
// database can't be used to log in or open someone's order.
func Hash(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
