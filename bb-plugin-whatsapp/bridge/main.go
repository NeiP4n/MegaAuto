package main

import (
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"syscall"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"bytes"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

// BuildSHA is stamped by CI (-ldflags "-X main.BuildSHA=<sha>") so the
// plugin can tell which commit the running binary was built from and
// auto-update it from the rolling GitHub release. Empty for local builds.
var BuildSHA = ""

// Message represents a chat message for our client
type Message struct {
	Time      time.Time
	Sender    string
	Content   string
	IsFromMe  bool
	MediaType string
	Filename  string
}

// Database handler for storing message history
type MessageStore struct {
	db *sql.DB
}

// Initialize message store at specified path
func NewMessageStoreAtPath(dbPath string) (*MessageStore, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create store directory: %v", err)
	}

	db, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?_foreign_keys=on", dbPath))
	if err != nil {
		return nil, fmt.Errorf("failed to open message database: %v", err)
	}

	// Create tables if they don't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS chats (
			jid TEXT PRIMARY KEY,
			name TEXT,
			last_message_time TIMESTAMP
		);
		
		CREATE TABLE IF NOT EXISTS messages (
			id TEXT,
			chat_jid TEXT,
			sender TEXT,
			content TEXT,
			timestamp TIMESTAMP,
			is_from_me BOOLEAN,
			media_type TEXT,
			filename TEXT,
			url TEXT,
			media_key BLOB,
			file_sha256 BLOB,
			file_enc_sha256 BLOB,
			file_length INTEGER,
			PRIMARY KEY (id, chat_jid),
			FOREIGN KEY (chat_jid) REFERENCES chats(jid)
		);
	`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to create tables: %v", err)
	}

	// Migration: remember each sender's push name so display names survive
	// even when the contact store has not synced yet.
	if _, err := db.Exec("ALTER TABLE messages ADD COLUMN push_name TEXT NOT NULL DEFAULT ''"); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			db.Close()
			return nil, fmt.Errorf("failed to migrate messages table: %v", err)
		}
	}

	return &MessageStore{db: db}, nil
}

// Initialize default message store
func NewMessageStore() (*MessageStore, error) {
	return NewMessageStoreAtPath("store/messages.db")
}

// Close the database connection
func (store *MessageStore) Close() error {
	return store.db.Close()
}

// Store a chat in the database with intelligent name preservation
func (store *MessageStore) StoreChat(jid, name string, lastMessageTime time.Time) error {
	_, err := store.db.Exec(`
		INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			last_message_time = excluded.last_message_time,
			name = CASE
				WHEN excluded.name != '' AND (chats.name IS NULL OR chats.name = '' OR chats.name = chats.jid OR chats.name GLOB '[0-9]*' OR chats.name GLOB '+[0-9]*') THEN excluded.name
				WHEN excluded.name != '' AND NOT (excluded.name GLOB '[0-9]*' OR excluded.name GLOB '+[0-9]*') THEN excluded.name
				ELSE chats.name
			END
	`, jid, name, lastMessageTime)
	return err
}

// Store a message in the database
func (store *MessageStore) StoreMessage(id, chatJID, sender, content string, timestamp time.Time, isFromMe bool,
	mediaType, filename, url string, mediaKey, fileSHA256, fileEncSHA256 []byte, fileLength uint64, pushName string) error {
	// Only store if there's actual content or media
	if content == "" && mediaType == "" {
		return nil
	}

	_, err := store.db.Exec(
		`INSERT OR REPLACE INTO messages 
		(id, chat_jid, sender, content, timestamp, is_from_me, media_type, filename, url, media_key, file_sha256, file_enc_sha256, file_length, push_name) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, chatJID, sender, content, timestamp, isFromMe, mediaType, filename, url, mediaKey, fileSHA256, fileEncSHA256, fileLength, pushName,
	)
	return err
}

// Get messages from a chat
func (store *MessageStore) GetMessages(chatJID string, limit int) ([]Message, error) {
	rows, err := store.db.Query(
		"SELECT sender, content, timestamp, is_from_me, media_type, filename FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT ?",
		chatJID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		var timestamp time.Time
		err := rows.Scan(&msg.Sender, &msg.Content, &timestamp, &msg.IsFromMe, &msg.MediaType, &msg.Filename)
		if err != nil {
			return nil, err
		}
		msg.Time = timestamp
		messages = append(messages, msg)
	}

	return messages, nil
}

