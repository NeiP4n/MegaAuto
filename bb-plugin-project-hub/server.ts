import * as crypto from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import type { Account, Project, ChatMessage, HubStatus } from "./src/types";

// ESM has no __dirname or require - shims for ESM plugin runtime
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// --- RPC CONTRACT SCHEMAS ---
const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  channel: z.enum(["n8n", "telegram", "webhook"]),
  url: z.string(),
  apiKey: z.string().nullable().optional(),
  status: z.enum(["online", "syncing", "offline"]),
  manualOffline: z.boolean().nullable().optional(),
  workflowsCount: z.number(),
  executionsCount: z.number(),
  unreadTotal: z.number(),
  lastSync: z.string(),
  createdAt: z.string(),
  latencyMs: z.number().nullable().optional(),
});

function maskAccount(acc: Account): Account {
  const copy: any = { ...acc };
  if (copy.apiKey) {
    copy.apiKey = "••••••••";
  } else {
    delete copy.apiKey;
  }
  return JSON.parse(JSON.stringify(copy));
}

function sanitizeRpcOutput<T>(obj: T): T {
  if (obj === undefined) return null as unknown as T;
  return JSON.parse(JSON.stringify(obj));
}

function sanitizeHandlers<T extends Record<string, any>>(handlers: T): T {
  const sanitized: any = {};
  for (const [key, fn] of Object.entries(handlers)) {
    if (typeof fn === "function") {
      sanitized[key] = async (...args: any[]) => {
        const res = await fn(...args);
        return sanitizeRpcOutput(res);
      };
    } else {
      sanitized[key] = fn;
    }
  }
  return sanitized;
}

const projectSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  channel: z.enum(["n8n", "telegram", "webhook"]),
  status: z.enum(["online", "idle", "offline"]),
  workflowId: z.string().nullable().optional(),
  unreadCount: z.number(),
  lastMessageTime: z.string(),
  lastMessagePreview: z.string(),
  aiActive: z.boolean(),
  tags: z.array(z.string()),
});

const chatMessageSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  accountId: z.string().nullable().optional(),
  sender: z.enum(["system", "agent", "user", "webhook"]),
  senderName: z.string(),
  text: z.string(),
  timestamp: z.string(),
  status: z.enum(["sent", "delivered", "read"]),
  metadata: z
    .object({
      workflowName: z.string().nullable().optional(),
      executionId: z.string().nullable().optional(),
      status: z.enum(["success", "running", "error"]).nullable().optional(),
      durationMs: z.number().nullable().optional(),
      payload: z.record(z.unknown()).nullable().optional(),
    })
    .nullable()
    .optional(),
});

const hubStatusSchema = z.object({
  n8nConnected: z.boolean(),
  n8nBaseUrl: z.string(),
  n8nVersion: z.string(),
  activeProjectsCount: z.number(),
  totalMessagesCount: z.number(),
  connectedAccountsCount: z.number(),
  lastSyncTime: z.string(),
  sqliteStatus: z.enum(["connected", "fallback_local", "disabled"]),
});

export const rpcContract = defineRpcContract({
  get_accounts: {
    input: z.null().optional(),
    output: z.object({
      ok: z.boolean(),
      accounts: z.array(accountSchema),
    }),
  },
  create_account: {
    input: z.object({
      name: z.string().min(1),
      channel: z.enum(["n8n", "telegram", "webhook"]),
      url: z.string().min(1),
      apiKey: z.string().nullable().optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      account: accountSchema,
    }),
  },
  disconnect_account: {
    input: z.object({
      accountId: z.string(),
    }),
    output: z.object({
      ok: z.boolean(),
      account: accountSchema.nullable().optional(),
    }),
  },
  delete_account: {
    input: z.object({
      accountId: z.string(),
    }),
    output: z.object({
      ok: z.boolean(),
    }),
  },
  get_projects: {
    input: z.object({ accountId: z.string().optional() }).optional(),
    output: z.object({
      ok: z.boolean(),
      projects: z.array(projectSchema),
    }),
  },
  get_messages: {
    input: z.object({ projectId: z.string() }),
    output: z.object({
      ok: z.boolean(),
      messages: z.array(chatMessageSchema),
    }),
  },
  send_message: {
    input: z.object({
      projectId: z.string(),
      text: z.string().min(1),
      mode: z.enum(["command", "message"]),
    }),
    output: z.object({
      ok: z.boolean(),
      message: chatMessageSchema,
      error: z.string().nullable().optional(),
    }),
  },
  get_status: {
    input: z.null().optional(),
    output: hubStatusSchema,
  },
  sync_n8n: {
    input: z
      .object({
        accountId: z.string().optional(),
        n8nBaseUrl: z.string().optional(),
        apiKey: z.string().nullable().optional(),
      })
      .optional(),
    output: z.object({
      ok: z.boolean(),
      syncedProjects: z.number(),
      syncedMessages: z.number(),
      error: z.string().nullable().optional(),
    }),
  },
  toggle_ai: {
    input: z.object({
      projectId: z.string(),
      aiActive: z.boolean(),
    }),
    output: z.object({
      ok: z.boolean(),
      project: projectSchema.nullable().optional(),
    }),
  },
  mark_as_read: {
    input: z.object({
      projectId: z.string(),
    }),
    output: z.object({
      ok: z.boolean(),
    }),
  },
  create_project: {
    input: z.object({
      accountId: z.string(),
      name: z.string().min(1),
      channel: z.enum(["n8n", "telegram", "webhook"]).optional(),
      workflowId: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      project: projectSchema,
    }),
  },
  delete_project: {
    input: z.object({
      projectId: z.string(),
    }),
    output: z.object({
      ok: z.boolean(),
    }),
  },
  toggle_project_status: {
    input: z.object({
      projectId: z.string(),
      status: z.enum(["online", "offline"]).optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      project: projectSchema.nullable().optional(),
    }),
  },
  ping_instance: {
    input: z.object({ accountId: z.string() }),
    output: z.object({
      ok: z.boolean(),
      status: z.enum(["online", "offline"]),
      latencyMs: z.number(),
      version: z.string().nullable().optional(),
      error: z.string().nullable().optional(),
    }),
  },
  get_workflows: {
    input: z.object({ accountId: z.string() }),
    output: z.object({
      ok: z.boolean(),
      workflows: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          active: z.boolean(),
          tags: z.array(z.string()).nullable().optional(),
          createdAt: z.string().nullable().optional(),
          updatedAt: z.string().nullable().optional(),
          lastExecution: z
            .object({
              id: z.string(),
              status: z.enum(["success", "running", "error"]),
              startedAt: z.string(),
              durationMs: z.number().nullable().optional(),
            })
            .nullable()
            .optional(),
        })
      ),
      error: z.string().nullable().optional(),
    }),
  },
  get_executions: {
    input: z.object({
      accountId: z.string(),
      workflowId: z.string().nullable().optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      executions: z.array(
        z.object({
          id: z.string(),
          workflowId: z.string(),
          workflowName: z.string().nullable().optional(),
          status: z.enum(["success", "running", "error", "waiting", "canceled"]),
          startedAt: z.string(),
          stoppedAt: z.string().nullable().optional(),
          durationMs: z.number().nullable().optional(),
          mode: z.enum(["manual", "trigger", "webhook", "retry", "integrated"]),
          errorMessage: z.string().nullable().optional(),
          errorNodeName: z.string().nullable().optional(),
        })
      ),
      error: z.string().nullable().optional(),
    }),
  },
  dispatch_webhook: {
    input: z.object({
      accountId: z.string(),
      path: z.string(),
      method: z.enum(["POST", "GET"]).optional(),
      payload: z.record(z.unknown()).optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      statusCode: z.number().nullable().optional(),
      durationMs: z.number().nullable().optional(),
      response: z.unknown().nullable().optional(),
      error: z.string().nullable().optional(),
    }),
  },
  start_local_server: {
    input: z.object({
      accountId: z.string().optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      message: z.string(),
      pid: z.number().nullable().optional(),
    }),
  },
  stop_local_server: {
    input: z.object({
      accountId: z.string().optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      message: z.string(),
    }),
  },
  get_local_server_status: {
    input: z.object({
      accountId: z.string().optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      running: z.boolean(),
      managedByPlugin: z.boolean(),
      pid: z.number().nullable().optional(),
      logs: z.array(z.string()),
      error: z.string().nullable().optional(),
    }),
  },
  send_ai_chat: {
    input: z.object({
      accountId: z.string().optional(),
      message: z.string().min(1),
      sessionId: z.string().optional(),
      model: z.string().optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      reply: z.string(),
      model: z.string(),
      latencyMs: z.number().nullable().optional(),
      error: z.string().nullable().optional(),
    }),
  },
  get_ai_chat_history: {
    input: z
      .object({
        sessionId: z.string().optional(),
      })
      .optional(),
    output: z.object({
      ok: z.boolean(),
      messages: z.array(chatMessageSchema),
    }),
  },
  clear_ai_chat_history: {
    input: z
      .object({
        sessionId: z.string().optional(),
      })
      .optional(),
    output: z.object({
      ok: z.boolean(),
    }),
  },
});

// --- PERSISTENCE & DATA STORE ---
interface StoreData {
  config: {
    n8nBaseUrl: string;
    n8nApiKey: string;
    sqlitePath: string;
  };
  accounts: Account[];
  projects: Project[];
  messages: ChatMessage[];
}

