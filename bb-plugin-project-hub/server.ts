import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Account, Project, ChatMessage, HubStatus } from "./src/types";

// ESM has no __dirname - the plugin server crashes on load without this shim
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- RPC CONTRACT SCHEMAS ---
const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  channel: z.enum(["n8n", "telegram", "webhook"]),
  url: z.string(),
  apiKey: z.string().optional(),
  status: z.enum(["online", "syncing", "offline"]),
  manualOffline: z.boolean().optional(),
  workflowsCount: z.number(),
  executionsCount: z.number(),
  unreadTotal: z.number(),
  lastSync: z.string(),
  createdAt: z.string(),
});

const projectSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  channel: z.enum(["n8n", "telegram", "webhook"]),
  status: z.enum(["online", "idle", "offline"]),
  workflowId: z.string().optional(),
  unreadCount: z.number(),
  lastMessageTime: z.string(),
  lastMessagePreview: z.string(),
  aiActive: z.boolean(),
  tags: z.array(z.string()),
});

const chatMessageSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  accountId: z.string().optional(),
  sender: z.enum(["system", "agent", "user", "webhook"]),
  senderName: z.string(),
  text: z.string(),
  timestamp: z.string(),
  status: z.enum(["sent", "delivered", "read"]),
  metadata: z
    .object({
      workflowName: z.string().optional(),
      executionId: z.string().optional(),
      status: z.enum(["success", "running", "error"]).optional(),
      durationMs: z.number().optional(),
      payload: z.record(z.unknown()).optional(),
    })
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
      apiKey: z.string().optional(),
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
      account: accountSchema.optional(),
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
      error: z.string().optional(),
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
        apiKey: z.string().optional(),
      })
      .optional(),
    output: z.object({
      ok: z.boolean(),
      syncedProjects: z.number(),
      syncedMessages: z.number(),
      error: z.string().optional(),
    }),
  },
  toggle_ai: {
    input: z.object({
      projectId: z.string(),
      aiActive: z.boolean(),
    }),
    output: z.object({
      ok: z.boolean(),
      project: projectSchema.optional(),
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
      workflowId: z.string().optional(),
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
      project: projectSchema.optional(),
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

class HubStore {
  private storeFile: string;
  private data: StoreData;

  constructor(storageDir: string) {
    if (!fs.existsSync(storageDir)) {
      try {
        fs.mkdirSync(storageDir, { recursive: true });
      } catch {
        // ignore
      }
    }
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
      fs.writeFileSync(this.storeFile, JSON.stringify(data || this.data, null, 2), "utf-8");
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

// Single-pass n8n probe: tries health/version endpoints in parallel, first OK wins.
// Never falls back to 127.0.0.1 for a remote baseUrl - a remote instance must not
// report "connected" (or receive commands) because a local n8n happens to answer.
async function probeN8n(
  baseUrl: string,
  apiKey?: string
): Promise<{ connected: boolean; version: string }> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (apiKey) headers["X-N8N-API-KEY"] = apiKey;

  const bases = new Set<string>([cleanBase]);
  if (isLocalUrl(cleanBase)) {
    bases.add(cleanBase.replace("localhost", "127.0.0.1"));
    bases.add(cleanBase.replace("127.0.0.1", "localhost"));
  }

  const urls: string[] = [];
  for (const b of bases) {
    urls.push(`${b}/healthz`, `${b}/api/v1/version`, `${b}/rest/settings`, b);
  }

  const probeOne = async (url: string): Promise<{ version: string } | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers });
      if (!res.ok) return null;
      let version = res.headers.get("x-n8n-version") || res.headers.get("x-version") || "";
      try {
        const data = (await res.json()) as any;
        if (data?.version) version = String(data.version);
        else if (data?.n8nVersion) version = String(data.n8nVersion);
      } catch {
        // not json - header version or "unknown" is fine
      }
      return { version: version || "unknown" };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  const results = await Promise.all(urls.map(probeOne));
  // prefer a hit that actually carries a version over a bare /healthz OK
  const hit = results.find((r) => r && r.version !== "unknown") || results.find((r) => r !== null);
  return hit ? { connected: true, version: hit.version } : { connected: false, version: "unknown" };
}

// Cached health check: the UI polls get_status every few seconds, probing must not
// block the poll or hammer the instance. TTL keeps answers fresh without overlap.
const HEALTH_TTL_MS = 15000;
const healthCache = new Map<string, { connected: boolean; version: string; at: number }>();

async function checkN8nHealth(
  baseUrl: string,
  apiKey?: string
): Promise<{ connected: boolean; version: string }> {
  const key = `${baseUrl}|${apiKey || ""}`;
  const cached = healthCache.get(key);
  if (cached && Date.now() - cached.at < HEALTH_TTL_MS) {
    return { connected: cached.connected, version: cached.version };
  }
  const result = await probeN8n(baseUrl, apiKey);
  healthCache.set(key, { ...result, at: Date.now() });
  return result;
}

// Fetch workflows and executions from n8n REST API
async function fetchN8nWorkflowsAndExecutions(
  baseUrl: string,
  apiKey?: string
): Promise<{ ok: boolean; workflows: any[]; executions: any[]; error?: string }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers["X-N8N-API-KEY"] = apiKey;
  }

  const cleanBase = baseUrl.replace(/\/+$/, "");

  try {
    const wfController = new AbortController();
    const wfTimeout = setTimeout(() => wfController.abort(), 4000);
    const wfRes = await fetch(`${cleanBase}/api/v1/workflows`, {
      headers,
      signal: wfController.signal,
    });
    clearTimeout(wfTimeout);

    if (!wfRes.ok) {
      return {
        ok: false,
        workflows: [],
        executions: [],
        error: `HTTP ${wfRes.status} from ${cleanBase}/api/v1/workflows`,
      };
    }

    const wfData = (await wfRes.json()) as any;
    const workflows = Array.isArray(wfData?.data)
      ? wfData.data
      : Array.isArray(wfData)
      ? wfData
      : [];

    let executions: any[] = [];
    try {
      const exController = new AbortController();
      const exTimeout = setTimeout(() => exController.abort(), 4000);
      const exRes = await fetch(`${cleanBase}/api/v1/executions?limit=20`, {
        headers,
        signal: exController.signal,
      });
      clearTimeout(exTimeout);

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

    return { ok: true, workflows, executions };
  } catch (err: any) {
    return {
      ok: false,
      workflows: [],
      executions: [],
      error: err?.message || `Failed to connect to ${cleanBase}`,
    };
  }
}

// Forward command or trigger to n8n webhook, telegram or webhook channel
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
  const apiKey = account?.apiKey || cfg.n8nApiKey;

  if (channel === "webhook") {
    const targetUrl = account?.url || cfg.n8nBaseUrl;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["X-N8N-API-KEY"] = apiKey;

      const res = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          projectId,
          command,
          mode,
          timestamp: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["X-N8N-API-KEY"] = apiKey;

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
        signal: controller.signal,
      });
      clearTimeout(timeout);
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
    // local convenience only: try the other loopback spelling too
    const alt = cleanBase.includes("localhost")
      ? cleanBase.replace("localhost", "127.0.0.1")
      : cleanBase.replace("127.0.0.1", "localhost");
    if (alt !== cleanBase) endpoints.push(`${alt}${webhookPath}`);
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-N8N-API-KEY"] = apiKey;

  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(ep, {
        method: "POST",
        headers,
        body: JSON.stringify({
          projectId,
          command,
          mode,
          timestamp: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

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
  const storePath = path.join(__dirname, "data");
  const store = new HubStore(storePath);

  // 1. REGISTER RPC IMPLEMENTATIONS
  bb.rpc.register(rpcContract, {
    get_accounts: async () => {
      return {
        ok: true,
        accounts: store.getAccounts(),
      };
    },

    create_account: async (input) => {
      const acc = store.addAccount(input);
      return {
        ok: true,
        account: acc,
      };
    },

    disconnect_account: async (input) => {
      const acc = store.disconnectAccount(input.accountId);
      return {
        ok: !!acc,
        account: acc,
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
        ok: true,
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
          acc.status = "offline";
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
      const project = store.createProject(input);
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
  });

  // 2. REGISTER CLI COMMAND
  bb.cli.register({
    name: "project-hub",
    summary: "Monitor n8n multi-instance project workflows and trigger commands",
    commands: [
      {
        name: "status",
        summary: "Display n8n hub health and active accounts",
        usage: "bb project-hub status",
      },
      {
        name: "accounts",
        summary: "List all connected n8n instances and gateways",
        usage: "bb project-hub accounts",
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
        const health = await checkN8nHealth(cfg.n8nBaseUrl, cfg.n8nApiKey);
        const projects = store.getProjects();
        const accounts = store.getAccounts();
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            {
              n8nConnected: health.connected,
              n8nBaseUrl: cfg.n8nBaseUrl,
              n8nVersion: health.version,
              connectedAccounts: accounts.length,
              projects: projects.length,
              messagesTotal: store.getTotalMessagesCount(),
            },
            null,
            2
          ),
        };
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
      return JSON.stringify(store.getAccounts(), null, 2);
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

  bb.agents.configure((_context) => ({
    tools: [
      "project_hub_list_accounts",
      "project_hub_list_projects",
      "project_hub_get_messages",
      "project_hub_send_message",
    ],
    skills: [],
  }));
}