// Get all chats
func (store *MessageStore) GetChats() (map[string]time.Time, error) {
	rows, err := store.db.Query("SELECT jid, last_message_time FROM chats ORDER BY last_message_time DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	chats := make(map[string]time.Time)
	for rows.Next() {
		var jid string
		var lastMessageTime time.Time
		err := rows.Scan(&jid, &lastMessageTime)
		if err != nil {
			return nil, err
		}
		chats[jid] = lastMessageTime
	}

	return chats, nil
}

// Extract text content from a message
func extractTextContent(msg *waProto.Message) string {
	if msg == nil {
		return ""
	}

	// Try to get text content
	if text := msg.GetConversation(); text != "" {
		return text
	} else if extendedText := msg.GetExtendedTextMessage(); extendedText != nil {
		return extendedText.GetText()
	}

	// For now, we're ignoring non-text messages
	return ""
}

// SendMessageResponse represents the response for the send message API
type SendMessageResponse struct {
	Success   bool      `json:"success"`
	Message   string    `json:"message"`
	ID        string    `json:"id,omitempty"`
	Timestamp time.Time `json:"timestamp,omitempty"`
	ChatJID   string    `json:"chat_jid,omitempty"`
}

// SendMessageRequest represents the request body for the send message API
type SendMessageRequest struct {
	Recipient string `json:"recipient"`
	Message   string `json:"message"`
	MediaPath string `json:"media_path,omitempty"`
}

// Function to send a WhatsApp message and persist it immediately to local SQLite
func sendWhatsAppMessage(client *whatsmeow.Client, messageStore *MessageStore, recipient string, message string, mediaPath string, logger waLog.Logger) (bool, string, string, time.Time, string) {
	if !client.IsConnected() {
		return false, "Not connected to WhatsApp", "", time.Time{}, ""
	}

	// Create JID for recipient
	var recipientJID types.JID
	var err error

	// Check if recipient is a JID
	isJID := strings.Contains(recipient, "@")

	if isJID {
		// Parse the JID string
		recipientJID, err = types.ParseJID(recipient)
		if err != nil {
			return false, fmt.Sprintf("Error parsing JID: %v", err), "", time.Time{}, ""
		}
	} else {
		// Clean number and create JID from phone number
		cleanNumber := strings.TrimPrefix(recipient, "+")
		cleanNumber = strings.ReplaceAll(cleanNumber, " ", "")
		cleanNumber = strings.ReplaceAll(cleanNumber, "-", "")
		recipientJID = types.JID{
			User:   cleanNumber,
			Server: "s.whatsapp.net", // For personal chats
		}
	}

	msg := &waProto.Message{}

	// Check if we have media to send
	if mediaPath != "" {
		// Read media file
		mediaData, err := os.ReadFile(mediaPath)
		if err != nil {
			return false, fmt.Sprintf("Error reading media file: %v", err), "", time.Time{}, ""
		}

		// Determine media type and mime type based on file extension
		fileExt := strings.ToLower(mediaPath[strings.LastIndex(mediaPath, ".")+1:])
		var mediaType whatsmeow.MediaType
		var mimeType string

		// Handle different media types
		switch fileExt {
		// Image types
		case "jpg", "jpeg":
			mediaType = whatsmeow.MediaImage
			mimeType = "image/jpeg"
		case "png":
			mediaType = whatsmeow.MediaImage
			mimeType = "image/png"
		case "gif":
			mediaType = whatsmeow.MediaImage
			mimeType = "image/gif"
		case "webp":
			mediaType = whatsmeow.MediaImage
			mimeType = "image/webp"

		// Audio types
		case "ogg":
			mediaType = whatsmeow.MediaAudio
			mimeType = "audio/ogg; codecs=opus"

		// Video types
		case "mp4":
			mediaType = whatsmeow.MediaVideo
			mimeType = "video/mp4"
		case "avi":
			mediaType = whatsmeow.MediaVideo
			mimeType = "video/avi"
		case "mov":
			mediaType = whatsmeow.MediaVideo
			mimeType = "video/quicktime"

		// Document types (for any other file type)
		default:
			mediaType = whatsmeow.MediaDocument
			mimeType = "application/octet-stream"
		}

		// Upload media to WhatsApp servers
		resp, err := client.Upload(context.Background(), mediaData, mediaType)
		if err != nil {
			return false, fmt.Sprintf("Error uploading media: %v", err), "", time.Time{}, ""
		}

		fmt.Println("Media uploaded", resp)

		// Create the appropriate message type based on media type
		switch mediaType {
		case whatsmeow.MediaImage:
			msg.ImageMessage = &waProto.ImageMessage{
				Caption:       proto.String(message),
				Mimetype:      proto.String(mimeType),
				URL:           &resp.URL,
				DirectPath:    &resp.DirectPath,
				MediaKey:      resp.MediaKey,
				FileEncSHA256: resp.FileEncSHA256,
				FileSHA256:    resp.FileSHA256,
				FileLength:    &resp.FileLength,
			}
		case whatsmeow.MediaAudio:
			// Handle ogg audio files
			var seconds uint32 = 30 // Default fallback
			var waveform []byte = nil

			// Try to analyze the ogg file
			if strings.Contains(mimeType, "ogg") {
				analyzedSeconds, analyzedWaveform, err := analyzeOggOpus(mediaData)
				if err == nil {
					seconds = analyzedSeconds
					waveform = analyzedWaveform
				} else {
					return false, fmt.Sprintf("Failed to analyze Ogg Opus file: %v", err), "", time.Time{}, ""
				}
			} else {
				fmt.Printf("Not an Ogg Opus file: %s\n", mimeType)
			}

			msg.AudioMessage = &waProto.AudioMessage{
				Mimetype:      proto.String(mimeType),
				URL:           &resp.URL,
				DirectPath:    &resp.DirectPath,
				MediaKey:      resp.MediaKey,
				FileEncSHA256: resp.FileEncSHA256,
				FileSHA256:    resp.FileSHA256,
				FileLength:    &resp.FileLength,
				Seconds:       proto.Uint32(seconds),
				PTT:           proto.Bool(true),
				Waveform:      waveform,
			}
		case whatsmeow.MediaVideo:
			msg.VideoMessage = &waProto.VideoMessage{
				Caption:       proto.String(message),
				Mimetype:      proto.String(mimeType),
				URL:           &resp.URL,
				DirectPath:    &resp.DirectPath,
				MediaKey:      resp.MediaKey,
				FileEncSHA256: resp.FileEncSHA256,
				FileSHA256:    resp.FileSHA256,
				FileLength:    &resp.FileLength,
			}
		case whatsmeow.MediaDocument:
			msg.DocumentMessage = &waProto.DocumentMessage{
				Title:         proto.String(mediaPath[strings.LastIndex(mediaPath, "/")+1:]),
				Caption:       proto.String(message),
				Mimetype:      proto.String(mimeType),
				URL:           &resp.URL,
				DirectPath:    &resp.DirectPath,
				MediaKey:      resp.MediaKey,
				FileEncSHA256: resp.FileEncSHA256,
				FileSHA256:    resp.FileSHA256,
				FileLength:    &resp.FileLength,
			}
		}
	} else {
		msg.Conversation = proto.String(message)
	}

	// Send message
	resp, err := client.SendMessage(context.Background(), recipientJID, msg)
	if err != nil {
		return false, fmt.Sprintf("Error sending message: %v", err), "", time.Time{}, ""
	}

	msgID := resp.ID
	if msgID == "" {
		msgID = fmt.Sprintf("out-%d", time.Now().UnixNano())
	}
	msgTimestamp := resp.Timestamp
	if msgTimestamp.IsZero() {
		msgTimestamp = time.Now()
	}

	sender := ""
	if client.Store != nil && client.Store.ID != nil {
		sender = client.Store.ID.User
	}

	mediaTypeStr := ""
	filenameStr := ""
	if mediaPath != "" {
		mediaTypeStr = filepath.Ext(mediaPath)
		filenameStr = filepath.Base(mediaPath)
	}

	// Target chat JID to store message under
	targetChatJID := recipient
	if !strings.Contains(recipient, "@") {
		targetChatJID = recipientJID.String()
	}

	// Immediately store outgoing message into local database so it never disappears
	if messageStore != nil {
		err = messageStore.StoreMessage(
			msgID,
			targetChatJID,
			sender,
			message,
			msgTimestamp,
			true, // is_from_me = true
			mediaTypeStr,
			filenameStr,
			"",
			nil,
			nil,
			nil,
			0,
			"",
		)
		if err != nil && logger != nil {
			logger.Warnf("Failed to store sent message in DB: %v", err)
		}

		// Ensure chat exists and update last_message_time
		chatName := GetChatName(client, messageStore, recipientJID, targetChatJID, nil, "", logger)
		_ = messageStore.StoreChat(targetChatJID, chatName, msgTimestamp)
	}

	return true, fmt.Sprintf("Message sent to %s", recipient), msgID, msgTimestamp, targetChatJID
}

// Extract media info from a message
func extractMediaInfo(msg *waProto.Message) (mediaType string, filename string, url string, mediaKey []byte, fileSHA256 []byte, fileEncSHA256 []byte, fileLength uint64) {
	if msg == nil {
		return "", "", "", nil, nil, nil, 0
	}

	// Check for image message
	if img := msg.GetImageMessage(); img != nil {
		return "image", "image_" + time.Now().Format("20060102_150405") + ".jpg",
			img.GetURL(), img.GetMediaKey(), img.GetFileSHA256(), img.GetFileEncSHA256(), img.GetFileLength()
	}

	// Check for video message
	if vid := msg.GetVideoMessage(); vid != nil {
		return "video", "video_" + time.Now().Format("20060102_150405") + ".mp4",
			vid.GetURL(), vid.GetMediaKey(), vid.GetFileSHA256(), vid.GetFileEncSHA256(), vid.GetFileLength()
	}

	// Check for audio message
	if aud := msg.GetAudioMessage(); aud != nil {
		return "audio", "audio_" + time.Now().Format("20060102_150405") + ".ogg",
			aud.GetURL(), aud.GetMediaKey(), aud.GetFileSHA256(), aud.GetFileEncSHA256(), aud.GetFileLength()
	}

	// Check for document message
	if doc := msg.GetDocumentMessage(); doc != nil {
		filename := doc.GetFileName()
		if filename == "" {
			filename = "document_" + time.Now().Format("20060102_150405")
		}
		return "document", filename,
			doc.GetURL(), doc.GetMediaKey(), doc.GetFileSHA256(), doc.GetFileEncSHA256(), doc.GetFileLength()
	}

	return "", "", "", nil, nil, nil, 0
}

// Handle regular incoming messages with media support
func handleMessage(client *whatsmeow.Client, messageStore *MessageStore, msg *events.Message, logger waLog.Logger) {
	// Save message to database
	chatJID := msg.Info.Chat.String()
	sender := msg.Info.Sender.User

	// Get appropriate chat name (pass pushName to resolve real contact names)
	name := GetChatName(client, messageStore, msg.Info.Chat, chatJID, nil, msg.Info.PushName, logger)

	// Update chat in database with the message timestamp (keeps last message time updated)
	err := messageStore.StoreChat(chatJID, name, msg.Info.Timestamp)
	if err != nil {
		logger.Warnf("Failed to store chat: %v", err)
	}

	// Extract text content
	content := extractTextContent(msg.Message)

	// Extract media info
	mediaType, filename, url, mediaKey, fileSHA256, fileEncSHA256, fileLength := extractMediaInfo(msg.Message)

	// Skip if there's no content and no media
	if content == "" && mediaType == "" {
		return
	}

	// Store message in database
	err = messageStore.StoreMessage(
		msg.Info.ID,
		chatJID,
		sender,
		content,
		msg.Info.Timestamp,
		msg.Info.IsFromMe,
		mediaType,
		filename,
		url,
		mediaKey,
		fileSHA256,
		fileEncSHA256,
		fileLength,
		msg.Info.PushName,
	)

	if err != nil {
		logger.Warnf("Failed to store message: %v", err)
	} else {
		// Log message reception
		timestamp := msg.Info.Timestamp.Format("2006-01-02 15:04:05")
		direction := "←"
		if msg.Info.IsFromMe {
			direction = "→"
		}

		// Log based on message type
		if mediaType != "" {
			fmt.Printf("[%s] %s %s: [%s: %s] %s\n", timestamp, direction, sender, mediaType, filename, content)
		} else if content != "" {
			fmt.Printf("[%s] %s %s: %s\n", timestamp, direction, sender, content)
		}
	}
}

// DownloadMediaRequest represents the request body for the download media API
type DownloadMediaRequest struct {
	MessageID string `json:"message_id"`
	ChatJID   string `json:"chat_jid"`
}

// DownloadMediaResponse represents the response for the download media API
type DownloadMediaResponse struct {
	Success  bool   `json:"success"`
	Message  string `json:"message"`
	Filename string `json:"filename,omitempty"`
	Path     string `json:"path,omitempty"`
}

// Store additional media info in the database
func (store *MessageStore) StoreMediaInfo(id, chatJID, url string, mediaKey, fileSHA256, fileEncSHA256 []byte, fileLength uint64) error {
	_, err := store.db.Exec(
		"UPDATE messages SET url = ?, media_key = ?, file_sha256 = ?, file_enc_sha256 = ?, file_length = ? WHERE id = ? AND chat_jid = ?",
		url, mediaKey, fileSHA256, fileEncSHA256, fileLength, id, chatJID,
	)
	return err
}

// Get media info from the database
func (store *MessageStore) GetMediaInfo(id, chatJID string) (string, string, string, []byte, []byte, []byte, uint64, error) {
	var mediaType, filename, url string
	var mediaKey, fileSHA256, fileEncSHA256 []byte
	var fileLength uint64

	err := store.db.QueryRow(
		"SELECT media_type, filename, url, media_key, file_sha256, file_enc_sha256, file_length FROM messages WHERE id = ? AND chat_jid = ?",
		id, chatJID,
	).Scan(&mediaType, &filename, &url, &mediaKey, &fileSHA256, &fileEncSHA256, &fileLength)

	return mediaType, filename, url, mediaKey, fileSHA256, fileEncSHA256, fileLength, err
}

// MediaDownloader implements the whatsmeow.DownloadableMessage interface
type MediaDownloader struct {
	URL           string
	DirectPath    string
	MediaKey      []byte
	FileLength    uint64
	FileSHA256    []byte
	FileEncSHA256 []byte
	MediaType     whatsmeow.MediaType
}

// GetDirectPath implements the DownloadableMessage interface
func (d *MediaDownloader) GetDirectPath() string {
	return d.DirectPath
}

// GetURL implements the DownloadableMessage interface
func (d *MediaDownloader) GetURL() string {
	return d.URL
}

// GetMediaKey implements the DownloadableMessage interface
func (d *MediaDownloader) GetMediaKey() []byte {
	return d.MediaKey
}

// GetFileLength implements the DownloadableMessage interface
func (d *MediaDownloader) GetFileLength() uint64 {
	return d.FileLength
}

// GetFileSHA256 implements the DownloadableMessage interface
func (d *MediaDownloader) GetFileSHA256() []byte {
	return d.FileSHA256
}

// GetFileEncSHA256 implements the DownloadableMessage interface
func (d *MediaDownloader) GetFileEncSHA256() []byte {
	return d.FileEncSHA256
}

// GetMediaType implements the DownloadableMessage interface
func (d *MediaDownloader) GetMediaType() whatsmeow.MediaType {
	return d.MediaType
}

// Function to download media from a message
func downloadMedia(client *whatsmeow.Client, messageStore *MessageStore, messageID, chatJID string) (bool, string, string, string, error) {
	// Query the database for the message
	var mediaType, filename, url string
	var mediaKey, fileSHA256, fileEncSHA256 []byte
	var fileLength uint64
	var err error

	// First, check if we already have this file
	chatDir := fmt.Sprintf("store/%s", strings.ReplaceAll(chatJID, ":", "_"))
	localPath := ""

	// Get media info from the database
	mediaType, filename, url, mediaKey, fileSHA256, fileEncSHA256, fileLength, err = messageStore.GetMediaInfo(messageID, chatJID)

	if err != nil {
		// Try to get basic info if extended info isn't available
		err = messageStore.db.QueryRow(
			"SELECT media_type, filename FROM messages WHERE id = ? AND chat_jid = ?",
			messageID, chatJID,
		).Scan(&mediaType, &filename)

		if err != nil {
			return false, "", "", "", fmt.Errorf("failed to find message: %v", err)
		}
	}

	// Check if this is a media message
	if mediaType == "" {
		return false, "", "", "", fmt.Errorf("not a media message")
	}

	// Create directory for the chat if it doesn't exist
	if err := os.MkdirAll(chatDir, 0755); err != nil {
		return false, "", "", "", fmt.Errorf("failed to create chat directory: %v", err)
	}

	// Generate a local path for the file
	localPath = fmt.Sprintf("%s/%s", chatDir, filename)

	// Get absolute path
	absPath, err := filepath.Abs(localPath)
	if err != nil {
		return false, "", "", "", fmt.Errorf("failed to get absolute path: %v", err)
	}

	// Check if file already exists
	if _, err := os.Stat(localPath); err == nil {
		// File exists, return it
		return true, mediaType, filename, absPath, nil
	}

	// If we don't have all the media info we need, we can't download
	if url == "" || len(mediaKey) == 0 || len(fileSHA256) == 0 || len(fileEncSHA256) == 0 || fileLength == 0 {
		return false, "", "", "", fmt.Errorf("incomplete media information for download")
	}

	fmt.Printf("Attempting to download media for message %s in chat %s...\n", messageID, chatJID)

	// Extract direct path from URL
	directPath := extractDirectPathFromURL(url)

	// Create a downloader that implements DownloadableMessage
	var waMediaType whatsmeow.MediaType
	switch mediaType {
	case "image":
		waMediaType = whatsmeow.MediaImage
	case "video":
		waMediaType = whatsmeow.MediaVideo
	case "audio":
		waMediaType = whatsmeow.MediaAudio
	case "document":
		waMediaType = whatsmeow.MediaDocument
	default:
		return false, "", "", "", fmt.Errorf("unsupported media type: %s", mediaType)
	}

	downloader := &MediaDownloader{
		URL:           url,
		DirectPath:    directPath,
		MediaKey:      mediaKey,
		FileLength:    fileLength,
		FileSHA256:    fileSHA256,
		FileEncSHA256: fileEncSHA256,
		MediaType:     waMediaType,
	}

	// Download the media using whatsmeow client
	mediaData, err := client.Download(context.Background(), downloader)
	if err != nil {
		return false, "", "", "", fmt.Errorf("failed to download media: %v", err)
	}

	// Save the downloaded media to file
	if err := os.WriteFile(localPath, mediaData, 0644); err != nil {
		return false, "", "", "", fmt.Errorf("failed to save media file: %v", err)
	}

	fmt.Printf("Successfully downloaded %s media to %s (%d bytes)\n", mediaType, absPath, len(mediaData))
	return true, mediaType, filename, absPath, nil
}

// Extract direct path from a WhatsApp media URL
func extractDirectPathFromURL(url string) string {
	// The direct path is typically in the URL, we need to extract it
	// Example URL: https://mmg.whatsapp.net/v/t62.7118-24/13812002_698058036224062_3424455886509161511_n.enc?ccb=11-4&oh=...

	// Find the path part after the domain
	parts := strings.SplitN(url, ".net/", 2)
	if len(parts) < 2 {
		return url // Return original URL if parsing fails
	}

	pathPart := parts[1]

	// Remove query parameters
	pathPart = strings.SplitN(pathPart, "?", 2)[0]

	// Create proper direct path format
	return "/" + pathPart
}

// Helper: check if string is empty or contains only numeric digits
// isRawNumberName reports whether a display name is just a bare phone number
// (with or without a leading +), i.e. not a real name worth keeping.
func isRawNumberName(s string) bool {
	return isAllDigits(strings.TrimPrefix(s, "+"))
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// ResolveContactName resolves human-friendly contact name / nickname from WhatsApp stores
func ResolveContactName(client *whatsmeow.Client, jid types.JID, fallbackPushName string) string {
	if jid.IsEmpty() {
		return ""
	}

	// 1. Group chats
	if jid.Server == "g.us" {
		if client != nil {
			groupInfo, err := client.GetGroupInfo(context.Background(), jid)
			if err == nil && groupInfo != nil && groupInfo.Name != "" {
				return groupInfo.Name
			}
		}
		return fmt.Sprintf("Group %s", jid.User)
	}

	ctx := context.Background()

	// 2. Direct contact lookup in client.Store.Contacts
	if client != nil && client.Store != nil {
		if client.Store.Contacts != nil {
			contact, err := client.Store.Contacts.GetContact(ctx, jid)
			if err == nil && contact.Found {
				if contact.FullName != "" {
					return contact.FullName
				}
				if contact.BusinessName != "" {
					return contact.BusinessName
				}
				if contact.PushName != "" {
					return contact.PushName
				}
				if contact.FirstName != "" {
					return contact.FirstName
				}
			}
		}

		// 3. If LID or PN, check AltJID
		altJID, altErr := client.Store.GetAltJID(ctx, jid)
		if altErr == nil && !altJID.IsEmpty() {
			if client.Store.Contacts != nil {
				altContact, cErr := client.Store.Contacts.GetContact(ctx, altJID)
				if cErr == nil && altContact.Found {
					if altContact.FullName != "" {
						return altContact.FullName
					}
					if altContact.BusinessName != "" {
						return altContact.BusinessName
					}
					if altContact.PushName != "" {
						return altContact.PushName
					}
					if altContact.FirstName != "" {
						return altContact.FirstName
					}
				}
			}
			if isAllDigits(altJID.User) && altJID.Server == "s.whatsapp.net" {
				if fallbackPushName != "" && !isAllDigits(fallbackPushName) {
					return fallbackPushName
				}
				return "+" + altJID.User
			}
		}

		// Check if this is self
		if client.Store.ID != nil {
			if jid.User == client.Store.ID.User || (!altJID.IsEmpty() && altJID.User == client.Store.ID.User) {
				return "You (Saved Messages)"
			}
		}
	}

	// 4. Fallback to passed pushName if not digits
	if fallbackPushName != "" && !isAllDigits(fallbackPushName) {
		return fallbackPushName
	}

	// 5. Phone number format
	if isAllDigits(jid.User) && jid.Server == "s.whatsapp.net" {
		return "+" + jid.User
	}

	return jid.User
}

// GetChatName determines the appropriate name for a chat based on JID and other info
func GetChatName(client *whatsmeow.Client, messageStore *MessageStore, jid types.JID, chatJID string, conversation interface{}, pushName string, logger waLog.Logger) string {
	// First, check if chat already exists in database with a real non-digit name
	if messageStore != nil && messageStore.db != nil {
		var existingName string
		err := messageStore.db.QueryRow("SELECT name FROM chats WHERE jid = ?", chatJID).Scan(&existingName)
		if err == nil && existingName != "" && !isRawNumberName(existingName) && existingName != chatJID && existingName != jid.User {
			return existingName
		}
	}

	var name string

	if jid.Server == "g.us" {
		if conversation != nil {
			v := reflect.ValueOf(conversation)
			if v.Kind() == reflect.Ptr && !v.IsNil() {
				v = v.Elem()
				if displayNameField := v.FieldByName("DisplayName"); displayNameField.IsValid() && displayNameField.Kind() == reflect.Ptr && !displayNameField.IsNil() {
					dn := displayNameField.Elem().String()
					if dn != "" {
						name = dn
					}
				}
				if name == "" {
					if nameField := v.FieldByName("Name"); nameField.IsValid() && nameField.Kind() == reflect.Ptr && !nameField.IsNil() {
						n := nameField.Elem().String()
						if n != "" {
							name = n
						}
					}
				}
			}
		}
		if name == "" && client != nil {
			groupInfo, err := client.GetGroupInfo(context.Background(), jid)
			if err == nil && groupInfo != nil && groupInfo.Name != "" {
				name = groupInfo.Name
			}
		}
		if name == "" {
			name = fmt.Sprintf("Group %s", jid.User)
		}
	} else {
		name = ResolveContactName(client, jid, pushName)
	}

	return name
}

// RefreshChatNames updates any chat in chats table that currently has an empty or raw digits name
func (store *MessageStore) RefreshChatNames(client *whatsmeow.Client, logger waLog.Logger) {
	if store == nil || store.db == nil || client == nil {
		return
	}
	rows, err := store.db.Query("SELECT jid, name FROM chats")
	if err != nil {
		return
	}
	defer rows.Close()

	type chatToUpdate struct {
		jid     string
		newName string
	}
	var updates []chatToUpdate

	for rows.Next() {
		var jidStr, currName string
		if err := rows.Scan(&jidStr, &currName); err != nil {
			continue
		}
		if currName == "" || currName == jidStr || isRawNumberName(currName) {
			parsedJID, err := types.ParseJID(jidStr)
			if err != nil {
				continue
			}
			resolved := ResolveContactName(client, parsedJID, "")
			// Contact store may not have synced yet; fall back to the push
			// name observed on incoming messages in this chat.
			if (resolved == "" || isRawNumberName(resolved)) && parsedJID.Server != "g.us" {
				var pn string
				if qErr := store.db.QueryRow(
					"SELECT push_name FROM messages WHERE chat_jid = ? AND is_from_me = 0 AND push_name != '' ORDER BY timestamp DESC LIMIT 1",
					jidStr,
				).Scan(&pn); qErr == nil && pn != "" && !isRawNumberName(pn) {
					resolved = pn
				}
			}
			if resolved != "" && resolved != currName {
				updates = append(updates, chatToUpdate{jid: jidStr, newName: resolved})
			}
		}
	}

	for _, u := range updates {
		_, _ = store.db.Exec("UPDATE chats SET name = ? WHERE jid = ?", u.newName, u.jid)
		if logger != nil {
			logger.Infof("Refreshed chat name for %s: %s", u.jid, u.newName)
		}
	}
}

// corsMiddleware answers browser preflights and lets the Blackbox web UI reach
// this loopback-only API from its own origin.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Session-ID")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// restMsgItem is the JSON shape served by the message endpoints.
type restMsgItem struct {
	ID         string    `json:"id"`
	ChatJID    string    `json:"chat_jid"`
	Sender     string    `json:"sender"`
	SenderName string    `json:"sender_name"`
	Content    string    `json:"content"`
	Timestamp  time.Time `json:"timestamp"`
	IsFromMe   bool      `json:"is_from_me"`
	MediaType  string    `json:"media_type"`
	Filename   string    `json:"filename"`
	URL        string    `json:"url"`
	FileLength int64     `json:"file_length"`
	PushName   string    `json:"-"`
}

// scanMsgRows reads message rows and resolves sender display names.
func scanMsgRows(sess *Session, rows *sql.Rows) []restMsgItem {
	defer rows.Close()
	var msgs []restMsgItem
	for rows.Next() {
		var m restMsgItem
		if err := rows.Scan(&m.ID, &m.ChatJID, &m.Sender, &m.Content, &m.Timestamp, &m.IsFromMe, &m.MediaType, &m.Filename, &m.URL, &m.FileLength, &m.PushName); err != nil {
			continue
		}
		if m.IsFromMe {
			m.SenderName = "You"
		} else {
			if sJID, err := types.ParseJID(m.Sender); err == nil {
				m.SenderName = ResolveContactName(sess.Client, sJID, "")
			} else if isAllDigits(m.Sender) {
				m.SenderName = ResolveContactName(sess.Client, types.JID{User: m.Sender, Server: "s.whatsapp.net"}, "")
			} else {
				m.SenderName = m.Sender
			}
			// Prefer the sender's own push name over a bare number.
			if (m.SenderName == "" || isRawNumberName(m.SenderName)) && m.PushName != "" && !isRawNumberName(m.PushName) {
				m.SenderName = m.PushName
			}
		}
		msgs = append(msgs, m)
	}
	if msgs == nil {
		msgs = []restMsgItem{}
	}
	return msgs
}

// altJID returns the alternate JID (LID <-> phone) for a chat JID, or "".
func altJID(sess *Session, chatJID string) string {
	parsed, err := types.ParseJID(chatJID)
	if err != nil || sess.Client == nil || sess.Client.Store == nil {
		return ""
	}
	alt, err := sess.Client.Store.GetAltJID(context.Background(), parsed)
	if err != nil || alt.IsEmpty() {
		return ""
	}
	return alt.String()
}

const msgColumns = `id, chat_jid, sender, content, timestamp, is_from_me,
	COALESCE(media_type, ''), COALESCE(filename, ''), COALESCE(url, ''), COALESCE(file_length, 0), COALESCE(push_name, '')`

// Start a REST API server with Multi-Account / Multi-Session support
// The listener must be bound by the caller BEFORE any session connects:
// the port doubles as the single-instance lock. Two bridge processes with the
// same store dirs fight over the same WhatsApp device keys (StreamReplaced)
// until WhatsApp force-logs the account out.
func startRESTServer(sm *SessionManager, listener net.Listener) {
	// Helper to extract requested session or active session
	getSession := func(r *http.Request) *Session {
		sid := r.URL.Query().Get("session")
		if sid == "" {
			sid = r.Header.Get("X-Session-ID")
		}
		return sm.LookupSession(sid)
	}

	mux := http.NewServeMux()

	// 1. Sessions list endpoint
	mux.HandleFunc("/api/sessions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		if r.Method == http.MethodGet {
			list := sm.ListSessions()
			json.NewEncoder(w).Encode(list)
			return
		}

		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	})

	// 2. Create new session endpoint
	mux.HandleFunc("/api/sessions/create", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Name string `json:"name"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)

		sessInfo, err := sm.CreateSession(req.Name)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"session": sessInfo,
		})
	})

	// 3. Switch active session endpoint
	mux.HandleFunc("/api/sessions/switch", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			SessionID string `json:"session_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SessionID == "" {
			http.Error(w, "session_id is required", http.StatusBadRequest)
			return
		}

		if err := sm.SetActive(req.SessionID); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"active":  req.SessionID,
		})
	})

	// 3b. Restart a session's client in place (retry pairing, recover stuck)
	mux.HandleFunc("/api/sessions/restart", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			SessionID string `json:"session_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SessionID == "" {
			http.Error(w, "session_id is required", http.StatusBadRequest)
			return
		}

		info, err := sm.RestartSession(req.SessionID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"session": info,
		})
	})

	// 4. Delete session endpoint
	mux.HandleFunc("/api/sessions/delete", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			SessionID string `json:"session_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SessionID == "" {
			http.Error(w, "session_id is required", http.StatusBadRequest)
			return
		}

		if err := sm.DeleteSession(req.SessionID); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
		})
	})

	// 5. Status endpoint for Blackbox UI and agent tools
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		sess := getSession(r)
		if sess == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":      "disconnected",
				"connected":   false,
				"phone":       "",
				"qr":          "",
				"build":       BuildSHA,
				"server_time": time.Now().Format(time.RFC3339),
				"sessions":    sm.ListSessions(),
			})
			return
		}

		info := sess.GetInfo(sess.ID == sm.activeID)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"session_id":  sess.ID,
			"name":        info.Name,
			"status":      info.Status,
			"connected":   info.Connected,
			"phone":       info.Phone,
			"qr":          info.QR,
			"error":       info.Error,
			"build":       BuildSHA,
			"server_time": time.Now().Format(time.RFC3339),
			"sessions":    sm.ListSessions(),
		})
	})

	// 6. Chats endpoint for UI
	mux.HandleFunc("/api/chats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		sess := getSession(r)
		if sess == nil || sess.MessageStore == nil {
			json.NewEncoder(w).Encode([]interface{}{})
			return
		}

		query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("query")))

		// Auto refresh unresolved chat names in background, throttled: the UI
		// polls this endpoint every few seconds.
		sess.maybeRefreshChatNames()

		rows, err := sess.MessageStore.db.Query(`
			SELECT c.jid, COALESCE(c.name, c.jid) as name, c.last_message_time,
			       COALESCE((SELECT content FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), '') as last_msg,
			       COALESCE((SELECT sender FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), '') as last_sender,
			       COALESCE((SELECT is_from_me FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), 0) as last_is_from_me
			FROM chats c
			ORDER BY last_message_time DESC LIMIT 100
		`)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type ChatItem struct {
			JID             string    `json:"jid"`
			Name            string    `json:"name"`
			LastMessageTime time.Time `json:"last_message_time"`
			LastMessage     string    `json:"last_message"`
			LastSender      string    `json:"last_sender"`
			LastIsFromMe    bool      `json:"last_is_from_me"`
		}
		var list []ChatItem
		for rows.Next() {
			var item ChatItem
			if err := rows.Scan(&item.JID, &item.Name, &item.LastMessageTime, &item.LastMessage, &item.LastSender, &item.LastIsFromMe); err == nil {
				// If name is all digits or equals JID, resolve in-memory immediately
				if item.Name == "" || item.Name == item.JID || isRawNumberName(item.Name) {
					if parsed, pErr := types.ParseJID(item.JID); pErr == nil {
						resolved := ResolveContactName(sess.Client, parsed, "")
						if resolved != "" && resolved != item.Name {
							item.Name = resolved
						}
					}
				}
				if query == "" || strings.Contains(strings.ToLower(item.Name), query) || strings.Contains(strings.ToLower(item.JID), query) {
					list = append(list, item)
				}
			}
		}
		if list == nil {
			list = []ChatItem{}
		}
		json.NewEncoder(w).Encode(list)
	})

	// 7. Contacts search endpoint
	mux.HandleFunc("/api/contacts", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		sess := getSession(r)
		if sess == nil {
			json.NewEncoder(w).Encode([]interface{}{})
			return
		}

		query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("query")))

		type ContactItem struct {
			JID         string `json:"jid"`
			Name        string `json:"name"`
			PhoneNumber string `json:"phone_number"`
		}

		contactsMap := make(map[string]ContactItem)

		// 1. Get contacts from whatsmeow contact store
		if sess.Client != nil && sess.Client.Store != nil && sess.Client.Store.Contacts != nil {
			allContacts, err := sess.Client.Store.Contacts.GetAllContacts(context.Background())
			if err == nil {
				for jid, info := range allContacts {
					name := info.FullName
					if name == "" {
						name = info.BusinessName
					}
					if name == "" {
						name = info.PushName
					}
					if name == "" {
						name = info.FirstName
					}
					if name == "" {
						continue
					}

					phone := jid.User
					if !isAllDigits(phone) && jid.Server == "lid" {
						alt, altErr := sess.Client.Store.GetAltJID(context.Background(), jid)
						if altErr == nil && !alt.IsEmpty() {
							phone = alt.User
						}
					}

					contactsMap[jid.String()] = ContactItem{
						JID:         jid.String(),
						Name:        name,
						PhoneNumber: phone,
					}
				}
			}
		}

		// 2. Also merge contacts from chats table
		if sess.MessageStore != nil {
			rows, err := sess.MessageStore.db.Query(`SELECT jid, COALESCE(name, jid) as name FROM chats`)
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var jid, name string
					if err := rows.Scan(&jid, &name); err == nil {
						phone := jid
						if idx := strings.Index(jid, "@"); idx >= 0 {
							phone = jid[:idx]
						}
						if strings.HasSuffix(jid, "@g.us") {
							phone = ""
						}
						if _, exists := contactsMap[jid]; !exists {
							contactsMap[jid] = ContactItem{
								JID:         jid,
								Name:        name,
								PhoneNumber: phone,
							}
						}
					}
				}
			}
		}

		var contacts []ContactItem
		for _, c := range contactsMap {
			if query != "" {
				matchName := strings.Contains(strings.ToLower(c.Name), query)
				matchJID := strings.Contains(strings.ToLower(c.JID), query)
				matchPhone := c.PhoneNumber != "" && strings.Contains(strings.ToLower(c.PhoneNumber), query)
				if !matchName && !matchJID && !matchPhone {
					continue
				}
			}
			contacts = append(contacts, c)
		}

		if contacts == nil {
			contacts = []ContactItem{}
		}
		sort.Slice(contacts, func(i, j int) bool {
			return strings.ToLower(contacts[i].Name) < strings.ToLower(contacts[j].Name)
		})

		json.NewEncoder(w).Encode(contacts)
	})

	// 8. Messages endpoint for UI and agents with SenderName support
	mux.HandleFunc("/api/messages", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		sess := getSession(r)
		if sess == nil || sess.MessageStore == nil {
			json.NewEncoder(w).Encode([]interface{}{})
			return
		}

		chatJID := r.URL.Query().Get("chat_jid")
		if chatJID == "" {
			http.Error(w, `{"error":"chat_jid is required"}`, http.StatusBadRequest)
			return
		}

		limit := 50
		if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
			if n, parseErr := fmt.Sscanf(limitStr, "%d", &limit); n != 1 || parseErr != nil || limit <= 0 {
				limit = 50
			}
		}
		if limit > 500 {
			limit = 500
		}

		msgQuery := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("query")))

		// Check for AltJID so messages sent to LID or PN are unified
		var altJIDStr string
		if parsedChatJID, parseErr := types.ParseJID(chatJID); parseErr == nil && sess.Client != nil && sess.Client.Store != nil {
			if alt, err := sess.Client.Store.GetAltJID(context.Background(), parsedChatJID); err == nil && !alt.IsEmpty() {
				altJIDStr = alt.String()
			}
		}

		var rows *sql.Rows
		var err error
		if altJIDStr != "" {
			rows, err = sess.MessageStore.db.Query(`
				SELECT id, chat_jid, sender, content, timestamp, is_from_me, 
				       COALESCE(media_type, ''), COALESCE(filename, ''), COALESCE(url, ''), COALESCE(file_length, 0), COALESCE(push_name, '')
				FROM (
					SELECT id, chat_jid, sender, content, timestamp, is_from_me, media_type, filename, url, file_length, COALESCE(push_name, '')
					FROM messages
					WHERE chat_jid = ? OR chat_jid = ?
					ORDER BY timestamp DESC LIMIT ?
				)
				ORDER BY timestamp ASC
			`, chatJID, altJIDStr, limit)
		} else {
			rows, err = sess.MessageStore.db.Query(`
				SELECT id, chat_jid, sender, content, timestamp, is_from_me, 
				       COALESCE(media_type, ''), COALESCE(filename, ''), COALESCE(url, ''), COALESCE(file_length, 0), COALESCE(push_name, '')
				FROM (
					SELECT id, chat_jid, sender, content, timestamp, is_from_me, media_type, filename, url, file_length, COALESCE(push_name, '')
					FROM messages
					WHERE chat_jid = ?
					ORDER BY timestamp DESC LIMIT ?
				)
				ORDER BY timestamp ASC
			`, chatJID, limit)
		}

		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type MsgItem struct {
			ID         string    `json:"id"`
			ChatJID    string    `json:"chat_jid"`
			Sender     string    `json:"sender"`
			SenderName string    `json:"sender_name"`
			Content    string    `json:"content"`
			Timestamp  time.Time `json:"timestamp"`
			IsFromMe   bool      `json:"is_from_me"`
			MediaType  string    `json:"media_type"`
			Filename   string    `json:"filename"`
			URL        string    `json:"url"`
			FileLength int64     `json:"file_length"`
		}
		var msgs []MsgItem
		for rows.Next() {
			var m MsgItem
			if err := rows.Scan(&m.ID, &m.ChatJID, &m.Sender, &m.Content, &m.Timestamp, &m.IsFromMe, &m.MediaType, &m.Filename, &m.URL, &m.FileLength); err == nil {
				if msgQuery == "" || strings.Contains(strings.ToLower(m.Content), msgQuery) || strings.Contains(strings.ToLower(m.Sender), msgQuery) {
					if m.IsFromMe {
						m.SenderName = "You"
					} else {
						// Resolve sender display name
						if sJID, err := types.ParseJID(m.Sender); err == nil {
							m.SenderName = ResolveContactName(sess.Client, sJID, "")
						} else if isAllDigits(m.Sender) {
							m.SenderName = ResolveContactName(sess.Client, types.JID{User: m.Sender, Server: "s.whatsapp.net"}, "")
						} else {
							m.SenderName = m.Sender
						}
					}
					msgs = append(msgs, m)
				}
			}
		}
		if msgs == nil {
			msgs = []MsgItem{}
		}
		json.NewEncoder(w).Encode(msgs)
	})

	// 9. Send message endpoint
	mux.HandleFunc("/api/send", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Session   string `json:"session,omitempty"`
			Recipient string `json:"recipient"`
			Message   string `json:"message"`
			MediaPath string `json:"media_path,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request format", http.StatusBadRequest)
			return
		}

		if req.Recipient == "" {
			http.Error(w, "Recipient is required", http.StatusBadRequest)
			return
		}
		if req.Message == "" && req.MediaPath == "" {
			http.Error(w, "Message or media path is required", http.StatusBadRequest)
			return
		}

		sess := sm.LookupSession(req.Session)
		if sess == nil {
			http.Error(w, "WhatsApp session not found: "+req.Session, http.StatusBadRequest)
			return
		}
		if sess.Client == nil {
			http.Error(w, "WhatsApp session is not started yet - pair or reconnect first", http.StatusBadRequest)
			return
		}

		success, msgText, msgID, msgTime, targetChatJID := sendWhatsAppMessage(
			sess.Client,
			sess.MessageStore,
			req.Recipient,
			req.Message,
			req.MediaPath,
			sess.logger,
		)

		w.Header().Set("Content-Type", "application/json")
		if !success {
			w.WriteHeader(http.StatusInternalServerError)
		}

		json.NewEncoder(w).Encode(SendMessageResponse{
			Success:   success,
			Message:   msgText,
			ID:        msgID,
			Timestamp: msgTime,
			ChatJID:   targetChatJID,
		})
	})

	// 10. Download media endpoint
	mux.HandleFunc("/api/download", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Session   string `json:"session,omitempty"`
			MessageID string `json:"message_id"`
			ChatJID   string `json:"chat_jid"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request format", http.StatusBadRequest)
			return
		}

		sess := sm.LookupSession(req.Session)
		if sess == nil {
			http.Error(w, "WhatsApp session not found: "+req.Session, http.StatusBadRequest)
			return
		}
		if sess.Client == nil {
			http.Error(w, "WhatsApp session is not started yet - pair or reconnect first", http.StatusBadRequest)
			return
		}

		success, mediaType, filename, path, err := downloadMedia(sess.Client, sess.MessageStore, req.MessageID, req.ChatJID)

		w.Header().Set("Content-Type", "application/json")
		if !success || err != nil {
			errMsg := "Unknown error"
			if err != nil {
				errMsg = err.Error()
			}
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(DownloadMediaResponse{
				Success: false,
				Message: fmt.Sprintf("Failed to download media: %s", errMsg),
			})
			return
		}

		json.NewEncoder(w).Encode(DownloadMediaResponse{
			Success:  true,
			Message:  fmt.Sprintf("Successfully downloaded %s media", mediaType),
			Filename: filename,
			Path:     path,
		})
	})

	// 11. Single chat metadata endpoint (used by whatsapp_get_chat /
	// whatsapp_get_direct_chat instead of scanning the whole chat list)
	mux.HandleFunc("/api/chat", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		sess := getSession(r)
		jid := strings.TrimSpace(r.URL.Query().Get("jid"))
		if jid == "" {
			http.Error(w, `{"error":"jid is required"}`, http.StatusBadRequest)
			return
		}
		if sess == nil || sess.MessageStore == nil {
			json.NewEncoder(w).Encode(nil)
			return
		}

		alt := altJID(sess, jid)
		var row *sql.Row
		if alt != "" {
			row = sess.MessageStore.db.QueryRow(`
				SELECT c.jid, COALESCE(c.name, c.jid), c.last_message_time,
				       COALESCE((SELECT content FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), ''),
				       COALESCE((SELECT sender FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), ''),
				       COALESCE((SELECT is_from_me FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), 0)
				FROM chats c WHERE c.jid = ? OR c.jid = ? LIMIT 1
			`, jid, alt)
		} else {
			row = sess.MessageStore.db.QueryRow(`
				SELECT c.jid, COALESCE(c.name, c.jid), c.last_message_time,
				       COALESCE((SELECT content FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), ''),
				       COALESCE((SELECT sender FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), ''),
				       COALESCE((SELECT is_from_me FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), 0)
				FROM chats c WHERE c.jid = ? LIMIT 1
			`, jid)
		}

		var item struct {
			JID             string    `json:"jid"`
			Name            string    `json:"name"`
			LastMessageTime time.Time `json:"last_message_time"`
			LastMessage     string    `json:"last_message"`
			LastSender      string    `json:"last_sender"`
			LastIsFromMe    bool      `json:"last_is_from_me"`
		}
		if err := row.Scan(&item.JID, &item.Name, &item.LastMessageTime, &item.LastMessage, &item.LastSender, &item.LastIsFromMe); err != nil {
			json.NewEncoder(w).Encode(nil)
			return
		}
		json.NewEncoder(w).Encode(item)
	})

	// 12. All chats involving a contact (direct chat plus groups they wrote in)
	mux.HandleFunc("/api/contact-chats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		sess := getSession(r)
		if sess == nil || sess.MessageStore == nil {
			json.NewEncoder(w).Encode([]interface{}{})
			return
		}

		raw := strings.TrimSpace(r.URL.Query().Get("jid"))
		if raw == "" {
			http.Error(w, `{"error":"jid is required"}`, http.StatusBadRequest)
			return
		}
		digits := strings.TrimPrefix(raw, "+")
		if idx := strings.Index(digits, "@"); idx >= 0 {
			digits = digits[:idx]
		}
		directJID := raw
		if !strings.Contains(raw, "@") {
			directJID = digits + "@s.whatsapp.net"
		}

		rows, err := sess.MessageStore.db.Query(`
			SELECT DISTINCT c.jid, COALESCE(c.name, c.jid), c.last_message_time,
			       COALESCE((SELECT content FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), ''),
			       COALESCE((SELECT sender FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), ''),
			       COALESCE((SELECT is_from_me FROM messages m WHERE m.chat_jid = c.jid ORDER BY timestamp DESC LIMIT 1), 0)
			FROM chats c
			WHERE c.jid = ?
			   OR c.jid IN (SELECT DISTINCT chat_jid FROM messages WHERE sender = ? OR sender LIKE ?)
			ORDER BY c.last_message_time DESC LIMIT 100
		`, directJID, directJID, digits+"@%")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type ChatItem struct {
			JID             string    `json:"jid"`
			Name            string    `json:"name"`
			LastMessageTime time.Time `json:"last_message_time"`
			LastMessage     string    `json:"last_message"`
			LastSender      string    `json:"last_sender"`
			LastIsFromMe    bool      `json:"last_is_from_me"`
		}
		var list []ChatItem
		for rows.Next() {
			var item ChatItem
			if err := rows.Scan(&item.JID, &item.Name, &item.LastMessageTime, &item.LastMessage, &item.LastSender, &item.LastIsFromMe); err == nil {
				list = append(list, item)
			}
		}
		if list == nil {
			list = []ChatItem{}
		}
		json.NewEncoder(w).Encode(list)
	})

	// 13. Most recent message exchanged with a contact
	mux.HandleFunc("/api/last-interaction", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		sess := getSession(r)
		if sess == nil || sess.MessageStore == nil {
			json.NewEncoder(w).Encode(nil)
			return
		}

		raw := strings.TrimSpace(r.URL.Query().Get("jid"))
		if raw == "" {
			http.Error(w, `{"error":"jid is required"}`, http.StatusBadRequest)
			return
		}
		digits := strings.TrimPrefix(raw, "+")
		if idx := strings.Index(digits, "@"); idx >= 0 {
			digits = digits[:idx]
		}
		directJID := raw
		if !strings.Contains(raw, "@") {
			directJID = digits + "@s.whatsapp.net"
		}
		alt := altJID(sess, directJID)

		rows, err := sess.MessageStore.db.Query(`
			SELECT `+msgColumns+`
			FROM messages
			WHERE chat_jid = ? OR chat_jid = ? OR sender = ? OR sender LIKE ?
			ORDER BY timestamp DESC LIMIT 1
		`, directJID, alt, directJID, digits+"@%")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		msgs := scanMsgRows(sess, rows)
		if len(msgs) == 0 {
			json.NewEncoder(w).Encode(nil)
			return
		}
		json.NewEncoder(w).Encode(msgs[0])
	})

	// 14. Messages immediately before and after a given message ID
	mux.HandleFunc("/api/message-context", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		sess := getSession(r)
		if sess == nil || sess.MessageStore == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"before": []interface{}{}, "target": nil, "after": []interface{}{}})
			return
		}

		messageID := strings.TrimSpace(r.URL.Query().Get("message_id"))
		chatJID := strings.TrimSpace(r.URL.Query().Get("chat_jid"))
		if messageID == "" || chatJID == "" {
			http.Error(w, `{"error":"message_id and chat_jid are required"}`, http.StatusBadRequest)
			return
		}
		contextSize := 5
		if cs := r.URL.Query().Get("context"); cs != "" {
			if n, parseErr := fmt.Sscanf(cs, "%d", &contextSize); n != 1 || parseErr != nil || contextSize <= 0 {
				contextSize = 5
			}
		}
		if contextSize > 50 {
			contextSize = 50
		}

		var targetTS time.Time
		err := sess.MessageStore.db.QueryRow(
			"SELECT timestamp FROM messages WHERE id = ? AND chat_jid = ?", messageID, chatJID,
		).Scan(&targetTS)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"before": []interface{}{}, "target": nil, "after": []interface{}{}})
			return
		}

		targetRows, err := sess.MessageStore.db.Query(
			"SELECT "+msgColumns+" FROM messages WHERE id = ? AND chat_jid = ?", messageID, chatJID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		target := scanMsgRows(sess, targetRows)

		beforeRows, err := sess.MessageStore.db.Query(
			"SELECT "+msgColumns+" FROM (SELECT * FROM messages WHERE chat_jid = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC",
			chatJID, targetTS, contextSize)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		before := scanMsgRows(sess, beforeRows)

		afterRows, err := sess.MessageStore.db.Query(
			"SELECT "+msgColumns+" FROM messages WHERE chat_jid = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?",
			chatJID, targetTS, contextSize)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		after := scanMsgRows(sess, afterRows)

		var targetVal interface{}
		if len(target) > 0 {
			targetVal = target[0]
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"before": before,
			"target": targetVal,
			"after":  after,
		})
	})

	fmt.Printf("Starting REST API server on %s...\n", listener.Addr())
	go func() {
		if err := http.Serve(listener, corsMiddleware(mux)); err != nil {
			fmt.Printf("REST API server error: %v\n", err)
		}
	}()
}