function getInitialStore(): StoreData {
  const nowIso = new Date().toISOString();
  const accounts: Account[] = [
    {
      id: "acc-n8n-local",
      name: "Локальный n8n (Master)",
      channel: "n8n",
      url: "http://localhost:5678",
      status: "online",
      workflowsCount: 0,
      executionsCount: 0,
      unreadTotal: 0,
      lastSync: nowIso,
      createdAt: nowIso,
    },
  ];

  return {
    config: {
      n8nBaseUrl: "http://localhost:5678",
      n8nApiKey: "",
      sqlitePath: path.join(process.env.USERPROFILE || process.env.HOME || "", ".n8n", "database.sqlite"),
    },
    accounts,
    projects: [],
    messages: [],
  };
}


// Master key and encryption helpers for API keys at rest (Fail-Closed)
function getOrCreateMasterKey(storageDir: string): Buffer {
  const keyFile = path.join(storageDir, ".project-hub.key");
  if (fs.existsSync(keyFile)) {
    const raw = fs.readFileSync(keyFile);
    if (raw.length === 32) return raw;
    throw new Error(`Invalid master key in ${keyFile}: expected 32 bytes`);
  }
  const newKey = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, newKey, { mode: 0o600 });
  try { fs.chmodSync(keyFile, 0o600); } catch {}
  return newKey;
}

function encryptApiKey(plaintext: string, key: Buffer): string {
  if (!plaintext) return "";
  if (plaintext.startsWith("enc:v1:")) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function decryptApiKey(ciphertext: string, key: Buffer): string {
  if (!ciphertext || !ciphertext.startsWith("enc:v1:")) return ciphertext;
  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 5) return ciphertext;
    const [, , ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final("utf8");
  } catch {
    return ciphertext;
  }
}

// Subpath URL resolution helper (preserves base path e.g. /n8n/api/v1/...)
function resolveInstanceUrl(baseUrl: string, relativePath: string): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const [subWithoutQuery, query] = relativePath.split("?");
  const cleanSub = subWithoutQuery.replace(/^[\/\\]+/, "");
  const combined = basePath ? `${basePath}/${cleanSub}` : `/${cleanSub}`;
  const target = new URL(combined, base.origin);
  if (query) {
    target.search = query;
  }
  return target.toString();
}
class HubStore {
  private storeFile: string;
  private masterKey: Buffer;
  private data: StoreData;

