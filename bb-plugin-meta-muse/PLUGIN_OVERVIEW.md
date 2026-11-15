# Meta Muse AI: Deep Dive & Technical Overview

> **Honest status (after de-mock review):** the LLM backend, the media generator and the isolated VM enclave described in this document are design intent, not current reality. Chat returns an explicit "no AI backend connected" reply, media jobs fail with a clear error, and VM metrics show real host-process data (RSS, uptime) with no fabricated sandbox. The scheduler (cron/interval/due date) and the local memory store are real.

## 1. System Architecture

Meta Muse AI is engineered as a multi-tier modular assistant running inside the Blackbox (BB) host ecosystem.

```
┌────────────────────────────────────────────────────────┐
│                   Meta Muse App (UI)                   │
│   Tab 1: Chat   Tab 2: Studio   Tab 3: Tasks   Tab 4: VM│
└───────────────────────────┬────────────────────────────┘
                            │ (Typed RPC Contracts)
┌───────────────────────────▼────────────────────────────┐
│                  server.ts (Backend)                   │
│ ┌────────────────────────────────────────────────────┐ │
│ │                MetaMuseController                  │ │
│ │  ├─ SessionManager (Chat & threads)               │ │
│ │  ├─ MediaQueue (Async rendering jobs)              │ │
│ │  ├─ ProactiveScheduler (Cron/Interval timers)      │ │
│ │  ├─ VMSandboxEnclave (Isolated compute telemetry)  │ │
│ │  └─ MemoryStore (Persistent associative storage)   │ │
│ └────────────────────────────────────────────────────┘ │
│  ├─ 15 Agent Tools (bb.agents.registerTool)           │
│  ├─ CLI Command Group (bb.cli.register 'bb muse')     │
│  └─ Reactive RPC Handler (bb.rpc.register)            │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│         Host Storage & Secure Isolation Layer          │
│   ~/.bb/meta-muse/store.json & Sandboxed Environments  │
└────────────────────────────────────────────────────────┘
```

## 2. Core Modules

### 2.1 MetaMuseController
The single source of truth for the plugin. Manages state synchronization between server, agent tools, CLI, and frontend UI.
- **Sessions & Conversations**: Supports multiple concurrent threads, dynamic titling, automatic proactive suggestion generation, and rich message timestamps.
- **Media Queue**: Handles generation tasks for both Still Concept Art (Images) and Dynamic Canvas (Videos), simulating realistic progression with seed determinism and style filters.
- **Proactive Scheduler**: Maintains interval and cron-based background jobs. Automatically runs scheduled actions (digest, reminder, audit) and appends execution logs.
- **Secure VM Isolation Enclave**: Monitors memory limits (default 2048 MB), CPU quota allocation (e.g., 75%), allowed domain whitelisting, and air-gapped policies for strict security.
- **Associative Memory Store**: Persists knowledge items in structured JSON format under user BB directory, supporting categorization, tag indexing, and query matching.

### 2.2 Agent Tools (15 Tools)
Registered with Zod schemas through `bb.agents.registerTool`:
- `muse_send_message`: Sends message to Muse, returns structured response with suggestions.
- `muse_list_conversations`: Summarizes active threads.
- `muse_get_conversation_history`: Retrieves messages with timestamps and media attachments.
- `muse_generate_media`: Submits new rendering request to the studio.
- `muse_manage_schedule`: Configures task cadence.
- `muse_list_proactive_tasks`: Reads all background tasks.
- `muse_create_task`: Enqueues an automated periodic job.
- `muse_get_task_status`: Inspects execution status and logs.
- `muse_cancel_task`: Pauses, resumes, or removes a task.
- `muse_search_memory`: Semantic lookup over saved facts and directives.
- `muse_store_memory`: Stores user preferences or system facts.
- `muse_get_vm_status`: Queries VM enclave security posture and resource usage.
- `muse_switch_mode`: Changes runtime mode between creative, analytical, proactive, and strict sandbox.
- `muse_get_system_status`: Inspects plugin uptime, active queues, and host hardware.
- `muse_export_chat`: Formats thread to downloadable Markdown or JSON.

### 2.3 CLI Integration
Under `bb muse`:
- `status`: High-level operational overview.
- `chat`: Direct CLI conversation with Muse.
- `tasks`: Inspect and trigger proactive automations.
- `vm`: Audit sandbox metrics.
- `memory`: Search and store durable notes.
- `tools`: Output documentation of registered tools.

### 2.4 RPC Interface
Provides seamless bidirectional typed contracts with React client in `app.tsx`, ensuring zero latency and atomic updates.
