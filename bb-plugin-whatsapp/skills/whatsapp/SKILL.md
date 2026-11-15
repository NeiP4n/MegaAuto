---
name: whatsapp
description: "Send WhatsApp messages, read and search chat history, look up contacts, download media, and manage the WhatsApp multi-device bridge. Use when the user asks to chat, search contacts, read messages, send files, or check bridge status."
---

# WhatsApp MCP Plugin for Blackbox

Connects your WhatsApp account via the official multi-device protocol (`whatsmeow` bridge). Messages and contacts are stored locally in SQLite and exposed through 12 registered Blackbox agent tools, the `bb whatsapp` CLI, and an interactive chat UI in Blackbox.

## Registered Agent Tools

These tools are automatically available to agents in Blackbox threads:

### Status & Connection

#### `whatsapp_status`
Check bridge status, connection state, authenticated phone number, and QR code pairing status.
```json
{}
```
Returns `{ "connected": boolean, "status": "connected" | "connecting" | "needs_scan" | "disconnected", "phone": string, "qr": string }`. If `connected` is false, notify the user to scan the pairing QR code displayed in the Blackbox WhatsApp UI panel or generated via CLI.

---

### Contacts

#### `whatsapp_search_contacts`
Search saved contacts and direct chats by name or phone number.
```json
{
  "query": "Alice"
}
```
Returns a list of `{ "jid": string, "name": string, "phone_number": string }`.

---

### Chats

#### `whatsapp_list_chats`
List recent chats with last message previews, timestamps, and contact names.
```json
{
  "query": "Design Team", // optional
  "limit": 20             // optional, default 20
}
```
Returns an array of chat summaries. Direct chats use JID format `<phone>@s.whatsapp.net`; group chats use `<id>@g.us`.

#### `whatsapp_get_chat`
Retrieve detailed metadata for a specific chat by JID.
```json
{
  "jid": "12025551234@s.whatsapp.net"
}
```

#### `whatsapp_get_direct_chat`
Find or resolve the direct (1-on-1) chat JID for a given phone number.
```json
{
  "phone": "+12025551234" // with or without '+' or existing JID
}
```

#### `whatsapp_get_contact_chats`
List all chats (both direct 1-on-1 and group chats) involving a contact.
```json
{
  "contact": "12025551234@s.whatsapp.net" // JID or phone number
}
```

---

### Messages & History

#### `whatsapp_list_messages`
Retrieve message history from a chat.
```json
{
  "chat_jid": "12025551234@s.whatsapp.net",
  "limit": 50 // optional, default 20
}
```
Returns an array of messages with `timestamp`, `sender`, `content`, `is_from_me`, `id`, `media_type`, and `filename`.

#### `whatsapp_get_last_interaction`
Retrieve the most recent message exchanged with a contact or chat.
```json
{
  "contact": "12025551234@s.whatsapp.net"
}
```

#### `whatsapp_get_message_context`
Retrieve messages immediately before and after a target message to inspect context.
```json
{
  "message_id": "3EB0ABC123DEF",
  "chat_jid": "12025551234@s.whatsapp.net",
  "context_size": 5 // optional, default 5
}
```
Returns `{ "target": {...} | null, "before": [...], "after": [...] }`.

---

### Sending & Media

#### `whatsapp_send_message`
Send a text message to a phone number or group JID.
```json
{
  "recipient": "+12025551234", // phone number with country code or full JID
  "message": "Hello from Blackbox!"
}
```
Returns `{ "success": true, "message": "Message sent" }`.

#### `whatsapp_send_file`
Send a media file (image, video, document, or audio) to a recipient.
```json
{
  "recipient": "12025551234@s.whatsapp.net",
  "file_path": "C:/path/to/invoice.pdf", // absolute path on disk
  "caption": "Your monthly invoice"      // optional
}
```
Returns `{ "success": true, "message": "File sent" }`.

#### `whatsapp_download_media`
Download media attached to an incoming message and retrieve its local file path.
```json
{
  "message_id": "3EB0ABC123DEF",
  "chat_jid": "12025551234@s.whatsapp.net"
}
```
Returns `{ "success": true, "file_path": "C:/.../store/media/image.jpeg" }`.

---

## CLI Commands

The plugin provides the `bb whatsapp` CLI command group in Blackbox:

```bash
# Check bridge connection and authenticated phone
bb whatsapp status

# Show terminal QR code for pairing
bb whatsapp qr

# List recent conversations
bb whatsapp chats

# Search contacts
bb whatsapp contacts "Alice"

# List messages in a specific chat
bb whatsapp messages "12025551234@s.whatsapp.net" 50

# Send a text message
bb whatsapp send "+12025551234" "Hello from Blackbox!"

# Send a file with optional caption
bb whatsapp send-file "+12025551234" "C:/path/to/photo.jpg" "Vacation photo"

# Bridge lifecycle management
bb whatsapp start
bb whatsapp restart
bb whatsapp stop
```

---

## Usage Guidelines & Best Practices

1. **Check Connection First**: Before sending messages or if queries return empty, verify `whatsapp_status`. If `connected: false`, instruct the user to scan the QR code via UI or `bb whatsapp qr`.
2. **Recipient Identification**: For `recipient`, use either international phone format (e.g., `+12025551234`) or full WhatsApp JID (e.g., `12025551234@s.whatsapp.net` or `123456-7890@g.us`).
3. **Media Handling**: When an incoming message has a non-empty `media_type` or `filename`, use `whatsapp_download_media` to save it locally before processing or inspecting it.
4. **Safety & Confirmation**: Always verify the recipient's identity before sending sensitive information or messages on behalf of the user.
