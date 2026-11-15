package main

import (
	"path/filepath"
	"testing"
	"time"

	waProto "go.mau.fi/whatsmeow/binary/proto"
	"google.golang.org/protobuf/proto"
)

// Meta AI (and other bots) stream replies as a chain of message edits: the
// first chunk arrives as a normal message, each continuation as
// editedMessage > protocolMessage(MESSAGE_EDIT) referencing the original ID.

func buildEditWrapper(targetID, newText string) *waProto.Message {
	return &waProto.Message{
		EditedMessage: &waProto.FutureProofMessage{
			Message: &waProto.Message{
				ProtocolMessage: &waProto.ProtocolMessage{
					Type: waProto.ProtocolMessage_MESSAGE_EDIT.Enum(),
					Key: &waProto.MessageKey{
						ID: proto.String(targetID),
					},
					EditedMessage: &waProto.Message{
						Conversation: proto.String(newText),
					},
				},
			},
		},
	}
}

func TestExtractTextFromEditPayload(t *testing.T) {
	wrapper := buildEditWrapper("ORIG123", "Вот одна идея:\n\nБот для бронирования встреч. Полный текст.")
	// whatsmeow's UnwrapRaw strips the outer editedMessage layer, leaving the
	// protocol message; our handler then reads key + edited content.
	inner := wrapper.GetEditedMessage().GetMessage()
	pm := inner.GetProtocolMessage()
	if pm.GetType() != waProto.ProtocolMessage_MESSAGE_EDIT {
		t.Fatalf("expected MESSAGE_EDIT, got %v", pm.GetType())
	}
	if pm.GetKey().GetID() != "ORIG123" {
		t.Fatalf("target ID lost: %q", pm.GetKey().GetID())
	}
	got := extractTextContent(pm.GetEditedMessage())
	if got != "Вот одна идея:\n\nБот для бронирования встреч. Полный текст." {
		t.Fatalf("edited text not extracted: %q", got)
	}
	// The wrapper itself must NOT be mistaken for a storable text message.
	if c := extractTextContent(inner); c != "" {
		t.Fatalf("protocol wrapper must extract as empty, got %q", c)
	}
}

func TestUpdateMessageContent(t *testing.T) {
	store, err := NewMessageStoreAtPath(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	chat := "12345@s.whatsapp.net"
	if err := store.StoreChat(chat, "Meta AI", time.Now()); err != nil {
		t.Fatalf("store chat: %v", err)
	}
	if err := store.StoreMessage("M1", chat, "12345", "first chunk", time.Now(), false, "", "", "", nil, nil, nil, 0, "Meta AI"); err != nil {
		t.Fatalf("store message: %v", err)
	}

	updated, err := store.UpdateMessageContent("M1", chat, "first chunk, now complete")
	if err != nil || !updated {
		t.Fatalf("update failed: updated=%v err=%v", updated, err)
	}
	var content string
	if err := store.db.QueryRow("SELECT content FROM messages WHERE id = ? AND chat_jid = ?", "M1", chat).Scan(&content); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if content != "first chunk, now complete" {
		t.Fatalf("content not updated: %q", content)
	}

	// Unknown target must report "no row" so the caller can insert instead.
	updated, err = store.UpdateMessageContent("NOPE", chat, "x")
	if err != nil {
		t.Fatalf("update unknown: %v", err)
	}
	if updated {
		t.Fatalf("unknown message must not report updated")
	}
}

func TestExtractTextRichContainers(t *testing.T) {
	im := &waProto.Message{
		InteractiveMessage: &waProto.InteractiveMessage{
			Body: &waProto.InteractiveMessage_Body{Text: proto.String("bot body")},
		},
	}
	if got := extractTextContent(im); got != "bot body" {
		t.Fatalf("interactive body: %q", got)
	}
	bm := &waProto.Message{
		ButtonsMessage: &waProto.ButtonsMessage{ContentText: proto.String("buttons text")},
	}
	if got := extractTextContent(bm); got != "buttons text" {
		t.Fatalf("buttons text: %q", got)
	}
}
