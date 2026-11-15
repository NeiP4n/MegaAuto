# bb-plugin-meta-muse: Meta Muse AI

> **Meta Muse AI** is a proactive companion plugin for the Blackbox (BB) environment: conversation threads, a proactive task scheduler (cron / interval / due date) and associative long-term memory persisted locally.
>
> **Honest status:** there is no LLM backend, media generator, or isolated VM wired into this plugin yet. Chat replies state that no AI backend is connected, media jobs fail immediately with a clear error, and the VM tab shows real host-process metrics (RSS memory, uptime) instead of fabricated sandbox telemetry.

---

## 🌟 Key Features

- **Iridescent Dynamic Spectrum UI**: Deep obsidian theme (#0B0E14) accented by electric blue, vibrant magenta/violet, and fluid cyan glowing gradients with frosted glass cards.
- **Interactive Chat & Muse Timeline**: Context-aware conversation threads with proactive suggestion chips, rich markdown, media card embeds, and quick export.
- **Media Studio (no generator connected yet)**: prompt engineering UI with aspect ratio presets, style filters and seed controls; jobs currently fail immediately with an honest "generator not connected" error instead of simulated progress.
- **Autonomous Proactive Tasks**: Background task scheduler supporting cron expressions, intervals, and due dates for automated summaries, system audits, and reminder notifications.
- **VM Tab (no sandbox yet)**: reports real host-process metrics (RSS memory, uptime) and explicitly states that no isolated enclave exists.
- **Associative Long-Term Memory**: Persistent local JSON memory bank with categorization (preference, fact, project, instruction) and full-text keyword retrieval.
- **15 Agent Tools & Comprehensive CLI**: Full programmatic and terminal control for agents and power users alike.

---

## 📦 Architecture

```
bb-plugin-meta-muse/
├── package.json              # Plugin manifest & metadata (icon: Sparkles)
├── tsconfig.json             # TypeScript configuration
├── server.ts                 # Production-grade MetaMuseController & RPC endpoints
├── app.tsx                   # Iridescent dynamic UI with 4 main tabs
├── skills/
│   └── meta-muse/
│       └── SKILL.md          # Agent skill definition and CLI reference
├── src/
│   ├── types.ts              # Core shared data models & types
│   └── components/           # Modular UI widgets
├── PLUGIN_OVERVIEW.md        # Technical architecture details
└── README.md                 # Documentation and quickstart
```

---

## 🛠 15 Agent Tools

| Tool | Description |
|------|-------------|
| `muse_send_message` | Send message to Muse in specific mode |
| `muse_list_conversations` | List conversation sessions and preview latest messages |
| `muse_get_conversation_history` | Retrieve full message thread for a conversation |
| `muse_generate_media` | Queue media generation task in image/video studio |
| `muse_manage_schedule` | Configure proactive task schedules and triggers |
| `muse_list_proactive_tasks` | List all scheduled and background tasks |
| `muse_create_task` | Create new autonomous proactive task |
| `muse_get_task_status` | Get detailed execution status and logs for a task |
| `muse_cancel_task` | Pause, resume, or remove a proactive task |
| `muse_search_memory` | Query associative memory store by keyword or category |
| `muse_store_memory` | Store durable knowledge, user preferences, or directives |
| `muse_get_vm_status` | Audit VM sandbox telemetry, CPU/RAM quotas, and network rules |
| `muse_switch_mode` | Switch Muse operational mode (`creative`, `analytical`, `proactive`, `strict_sandbox`) |
| `muse_get_system_status` | Retrieve system telemetry, active queues, and host stats |
| `muse_export_chat` | Export conversation history to Markdown or JSON |

---

## ⚡ CLI Commands (`bb muse`)

```bash
bb muse status                      # View overall Muse status and telemetry
bb muse chat "Your message"          # Converse with Muse
bb muse chat --list                 # View existing conversations
bb muse tasks                       # List all proactive tasks
bb muse tasks create "Title" "1h"   # Create a proactive task
bb muse vm                          # Check VM sandbox status
bb muse memory list                 # View stored memories
bb muse memory store "key" "value"  # Save a new memory
bb muse tools                       # List available agent tools
```

---

## 💻 Installation

```bash
# In the plugin directory:
bb plugin install --yes .
```