func main() {
	logger := waLog.Stdout("Bridge", "INFO", true)
	logger.Infof("Starting WhatsApp Multi-Account Bridge...")

	dbLog := waLog.Stdout("Database", "ERROR", true)

	// Bind the REST port FIRST, before touching any session: the port is the
	// single-instance lock. A second bridge with the same store dirs would
	// connect the same WhatsApp devices twice and get accounts logged out.
	// Bind to loopback only: this API is unauthenticated and can read chats
	// and send messages, so it must never be reachable from the network.
	port := 8080
	if envPort := os.Getenv("WHATSAPP_BRIDGE_PORT"); envPort != "" {
		if n, parseErr := fmt.Sscanf(envPort, "%d", &port); n != 1 || parseErr != nil || port <= 0 || port > 65535 {
			logger.Errorf("Invalid WHATSAPP_BRIDGE_PORT %q, falling back to 8080", envPort)
			port = 8080
		}
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		logger.Errorf("Cannot bind 127.0.0.1:%d (%v). Is another bridge instance already running? Refusing to start to protect WhatsApp sessions.", port, err)
		os.Exit(1)
	}

	sm, err := NewSessionManager(logger, dbLog)
	if err != nil {
		logger.Errorf("Failed to initialize session manager: %v", err)
		return
	}
	defer sm.CloseAll()

	startRESTServer(sm, listener)

	// Keep alive until termination signal
	exitChan := make(chan os.Signal, 1)
	signal.Notify(exitChan, syscall.SIGINT, syscall.SIGTERM)

	fmt.Printf("Multi-session WhatsApp bridge running on 127.0.0.1:%d. Press Ctrl+C to disconnect and exit.\n", port)
	<-exitChan

	fmt.Println("Shutting down all WhatsApp sessions...")
	sm.CloseAll()
}

