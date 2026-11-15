package main

import (
	"testing"
	"time"
)

func lidAlt(jid string) string {
	if jid == "24381234567890@lid" {
		return "639451155496@s.whatsapp.net"
	}
	return ""
}

func TestMergeLIDAndPNChats(t *testing.T) {
	old := time.Now().Add(-time.Hour)
	recent := time.Now()
	items := []chatItem{
		{JID: "639451155496@s.whatsapp.net", Name: "Instinct", LastMessageTime: old, LastMessage: "Привет. Это ты или тест", LastIsFromMe: true},
		{JID: "24381234567890@lid", Name: "Instinct", LastMessageTime: recent, LastMessage: "Привееет", LastIsFromMe: true},
	}
	out := mergeAltJIDChats(items, lidAlt)
	if len(out) != 1 {
		t.Fatalf("expected 1 merged chat, got %d", len(out))
	}
	if out[0].JID != "639451155496@s.whatsapp.net" {
		t.Fatalf("canonical JID should be the phone JID, got %s", out[0].JID)
	}
	if out[0].LastMessage != "Привееет" {
		t.Fatalf("last message must come from the newer (LID) side, got %q", out[0].LastMessage)
	}
	if out[0].Name != "Instinct" {
		t.Fatalf("name lost: %q", out[0].Name)
	}
}

func TestMergeKeepsUnrelatedChats(t *testing.T) {
	now := time.Now()
	items := []chatItem{
		{JID: "16507508483@s.whatsapp.net", Name: "+16507508483", LastMessageTime: now},
		{JID: "13135550002@s.whatsapp.net", Name: "+13135550002", LastMessageTime: now.Add(-time.Minute)},
		{JID: "999888777@lid", Name: "999888777", LastMessageTime: now.Add(-2 * time.Minute)}, // no mapping known
	}
	out := mergeAltJIDChats(items, lidAlt)
	if len(out) != 3 {
		t.Fatalf("unrelated chats must not merge, got %d", len(out))
	}
}

func TestMergePrefersRealNameAndSorts(t *testing.T) {
	old := time.Now().Add(-time.Hour)
	recent := time.Now()
	items := []chatItem{
		{JID: "24381234567890@lid", Name: "24381234567890", LastMessageTime: recent, LastMessage: "new"},
		{JID: "639451155496@s.whatsapp.net", Name: "Instinct", LastMessageTime: old, LastMessage: "old"},
		{JID: "16507508483@s.whatsapp.net", Name: "+16507508483", LastMessageTime: old.Add(-time.Hour), LastMessage: "other"},
	}
	out := mergeAltJIDChats(items, lidAlt)
	if len(out) != 2 {
		t.Fatalf("expected 2 chats, got %d", len(out))
	}
	if out[0].Name != "Instinct" {
		t.Fatalf("real name should beat raw number, got %q", out[0].Name)
	}
	if out[0].LastMessage != "new" || !out[0].LastMessageTime.Equal(recent) {
		t.Fatalf("newer side must win the preview: %+v", out[0])
	}
}
