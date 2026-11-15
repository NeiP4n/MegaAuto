import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Types & Schemas ---
export interface WhatsAppSessionInfo {
  id: string;
  name: string;
  phone: string;
  status: string;
  connected: boolean;
  qr: string;
  is_active: boolean;
}

export interface WhatsAppStatus {
  session_id?: string;
  running: boolean;
  connected: boolean;
  status: "connected" | "needs_scan" | "connecting" | "stopped" | "error";
  phone: string;
  qr: string;
  qrDataUrl: string | null;
  serverTime: string;
  error: string | null;
  sessions?: WhatsAppSessionInfo[];
}

export interface WhatsAppChat {
  jid: string;
  name: string;
  last_message_time: string;
  last_message: string;
  last_sender: string;
  last_is_from_me: boolean;
}

export interface WhatsAppMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name?: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  media_type: string;
  filename: string;
  url: string;
  file_length: number;
}

export interface WhatsAppContact {
  jid: string;
  name: string;
  phone_number: string;
}

// --- RPC Contract ---
export const rpcContract = defineRpcContract({
  get_status: {
    input: z.object({ session_id: z.string().optional() }).nullish(),
    output: z.object({
      session_id: z.string().optional(),
      running: z.boolean(),
      connected: z.boolean(),
      status: z.enum(["connected", "needs_scan", "connecting", "stopped", "error"]),
      phone: z.string(),
      qr: z.string(),
      qrDataUrl: z.string().nullable(),
      serverTime: z.string(),
      error: z.string().nullable(),
      sessions: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            phone: z.string(),
            status: z.string(),
            connected: z.boolean(),
            qr: z.string(),
            is_active: z.boolean(),
          })
        )
        .optional(),
    }),
  },
  get_sessions: {
    input: z.null().nullish(),
    output: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        phone: z.string(),
        status: z.string(),
        connected: z.boolean(),
        qr: z.string(),
        is_active: z.boolean(),
      })
    ),
  },
  create_session: {
    input: z.object({ name: z.string().optional() }).nullish(),
    output: z.object({
      success: z.boolean(),
      session: z
        .object({
          id: z.string(),
          name: z.string(),
          phone: z.string(),
          status: z.string(),
          connected: z.boolean(),
          qr: z.string(),
          is_active: z.boolean(),
        })
        .optional(),
      message: z.string().optional(),
    }),
  },
  switch_session: {
    input: z.object({ session_id: z.string() }),
    output: z.object({
      success: z.boolean(),
      active: z.string().optional(),
      message: z.string().optional(),
    }),
  },
  delete_session: {
    input: z.object({ session_id: z.string() }),
    output: z.object({
      success: z.boolean(),
      message: z.string().optional(),
    }),
  },
  start_bridge: {
    input: z.null(),
    output: z.object({ success: z.boolean(), message: z.string() }),
  },
  stop_bridge: {
    input: z.null(),
    output: z.object({ success: z.boolean(), message: z.string() }),
  },
  restart_bridge: {
    input: z.null(),
    output: z.object({ success: z.boolean(), message: z.string() }),
  },
  get_chats: {
    input: z.object({ query: z.string().optional(), session_id: z.string().optional() }).nullish(),
    output: z.array(
      z.object({
        jid: z.string(),
        name: z.string(),
        last_message_time: z.string(),
        last_message: z.string(),
        last_sender: z.string(),
        last_is_from_me: z.boolean(),
      })
    ),
  },
  get_messages: {
    input: z.object({ chat_jid: z.string(), limit: z.number().optional(), session_id: z.string().optional() }),
    output: z.array(
      z.object({
        id: z.string(),
        chat_jid: z.string(),
        sender: z.string(),
        sender_name: z.string().optional(),
        content: z.string(),
        timestamp: z.string(),
        is_from_me: z.boolean(),
        media_type: z.string(),
        filename: z.string(),
        url: z.string(),
        file_length: z.number(),
      })
    ),
  },
  send_message: {
    input: z.object({
      recipient: z.string().min(1),
      message: z.string(),
      media_path: z.string().optional(),
      session_id: z.string().optional(),
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string(),
      id: z.string().optional(),
      timestamp: z.string().optional(),
      chat_jid: z.string().optional(),
    }),
  },
  download_media: {
    input: z.object({
      message_id: z.string().min(1),
      chat_jid: z.string().min(1),
      session_id: z.string().optional(),
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string(),
      filename: z.string().optional(),
      path: z.string().optional(),
    }),
  },
  search_contacts: {
    input: z.object({ query: z.string(), session_id: z.string().optional() }),
    output: z.array(
      z.object({
        jid: z.string(),
        name: z.string(),
        phone_number: z.string(),
      })
    ),
  },
});

