package main

import (
	"strings"
	"testing"
	"time"
)

func withTestLimits(t *testing.T, spacing, window time.Duration, windowMax, dailyMax, newMax int) {
	t.Helper()
	oldSpacing, oldWindow, oldWindowMax := sendMinSpacing, sendWindowSize, sendWindowMax
	oldDailyMax, oldNewMax := sendDailyMax, newRecipientMax
	sendMinSpacing, sendWindowSize, sendWindowMax = spacing, window, windowMax
	sendDailyMax, newRecipientMax = dailyMax, newMax
	t.Cleanup(func() {
		sendMinSpacing, sendWindowSize, sendWindowMax = oldSpacing, oldWindow, oldWindowMax
		sendDailyMax, newRecipientMax = oldDailyMax, oldNewMax
	})
}

func TestGuardSpacingSerializes(t *testing.T) {
	withTestLimits(t, 150*time.Millisecond, time.Minute, 100, 100, 100)
	g := newSendGuard(t.TempDir())
	start := time.Now()
	if _, msg := g.acquire("111@s.whatsapp.net", true, false); msg != "" {
		t.Fatalf("first send blocked: %s", msg)
	}
	if _, msg := g.acquire("111@s.whatsapp.net", true, false); msg != "" {
		t.Fatalf("second send blocked: %s", msg)
	}
	if d := time.Since(start); d < 150*time.Millisecond {
		t.Fatalf("spacing not enforced: two sends in %v", d)
	}
}

func TestGuardWindowCap(t *testing.T) {
	withTestLimits(t, 0, time.Minute, 3, 100, 100)
	g := newSendGuard(t.TempDir())
	for i := 0; i < 3; i++ {
		if _, msg := g.acquire("111@s.whatsapp.net", true, false); msg != "" {
			t.Fatalf("send %d blocked: %s", i, msg)
		}
	}
	retry, msg := g.acquire("111@s.whatsapp.net", true, false)
	if msg == "" || retry <= 0 {
		t.Fatalf("window cap not enforced (retry=%v msg=%q)", retry, msg)
	}
	if !strings.Contains(msg, "rate limit") {
		t.Fatalf("unexpected message: %q", msg)
	}
}

func TestGuardDailyCapPersists(t *testing.T) {
	withTestLimits(t, 0, time.Minute, 100, 2, 100)
	dir := t.TempDir()
	g := newSendGuard(dir)
	g.acquire("111@s.whatsapp.net", true, false)
	g.acquire("111@s.whatsapp.net", true, false)
	if _, msg := g.acquire("111@s.whatsapp.net", true, false); !strings.Contains(msg, "Daily send limit") {
		t.Fatalf("daily cap not enforced: %q", msg)
	}
	g2 := newSendGuard(dir)
	if _, msg := g2.acquire("111@s.whatsapp.net", true, false); !strings.Contains(msg, "Daily send limit") {
		t.Fatalf("daily cap did not persist across restart: %q", msg)
	}
}

func TestGuardNewRecipientCap(t *testing.T) {
	withTestLimits(t, 0, time.Minute, 100, 100, 2)
	g := newSendGuard(t.TempDir())
	if _, msg := g.acquire("new1@s.whatsapp.net", false, false); msg != "" {
		t.Fatalf("new recipient 1 blocked: %s", msg)
	}
	if _, msg := g.acquire("new2@s.whatsapp.net", false, false); msg != "" {
		t.Fatalf("new recipient 2 blocked: %s", msg)
	}
	retry, msg := g.acquire("new3@s.whatsapp.net", false, false)
	if !strings.Contains(msg, "New-recipient limit") || retry <= 0 {
		t.Fatalf("new-recipient cap not enforced (retry=%v msg=%q)", retry, msg)
	}
	if _, msg := g.acquire("new3@s.whatsapp.net", false, true); msg != "" {
		t.Fatalf("allow_unknown_blast override ignored: %s", msg)
	}
	if _, msg := g.acquire("known@s.whatsapp.net", true, false); msg != "" {
		t.Fatalf("known recipient blocked: %s", msg)
	}
}
