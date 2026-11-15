---
name: whatsapp
description: "Send WhatsApp messages, read and search chat history, look up contacts, download media, and manage MULTIPLE WhatsApp accounts through the multi-device bridge. Use when the user asks to chat, search contacts, read messages, send files, check status, or work with more than one WhatsApp number."
---

# WhatsApp Multi-Account Plugin for Blackbox

Connects one or more WhatsApp accounts via the official multi-device protocol (`whatsmeow` bridge). Everything goes through the registered agent tools below or the `bb whatsapp` CLI.

## Cheat sheet (covers ~90% of requests - no other reading needed)

```bash
bb whatsapp send --to "Mom" "привет"                          # send to a chat BY NAME, active account
bb whatsapp send --account 16838505031 --to "Mom" "привет"     # pick account by phone/name, no session_id
bb whatsapp say --all "текст" --dry-run                        # preview a broadcast (count + recipients)
bb whatsapp say --all "текст" --yes                           # broadcast to all chats (groups excluded)
bb whatsapp messages "Mom" 20                                 # read a chat by name (jid also works)
bb whatsapp accounts                                          # list accounts: id, name, phone, status
```
For anything else (media, contacts, history search, claims) use the agent tools below. `send`/`say` never need a session_id or chat JID - names and phone numbers resolve automatically.

**NEVER do these - they are slow, fragile, and unsafe:**
- Do NOT open or query the SQLite stores (`bridge/store/**.db`) directly.
- Do NOT call `http://127.0.0.1:8080/api/...` by hand with curl/Invoke-RestMethod/python.
- Do NOT guess session ids - list them with `whatsapp_list_accounts`.
- Do NOT restart the bridge or a session while a pairing or the initial history sync is in progress (that kills the pair and gets the account logged out).

## Multiple accounts (read this first)

Each paired number is a **session** with a stable `session_id` (e.g. `default`, `session_1763..._4821`).

1. Call `whatsapp_list_accounts` (or `bb whatsapp accounts`) to get every account: `session_id`, name, phone, status, and which one is **active**.
2. Every other `whatsapp_*` tool accepts an optional `session_id` parameter. Omit it to use the active account; pass it to act from a specific number.
3. Chats, messages and contacts are **per account** - a JID from account A does not exist in account B's store.

## Registered Agent Tools

### Accounts & Status

#### `whatsapp_list_accounts`
List all paired accounts. Call this FIRST when multiple numbers exist or the user names a number to send from.
```json
{}
```
Returns `[{ "id": "session_1763..._4821", "name": "Work", "phone": "12025551234", "status": "connected", "connected": true, "is_active": false, "claim_holder": "research-bot", "claim_expires_at": "..." }]` (`claim_holder`/`claim_expires_at` appear only on claimed sessions).

#### `whatsapp_claim_session`
Take an exclusive, time-limited claim on an account so other agents don't interleave sends on it while you work. Use it whenever you run a multi-step job on one account.
```json
{ "session_id": "session_1763..._4821", "holder": "my-agent-name", "ttl_seconds": 600 }
```
- Same holder re-claiming renews the TTL; a different holder gets a 409 naming the current holder.
- The claim expires automatically (30 s - 1 h, default 10 min), so a crashed agent never wedges the account.
- While a session is claimed, sends from other holders are rejected - pass your `holder` as `claim_holder` in `whatsapp_send_message` / `whatsapp_send_file`.
- Claims stop AGENTS stepping on each other. The user's own UI sends always go through, and only the user can force-release from the plugin UI.

#### `whatsapp_release_session`
Release your claim when the job is done.
```json
{ "session_id": "session_1763..._4821", "holder": "my-agent-name" }
```

#### `whatsapp_status`
Check bridge/account status and pairing state.
```json
{ "session_id": "default" }  // optional
```
Returns `{ "connected": bool, "status": "connected"|"connecting"|"needs_scan"|"logged_out"|..., "phone": string, "pairing": bool, "syncing": bool }`. If `pairing` or `syncing` is true, WAIT - do not restart anything.

### Contacts

#### `whatsapp_search_contacts`
```json
{ "query": "Alice", "session_id": "default" }
```

### Chats

#### `whatsapp_list_chats`
```json
{ "query": "Design Team", "limit": 20, "session_id": "default" }
```
Direct chats: `<phone>@s.whatsapp.net`; groups: `<id>@g.us`.

#### `whatsapp_get_chat` / `whatsapp_get_direct_chat` / `whatsapp_get_contact_chats` / `whatsapp_get_last_interaction` / `whatsapp_get_message_context`
All take their usual ids plus optional `session_id`.

### Messages & History

#### `whatsapp_list_messages`
```json
{ "chat_jid": "12025551234@s.whatsapp.net", "limit": 50, "session_id": "default" }
```

### Sending & Media

#### `whatsapp_send_message`
```json
{ "recipient": "+12025551234", "message": "Hello!", "session_id": "default", "claim_holder": "my-agent-name" }
```
(`claim_holder` only if you claimed the session.)

#### `whatsapp_send_file`
```json
{ "recipient": "12025551234@s.whatsapp.net", "file_path": "C:/path/to/invoice.pdf", "caption": "Invoice", "session_id": "default", "claim_holder": "my-agent-name" }
```

#### `whatsapp_download_media`
```json
{ "message_id": "3EB0ABC123DEF", "chat_jid": "12025551234@s.whatsapp.net", "session_id": "default" }
```

## Send limits (enforced by the bridge, not optional)

Sending from any account is rate-limited to keep the WhatsApp accounts safe. If a send returns HTTP 429 with `retry_after`, wait and retry later - do NOT work around it:

- **2 s minimum spacing** between sends (serialized per account).
- **50 messages per 10 minutes** per account.
- **500 messages per day** per account (persisted across restarts).
- **5 NEW recipients per hour** per account. `allow_unknown_blast: true` overrides only this cap and only when the user explicitly asked to message many new contacts - bulk cold messaging gets accounts banned by WhatsApp.

## CLI Commands

```bash
bb whatsapp accounts                          # list accounts: * = active, session ids, phones, status
bb whatsapp status [--session <id>]           # connection + pairing state
bb whatsapp qr [--session <id>]               # pairing QR for a new/existing account
bb whatsapp chats [--session <id>]
bb whatsapp contacts "Alice" [--session <id>]
bb whatsapp messages <chat_jid> [limit] [--session <id>]
bb whatsapp send <recipient> <message> [--session <id>]
bb whatsapp send-file <recipient> <path> [caption] [--session <id>]
bb whatsapp backup [session_id]               # zip creds + message store
bb whatsapp restore <session_id> <file.zip>
bb whatsapp start | stop | restart            # bridge lifecycle
```

## Usage Guidelines & Best Practices

1. **Pick the account first**: `whatsapp_list_accounts` -> choose `session_id` -> pass it to every follow-up call.
2. **Check connection before sending**: `whatsapp_status`; if `connected: false`, tell the user to pair in the Blackbox WhatsApp tab. If `pairing`/`syncing`, wait.
3. **Recipient format**: international phone (`+12025551234`) or full JID; groups are `<id>@g.us`.
4. **Media**: incoming messages with `media_type` set can be saved via `whatsapp_download_media`, then inspected locally.
5. **Confirm before sending**: verify recipient identity before sending anything sensitive on the user's behalf.
6. **Pairing a new account**: the user scans the QR in the Blackbox WhatsApp tab themselves; pairing + initial sync can take several minutes. Never restart the session during that window.
