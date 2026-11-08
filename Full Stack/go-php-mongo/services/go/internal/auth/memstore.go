package auth

import (
	"context"
	"slices"
	"strings"
	"sync"
	"time"
)

// MemStore keeps everything in maps. It backs the tests.
// Values are copied in and out so callers can't mutate stored state by accident,
// which is the same behaviour a real database gives.
type MemStore struct {
	mu      sync.Mutex
	users   map[string]User
	byEmail map[string]string
	refresh map[string]RefreshToken
	resets  map[string]ResetToken
}

func NewMemStore() *MemStore {
	return &MemStore{users: map[string]User{}, byEmail: map[string]string{},
		refresh: map[string]RefreshToken{}, resets: map[string]ResetToken{}}
}

func cloneUser(u User) *User {
	u.Roles = slices.Clone(u.Roles)
	u.Addresses = slices.Clone(u.Addresses)
	return &u
}

func (m *MemStore) CreateUser(_ context.Context, u *User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.byEmail[u.Email]; ok {
		return ErrEmailTaken
	}
	m.users[u.ID] = *cloneUser(*u)
	m.byEmail[u.Email] = u.ID
	return nil
}

func (m *MemStore) UserByEmail(_ context.Context, email string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	uid, ok := m.byEmail[email]
	if !ok {
		return nil, ErrNotFound
	}
	return cloneUser(m.users[uid]), nil
}

func (m *MemStore) UserByID(_ context.Context, id string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok {
		return nil, ErrNotFound
	}
	return cloneUser(u), nil
}

func (m *MemStore) SaveUser(_ context.Context, u *User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.users[u.ID]; !ok {
		return ErrNotFound
	}
	m.users[u.ID] = *cloneUser(*u)
	return nil
}

func (m *MemStore) ListUsers(_ context.Context, q string, limit int) ([]User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	q = strings.ToLower(q)
	var out []User
	for _, u := range m.users {
		if q == "" || strings.Contains(u.Email, q) || strings.Contains(strings.ToLower(u.Name), q) {
			out = append(out, *cloneUser(u))
		}
	}
	slices.SortFunc(out, func(a, b User) int { return b.CreatedAt.Compare(a.CreatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *MemStore) SaveRefresh(_ context.Context, t RefreshToken) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.refresh[t.Hash] = t
	return nil
}

func (m *MemStore) RefreshByHash(_ context.Context, hash string) (*RefreshToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.refresh[hash]
	if !ok {
		return nil, ErrNotFound
	}
	return &t, nil
}

func (m *MemStore) RetireRefresh(_ context.Context, hash, replacedBy string, at time.Time) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.refresh[hash]
	if !ok || t.RevokedAt != nil {
		return false, nil
	}
	t.RevokedAt, t.ReplacedBy = &at, replacedBy
	m.refresh[hash] = t
	return true, nil
}

func (m *MemStore) RevokeFamily(_ context.Context, family string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, t := range m.refresh {
		if t.FamilyID == family && t.RevokedAt == nil {
			t.RevokedAt = &at
			m.refresh[k] = t
		}
	}
	return nil
}

func (m *MemStore) RevokeUserSessions(_ context.Context, userID string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, t := range m.refresh {
		if t.UserID == userID && t.RevokedAt == nil {
			t.RevokedAt = &at
			m.refresh[k] = t
		}
	}
	return nil
}

func (m *MemStore) SaveReset(_ context.Context, t ResetToken) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resets[t.Hash] = t
	return nil
}

func (m *MemStore) UseReset(_ context.Context, hash string, at time.Time) (*ResetToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.resets[hash]
	if !ok || t.UsedAt != nil || at.After(t.ExpiresAt) {
		return nil, ErrNotFound
	}
	t.UsedAt = &at
	m.resets[hash] = t
	return &t, nil
}
