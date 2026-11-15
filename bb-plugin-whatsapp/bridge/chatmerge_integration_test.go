package main

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	waAdv "go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/util/keys"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
	_ "github.com/mattn/go-sqlite3"
)

// Integration test against a real whatsmeow sqlstore: the merge relies on
// GetAltJID mapping @lid -> @s.whatsapp.net (and back), so prove that
// direction with the actual LID map implementation.
func TestAltJIDMappingWithRealStore(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "whatsmeow.db")
	container, err := sqlstore.New(ctx, "sqlite3", fmt.Sprintf("file:%s?_foreign_keys=on", dbPath), waLog.Noop)
	if err != nil {
		t.Fatalf("sqlstore.New: %v", err)
	}
	if err := container.Upgrade(ctx); err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	device := container.NewDevice()
	device.ID = &types.JID{User: "639451155496", Device: 1, Server: types.DefaultUserServer}
	device.NoiseKey = keys.NewKeyPair()
	device.IdentityKey = keys.NewKeyPair()
	device.SignedPreKey = &keys.PreKey{KeyPair: *keys.NewKeyPair(), KeyID: 1, Signature: new([64]byte)}
	device.RegistrationID = 1234
	account := &waAdv.ADVSignedDeviceIdentity{
		Details:             make([]byte, 16),
		AccountSignature:    make([]byte, 64),
		AccountSignatureKey: make([]byte, 32),
		DeviceSignature:     make([]byte, 64),
	}
	device.Account = account
	if err := device.Save(ctx); err != nil {
		t.Fatalf("save device: %v", err)
	}

	pn := types.JID{User: "639451155496", Server: types.DefaultUserServer}
	lid := types.JID{User: "24381234567890", Server: types.HiddenUserServer}
	if err := device.LIDs.PutLIDMapping(ctx, lid, pn); err != nil {
		t.Fatalf("PutLIDMapping: %v", err)
	}

	altOfLid, err := device.GetAltJID(ctx, lid)
	if err != nil || altOfLid != pn {
		t.Fatalf("GetAltJID(lid) = %v, %v; want %v", altOfLid, err, pn)
	}
	altOfPN, err := device.GetAltJID(ctx, pn)
	if err != nil || altOfPN != lid {
		t.Fatalf("GetAltJID(pn) = %v, %v; want %v", altOfPN, err, lid)
	}

	// And the merge on top of this real mapping collapses the pair.
	altFn := func(jid string) string {
		parsed, err := types.ParseJID(jid)
		if err != nil {
			return ""
		}
		alt, err := device.GetAltJID(ctx, parsed)
		if err != nil || alt.IsEmpty() {
			return ""
		}
		return alt.String()
	}
	out := mergeAltJIDChats([]chatItem{
		{JID: pn.String(), Name: "Instinct"},
		{JID: lid.String(), Name: "Instinct"},
	}, altFn)
	if len(out) != 1 || out[0].JID != pn.String() {
		t.Fatalf("merge with real store: got %+v", out)
	}
}