// Handle history sync events
func handleHistorySync(client *whatsmeow.Client, messageStore *MessageStore, historySync *events.HistorySync, logger waLog.Logger) {
	fmt.Printf("Received history sync event with %d conversations\n", len(historySync.Data.Conversations))

	syncedCount := 0
	for _, conversation := range historySync.Data.Conversations {
		// Parse JID from the conversation
		if conversation.ID == nil {
			continue
		}

		chatJID := *conversation.ID

		// Try to parse the JID
		jid, err := types.ParseJID(chatJID)
		if err != nil {
			logger.Warnf("Failed to parse JID %s: %v", chatJID, err)
			continue
		}

		// Get appropriate chat name by passing the history sync conversation directly
		name := GetChatName(client, messageStore, jid, chatJID, conversation, "", logger)

		// Process messages
		messages := conversation.Messages
		if len(messages) > 0 {
			// Update chat with latest message timestamp
			latestMsg := messages[0]
			if latestMsg == nil || latestMsg.Message == nil {
				continue
			}

			// Get timestamp from message info
			timestamp := time.Time{}
			if ts := latestMsg.Message.GetMessageTimestamp(); ts != 0 {
				timestamp = time.Unix(int64(ts), 0)
			} else {
				continue
			}

			messageStore.StoreChat(chatJID, name, timestamp)

			// Store messages
			for _, msg := range messages {
				if msg == nil || msg.Message == nil {
					continue
				}

				// Extract text content
				var content string
				if msg.Message.Message != nil {
					if conv := msg.Message.Message.GetConversation(); conv != "" {
						content = conv
					} else if ext := msg.Message.Message.GetExtendedTextMessage(); ext != nil {
						content = ext.GetText()
					}
				}

				// Extract media info
				var mediaType, filename, url string
				var mediaKey, fileSHA256, fileEncSHA256 []byte
				var fileLength uint64

				if msg.Message.Message != nil {
					mediaType, filename, url, mediaKey, fileSHA256, fileEncSHA256, fileLength = extractMediaInfo(msg.Message.Message)
				}

				// Log the message content for debugging
				logger.Infof("Message content: %v, Media Type: %v", content, mediaType)

				// Skip messages with no content and no media
				if content == "" && mediaType == "" {
					continue
				}

				// Determine sender
				var sender string
				isFromMe := false
				if msg.Message.Key != nil {
					if msg.Message.Key.FromMe != nil {
						isFromMe = *msg.Message.Key.FromMe
					}
					if !isFromMe && msg.Message.Key.Participant != nil && *msg.Message.Key.Participant != "" {
						sender = *msg.Message.Key.Participant
					} else if isFromMe {
						sender = client.Store.ID.User
					} else {
						sender = jid.User
					}
				} else {
					sender = jid.User
				}

				// Store message
				msgID := ""
				if msg.Message.Key != nil && msg.Message.Key.ID != nil {
					msgID = *msg.Message.Key.ID
				}

				// Get message timestamp
				timestamp := time.Time{}
				if ts := msg.Message.GetMessageTimestamp(); ts != 0 {
					timestamp = time.Unix(int64(ts), 0)
				} else {
					continue
				}

				err = messageStore.StoreMessage(
					msgID,
					chatJID,
					sender,
					content,
					timestamp,
					isFromMe,
					mediaType,
					filename,
					url,
					mediaKey,
					fileSHA256,
					fileEncSHA256,
					fileLength,
					msg.Message.GetPushName(),
				)
				if err != nil {
					logger.Warnf("Failed to store history message: %v", err)
				} else {
					syncedCount++
					// Log successful message storage
					if mediaType != "" {
						logger.Infof("Stored message: [%s] %s -> %s: [%s: %s] %s",
							timestamp.Format("2006-01-02 15:04:05"), sender, chatJID, mediaType, filename, content)
					} else {
						logger.Infof("Stored message: [%s] %s -> %s: %s",
							timestamp.Format("2006-01-02 15:04:05"), sender, chatJID, content)
					}
				}
			}
		}
	}

	fmt.Printf("History sync complete. Stored %d messages.\n", syncedCount)
}

