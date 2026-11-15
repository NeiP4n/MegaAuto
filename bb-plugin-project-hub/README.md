# bb-plugin-project-hub

> **n8n Multi-Instance & Workflow Automation Hub** for Blackbox.  
> Real-time monitoring, project management, and bi-directional workflow command dispatch across multiple n8n instances, Telegram gateways, and custom webhook routers.

---

## 🌟 Key Features

- **Multi-Instance Architecture**: Connect and monitor multiple n8n servers (Local `http://localhost:5678`, Remote Cloud VPS, etc.), Telegram bots, and external webhook routers in a single unified dashboard.
- **Bi-Directional Workflow Dispatch**: Trigger executions and send interactive commands into n8n webhooks (`POST <account.url>/webhook/api/projects/:id/send`) with authentication headers (`X-N8N-API-KEY`) and instant reply capture.
- **Execution & Health Insights**: Live connectivity checks, dynamic version detection (`/api/v1/version` / `/healthz`), execution status badges (`success`, `running`, `error`), and latency metrics.
- **Blackbox Native UI**: 100% styled with Blackbox CSS tokens (`bg-background`, `bg-card`, `border-border`, `text-foreground`, `text-primary`) supporting dark and light themes seamlessly.
- **Deep SDK Integration**: Integrates directly into Blackbox navigation slots (`app.slots.navPanel`, `app.slots.experimental_tab`), CLI subsystem, and AI Agent toolset.

---

## 🏗 Architecture & Channels

| Channel | Description | Connection Protocol |
| :--- | :--- | :--- |
| **`n8n`** | Standard n8n Server (Local or Cloud) | REST API (`/api/v1/workflows`, `/api/v1/executions`) + Webhook endpoints with optional `X-N8N-API-KEY`. |
| **`telegram`** | Telegram Automation Bot Gateway | Webhook dispatcher / Bot API relay. |
| **`webhook`** | Custom Ingestion & Microservices | Direct HTTP JSON webhook payloads. |

---

## 🔌 RPC Methods

All RPC endpoints are strictly typed with Zod via `defineRpcContract` (`server.ts`):

| Method | Input | Output | Description |
| :--- | :--- | :--- | :--- |
| `get_accounts` | `null` | `{ ok, accounts: Account[] }` | Returns all registered instances and gateways. |
| `create_account` | `{ name, channel, url, apiKey? }` | `{ ok, account: Account }` | Connects and registers a new instance or webhook router. |
| `disconnect_account` | `{ accountId }` | `{ ok, account?: Account }` | Toggles account connection state (`online` / `offline`). |
| `delete_account` | `{ accountId }` | `{ ok }` | Removes account and related project links. |
| `get_projects` | `{ accountId?: string }` | `{ ok, projects: Project[] }` | Retrieves monitored projects filtered by account ID. |
| `create_project` | `{ accountId, name, channel?, workflowId?, tags? }` | `{ ok, project: Project }` | Creates a new workflow project linked to an instance. |
| `delete_project` | `{ projectId }` | `{ ok: boolean }` | Deletes a project and all associated chat messages. |
| `toggle_project_status` | `{ projectId, status? }` | `{ ok, project?: Project }` | Power toggle (ON/OFF) for a project workflow. |
| `get_messages` | `{ projectId }` | `{ ok, messages: ChatMessage[] }` | Fetches activity log and messages for a specific project. |
| `send_message` | `{ projectId, text, mode }` | `{ ok, message, error? }` | Dispatches command/message to n8n webhook and records response. |
| `get_status` | `null` | `HubStatus` | Returns global health, n8n connectivity, versions, and counts. |
| `sync_n8n` | `{ n8nBaseUrl?, apiKey?, accountId? }` | `{ ok, syncedProjects, syncedMessages, error? }` | Syncs workflows and executions from n8n instances into the Hub store. |
| `toggle_ai` | `{ projectId, aiActive }` | `{ ok, project? }` | Enables or disables automated AI Agent handling for the project. |
| `mark_as_read` | `{ projectId }` | `{ ok }` | Resets unread counter for the target project. |

---

## 💻 CLI Commands

The plugin registers the `project-hub` CLI namespace:

```bash
# Check global connectivity, n8n engine health and statistics
bb project-hub status

# List all registered instances, channels, and statuses
bb project-hub accounts

# List all monitored workflows/projects with unread badges
bb project-hub list

# Dispatch a command directly into a project's workflow
bb project-hub send <projectId> <command>
```

*Example:*
```bash
bb project-hub send instinct-pipeline "sync lead status --force"
```

---

## 🤖 AI Agent Tools

The plugin registers tools accessible to Blackbox AI Agents:

- **`project_hub_list_accounts`**: Retrieves all connected n8n instances and gateway endpoints with their online statuses.
- **`project_hub_list_projects`**: Lists all projects, workflow bindings, unread counts, and last activity timestamps.
- **`project_hub_get_messages`**: Returns the recent message and execution log history for a specific project ID (`projectId`).
- **`project_hub_send_message`**: Sends a command or message into a project workflow, executing through n8n webhook and returning execution output.

---

## 📁 Project Structure

```
bb-plugin-project-hub/
├── app.tsx                 # Frontend application (UI views, tabs, modals)
├── server.ts               # Backend RPC handlers, storage, CLI & agent tools
├── package.json            # Plugin manifest and dependencies
├── README.md               # Documentation
└── src/
    ├── icons.tsx           # Scalable SVG icons with currentColor support
    └── types.ts            # TypeScript interfaces, execution models, webhook schemas
```

---

## 🚀 Development & Build

```bash
# Typecheck
npx tsc --noEmit
```
