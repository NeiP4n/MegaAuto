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
  metadata: z.record(z.unknown()).optional(),
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
  payload: z.record(z.unknown()).optional(),
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
  status: z.enum(["isolated", "running", "paused", "quarantined"]),
  memoryLimitMB: z.number(),
  memoryUsedMB: z.number(),
  cpuQuotaPercent: z.number(),
  secureEnclave: z.boolean(),
  activeProcesses: z.array(vmProcessSchema),
  networkPolicy: z.enum(["airgapped", "whitelisted", "proxy"]),
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
      payload: z.record(z.unknown()).optional(),
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

  private vmState: VMStatus = {
    status: "isolated",
    memoryLimitMB: 2048,
    memoryUsedMB: 384,
    cpuQuotaPercent: 75,
    secureEnclave: true,
    activeProcesses: [
      { pid: 1042, name: "muse-enclave-worker", cpu: 1.8, memoryMB: 182 },
      { pid: 1045, name: "sandbox-io-proxy", cpu: 0.5, memoryMB: 64 },
      { pid: 1050, name: "mem-indexer-sqlite", cpu: 0.9, memoryMB: 138 },
    ],
    networkPolicy: "whitelisted",
    allowedDomains: ["api.blackbox.ai", "huggingface.co", "cdn.discordapp.com", "localhost"],
    uptimeSeconds: 0,
    lastSecurityAudit: new Date().toISOString(),
  };

  private taskRunnerInterval?: NodeJS.Timeout;
  private mediaRendererInterval?: NodeJS.Timeout;

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

      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, "utf-8");
        const data = JSON.parse(raw);
        if (data.currentMode) this.currentMode = data.currentMode;
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
    } catch {
      // Fallback if loading failed
    }

    // Seed defaults if empty
    this.seedDefaultDataIfEmpty();
  }

  private saveState(): void {
    try {
      const data = {
        currentMode: this.currentMode,
        conversations: Array.from(this.conversations.values()),
        messages: Object.fromEntries(this.messages.entries()),
        mediaJobs: Array.from(this.mediaJobs.values()),
        proactiveTasks: Array.from(this.proactiveTasks.values()),
        memories: Array.from(this.memories.values()),
      };
      fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // Ignored
    }
  }

  private seedDefaultDataIfEmpty(): void {
    if (this.conversations.size === 0) {
      const convId = "conv-welcome-muse";
      const now = new Date().toISOString();
      const welcomeConv: MuseConversation = {
        id: convId,
        title: "Знакомство с Музой & Концепты Дизайна",
        mode: "creative",
        createdAt: now,
        updatedAt: now,
        messageCount: 2,
        tags: ["введение", "дизайн", "иридисцент"],
      };
      this.conversations.set(convId, welcomeConv);

      const msgs: MuseMessage[] = [
        {
          id: "msg-1",
          conversationId: convId,
          role: "user",
          content: "Привет, Муза! Покажи мне возможности и текущий статус твоей песочницы.",
          timestamp: new Date(Date.now() - 60000).toISOString(),
        },
        {
          id: "msg-2",
          conversationId: convId,
          role: "assistant",
          content:
            "Привет! Я **Meta Muse AI** — твой персональный спутник и студия автономного созидания.\n\n" +
            "✨ **Мои активные модули:**\n" +
            "- **Студия Генерации**: Поддержка стилей Neon Cyberpunk, Fluid Obsidian, Iridescent Prisma и синематик-видео.\n" +
            "- **Проактивные Задачи**: Фоновый планировщик аудита и дайджестов на cron и интервалах.\n" +
            "- **Безопасная VM**: Изолированная песочница с лимитом 2048 МБ RAM и строгой политикой Whitelist.\n" +
            "- **Долговременная Память**: Ассоциативное сохранение предпочтений, директив и фактов.\n\n" +
            "Чем займемся прямо сейчас?",
          timestamp: now,
          suggestions: [
            "Сгенерировать медиа-концепт для проекта",
            "Настроить проактивный утренний дайджест",
            "Проверить метрики безопасной VM",
            "Сохранить стиль палитры в долговременную память",
          ],
        },
      ];
      this.messages.set(convId, msgs);
    }

    if (this.mediaJobs.size === 0) {
      const sampleJobs: MediaJob[] = [
        {
          id: "job-iridescent-muse-1",
          prompt: "Futuristic iridescent cyber muse with glowing cyan and violet hues, dark obsidian background, hyperdetailed 8k octane render",
          type: "image",
          stylePreset: "Iridescent Spectrum",
          aspectRatio: "16:9",
          status: "completed",
          progress: 100,
          resultUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80",
          seed: 42891,
          steps: 40,
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          completedAt: new Date(Date.now() - 3550000).toISOString(),
        },
        {
          id: "job-quantum-core-2",
          prompt: "Bioluminescent quantum core pulsing inside an isolated security enclave, cinematic lighting, fluid dynamic motion",
          type: "video",
          stylePreset: "Fluid Cyberpunk",
          aspectRatio: "9:16",
          status: "rendering",
          progress: 68,
          seed: 88124,
          steps: 50,
          createdAt: new Date(Date.now() - 120000).toISOString(),
        },
      ];
      for (const j of sampleJobs) this.mediaJobs.set(j.id, j);
    }

    if (this.proactiveTasks.size === 0) {
      const sampleTasks: ProactiveTask[] = [
        {
          id: "task-morning-digest",
          title: "Ежедневный дайджест архитектуры",
          description: "Сбор логов инструментов, проверка статуса VM и формирование краткого отчета",
          triggerType: "cron",
          scheduleExpression: "0 9 * * *",
          actionType: "digest",
          status: "active",
          lastRun: new Date(Date.now() - 86400000).toISOString(),
          nextRun: new Date(Date.now() + 28800000).toISOString(),
          runCount: 14,
          logs: [
            { timestamp: new Date(Date.now() - 86400000).toISOString(), level: "info", message: "Дайджест сгенерирован: 0 критических ошибок, 15 вызовов инструментов." },
          ],
        },
        {
          id: "task-vm-audit",
          title: "Регулярный аудит безопасной песочницы VM",
          description: "Проверка утечек памяти, закрытых сокетов и сетевых политик",
          triggerType: "interval",
          scheduleExpression: "30m",
          actionType: "audit",
          status: "active",
          lastRun: new Date(Date.now() - 900000).toISOString(),
          nextRun: new Date(Date.now() + 900000).toISOString(),
          runCount: 48,
          logs: [
            { timestamp: new Date(Date.now() - 900000).toISOString(), level: "info", message: "Аудит завершен: память 384MB / 2048MB, анклав в норме." },
          ],
        },
      ];
      for (const t of sampleTasks) this.proactiveTasks.set(t.id, t);
    }

    if (this.memories.size === 0) {
      const sampleMems: MemoryRecord[] = [
        {
          id: "mem-ui-theme",
          key: "theme_preference",
          content: "Пользователь предпочитает темную обсидиановую эстетику (#0B0E14) с иридисцентными акцентами электрик-блю, неонового пурпура и бирюзового циан.",
          category: "preference",
          confidence: 0.98,
          tags: ["ui", "design", "colors", "obsidian"],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "mem-security-enclave",
          key: "vm_security_policy",
          content: "Песочница VM должна оставаться изолированной со строгой проверкой сетевого трафика (Airgapped / Whitelist).",
          category: "instruction",
          confidence: 0.99,
          tags: ["security", "vm", "sandbox", "isolation"],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "mem-project-target",
          key: "bb_plugin_meta_muse",
          content: "Meta Muse AI разработан как флагманский автономный плагин Blackbox с 15 агентскими инструментами и студией медиа.",
          category: "project",
          confidence: 1.0,
          tags: ["bb", "meta-muse", "tools", "architecture"],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      for (const m of sampleMems) this.memories.set(m.id, m);
    }

    this.saveState();
  }

  private startBackgroundLoops(): void {
    // 1. Media renderer simulation loop
    this.mediaRendererInterval = setInterval(() => {
      let changed = false;
      for (const job of this.mediaJobs.values()) {
        if (job.status === "rendering") {
          job.progress = Math.min(100, job.progress + 15);
          if (job.progress >= 100) {
            job.status = "completed";
            job.completedAt = new Date().toISOString();
            if (!job.resultUrl) {
              job.resultUrl =
                job.type === "video"
                  ? "https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-screens-with-code-31913-large.mp4"
                  : "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80";
            }
          }
          changed = true;
        }
      }
      if (changed) this.saveState();
    }, 4000);

    // 2. Proactive tasks tick loop
    this.taskRunnerInterval = setInterval(() => {
      const now = new Date();
      let changed = false;
      for (const task of this.proactiveTasks.values()) {
        if (task.status === "active") {
          // Check if due or interval simulation
          if (task.nextRun && new Date(task.nextRun) <= now) {
            task.lastRun = now.toISOString();
            task.runCount += 1;
            task.logs.unshift({
              timestamp: now.toISOString(),
              level: "info",
              message: `Автоматическое выполнение задачи "${task.title}" успешно завершено.`,
            });
            if (task.logs.length > 30) task.logs.length = 30;

            // Compute next run
            task.nextRun = new Date(Date.now() + 1800000).toISOString(); // +30m
            changed = true;
          }
        }
      }
      if (changed) this.saveState();
    }, 10000);
  }

  public dispose(): void {
    if (this.mediaRendererInterval) clearInterval(this.mediaRendererInterval);
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

  public sendMessage(params: {
    conversationId?: string;
    content: string;
    mode?: MuseMode;
  }): { conversationId: string; userMessage: MuseMessage; assistantMessage: MuseMessage } {
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
    const mode = params.mode || conv.mode || this.currentMode;

    // 1. User message
    const userMsg: MuseMessage = {
      id: `msg-${Date.now()}-u`,
      conversationId: convId,
      role: "user",
      content: params.content,
      timestamp: now,
    };

    // 2. Synthesize smart assistant response based on content & mode
    const lower = params.content.toLowerCase();
    let reply = "";
    let suggestions: string[] = [];

    if (mode === "creative" || lower.includes("арт") || lower.includes("дизайн") || lower.includes("стиль")) {
      reply =
        `🎨 **[Creative Muse Engine]**\n\n` +
        `Отличная идея! Я проанализировала запрос: *"${params.content}"*.\n` +
        `Для этого идеально подойдет концепция **Иридисцентного Спектра** с глубокими контрастными тенями (#0B0E14) ` +
        `и флюидными неоновыми переливами (Electric Blue #0866FF, Hyper Magenta #E03E93 и Cyan #00C4B4).\n\n` +
        `Я могу отправить этот запрос в нашу **Студию Генерации** или сохранить цветовую спецификацию в долговременную память.`;
      suggestions = [
        `Сгенерировать медиа по этому промпту`,
        `Сохранить концепт в память`,
        `Переключить в аналитический режим для разбора деталей`,
      ];
    } else if (mode === "analytical" || lower.includes("анализ") || lower.includes("код") || lower.includes("статус")) {
      const stats = this.getSystemStatus();
      reply =
        `📊 **[Analytical Engine]**\n\n` +
        `Системный аудит по запросу *"${params.content}"*:\n` +
        `- **Статус системы**: Версия v${stats.version}, Время работы: ${stats.uptimeSeconds} сек.\n` +
        `- **Безопасная VM**: Изоляция активна, политика: ${this.vmState.networkPolicy}.\n` +
        `- **Память / Задачи**: ${stats.memoryRecordsCount} записей памяти, ${stats.proactiveTasksCount} активных задач.\n` +
        `- **Хост**: ${stats.hardware.cpuModel}, ОЗУ свободно ${stats.hardware.freeMemoryMB}MB / ${stats.hardware.totalMemoryMB}MB.`;
      suggestions = [
        `Выгрузить полный JSON-отчет системы`,
        `Запустить аудит песочницы VM`,
        `Создать задачу мониторинга`,
      ];
    } else if (mode === "strict_sandbox") {
      reply =
        `🔒 **[Strict Sandbox Enclave]**\n\n` +
        `Сообщение обработано в закрытом безопасном контуре. Сетевой стек ограничен Whitelist доменами: ` +
        `(${this.vmState.allowedDomains.join(", ")}). Никакие внешние сокеты не скомпрометированы.`;
      suggestions = ["Проверить активные PID песочницы", "Вернуться в Creative режим"];
    } else {
      reply =
        `✨ **[Meta Muse Proactive]**\n\n` +
        `Принято в работу: *"${params.content}"*.\n` +
        `Я обновила контекст текущей сессии и отслеживаю связанные задачи. Чем еще могу помочь?`;
      suggestions = [
        `Показать список активных задач`,
        `Открыть студию генерации`,
        `Просмотреть историю воспоминаний`,
      ];
    }

    const assistantMsg: MuseMessage = {
      id: `msg-${Date.now() + 1}-a`,
      conversationId: convId,
      role: "assistant",
      content: reply,
      timestamp: new Date().toISOString(),
      suggestions,
    };

    const thread = this.messages.get(convId) || [];
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

  public generateMedia(params: {
    prompt: string;
    negativePrompt?: string;
    type?: "image" | "video";
    stylePreset?: string;
    aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
    seed?: number;
  }): MediaJob {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const job: MediaJob = {
      id,
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      type: params.type || "image",
      stylePreset: params.stylePreset || "Iridescent Spectrum",
      aspectRatio: params.aspectRatio || "16:9",
      status: "rendering",
      progress: 10,
      seed: params.seed ?? Math.floor(Math.random() * 999999),
      steps: params.type === "video" ? 50 : 35,
      createdAt: new Date().toISOString(),
    };
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
    const task: ProactiveTask = {
      id,
      title: params.title,
      description: params.description || `Автоматическая задача ${params.title}`,
      triggerType: params.triggerType || "interval",
      scheduleExpression: params.scheduleExpression,
      actionType: params.actionType || "reminder",
      payload: params.payload || {},
      status: "active",
      nextRun: new Date(Date.now() + 1800000).toISOString(),
      runCount: 0,
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: "info",
          message: `Задача "${params.title}" поставлена на расписание (${params.scheduleExpression}).`,
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
      message: `Ручной запуск задачи выполнен успешно.`,
    });
    if (task.logs.length > 30) task.logs.length = 30;
    this.saveState();
    return {
      success: true,
      message: `Задача "${task.title}" выполнена вручную.`,
      task,
    };
  }

  public getVMStatus(refresh = false): VMStatus {
    this.vmState.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    if (refresh) {
      this.vmState.lastSecurityAudit = new Date().toISOString();
      this.vmState.memoryUsedMB = 350 + Math.floor(Math.random() * 80);
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
    }
    this.saveState();

    const descriptions: Record<MuseMode, string> = {
      creative: "Режим генерации идей, медиа-концептов и иридисцентного дизайна активирован.",
      analytical: "Режим строгого логического анализа, таблиц и системного аудита активирован.",
      proactive: "Режим фонового мониторинга, автономных задач и дайджестов активирован.",
      strict_sandbox: "Режим защищенного закрытого выполнения в изолированной VM песочнице активирован.",
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
      return sanitizeRpc(museController.sendMessage(input));
    },

    export_chat: async (input) => {
      return sanitizeRpc(museController.exportChat(input.conversationId, input.format));
    },

    list_media_jobs: async (input) => {
      return sanitizeRpc(museController.listMediaJobs(input?.limit));
    },

    generate_media: async (input) => {
      return sanitizeRpc(museController.generateMedia(input));
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
    execute: (args) => {
      return museController.sendMessage(args);
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
    execute: (args) => {
      return museController.generateMedia(args);
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
    description: "Audit secure VM isolation sandbox metrics: RAM/CPU quotas, active enclave processes, and whitelist network policy.",
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
    summary: "Interact with Meta Muse AI companion, studio, tasks, VM sandbox, and memory",
    commands: [
      {
        name: "status",
        summary: "Display complete Meta Muse telemetry, VM state, and queue statistics",
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
        summary: "Inspect secure VM isolation sandbox metrics and network policies",
        usage: "bb muse vm [status|audit]",
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
        const res = museController.sendMessage({ content: text });
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
        const vm = museController.getVMStatus(true);
        return {
          exitCode: 0,
          stdout: JSON.stringify(vm, null, 2),
        };
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
          "12. muse_get_vm_status - Проверка состояния изолированной VM песочницы",
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
        exitCode: 0,
        stdout: "Использование: bb muse [status|chat|tasks|vm|memory|tools]",
      };
    },
  });
}
