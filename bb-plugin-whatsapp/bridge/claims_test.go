package main

import (
	"testing"
	"time"
)

func TestClaimRenewSameHolder(t *testing.T) {
	cr := newClaimRegistry()
	c, err := cr.Claim("s1", "agent-a", time.Minute)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if c.Holder != "agent-a" {
		t.Fatalf("holder = %q", c.Holder)
	}
	if _, err := cr.Claim("s1", "agent-a", 2*time.Minute); err != nil {
		t.Fatalf("renew by same holder must succeed: %v", err)
	}
}

func TestClaimConflictNamesHolder(t *testing.T) {
	cr := newClaimRegistry()
	if _, err := cr.Claim("s1", "agent-a", time.Minute); err != nil {
		t.Fatal(err)
	}
	c, err := cr.Claim("s1", "agent-b", time.Minute)
	if err == nil {
		t.Fatal("second holder must not take the claim")
	}
	if c.Holder != "agent-a" {
		t.Fatalf("conflict must report current holder, got %q", c.Holder)
	}
}

func TestClaimExpiry(t *testing.T) {
	cr := newClaimRegistry()
	if _, err := cr.Claim("s1", "agent-a", time.Millisecond); err != nil {
		t.Fatal(err)
	}
	// TTLs are clamped to claimMinTTL, so expire the entry by hand.
	cr.mu.Lock()
	c := cr.claims["s1"]
	c.ExpiresAt = time.Now().Add(-time.Second)
	cr.claims["s1"] = c
	cr.mu.Unlock()
	if _, ok := cr.Of("s1"); ok {
		t.Fatal("expired claim must not be returned")
	}
	if _, err := cr.Claim("s1", "agent-b", time.Minute); err != nil {
		t.Fatalf("expired claim must be takeable: %v", err)
	}
}

func TestReleaseHolderMatching(t *testing.T) {
	cr := newClaimRegistry()
	if _, err := cr.Claim("s1", "agent-a", time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := cr.Release("s1", "agent-b", false); err == nil {
		t.Fatal("release by another holder must fail")
	}
	if err := cr.Release("s1", "agent-a", false); err != nil {
		t.Fatalf("release by holder: %v", err)
	}
}

func TestForceRelease(t *testing.T) {
	cr := newClaimRegistry()
	if _, err := cr.Claim("s1", "agent-a", time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := cr.Release("s1", "ui", true); err != nil {
		t.Fatalf("force release (UI): %v", err)
	}
	if _, ok := cr.Of("s1"); ok {
		t.Fatal("claim must be gone after force release")
	}
}
