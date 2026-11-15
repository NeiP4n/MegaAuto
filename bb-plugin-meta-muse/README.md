# bb-plugin-meta-muse: Meta Muse AI

> **Meta Muse AI** is a next-generation proactive AI companion plugin for the Blackbox (BB) environment. It features an iridescent dynamic UI, creative media generation studio, secure VM isolation sandbox, autonomous proactive tasks, and associative long-term memory.

---

## 🌟 Key Features

- **Iridescent Dynamic Spectrum UI**: Deep obsidian theme (#0B0E14) accented by electric blue, vibrant magenta/violet, and fluid cyan glowing gradients with frosted glass cards.
- **Interactive Chat & Muse Timeline**: Context-aware conversation threads with proactive suggestion chips, rich markdown, media card embeds, and quick export.
- **Media Generation Studio**: Image and video prompt engineering studio with real-time rendering status, aspect ratio presets (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`), style filters, and seed controls.
- **Autonomous Proactive Tasks**: Background task scheduler supporting cron expressions, intervals, and due dates for automated summaries, system audits, and reminder notifications.
- **Secure VM Isolation Enclave**: Sandboxed execution metrics, strict memory and CPU quotas, whitelisted network policies, and active process tracking.
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
bb plugin install --yes "C:\Users\Isako\Desktop\MegaAuto\bb-plugin-meta-muse"
```