  constructor(storageDir: string) {
    if (!fs.existsSync(storageDir)) {
      try {
        fs.mkdirSync(storageDir, { recursive: true });
      } catch {
        // ignore
      }
    }
    this.masterKey = getOrCreateMasterKey(storageDir);
    this.storeFile = path.join(storageDir, "project-hub-store.json");
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      if (fs.existsSync(this.storeFile)) {
        const raw = fs.readFileSync(this.storeFile, "utf-8");
        const parsed = JSON.parse(raw);
        const legacyMockIds = [
          "instinct-pipeline",
          "client-support-ops",
          "telegram-alerts",
          "webhook-router",
        ];
        if (parsed.projects && Array.isArray(parsed.projects)) {
          parsed.projects = parsed.projects.filter((p: any) => !legacyMockIds.includes(p.id));
        }
        if (parsed.messages && Array.isArray(parsed.messages)) {
          parsed.messages = parsed.messages.filter((m: any) => !legacyMockIds.includes(m.projectId));
        }
        if (parsed.accounts && Array.isArray(parsed.accounts)) {
          parsed.accounts = parsed.accounts.filter((a: any) => a.channel !== "whatsapp");
          for (const a of parsed.accounts) {
            if (
              !a.lastSync ||
              a.lastSync === "Только что" ||
              a.lastSync === "Ошибка синхронизации" ||
              a.lastSync === "В сети" ||
              typeof a.lastSync !== "string" ||
              a.lastSync.includes("назад")
            ) {
              a.lastSync = new Date().toISOString();
            }
          }
        }
        try { fs.chmodSync(this.storeFile, 0o600); } catch {}
        if (parsed.accounts && Array.isArray(parsed.accounts)) {
          for (const a of parsed.accounts) {
            if (a.apiKey) a.apiKey = decryptApiKey(a.apiKey, this.masterKey);
          }
        }
        if (parsed.config?.n8nApiKey) {
          parsed.config.n8nApiKey = decryptApiKey(parsed.config.n8nApiKey, this.masterKey);
        }
        this.save(parsed);
        return parsed;
      }
    } catch {
      // ignore
    }
    const initial = getInitialStore();
    this.save(initial);
    return initial;
  }

  public save(data?: StoreData): void {
    try {
      const source = data || this.data;
      const encryptedData: StoreData = {
        ...source,
        accounts: source.accounts.map((a) => ({
          ...a,
          apiKey: a.apiKey ? encryptApiKey(a.apiKey, this.masterKey) : undefined,
        })),
        config: {
          ...source.config,
          n8nApiKey: source.config.n8nApiKey ? encryptApiKey(source.config.n8nApiKey, this.masterKey) : "",
        },
      };
      fs.writeFileSync(this.storeFile, JSON.stringify(encryptedData, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      try { fs.chmodSync(this.storeFile, 0o600); } catch {}
    } catch {
      // ignore
    }
  }

  public getAccounts(): Account[] {
    return this.data.accounts;
  }

  public addAccount(input: {
    name: string;
    channel: "n8n" | "telegram" | "webhook";
    url: string;
    apiKey?: string;
  }): Account {
    const id = `acc-${input.channel}-${Date.now().toString(36)}`;
    const newAcc: Account = {
      id,
      name: input.name,
      channel: input.channel,
      url: input.url,
      apiKey: input.apiKey,
      status: "online",
      workflowsCount: 0,
      executionsCount: 0,
      unreadTotal: 0,
      lastSync: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.data.accounts.push(newAcc);
    this.save();
    return newAcc;
  }

  public disconnectAccount(
    accountId: string,
    targetStatus?: "online" | "offline"
  ): Account | undefined {
    const acc = this.data.accounts.find((a) => a.id === accountId);
    if (acc) {
      acc.status = targetStatus || (acc.status === "online" ? "offline" : "online");
      acc.manualOffline = acc.status === "offline";
      acc.lastSync = new Date().toISOString();
      this.save();
      return acc;
    }
    return undefined;
  }

  public deleteAccount(accountId: string): boolean {
    const idx = this.data.accounts.findIndex((a) => a.id === accountId);
    if (idx !== -1) {
      this.data.accounts.splice(idx, 1);
      this.data.projects = this.data.projects.filter((p) => p.accountId !== accountId);
      this.save();
      return true;
    }
    return false;
  }

  public createProject(input: {
    accountId: string;
    name: string;
    channel?: "n8n" | "telegram" | "webhook";
    workflowId?: string;
    tags?: string[];
  }): Project {
    const acc = this.getAccountById(input.accountId);
    const channel = input.channel || acc?.channel || "n8n";
    const id = `proj-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const newProj: Project = {
      id,
      accountId: input.accountId,
      name: input.name,
      channel,
      status: "online",
      workflowId: input.workflowId,
      unreadCount: 0,
      lastMessageTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      lastMessagePreview: "Чат создан.",
      aiActive: true,
      tags: input.tags || [channel.toUpperCase()],
    };
    this.data.projects.push(newProj);
    this.save();
    return newProj;
  }

  public deleteProject(projectId: string): boolean {
    const idx = this.data.projects.findIndex((p) => p.id === projectId);
    if (idx !== -1) {
      this.data.projects.splice(idx, 1);
      this.data.messages = this.data.messages.filter((m) => m.projectId !== projectId);
      this.save();
      return true;
    }
    return false;
  }

  public toggleProjectStatus(
    projectId: string,
    status?: "online" | "offline"
  ): Project | undefined {
    const p = this.data.projects.find((proj) => proj.id === projectId);
    if (p) {
      p.status = status || (p.status === "online" ? "offline" : "online");
      this.save();
      return p;
    }
    return undefined;
  }

  public getProjects(accountId?: string): Project[] {
    if (accountId && accountId !== "all") {
      return this.data.projects.filter((p) => p.accountId === accountId);
    }
    return this.data.projects;
  }

  public getMessages(projectId: string): ChatMessage[] {
    return this.data.messages.filter((m) => m.projectId === projectId);
  }

  public clearMessages(projectId: string): void {
    this.data.messages = this.data.messages.filter((m) => m.projectId !== projectId);
    this.save();
  }

  public markAsRead(projectId: string): void {
    const p = this.data.projects.find((proj) => proj.id === projectId);
    if (p) {
      p.unreadCount = 0;
      this.save();
    }
  }

  public toggleAi(projectId: string, aiActive: boolean): Project | undefined {
    const p = this.data.projects.find((proj) => proj.id === projectId);
    if (p) {
      p.aiActive = aiActive;
      this.save();
      return p;
    }
    return undefined;
  }

  public addMessage(msg: ChatMessage): void {
    this.data.messages.push(msg);

    const p = this.data.projects.find((proj) => proj.id === msg.projectId);
    if (p) {
      p.lastMessagePreview = msg.text.slice(0, 80);
      p.lastMessageTime = msg.timestamp;
      if (msg.sender === "webhook") {
        p.unreadCount += 1;
      }
    }

    this.save();
  }

  public getAccountById(id: string): Account | undefined {
    return this.data.accounts.find((a) => a.id === id);
  }

  public getProjectById(id: string): Project | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  public syncWorkflows(
    account: Account,
    workflows: any[],
    executionsCount?: number,
    executions?: any[]
  ): number {
    let synced = 0;
    const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    for (const wf of workflows) {
      if (!wf || !wf.id) continue;
      const projId = `n8n-${account.id}-${wf.id}`;
      let proj = this.data.projects.find(
        (p) =>
          (p.accountId === account.id && p.workflowId === String(wf.id)) ||
          p.id === projId ||
          p.workflowId === String(wf.id)
      );

      const tags: string[] = Array.isArray(wf.tags)
        ? wf.tags.map((t: any) => (typeof t === "string" ? t : t.name || String(t)))
        : ["n8n", "Workflow"];

      const status = wf.active ? "online" : "idle";

      if (proj) {
        proj.name = wf.name || proj.name;
        proj.status = status;
        proj.tags = Array.from(new Set([...proj.tags, ...tags]));
        proj.workflowId = String(wf.id);
      } else {
        proj = {
          id: projId,
          accountId: account.id,
          name: wf.name || `Workflow ${wf.id}`,
          channel: account.channel || "n8n",
          status,
          workflowId: String(wf.id),
          unreadCount: 0,
          lastMessageTime: nowStr,
          lastMessagePreview: `Синхронизирован с n8n (${wf.active ? "активен" : "пауза"})`,
          aiActive: true,
          tags,
        };
        this.data.projects.push(proj);
      }
      synced++;
    }

    if (Array.isArray(executions)) {
      for (const exec of executions.slice(0, 5)) {
        const msgId = `exec-${exec.id}`;
        if (!this.data.messages.some((m) => m.id === msgId)) {
          const relatedProject = this.data.projects.find(
            (p) => p.accountId === account.id && p.workflowId === String(exec.workflowId)
          );
          if (relatedProject) {
            const duration =
              exec.stoppedAt && exec.startedAt
                ? Math.max(0, new Date(exec.stoppedAt).getTime() - new Date(exec.startedAt).getTime())
                : undefined;
            this.data.messages.push({
              id: msgId,
              projectId: relatedProject.id,
              accountId: account.id,
              sender: "webhook",
              senderName: "n8n Engine",
              text: `Запуск execution #${exec.id} (${exec.mode || "trigger"}): статус ${
                exec.status || (exec.finished ? "success" : "running")
              }`,
              timestamp: new Date(exec.startedAt || Date.now()).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
              status: "read",
              metadata: {
                workflowName: relatedProject.name,
                executionId: String(exec.id),
                status: exec.status === "error" ? "error" : exec.finished ? "success" : "running",
                durationMs: duration,
              },
            });
          }
        }
      }
    }

    account.workflowsCount = workflows.length;
    if (typeof executionsCount === "number") {
      account.executionsCount = executionsCount;
    }
    account.lastSync = new Date().toISOString();
    account.status = "online";
    this.save();
    return synced;
  }

  public getConfig() {
    return this.data.config;
  }

  public getTotalMessagesCount(): number {
    return this.data.messages.length;
  }
}

function isLocalUrl(u: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u.trim());
}

function isLocalPort5678(u: string): boolean {
  const clean = (u || "").trim();
  return (
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):5678(\/|\?|$)/i.test(clean) ||
    /^(localhost|127\.0\.0\.1|\[::1\]):5678(\/|\?|$)/i.test(clean)
  );
}

function buildSafeWebhookUrl(baseUrl: string, rawPath: string): string | null {
  if (!rawPath || typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (/^[a-z0-9+.-]+:\/\//i.test(trimmed)) return null;

  try {
    let cleanPath = trimmed;
    if (!cleanPath.startsWith("/") && !cleanPath.startsWith("webhook/") && !cleanPath.startsWith("webhook-test/")) {
      cleanPath = "webhook/" + cleanPath;
    }
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/, "");
    const sub = cleanPath.replace(/^[\/\\]+/, "");
    // Support deployments under URL prefix (/n8n/webhook/...)
    const combinedPath = basePath ? `${basePath}/${sub}` : `/${sub}`;
    const parsed = new URL(combinedPath, base.origin);

    // Origin must strictly match instance base URL
    if (parsed.origin !== base.origin) return null;

    // Iterative URL decoding (up to 4 passes)
    let decoded = parsed.pathname;
    let prev = "";
    let passes = 0;
    while (decoded !== prev && passes < 4) {
      prev = decoded;
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        return null;
      }
      passes++;
    }

    // Defense-in-depth: if any % remains after decoding or traversal detected, reject!
    if (decoded.includes("%") || decoded.includes("..") || decoded.includes("\\") || decoded.includes("//")) {
      return null;
    }

    const effectivePath = basePath ? parsed.pathname.slice(basePath.length) : parsed.pathname;
    if (!effectivePath.startsWith("/webhook/") && !effectivePath.startsWith("/webhook-test/")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function readLocalSqliteWorkflowsAndExecutions(): {
  ok: boolean;
  workflows: any[];
  executions: any[];
  source: string;
  notice: string;
} {
  try {
    const sqlitePath = path.join(
      process.env.USERPROFILE || process.env.HOME || "",
      ".n8n",
      "database.sqlite"
    );
    if (!fs.existsSync(sqlitePath)) {
      return {
        ok: false,
        workflows: [],
        executions: [],
        source: "sqlite_local",
        notice: "Локальный файл базы n8n не найден на диске",
      };
    }
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(sqlitePath, { readOnly: true });

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    const tableNames = new Set(tables.map((t: any) => t.name));

    let workflows: any[] = [];
    if (tableNames.has("workflow_entity")) {
      const rows = db
        .prepare("SELECT id, name, active, createdAt, updatedAt FROM workflow_entity ORDER BY updatedAt DESC")
        .all() as any[];
      workflows = rows.map((r: any) => ({
        id: String(r.id),
        name: r.name || `Workflow ${r.id}`,
        active: Boolean(r.active),
        tags: [],
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : undefined,
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : undefined,
      }));
    }

    let executions: any[] = [];
    if (tableNames.has("execution_entity")) {
      const rows = db
        .prepare(
          "SELECT id, workflowId, mode, startedAt, stoppedAt, status, finished FROM execution_entity ORDER BY startedAt DESC LIMIT 30"
        )
        .all() as any[];
      executions = rows.map((r: any) => ({
        id: String(r.id),
        workflowId: String(r.workflowId),
        mode: r.mode || "manual",
        startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : new Date().toISOString(),
        stoppedAt: r.stoppedAt ? new Date(r.stoppedAt).toISOString() : undefined,
        status: r.status === "error" ? "error" : r.finished ? "success" : "running",
      }));
    }

    db.close();
    return {
      ok: true,
      workflows,
      executions,
      source: "sqlite_local",
      notice: "Данные получены из локальной БД SQLite (read-only), так как API-ключ не задан или вернул 401",
    };
  } catch (err: any) {
    appendServerLog(`Предупреждение SQLite: ${err?.message || err}`);
    return {
      ok: false,
      workflows: [],
      executions: [],
      source: "sqlite_local",
      notice: err?.message || "Ошибка чтения SQLite",
    };
  }
}

// --- LOCAL N8N SERVER PROCESS MANAGEMENT ---
const N8N_DEFAULT_ENV = {
  N8N_PORT: "5678",
  N8N_HOST: "127.0.0.1",
  N8N_PROTOCOL: "http",
  N8N_RUNNERS_ENABLED: "false",
  N8N_DIAGNOSTICS_ENABLED: "false",
  N8N_RUNNERS_TASK_TIMEOUT: "300",
  N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES: "2147483648",
  N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES: "5000",
};

let localN8nProcess: ChildProcess | null = null;
let serverState: "stopped" | "starting" | "running" | "stopping" | "error" = "stopped";
let startLockPromise: Promise<{ ok: boolean; message: string; pid?: number }> | null = null;
const serverLogs: string[] = [];

function appendServerLog(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg.trim()}`;
  serverLogs.push(line);
  if (serverLogs.length > 200) {
    serverLogs.shift();
  }
}

function findPortPid(port: number = 5678): number | null {
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano -p tcp", { encoding: "utf8", timeout: 2000 });
      for (const line of out.split("\n")) {
        // netstat columns: proto, local addr, foreign addr, state, pid.
        // Match the LOCAL address exactly - a substring match on ":5678"
        // also hits :15678/:56780 and returns someone else's PID.
        if (!line.includes("LISTENING")) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const localAddr = parts[1];
        if (!localAddr.endsWith(`:${port}`)) continue;
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid) && pid > 0) return pid;
      }
    } else {
      const out = execSync(`lsof -ti :${port}`, { encoding: "utf8", timeout: 2000 });
      const pid = parseInt(out.trim().split("\n")[0], 10);
      if (!isNaN(pid) && pid > 0) return pid;
    }
  } catch {
    // not found or error
  }
  return null;
}

// isLikelyN8nProcess checks the command line of a PID we did NOT start
// ourselves before we are allowed to signal it. Without this, "stop" could
// kill an unrelated process that merely happens to listen on port 5678.
function isLikelyN8nProcess(pid: number): boolean {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
        { encoding: "utf8", timeout: 4000 }
      );
      return /n8n/i.test(out);
    }
    const out = execSync(`ps -p ${pid} -o command=`, { encoding: "utf8", timeout: 2000 });
    return /n8n/i.test(out);
  } catch {
    // Cannot verify -> do not touch the process.
    return false;
  }
}

