package main

import (
	"fmt"
	"sync"
	"time"
)

// Session claims: an agent can hold a session exclusively for a bounded
// time so parallel agents/threads don't interleave sends on one account.
// Claims are in-memory with a TTL (lazy expiry) - a crashed holder never
// wedges a session. Force-release exists for the user's UI only.
type sessionClaim struct {
	Holder    string    `json:"holder"`
	ExpiresAt time.Time `json:"expires_at"`
}

type claimRegistry struct {
	mu     sync.Mutex
	claims map[string]sessionClaim
}

func newClaimRegistry() *claimRegistry {
	return &claimRegistry{claims: make(map[string]sessionClaim)}
}

const (
	claimDefaultTTL = 10 * time.Minute
	claimMaxTTL     = time.Hour
	claimMinTTL     = 30 * time.Second
)

// Claim takes or renews the claim on a session. The same holder always
// succeeds (renewal); a different holder gets an error naming the holder.
func (cr *claimRegistry) Claim(sessionID, holder string, ttl time.Duration) (sessionClaim, error) {
	if holder == "" {
		holder = "agent"
	}
	if ttl <= 0 {
		ttl = claimDefaultTTL
	}
	if ttl < claimMinTTL {
		ttl = claimMinTTL
	}
	if ttl > claimMaxTTL {
		ttl = claimMaxTTL
	}
	cr.mu.Lock()
	defer cr.mu.Unlock()
	if existing, ok := cr.claims[sessionID]; ok {
		if time.Now().Before(existing.ExpiresAt) && existing.Holder != holder {
			return existing, fmt.Errorf("session is claimed by %q until %s", existing.Holder, existing.ExpiresAt.Format("15:04:05"))
		}
	}
	c := sessionClaim{Holder: holder, ExpiresAt: time.Now().Add(ttl)}
	cr.claims[sessionID] = c
	return c, nil
}

// Release drops the claim. holder must match unless force is set (force is
// for the user's UI, never for agents).
func (cr *claimRegistry) Release(sessionID, holder string, force bool) error {
	cr.mu.Lock()
	defer cr.mu.Unlock()
	existing, ok := cr.claims[sessionID]
	if !ok || time.Now().After(existing.ExpiresAt) {
		delete(cr.claims, sessionID)
		return nil
	}
	if !force && existing.Holder != holder {
		return fmt.Errorf("session is claimed by %q until %s - only that holder (or the user from the UI) can release it", existing.Holder, existing.ExpiresAt.Format("15:04:05"))
	}
	delete(cr.claims, sessionID)
	return nil
}

// Of returns the live claim for a session, expiring stale ones lazily.
func (cr *claimRegistry) Of(sessionID string) (sessionClaim, bool) {
	cr.mu.Lock()
	defer cr.mu.Unlock()
	c, ok := cr.claims[sessionID]
	if !ok {
		return sessionClaim{}, false
	}
	if time.Now().After(c.ExpiresAt) {
		delete(cr.claims, sessionID)
		return sessionClaim{}, false
	}
	return c, true
}
