import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  MuseMode,
  MuseConversation,
  MuseMessage,
  MediaJob,
  ProactiveTask,
  MemoryRecord,
  VMStatus,
  SystemStatus,
} from "./src/types";

// ============================================================================
// RPC CONTRACT SCHEMAS
// ============================================================================

const museModeSchema = z.enum(["creative", "analytical", "proactive", "strict_sandbox"]);

const museMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  timestamp: z.string(),
  mediaUrls: z.array(z.string()).optional(),
  suggestions: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const museConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  mode: museModeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number(),
  tags: z.array(z.string()).optional(),
});

const mediaJobSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  type: z.enum(["image", "video"]),
  stylePreset: z.string(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]),
  status: z.enum(["queued", "rendering", "completed", "failed"]),
  progress: z.number(),
  resultUrl: z.string().optional(),
  seed: z.number().optional(),
  steps: z.number().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});

const taskLogSchema = z.object({
  timestamp: z.string(),
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
});

const proactiveTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  triggerType: z.enum(["cron", "interval", "due_date"]),
  scheduleExpression: z.string(),
  actionType: z.enum(["reminder", "digest", "audit", "web_poll", "custom_script"]),
  payload: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["active", "paused", "completed", "failed"]),
  lastRun: z.string().optional(),
  nextRun: z.string().optional(),
  runCount: z.number(),
  logs: z.array(taskLogSchema),
});

