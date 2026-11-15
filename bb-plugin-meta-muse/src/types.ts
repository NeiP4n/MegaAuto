export type MuseMode = 'creative' | 'analytical' | 'proactive' | 'strict_sandbox';

export interface MuseConversation {
  id: string;
  title: string;
  mode: MuseMode;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  tags?: string[];
}

export interface MuseMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  mediaUrls?: string[];
  suggestions?: string[];
  metadata?: Record<string, unknown>;
}

export interface MediaJob {
  id: string;
  prompt: string;
  negativePrompt?: string;
  type: 'image' | 'video';
  stylePreset: string;
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  progress: number;
  resultUrl?: string;
  seed?: number;
  steps?: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface ProactiveTask {
  id: string;
  title: string;
  description: string;
  triggerType: 'cron' | 'interval' | 'due_date';
  scheduleExpression: string; // e.g., '0 9 * * *' or '30m' or ISO date
  actionType: 'reminder' | 'digest' | 'audit' | 'web_poll' | 'custom_script';
  payload?: Record<string, unknown>;
  status: 'active' | 'paused' | 'completed' | 'failed';
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  logs: Array<{
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
  }>;
}

export interface MemoryRecord {
  id: string;
  key: string;
  content: string;
  category: 'preference' | 'fact' | 'project' | 'instruction';
  confidence: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VMProcess {
  pid: number;
  name: string;
  cpu: number;
  memoryMB: number;
}

export interface VMStatus {
  status: 'isolated' | 'running' | 'paused' | 'quarantined';
  memoryLimitMB: number;
  memoryUsedMB: number;
  cpuQuotaPercent: number;
  secureEnclave: boolean;
  activeProcesses: VMProcess[];
  networkPolicy: 'airgapped' | 'whitelisted' | 'proxy';
  allowedDomains: string[];
  uptimeSeconds: number;
  lastSecurityAudit: string;
}

export interface SystemStatus {
  version: string;
  uptimeSeconds: number;
  currentMode: MuseMode;
  activeSessionsCount: number;
  queuedMediaCount: number;
  proactiveTasksCount: number;
  memoryRecordsCount: number;
  vmStatus: string;
  hardware: {
    cpuModel: string;
    totalMemoryMB: number;
    freeMemoryMB: number;
    platform: string;
  };
}
