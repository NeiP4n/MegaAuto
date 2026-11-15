import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentRadarStatus, AgentStep, RadarSettings } from "./src/types";

// ============================================================================
// TYPES & SCHEMAS
// ============================================================================

const agentStepSchema = z.object({
  stepIndex: z.number(),
  source: z.string(),
  type: z.string(),
  status: z.string(),
  createdAt: z.string(),
  durationMs: z.number().optional(),
  model: z.string().optional(),
  toolName: z.string().optional(),
  toolSummary: z.string().optional(),
  toolCommand: z.string().optional(),
  thinkingPreview: z.string().optional(),
  contentPreview: z.string().optional(),
});

const agentRadarStatusSchema = z.object({
  state: z.enum(["idle", "executing_tool", "thinking", "waiting_user", "background_task"]),
  canWrite: z.boolean(),
  statusLabel: z.string(),
  statusDescription: z.string(),
  currentTool: z.string().optional(),
  toolSummary: z.string().optional(),
  toolCommand: z.string().optional(),
  activeStepIndex: z.number().optional(),
  startedAt: z.string().optional(),
  elapsedSeconds: z.number(),
  conversationId: z.string(),
  model: z.string(),
  recentSteps: z.array(agentStepSchema),
  turnStepCount: z.number(),
  totalTokens: z
    .object({
      input: z.number().optional(),
      output: z.number().optional(),
      cacheRead: z.number().optional(),
    })
    .optional(),
});

const radarSettingsSchema = z.object({
  soundEnabled: z.boolean(),
  volume: z.number(),
  autoExpandOnBusy: z.boolean(),
  showOverlay: z.boolean(),
  position: z.enum(["top-right", "bottom-right", "top-center", "bottom-center"]),
});

export const rpcContract = defineRpcContract({
  get_radar_status: {
    input: z.object({
      conversationId: z.string().optional(),
    }).optional(),
    output: agentRadarStatusSchema,
  },
  get_radar_timeline: {
    input: z.object({
      conversationId: z.string().optional(),
      limit: z.number().optional(),
    }).optional(),
    output: z.object({
      ok: z.boolean(),
      conversationId: z.string(),
      steps: z.array(agentStepSchema),
    }),
  },
  get_radar_settings: {
    input: z.object({}).optional(),
    output: radarSettingsSchema,
  },
  update_radar_settings: {
    input: radarSettingsSchema.partial(),
    output: z.object({
      ok: z.boolean(),
      settings: radarSettingsSchema,
    }),
  },
});

// ============================================================================
// TRANSCRIPT PARSER & ENGINE
// ============================================================================

class RadarEngine {
  private brainBaseDir: string;
  private settings: RadarSettings = {
    soundEnabled: true,
    volume: 0.35,
    autoExpandOnBusy: true,
    showOverlay: true,
    position: "top-right",
  };

  constructor() {
    const userProfile = process.env.USERPROFILE || "C:\\Users\\Isako";
    this.brainBaseDir = path.join(userProfile, ".gemini", "antigravity-cli", "brain");
  }

