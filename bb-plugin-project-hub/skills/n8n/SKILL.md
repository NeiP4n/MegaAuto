---
name: n8n
description: "Control local & remote n8n automation instances, inspect and trigger workflows, dispatch webhooks, monitor execution history, and manage the local n8n server lifecycle. Use when orchestrating n8n nodes, triggering automations, checking execution logs, or troubleshooting n8n."
---

# n8n Automation & Workflow Management Skill

The `n8n` skill provides full control over local and remote n8n workflow automation instances within Blackbox. Everything is accessible via registered Blackbox agent tools and the `bb project-hub` CLI.

## Quick Cheat Sheet

```bash
# Check n8n server status, latency, and registered accounts
bb project-hub status

# Manage the local n8n server lifecycle (start, stop, check status)
bb project-hub server status
bb project-hub server start
bb project-hub server stop

# Inspect accounts and workflows
bb project-hub accounts
bb project-hub workflows
bb project-hub workflows acc-n8n-local

# Trigger a webhook endpoint directly
bb project-hub webhook test-webhook '{"msg": "Hello from Blackbox"}'

# Monitor and send commands to active workflow projects
bb project-hub list
bb project-hub send <projectId> "Execute daily backup"
```

---

## Agent Tools Reference

Agents in Blackbox can call the following registered tools directly:

### 1. Account & Workflow Inspection
- `project_hub_list_accounts`: Lists all registered n8n instances with connection status (`online`/`offline`), latency in milliseconds, workflow count, and execution totals.
- `project_hub_get_workflows`: Fetches workflows for an account (`id`, `name`, `active`, `tags`, `updatedAt`, `lastExecution`). Works via official REST API when an API key is set, and falls back seamlessly to local SQLite reading when unauthenticated.
- `project_hub_get_executions`: Retrieves recent execution history (`status`, `startedAt`, `durationMs`, `mode`, errors) for troubleshooting.
- `project_hub_sync`: Forces an immediate re-sync of workflows and execution history from n8n.

### 2. Webhook Dispatching & Automation Triggers
- `project_hub_dispatch_webhook`:
  - `path`: The webhook path configured in the n8n Webhook node (e.g. `test-webhook` or `/webhook/notify`).
  - `method`: `"POST"` (default) or `"GET"`.
  - `payload`: JSON object sent as the request body.
  - `accountId`: (Optional) Target n8n instance ID. Defaults to the local master instance.
- `project_hub_send_message`: Sends an interactive command or event to an active project's connected webhook/agent.

### 3. Server Process Control
- `project_hub_server_status`: Checks whether the local n8n server is listening on port 5678, reports PID, and returns recent console output logs.
- `project_hub_manage_server`:
  - `action`: `"start"` or `"status"`. Checks server status or launches the daemon process. (Stopping the server is restricted to the human operator via UI to prevent autonomous downtime).

---

## Local vs. Remote Instances

1. **Local n8n (Master)**:
   - Default URL: `http://127.0.0.1:5678` (or `http://localhost:5678`).
   - Managed automatically by the Project Hub plugin.
   - Dual-mode data fetching: If an API key is not configured, workflows and executions are read directly and safely from `~/.n8n/database.sqlite` (read-only SQLite).
2. **Remote n8n Instances**:
   - Registered via `Add Instance` in the UI or `create_account` RPC.
   - Requires an `X-N8N-API-KEY` generated from n8n Settings (`Settings` -> `n8n API`).

---

## Troubleshooting & Best Practices

- **Port in use (5678)**: After stopping n8n on Windows, TCP sockets may stay in `TIME_WAIT` for 15–30 seconds. Project Hub handles PID detection automatically. If a lingering process exists, `project_hub_manage_server` with `stop` will terminate it cleanly.
- **Deprecation & Warnings**: The local runner environment automatically sets `N8N_RUNNERS_ENABLED=false`, `N8N_DIAGNOSTICS_ENABLED=false`, and deprecation variables to keep logs clean and free of Python task runner noise.
- **Workflow Testing**: Always check `project_hub_get_executions` immediately after dispatching a webhook to verify whether the node execution succeeded or failed.
