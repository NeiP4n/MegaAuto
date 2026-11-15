Connect your WhatsApp account to Blackbox and empower AI agents to read, search, and send messages directly through WhatsApp's official multi-device protocol.

## What you get

- **Interactive WhatsApp UI**: A full-featured chat interface docked right inside Blackbox with conversations, message history, media preview, contact searching, and real-time status.
- **12 Agent Tools**: Comprehensive tools for Blackbox agents to query chat history, resolve contacts, inspect message context, download media attachments, and send text or file messages.
- **Terminal CLI**: Fast `bb whatsapp` CLI commands for checking bridge status, pairing via QR codes, browsing chats, and messaging contacts directly from your shell.
- **Local & Private**: All messages, contacts, and authentication sessions are stored locally in an embedded SQLite database (`bridge/store/`). No data is sent to third-party cloud servers.

## Architecture

The plugin combines three high-performance layers:

1. **Go Bridge (`whatsmeow`)**: A standalone daemon communicating directly with WhatsApp servers via WebSocket and Noise encryption. It provides a local HTTP API on port 8080 and maintains local SQLite message stores.
2. **Blackbox Plugin Backend (`server.ts`)**: Manages bridge daemon lifecycles, exposes RPC methods to the frontend UI, registers all 12 agent tools, and provides the `bb whatsapp` CLI.
3. **Blackbox UI (`app.tsx`)**: A responsive panel featuring QR code authentication pairing, chat list navigation, message timelines with media downloads, and agent tool status monitors.

## For agents

Agents in Blackbox threads automatically gain access to tools like `whatsapp_list_chats`, `whatsapp_list_messages`, `whatsapp_search_contacts`, `whatsapp_send_message`, and `whatsapp_download_media`. Agents can autonomously summarize customer threads, notify contacts, or fetch context-aware chat logs upon user request.

## Setup and pairing

1. Open the **WhatsApp** tab in the Blackbox sidebar or run `bb whatsapp qr`.
2. Open WhatsApp on your mobile phone, navigate to **Linked Devices**, and tap **Link a Device**.
3. Scan the displayed QR code. The bridge pairs immediately, syncs recent chats into the local SQLite store, and transitions to connected status.