async function startLocalN8nProcess(): Promise<{ ok: boolean; message: string; pid?: number }> {
  // 1. Guard against alive child process regardless of current state
  if (localN8nProcess && localN8nProcess.exitCode === null) {
    return {
      ok: true,
      message: `Процесс n8n уже запущен (PID ${localN8nProcess.pid})`,
      pid: localN8nProcess.pid,
    };
  }

  // 2. Synchronous lock: if another start is in-flight, return the exact active promise
  if (startLockPromise) {
    return startLockPromise;
  }

  startLockPromise = (async () => {
    try {
      healthCache.clear();
      const health = await checkN8nHealth("http://127.0.0.1:5678", true);
      if (health.connected) {
        serverState = "running";
        const existingPid = localN8nProcess?.pid || findPortPid(5678);
        return {
          ok: true,
          message: existingPid ? `Сервер n8n уже работает (PID ${existingPid})` : "Сервер n8n уже работает",
          pid: existingPid ?? undefined,
        };
      }

      serverState = "starting";
      appendServerLog("Запуск локального сервера n8n (127.0.0.1:5678)...");
      const isWin = process.platform === "win32";
      let cmd = "n8n";
      if (isWin) {
        const npmPath = process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "n8n.cmd") : "";
        cmd = npmPath && fs.existsSync(npmPath) ? npmPath : "n8n.cmd";
      }

      const child = spawn(cmd, ["start"], {
        shell: isWin,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...N8N_DEFAULT_ENV,
        },
      });

      localN8nProcess = child;

      child.stdout?.on("data", (chunk: any) => {
        const str = chunk.toString();
        for (const line of str.split("\n")) {
          if (line.trim()) appendServerLog(line);
        }
      });

      child.stderr?.on("data", (chunk: any) => {
        const str = chunk.toString();
        for (const line of str.split("\n")) {
          if (line.trim()) appendServerLog(line);
        }
      });

      child.on("exit", (code: any) => {
        appendServerLog(`Сервер n8n завершил работу (код ${code})`);
        if (localN8nProcess === child) {
          localN8nProcess = null;
          serverState = "stopped";
        }
        healthCache.clear();
      });

      child.on("error", (err: any) => {
        appendServerLog(`Ошибка процесса n8n: ${err.message}`);
        if (localN8nProcess === child) {
          localN8nProcess = null;
          serverState = "error";
        }
        healthCache.clear();
      });

      // Poll readiness health check up to 30 seconds
      const deadline = Date.now() + 30000;
      let ready = false;
      while (Date.now() < deadline) {
        if (localN8nProcess !== child || child.exitCode !== null) {
          serverState = "error";
          return {
            ok: false,
            message: "Процесс n8n неожиданно завершился при запуске",
          };
        }
        const h = await checkN8nHealth("http://127.0.0.1:5678", true);
        if (h.connected) {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 600));
      }

      if (!ready) {
        serverState = "error";
        try {
          if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"]);
          } else {
            child.kill("SIGKILL");
          }
        } catch {}
        if (localN8nProcess === child) localN8nProcess = null;
        return {
          ok: false,
          message: `Таймаут запуска: n8n не перешёл в состояние готовности за 30 секунд (PID ${child.pid})`,
          pid: child.pid,
        };
      }

      serverState = "running";
      return {
        ok: true,
        message: "Сервер n8n успешно запущен и готов к работе",
        pid: child.pid,
      };
    } catch (err: any) {
      serverState = "error";
      appendServerLog(`Не удалось запустить n8n: ${err?.message}`);
      return {
        ok: false,
        message: err?.message || "Ошибка запуска n8n",
      };
    } finally {
      startLockPromise = null;
    }
  })();

  return startLockPromise;
}

async function stopLocalN8nProcess(): Promise<{ ok: boolean; message: string }> {
  appendServerLog("Остановка локального сервера n8n...");
  healthCache.clear();

  const child = localN8nProcess;
  let targetPid: number | null = null;

  if (child && child.pid && child.exitCode === null) {
    targetPid = child.pid;
  } else {
    const portPid = findPortPid(5678);
    if (portPid) {
      // This PID belongs to a process we did not spawn (user-started n8n,
      // or an unrelated listener). Only signal it when it really is n8n.
      if (isLikelyN8nProcess(portPid)) {
        targetPid = portPid;
      } else {
        appendServerLog(`Порт 5678 занят процессом PID ${portPid}, но это не n8n - оставляем его в покое`);
      }
    }
  }

  if (!targetPid) {
    localN8nProcess = null;
    serverState = "stopped";
    appendServerLog("Процесс на порту 5678 не найден (уже остановлен)");
    return {
      ok: true,
      message: "Сервер n8n не запущен на порту 5678",
    };
  }

  serverState = "stopping";
  appendServerLog(`Сигнал остановки отправлен процессу n8n (PID ${targetPid})...`);

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(targetPid), "/t"]);
    } else {
      process.kill(targetPid, "SIGTERM");
    }
  } catch (e: any) {
    appendServerLog(`Ошибка при отправке сигнала остановки: ${e?.message}`);
  }

  // Wait for true process exit or port release (up to 3s), escalate to force kill if needed
  const deadline = Date.now() + 3000;
  let stillAlive = true;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      stillAlive = false;
      break;
    }
    const currentPid = findPortPid(5678);
    if (!currentPid) {
      stillAlive = false;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  if (stillAlive) {
    appendServerLog(`Процесс (PID ${targetPid}) не завершился добровольно за 3с, эскалация SIGKILL...`);
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(targetPid), "/f", "/t"]);
      } else {
        process.kill(targetPid, "SIGKILL");
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  if (localN8nProcess === child) {
    localN8nProcess = null;
  }
  serverState = "stopped";
  healthCache.clear();
  appendServerLog(`Сервер n8n остановлен (PID ${targetPid})`);
  return { ok: true, message: `Сервер n8n остановлен (PID ${targetPid})` };
}

// Ensure cleanup on plugin/process shutdown
function cleanupLocalN8n() {
  const child = localN8nProcess;
  if (child && child.pid && child.exitCode === null) {
    serverState = "stopping";
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"]);
      } else {
        child.kill("SIGKILL");
      }
    } catch {}
    localN8nProcess = null;
    serverState = "stopped";
  }
}

process.on("exit", cleanupLocalN8n);
// Registering a SIGINT/SIGTERM listener suppresses Node's default exit, so
// without process.exit the host would survive Ctrl-C/SIGTERM entirely.
process.on("SIGINT", () => {
  cleanupLocalN8n();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanupLocalN8n();
  process.exit(143);
});

function getCanonicalBase(url: string): string {
  const clean = url.trim().replace(/\/+$/, "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(clean)) {
    return clean.replace(/localhost|\[::1\]/i, "127.0.0.1");
  }
  return clean;
}

// Single-pass n8n probe: tries health/version endpoints in parallel, first OK wins.
// Never falls back to 127.0.0.1 for a remote baseUrl - a remote instance must not
// report "connected" (or receive commands) because a local n8n happens to answer.
async function probeN8n(baseUrl: string): Promise<{ connected: boolean; version: string }> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const bases = new Set<string>([cleanBase]);
  if (isLocalUrl(cleanBase)) {
    bases.add(cleanBase.replace("localhost", "127.0.0.1"));
    bases.add(cleanBase.replace("127.0.0.1", "localhost"));
  }

  const probeOne = async (b: string): Promise<{ version: string } | null> => {
    // 1. Check readiness endpoint: /healthz/readiness or /healthz must return 200 {"status":"ok"}
    let readinessPassed = false;
    let versionHeader = "";
    try {
      const res = await fetch(resolveInstanceUrl(b, "/healthz/readiness"), {
        signal: AbortSignal.timeout(2500),
        redirect: "manual",
      });
      if (res.ok) {
        versionHeader = res.headers.get("x-n8n-version") || res.headers.get("x-version") || "";
        const data = (await res.json().catch(() => null)) as any;
        if (data?.status === "ok") readinessPassed = true;
      }
    } catch {}

    if (!readinessPassed) {
      try {
        const res = await fetch(resolveInstanceUrl(b, "/healthz"), {
          signal: AbortSignal.timeout(2500),
          redirect: "manual",
        });
        if (res.ok) {
          versionHeader = versionHeader || res.headers.get("x-n8n-version") || res.headers.get("x-version") || "";
          const data = (await res.json().catch(() => null)) as any;
          if (data?.status === "ok") readinessPassed = true;
        }
      } catch {}
    }

    if (!readinessPassed) return null;

    // 2. Validate genuine n8n fingerprint (header OR /rest/settings OR frontend meta tag)
    if (versionHeader) {
      return { version: versionHeader };
    }

    try {
      const res = await fetch(resolveInstanceUrl(b, "/rest/settings"), {
        signal: AbortSignal.timeout(2500),
        redirect: "manual",
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        const hasN8nSignature =
          data?.data?.settingsMode !== undefined ||
          data?.data?.userManagement !== undefined ||
          data?.data?.communityNodesEnabled !== undefined ||
          data?.versionCli !== undefined;
        if (hasN8nSignature) {
          const v = data?.versionCli || data?.data?.versionCli || "online";
          return { version: String(v) };
        }
      }
    } catch {}

    try {
      const res = await fetch(resolveInstanceUrl(b, "/"), {
        signal: AbortSignal.timeout(2500),
        redirect: "manual",
      });
      if (res.ok) {
        const html = await res.text().catch(() => "");
        if (html.includes("n8n:config:") || html.includes('content="cmVzdA=="') || html.includes("<title>n8n")) {
          return { version: "online" };
        }
      }
    } catch {}

    return null;
  };

  const results = await Promise.all(Array.from(bases).map(probeOne));
  const hit = results.find((r) => r && r.version !== "online" && r.version !== "unknown") || results.find((r) => r !== null);
  return hit ? { connected: true, version: hit.version } : { connected: false, version: "unknown" };
}

// Cached health check with short TTL and canonical URL keys to prevent false offline locks
const HEALTH_TTL_MS = 2500;
const healthCache = new Map<string, { connected: boolean; version: string; at: number }>();

async function checkN8nHealth(
  baseUrl: string,
  forceFreshOrApiKey?: boolean | string | null,
  forceFreshArg?: boolean
): Promise<{ connected: boolean; version: string }> {
  const forceFresh = typeof forceFreshOrApiKey === "boolean" ? forceFreshOrApiKey : Boolean(forceFreshArg);
  const canonical = getCanonicalBase(baseUrl);
  const key = canonical;
  if (!forceFresh) {
    const cached = healthCache.get(key);
    const ttl = cached?.connected ? HEALTH_TTL_MS : 1000;
    if (cached && Date.now() - cached.at < ttl) {
      return { connected: cached.connected, version: cached.version };
    }
  }

  const result = await probeN8n(baseUrl);
  healthCache.set(key, { ...result, at: Date.now() });
  return result;
}