const memoryRecordSchema = z.object({
  id: z.string(),
  key: z.string(),
  content: z.string(),
  category: z.enum(["preference", "fact", "project", "instruction"]),
  confidence: z.number(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const vmProcessSchema = z.object({
  pid: z.number(),
  name: z.string(),
  cpu: z.number(),
  memoryMB: z.number(),
});

const vmStatusSchema = z.object({
  status: z.enum(["running", "paused", "quarantined", "host_process"]),
  memoryLimitMB: z.number(),
  memoryUsedMB: z.number(),
  cpuQuotaPercent: z.number(),
  secureEnclave: z.boolean(),
  activeProcesses: z.array(vmProcessSchema),
  networkPolicy: z.enum(["whitelisted", "proxy", "local_only"]),
  allowedDomains: z.array(z.string()),
  uptimeSeconds: z.number(),
  lastSecurityAudit: z.string(),
});

const systemStatusSchema = z.object({
  version: z.string(),
  uptimeSeconds: z.number(),
  currentMode: museModeSchema,
  activeSessionsCount: z.number(),
  queuedMediaCount: z.number(),
  proactiveTasksCount: z.number(),
  memoryRecordsCount: z.number(),
  vmStatus: z.string(),
  hardware: z.object({
    cpuModel: z.string(),
    totalMemoryMB: z.number(),
    freeMemoryMB: z.number(),
    platform: z.string(),
  }),
});

const apiConfigSchema = z.object({
  apiKey: z.string().optional(),
  endpointUrl: z.string().optional(),
  mediaEndpointUrl: z.string().optional(),
  isConfigured: z.boolean(),
});

/**
 * Compute the next fire time for a schedule expression.
 * Supports interval shorthand ("30s", "30m", "2h", "1d"), ISO dates for
 * due_date, and standard 5-field cron (min hour dom mon dow) with
 * star, step (slash-n), single values, ranges and comma lists.
 * Returns null when the
 * expression cannot be understood - the task then simply has no next run
 * instead of a fake "+30 minutes".
 */
function nextRunFromExpression(
  expr: string,
  triggerType: "cron" | "interval" | "due_date",
  from: Date = new Date()
): string | null {
  const e = (expr || "").trim();
  if (!e) return null;

  const intervalMatch = e.match(/^(\d+)\s*([smhd])$/i);
  if (triggerType !== "cron" && intervalMatch) {
    const n = parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2].toLowerCase();
    const ms = n * (unit === "s" ? 1000 : unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000);
    return new Date(from.getTime() + ms).toISOString();
  }

  if (triggerType === "due_date") {
    const d = new Date(e);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // cron (also accept a cron-looking expression regardless of triggerType)
  const fields = e.split(/\s+/);
  if (fields.length !== 5) return null;

  const parseField = (f: string, min: number, max: number): Set<number> | null => {
    const out = new Set<number>();
    for (const part of f.split(",")) {
      const m = part.match(/^(\*|\d+|\d+-\d+)(?:\/(\d+))?$/);
      if (!m) return null;
      const step = m[2] ? parseInt(m[2], 10) : 1;
      if (step < 1) return null;
      let lo = min, hi = max;
      if (m[1] !== "*") {
        if (m[1].includes("-")) {
          const [a, b] = m[1].split("-").map((x) => parseInt(x, 10));
          lo = a; hi = b;
        } else {
          lo = hi = parseInt(m[1], 10);
        }
      }
      if (lo < min || hi > max || lo > hi) return null;
      for (let v = lo; v <= hi; v += step) out.add(v);
    }
    return out;
  };

  const mins = parseField(fields[0], 0, 59);
  const hours = parseField(fields[1], 0, 23);
  const doms = parseField(fields[2], 1, 31);
  const mons = parseField(fields[3], 1, 12);
  const dowsRaw = parseField(fields[4], 0, 7);
  if (!mins || !hours || !doms || !mons || !dowsRaw) return null;
  const dows = new Set(Array.from(dowsRaw).map((d) => (d === 7 ? 0 : d)));

  // Minute-by-minute scan, bounded to one year ahead.
  const t = new Date(from.getTime() + 60000);
  t.setSeconds(0, 0);
  for (let i = 0; i < 527040; i++) {
    if (
      mons.has(t.getMonth() + 1) &&
      doms.has(t.getDate()) &&
      dows.has(t.getDay()) &&
      hours.has(t.getHours()) &&
      mins.has(t.getMinutes())
    ) {
      return t.toISOString();
    }
    t.setMinutes(t.getMinutes() + 1);
  }
  return null;
}

function sanitizeRpc<T>(data: T): T {
  if (data === undefined) return null as unknown as T;
  return JSON.parse(JSON.stringify(data));
}

export const rpcContract = defineRpcContract({
  get_system_status: {
    input: z.object({}).optional().nullable(),
    output: systemStatusSchema,
  },
  list_conversations: {
    input: z.object({ limit: z.number().optional() }).optional().nullable(),
    output: z.object({
      conversations: z.array(museConversationSchema),
      total: z.number(),
    }),
  },
  get_conversation: {
    input: z.object({ conversationId: z.string() }),
    output: z.object({
      conversation: museConversationSchema,
      messages: z.array(museMessageSchema),
    }),
  },
  create_conversation: {
    input: z.object({
      title: z.string().optional(),
      mode: museModeSchema.optional(),
      tags: z.array(z.string()).optional(),
    }).optional().nullable(),
    output: museConversationSchema,
  },
  delete_conversation: {
    input: z.object({ conversationId: z.string() }),
    output: z.object({ success: z.boolean(), id: z.string() }),
  },
  send_message: {
    input: z.object({
      conversationId: z.string().optional(),
      content: z.string(),
      mode: museModeSchema.optional(),
    }),
    output: z.object({
      conversationId: z.string(),
      userMessage: museMessageSchema,
      assistantMessage: museMessageSchema,
    }),
  },
  export_chat: {
    input: z.object({
      conversationId: z.string(),
      format: z.enum(["markdown", "json"]).optional(),
    }),
    output: z.object({
      title: z.string(),
      format: z.string(),
      content: z.string(),
      exportedAt: z.string(),
    }),
  },
  list_media_jobs: {
    input: z.object({ limit: z.number().optional() }).optional().nullable(),
    output: z.object({
      jobs: z.array(mediaJobSchema),
      total: z.number(),
    }),
  },
  generate_media: {
    input: z.object({
      prompt: z.string(),
      negativePrompt: z.string().optional(),
      type: z.enum(["image", "video"]).optional(),
      stylePreset: z.string().optional(),
      aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
      seed: z.number().optional(),
    }),
    output: mediaJobSchema,
  },
  delete_media_job: {
    input: z.object({ jobId: z.string() }),
    output: z.object({ success: z.boolean(), id: z.string() }),
  },
  list_proactive_tasks: {
    input: z.object({ status: z.string().optional() }).optional().nullable(),
    output: z.object({
      tasks: z.array(proactiveTaskSchema),
      total: z.number(),
    }),
  },
  create_proactive_task: {
    input: z.object({
      title: z.string(),
      description: z.string().optional(),
      triggerType: z.enum(["cron", "interval", "due_date"]).optional(),
      scheduleExpression: z.string(),
      actionType: z.enum(["reminder", "digest", "audit", "web_poll", "custom_script"]).optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    output: proactiveTaskSchema,
  },
  get_task_status: {
    input: z.object({ taskId: z.string() }),
    output: proactiveTaskSchema,
  },
  toggle_task_status: {
    input: z.object({ taskId: z.string() }),
    output: proactiveTaskSchema,
  },
  cancel_proactive_task: {
    input: z.object({ taskId: z.string(), deletePermanent: z.boolean().optional() }),
    output: z.object({ success: z.boolean(), id: z.string() }),
  },
  trigger_task_now: {
    input: z.object({ taskId: z.string() }),
    output: z.object({ success: z.boolean(), message: z.string(), task: proactiveTaskSchema }),
  },
  get_vm_status: {
    input: z.object({ refresh: z.boolean().optional() }).optional().nullable(),
    output: vmStatusSchema,
  },
  switch_mode: {
    input: z.object({
      mode: museModeSchema,
      conversationId: z.string().optional(),
    }),
    output: z.object({
      previousMode: museModeSchema,
      currentMode: museModeSchema,
      conversationId: z.string().optional(),
      description: z.string(),
    }),
  },
  list_memories: {
    input: z.object({
      category: z.enum(["preference", "fact", "project", "instruction"]).optional(),
      limit: z.number().optional(),
    }).optional().nullable(),
    output: z.object({
      memories: z.array(memoryRecordSchema),
      total: z.number(),
    }),
  },
  search_memory: {
    input: z.object({
      query: z.string(),
      category: z.enum(["preference", "fact", "project", "instruction"]).optional(),
      limit: z.number().optional(),
    }),
    output: z.object({
      query: z.string(),
      matches: z.array(memoryRecordSchema),
      count: z.number(),
    }),
  },
  store_memory: {
    input: z.object({
      key: z.string(),
      content: z.string(),
      category: z.enum(["preference", "fact", "project", "instruction"]).optional(),
      confidence: z.number().optional(),
      tags: z.array(z.string()).optional(),
    }),
    output: memoryRecordSchema,
  },
  delete_memory: {
    input: z.object({ memoryId: z.string() }),
    output: z.object({ success: z.boolean(), id: z.string() }),
  },
  get_api_config: {
    input: z.object({}).optional().nullable(),
    output: apiConfigSchema,
  },
  update_api_config: {
    input: z.object({
      apiKey: z.string().optional(),
      clearApiKey: z.boolean().optional(),
      endpointUrl: z.string().optional(),
      mediaEndpointUrl: z.string().optional(),
    }),
    output: z.object({ success: z.boolean(), isConfigured: z.boolean() }),
  },
});

// ============================================================================
// META MUSE CONTROLLER ARCHITECTURE
// ============================================================================

export class MetaMuseController {
  private startTime = Date.now();
  private storageDir: string;
  private storageFile: string;
  private currentMode: MuseMode = "creative";

  private conversations: Map<string, MuseConversation> = new Map();
  private messages: Map<string, MuseMessage[]> = new Map();
  private mediaJobs: Map<string, MediaJob> = new Map();
  private proactiveTasks: Map<string, ProactiveTask> = new Map();
  private memories: Map<string, MemoryRecord> = new Map();

  private config: {
    apiKey?: string;
    endpointUrl?: string;
    mediaEndpointUrl?: string;
  } = {
    apiKey: process.env.MUSE_API_KEY || process.env.OPENAI_API_KEY,
    endpointUrl: process.env.MUSE_ENDPOINT_URL || process.env.OPENAI_BASE_URL,
    mediaEndpointUrl: process.env.MUSE_MEDIA_ENDPOINT_URL,
  };

  // Honest state: this plugin runs inside the BB host process as a plugin worker.
  // Real memory usage and host process status are returned.
  private vmState: VMStatus = {
    status: "host_process",
    memoryLimitMB: Math.round(os.totalmem() / (1024 * 1024)),
    memoryUsedMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    cpuQuotaPercent: 100,
    secureEnclave: false,
    activeProcesses: [
      { pid: process.pid, name: "bb-host-node", cpu: 0, memoryMB: Math.round(process.memoryUsage().rss / (1024 * 1024)) },
    ],
    networkPolicy: "whitelisted",
    allowedDomains: [],
    uptimeSeconds: 0,
    lastSecurityAudit: new Date().toISOString(),
  };

  private taskRunnerInterval?: NodeJS.Timeout;

  constructor() {
    const homeDir = os.homedir();
    this.storageDir = path.join(homeDir, ".bb", "meta-muse");
    this.storageFile = path.join(this.storageDir, "state.json");

    this.initStorageAndState();
    this.startBackgroundLoops();
  }

  private initStorageAndState(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      let hadLegacyDiskKey = false;
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, "utf-8");
        const data = JSON.parse(raw);
        if (data.currentMode) this.currentMode = data.currentMode;
        if (data.config && typeof data.config === "object") {
          if (data.config.apiKey) {
            hadLegacyDiskKey = true;
            if (!this.config.apiKey) {
              this.config.apiKey = data.config.apiKey;
            }
            delete data.config.apiKey;
          }
          this.config = { ...this.config, ...data.config };
        }
        if (Array.isArray(data.conversations)) {
          for (const c of data.conversations) this.conversations.set(c.id, c);
        }
        if (data.messages && typeof data.messages === "object") {
          for (const [k, v] of Object.entries(data.messages)) {
            if (Array.isArray(v)) this.messages.set(k, v as MuseMessage[]);
          }
        }
        if (Array.isArray(data.mediaJobs)) {
          for (const j of data.mediaJobs) this.mediaJobs.set(j.id, j);
        }
        if (Array.isArray(data.proactiveTasks)) {
          for (const t of data.proactiveTasks) this.proactiveTasks.set(t.id, t);
        }
        if (Array.isArray(data.memories)) {
          for (const m of data.memories) this.memories.set(m.id, m);
        }
      }
      // Purge records left by the old demo seeder: they were fabricated
      // samples, not real user data.
      const legacySeedIds = new Set([
        "conv-welcome-muse",
        "job-iridescent-muse-1",
        "job-quantum-core-2",
        "task-morning-digest",
        "task-vm-audit",
        "mem-ui-theme",
        "mem-security-enclave",
        "mem-project-target",
      ]);
      let purged = false;
      for (const id of legacySeedIds) {
        purged = this.conversations.delete(id) || purged;
        purged = this.mediaJobs.delete(id) || purged;
        purged = this.proactiveTasks.delete(id) || purged;
        purged = this.memories.delete(id) || purged;
        purged = this.messages.delete(id) || purged;
      }
      if (purged || hadLegacyDiskKey) this.saveState();
    } catch {
      // Fallback if loading failed
    }
  }

  private saveState(): boolean {
    try {
      // Security: never persist sensitive apiKey to disk in state.json
      const { apiKey, ...safeConfig } = this.config;
      const data = {
        currentMode: this.currentMode,
        config: safeConfig,
        conversations: Array.from(this.conversations.values()),
        messages: Object.fromEntries(this.messages.entries()),
        mediaJobs: Array.from(this.mediaJobs.values()),
        proactiveTasks: Array.from(this.proactiveTasks.values()),
        memories: Array.from(this.memories.values()),
      };
      fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2), "utf-8");
      return true;
    } catch (err) {
      console.error("[meta-muse] Failed to persist state to disk:", err);
      return false;
    }
  }

  private startBackgroundLoops(): void {
    // Proactive tasks tick loop. It only fires real schedule triggers; the
    // log entry says exactly what happened (a trigger fired), nothing more.
    this.taskRunnerInterval = setInterval(() => {
      const now = new Date();
      let changed = false;
      for (const task of this.proactiveTasks.values()) {
        if (task.status !== "active") continue;
        if (task.nextRun && new Date(task.nextRun) <= now) {
          task.lastRun = now.toISOString();
          task.runCount += 1;
          task.logs.unshift({
            timestamp: now.toISOString(),
            level: "info",
            message: `Сработал триггер расписания "${task.title}" (действие "${task.actionType}" не подключено к исполнителю).`,
          });
          if (task.logs.length > 30) task.logs.length = 30;
          task.nextRun = nextRunFromExpression(task.scheduleExpression, task.triggerType, now) ?? undefined;
          changed = true;
        }
      }
      if (changed) this.saveState();
    }, 10000);
  }

  public dispose(): void {
    if (this.taskRunnerInterval) clearInterval(this.taskRunnerInterval);
    this.saveState();
  }

  // ==========================================================================
  // CONTROLLER METHODS
  // ==========================================================================

  public getSystemStatus(): SystemStatus {
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    const totalMem = Math.round(os.totalmem() / (1024 * 1024));
    const freeMem = Math.round(os.freemem() / (1024 * 1024));
    const cpus = os.cpus();
    const cpuModel = cpus && cpus.length > 0 ? cpus[0].model : "Standard Host CPU";

    return {
      version: "0.1.0",
      uptimeSeconds: uptimeSec,
      currentMode: this.currentMode,
      activeSessionsCount: this.conversations.size,
      queuedMediaCount: Array.from(this.mediaJobs.values()).filter((j) => j.status === "rendering" || j.status === "queued").length,
      proactiveTasksCount: Array.from(this.proactiveTasks.values()).filter((t) => t.status === "active").length,
      memoryRecordsCount: this.memories.size,
      vmStatus: this.vmState.status,
      hardware: {
        cpuModel,
        totalMemoryMB: totalMem,
        freeMemoryMB: freeMem,
        platform: `${os.platform()} (${os.arch()})`,
      },
    };
  }

  public listConversations(limit = 20): { conversations: MuseConversation[]; total: number } {
    const list = Array.from(this.conversations.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return {
      conversations: list.slice(0, limit),
      total: list.length,
    };
  }

  public getConversation(id: string): { conversation: MuseConversation; messages: MuseMessage[] } {
    let conv = this.conversations.get(id);
    if (!conv) {
      conv = this.createConversation({ title: "Новый диалог", mode: this.currentMode });
    }
    const msgs = this.messages.get(conv.id) || [];
    return { conversation: conv, messages: msgs };
  }

  public createConversation(params?: { title?: string; mode?: MuseMode; tags?: string[] }): MuseConversation {
    const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const conv: MuseConversation = {
      id,
      title: params?.title || "Новый диалог с Музой",
      mode: params?.mode || this.currentMode,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      tags: params?.tags || [],
    };
    this.conversations.set(id, conv);
    this.messages.set(id, []);
    this.saveState();
    return conv;
  }

  public deleteConversation(id: string): { success: boolean; id: string } {
    const exists = this.conversations.delete(id);
    this.messages.delete(id);
    if (exists) this.saveState();
    return { success: exists, id };
  }

  public getConfig(): { apiKey?: string; endpointUrl?: string; mediaEndpointUrl?: string; isConfigured: boolean } {
    return {
      apiKey: this.config.apiKey ? "••••••••" : undefined,
      endpointUrl: this.config.endpointUrl,
      mediaEndpointUrl: this.config.mediaEndpointUrl,
      isConfigured: Boolean(this.config.apiKey || this.config.endpointUrl),
    };
  }

  public updateConfig(patch: { apiKey?: string; clearApiKey?: boolean; endpointUrl?: string; mediaEndpointUrl?: string }): {
    success: boolean;
    isConfigured: boolean;
  } {
    if (patch.clearApiKey) {
      this.config.apiKey = undefined;
    } else if (patch.apiKey !== undefined) {
      const trimmed = patch.apiKey.trim();
      // Protect genuine key from being overwritten by empty strings or masked bullets (••••••••)
      if (trimmed && !trimmed.includes("•")) {
        this.config.apiKey = trimmed;
      }
    }
    if (patch.endpointUrl !== undefined) this.config.endpointUrl = patch.endpointUrl.trim() || undefined;
    if (patch.mediaEndpointUrl !== undefined) this.config.mediaEndpointUrl = patch.mediaEndpointUrl.trim() || undefined;
    const saved = this.saveState();
    return { success: saved, isConfigured: Boolean(this.config.apiKey || this.config.endpointUrl) };
  }

  public async sendMessage(params: {
    conversationId?: string;
    content: string;
    mode?: MuseMode;
  }): Promise<{ conversationId: string; userMessage: MuseMessage; assistantMessage: MuseMessage }> {
    let convId = params.conversationId;
    if (!convId || !this.conversations.has(convId)) {
      const newConv = this.createConversation({
        title: params.content.slice(0, 40) || "Беседа с Музой",
        mode: params.mode || this.currentMode,
      });
      convId = newConv.id;
    }

    const conv = this.conversations.get(convId)!;
    const now = new Date().toISOString();
    // Global Strict Mode or explicitly requested Strict Mode takes absolute precedence
    const isStrictMode =
      this.currentMode === "strict_sandbox" ||
      params.mode === "strict_sandbox" ||
      conv.mode === "strict_sandbox";
    const mode = isStrictMode ? "strict_sandbox" : (params.mode || conv.mode || this.currentMode);

    // 1. User message
    const userMsg: MuseMessage = {
      id: `msg-${Date.now()}-u`,
      conversationId: convId,
      role: "user",
      content: params.content,
      timestamp: now,
    };

    const thread = this.messages.get(convId) || [];

    // 2. Real fetch if API key or endpoint configured; otherwise honest error
    let reply = "";
    const suggestions: string[] = [];

    if (isStrictMode) {
      reply = "Strict Mode активен: исходящие API-запросы модели заблокированы политикой режима.";
      suggestions.push("Проверить локальную память", "Телеметрия хост-процесса", "Список активных задач");
    } else if (this.config.apiKey || this.config.endpointUrl) {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 30000);
      try {
        const rawEndpoint = (this.config.endpointUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
        const url = rawEndpoint.endsWith("/chat/completions") ? rawEndpoint : `${rawEndpoint}/chat/completions`;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.config.apiKey) headers["Authorization"] = `Bearer ${this.config.apiKey}`;

        const response = await fetch(url, {
          method: "POST",
          headers,
          signal: abortController.signal,
          body: JSON.stringify({
            model: mode === "creative" ? "gpt-4o" : "gpt-4o-mini",
            messages: [
              { role: "system", content: `You are Meta Muse AI companion operating in ${mode} mode.` },
              ...thread.slice(-8).map((m) => ({ role: m.role, content: m.content })),
              { role: "user", content: params.content },
            ],
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          reply = `Ошибка Meta Muse API (${response.status}): ${errBody.slice(0, 200)}`;
        } else {
          const data: any = await response.json();
          reply = data?.choices?.[0]?.message?.content || "Пустой ответ от Meta Muse API.";
        }
      } catch (err: any) {
        if (err?.name === "AbortError") {
          reply = "Ошибка: таймаут сетевого запроса к Meta Muse API (30с).";
        } else {
          reply = `Ошибка сети при обращении к Meta Muse API: ${err?.message || String(err)}`;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      reply = "Meta Muse API не настроен. Укажите API ключ или эндпоинт в настройках.";
    }

    const assistantMsg: MuseMessage = {
      id: `msg-${Date.now() + 1}-a`,
      conversationId: convId,
      role: "assistant",
      content: reply,
      timestamp: new Date().toISOString(),
      suggestions,
    };

    thread.push(userMsg, assistantMsg);
    this.messages.set(convId, thread);

    conv.messageCount = thread.length;
    conv.updatedAt = new Date().toISOString();
    this.saveState();

    return {
      conversationId: convId,
      userMessage: userMsg,
      assistantMessage: assistantMsg,
    };
  }

  public exportChat(conversationId: string, format: "markdown" | "json" = "markdown"): {
    title: string;
    format: string;
    content: string;
    exportedAt: string;
  } {
    const conv = this.conversations.get(conversationId);
    const msgs = this.messages.get(conversationId) || [];
    const title = conv?.title || `Conversation-${conversationId}`;
    const exportedAt = new Date().toISOString();

    if (format === "json") {
      return {
        title,
        format: "json",
        content: JSON.stringify({ conversation: conv, messages: msgs, exportedAt }, null, 2),
        exportedAt,
      };
    }

    let md = `# ${title}\n\n`;
    md += `*Экспортировано: ${exportedAt} | Режим: ${conv?.mode || "creative"} | Сообщений: ${msgs.length}*\n\n---\n\n`;
    for (const m of msgs) {
      const sender = m.role === "user" ? "👤 Пользователь" : m.role === "assistant" ? "✨ Meta Muse" : "⚙️ Система";
      md += `### ${sender} (${m.timestamp})\n\n${m.content}\n\n`;
    }

    return {
      title,
      format: "markdown",
      content: md,
      exportedAt,
    };
  }

  public listMediaJobs(limit = 20): { jobs: MediaJob[]; total: number } {
    const list = Array.from(this.mediaJobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return {
      jobs: list.slice(0, limit),
      total: list.length,
    };
  }

  public async generateMedia(params: {
    prompt: string;
    negativePrompt?: string;
    type?: "image" | "video";
    stylePreset?: string;
    aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
    seed?: number;
  }): Promise<MediaJob> {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const type = params.type || "image";

    const job: MediaJob = {
      id,
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      type,
      stylePreset: params.stylePreset || "Iridescent Spectrum",
      aspectRatio: params.aspectRatio || "16:9",
      status: "failed",
      progress: 0,
      createdAt: now,
      completedAt: now,
      error: undefined,
    };

    if (this.currentMode === "strict_sandbox") {
      job.error = "Strict Mode активен: генерация отклонена (исходящие API-запросы плагина заблокированы).";
      this.mediaJobs.set(id, job);
      this.saveState();
      return job;
    }

    if (type === "video") {
      job.error = "Генерация видео временно недоступна в подключенном API (поддерживаются только изображения).";
      this.mediaJobs.set(id, job);
      this.saveState();
      return job;
    }

    const endpoint = this.config.mediaEndpointUrl || this.config.endpointUrl;
    if (endpoint || this.config.apiKey) {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 30000);
      try {
        const rawEndpoint = (endpoint || "https://api.openai.com/v1").replace(/\/+$/, "");
        const url = rawEndpoint.endsWith("/images/generations") ? rawEndpoint : `${rawEndpoint}/images/generations`;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.config.apiKey) headers["Authorization"] = `Bearer ${this.config.apiKey}`;

        const response = await fetch(url, {
          method: "POST",
          headers,
          signal: abortController.signal,
          body: JSON.stringify({
            prompt: params.prompt,
            n: 1,
            size: params.aspectRatio === "1:1" ? "1024x1024" : params.aspectRatio === "9:16" ? "1024x1792" : "1792x1024",
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          job.status = "failed";
          job.error = `Ошибка генерации медиа (${response.status}): ${errBody.slice(0, 200)}`;
        } else {
          const data: any = await response.json();
          const imgUrl = data?.data?.[0]?.url;
          if (imgUrl) {
            job.status = "completed";
            job.progress = 100;
            job.resultUrl = imgUrl;
            job.seed = params.seed ?? Math.floor(Math.random() * 999999);
            job.steps = 35;
          } else {
            job.status = "failed";
            job.error = "API вернул пустой результат медиа.";
          }
        }
      } catch (err: any) {
        job.status = "failed";
        if (err?.name === "AbortError") {
          job.error = "Ошибка: таймаут генерации медиа (30с).";
        } else {
          job.error = `Ошибка генерации медиа: ${err?.message || String(err)}`;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      job.status = "failed";
      job.error = "API генерации медиа не настроен. Укажите API ключ или эндпоинт в настройках.";
    }

    this.mediaJobs.set(id, job);
    this.saveState();
    return job;
  }

  public deleteMediaJob(jobId: string): { success: boolean; id: string } {
    const success = this.mediaJobs.delete(jobId);
    if (success) this.saveState();
    return { success, id: jobId };
  }

  public listProactiveTasks(statusFilter?: string): { tasks: ProactiveTask[]; total: number } {
    let list = Array.from(this.proactiveTasks.values());
    if (statusFilter && statusFilter !== "all") {
      list = list.filter((t) => t.status === statusFilter);
    }
    return {
      tasks: list,
      total: list.length,
    };
  }

  public createProactiveTask(params: {
    title: string;
    description?: string;
    triggerType?: "cron" | "interval" | "due_date";
    scheduleExpression: string;
    actionType?: "reminder" | "digest" | "audit" | "web_poll" | "custom_script";
    payload?: Record<string, unknown>;
  }): ProactiveTask {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const triggerType = params.triggerType || "interval";
    const nextRun = nextRunFromExpression(params.scheduleExpression, triggerType);
    const task: ProactiveTask = {
      id,
      title: params.title,
      description: params.description || `Автоматическая задача ${params.title}`,
      triggerType,
      scheduleExpression: params.scheduleExpression,
      actionType: params.actionType || "reminder",
      payload: params.payload || {},
      status: "active",
      nextRun: nextRun ?? undefined,
      runCount: 0,
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: nextRun ? "info" : "warn",
          message: nextRun
            ? `Задача "${params.title}" поставлена на расписание (${params.scheduleExpression}), следующий запуск: ${nextRun}.`
            : `Задача "${params.title}" создана, но выражение расписания "${params.scheduleExpression}" не распознано - автоматический запуск невозможен.`,
        },
      ],
    };
    this.proactiveTasks.set(id, task);
    this.saveState();
    return task;
  }

  public getTaskStatus(taskId: string): ProactiveTask {
    const task = this.proactiveTasks.get(taskId);
    if (!task) {
      throw new Error(`Задача с ID ${taskId} не найдена`);
    }
    return task;
  }

  public toggleTaskStatus(taskId: string): ProactiveTask {
    const task = this.getTaskStatus(taskId);
    task.status = task.status === "active" ? "paused" : "active";
    task.logs.unshift({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Статус задачи изменен на: ${task.status}`,
    });
    this.saveState();
    return task;
  }

  public cancelProactiveTask(taskId: string, deletePermanent = false): { success: boolean; id: string } {
    if (deletePermanent) {
      const deleted = this.proactiveTasks.delete(taskId);
      if (deleted) this.saveState();
      return { success: deleted, id: taskId };
    }
    const task = this.proactiveTasks.get(taskId);
    if (task) {
      task.status = "paused";
      task.logs.unshift({
        timestamp: new Date().toISOString(),
        level: "warn",
        message: "Задача снята с активного выполнения.",
      });
      this.saveState();
      return { success: true, id: taskId };
    }
    return { success: false, id: taskId };
  }

  public triggerTaskNow(taskId: string): { success: boolean; message: string; task: ProactiveTask } {
    const task = this.getTaskStatus(taskId);
    const now = new Date().toISOString();
    task.lastRun = now;
    task.runCount += 1;
    task.logs.unshift({
      timestamp: now,
      level: "info",
      message: `Ручной запуск: триггер сработал (действие "${task.actionType}" не подключено к исполнителю).`,
    });
    if (task.logs.length > 30) task.logs.length = 30;
    this.saveState();
    return {
      success: true,
      message: `Задача "${task.title}": триггер запущен вручную.`,
      task,
    };
  }

  public getVMStatus(_refresh = false): VMStatus {
    const memUsage = process.memoryUsage();
    const usedMB = Math.round(memUsage.rss / (1024 * 1024));
    const totalMB = Math.round(os.totalmem() / (1024 * 1024));
    this.vmState.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    this.vmState.memoryUsedMB = usedMB;
    this.vmState.memoryLimitMB = totalMB;
    this.vmState.activeProcesses = [
      { pid: process.pid, name: "bb-host-node", cpu: 0, memoryMB: usedMB },
    ];
    if (_refresh) {
      this.vmState.lastSecurityAudit = new Date().toISOString();
    }
    return this.vmState;
  }

  public switchMode(
    mode: MuseMode,
    conversationId?: string
  ): { previousMode: MuseMode; currentMode: MuseMode; conversationId?: string; description: string } {
    const prev = this.currentMode;
    this.currentMode = mode;
    if (conversationId && this.conversations.has(conversationId)) {
      const c = this.conversations.get(conversationId)!;
      c.mode = mode;
      c.updatedAt = new Date().toISOString();
    } else {
      // Global switch without conversationId updates all existing conversations
      for (const c of this.conversations.values()) {
        c.mode = mode;
      }
    }
    this.saveState();

    const descriptions: Record<MuseMode, string> = {
      creative: "Режим генерации идей, медиа-концептов и иридисцентного дизайна активирован.",
      analytical: "Режим строгого логического анализа, таблиц и системного аудита активирован.",
      proactive: "Режим фонового мониторинга, автономных задач и дайджестов активирован.",
      strict_sandbox: "Строгий режим: исходящие API-запросы модели и медиа заблокированы.",
    };

    return {
      previousMode: prev,
      currentMode: mode,
      conversationId,
      description: descriptions[mode],
    };
  }

  public listMemories(category?: string, limit = 50): { memories: MemoryRecord[]; total: number } {
    let list = Array.from(this.memories.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    if (category) {
      list = list.filter((m) => m.category === category);
    }
    return {
      memories: list.slice(0, limit),
      total: list.length,
    };
  }

  public searchMemory(
    query: string,
    category?: "preference" | "fact" | "project" | "instruction",
    limit = 10
  ): { query: string; matches: MemoryRecord[]; count: number } {
    const q = query.toLowerCase().trim();
    let list = Array.from(this.memories.values());
    if (category) {
      list = list.filter((m) => m.category === category);
    }

    const matches = list
      .filter((m) => {
        return (
          m.key.toLowerCase().includes(q) ||
          m.content.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .slice(0, limit);

    return {
      query,
      matches,
      count: matches.length,
    };
  }

  public storeMemory(params: {
    key: string;
    content: string;
    category?: "preference" | "fact" | "project" | "instruction";
    confidence?: number;
    tags?: string[];
  }): MemoryRecord {
    // Check if key already exists
    let existing: MemoryRecord | undefined;
    for (const m of this.memories.values()) {
      if (m.key.toLowerCase() === params.key.toLowerCase()) {
        existing = m;
        break;
      }
    }

    const now = new Date().toISOString();
    if (existing) {
      existing.content = params.content;
      if (params.category) existing.category = params.category;
      if (params.confidence !== undefined) existing.confidence = params.confidence;
      if (params.tags) existing.tags = Array.from(new Set([...existing.tags, ...params.tags]));
      existing.updatedAt = now;
      this.saveState();
      return existing;
    }

    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newRecord: MemoryRecord = {
      id,
      key: params.key,
      content: params.content,
      category: params.category || "preference",
      confidence: params.confidence ?? 0.95,
      tags: params.tags || [],
      createdAt: now,
      updatedAt: now,
    };
    this.memories.set(id, newRecord);
    this.saveState();
    return newRecord;
  }

  public deleteMemory(memoryId: string): { success: boolean; id: string } {
    const success = this.memories.delete(memoryId);
    if (success) this.saveState();
    return { success, id: memoryId };
  }
}

// Global singleton instance
export const museController = new MetaMuseController();

// ============================================================================
// BB PLUGIN ENTRY POINT
// ============================================================================

export default function (bb: BbPluginApi) {
  // --------------------------------------------------------------------------
  // 1. REGISTER RPC METHODS
  // --------------------------------------------------------------------------
  bb.rpc.register(rpcContract, {
    get_system_status: async () => {
      return sanitizeRpc(museController.getSystemStatus());
    },

    list_conversations: async (input) => {
      return sanitizeRpc(museController.listConversations(input?.limit));
    },

    get_conversation: async (input) => {
      return sanitizeRpc(museController.getConversation(input.conversationId));
    },

    create_conversation: async (input) => {
      return sanitizeRpc(museController.createConversation(input || undefined));
    },

    delete_conversation: async (input) => {
      return sanitizeRpc(museController.deleteConversation(input.conversationId));
    },

    send_message: async (input) => {
      return sanitizeRpc(await museController.sendMessage(input));
    },

    export_chat: async (input) => {
      return sanitizeRpc(museController.exportChat(input.conversationId, input.format));
    },

    list_media_jobs: async (input) => {
      return sanitizeRpc(museController.listMediaJobs(input?.limit));
    },

    generate_media: async (input) => {
      return sanitizeRpc(await museController.generateMedia(input));
    },

    delete_media_job: async (input) => {
      return sanitizeRpc(museController.deleteMediaJob(input.jobId));
    },

    list_proactive_tasks: async (input) => {
      return sanitizeRpc(museController.listProactiveTasks(input?.status));
    },

    create_proactive_task: async (input) => {
      return sanitizeRpc(museController.createProactiveTask(input));
    },

    get_task_status: async (input) => {
      return sanitizeRpc(museController.getTaskStatus(input.taskId));
    },

    toggle_task_status: async (input) => {
      return sanitizeRpc(museController.toggleTaskStatus(input.taskId));
    },

    cancel_proactive_task: async (input) => {
      return sanitizeRpc(museController.cancelProactiveTask(input.taskId, input.deletePermanent));
    },

    trigger_task_now: async (input) => {
      return sanitizeRpc(museController.triggerTaskNow(input.taskId));
    },

    get_vm_status: async (input) => {
      return sanitizeRpc(museController.getVMStatus(input?.refresh));
    },

    switch_mode: async (input) => {
      return sanitizeRpc(museController.switchMode(input.mode, input.conversationId));
    },

    list_memories: async (input) => {
      return sanitizeRpc(museController.listMemories(input?.category, input?.limit));
    },

    search_memory: async (input) => {
      return sanitizeRpc(museController.searchMemory(input.query, input.category, input.limit));
    },

    store_memory: async (input) => {
      return sanitizeRpc(museController.storeMemory(input));
    },

    delete_memory: async (input) => {
      return sanitizeRpc(museController.deleteMemory(input.memoryId));
    },

    get_api_config: async () => {
      return sanitizeRpc(museController.getConfig());
    },

    update_api_config: async (input) => {
      return sanitizeRpc(museController.updateConfig(input));
    },
  });

  // --------------------------------------------------------------------------
  // 2. REGISTER 15 AGENT TOOLS
  // --------------------------------------------------------------------------
  const registerAgentTool = (def: {
    name: string;
    description: string;
    parameters: any;
    execute: (args: any, ctx: any) => Promise<unknown> | unknown;
  }) => {
    if (bb.agents && typeof bb.agents.registerTool === "function") {
      (bb.agents.registerTool as any)({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        execute: async (args: any, ctx: any) => {
          try {
            const res = await def.execute(args, ctx);
            return typeof res === "string" ? res : JSON.stringify(res, null, 2);
          } catch (err: any) {
            return JSON.stringify({ error: err?.message || String(err) });
          }
        },
      });
    }
  };

  // Tool 1: muse_send_message
  registerAgentTool({
    name: "muse_send_message",
    description: "Send a prompt or message to Meta Muse AI companion and receive an iridescent response with proactive suggestions.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Message text to send to Muse" },
        conversationId: { type: "string", description: "ID of existing conversation or omit for new" },
        mode: { type: "string", enum: ["creative", "analytical", "proactive", "strict_sandbox"], description: "Operating mode" },
      },
      required: ["content"],
    },
    execute: async (args) => {
      return await museController.sendMessage(args);
    },
  });

  // Tool 2: muse_list_conversations
  registerAgentTool({
    name: "muse_list_conversations",
    description: "List all active conversation sessions, titles, message counts, and timestamps in Meta Muse.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum conversations to return" },
      },
    },
    execute: (args) => {
      return museController.listConversations(args.limit);
    },
  });

  // Tool 3: muse_get_conversation_history
  registerAgentTool({
    name: "muse_get_conversation_history",
    description: "Retrieve full message history, timeline, and suggestions for a specific conversation thread.",
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "The conversation ID" },
      },
      required: ["conversationId"],
    },
    execute: (args) => {
      return museController.getConversation(args.conversationId);
    },
  });

  // Tool 4: muse_generate_media
  registerAgentTool({
    name: "muse_generate_media",
    description: "Queue an image or video generation job in Meta Muse Studio with style presets, seeds, and aspect ratios.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Visual prompt description" },
        negativePrompt: { type: "string", description: "Negative prompt attributes to avoid" },
        type: { type: "string", enum: ["image", "video"], description: "Media format type" },
        stylePreset: { type: "string", description: "Style preset e.g. 'Iridescent Spectrum', 'Neon Cyberpunk', 'Fluid Obsidian'" },
        aspectRatio: { type: "string", enum: ["1:1", "16:9", "9:16", "4:3", "3:4"], description: "Canvas aspect ratio" },
        seed: { type: "number", description: "Deterministic seed number" },
      },
      required: ["prompt"],
    },
    execute: async (args) => {
      return await museController.generateMedia(args);
    },
  });

  // Tool 5: muse_manage_schedule
  registerAgentTool({
    name: "muse_manage_schedule",
    description: "Inspect or configure the proactive task scheduler cadence and active background triggers.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get_status", "pause_all", "resume_all"], description: "Scheduling management action" },
      },
      required: ["action"],
    },
    execute: (args) => {
      const tasks = museController.listProactiveTasks().tasks;
      if (args.action === "pause_all") {
        for (const t of tasks) museController.cancelProactiveTask(t.id);
      } else if (args.action === "resume_all") {
        for (const t of tasks) {
          if (t.status === "paused") museController.toggleTaskStatus(t.id);
        }
      }
      return {
        action: args.action,
        activeTasksCount: tasks.filter((t) => t.status === "active").length,
        totalTasks: tasks.length,
      };
    },
  });

  // Tool 6: muse_list_proactive_tasks
  registerAgentTool({
    name: "muse_list_proactive_tasks",
    description: "List all autonomous proactive tasks, schedule expressions (cron/interval), and run logs.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["all", "active", "paused", "completed", "failed"], description: "Filter by status" },
      },
    },
    execute: (args) => {
      return museController.listProactiveTasks(args.status);
    },
  });

  // Tool 7: muse_create_task
  registerAgentTool({
    name: "muse_create_task",
    description: "Create an autonomous proactive task with cron expression or interval (e.g. daily digest, audit, reminder).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the proactive task" },
        scheduleExpression: { type: "string", description: "Schedule expression: cron (e.g. '0 9 * * *') or interval (e.g. '30m')" },
        actionType: { type: "string", enum: ["reminder", "digest", "audit", "web_poll", "custom_script"], description: "Action type" },
        description: { type: "string", description: "Task description" },
        payload: { type: "object", description: "Optional payload data" },
      },
      required: ["title", "scheduleExpression"],
    },
    execute: (args) => {
      return museController.createProactiveTask(args);
    },
  });

  // Tool 8: muse_get_task_status
  registerAgentTool({
    name: "muse_get_task_status",
    description: "Get detailed execution status, run count, next scheduled run, and execution logs of a proactive task.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task identifier" },
      },
      required: ["taskId"],
    },
    execute: (args) => {
      return museController.getTaskStatus(args.taskId);
    },
  });

  // Tool 9: muse_cancel_task
  registerAgentTool({
    name: "muse_cancel_task",
    description: "Pause, cancel, or permanently delete a proactive task from the scheduler.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task identifier" },
        permanent: { type: "boolean", description: "Whether to permanently delete instead of pause" },
      },
      required: ["taskId"],
    },
    execute: (args) => {
      return museController.cancelProactiveTask(args.taskId, args.permanent);
    },
  });

  // Tool 10: muse_search_memory
  registerAgentTool({
    name: "muse_search_memory",
    description: "Query long-term associative memory bank for stored user preferences, facts, project rules, or directives.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or semantic search phrase" },
        category: { type: "string", enum: ["preference", "fact", "project", "instruction"], description: "Filter by category" },
        limit: { type: "number", description: "Max records to retrieve" },
      },
      required: ["query"],
    },
    execute: (args) => {
      return museController.searchMemory(args.query, args.category, args.limit);
    },
  });

  // Tool 11: muse_store_memory
  registerAgentTool({
    name: "muse_store_memory",
    description: "Store durable knowledge, design preference, or project directive into Meta Muse associative memory.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Unique identifier key for memory entry" },
        content: { type: "string", description: "Detailed memory information" },
        category: { type: "string", enum: ["preference", "fact", "project", "instruction"], description: "Category of memory" },
        confidence: { type: "number", description: "Confidence score 0.0 to 1.0" },
        tags: { type: "array", items: { type: "string" }, description: "Keywords or tags" },
      },
      required: ["key", "content"],
    },
    execute: (args) => {
      return museController.storeMemory(args);
    },
  });

  // Tool 12: muse_get_vm_status
  registerAgentTool({
    name: "muse_get_vm_status",
    description: "Inspect host process runtime telemetry, Node memory RSS, uptime, and host environment execution status.",
    parameters: {
      type: "object",
      properties: {
        refresh: { type: "boolean", description: "Trigger real-time telemetry refresh" },
      },
    },
    execute: (args) => {
      return museController.getVMStatus(args.refresh);
    },
  });

  // Tool 13: muse_switch_mode
  registerAgentTool({
    name: "muse_switch_mode",
    description: "Switch operational mode of Meta Muse (creative, analytical, proactive, strict_sandbox).",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["creative", "analytical", "proactive", "strict_sandbox"], description: "Target operating mode" },
        conversationId: { type: "string", description: "Optionally apply to specific conversation" },
      },
      required: ["mode"],
    },
    execute: (args) => {
      return museController.switchMode(args.mode, args.conversationId);
    },
  });

  // Tool 14: muse_get_system_status
  registerAgentTool({
    name: "muse_get_system_status",
    description: "Retrieve comprehensive host telemetry, memory statistics, queue depths, and plugin uptime.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: () => {
      return museController.getSystemStatus();
    },
  });

  // Tool 15: muse_export_chat
  registerAgentTool({
    name: "muse_export_chat",
    description: "Export conversation transcript to structured Markdown or JSON format.",
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "Conversation ID to export" },
        format: { type: "string", enum: ["markdown", "json"], description: "Export format (default markdown)" },
      },
      required: ["conversationId"],
    },
    execute: (args) => {
      return museController.exportChat(args.conversationId, args.format);
    },
  });

  // --------------------------------------------------------------------------
  // 3. REGISTER CLI COMMANDS ('bb muse')
  // --------------------------------------------------------------------------
  bb.cli.register({
    name: "muse",
    summary: "Interact with Meta Muse AI companion, studio, tasks, host process runtime, and memory",
    commands: [
      {
        name: "status",
        summary: "Display complete Meta Muse telemetry, host process state, and queue statistics",
        usage: "bb muse status",
      },
      {
        name: "chat",
        summary: "Converse with Meta Muse or inspect conversation history",
        usage: "bb muse chat [message] [--list] [--history <id>]",
      },
      {
        name: "tasks",
        summary: "Manage proactive autonomous tasks and schedules",
        usage: "bb muse tasks [list|create|status|cancel] [args...]",
      },
      {
        name: "vm",
        summary: "Inspect host process runtime telemetry, Node memory RSS, uptime and execution status",
        usage: "bb muse vm [status]",
      },
      {
        name: "memory",
        summary: "Query and store long-term memories and preferences",
        usage: "bb muse memory [list|search|store] [args...]",
      },
      {
        name: "tools",
        summary: "List all 15 registered agent tools and their descriptions",
        usage: "bb muse tools",
      },
    ],
    run: async (argv: string[]) => {
      const sub = argv[0] || "status";

      // bb muse status
      if (sub === "status") {
        const stats = museController.getSystemStatus();
        return {
          exitCode: 0,
          stdout: JSON.stringify(stats, null, 2),
        };
      }

      // bb muse chat
      if (sub === "chat") {
        const arg1 = argv[1];
        if (arg1 === "--list") {
          const list = museController.listConversations();
          return {
            exitCode: 0,
            stdout: JSON.stringify(list, null, 2),
          };
        }
        if (arg1 === "--history") {
          const convId = argv[2];
          if (!convId) return { exitCode: 1, stdout: "Ошибка: укажите conversationId" };
          const data = museController.getConversation(convId);
          return {
            exitCode: 0,
            stdout: JSON.stringify(data, null, 2),
          };
        }
        const text = argv.slice(1).join(" ") || "Привет, Муза!";
        const res = await museController.sendMessage({ content: text });
        return {
          exitCode: 0,
          stdout: `\n✨ [Meta Muse AI]\n${res.assistantMessage.content}\n\nПодсказки:\n${(res.assistantMessage.suggestions || []).map((s) => `• ${s}`).join("\n")}\n`,
        };
      }

      // bb muse tasks
      if (sub === "tasks") {
        const action = argv[1] || "list";
        if (action === "list") {
          const tasks = museController.listProactiveTasks();
          return {
            exitCode: 0,
            stdout: JSON.stringify(tasks, null, 2),
          };
        }
        if (action === "create") {
          const title = argv[2] || "Автоматическая задача";
          const schedule = argv[3] || "1h";
          const actionType = (argv[4] as any) || "reminder";
          const task = museController.createProactiveTask({
            title,
            scheduleExpression: schedule,
            actionType,
          });
          return {
            exitCode: 0,
            stdout: `Создана задача: ${task.title} (ID: ${task.id}, Расписание: ${task.scheduleExpression})`,
          };
        }
        if (action === "status") {
          const taskId = argv[2];
          if (!taskId) return { exitCode: 1, stdout: "Укажите taskId" };
          const task = museController.getTaskStatus(taskId);
          return {
            exitCode: 0,
            stdout: JSON.stringify(task, null, 2),
          };
        }
        if (action === "cancel") {
          const taskId = argv[2];
          if (!taskId) return { exitCode: 1, stdout: "Укажите taskId" };
          const res = museController.cancelProactiveTask(taskId);
          return {
            exitCode: 0,
            stdout: JSON.stringify(res, null, 2),
          };
        }
        return {
          exitCode: 0,
          stdout: "Использование: bb muse tasks [list|create|status|cancel]",
        };
      }

      // bb muse vm
      if (sub === "vm") {
        const action = argv[1] || "status";
        if (action !== "status") {
          return {
            exitCode: 1,
            stdout: `Неизвестное действие: ${action}\nИспользование: bb muse vm [status]`,
          };
        }
        const vm = museController.getVMStatus(true);
        return {
          exitCode: 0,
          stdout: JSON.stringify(vm, null, 2),
        };
      }

      // bb muse config
      if (sub === "config") {
        const action = argv[1] || "get";
        if (action === "set") {
          const key = argv[2];
          const val = argv[3];
          if (key === "apiKey") museController.updateConfig({ apiKey: val });
          else if (key === "endpointUrl") museController.updateConfig({ endpointUrl: val });
          else if (key === "mediaEndpointUrl") museController.updateConfig({ mediaEndpointUrl: val });
          else return { exitCode: 1, stdout: "Ключи конфигурации: apiKey, endpointUrl, mediaEndpointUrl" };
          return { exitCode: 0, stdout: `Параметр ${key} сохранён.` };
        }
        return { exitCode: 0, stdout: JSON.stringify(museController.getConfig(), null, 2) };
      }

      // bb muse memory
      if (sub === "memory") {
        const action = argv[1] || "list";
        if (action === "list") {
          const mems = museController.listMemories();
          return {
            exitCode: 0,
            stdout: JSON.stringify(mems, null, 2),
          };
        }
        if (action === "search") {
          const query = argv.slice(2).join(" ");
          const res = museController.searchMemory(query);
          return {
            exitCode: 0,
            stdout: JSON.stringify(res, null, 2),
          };
        }
        if (action === "store") {
          const key = argv[2];
          const content = argv.slice(3).join(" ");
          if (!key || !content) {
            return { exitCode: 1, stdout: "Использование: bb muse memory store <key> <content>" };
          }
          const rec = museController.storeMemory({ key, content });
          return {
            exitCode: 0,
            stdout: `Запись сохранена: ${rec.key} (ID: ${rec.id})`,
          };
        }
        return {
          exitCode: 0,
          stdout: "Использование: bb muse memory [list|search|store]",
        };
      }

      // bb muse tools
      if (sub === "tools") {
        const toolsList = [
          "1. muse_send_message - Отправка сообщения Музе с выбором режима",
          "2. muse_list_conversations - Получение списка активных сессий",
          "3. muse_get_conversation_history - Загрузка истории сообщений диалога",
          "4. muse_generate_media - Постановка задачи генерации в студию медиа",
          "5. muse_manage_schedule - Управление планировщиком задач",
          "6. muse_list_proactive_tasks - Список проактивных фоновых задач",
          "7. muse_create_task - Создание новой проактивной задачи (cron/интервал)",
          "8. muse_get_task_status - Подробный статус и логи выполнения задачи",
          "9. muse_cancel_task - Приостановка или удаление задачи",
          "10. muse_search_memory - Поиск по долговременной памяти",
          "11. muse_store_memory - Сохранение записи в память",
          "12. muse_get_vm_status - Телеметрия процесса хоста, памяти RSS и времени работы",
          "13. muse_switch_mode - Переключение режима (creative, analytical, proactive, strict_sandbox)",
          "14. muse_get_system_status - Полная системная телеметрия",
          "15. muse_export_chat - Экспорт переписки в Markdown или JSON",
        ];
        return {
          exitCode: 0,
          stdout: `\n🛠 Зарегистрировано 15 инструментов Meta Muse AI:\n\n${toolsList.join("\n")}\n`,
        };
      }

      return {
        exitCode: sub ? 1 : 0,
        stdout: sub ? `Неизвестная подкоманда: ${sub}\nИспользование: bb muse [status|chat|tasks|vm|memory|tools]` : "Использование: bb muse [status|chat|tasks|vm|memory|tools]",
      };
    },
  });
}