  getSettings(): RadarSettings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<RadarSettings>): RadarSettings {
    this.settings = { ...this.settings, ...patch };
    return this.getSettings();
  }

  /**
   * Automatically locate the most recently active conversation directory.
   */
  findActiveConversationId(): string {
    try {
      if (!fs.existsSync(this.brainBaseDir)) {
        return "";
      }

      const entries = fs.readdirSync(this.brainBaseDir, { withFileTypes: true });
      let newestId = "";
      let newestMtime = 0;

      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const transcriptPath = path.join(this.brainBaseDir, ent.name, ".system_generated", "logs", "transcript.jsonl");
        if (fs.existsSync(transcriptPath)) {
          const stat = fs.statSync(transcriptPath);
          if (stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newestId = ent.name;
          }
        }
      }

      return newestId;
    } catch {
      return "";
    }
  }

  parseTranscript(conversationId?: string): {
    convId: string;
    rawLines: any[];
    mtime: number;
  } {
    const activeId = conversationId || this.findActiveConversationId();
    if (!activeId) {
      return { convId: "", rawLines: [], mtime: 0 };
    }

    const transcriptFile = path.join(this.brainBaseDir, activeId, ".system_generated", "logs", "transcript.jsonl");
    if (!fs.existsSync(transcriptFile)) {
      return { convId: activeId, rawLines: [], mtime: 0 };
    }

    try {
      const stat = fs.statSync(transcriptFile);
      const content = fs.readFileSync(transcriptFile, "utf-8");
      const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      // Read last 40 lines
      const recent = lines.slice(-40);
      const parsed: any[] = [];
      for (const raw of recent) {
        try {
          parsed.push(JSON.parse(raw));
        } catch {
          // ignore malformed line
        }
      }

      return { convId: activeId, rawLines: parsed, mtime: stat.mtimeMs };
    } catch {
      return { convId: activeId, rawLines: [], mtime: 0 };
    }
  }

  getStatus(conversationId?: string): z.infer<typeof agentRadarStatusSchema> {
    const { convId, rawLines, mtime } = this.parseTranscript(conversationId);

    if (rawLines.length === 0) {
      return {
        state: "idle",
        canWrite: true,
        statusLabel: "ИИ свободен — готов к работе",
        statusDescription: "Нет активных задач в текущем диалоге.",
        elapsedSeconds: 0,
        conversationId: convId || "none",
        model: "gemini-3.8-flash",
        recentSteps: [],
        turnStepCount: 0,
      };
    }

    const steps: z.infer<typeof agentStepSchema>[] = [];
    let lastTokens: { input?: number; output?: number; cacheRead?: number } | undefined = undefined;
    let modelName = "gemini-3.8-flash";

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line.model) modelName = line.model;
      if (line.input_tokens || line.output_tokens) {
        lastTokens = {
          input: line.input_tokens,
          output: line.output_tokens,
          cacheRead: line.cache_read_tokens,
        };
      }

      let toolName: string | undefined = undefined;
      let toolSummary: string | undefined = undefined;
      let toolCommand: string | undefined = undefined;

      if (Array.isArray(line.tool_calls) && line.tool_calls.length > 0) {
        const tc = line.tool_calls[0];
        toolName = tc.name;
        const args = tc.args || {};
        toolSummary = args.toolSummary || args.CommandLine || args.Path || args.query || args.Prompt || "";
        toolCommand = args.CommandLine;
      }

      let thinkingPreview: string | undefined = undefined;
      if (line.thinking && typeof line.thinking === "string") {
        thinkingPreview = line.thinking.slice(0, 160).trim();
      }

      let contentPreview: string | undefined = undefined;
      if (line.content && typeof line.content === "string") {
        contentPreview = line.content.slice(0, 140).trim();
      }

      steps.push({
        stepIndex: line.step_index ?? i,
        source: line.source ?? "MODEL",
        type: line.type ?? "UNKNOWN",
        status: line.status ?? "DONE",
        createdAt: line.created_at ?? new Date().toISOString(),
        model: line.model,
        toolName,
        toolSummary,
        toolCommand,
        thinkingPreview,
        contentPreview,
      });
    }

    const last = rawLines[rawLines.length - 1];
    const lastStep = steps[steps.length - 1];
    const now = Date.now();
    const lastTime = last.created_at ? new Date(last.created_at).getTime() : mtime;
    const elapsedSeconds = Math.max(0, Math.floor((now - lastTime) / 1000));
    const recentActivitySilenceSeconds = Math.floor((now - mtime) / 1000);

    let turnStepCount = 0;
    for (let j = rawLines.length - 1; j >= 0; j--) {
      turnStepCount++;
      if (rawLines[j].type === "USER_INPUT" || rawLines[j].source === "USER_EXPLICIT") {
        break;
      }
    }

    let state: "idle" | "executing_tool" | "thinking" | "waiting_user" | "background_task" = "idle";
    let canWrite = true;
    let statusLabel = "ИИ готов к диалогу (МОЖНО ПИСАТЬ)";
    let statusDescription = "Ассистент завершил шаг и ожидает вашего сообщения.";

    const hasTools = Array.isArray(last.tool_calls) && last.tool_calls.length > 0;

    if (last.type === "PLANNER_RESPONSE" && hasTools) {
      state = "executing_tool";
      canWrite = false;
      const tName = lastStep.toolName || "команду";
      statusLabel = `ИИ выполняет: ${tName}`;
      statusDescription = lastStep.toolSummary
        ? `Действие: "${lastStep.toolSummary}" — пожалуйста, подождите, не пишите.`
        : "Идет исполнение системного инструмента. Подождите окончания шага.";
    } else if (last.type === "GENERIC" && recentActivitySilenceSeconds < 120) {
      state = "thinking";
      canWrite = false;
      statusLabel = "ИИ обрабатывает результат / думает";
      statusDescription = "Результаты команды получены. Модель анализирует вывод и планирует следующий шаг.";
    } else if (last.type === "USER_INPUT" && recentActivitySilenceSeconds < 120) {
      state = "thinking";
      canWrite = false;
      statusLabel = "ИИ начал выполнение задачи";
      statusDescription = "Запрос принят в обработку, идет генерация плана действий.";
    } else if (last.type === "PLANNER_RESPONSE" && !hasTools) {
      state = "idle";
      canWrite = true;
      statusLabel = "ИИ СВОБОДЕН — МОЖНО ПИСАТЬ";
      statusDescription = "Агент полностью закончил ответ и свободен для следующего запроса.";
    } else if (recentActivitySilenceSeconds > 90) {
      state = "idle";
      canWrite = true;
      statusLabel = "ИИ СВОБОДЕН (ОЖИДАЕТ)";
      statusDescription = "Диалог в режиме ожидания. Можно отправлять сообщение.";
    }

    return {
      state,
      canWrite,
      statusLabel,
      statusDescription,
      currentTool: lastStep.toolName,
      toolSummary: lastStep.toolSummary,
      toolCommand: lastStep.toolCommand,
      activeStepIndex: lastStep.stepIndex,
      startedAt: last.created_at,
      elapsedSeconds,
      conversationId: convId,
      model: modelName,
      recentSteps: steps.slice(-15).reverse(),
      turnStepCount,
      totalTokens: lastTokens,
    };
  }
}