async function fetchN8nWorkflowsAndExecutions(
  baseUrl: string,
  apiKey?: string | null
): Promise<{
  ok: boolean;
  workflows: any[];
  executions: any[];
  source?: string;
  notice?: string;
  error?: string;
}> {
  const cleanBase = baseUrl.replace(/\/+$/, "");

  // 1. If apiKey is provided, attempt official REST API first
  if (apiKey) {
    try {
      const targetWfUrl = resolveInstanceUrl(cleanBase, "/api/v1/workflows");
      const baseObj = new URL(cleanBase);
      const parsedTarget = new URL(targetWfUrl);
      if (parsedTarget.origin !== baseObj.origin) {
        return { ok: false, workflows: [], executions: [], error: "Origin mismatch" };
      }

      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-N8N-API-KEY": apiKey,
      };

      const wfRes = await fetch(targetWfUrl, {
        headers,
        signal: AbortSignal.timeout(4000),
        redirect: "manual",
      });

      if (wfRes.ok) {
        const wfData = (await wfRes.json()) as any;
        const workflows = Array.isArray(wfData?.data)
          ? wfData.data
          : Array.isArray(wfData)
          ? wfData
          : [];

        let executions: any[] = [];
        try {
          const targetExUrl = resolveInstanceUrl(cleanBase, "/api/v1/executions?limit=20");
          const exRes = await fetch(targetExUrl, {
            headers,
            signal: AbortSignal.timeout(4000),
            redirect: "manual",
          });

          if (exRes.ok) {
            const exData = (await exRes.json()) as any;
            executions = Array.isArray(exData?.data)
              ? exData.data
              : Array.isArray(exData)
              ? exData
              : [];
          }
        } catch {
          // executions fetch is optional, ignore error
        }

        return { ok: true, workflows, executions, source: "rest_api" };
      }

      // If REST API specifically returned 401 Unauthorized AND it's strictly port 5678:
      if (wfRes.status === 401 && isLocalPort5678(cleanBase)) {
        return readLocalSqliteWorkflowsAndExecutions();
      }

      return {
        ok: false,
        workflows: [],
        executions: [],
        error: `HTTP ${wfRes.status} from ${cleanBase}/api/v1/workflows`,
      };
    } catch (err: any) {
      return {
        ok: false,
        workflows: [],
        executions: [],
        error: err?.message || `Failed to connect to ${cleanBase}`,
      };
    }
  }

  // 2. If no apiKey is configured and it's strictly local master (port 5678):
  if (isLocalPort5678(cleanBase)) {
    return readLocalSqliteWorkflowsAndExecutions();
  }

  return {
    ok: false,
    workflows: [],
    executions: [],
    error: "Для удалённого инстанса или нестандартного порта требуется X-N8N-API-KEY",
  };
}

async function forwardToN8n(
  store: HubStore,
  projectId: string,
  command: string,
  mode: string
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const project = store.getProjectById(projectId);
  const account = project ? store.getAccountById(project.accountId) : undefined;
  const cfg = store.getConfig();

  const channel = project?.channel || account?.channel || "n8n";

  if (channel === "webhook") {
    const targetUrl = account?.url || cfg.n8nBaseUrl;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // Security: never forward administrative X-N8N-API-KEY to external webhooks!

      const res = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          projectId,
          command,
          mode,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(4000),
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, error: "HTTP перенаправления запрещены для вебхуков" };
      }
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as any;
        return {
          ok: true,
          reply: data.reply || data.output || data.message || "Webhook успешно принял команду",
        };
      }
      return { ok: false, error: `Webhook returned HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err?.message || `Failed to post to webhook ${targetUrl}` };
    }
  }

  if (channel === "telegram") {
    const targetUrl = account?.url?.startsWith("http")
      ? account.url
      : `${(cfg.n8nBaseUrl || "http://localhost:5678").replace(/\/+$/, "")}/webhook/telegram`;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // Security: never forward administrative X-N8N-API-KEY to external telegram bots!

      const res = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          channel: "telegram",
          target: account?.url || "@bot",
          projectId,
          command,
          mode,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(4000),
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, error: "HTTP перенаправления запрещены для шлюзов" };
      }
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as any;
        return {
          ok: true,
          reply: data.reply || data.output || data.message || "Команда отправлена в Telegram бот",
        };
      }
      return { ok: false, error: `Telegram gateway returned HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err?.message || "Failed to reach Telegram gateway" };
    }
  }

  // Default: n8n channel
  const baseUrl = account?.url || cfg.n8nBaseUrl;
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const webhookPath = `/webhook/api/projects/${projectId}/send`;
  const endpoints = [`${cleanBase}${webhookPath}`];
  if (isLocalUrl(cleanBase)) {
    const alt = cleanBase.includes("localhost")
      ? cleanBase.replace("localhost", "127.0.0.1")
      : cleanBase.replace("127.0.0.1", "localhost");
    if (alt !== cleanBase) endpoints.push(`${alt}${webhookPath}`);
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Security: webhooks don't receive X-N8N-API-KEY; redirect: "manual" prevents cross-origin redirection

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers,
        body: JSON.stringify({
          projectId,
          command,
          mode,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(3500),
        redirect: "manual",
      });

      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as any;
        return {
          ok: true,
          reply: data.reply || data.output || data.message || "Выполнено успешно (n8n webhook)",
        };
      }
    } catch {
      // try next
    }
  }

  return { ok: false, error: `n8n Webhook (${cleanBase}) недоступен или вернул ошибку` };
}

