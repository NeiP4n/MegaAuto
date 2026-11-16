// ============================================================================
// TYPES — bb-plugin-project-hub (n8n Multi-Instance Workflow Hub)
// ============================================================================

export interface Account {
  id: string;
  name: string;
  channel: "n8n" | "telegram" | "webhook";
  url: string;
  apiKey?: string | null;
  status: "online" | "syncing" | "offline";
  manualOffline?: boolean | null;
  workflowsCount: number;
  executionsCount: number;
  unreadTotal: number;
  lastSync: string;
  createdAt: string;
  latencyMs?: number | null;
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

export type ExecutionStatus = "success" | "running" | "error";

export interface N8nExecution {
  id: string;
  workflowId: string;
  workflowName?: string | null;
  status: ExecutionStatus | "waiting" | "canceled";
  startedAt: string;
  stoppedAt?: string | null;
  durationMs?: number | null;
  mode: "manual" | "trigger" | "webhook" | "retry" | "integrated";
  errorMessage?: string | null;
  errorNodeName?: string | null;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  tags?: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastExecution?: {
    id: string;
    status: ExecutionStatus;
    startedAt: string;
    durationMs?: number | null;
  } | null;
}

export interface MessageMetadata {
  workflowName?: string | null;
  executionId?: string | null;
  status?: ExecutionStatus | null;
  durationMs?: number | null;
  error?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  accountId?: string | null;
  sender: "system" | "agent" | "user" | "webhook";
  senderName: string;
  text: string;
  timestamp: string;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  metadata?: MessageMetadata | null;
}

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

export interface WebhookDispatchResult {
  ok: boolean;
  statusCode?: number;
  durationMs?: number;
  response?: unknown;
  error?: string;
}

export interface PingInstanceResult {
  ok: boolean;
  status: "online" | "offline";
  latencyMs: number;
  version?: string;
  error?: string;
}

export interface LocalServerStatus {
  ok: boolean;
  running: boolean;
  managedByPlugin: boolean;
  pid?: number;
  logs: string[];
  error?: string;
}

export interface AiChatResult {
  ok: boolean;
  reply: string;
  model: string;
  latencyMs?: number;
  error?: string | null;
}