const radarEngine = new RadarEngine();

// ============================================================================
// PLUGIN ENTRY POINT
// ============================================================================

export default function (bb: BbPluginApi) {
  // 1. REGISTER RPC METHODS
  bb.rpc.register(rpcContract, {
    get_radar_status: async (input) => {
      return radarEngine.getStatus(input?.conversationId);
    },

    get_radar_timeline: async (input) => {
      const status = radarEngine.getStatus(input?.conversationId);
      const limit = input?.limit || 20;
      return {
        ok: true,
        conversationId: status.conversationId,
        steps: status.recentSteps.slice(0, limit),
      };
    },

    get_radar_settings: async () => {
      return radarEngine.getSettings();
    },

    update_radar_settings: async (patch) => {
      const updated = radarEngine.updateSettings(patch);
      return {
        ok: true,
        settings: updated,
      };
    },
  });

  // 2. REGISTER CLI COMMAND
  bb.cli.register({
    name: "radar",
    summary: "Inspect real-time agent execution status and determine when it is safe to write",
    commands: [
      {
        name: "status",
        summary: "Display agent execution status and whether you can write",
        usage: "bb radar status",
      },
    ],
    run: async (argv: string[]) => {
      const sub = argv[0] || "status";
      const status = radarEngine.getStatus();

      if (sub === "status") {
        const out = {
          canWrite: status.canWrite,
          state: status.state,
          statusLabel: status.statusLabel,
          statusDescription: status.statusDescription,
          currentTool: status.currentTool || null,
          toolSummary: status.toolSummary || null,
          elapsedSeconds: status.elapsedSeconds,
          model: status.model,
          conversationId: status.conversationId,
          recentStepsCount: status.recentSteps.length,
        };

        return {
          exitCode: 0,
          stdout: JSON.stringify(out, null, 2),
        };
      }

      return {
        exitCode: 0,
        stdout: "Использование: bb radar status",
      };
    },
  });
}