export default function (bb: BbPluginApi) {
  const pluginRoot = path.basename(__dirname) === "dist" ? path.dirname(__dirname) : __dirname;
  const storePath = path.join(pluginRoot, "data");
  const store = new HubStore(storePath);

  // 1. REGISTER RPC IMPLEMENTATIONS (wrapped with strict JSON sanitizer)
  bb.rpc.register(
    rpcContract,
    sanitizeHandlers({
      get_accounts: async () => {
        const masked = store.getAccounts().map(maskAccount);
        return {
          ok: true,
          accounts: masked,
        };
      },

      create_account: async (input) => {
        let cleanUrl = input.url.trim();
        if (!/^https?:\/\//i.test(cleanUrl)) {
          cleanUrl = "http://" + cleanUrl;
        }
        const acc = store.addAccount({
          name: input.name,
          channel: input.channel,
          url: cleanUrl,
          apiKey: input.apiKey || undefined,
        });
        return {
          ok: true,
          account: maskAccount(acc),
        };
      },

    disconnect_account: async (input) => {
      const acc = store.disconnectAccount(input.accountId);
      return {
        ok: !!acc,
        account: acc ? maskAccount(acc) : undefined,
      };
    },

    delete_account: async (input) => {
      const deleted = store.deleteAccount(input.accountId);
      return { ok: deleted };
    },

    get_projects: async (input) => {
      return {
        ok: true,
        projects: store.getProjects(input?.accountId),
      };
    },

    get_messages: async (input) => {
      return {
        ok: true,
        messages: store.getMessages(input.projectId),
      };
    },

    send_message: async (input) => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      // Both modes are operator-originated: recording a "message" send as a
      // webhook event made your own message bump the unread counter.
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        projectId: input.projectId,
        sender: "user",
        senderName: "Оператор",
        text: input.text,
        timestamp: timeStr,
        status: "sent",
        metadata: {
          workflowName: input.mode === "command" ? "interactive_command" : "interactive_message",
          status: "running",
        },
      };

      store.addMessage(newMsg);

      // Forward to n8n if reachable
      const n8nResult = await forwardToN8n(store, input.projectId, input.text, input.mode);

      if (n8nResult.ok && n8nResult.reply) {
        const replyMsg: ChatMessage = {
          id: `msg-${Date.now()}-reply`,
          projectId: input.projectId,
          accountId: store.getProjectById(input.projectId)?.accountId,
          sender: "agent",
          senderName: "n8n AI Agent",
          text: n8nResult.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          status: "delivered",
          metadata: {
            workflowName: "webhook_reply",
            status: "success",
            durationMs: 320,
          },
        };
        store.addMessage(replyMsg);
      }

      return {
        ok: n8nResult.ok,
        message: newMsg,
        error: n8nResult.ok ? undefined : n8nResult.error,
      };
    },

    get_status: async () => {
      const cfg = store.getConfig();
      const projects = store.getProjects();
      const accounts = store.getAccounts();

      // Live per-instance health for n8n accounts (parallel + cached, so the UI
      // poll stays fast even when an instance is down). Instances the user
      // switched off by hand (manualOffline) are left alone.
      const n8nAccounts = accounts.filter((a) => a.channel === "n8n" && !a.manualOffline);
      const healths = await Promise.all(n8nAccounts.map((a) => checkN8nHealth(a.url, a.apiKey)));
      let anyConnected = false;
      let firstVersion = "unknown";
      let firstUrl = "";
      let changed = false;
      n8nAccounts.forEach((acc, i) => {
        const h = healths[i];
        if (h.connected) {
          anyConnected = true;
          if (!firstUrl) {
            firstUrl = acc.url;
            firstVersion = h.version;
          }
        }
        const newStatus = h.connected ? "online" : "offline";
        if (acc.status !== newStatus) {
          acc.status = newStatus;
          changed = true;
        }
      });
      if (changed) store.save();

      // No n8n accounts registered yet: fall back to the configured default URL.
      if (accounts.filter((a) => a.channel === "n8n").length === 0) {
        const health = await checkN8nHealth(cfg.n8nBaseUrl, cfg.n8nApiKey);
        anyConnected = health.connected;
        firstVersion = health.version;
        firstUrl = cfg.n8nBaseUrl;
      }

      const activeCount = projects.filter((p) => p.status === "online").length;
      const connectedAccCount = accounts.filter((a) => a.status === "online").length;

      let sqliteStatus: "connected" | "fallback_local" | "disabled" = "fallback_local";
      const sqlitePath =
        cfg.sqlitePath ||
        path.join(process.env.USERPROFILE || process.env.HOME || "", ".n8n", "database.sqlite");
      if (fs.existsSync(sqlitePath)) {
        sqliteStatus = "connected";
      }

      return {
        n8nConnected: anyConnected,
        n8nBaseUrl: firstUrl || cfg.n8nBaseUrl,
        n8nVersion: firstVersion,
        activeProjectsCount: activeCount,
        totalMessagesCount: store.getTotalMessagesCount(),
        connectedAccountsCount: connectedAccCount,
        lastSyncTime: new Date().toISOString(),
        sqliteStatus,
      };
    },

    sync_n8n: async (input) => {
      const cfg = store.getConfig();
      let accountsToSync: Account[] = [];

      if (input?.accountId) {
        const acc = store.getAccountById(input.accountId);
        if (acc) {
          accountsToSync = [acc];
        } else {
          return {
            ok: false,
            syncedProjects: 0,
            syncedMessages: 0,
            error: `Аккаунт с id '${input.accountId}' не найден`,
          };
        }
      } else {
        accountsToSync = store.getAccounts().filter((a) => a.channel === "n8n" && !a.manualOffline);
        if (accountsToSync.length === 0) {
          const targetUrl = input?.n8nBaseUrl || cfg.n8nBaseUrl;
          const apiKey = input?.apiKey || cfg.n8nApiKey;
          const health = await checkN8nHealth(targetUrl, apiKey);
          return {
            ok: health.connected,
            syncedProjects: store.getProjects().length,
            syncedMessages: store.getTotalMessagesCount(),
            error: health.connected ? undefined : `n8n не отвечает на ${targetUrl}`,
          };
        }
      }

      let totalSyncedProjects = 0;
      const errors: string[] = [];

      for (const acc of accountsToSync) {
        const targetUrl = input?.n8nBaseUrl || acc.url || cfg.n8nBaseUrl;
        const apiKey = input?.apiKey || acc.apiKey || cfg.n8nApiKey;

        const result = await fetchN8nWorkflowsAndExecutions(targetUrl, apiKey);
        if (result.ok) {
          const count = store.syncWorkflows(
            acc,
            result.workflows,
            result.executions.length,
            result.executions
          );
          totalSyncedProjects += count;
        } else {
          const health = await checkN8nHealth(targetUrl, apiKey);
          acc.status = health.connected ? "online" : "offline";
          acc.lastSync = new Date().toISOString();
          store.save();
          errors.push(`[${acc.name}] ${result.error || "Недоступен"}`);
        }
      }

      const ok = errors.length < accountsToSync.length;
      return {
        ok,
        syncedProjects: totalSyncedProjects || store.getProjects().length,
        syncedMessages: store.getTotalMessagesCount(),
        error: errors.length > 0 ? errors.join("; ") : undefined,
      };
    },

    toggle_ai: async (input) => {
      const updated = store.toggleAi(input.projectId, input.aiActive);
      return {
        ok: !!updated,
        project: updated,
      };
    },

    mark_as_read: async (input) => {
      store.markAsRead(input.projectId);
      return { ok: true };
    },

    create_project: async (input) => {
      const project = store.createProject({
        ...input,
        workflowId: input.workflowId || undefined,
      });
      return {
        ok: true,
        project,
      };
    },

    delete_project: async (input) => {
      const ok = store.deleteProject(input.projectId);
      return { ok };
    },

    toggle_project_status: async (input) => {
      const project = store.toggleProjectStatus(input.projectId, input.status);
      return {
        ok: !!project,
        project,
      };
    },

    ping_instance: async ({ accountId }) => {
      const acc = store.getAccountById(accountId);
      if (!acc) return { ok: false, status: "offline" as const, latencyMs: 0, error: "Инстанс не найден" };
      const start = Date.now();
      try {
        const health = await checkN8nHealth(acc.url, acc.apiKey, true);
        const latencyMs = Date.now() - start;
        acc.status = health.connected ? "online" : "offline";
        acc.latencyMs = latencyMs;
        acc.lastSync = new Date().toISOString();
        store.save();
        return {
          ok: health.connected,
          status: (health.connected ? "online" : "offline") as "online" | "offline",
          latencyMs,
          version: health.version,
          error: health.connected ? undefined : "Connection failed",
        };
      } catch (err: any) {
        acc.status = "offline";
        store.save();
        return { ok: false, status: "offline" as const, latencyMs: Date.now() - start, error: err?.message };
      }
    },

    get_workflows: async ({ accountId }) => {
      const acc = store.getAccountById(accountId);
      if (!acc) return { ok: false, workflows: [], error: "Инстанс не найден" };
      try {
        const res = await fetchN8nWorkflowsAndExecutions(acc.url, acc.apiKey);
        if (res.ok) {
          const workflows = res.workflows.map((w: any) => {
            const exec = res.executions.find((e: any) => e.workflowId === w.id);
            return {
              id: w.id,
              name: w.name,
              active: w.active,
              tags: w.tags?.map((t: any) => (typeof t === "string" ? t : t.name)) || [],
              updatedAt: w.updatedAt,
              lastExecution: exec
                ? {
                    id: exec.id,
                    status: (exec.status === "success" || exec.status === "error" || exec.status === "running")
                      ? exec.status
                      : "running",
                    startedAt: exec.startedAt,
                    durationMs: exec.durationMs,
                  }
                : undefined,
            };
          });
          return { ok: true, workflows };
        }
        // Fallback to cached projects if n8n is offline
        const cached = store.getProjects(accountId).map((p) => ({
          id: p.workflowId || p.id,
          name: p.name,
          active: p.status === "online",
          tags: p.tags,
        }));
        return { ok: true, workflows: cached, error: res.error };
      } catch (err: any) {
        return { ok: false, workflows: [], error: err?.message };
      }
    },

    get_executions: async ({ accountId, workflowId }) => {
      const acc = store.getAccountById(accountId);
      if (!acc) return { ok: false, executions: [], error: "Инстанс не найден" };
      try {
        const res = await fetchN8nWorkflowsAndExecutions(acc.url, acc.apiKey);
        let execs = res.executions;
        if (workflowId) {
          execs = execs.filter((e: any) => e.workflowId === workflowId);
        }
        return { ok: true, executions: execs };
      } catch (err: any) {
        return { ok: false, executions: [], error: err?.message };
      }
    },

    dispatch_webhook: async ({ accountId, path: webhookPath, method = "POST", payload }) => {
      const acc = store.getAccountById(accountId);
      if (!acc) return { ok: false, error: "Инстанс не найден" };
      const targetUrl = buildSafeWebhookUrl(acc.url, webhookPath);
      if (!targetUrl) {
        return { ok: false, error: "Недопустимый путь вебхука: путь должен находиться внутри /webhook/" };
      }
      const start = Date.now();
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const res = await fetch(targetUrl, {
          method,
          headers,
          body: method === "POST" ? JSON.stringify(payload || {}) : undefined,
          signal: AbortSignal.timeout(10000),
          redirect: "manual",
        });
        const durationMs = Date.now() - start;
        if (res.status >= 300 && res.status < 400) {
          return { ok: false, statusCode: res.status, durationMs, error: "HTTP перенаправления запрещены для вебхуков" };
        }
        const responseData = await res.json().catch(() => ({ statusText: res.statusText }));
        return {
          ok: res.ok,
          statusCode: res.status,
          durationMs,
          response: responseData,
          error: res.ok ? undefined : `HTTP ${res.status}: ${res.statusText}`,
        };
      } catch (err: any) {
        return { ok: false, durationMs: Date.now() - start, error: err?.message || "Ошибка вызова вебхука" };
      }
    },

    start_local_server: async () => {
      return await startLocalN8nProcess();
    },

    stop_local_server: async () => {
      return await stopLocalN8nProcess();
    },

    get_local_server_status: async () => {
      const health = await checkN8nHealth("http://127.0.0.1:5678", undefined, true);
      const isManaged = Boolean(localN8nProcess !== null && !localN8nProcess.killed);
      const activePid = localN8nProcess?.pid || (health.connected ? findPortPid(5678) : undefined);
      return {
        ok: true,
        running: health.connected,
        managedByPlugin: isManaged,
        pid: activePid ?? undefined,
        logs: serverLogs.slice(-50),
      };
    },

    send_ai_chat: async ({ accountId, message, sessionId, model = "gemini-3.8-flash-acp" }) => {
      const activeAccount = accountId ? store.getAccountById(accountId) : store.getAccounts()[0];
      const targetUrl = buildSafeWebhookUrl(activeAccount?.url || "http://localhost:5678", "ai-chat");
      const effectiveSessionId = sessionId || `session-${Date.now()}`;
      const start = Date.now();
      const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      // Save user message to persistent history
      const userMsg: ChatMessage = {
        id: `ai-msg-user-${Date.now()}`,
        projectId: "proj-n8n-gemini-chat",
        sender: "user",
        senderName: "Вы (Оператор)",
        text: message,
        timestamp: nowStr,
        status: "sent",
      };
      store.addMessage(userMsg);

      let reply = "";
      let latencyMs = 0;
      let errText: string | null = null;

      try {
        if (!targetUrl) throw new Error("Не удалось сформировать адрес ai-chat вебхука");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const res = await fetch(targetUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            message,
            prompt: message,
            sessionId: effectiveSessionId,
            model,
          }),
          signal: AbortSignal.timeout(45000),
          redirect: "manual",
        });

        latencyMs = Date.now() - start;
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as any;
          reply = data.reply || data.output || data.message || "Ответ получен от n8n AI Агента";
        } else {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        // Save assistant message to persistent history on success
        const aiMsg: ChatMessage = {
          id: `ai-msg-gemini-${Date.now()}`,
          projectId: "proj-n8n-gemini-chat",
          sender: "agent",
          senderName: "Gemini 3.8 Flash",
          text: reply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          status: "delivered",
          metadata: {
            workflowName: "AI Chat Agent (Gemini 3.8 Flash ACP)",
            durationMs: latencyMs,
            status: "success",
          },
        };
        store.addMessage(aiMsg);

        return {
          ok: true,
          reply,
          model,
          latencyMs,
          error: null,
        };
      } catch (err: any) {
        latencyMs = Date.now() - start;
        errText = err?.message || "Ошибка связи с n8n AI Webhook";
        return {
          ok: false,
          reply: "",
          model,
          latencyMs,
          error: errText,
        };
      }
    },

    get_ai_chat_history: async () => {
      return {
        ok: true,
        messages: store.getMessages("proj-n8n-gemini-chat"),
      };
    },

    clear_ai_chat_history: async () => {
      store.clearMessages("proj-n8n-gemini-chat");
      return {
        ok: true,
      };
    },
  }));

  // 2. REGISTER CLI COMMAND
  bb.cli.register({
    name: "project-hub",
    summary: "Monitor n8n multi-instance project workflows and trigger commands",
    commands: [
      {
        name: "status",
        summary: "Display n8n hub health, local server, and active accounts",
        usage: "bb project-hub status",
      },
      {
        name: "server",
        summary: "Manage local n8n server process (status, start, stop)",
        usage: "bb project-hub server [status|start|stop]",
      },
      {
        name: "accounts",
        summary: "List all connected n8n instances and gateways",
        usage: "bb project-hub accounts",
      },
      {
        name: "workflows",
        summary: "List workflows for an instance",
        usage: "bb project-hub workflows [accountId]",
      },
      {
        name: "webhook",
        summary: "Dispatch a webhook payload to n8n",
        usage: "bb project-hub webhook <path> [jsonPayload]",
      },
      {
        name: "sync",
        summary: "Trigger a workflow sync from n8n",
        usage: "bb project-hub sync [accountId]",
      },
      {
        name: "list",
        summary: "List all active projects with unread counts",
        usage: "bb project-hub list",
      },
      {
        name: "send",
        summary: "Send a message or command into a project workflow",
        usage: "bb project-hub send <projectId> <command>",
      },
    ],
    run: async (argv) => {
      const sub = argv[0];
      const args = argv.slice(1);

      if (sub === "status") {
        const cfg = store.getConfig();
        const health = await checkN8nHealth(cfg.n8nBaseUrl);
        const localHealth = await checkN8nHealth("http://127.0.0.1:5678", true);
        const projects = store.getProjects();
        const accounts = store.getAccounts();
        const isManaged = Boolean(localN8nProcess !== null && !localN8nProcess.killed);
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            {
              // Compatibility fields
              connectedAccounts: accounts.filter((a) => a.status === "online").length,
              projects: projects.length,
              messagesTotal: store.getTotalMessagesCount(),
              // Detailed status fields
              n8nConnected: health.connected,
              n8nBaseUrl: cfg.n8nBaseUrl,
              n8nVersion: health.version,
              connectedAccountsCount: accounts.filter((a) => a.status === "online").length,
              totalAccountsCount: accounts.length,
              activeProjectsCount: projects.length,
              totalMessagesCount: store.getTotalMessagesCount(),
              localServerRunning: isManaged || localHealth.connected,
              localServerPid: localN8nProcess?.pid || (localHealth.connected ? findPortPid(5678) : null),
            },
            null,
            2
          ),
        };
      }

      if (sub === "server") {
        const action = args[0] || "status";
        if (action === "status") {
          const health = await checkN8nHealth("http://127.0.0.1:5678", undefined, true);
          const isManaged = Boolean(localN8nProcess !== null && !localN8nProcess.killed);
          return {
            exitCode: 0,
            stdout: `Локальный n8n: ${health.connected ? (isManaged ? "В СЕТИ (PID: " + localN8nProcess?.pid + ")" : "В СЕТИ (внешний процесс)") : "ОСТАНОВЛЕН"} | http://127.0.0.1:5678`,
          };
        }
        if (action === "start") {
          const res = await startLocalN8nProcess();
          return { exitCode: res.ok ? 0 : 1, stdout: res.message, stderr: res.ok ? undefined : res.message };
        }
        if (action === "stop") {
          const res = await stopLocalN8nProcess();
          return { exitCode: res.ok ? 0 : 1, stdout: res.message, stderr: res.ok ? undefined : res.message };
        }
        return { exitCode: 1, stderr: "Usage: bb project-hub server [status|start|stop]" };
      }

      if (sub === "workflows") {
        const accountId = args[0] || store.getAccounts()[0]?.id;
        const acc = store.getAccountById(accountId);
        if (!acc) return { exitCode: 1, stderr: `Аккаунт '${accountId}' не найден` };
        const res = await fetchN8nWorkflowsAndExecutions(acc.url, acc.apiKey);
        if (!res.ok) return { exitCode: 1, stderr: res.error || "Не удалось загрузить воркфлоу" };
        const lines = res.workflows.map((w: any) => `[${w.id}] ${w.name} (${w.active ? "АКТИВЕН" : "ПАУЗА"})`);
        return { exitCode: 0, stdout: lines.length > 0 ? lines.join("\n") : "Воркфлоу не найдены" };
      }

      if (sub === "webhook") {
        const webhookPath = args[0];
        const payloadStr = args.slice(1).join(" ").trim();
        if (!webhookPath) return { exitCode: 1, stderr: "Usage: bb project-hub webhook <path> [jsonPayload]" };
        const accounts = store.getAccounts();
        if (accounts.length === 0) return { exitCode: 1, stderr: "Нет доступных аккаунтов" };
        const acc = accounts[0];
        const targetUrl = buildSafeWebhookUrl(acc.url, webhookPath);
        if (!targetUrl) return { exitCode: 1, stderr: "Недопустимый путь вебхука: путь должен находиться внутри /webhook/" };
        let payload = {};
        if (payloadStr) {
          try {
            payload = JSON.parse(payloadStr);
          } catch {
            payload = { text: payloadStr };
          }
        }
        try {
          const res = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            redirect: "manual",
            signal: AbortSignal.timeout(45000),
          });
          if (res.status >= 300 && res.status < 400) {
            return { exitCode: 1, stderr: "HTTP перенаправления запрещены для вебхуков" };
          }
          const text = await res.text();
          return { exitCode: res.ok ? 0 : 1, stdout: `HTTP ${res.status}: ${text}` };
        } catch (err: any) {
          return { exitCode: 1, stderr: `Ошибка вызова вебхука: ${err?.message}` };
        }
      }

      if (sub === "sync") {
        const accId = args[0] || store.getAccounts()[0]?.id;
        const acc = store.getAccountById(accId);
        if (!acc) return { exitCode: 1, stderr: `Аккаунт '${accId}' не найден` };
        const res = await fetchN8nWorkflowsAndExecutions(acc.url, acc.apiKey);
        if (res.ok) {
          const count = store.syncWorkflows(acc, res.workflows, res.executions.length, res.executions);
          return { exitCode: 0, stdout: `Синхронизировано: ${count} воркфлоу, ${res.executions.length} запусков` };
        }
        return { exitCode: 1, stderr: res.error || "Ошибка синхронизации" };
      }

      if (sub === "accounts") {
        const accounts = store.getAccounts();
        const lines = accounts.map(
          (a) => `[${a.id}] ${a.name} (${a.channel}) | ${a.status} | URL: ${a.url} | Workflows: ${a.workflowsCount}`
        );
        return { exitCode: 0, stdout: lines.join("\n") };
      }

      if (sub === "list") {
        const projects = store.getProjects();
        const lines = projects.map(
          (p) => `[${p.id}] (acc: ${p.accountId}) ${p.name} | ${p.status} | unread: ${p.unreadCount} | last: ${p.lastMessagePreview}`
        );
        return { exitCode: 0, stdout: lines.join("\n") };
      }

      if (sub === "send") {
        const projectId = args[0];
        const text = args.slice(1).join(" ").trim();
        if (!projectId || !text) {
          return { exitCode: 1, stderr: "Usage: bb project-hub send <projectId> <command>" };
        }
        const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        store.addMessage({
          id: `msg-${Date.now()}`,
          projectId,
          accountId: store.getProjectById(projectId)?.accountId,
          sender: "user",
          senderName: "CLI",
          text,
          timestamp: timeStr,
          status: "sent",
          metadata: {
            workflowName: "cli_command",
            status: "running",
          },
        });

        const n8nResult = await forwardToN8n(store, projectId, text, "command");
        if (n8nResult.ok && n8nResult.reply) {
          store.addMessage({
            id: `msg-${Date.now()}-reply`,
            projectId,
            accountId: store.getProjectById(projectId)?.accountId,
            sender: "agent",
            senderName: "n8n AI Agent",
            text: n8nResult.reply,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            status: "delivered",
            metadata: {
              workflowName: "cli_reply",
              status: "success",
            },
          });
          return {
            exitCode: 0,
            stdout: `Command dispatched to ${projectId}: "${text}"\nResponse: ${n8nResult.reply}`,
          };
        }

        return {
          exitCode: 0,
          stdout: `Command dispatched to ${projectId}: "${text}" (Warning: ${
            n8nResult.error || "no remote reply"
          })`,
        };
      }

      return { exitCode: 0, stdout: "Usage: bb project-hub [status|accounts|list|send]" };
    },
  });

  // 3. REGISTER AGENT TOOLS
  bb.agents.registerTool({
    name: "project_hub_list_accounts",
    description: "Returns list of all registered n8n instances and gateways with their statuses.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const masked = store.getAccounts().map(maskAccount);
      return JSON.stringify(masked, null, 2);
    },
  });

  bb.agents.registerTool({
    name: "project_hub_list_projects",
    description: "Returns list of all monitored projects and workflows with unread status and last messages.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      return JSON.stringify(store.getProjects(), null, 2);
    },
  });

  bb.agents.registerTool({
    name: "project_hub_get_messages",
    description: "Returns recent messages and workflow log context for a given project ID.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "ID of the project, from project_hub_list_projects" },
      },
      required: ["projectId"],
    },
    execute: async (args: any) => {
      const msgs = store.getMessages(args.projectId);
      return JSON.stringify(msgs, null, 2);
    },
  });

  bb.agents.registerTool({
    name: "project_hub_send_message",
    description: "Sends a direct message or command into a project workflow (n8n / webhook).",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "ID of the target project" },
        text: { type: "string", description: "Message content or command to execute" },
        mode: { type: "string", enum: ["command", "message"], description: "Send mode" },
      },
      required: ["projectId", "text"],
    },
    execute: async (args: any) => {
      const mode = args.mode || "command";
      const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const msg: ChatMessage = {
        id: `msg-${Date.now()}`,
        projectId: args.projectId,
        accountId: store.getProjectById(args.projectId)?.accountId,
        sender: "user",
        senderName: "AI Assistant",
        text: args.text,
        timestamp: timeStr,
        status: "sent",
        metadata: {
          workflowName: "agent_command",
          status: "running",
        },
      };
      store.addMessage(msg);

      const n8nResult = await forwardToN8n(store, args.projectId, args.text, mode);
      if (n8nResult.ok && n8nResult.reply) {
        store.addMessage({
          id: `msg-${Date.now()}-reply`,
          projectId: args.projectId,
          accountId: store.getProjectById(args.projectId)?.accountId,
          sender: "agent",
          senderName: "n8n AI Agent",
          text: n8nResult.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          status: "delivered",
          metadata: {
            workflowName: "agent_reply",
            status: "success",
          },
        });
        return `Dispatched to ${args.projectId}. Execution result: "${n8nResult.reply}"`;
      }

      return `Message sent to ${args.projectId}: "${args.text}" (Remote result: ${
        n8nResult.error || "queued"
      })`;
    },
  });

  bb.agents.registerTool({
    name: "project_hub_get_workflows",
    description: "Returns list of workflows for an n8n account (id, name, active status, last execution).",
    parameters: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Optional n8n account ID. Defaults to master local n8n." },
      },
    },
    execute: async (args: any) => {
      const accId = args?.accountId || store.getAccounts()[0]?.id;
      const acc = store.getAccountById(accId);
      if (!acc) return JSON.stringify({ ok: false, error: "Account not found" });
      const res = await fetchN8nWorkflowsAndExecutions(acc.url, acc.apiKey);
      return JSON.stringify(res, null, 2);
    },
  });

  bb.agents.registerTool({
    name: "project_hub_get_executions",
    description: "Returns execution history and logs for an n8n account or specific workflow.",
    parameters: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Optional n8n account ID." },
        workflowId: { type: "string", description: "Optional workflow ID to filter executions." },
      },
    },
    execute: async (args: any) => {
      const accId = args?.accountId || store.getAccounts()[0]?.id;
      const acc = store.getAccountById(accId);
      if (!acc) return JSON.stringify({ ok: false, error: "Account not found" });
      const res = await fetchN8nWorkflowsAndExecutions(acc.url, acc.apiKey);
      if (!res.ok) return JSON.stringify(res, null, 2);
      let execs = res.executions;
      if (args?.workflowId) {
        execs = execs.filter((e: any) => String(e.workflowId) === String(args.workflowId));
      }
      return JSON.stringify({ ok: true, executions: execs }, null, 2);
    },
  });

  bb.agents.registerTool({
    name: "project_hub_dispatch_webhook",
    description: "Triggers an n8n webhook workflow with a JSON payload (POST/GET). Restricted to whitelisted test/project prefixes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Webhook path (e.g. 'test-webhook' or '/webhook/test-webhook')" },
        payload: { type: "object", description: "JSON payload dictionary to send in POST request body" },
        method: { type: "string", enum: ["POST", "GET"], description: "HTTP method" },
        accountId: { type: "string", description: "Optional n8n account ID" },
      },
      required: ["path"],
    },
    execute: async (args: any) => {
      const accId = args?.accountId || store.getAccounts()[0]?.id;
      const acc = store.getAccountById(accId);
      if (!acc) return JSON.stringify({ ok: false, error: "Account not found" });
      const targetUrl = buildSafeWebhookUrl(acc.url, args.path);
      if (!targetUrl) {
        return JSON.stringify({
          ok: false,
          error: "Недопустимый путь вебхука: путь содержит недопустимые символы (..) или выходит за пределы /webhook/",
        });
      }
      const parsedUrl = new URL(targetUrl);
      // Security: Whitelist check with strict boundary checks
      const allowedPrefixes = ["/webhook/test/", "/webhook/test", "/webhook-test/", "/webhook/api/projects/"];
      const isWhitelisted = allowedPrefixes.some((p) =>
        parsedUrl.pathname === p || parsedUrl.pathname.startsWith(p.endsWith("/") ? p : p + "/")
      );
      if (!isWhitelisted) {
        return JSON.stringify({
          ok: false,
          error: `Доступ запрещён: путь '${parsedUrl.pathname}' не входит в белый список для агентов (${allowedPrefixes.join(", ")}). Произвольные вебхуки запускаются только вручную оператором.`,
        });
      }
      const method = args.method || "POST";
      const start = Date.now();
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const res = await fetch(targetUrl, {
          method,
          headers,
          body: method === "POST" ? JSON.stringify(args.payload || {}) : undefined,
          signal: AbortSignal.timeout(10000),
          redirect: "manual",
        });
        const durationMs = Date.now() - start;
        if (res.status >= 300 && res.status < 400) {
          return JSON.stringify({ ok: false, statusCode: res.status, durationMs, error: "HTTP перенаправления запрещены для вебхуков" }, null, 2);
        }
        const data = await res.json().catch(() => ({ statusText: res.statusText }));
        return JSON.stringify({ ok: res.ok, statusCode: res.status, durationMs, response: data }, null, 2);
      } catch (err: any) {
        return JSON.stringify({ ok: false, durationMs: Date.now() - start, error: err?.message }, null, 2);
      }
    },
  });

  bb.agents.registerTool({
    name: "project_hub_server_status",
    description: "Returns the status (running/offline), PID, and recent logs of the local n8n server.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const health = await checkN8nHealth("http://127.0.0.1:5678", undefined, true);
      const isManaged = Boolean(localN8nProcess !== null && !localN8nProcess.killed);
      return JSON.stringify(
        {
          running: health.connected,
          managedByPlugin: isManaged,
          pid: localN8nProcess?.pid || null,
          url: "http://127.0.0.1:5678",
          recentLogs: serverLogs.slice(-20),
        },
        null,
        2
      );
    },
  });

  bb.agents.registerTool({
    name: "project_hub_manage_server",
    description: "Inspects status or starts the local n8n server. Stopping is restricted to the human operator via UI.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "status"], description: "Action to perform ('start' or 'status')" },
      },
      required: ["action"],
    },
    execute: async (args: any) => {
      if (args.action === "status") {
        const health = await checkN8nHealth("http://127.0.0.1:5678", undefined, true);
        const isManaged = Boolean(localN8nProcess !== null && !localN8nProcess.killed);
        return JSON.stringify(
          {
            running: health.connected,
            managedByPlugin: isManaged,
            pid: localN8nProcess?.pid || null,
            url: "http://127.0.0.1:5678",
          },
          null,
          2
        );
      }
      if (args.action === "start") {
        const res = await startLocalN8nProcess();
        return JSON.stringify(res, null, 2);
      }
      return "Действие не разрешено: остановка сервера доступна только оператору через кнопку в UI";
    },
  });

  bb.agents.registerTool({
    name: "project_hub_sync",
    description: "Triggers a full sync of workflows and executions from n8n instances into Project Hub.",
    parameters: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Optional n8n account ID to sync." },
      },
    },
    execute: async (args: any) => {
      const accId = args?.accountId || store.getAccounts()[0]?.id;
      const acc = store.getAccountById(accId);
      if (!acc) return JSON.stringify({ ok: false, error: "Account not found" });
      const res = await fetchN8nWorkflowsAndExecutions(acc.url, acc.apiKey);
      if (res.ok) {
        const count = store.syncWorkflows(acc, res.workflows, res.executions.length, res.executions);
        return JSON.stringify({ ok: true, syncedWorkflows: count, totalExecutions: res.executions.length }, null, 2);
      }
      return JSON.stringify({ ok: false, error: res.error }, null, 2);
    },
  });

  bb.agents.configure((_context) => ({
    tools: [
      "project_hub_list_accounts",
      "project_hub_list_projects",
      "project_hub_get_messages",
      "project_hub_send_message",
      "project_hub_get_workflows",
      "project_hub_get_executions",
      "project_hub_dispatch_webhook",
      "project_hub_server_status",
      "project_hub_manage_server",
      "project_hub_sync",
    ],
    skills: ["n8n"],
    instructions:
      "n8n automation & workflow tools are available. Use `project_hub_list_accounts` to inspect instances, `project_hub_get_workflows` to list workflows, `project_hub_dispatch_webhook` to trigger webhooks, and `project_hub_manage_server` to check status or start the local n8n server.",
  }));
}
