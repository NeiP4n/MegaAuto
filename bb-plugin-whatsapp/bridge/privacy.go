package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"go.mau.fi/whatsmeow/types"
)

// Per-session privacy settings, persisted next to the session store.
type privacySettings struct {
	AppearOffline bool `json:"appear_offline"`
}

func privacyPath(storeDir string) string {
	return filepath.Join(storeDir, "privacy.json")
}

func loadPrivacy(storeDir string) privacySettings {
	var p privacySettings
	if data, err := os.ReadFile(privacyPath(storeDir)); err == nil {
		_ = json.Unmarshal(data, &p)
	}
	return p
}

func savePrivacy(storeDir string, p privacySettings) error {
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(privacyPath(storeDir), data, 0644)
}

// applyPresence pushes the current privacy presence to WhatsApp when the
// session is connected. Note: the bridge never sends read receipts at all
// (MarkRead is never called), so reading chats here never marks them read;
// this toggle controls the online/last-seen presence.
func (s *Session) applyPresence() {
	if s.Client == nil || !s.Client.IsConnected() {
		return
	}
	state := types.PresenceAvailable
	if s.appearOffline.Load() {
		state = types.PresenceUnavailable
	}
	if err := s.Client.SendPresence(context.Background(), state); err != nil {
		s.logger.Warnf("Session %s: failed to set presence %s: %v", s.ID, state, err)
	} else {
		s.logger.Infof("Session %s: presence set to %s", s.ID, state)
	}
}
