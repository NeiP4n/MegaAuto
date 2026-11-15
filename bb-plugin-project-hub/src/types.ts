// ============================================================================
// TYPES — bb-plugin-project-hub (n8n Multi-Instance Workflow Hub)
// ============================================================================

// ---------------------------------------------------------------------------
// Core domain entities (must stay in sync with server.ts Zod schemas)
// ---------------------------------------------------------------------------

export interface Account {
  id: string;
  name: string;
  channel: "n8n" | "telegram" | "webhook";
  url: string;
  apiKey?: string;
  status: "online" | "syncing" | "offline";
  /** true when the user switched the instance off by hand - live health checks must not flip it back on */
  manualOffline?: boolean;
  workflowsCount: number;
  executionsCount: number;
  unreadTotal: number;
  lastSync: string;
  createdAt: string;
}

export interface Project {
  id: string;
  accountId: string;
  name: string;
  channel: "n8n" | "telegram" | "webhook";
  status: "online" | "idle" | "offline";
  workflowId?: string;
  unreadCount: number;
  lastMessageTime: string;
  lastMessagePreview: string;
  aiActive: boolean;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Execution details — rich metadata for n8n workflow runs
// ---------------------------------------------------------------------------

/** Status of a single n8n workflow execution supported in chat message metadata */
export type ExecutionStatus = "success" | "running" | "error";

/** Condensed execution record returned by the n8n API */
export interface N8nExecution {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: ExecutionStatus | "waiting" | "canceled";
  startedAt: string;        // ISO 8601
  stoppedAt?: string;       // ISO 8601, absent while running
  durationMs?: number;
  mode: "manual" | "trigger" | "webhook" | "retry" | "integrated";
  errorMessage?: string;
  errorNodeName?: string;
}

/** Condensed workflow record returned by the n8n API */
export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Message / Chat
// ---------------------------------------------------------------------------

/** Metadata attached to a ChatMessage — mirrors the Zod schema in server.ts */
export interface MessageMetadata {
  workflowName?: string;
  executionId?: string;
  /** Live execution status badge: "success" | "running" | "error" */
  status?: ExecutionStatus;
  durationMs?: number;
  /** Arbitrary JSON payload (e.g. webhook body, n8n output data) */
  payload?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  accountId?: string;
  sender: "system" | "agent" | "user" | "webhook";
  senderName: string;
  text: string;
  timestamp: string;
  status: "sent" | "delivered" | "read";
  metadata?: MessageMetadata;
}

// ---------------------------------------------------------------------------
// Hub status (returned by get_status RPC)
// ---------------------------------------------------------------------------

export interface HubStatus {
  n8nConnected: boolean;
  n8nBaseUrl: string;
  n8nVersion: string;
  activeProjectsCount: number;
  totalMessagesCount: number;
  connectedAccountsCount: number;
  lastSyncTime: string;
  sqliteStatus: "connected" | "fallback_local" | "disabled";
}

// ---------------------------------------------------------------------------
// RPC input / output shapes (typed aliases to avoid import of server Zod types)
// ---------------------------------------------------------------------------

/** Input to send_message RPC */
export interface SendMessageInput {
  projectId: string;
  text: string;
  mode: "command" | "message";
}

/** Output of send_message RPC */
export interface SendMessageOutput {
  ok: boolean;
  message: ChatMessage;
  error?: string;
}

/** Input to sync_n8n RPC — accountId targets a specific registered account */
export interface SyncN8nInput {
  n8nBaseUrl?: string;
  apiKey?: string;
  /** If provided, only sync this registered account */
  accountId?: string;
}

/** Output of sync_n8n RPC */
export interface SyncN8nOutput {
  ok: boolean;
  syncedProjects: number;
  syncedMessages: number;
  error?: string;
}

/** Input to create_account RPC */
export interface CreateAccountInput {
  name: string;
  channel: "n8n" | "telegram" | "webhook";
  url: string;
  apiKey?: string;
}

export interface CreateProjectInput {
  accountId: string;
  name: string;
  channel?: "n8n" | "telegram" | "webhook";
  workflowId?: string;
  tags?: string[];
}

export interface ToggleProjectStatusInput {
  projectId: string;
  status?: "online" | "offline";
}

// ---------------------------------------------------------------------------
// Webhook payload schemas — inbound events pushed to the hub
// ---------------------------------------------------------------------------

/** Common envelope for all inbound webhook events */
export interface WebhookEventEnvelope {
  /** Identifies the registered account / instance that emitted the event */
  accountId: string;
  /** Target project (workflow) this event belongs to */
  projectId?: string;
  event: WebhookEvent;
  receivedAt: string; // ISO 8601
}

/** Discriminated union of all supported webhook event types */
export type WebhookEvent =
  | ExecutionFinishedEvent
  | ExecutionErrorEvent
  | WorkflowActivatedEvent
  | WorkflowDeactivatedEvent
  | CustomMessageEvent;

export interface ExecutionFinishedEvent {
  type: "execution.finished";
  executionId: string;
  workflowId: string;
  workflowName: string;
  status: "success" | "canceled";
  durationMs: number;
  outputData?: Record<string, unknown>;
}

export interface ExecutionErrorEvent {
  type: "execution.error";
  executionId: string;
  workflowId: string;
  workflowName: string;
  errorMessage: string;
  errorNodeName?: string;
  durationMs?: number;
}

export interface WorkflowActivatedEvent {
  type: "workflow.activated";
  workflowId: string;
  workflowName: string;
}

export interface WorkflowDeactivatedEvent {
  type: "workflow.deactivated";
  workflowId: string;
  workflowName: string;
}

export interface CustomMessageEvent {
  type: "message";
  text: string;
  sender?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Map channel string to a human-readable label */
export const CHANNEL_LABELS: Record<Account["channel"], string> = {
  n8n: "n8n Instance",
  telegram: "Telegram Gateway",
  webhook: "Webhook Router",
};

/** Map execution status to a UI severity level */
export const EXECUTION_STATUS_SEVERITY: Record<ExecutionStatus, "success" | "warning" | "error" | "info"> = {
  success: "success",
  running: "info",
  error: "error",
};
