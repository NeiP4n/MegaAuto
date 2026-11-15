package main

// Per-session send limits that keep agent-driven messaging inside
// human-looking volumes, so WhatsApp's spam heuristics never see a burst:
//  - min spacing between sends (serialized through the guard's lock)
//  - sliding-window cap
//  - persisted daily cap (survives bridge restarts)
//  - hourly cap on first-time recipients, so a broken agent loop cannot
//    blast unknown numbers; an explicit per-request flag overrides it.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Package-level vars (not consts) so tests can shrink the windows.
var (
	sendMinSpacing   = 2 * time.Second
	sendWindowSize   = 10 * time.Minute
	sendWindowMax    = 50
	sendDailyMax     = 500
	newRecipientMax  = 5
	newRecipientSpan = time.Hour
)

type sendQuotaFile struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type sendGuard struct {
	mu            sync.Mutex
	lastSend      time.Time
	window        []time.Time
	newRecipients map[string]time.Time
	quotaPath     string
	dailyDate     string
	dailyCount    int
}

func newSendGuard(storeDir string) *sendGuard {
	g := &sendGuard{
		newRecipients: make(map[string]time.Time),
		quotaPath:     filepath.Join(storeDir, "send_quota.json"),
	}
	if raw, err := os.ReadFile(g.quotaPath); err == nil {
		var q sendQuotaFile
		if json.Unmarshal(raw, &q) == nil {
			g.dailyDate = q.Date
			g.dailyCount = q.Count
		}
	}
	return g
}

func todayLocal() string {
	return time.Now().Format("2006-01-02")
}

// normalizeRecipient mirrors the JID logic in sendWhatsAppMessage closely
// enough for limit bookkeeping (it runs before the real parse).
func normalizeRecipient(recipient string) string {
	if strings.Contains(recipient, "@") {
		return recipient
	}
	clean := strings.TrimPrefix(recipient, "+")
	clean = strings.ReplaceAll(clean, " ", "")
	clean = strings.ReplaceAll(clean, "-", "")
	return clean + "@s.whatsapp.net"
}

// acquire enforces spacing (by sleeping while holding the guard, which
// serializes sends per session) and the caps. A non-empty message means the
// send must NOT happen; retryAfter tells the caller when to try again.
func (g *sendGuard) acquire(recipient string, knownRecipient bool, allowUnknownBlast bool) (time.Duration, string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := time.Now()

	// Daily cap (persisted).
	if g.dailyDate != todayLocal() {
		g.dailyDate = todayLocal()
		g.dailyCount = 0
	}
	if g.dailyCount >= sendDailyMax {
		midnight := time.Now().Truncate(24*time.Hour).Add(24 * time.Hour)
		return time.Until(midnight), fmt.Sprintf("Daily send limit reached (%d messages). Resets at midnight - this keeps the account safe from spam flags.", sendDailyMax)
	}

	// Sliding window cap.
	cutoff := now.Add(-sendWindowSize)
	kept := g.window[:0]
	for _, t := range g.window {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	g.window = kept
	if len(g.window) >= sendWindowMax {
		oldest := g.window[0]
		retry := oldest.Add(sendWindowSize).Sub(now)
		return retry, fmt.Sprintf("Send rate limit: max %d messages per %d minutes. Retry in %s - spacing messages out keeps the account safe.", sendWindowMax, int(sendWindowSize.Minutes()), retry.Round(time.Second))
	}

	// First-time-recipient cap. A recipient that already has a chat row or a
	// contact entry is "known" and exempt; brand-new numbers are limited per
	// hour so a runaway loop cannot cold-blast strangers.
	if !knownRecipient && !allowUnknownBlast {
		for jid, first := range g.newRecipients {
			if now.Sub(first) > newRecipientSpan {
				delete(g.newRecipients, jid)
			}
		}
		if _, seen := g.newRecipients[recipient]; !seen {
			if len(g.newRecipients) >= newRecipientMax {
				var oldestFirst time.Time
				for _, first := range g.newRecipients {
					if oldestFirst.IsZero() || first.Before(oldestFirst) {
						oldestFirst = first
					}
				}
				retry := oldestFirst.Add(newRecipientSpan).Sub(now)
				return retry, fmt.Sprintf("New-recipient limit: max %d first-time numbers per hour (bulk messaging unknown numbers gets accounts banned). Retry in %s, or pass allow_unknown_blast=true if this is intentional.", newRecipientMax, retry.Round(time.Second))
			}
			g.newRecipients[recipient] = now
		}
	}

	// Spacing: wait out the remainder of the minimum gap. Holding the lock
	// through the sleep is what serializes concurrent sends per session.
	if gap := sendMinSpacing - now.Sub(g.lastSend); gap > 0 {
		time.Sleep(gap)
	}
	g.lastSend = time.Now()
	g.window = append(g.window, g.lastSend)
	g.dailyCount++
	g.saveQuota()
	return 0, ""
}

func (g *sendGuard) saveQuota() {
	raw, err := json.Marshal(sendQuotaFile{Date: g.dailyDate, Count: g.dailyCount})
	if err != nil {
		return
	}
	_ = os.WriteFile(g.quotaPath, raw, 0644)
}