// Request history sync from the server
func requestHistorySync(client *whatsmeow.Client) {
	if client == nil {
		fmt.Println("Client is not initialized. Cannot request history sync.")
		return
	}

	if !client.IsConnected() {
		fmt.Println("Client is not connected. Please ensure you are connected to WhatsApp first.")
		return
	}

	if client.Store.ID == nil {
		fmt.Println("Client is not logged in. Please scan the QR code first.")
		return
	}

	// Build and send a history sync request
	historyMsg := client.BuildHistorySyncRequest(nil, 100)
	if historyMsg == nil {
		fmt.Println("Failed to build history sync request.")
		return
	}

	_, err := client.SendMessage(context.Background(), types.JID{
		Server: "s.whatsapp.net",
		User:   "status",
	}, historyMsg)

	if err != nil {
		fmt.Printf("Failed to request history sync: %v\n", err)
	} else {
		fmt.Println("History sync requested. Waiting for server response...")
	}
}

// analyzeOggOpus tries to extract duration and generate a simple waveform from an Ogg Opus file
func analyzeOggOpus(data []byte) (duration uint32, waveform []byte, err error) {
	// Verify Ogg signature
	if len(data) < 4 || string(data[0:4]) != "OggS" {
		return 0, nil, fmt.Errorf("not a valid Ogg file (missing OggS signature)")
	}

	// Parse Ogg pages to find the last page with a valid granule position
	var lastGranule uint64
	var sampleRate uint32 = 48000 // Default Opus sample rate
	var preSkip uint16 = 0
	var foundOpusHead bool

	// Scan through the file looking for Ogg pages
	for i := 0; i < len(data); {
		// Check if we have enough data to read Ogg page header
		if i+27 >= len(data) {
			break
		}

		// Verify Ogg page signature
		if string(data[i:i+4]) != "OggS" {
			// Skip until next potential page
			i++
			continue
		}

		// Extract header fields
		granulePos := binary.LittleEndian.Uint64(data[i+6 : i+14])
		pageSeqNum := binary.LittleEndian.Uint32(data[i+18 : i+22])
		numSegments := int(data[i+26])

		// Extract segment table
		if i+27+numSegments >= len(data) {
			break
		}
		segmentTable := data[i+27 : i+27+numSegments]

		// Calculate page size
		pageSize := 27 + numSegments
		for _, segLen := range segmentTable {
			pageSize += int(segLen)
		}

		// Check if we're looking at an OpusHead packet (should be in first few pages)
		if !foundOpusHead && pageSeqNum <= 1 {
			// Look for "OpusHead" marker in this page
			pageData := data[i : i+pageSize]
			headPos := bytes.Index(pageData, []byte("OpusHead"))
			if headPos >= 0 && headPos+12 < len(pageData) {
				// Found OpusHead, extract sample rate and pre-skip
				// OpusHead format: Magic(8) + Version(1) + Channels(1) + PreSkip(2) + SampleRate(4) + ...
				headPos += 8 // Skip "OpusHead" marker
				// PreSkip is 2 bytes at offset 10, SampleRate at offset 12
				if headPos+16 <= len(pageData) {
					preSkip = binary.LittleEndian.Uint16(pageData[headPos+10 : headPos+12])
					sampleRate = binary.LittleEndian.Uint32(pageData[headPos+12 : headPos+16])
					foundOpusHead = true
				}
			}
		}

		// Keep track of last valid granule position
		if granulePos != 0 {
			lastGranule = granulePos
		}

		// Move to next page
		i += pageSize
	}

	// Calculate duration based on granule position
	if lastGranule > 0 {
		durationSeconds := float64(lastGranule-uint64(preSkip)) / float64(sampleRate)
		duration = uint32(math.Ceil(durationSeconds))
	} else {
		// Fallback rough estimation if granule position not found
		durationEstimate := float64(len(data)) / 2000.0
		duration = uint32(durationEstimate)
	}

	// Clamp to reasonable range
	if duration < 1 {
		duration = 1
	} else if duration > 300 {
		duration = 300
	}

	// Generate waveform
	waveform = generateWaveform(duration)

	return duration, waveform, nil
}