// --- Bridge Process Controller ---
class WhatsAppBridgeController {
  private process: ChildProcess | null = null;
  private bridgeDir: string;
  private bridgeExe: string;
  private lastError: string | null = null;
  private cachedQR: string = "";
  private cachedQRDataUrl: string | null = null;
  private stopRequested: boolean = false;

  constructor() {
    // Resolve bridge directory whether running from root or dist/
    const candidate1 = path.resolve(__dirname, "bridge");
    const candidate2 = path.resolve(__dirname, "..", "bridge");
    this.bridgeDir = fs.existsSync(path.join(candidate1, "whatsapp-bridge.exe"))
      ? candidate1
      : candidate2;
    this.bridgeExe = path.join(this.bridgeDir, "whatsapp-bridge.exe");
  }

  /** Check if something is already listening on the bridge port */
  private async isPortInUse(port = 8080): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
        signal: AbortSignal.timeout(500),
      });
      return res.ok || res.status > 0;
    } catch {
      return false;
    }
  }

  public async start(): Promise<boolean> {
    this.stopRequested = false;

    if (this.process && !this.process.killed) {
      return true;
    }

    if (!fs.existsSync(this.bridgeExe)) {
      this.lastError = `Bridge executable not found at: ${this.bridgeExe}`;
      return false;
    }

    // If port is already in use by another process, consider it running
    if (await this.isPortInUse()) {
      return true;
    }

    try {
      this.lastError = null;
      this.process = spawn(this.bridgeExe, [], {
        cwd: this.bridgeDir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: false,
      });

      this.process.stdout?.on("data", (_data: Buffer) => {
        // Bridge stdout – reserved for future structured logging
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        if (text.includes("ERROR") || text.includes("error")) {
          this.lastError = text.trim().slice(0, 512);
        }
      });

      this.process.on("error", (err: Error) => {
        this.lastError = `Bridge process error: ${err.message}`;
        this.process = null;
      });

      this.process.on("exit", (code: number | null) => {
        this.process = null;
        if (!this.stopRequested && code !== 0 && code !== null) {
          this.lastError = `Bridge exited unexpectedly with code ${code}`;
        }
      });

      // Wait up to 3 s for REST API to become reachable (15 × 200 ms)
      for (let i = 0; i < 15; i++) {
        await new Promise<void>((r) => setTimeout(r, 200));
        try {
          const res = await fetch("http://127.0.0.1:8080/api/status", {
            signal: AbortSignal.timeout(500),
          });
          if (res.ok) return true;
        } catch {
          // Not ready yet – keep polling
        }
      }
      return true;
    } catch (e: unknown) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  public async stop(): Promise<boolean> {
    this.stopRequested = true;
    if (this.process) {
      try {
        this.process.kill("SIGTERM");
      } catch {
        // If SIGTERM fails on Windows, try SIGKILL
        try {
          this.process.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      // Wait up to 2 s for clean exit
      await new Promise<void>((r) => setTimeout(r, 500));
      if (this.process && !this.process.killed) {
        try {
          this.process.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      this.process = null;
    }
    return true;
  }

  public async restart(): Promise<boolean> {
    await this.stop();
    await new Promise<void>((r) => setTimeout(r, 800));
    return this.start();
  }

  public async getSessions(): Promise<WhatsAppSessionInfo[]> {
    await this.ensureRunning();
    try {
      const res = await fetch("http://127.0.0.1:8080/api/sessions", {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return (await res.json()) as WhatsAppSessionInfo[];
      }
    } catch (e) {
      this.lastError = String(e);
    }
    return [];
  }

  public async createSession(name?: string): Promise<{ success: boolean; session?: WhatsAppSessionInfo; message?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch("http://127.0.0.1:8080/api/sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "" }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = (await res.json()) as { success: boolean; session?: WhatsAppSessionInfo };
        return { success: true, session: data.session };
      }
      const errText = await res.text();
      return { success: false, message: errText };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async switchSession(sessionId: string): Promise<{ success: boolean; active?: string; message?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch("http://127.0.0.1:8080/api/sessions/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as { success: boolean; active?: string };
        return { success: true, active: data.active };
      }
      const errText = await res.text();
      return { success: false, message: errText };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async deleteSession(sessionId: string): Promise<{ success: boolean; message?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch("http://127.0.0.1:8080/api/sessions/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return { success: true };
      }
      const errText = await res.text();
      return { success: false, message: errText };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async getStatus(sessionId?: string): Promise<WhatsAppStatus> {
    try {
      const url = sessionId
        ? `http://127.0.0.1:8080/api/status?session=${encodeURIComponent(sessionId)}`
        : "http://127.0.0.1:8080/api/status";
      const res = await fetch(url, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        const qrString = typeof data.qr === "string" ? data.qr : "";
        let qrDataUrl: string | null = null;
        if (qrString) {
          try {
            qrDataUrl = await QRCode.toDataURL(qrString, {
              margin: 1,
              width: 320,
              color: { dark: "#000000", light: "#ffffff" },
            });
          } catch {
            qrDataUrl = null;
          }
        }

        const rawStatus = data.status as string | undefined;
        const validStatuses = ["connected", "needs_scan", "connecting", "stopped", "error"] as const;
        const resolvedStatus = validStatuses.includes(rawStatus as typeof validStatuses[number])
          ? (rawStatus as WhatsAppStatus["status"])
          : (data.connected ? "connected" : "connecting");

        return {
          session_id: typeof data.session_id === "string" ? data.session_id : sessionId,
          running: true,
          connected: Boolean(data.connected),
          status: resolvedStatus,
          phone: typeof data.phone === "string" ? data.phone : "",
          qr: qrString,
          qrDataUrl,
          serverTime: typeof data.server_time === "string" ? data.server_time : new Date().toISOString(),
          error: this.lastError,
          sessions: Array.isArray(data.sessions) ? (data.sessions as WhatsAppSessionInfo[]) : undefined,
        };
      }
    } catch {
      // HTTP call failed — fall through to process-state fallback
    }

    const isRunning = Boolean(this.process && !this.process.killed);
    return {
      session_id: sessionId,
      running: isRunning,
      connected: false,
      status: isRunning ? "connecting" : "stopped",
      phone: "",
      qr: "",
      qrDataUrl: null,
      serverTime: new Date().toISOString(),
      error: this.lastError,
    };
  }

  public async getChats(query?: string, sessionId?: string): Promise<WhatsAppChat[]> {
    await this.ensureRunning();
    try {
      const url = sessionId
        ? `http://127.0.0.1:8080/api/chats?session=${encodeURIComponent(sessionId)}`
        : "http://127.0.0.1:8080/api/chats";
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        let chats = (await res.json()) as WhatsAppChat[];
        if (query && query.trim()) {
          const q = query.toLowerCase();
          chats = chats.filter(
            (c) => c.name.toLowerCase().includes(q) || c.jid.toLowerCase().includes(q)
          );
        }
        return chats;
      }
    } catch (e) {
      this.lastError = String(e);
    }
    return [];
  }

  public async getMessages(chatJid: string, limit = 50, sessionId?: string): Promise<WhatsAppMessage[]> {
    await this.ensureRunning();
    try {
      let url = `http://127.0.0.1:8080/api/messages?chat_jid=${encodeURIComponent(chatJid)}&limit=${limit}`;
      if (sessionId) {
        url += `&session=${encodeURIComponent(sessionId)}`;
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        return (await res.json()) as WhatsAppMessage[];
      }
    } catch (e) {
      this.lastError = String(e);
    }
    return [];
  }

  public async searchContacts(query: string, sessionId?: string): Promise<WhatsAppContact[]> {
    await this.ensureRunning();
    try {
      let url = `http://127.0.0.1:8080/api/contacts?query=${encodeURIComponent(query)}`;
      if (sessionId) {
        url += `&session=${encodeURIComponent(sessionId)}`;
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        return (await res.json()) as WhatsAppContact[];
      }
    } catch (e) {
      this.lastError = String(e);
    }
    return [];
  }

  public async sendMessage(
    recipient: string,
    message: string,
    mediaPath?: string,
    sessionId?: string
  ): Promise<{ success: boolean; message: string; id?: string; timestamp?: string; chat_jid?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch("http://127.0.0.1:8080/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: sessionId || "",
          recipient,
          message,
          media_path: mediaPath || "",
        }),
        signal: AbortSignal.timeout(15000),
      });

      const data = (await res.json()) as Record<string, unknown>;
      return {
        success: Boolean(data.success),
        message: typeof data.message === "string"
          ? data.message
          : (data.success ? "Message sent" : "Failed to send message"),
        id: typeof data.id === "string" ? data.id : undefined,
        timestamp: typeof data.timestamp === "string" ? data.timestamp : undefined,
        chat_jid: typeof data.chat_jid === "string" ? data.chat_jid : undefined,
      };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async downloadMedia(
    messageId: string,
    chatJid: string,
    sessionId?: string
  ): Promise<{ success: boolean; message: string; filename?: string; path?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch("http://127.0.0.1:8080/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: sessionId || "",
          message_id: messageId,
          chat_jid: chatJid,
        }),
        signal: AbortSignal.timeout(30000),
      });

      const data = (await res.json()) as Record<string, unknown>;
      return {
        success: Boolean(data.success),
        message: typeof data.message === "string" ? data.message : "",
        filename: typeof data.filename === "string" ? data.filename : undefined,
        path: typeof data.path === "string" ? data.path : undefined,
      };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Get metadata for a specific chat JID.
   * Falls back to searching getChats() if the bridge has no dedicated endpoint.
   */
  public async getChat(jid: string): Promise<WhatsAppChat | null> {
    await this.ensureRunning();
    // Try dedicated endpoint first
    try {
      const res = await fetch(
        `http://127.0.0.1:8080/api/chat?jid=${encodeURIComponent(jid)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = (await res.json()) as WhatsAppChat | null;
        return data ?? null;
      }
    } catch {
      // fall through to list-based lookup
    }
    // Fallback: search all chats
    try {
      const all = await this.getChats();
      return all.find((c) => c.jid === jid) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve the direct-message JID for a phone number.
   * Phone may be "+1234567890", "1234567890", or already a JID.
   */
  public async getDirectChat(phone: string): Promise<WhatsAppChat | null> {
    await this.ensureRunning();
    // Normalise: strip leading + and spaces, append WhatsApp suffix
    const digits = phone.replace(/^\+/, "").replace(/\s/g, "");
    const candidateJid = digits.includes("@") ? digits : `${digits}@s.whatsapp.net`;

    // Try bridge endpoint
    try {
      const res = await fetch(
        `http://127.0.0.1:8080/api/chat?jid=${encodeURIComponent(candidateJid)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = (await res.json()) as WhatsAppChat | null;
        if (data) return data;
      }
    } catch {
      // fall through
    }

    // Fallback: scan all chats for a matching JID prefix
    try {
      const all = await this.getChats();
      return (
        all.find(
          (c) => c.jid === candidateJid || c.jid.startsWith(digits + "@")
        ) ?? null
      );
    } catch {
      return null;
    }
  }

  /**
   * List all chats that involve a contact identified by JID or phone number.
   */
  public async getContactChats(contactJidOrPhone: string): Promise<WhatsAppChat[]> {
    await this.ensureRunning();
    const digits = contactJidOrPhone.replace(/^\+/, "").replace(/\s/g, "");
    const prefix = digits.split("@")[0]; // strip @s.whatsapp.net if present

    try {
      const res = await fetch(
        `http://127.0.0.1:8080/api/contact-chats?jid=${encodeURIComponent(contactJidOrPhone)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        return (await res.json()) as WhatsAppChat[];
      }
    } catch {
      // fall through
    }

    // Fallback: filter all chats by JID prefix
    try {
      const all = await this.getChats();
      return all.filter(
        (c) =>
          c.jid === contactJidOrPhone ||
          c.jid.startsWith(prefix + "@") ||
          c.last_sender.includes(prefix)
      );
    } catch {
      return [];
    }
  }

  /**
   * Return the most recent message in a chat with a given contact JID or phone.
   */
  public async getLastInteraction(
    contactJidOrPhone: string
  ): Promise<WhatsAppMessage | null> {
    await this.ensureRunning();
    const digits = contactJidOrPhone.replace(/^\+/, "").replace(/\s/g, "");
    const candidateJid = digits.includes("@") ? digits : `${digits}@s.whatsapp.net`;

    // Try bridge endpoint
    try {
      const res = await fetch(
        `http://127.0.0.1:8080/api/last-interaction?jid=${encodeURIComponent(candidateJid)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = (await res.json()) as WhatsAppMessage | null;
        return data ?? null;
      }
    } catch {
      // fall through
    }

    // Fallback: load recent messages from the direct chat
    try {
      const msgs = await this.getMessages(candidateJid, 1);
      return msgs[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Retrieve messages immediately before and after a given message ID in a chat.
   */
  public async getMessageContext(
    messageId: string,
    chatJid: string,
    contextSize = 5
  ): Promise<{ before: WhatsAppMessage[]; target: WhatsAppMessage | null; after: WhatsAppMessage[] }> {
    await this.ensureRunning();

    // Try bridge endpoint
    try {
      const url = `http://127.0.0.1:8080/api/message-context?message_id=${encodeURIComponent(messageId)}&chat_jid=${encodeURIComponent(chatJid)}&context=${contextSize}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = (await res.json()) as {
          before?: WhatsAppMessage[];
          target?: WhatsAppMessage | null;
          after?: WhatsAppMessage[];
        };
        return {
          before: data.before ?? [],
          target: data.target ?? null,
          after: data.after ?? [],
        };
      }
    } catch {
      // fall through to bulk-fetch fallback
    }

    // Fallback: load a window of messages and find the target
    try {
      const windowSize = contextSize * 2 + 1 + 20; // generous window
      const msgs = await this.getMessages(chatJid, windowSize);
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx === -1) {
        return { before: [], target: null, after: [] };
      }
      return {
        before: msgs.slice(Math.max(0, idx - contextSize), idx),
        target: msgs[idx] ?? null,
        after: msgs.slice(idx + 1, idx + 1 + contextSize),
      };
    } catch {
      return { before: [], target: null, after: [] };
    }
  }

  private async ensureRunning(): Promise<void> {
    const status = await this.getStatus();
    if (!status.running) {
      await this.start();
    }
  }
}

// Global bridge controller instance
const bridge = new WhatsAppBridgeController();

// --- Main Plugin Entry ---
export default async function plugin(bb: BbPluginApi) {
  bb.log.info("WhatsApp MCP Plugin initialized");

  // Auto-start the bridge on plugin load
  bridge.start().catch((err: unknown) => {
    bb.log.error(`Failed to auto-start WhatsApp bridge: ${err}`);
  });

  // Ensure bridge is stopped on shutdown (graceful)
  const shutdown = () => {
    bridge.stop().catch(() => {});
  };
  process.on("exit", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // --- RPC Handlers ---
  bb.rpc.register(rpcContract, {
    async get_status(input) {
      return await bridge.getStatus(input?.session_id);
    },
    async get_sessions() {
      return await bridge.getSessions();
    },
    async create_session(input) {
      return await bridge.createSession(input?.name);
    },
    async switch_session(input) {
      return await bridge.switchSession(input.session_id);
    },
    async delete_session(input) {
      return await bridge.deleteSession(input.session_id);
    },
    async start_bridge() {
      const ok = await bridge.start();
      return { success: ok, message: ok ? "Bridge started" : "Failed to start bridge" };
    },
    async stop_bridge() {
      const ok = await bridge.stop();
      return { success: ok, message: ok ? "Bridge stopped" : "Failed to stop bridge" };
    },
    async restart_bridge() {
      const ok = await bridge.restart();
      return { success: ok, message: ok ? "Bridge restarted" : "Failed to restart bridge" };
    },
    async get_chats(input) {
      return await bridge.getChats(input?.query, input?.session_id);
    },
    async get_messages(input) {
      return await bridge.getMessages(input.chat_jid, input.limit ?? 50, input.session_id);
    },
    async send_message(input) {
      return await bridge.sendMessage(input.recipient, input.message, input.media_path, input.session_id);
    },
    async download_media(input) {
      return await bridge.downloadMedia(input.message_id, input.chat_jid, input.session_id);
    },
    async search_contacts(input) {
      return await bridge.searchContacts(input.query, input.session_id);
    },
  });

  // --- Agent Tools ---

  // 1. whatsapp_status
  bb.agents.registerTool({
    name: "whatsapp_status",
    description: "Check WhatsApp multidevice bridge status, connection state, phone number, and QR code pairing status.",
    parameters: z.object({}),
    presentation: {
      label: {
        pending: "Checking WhatsApp bridge status",
        completed: "Checked WhatsApp status",
      },
    },
    execute: async () => {
      const status = await bridge.getStatus();
      return JSON.stringify(status, null, 2);
    },
  });

  // 2. whatsapp_list_chats
  bb.agents.registerTool({
    name: "whatsapp_list_chats",
    description: "List recent WhatsApp chats with last message preview, timestamp, and contact names.",
    parameters: z.object({
      query: z.string().optional().describe("Optional search query to filter chats by name or JID"),
      limit: z.number().optional().describe("Maximum number of chats to return (default 20)"),
    }),
    presentation: {
      label: {
        pending: "Listing WhatsApp chats",
        completed: "Retrieved WhatsApp chats",
      },
    },
    execute: async ({ query, limit = 20 }) => {
      const chats = await bridge.getChats(query);
      return JSON.stringify(chats.slice(0, limit), null, 2);
    },
  });

  // 3. whatsapp_list_messages
  bb.agents.registerTool({
    name: "whatsapp_list_messages",
    description: "Retrieve WhatsApp messages from a chat or search by content.",
    parameters: z.object({
      chat_jid: z.string().describe("The JID of the chat to retrieve messages from (e.g. '1234567890@s.whatsapp.net' or 'group_id@g.us')"),
      limit: z.number().optional().describe("Maximum number of messages to return (default 20)"),
    }),
    presentation: {
      label: {
        pending: "Retrieving WhatsApp messages",
        completed: "Retrieved WhatsApp messages",
      },
    },
    execute: async ({ chat_jid, limit = 20 }) => {
      const msgs = await bridge.getMessages(chat_jid, limit);
      return JSON.stringify(msgs, null, 2);
    },
  });

  // 4. whatsapp_search_contacts
  bb.agents.registerTool({
    name: "whatsapp_search_contacts",
    description: "Search WhatsApp contacts by name or phone number.",
    parameters: z.object({
      query: z.string().min(1).describe("Search term to match against contact names or phone numbers"),
    }),
    presentation: {
      label: {
        pending: "Searching WhatsApp contacts",
        completed: "Searched WhatsApp contacts",
      },
    },
    execute: async ({ query }) => {
      const contacts = await bridge.searchContacts(query);
      return JSON.stringify(contacts, null, 2);
    },
  });

  // 5. whatsapp_send_message
  bb.agents.registerTool({
    name: "whatsapp_send_message",
    description: "Send a WhatsApp text message to a specified phone number (e.g. '+1234567890') or chat JID.",
    parameters: z.object({
      recipient: z.string().min(1).describe("Recipient phone number with country code (e.g. '+1234567890') or full JID"),
      message: z.string().min(1).describe("The text message content to send"),
    }),
    presentation: {
      label: {
        pending: "Sending WhatsApp message",
        completed: "Sent WhatsApp message",
      },
    },
    execute: async ({ recipient, message }) => {
      const res = await bridge.sendMessage(recipient, message);
      return JSON.stringify(res, null, 2);
    },
  });

  // 6. whatsapp_send_file
  bb.agents.registerTool({
    name: "whatsapp_send_file",
    description: "Send a file (image, video, document, audio) to a WhatsApp recipient.",
    parameters: z.object({
      recipient: z.string().min(1).describe("Recipient phone number with country code or full JID"),
      file_path: z.string().min(1).describe("Absolute local path to the file to send"),
      caption: z.string().optional().describe("Optional caption for the file"),
    }),
    presentation: {
      label: {
        pending: "Sending file via WhatsApp",
        completed: "Sent file via WhatsApp",
      },
    },
    execute: async ({ recipient, file_path, caption = "" }) => {
      const res = await bridge.sendMessage(recipient, caption, file_path);
      return JSON.stringify(res, null, 2);
    },
  });

  // 7. whatsapp_download_media
  bb.agents.registerTool({
    name: "whatsapp_download_media",
    description: "Download media attached to a WhatsApp message to local disk and return its path.",
    parameters: z.object({
      message_id: z.string().min(1).describe("The message ID containing the media"),
      chat_jid: z.string().min(1).describe("The chat JID where the message was received"),
    }),
    presentation: {
      label: {
        pending: "Downloading WhatsApp media",
        completed: "Downloaded WhatsApp media",
      },
    },
    execute: async ({ message_id, chat_jid }) => {
      const res = await bridge.downloadMedia(message_id, chat_jid);
      return JSON.stringify(res, null, 2);
    },
  });

  // 8. whatsapp_get_chat
  bb.agents.registerTool({
    name: "whatsapp_get_chat",
    description: "Retrieve specific chat metadata (name, last message, timestamp) by its WhatsApp JID.",
    parameters: z.object({
      jid: z.string().min(1).describe("The WhatsApp JID of the chat (e.g. '1234567890@s.whatsapp.net' or 'groupid@g.us')"),
    }),
    presentation: {
      label: {
        pending: "Fetching WhatsApp chat",
        completed: "Fetched WhatsApp chat",
      },
    },
    execute: async ({ jid }) => {
      const chat = await bridge.getChat(jid);
      if (!chat) return JSON.stringify({ error: "Chat not found", jid });
      return JSON.stringify(chat, null, 2);
    },
  });

  // 9. whatsapp_get_direct_chat
  bb.agents.registerTool({
    name: "whatsapp_get_direct_chat",
    description: "Find or resolve the direct (1-on-1) WhatsApp chat JID for a given phone number.",
    parameters: z.object({
      phone: z.string().min(1).describe("Phone number with country code (e.g. '+1234567890' or '1234567890') or existing JID"),
    }),
    presentation: {
      label: {
        pending: "Resolving direct WhatsApp chat",
        completed: "Resolved direct WhatsApp chat",
      },
    },
    execute: async ({ phone }) => {
      const chat = await bridge.getDirectChat(phone);
      if (!chat) return JSON.stringify({ error: "No direct chat found for this number", phone });
      return JSON.stringify(chat, null, 2);
    },
  });

  // 10. whatsapp_get_contact_chats
  bb.agents.registerTool({
    name: "whatsapp_get_contact_chats",
    description: "List all WhatsApp chats (direct and group) involving a specific contact identified by JID or phone number.",
    parameters: z.object({
      contact: z.string().min(1).describe("Contact JID (e.g. '1234567890@s.whatsapp.net') or phone number with country code"),
    }),
    presentation: {
      label: {
        pending: "Fetching chats for contact",
        completed: "Fetched chats for contact",
      },
    },
    execute: async ({ contact }) => {
      const chats = await bridge.getContactChats(contact);
      return JSON.stringify(chats, null, 2);
    },
  });

  // 11. whatsapp_get_last_interaction
  bb.agents.registerTool({
    name: "whatsapp_get_last_interaction",
    description: "Get the most recent WhatsApp message exchanged with a specific contact or in a given chat JID.",
    parameters: z.object({
      contact: z.string().min(1).describe("Contact JID (e.g. '1234567890@s.whatsapp.net') or phone number with country code"),
    }),
    presentation: {
      label: {
        pending: "Fetching last WhatsApp interaction",
        completed: "Fetched last WhatsApp interaction",
      },
    },
    execute: async ({ contact }) => {
      const msg = await bridge.getLastInteraction(contact);
      if (!msg) return JSON.stringify({ error: "No messages found for this contact", contact });
      return JSON.stringify(msg, null, 2);
    },
  });

  // 12. whatsapp_get_message_context
  bb.agents.registerTool({
    name: "whatsapp_get_message_context",
    description: "Retrieve messages immediately before and after a specific message ID to understand context.",
    parameters: z.object({
      message_id: z.string().min(1).describe("The ID of the target WhatsApp message"),
      chat_jid: z.string().min(1).describe("The JID of the chat containing the message"),
      context_size: z.number().optional().describe("Number of messages to retrieve before and after the target (default 5)"),
    }),
    presentation: {
      label: {
        pending: "Fetching WhatsApp message context",
        completed: "Fetched WhatsApp message context",
      },
    },
    execute: async ({ message_id, chat_jid, context_size = 5 }) => {
      const ctx = await bridge.getMessageContext(message_id, chat_jid, context_size);
      return JSON.stringify(ctx, null, 2);
    },
  });

  // Configure agent tools so threads automatically have access
  bb.agents.configure((_context) => ({
    tools: [
      "whatsapp_status",
      "whatsapp_list_chats",
      "whatsapp_list_messages",
      "whatsapp_search_contacts",
      "whatsapp_send_message",
      "whatsapp_send_file",
      "whatsapp_download_media",
      "whatsapp_get_chat",
      "whatsapp_get_direct_chat",
      "whatsapp_get_contact_chats",
      "whatsapp_get_last_interaction",
      "whatsapp_get_message_context",
    ],
    skills: ["whatsapp"],
    instructions: "WhatsApp MCP tools are available: use `whatsapp_list_chats` to view chats, `whatsapp_search_contacts` to find numbers, `whatsapp_send_message` to send messages, and `whatsapp_get_message_context` to read conversation context.",
  }));

  // --- CLI Command Registration ---
  bb.cli.register({
    name: "whatsapp",
    summary: "Interact with WhatsApp multidevice bridge: check status, QR pairing, chats, and sending messages",
    commands: [
      { name: "status", summary: "Check bridge connection and phone info", usage: "bb whatsapp status" },
      { name: "qr", summary: "Display current pairing QR code", usage: "bb whatsapp qr" },
      { name: "chats", summary: "List recent chats", usage: "bb whatsapp chats" },
      { name: "send", summary: "Send a message", usage: "bb whatsapp send <recipient> <message>" },
      { name: "start", summary: "Start the WhatsApp bridge daemon", usage: "bb whatsapp start" },
      { name: "stop", summary: "Stop the WhatsApp bridge daemon", usage: "bb whatsapp stop" },
      { name: "restart", summary: "Restart the WhatsApp bridge daemon", usage: "bb whatsapp restart" },
    ],
    async run(argv, _ctx) {
      const sub = argv[0]?.toLowerCase() || "status";

      if (sub === "status") {
        const s = await bridge.getStatus();
        return {
          exitCode: 0,
          stdout: `WhatsApp Bridge Status:\n  State: ${s.status.toUpperCase()}\n  Connected: ${s.connected ? "YES" : "NO"}\n  Phone: ${s.phone || "Not paired"}\n  Running: ${s.running ? "YES" : "NO"}\n${s.error ? `  Error: ${s.error}\n` : ""}`,
        };
      }

      if (sub === "qr") {
        const s = await bridge.getStatus();
        if (s.connected) {
          return { exitCode: 0, stdout: `Already paired and connected to WhatsApp (+${s.phone})` };
        }
        if (!s.qr) {
          return { exitCode: 0, stdout: "No QR code available. Bridge status: " + s.status };
        }
        return {
          exitCode: 0,
          stdout: `Scan this QR code with WhatsApp (Settings > Linked Devices):\n\n${s.qr}\n\n(Tip: Open the WhatsApp tab in Blackbox GUI to see the visual QR code)`,
        };
      }

      if (sub === "chats") {
        const chats = await bridge.getChats();
        if (chats.length === 0) {
          return { exitCode: 0, stdout: "No chats found or bridge not synced yet." };
        }
        const lines = chats.map((c) => `• ${c.name} (${c.jid})\n  Last: ${c.last_message || "—"} [${c.last_message_time || ""}]`);
        return { exitCode: 0, stdout: `Recent WhatsApp Chats (${chats.length}):\n\n${lines.join("\n\n")}` };
      }

      if (sub === "send") {
        const recipient = argv[1];
        const message = argv.slice(2).join(" ");
        if (!recipient || !message) {
          return { exitCode: 1, stderr: "Usage: bb whatsapp send <recipient> <message>" };
        }
        const res = await bridge.sendMessage(recipient, message);
        return { exitCode: res.success ? 0 : 1, stdout: res.message };
      }

      if (sub === "start") {
        const ok = await bridge.start();
        return { exitCode: ok ? 0 : 1, stdout: ok ? "WhatsApp bridge started." : "Failed to start bridge." };
      }

      if (sub === "stop") {
        const ok = await bridge.stop();
        return { exitCode: ok ? 0 : 1, stdout: ok ? "WhatsApp bridge stopped." : "Failed to stop bridge." };
      }

      if (sub === "restart") {
        const ok = await bridge.restart();
        return { exitCode: ok ? 0 : 1, stdout: ok ? "WhatsApp bridge restarted." : "Failed to restart bridge." };
      }

      return { exitCode: 1, stderr: `Unknown subcommand: ${sub}. Available: status, qr, chats, send, start, stop, restart.` };
    },
  });
}
