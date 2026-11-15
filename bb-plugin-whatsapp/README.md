# bb-plugin-whatsapp

WhatsApp MCP integration for Blackbox. Connects directly to WhatsApp via the official multi-device protocol (`whatsmeow`), bringing chat history, contact search, media downloads, and messaging directly into Blackbox agent threads, CLI, and an interactive UI.

## Architecture

The plugin links three main layers into Blackbox:

```
┌──────────────────────────────────────────────────────────┐
│                     Blackbox UI                          │
│     (app.tsx — Chats, Messages, New Chat, Agent Tools)   │
└─────────────────────────▲────────────────────────────────┘
                          │ RPC & Signals
┌─────────────────────────▼────────────────────────────────┐
│               Blackbox Backend (server.ts)               │
│  - Bridge Process Controller (spawn/watch/restart)       │
│  - 12 Registered Agent Tools (bb.agents.registerTool)    │
│  - CLI Command Handlers (bb whatsapp <cmd>)              │
│  - Local SQLite direct query fallbacks                   │
└─────────────────────────▲────────────────────────────────┘
                          │ HTTP REST (:8080) / SQLite
┌─────────────────────────▼────────────────────────────────┐
│             Go Bridge Daemon (bridge/main.go)            │
│  - Multi-device protocol engine via whatsmeow            │
│  - WebSocket & Noise handshake to WhatsApp servers       │
│  - Local SQLite persistence (bridge/store/*.db)          │
│  - REST endpoints: /api/status, /api/chats, /api/send... │
└──────────────────────────────────────────────────────────┘
```

In addition, an optional standalone Python FastMCP server (`mcp-server/`) is provided for interoperability with external MCP clients.

---

## Features

- **Full Multi-Device WhatsApp Engine**: Operates as an independent linked device using `whatsmeow`. Does not require browser automation or third-party web scrapers.
- **Embedded Local Storage**: Message history, chats, and contact cards persist locally in SQLite databases (`bridge/store/messages.db` and `bridge/store/whatsapp.db`).
- **12 Registered Agent Tools**: Grants Blackbox agents full programmatic control to search contacts, browse messages, fetch conversation context, and send files.
- **Unified UI Panel**: Built using Blackbox vendored UI components (`components/ui`), featuring live chat threads, contact search, media attachment downloads, new conversation dialog, and bridge diagnostics.
- **Terminal CLI**: Fast commands (`bb whatsapp ...`) for automation, scripting, and headless bridge management.

---

## 12 Registered Agent Tools

Agents running in Blackbox threads automatically receive the following tools:

| Tool | Parameters | Description |
| --- | --- | --- |
| `whatsapp_status` | _none_ | Check bridge connection, phone number, and QR pairing status. |
| `whatsapp_list_chats` | `query?`, `limit?` | List recent conversations with latest message preview and timestamp. |
| `whatsapp_list_messages` | `chat_jid`, `limit?` | Retrieve messages from a chat with media details and sender information. |
| `whatsapp_search_contacts` | `query` | Search contacts and known conversation partners by name or phone. |
| `whatsapp_send_message` | `recipient`, `message` | Send text message to a phone number (`+1...`) or chat JID. |
| `whatsapp_send_file` | `recipient`, `file_path`, `caption?` | Send an image, video, audio file, or document from local disk. |
| `whatsapp_download_media` | `message_id`, `chat_jid` | Download media attached to a message and return the local path. |
| `whatsapp_get_chat` | `jid` | Retrieve specific chat metadata by its WhatsApp JID. |
| `whatsapp_get_direct_chat` | `phone` | Find or resolve direct 1-on-1 chat JID from a phone number. |
| `whatsapp_get_contact_chats` | `contact` | List all chats (direct and group) involving a specific contact. |
| `whatsapp_get_last_interaction`| `contact` | Fetch the most recent message exchanged with a contact. |
| `whatsapp_get_message_context` | `message_id`, `chat_jid`, `context_size?` | Retrieve messages before and after a specific message ID. |

---

## CLI Reference

Run `bb whatsapp` from the terminal:

```bash
# Bridge lifecycle
bb whatsapp start       # Start the WhatsApp bridge background process
bb whatsapp stop        # Gracefully stop the bridge
bb whatsapp restart     # Restart the bridge process

# Authentication & status
bb whatsapp status      # Print connection state and authenticated phone
bb whatsapp qr          # Render terminal QR code for initial device pairing

# Chats & messages
bb whatsapp chats       # List recent conversations
bb whatsapp contacts <query> # Search contacts by name or number
bb whatsapp messages --chat <jid> --limit 50 # View chat history

# Sending
bb whatsapp send <recipient> "<message>" # Send a text message
bb whatsapp send-file <recipient> <path> [--caption "Text"] # Send media file
```

---

## Setup & Pairing

### 1. Prerequisites

- Node.js >= 20
- Go >= 1.22 (to compile the bridge)
- Blackbox CLI (`bb`)

### 2. Build the Bridge

```bash
cd bridge
go build -o whatsapp-bridge.exe .
```

### 3. Install Plugin into Blackbox

```bash
cd ..
npm install
bb plugin install .
```

### 4. Link Your WhatsApp Account

1. Open Blackbox and navigate to the **WhatsApp** tab in the sidebar.
2. If not connected, a QR code will automatically appear on screen (or run `bb whatsapp qr` in your terminal).
3. On your phone, open WhatsApp > **Settings** > **Linked Devices** > **Link a Device**.
4. Scan the QR code. Once paired, your contacts and recent chats will sync automatically into `bridge/store/`.

---

## Standalone MCP Server (`mcp-server/`)

For environments using standard MCP over stdio (e.g. Claude Desktop, Cursor, or standalone agents):

```bash
cd mcp-server
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install fastmcp requests
python main.py
```

The FastMCP server exposes identical tools connecting to the running Go bridge HTTP endpoint (`http://localhost:8080`).

---

## Troubleshooting

### Bridge won't connect or shows "Disconnected"
- Check if another process is occupying port 8080:
  ```bash
  netstat -ano | findstr 8080
  ```
- Restart the bridge using `bb whatsapp restart`.
- Review logs generated by `whatsapp-bridge.exe`.

### QR Code Expired
- WhatsApp pairing QR codes rotate every 20-30 seconds.
- Click **Refresh QR** in the Blackbox UI or run `bb whatsapp qr` to generate a fresh pairing token.

### Media Download Fails
- Ensure the message contains media (`media_type` is not null).
- Media messages older than WhatsApp's server retention window (typically 30 days) may require re-download from phone cache.

### Audio Messages & Voice Notes
- Voice messages sent via `send_audio_message` require Opus `.ogg` encoding.
- Ensure `ffmpeg` is available on the system PATH for automatic conversion. If FFmpeg is not installed, use `send_file` to transmit the audio file as a standard document attachment.