// min returns the smaller of x or y
func min(x, y int) int {
	if x < y {
		return x
	}
	return y
}

// generateWaveform generates an authentic voice waveform for WhatsApp voice messages
// that models natural speech variation based on duration
func generateWaveform(duration uint32) []byte {
	// WhatsApp expects a 64-byte waveform for voice messages
	const waveformLength = 64
	waveform := make([]byte, waveformLength)

	// Use a seeded local RNG for consistent results with the same duration
	rng := rand.New(rand.NewSource(int64(duration)))

	// Create a more natural looking waveform with some patterns and variability
	// rather than completely random values

	// Base amplitude and frequency - longer messages get faster frequency
	baseAmplitude := 35.0
	frequencyFactor := float64(min(int(duration), 120)) / 30.0

	for i := range waveform {
		// Position in the waveform (normalized 0-1)
		pos := float64(i) / float64(waveformLength)

		// Create a wave pattern with some randomness
		// Use multiple sine waves of different frequencies for more natural look
		val := baseAmplitude * math.Sin(pos*math.Pi*frequencyFactor*8)
		val += (baseAmplitude / 2) * math.Sin(pos*math.Pi*frequencyFactor*16)

		// Add some randomness to make it look more natural
		val += (rng.Float64() - 0.5) * 15

		// Add some fade-in and fade-out effects
		fadeInOut := math.Sin(pos * math.Pi)
		val = val * (0.7 + 0.3*fadeInOut)

		// Center around 50 (typical voice baseline)
		val = val + 50

		// Ensure values stay within WhatsApp's expected range (0-100)
		if val < 0 {
			val = 0
		} else if val > 100 {
			val = 100
		}

		waveform[i] = byte(val)
	}

	return waveform
}
