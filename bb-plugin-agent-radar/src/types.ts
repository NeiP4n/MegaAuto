// ============================================================================
// TYPES — bb-plugin-agent-radar (Agent Radar & Activity HUD)
// ============================================================================

export type AgentState = "idle" | "executing_tool" | "thinking" | "waiting_user" | "background_task";

export interface AgentStep {
  stepIndex: number;
  source: string;
  type: string;
  status: string;
  createdAt: string;
  durationMs?: number;
  model?: string;
  toolName?: string;
  toolSummary?: string;
  toolCommand?: string;
  thinkingPreview?: string;
  contentPreview?: string;
}

export interface AgentRadarStatus {
  state: AgentState;
  canWrite: boolean;
  statusLabel: string;
  statusDescription: string;
  currentTool?: string;
  toolSummary?: string;
  toolCommand?: string;
  activeStepIndex?: number;
  startedAt?: string;
  elapsedSeconds: number;
  conversationId: string;
  model: string;
  recentSteps: AgentStep[];
  turnStepCount: number;
  totalTokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
  };
}

export interface RadarSettings {
  soundEnabled: boolean;
  volume: number;
  autoExpandOnBusy: boolean;
  showOverlay: boolean;
  position: "top-right" | "bottom-right" | "top-center" | "bottom-center";
}
