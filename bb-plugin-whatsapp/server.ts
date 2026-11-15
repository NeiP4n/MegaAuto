import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import os from "node:os";
import crypto from "node:crypto";
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
  error?: string;
  claim_holder?: string;
  claim_expires_at?: string;
}

export interface WhatsAppStatus {
  session_id?: string;
  running: boolean;
  connected: boolean;
  status: "connected" | "needs_scan" | "connecting" | "stopped" | "error" | "logged_out";
  phone: string;
  qr: string;
  qrDataUrl: string | null;
  serverTime: string;
  error: string | null;
  pairing?: boolean;
  syncing?: boolean;
  appearOffline?: boolean;
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
      status: z.enum(["connected", "needs_scan", "connecting", "stopped", "error", "logged_out"]),
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
  set_appear_offline: {
    input: z.object({
      session_id: z.string(),
      appear_offline: z.boolean(),
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string().optional(),
    }),
  },
  force_release_session: {
    input: z.object({ session_id: z.string() }),
    output: z.object({
      success: z.boolean(),
      message: z.string().optional(),
    }),
  },
  restart_session: {
    input: z.object({ session_id: z.string() }),
    output: z.object({
      success: z.boolean(),
      message: z.string().optional(),
    }),
  },
  backup_session: {
    input: z.object({ session_id: z.string() }),
    output: z.object({ success: z.boolean(), message: z.string(), path: z.string().optional() }),
  },
  restore_session: {
    input: z.object({ session_id: z.string(), file: z.string() }),
    output: z.object({ success: z.boolean(), message: z.string() }),
  },
  get_agent_activity: {
    input: z.object({}).nullish(),
    output: z.object({
      entries: z.array(
        z.object({
          ts: z.string(),
          tool: z.string(),
          kind: z.string(),
          ok: z.boolean(),
          summary: z.string(),
          chat_jid: z.string().optional(),
          message_id: z.string().optional(),
          recipient: z.string().optional(),
          duration_ms: z.number().optional(),
        })
      ),
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
    input: z.object({ chat_jid: z.string(), limit: z.number().optional(), before: z.string().optional(), session_id: z.string().optional() }),
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
  fetch_chat_history: {
    input: z.object({ chat_jid: z.string(), count: z.number().optional(), session_id: z.string().optional() }),
    output: z.object({ success: z.boolean(), message: z.string() }),
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
  send_media: {
    input: z.object({
      recipient: z.string().min(1),
      caption: z.string().optional(),
      mime_type: z.string().optional(),
      filename: z.string().optional(),
      data_base64: z.string().min(1),
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
  get_media_preview: {
    input: z.object({
      message_id: z.string().min(1),
      chat_jid: z.string().min(1),
      session_id: z.string().optional(),
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string().optional(),
      data_url: z.string().optional(),
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
export class WhatsAppBridgeController {
  private process: ChildProcess | null = null;
  private bridgeDir: string;
  private bridgeExe: string;
  /** REST port; the Go bridge reads the same env var. */
  private bridgePort: number = (() => {
    const n = Number(process.env.WHATSAPP_BRIDGE_PORT);
    return Number.isInteger(n) && n > 0 && n <= 65535 ? n : 8080;
  })();
  private lastError: string | null = null;
  /** Rolling tail of bridge stdout+stderr, for exit-reason diagnostics. */
  private bridgeLogTail = "";
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

  /**
   * Probe the bridge port: returns the running bridge's status payload when a
   * real bridge answers (retried - a busy bridge can miss a single 400 ms
   * window), null when the port is free or occupied by something else.
   */
  private async probeBridge(port: number = this.bridgePort): Promise<{ build: string; connected: boolean; pairing: boolean; syncing: boolean } | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
          signal: AbortSignal.timeout(400),
        });
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          // Confirm it is actually our bridge, not a random service on 8080.
          if ("connected" in data || "sessions" in data || "status" in data) {
            return {
              build: typeof data.build === "string" ? data.build : "",
              connected: Boolean(data.connected),
              pairing: Boolean(data.pairing),
              syncing: Boolean(data.syncing),
            };
          }
          return null;
        }
      } catch {
        // not answering right now - retry
      }
      await new Promise<void>((r) => setTimeout(r, 250));
    }
    return null;
  }

  /**
   * Kill whatever listens on the bridge port. Last resort for stale bridge
   * processes that predate the /api/shutdown endpoint, so the user never has
   * to open Task Manager.
   */
  private killPortOwner(port: number = this.bridgePort): boolean {
    try {
      if (process.platform === "win32") {
        const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { timeout: 8000 }).toString();
        for (const line of out.split(/\r?\n/)) {
          if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
          const cols = line.trim().split(/\s+/);
          const local = cols[1] ?? "";
          const pid = cols[cols.length - 1] ?? "";
          if (local.endsWith(`:${port}`) && /^\d+$/.test(pid)) {
            execFileSync("taskkill", ["/PID", pid, "/F"], { timeout: 8000 });
            return true;
          }
        }
        return false;
      }
      const out = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { timeout: 8000 }).toString().trim();
      if (!out) return false;
      for (const pid of out.split(/\s+/)) {
        if (/^\d+$/.test(pid)) execFileSync("kill", ["-9", pid], { timeout: 8000 });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A bridge is already answering on the port. Adopt it when it matches the
   * binary on disk; otherwise shut it down (API first, force-kill as
   * fallback) so start() can spawn the current one. Returns true when the
   * running bridge was adopted and no spawn is needed.
   */
  private async adoptOrReplaceRunningBridge(running: { build: string; connected: boolean; pairing: boolean; syncing: boolean }): Promise<boolean> {
    const shaPath = path.join(this.bridgeDir, ".build-sha");
    const onDiskSha = fs.existsSync(shaPath) ? fs.readFileSync(shaPath, "utf8").trim() : "";
    // Same build as the exe on disk -> nothing to do. Unknown on-disk SHA with
    // a stamped running build can happen right after git pull; replace then so
    // the running process always ends up on the newest binary.
    if (running.build && onDiskSha && running.build === onDiskSha) {
      this.lastError = null;
      return true;
    }
    // No stamp yet (fresh clone, never self-updated): trust the running
    // bridge's own build SHA and adopt it. Without this, every plugin reload
    // with a missing stamp killed a healthy bridge - including mid-pairing.
    if (!onDiskSha && running.build) {
      try { fs.writeFileSync(shaPath, running.build); } catch { /* read-only dir */ }
      this.lastError = null;
      return true;
    }
    // NEVER kill a bridge whose session is connected, pairing, or syncing -
    // replacing the binary mid-pair is what turns "logging in..." on the
    // phone into "couldn't log in / logged out". A slightly stale but
    // healthy bridge wins; the new binary takes over on the next clean start.
    if (running.connected || running.pairing || running.syncing) {
      this.lastError = null;
      return true;
    }
    // Stale or unstamped bridge: ask it to exit gracefully first.
    let portFree = false;
    try {
      await fetch(`http://127.0.0.1:${this.bridgePort}/api/shutdown`, {
        method: "POST",
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // endpoint missing on old bridges - force-kill below
    }
    for (let i = 0; i < 10; i++) {
      await new Promise<void>((r) => setTimeout(r, 200));
      if (!(await this.probeBridge())) { portFree = true; break; }
    }
    if (!portFree) {
      if (this.killPortOwner()) {
        for (let i = 0; i < 15; i++) {
          await new Promise<void>((r) => setTimeout(r, 200));
          if (!(await this.probeBridge())) { portFree = true; break; }
        }
      }
    }
    if (!portFree) {
      // Could not stop the old one - better to use it than to have nothing.
      this.lastError = null;
      return true;
    }
    return false;
  }

  /**
   * Self-update whatsapp-bridge.exe from the rolling "bridge-latest" GitHub
   * release (built by CI on every bridge change). Only runs while no bridge
   * is up; on any failure keeps the existing binary. Repo is public, no
   * credentials needed.
   */
  private async maybeUpdateBridge(): Promise<void> {
    if (this.process && !this.process.killed) return;
    if (await this.probeBridge()) return;
    try {
      const rel = await fetch(
        "https://api.github.com/repos/NeiP4n/MegaAuto/releases/tags/bridge-latest",
        {
          headers: { "User-Agent": "bb-plugin-whatsapp", Accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!rel.ok) return;
      const data = (await rel.json()) as {
        assets?: { name: string; browser_download_url: string }[];
      };
      const verAsset = data.assets?.find((a) => a.name === "bridge-version.txt");
      const exeAsset = data.assets?.find((a) => a.name === "whatsapp-bridge.exe");
      if (!verAsset || !exeAsset) return;

      const verRes = await fetch(verAsset.browser_download_url, {
        signal: AbortSignal.timeout(8000),
      });
      if (!verRes.ok) return;
      const latestSha = (await verRes.text()).trim();
      const shaPath = path.join(this.bridgeDir, ".build-sha");
      const currentSha = fs.existsSync(shaPath) ? fs.readFileSync(shaPath, "utf8").trim() : "";
      if (!latestSha || latestSha === currentSha) return;

      const exeRes = await fetch(exeAsset.browser_download_url, {
        redirect: "follow",
        signal: AbortSignal.timeout(180000),
      });
      if (!exeRes.ok) return;
      const buf = Buffer.from(await exeRes.arrayBuffer());
      // Sanity: a real build is tens of MB; never swap in an error page.
      if (buf.length < 1_000_000) return;

      const tmp = this.bridgeExe + ".download";
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, this.bridgeExe);
      fs.writeFileSync(shaPath, latestSha);
    } catch {
      // Offline, rate limit, missing release - keep the current binary.
    }
  }

  public async start(): Promise<boolean> {
    this.stopRequested = false;

    if (this.process && !this.process.killed) {
      return true;
    }

    // A bridge may already be running (orphaned by a plugin reload, or an
    // older build from before the update). Adopt it when current, replace it
    // when stale - the user should never have to kill processes by hand.
    const running = await this.probeBridge();
    if (running) {
      const adopted = await this.adoptOrReplaceRunningBridge(running);
      if (adopted) return true;
    }

    // Grab the newest CI-built binary before (maybe) starting the bridge.
    await this.maybeUpdateBridge();

    if (!fs.existsSync(this.bridgeExe)) {
      this.lastError = `Bridge executable not found at: ${this.bridgeExe}`;
      return false;
    }

    // Run the bridge from a private copy: a running exe holds a write lock
    // on Windows, which is what made `git pull` skip whatsapp-bridge.exe
    // ("Unlink of file ... failed") and left an outdated binary on disk.
    // Spawning a copy keeps the repo file unlocked so pulls and the
    // self-updater always land; the copy is keyed by content hash, so an
    // updated binary gets a fresh copy on next start.
    let runExe = this.bridgeExe;
    try {
      const hash = crypto
        .createHash("sha1")
        .update(fs.readFileSync(this.bridgeExe))
        .digest("hex")
        .slice(0, 10);
      const copyPath = path.join(os.tmpdir(), `whatsapp-bridge-${hash}.exe`);
      if (!fs.existsSync(copyPath)) {
        const tmpCopy = copyPath + ".partial";
        fs.copyFileSync(this.bridgeExe, tmpCopy);
        fs.renameSync(tmpCopy, copyPath);
      }
      runExe = copyPath;
    } catch {
      runExe = this.bridgeExe; // copy failed (readonly tmp etc.) - run in place
    }

    try {
      this.lastError = null;
      this.process = spawn(runExe, [], {
        cwd: this.bridgeDir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: false,
        env: { ...process.env, WHATSAPP_BRIDGE_PORT: String(this.bridgePort) },
      });

      // Persistent bridge log: the 2 KB in-memory tail is useless for
      // post-mortem pairing/logout diagnosis, so tee everything the bridge
      // prints into bridge/bridge.log (rotated to bridge.log.old at 8 MB on
      // each start). This file is what we ask the user to send.
      let logStream: fs.WriteStream | null = null;
      try {
        const logPath = path.join(this.bridgeDir, "bridge.log");
        let isNewLog = false;
        try {
          const sz = fs.statSync(logPath).size;
          if (sz > 8 * 1024 * 1024) {
            try { fs.unlinkSync(logPath + ".old"); } catch { /* none */ }
            fs.renameSync(logPath, logPath + ".old");
            isNewLog = true;
          }
        } catch { isNewLog = true; /* no log yet */ }
        logStream = fs.createWriteStream(logPath, { flags: "a" });
        // UTF-8 BOM so Windows editors (Notepad etc.) don't misread the
        // log as cp1251 and show mojibake on Cyrillic chat names.
        if (isNewLog) logStream.write("\uFEFF");
        logStream.write(`\n===== bridge started ${new Date().toISOString()} pid=${this.process?.pid} =====\n`);
      } catch { /* logging is best-effort */ }

      // waLog writes ANSI color codes for the console; strip them from the
      // file copy, which is what users open and send us.
      const stripAnsi = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, "");

      const appendTail = (text: string) => {
        this.bridgeLogTail = (this.bridgeLogTail + text).slice(-2048);
        try { logStream?.write(stripAnsi(text)); } catch { /* ignore */ }
      };

      this.process.stdout?.on("data", (data: Buffer) => appendTail(data.toString()));

      this.process.stderr?.on("data", (data: Buffer) => {
        appendTail(data.toString());
        const text = data.toString();
        if (text.includes("ERROR") || text.includes("error") || text.includes("FATAL")) {
          this.lastError = text.trim().slice(0, 512);
        }
      });

      this.process.on("error", (err: Error) => {
        this.lastError = `Bridge process error: ${err.message}`;
        this.process = null;
      });

      this.process.on("exit", (code: number | null) => {
        this.process = null;
        try { logStream?.end(); } catch { /* ignore */ }
        if (!this.stopRequested && code !== 0 && code !== null) {
          const tail = this.bridgeLogTail.trim();
          const reason = /already in use|already running|Only one usage|address already in use/i.test(tail)
            ? `port ${this.bridgePort} is already used by another bridge instance`
            : tail
              ? tail.split(/\r?\n/).filter(Boolean).slice(-2).join(" | ").slice(0, 300)
              : "";
          this.lastError = `Bridge exited unexpectedly with code ${code}${reason ? ` - ${reason}` : ""}`;
          // Bind race: another instance grabbed the port first. If a bridge
          // answers now, quietly adopt it and clear the error.
          void (async () => {
            if (await this.probeBridge()) {
              this.lastError = null;
            }
          })();
        }
      });

      // Wait up to 3 s for REST API to become reachable (15 × 200 ms)
      for (let i = 0; i < 15; i++) {
        // If our process already died (e.g. port conflict with a straggler),
        // adopt whoever answers instead of reporting a dead bridge.
        if (!this.process) {
          if (await this.probeBridge()) {
            this.lastError = null;
            return true;
          }
          return false;
        }
        await new Promise<void>((r) => setTimeout(r, 200));
        try {
          const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/status`, {
            signal: AbortSignal.timeout(500),
          });
          if (res.ok) return true;
        } catch {
          // Not ready yet – keep polling
        }
      }
      // Never came up - but if a bridge answers anyway (slow start), use it.
      if (await this.probeBridge()) {
        this.lastError = null;
        return true;
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
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/sessions`, {
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
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/sessions/create`, {
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

  public async claimSession(
    sessionId: string,
    holder: string,
    ttlSeconds?: number
  ): Promise<{ success: boolean; message?: string; holder?: string; expires_at?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/sessions/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          holder,
          ttl_seconds: ttlSeconds || 0,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as Record<string, unknown>;
      const out: { success: boolean; message?: string; holder?: string; expires_at?: string } = {
        success: Boolean(data.success),
      };
      if (typeof data.message === "string") out.message = data.message;
      if (typeof data.holder === "string") out.holder = data.holder;
      if (typeof data.expires_at === "string") out.expires_at = data.expires_at;
      return out;
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async releaseSession(
    sessionId: string,
    holder: string,
    force: boolean
  ): Promise<{ success: boolean; message?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/sessions/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, holder, force }),
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as Record<string, unknown>;
      const out: { success: boolean; message?: string } = { success: Boolean(data.success) };
      if (typeof data.message === "string") out.message = data.message;
      return out;
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async setAppearOffline(sessionId: string, appearOffline: boolean): Promise<{ success: boolean; message?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/session/privacy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, appear_offline: appearOffline }),
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as { success?: boolean };
      return { success: Boolean(data.success) };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async restartSession(sessionId: string): Promise<{ success: boolean; message?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/sessions/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
        signal: AbortSignal.timeout(10000),
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

  public async backupSession(sessionId: string): Promise<{ success: boolean; message: string; path?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/sessions/backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: sessionId }),
        signal: AbortSignal.timeout(30000),
      });
      const data = (await res.json()) as Record<string, unknown>;
      const out: { success: boolean; message: string; path?: string } = {
        success: Boolean(data.success),
        message: typeof data.message === "string" ? data.message : "",
      };
      if (typeof data.path === "string") out.path = data.path;
      return out;
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async restoreSession(sessionId: string, file: string): Promise<{ success: boolean; message: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/sessions/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: sessionId, file }),
        signal: AbortSignal.timeout(60000),
      });
      const data = (await res.json()) as Record<string, unknown>;
      return {
        success: Boolean(data.success),
        message: typeof data.message === "string" ? data.message : "",
      };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async switchSession(sessionId: string): Promise<{ success: boolean; active?: string; message?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/sessions/switch`, {
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
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/sessions/delete`, {
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
        ? `http://127.0.0.1:${this.bridgePort}/api/status?session=${encodeURIComponent(sessionId)}`
        : `http://127.0.0.1:${this.bridgePort}/api/status`;
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
        const validStatuses = ["connected", "needs_scan", "connecting", "stopped", "error", "logged_out"] as const;
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
          error:
            typeof data.error === "string" && data.error
              ? data.error
              : this.lastError,
          pairing: Boolean(data.pairing),
          syncing: Boolean(data.syncing),
          appearOffline: Boolean(data.appear_offline),
          ...(Array.isArray(data.sessions) ? { sessions: data.sessions as WhatsAppSessionInfo[] } : {}),
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
        ? `http://127.0.0.1:${this.bridgePort}/api/chats?session=${encodeURIComponent(sessionId)}`
        : `http://127.0.0.1:${this.bridgePort}/api/chats`;
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

  public async getMessages(chatJid: string, limit = 50, sessionId?: string, before?: string): Promise<WhatsAppMessage[]> {
    await this.ensureRunning();
    try {
      let url = `http://127.0.0.1:${this.bridgePort}/api/messages?chat_jid=${encodeURIComponent(chatJid)}&limit=${limit}`;
      if (before) {
        url += `&before=${encodeURIComponent(before)}`;
      }
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

  /** Ask the paired phone for messages older than the oldest stored one. */
  public async fetchChatHistory(chatJid: string, count = 50, sessionId?: string): Promise<{ success: boolean; message: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/history/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: sessionId || "", chat_jid: chatJid, count }),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await res.json()) as Record<string, unknown>;
      return {
        success: Boolean(data.success),
        message: typeof data.message === "string" ? data.message : "",
      };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async searchContacts(query: string, sessionId?: string): Promise<WhatsAppContact[]> {
    await this.ensureRunning();
    try {
      let url = `http://127.0.0.1:${this.bridgePort}/api/contacts?query=${encodeURIComponent(query)}`;
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
    sessionId?: string,
    allowUnknownBlast?: boolean,
    claimHolder?: string
  ): Promise<{ success: boolean; message: string; id?: string; timestamp?: string; chat_jid?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: sessionId || "",
          recipient,
          message,
          media_path: mediaPath || "",
          allow_unknown_blast: allowUnknownBlast || undefined,
          claim_holder: claimHolder || undefined,
        }),
        // The bridge serializes sends per session with min spacing, so a
        // queued send can legitimately take tens of seconds.
        signal: AbortSignal.timeout(60000),
      });

      const data = (await res.json()) as Record<string, unknown>;
      const out: { success: boolean; message: string; id?: string; timestamp?: string; chat_jid?: string } = {
        success: Boolean(data.success),
        message: typeof data.message === "string"
          ? data.message
          : (data.success ? "Message sent" : "Failed to send message"),
      };
      if (typeof data.id === "string") out.id = data.id;
      if (typeof data.timestamp === "string") out.timestamp = data.timestamp;
      if (typeof data.chat_jid === "string") out.chat_jid = data.chat_jid;
      return out;
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async sendMedia(
    recipient: string,
    dataBase64: string,
    mimeType: string,
    filename: string,
    caption: string,
    sessionId?: string,
    claimHolder?: string
  ): Promise<{ success: boolean; message: string; id?: string; timestamp?: string; chat_jid?: string }> {
    await this.ensureRunning();
    try {
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/send-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: sessionId || "",
          recipient,
          caption,
          mime_type: mimeType,
          filename,
          data_b64: dataBase64,
          claim_holder: claimHolder || undefined,
        }),
        // Media uploads can take a while on slow links.
        signal: AbortSignal.timeout(120000),
      });

      const data = (await res.json()) as Record<string, unknown>;
      const out: { success: boolean; message: string; id?: string; timestamp?: string; chat_jid?: string } = {
        success: Boolean(data.success),
        message: typeof data.message === "string"
          ? data.message
          : (data.success ? "Media sent" : "Failed to send media"),
      };
      if (typeof data.id === "string") out.id = data.id;
      if (typeof data.timestamp === "string") out.timestamp = data.timestamp;
      if (typeof data.chat_jid === "string") out.chat_jid = data.chat_jid;
      return out;
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  public async getMediaDataUrl(
    messageId: string,
    chatJid: string,
    sessionId?: string
  ): Promise<{ success: boolean; message?: string; data_url?: string }> {
    await this.ensureRunning();
    try {
      let url = `http://127.0.0.1:${this.bridgePort}/api/media/raw?message_id=${encodeURIComponent(messageId)}&chat_jid=${encodeURIComponent(chatJid)}`;
      if (sessionId) {
        url += `&session=${encodeURIComponent(sessionId)}`;
      }
      // Media retry (asking the phone for a fresh path after a 403) can take
      // ~20s on top of the actual download - give the bridge room to finish.
      const res = await fetch(url, { signal: AbortSignal.timeout(75000) });
      if (!res.ok) {
        let msg = `media unavailable (HTTP ${res.status})`;
        try {
          const data = (await res.json()) as Record<string, unknown>;
          if (typeof data.message === "string") msg = data.message;
        } catch { /* keep default */ }
        return { success: false, message: msg };
      }
      const mime = res.headers.get("content-type") || "image/jpeg";
      const buf = Buffer.from(await res.arrayBuffer());
      return { success: true, data_url: `data:${mime};base64,${buf.toString("base64")}` };
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
      const res = await fetch(`http://127.0.0.1:${this.bridgePort}/api/download`, {
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
      // Never return {key: undefined}: the RPC runtime rejects undefined
      // values ("not a JSON value") - omit missing optional keys entirely.
      const out: { success: boolean; message: string; filename?: string; path?: string } = {
        success: Boolean(data.success),
        message: typeof data.message === "string" ? data.message : "",
      };
      if (typeof data.filename === "string") out.filename = data.filename;
      if (typeof data.path === "string") out.path = data.path;
      return out;
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Get metadata for a specific chat JID.
   * Falls back to searching getChats() if the bridge has no dedicated endpoint.
   */
  public async getChat(jid: string, sessionId?: string): Promise<WhatsAppChat | null> {
    await this.ensureRunning();
    const sessQ = sessionId ? `&session=${encodeURIComponent(sessionId)}` : "";
    // Try dedicated endpoint first
    try {
      const res = await fetch(
        `http://127.0.0.1:${this.bridgePort}/api/chat?jid=${encodeURIComponent(jid)}${sessQ}`,
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
      const all = await this.getChats("", sessionId);
      return all.find((c) => c.jid === jid) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve the direct-message JID for a phone number.
   * Phone may be "+1234567890", "1234567890", or already a JID.
   */
  public async getDirectChat(phone: string, sessionId?: string): Promise<WhatsAppChat | null> {
    await this.ensureRunning();
    const sessQ = sessionId ? `&session=${encodeURIComponent(sessionId)}` : "";
    // Normalise: strip leading + and spaces, append WhatsApp suffix
    const digits = phone.replace(/^\+/, "").replace(/\s/g, "");
    const candidateJid = digits.includes("@") ? digits : `${digits}@s.whatsapp.net`;

    // Try bridge endpoint
    try {
      const res = await fetch(
        `http://127.0.0.1:${this.bridgePort}/api/chat?jid=${encodeURIComponent(candidateJid)}${sessQ}`,
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
  public async getContactChats(contactJidOrPhone: string, sessionId?: string): Promise<WhatsAppChat[]> {
    await this.ensureRunning();
    const digits = contactJidOrPhone.replace(/^\+/, "").replace(/\s/g, "");
    const prefix = digits.split("@")[0]; // strip @s.whatsapp.net if present

    try {
      const res = await fetch(
        `http://127.0.0.1:${this.bridgePort}/api/contact-chats?jid=${encodeURIComponent(contactJidOrPhone)}${sessionId ? `&session=${encodeURIComponent(sessionId)}` : ""}`,
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
    contactJidOrPhone: string,
    sessionId?: string
  ): Promise<WhatsAppMessage | null> {
    await this.ensureRunning();
    const digits = contactJidOrPhone.replace(/^\+/, "").replace(/\s/g, "");
    const candidateJid = digits.includes("@") ? digits : `${digits}@s.whatsapp.net`;

    // Try bridge endpoint
    try {
      const res = await fetch(
        `http://127.0.0.1:${this.bridgePort}/api/last-interaction?jid=${encodeURIComponent(candidateJid)}${sessionId ? `&session=${encodeURIComponent(sessionId)}` : ""}`,
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
    contextSize = 5,
    sessionId?: string
  ): Promise<{ before: WhatsAppMessage[]; target: WhatsAppMessage | null; after: WhatsAppMessage[] }> {
    await this.ensureRunning();

    // Try bridge endpoint
    try {
      const url = `http://127.0.0.1:${this.bridgePort}/api/message-context?message_id=${encodeURIComponent(messageId)}&chat_jid=${encodeURIComponent(chatJid)}&context=${contextSize}${sessionId ? `&session=${encodeURIComponent(sessionId)}` : ""}`;
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
    async backup_session(input) {
      return await bridge.backupSession(input.session_id);
    },
    async restore_session(input) {
      return await bridge.restoreSession(input.session_id, input.file);
    },
    async set_appear_offline(input) {
      return await bridge.setAppearOffline(input.session_id, input.appear_offline);
    },
    async force_release_session(input) {
      return await bridge.releaseSession(input.session_id, "ui", true);
    },
    async restart_session(input) {
      return await bridge.restartSession(input.session_id);
    },
    async get_agent_activity() {
      return { entries: agentActivity };
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
      return await bridge.getMessages(input.chat_jid, input.limit ?? 50, input.session_id, input.before);
    },
    async fetch_chat_history(input) {
      return await bridge.fetchChatHistory(input.chat_jid, input.count ?? 50, input.session_id);
    },
    async send_message(input) {
      return await bridge.sendMessage(input.recipient, input.message, input.media_path, input.session_id, undefined, "ui");
    },
    async send_media(input) {
      return await bridge.sendMedia(
        input.recipient,
        input.data_base64,
        input.mime_type ?? "",
        input.filename ?? "",
        input.caption ?? "",
        input.session_id,
        "ui"
      );
    },
    async download_media(input) {
      return await bridge.downloadMedia(input.message_id, input.chat_jid, input.session_id);
    },
    async get_media_preview(input) {
      return await bridge.getMediaDataUrl(input.message_id, input.chat_jid, input.session_id);
    },
    async search_contacts(input) {
      return await bridge.searchContacts(input.query, input.session_id);
    },
  });

  // --- Agent activity feed ---
  // Every agent tool call is recorded here so the UI can show the user what
  // the AI is doing through this bridge (reads, sends, diagnostics).
  interface AgentActivityEntry {
    ts: string;
    tool: string;
    kind: "send" | "read" | "system";
    ok: boolean;
    summary: string;
    chat_jid?: string;
    message_id?: string;
    recipient?: string;
    duration_ms?: number;
  }
  const agentActivity: AgentActivityEntry[] = [];

  function summarizeArgs(args: unknown): string {
    if (!args || typeof args !== "object") return "";
    return Object.entries(args as Record<string, unknown>)
      .map(([k, v]) => {
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}=${s.length > 80 ? s.slice(0, 77) + "..." : s}`;
      })
      .join(", ");
  }

  const rawRegisterTool = bb.agents.registerTool.bind(bb.agents);
  function registerToolLogged<S extends z.ZodTypeAny>(def: {
    name: string;
    description: string;
    parameters: S;
    presentation?: unknown;
    execute: (args: z.infer<S>, ctx: unknown) => unknown;
  }) {
    const kind: AgentActivityEntry["kind"] = def.name.includes("send")
      ? "send"
      : def.name === "whatsapp_status"
      ? "system"
      : "read";
    const origExecute = def.execute;
    return (rawRegisterTool as (d: any) => void)({
      ...def,
      execute: async (args: any, ctx: any) => {
        const started = Date.now();
        const recipient =
          args && typeof args.recipient === "string" ? args.recipient : undefined;
        try {
          const result = await origExecute(args, ctx);
          let ok = true;
          let chat_jid: string | undefined;
          let message_id: string | undefined;
          try {
            const parsed = JSON.parse(String(result));
            if (parsed && typeof parsed === "object") {
              if ("success" in parsed) ok = Boolean(parsed.success);
              if (typeof parsed.chat_jid === "string") chat_jid = parsed.chat_jid;
              if (typeof parsed.id === "string") message_id = parsed.id;
            }
          } catch {
            // Non-JSON result - treat as success.
          }
          agentActivity.unshift({
            ts: new Date().toISOString(),
            tool: def.name,
            kind,
            ok,
            summary: summarizeArgs(args),
            chat_jid,
            message_id,
            recipient,
            duration_ms: Date.now() - started,
          });
          if (agentActivity.length > 200) agentActivity.length = 200;
          return result;
        } catch (e: any) {
          agentActivity.unshift({
            ts: new Date().toISOString(),
            tool: def.name,
            kind,
            ok: false,
            summary: `${summarizeArgs(args)} -> error: ${e?.message ?? String(e)}`,
            recipient,
            duration_ms: Date.now() - started,
          });
          if (agentActivity.length > 200) agentActivity.length = 200;
          throw e;
        }
      },
    });
  }

  // --- Agent Tools ---

  // 0. whatsapp_list_accounts
  registerToolLogged({
    name: "whatsapp_list_accounts",
    description: "List all paired WhatsApp accounts (session id, name, phone number, connection status, which is active). Call this FIRST when the user has multiple WhatsApp accounts or asks to use a specific number; pass the chosen session id to the other whatsapp_* tools via their session_id parameter.",
    parameters: z.object({}),
    presentation: {
      label: {
        pending: "Listing WhatsApp accounts",
        completed: "Listed WhatsApp accounts",
      },
    },
    execute: async () => {
      const sessions = await bridge.getSessions();
      return JSON.stringify(sessions, null, 2);
    },
  });

  // 0b. whatsapp_claim_session
  registerToolLogged({
    name: "whatsapp_claim_session",
    description: "Take an exclusive, time-limited claim on a WhatsApp account so other agents don't interleave sends on it. Re-calling with the same holder renews the claim. Release it with whatsapp_release_session when done. The claim expires automatically (default 10 minutes, max 1 hour), so a crashed agent never wedges the account. The account list from whatsapp_list_accounts shows who currently holds each session.",
    parameters: z.object({
      session_id: z.string().min(1).describe("Account session id from whatsapp_list_accounts"),
      holder: z.string().min(1).describe("Your agent name - other agents see it as the claim owner, and you pass it as claim_holder when sending"),
      ttl_seconds: z.number().optional().describe("How long the claim lasts (30-3600 seconds, default 600)"),
    }),
    presentation: {
      label: {
        pending: "Claiming WhatsApp session",
        completed: "Claimed WhatsApp session",
      },
    },
    execute: async ({ session_id, holder, ttl_seconds }) => {
      const res = await bridge.claimSession(session_id, holder, ttl_seconds);
      return JSON.stringify(res, null, 2);
    },
  });

  // 0c. whatsapp_release_session
  registerToolLogged({
    name: "whatsapp_release_session",
    description: "Release your claim on a WhatsApp account taken with whatsapp_claim_session. Only the holder can release it (the user can force-release from the plugin UI).",
    parameters: z.object({
      session_id: z.string().min(1).describe("Account session id from whatsapp_list_accounts"),
      holder: z.string().min(1).describe("The holder name used in whatsapp_claim_session"),
    }),
    presentation: {
      label: {
        pending: "Releasing WhatsApp session",
        completed: "Released WhatsApp session",
      },
    },
    execute: async ({ session_id, holder }) => {
      const res = await bridge.releaseSession(session_id, holder, false);
      return JSON.stringify(res, null, 2);
    },
  });

  // 1. whatsapp_status
  registerToolLogged({
    name: "whatsapp_status",
    description: "Check WhatsApp multidevice bridge status, connection state, phone number, and QR code pairing status.",
    parameters: z.object({
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
    }),
    presentation: {
      label: {
        pending: "Checking WhatsApp bridge status",
        completed: "Checked WhatsApp status",
      },
    },
    execute: async ({ session_id }) => {
      const status = await bridge.getStatus(session_id);
      return JSON.stringify(status, null, 2);
    },
  });

  // 2. whatsapp_list_chats
  registerToolLogged({
    name: "whatsapp_list_chats",
    description: "List recent WhatsApp chats with last message preview, timestamp, and contact names.",
    parameters: z.object({
      query: z.string().optional().describe("Optional search query to filter chats by name or JID"),
      limit: z.number().optional().describe("Maximum number of chats to return (default 20)"),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
    }),
    presentation: {
      label: {
        pending: "Listing WhatsApp chats",
        completed: "Retrieved WhatsApp chats",
      },
    },
    execute: async ({ query, limit = 20, session_id }) => {
      const chats = await bridge.getChats(query, session_id);
      return JSON.stringify(chats.slice(0, limit), null, 2);
    },
  });

  // 3. whatsapp_list_messages
  registerToolLogged({
    name: "whatsapp_list_messages",
    description: "Retrieve WhatsApp messages from a chat or search by content.",
    parameters: z.object({
      chat_jid: z.string().describe("The JID of the chat to retrieve messages from (e.g. '1234567890@s.whatsapp.net' or 'group_id@g.us')"),
      limit: z.number().optional().describe("Maximum number of messages to return (default 20)"),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
    }),
    presentation: {
      label: {
        pending: "Retrieving WhatsApp messages",
        completed: "Retrieved WhatsApp messages",
      },
    },
    execute: async ({ chat_jid, limit = 20, session_id }) => {
      const msgs = await bridge.getMessages(chat_jid, limit, session_id);
      return JSON.stringify(msgs, null, 2);
    },
  });

  // 4. whatsapp_search_contacts
  registerToolLogged({
    name: "whatsapp_search_contacts",
    description: "Search WhatsApp contacts by name or phone number.",
    parameters: z.object({
      query: z.string().min(1).describe("Search term to match against contact names or phone numbers"),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
    }),
    presentation: {
      label: {
        pending: "Searching WhatsApp contacts",
        completed: "Searched WhatsApp contacts",
      },
    },
    execute: async ({ query, session_id }) => {
      const contacts = await bridge.searchContacts(query, session_id);
      return JSON.stringify(contacts, null, 2);
    },
  });

  // 5. whatsapp_send_message
  registerToolLogged({
    name: "whatsapp_send_message",
    description: "Send a WhatsApp text message to a specified phone number (e.g. '+1234567890') or chat JID.",
    parameters: z.object({
      recipient: z.string().min(1).describe("Recipient phone number with country code (e.g. '+1234567890') or full JID"),
      message: z.string().min(1).describe("The text message content to send"),
      allow_unknown_blast: z.boolean().optional().describe("Override the first-time-recipient hourly cap (max 5 new numbers/hour). Only set when the user explicitly asked to message many new contacts - bulk cold messaging gets WhatsApp accounts banned."),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
      claim_holder: z.string().optional().describe("Your agent name if you hold a session claim from whatsapp_claim_session - sends on a session claimed by another agent are rejected."),
    }),
    presentation: {
      label: {
        pending: "Sending WhatsApp message",
        completed: "Sent WhatsApp message",
      },
    },
    execute: async ({ recipient, message, allow_unknown_blast, session_id, claim_holder }) => {
      const res = await bridge.sendMessage(recipient, message, undefined, session_id, allow_unknown_blast, claim_holder);
      return JSON.stringify(res, null, 2);
    },
  });

  // 6. whatsapp_send_file
  registerToolLogged({
    name: "whatsapp_send_file",
    description: "Send a file (image, video, document, audio) to a WhatsApp recipient.",
    parameters: z.object({
      recipient: z.string().min(1).describe("Recipient phone number with country code or full JID"),
      file_path: z.string().min(1).describe("Absolute local path to the file to send"),
      caption: z.string().optional().describe("Optional caption for the file"),
      allow_unknown_blast: z.boolean().optional().describe("Override the first-time-recipient hourly cap. Only set when the user explicitly asked for bulk messaging to new contacts."),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
      claim_holder: z.string().optional().describe("Your agent name if you hold a session claim from whatsapp_claim_session."),
    }),
    presentation: {
      label: {
        pending: "Sending file via WhatsApp",
        completed: "Sent file via WhatsApp",
      },
    },
    execute: async ({ recipient, file_path, caption = "", allow_unknown_blast, session_id, claim_holder }) => {
      const res = await bridge.sendMessage(recipient, caption, file_path, session_id, allow_unknown_blast, claim_holder);
      return JSON.stringify(res, null, 2);
    },
  });

  // 7. whatsapp_download_media
  registerToolLogged({
    name: "whatsapp_download_media",
    description: "Download media attached to a WhatsApp message to local disk and return its path.",
    parameters: z.object({
      message_id: z.string().min(1).describe("The message ID containing the media"),
      chat_jid: z.string().min(1).describe("The chat JID where the message was received"),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
    }),
    presentation: {
      label: {
        pending: "Downloading WhatsApp media",
        completed: "Downloaded WhatsApp media",
      },
    },
    execute: async ({ message_id, chat_jid, session_id }) => {
      const res = await bridge.downloadMedia(message_id, chat_jid, session_id);
      return JSON.stringify(res, null, 2);
    },
  });

  // 8. whatsapp_get_chat
  registerToolLogged({
    name: "whatsapp_get_chat",
    description: "Retrieve specific chat metadata (name, last message, timestamp) by its WhatsApp JID.",
    parameters: z.object({
      jid: z.string().min(1).describe("The WhatsApp JID of the chat (e.g. '1234567890@s.whatsapp.net' or 'groupid@g.us')"),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
    }),
    presentation: {
      label: {
        pending: "Fetching WhatsApp chat",
        completed: "Fetched WhatsApp chat",
      },
    },
    execute: async ({ jid, session_id }) => {
      const chat = await bridge.getChat(jid, session_id);
      if (!chat) return JSON.stringify({ error: "Chat not found", jid });
      return JSON.stringify(chat, null, 2);
    },
  });

  // 9. whatsapp_get_direct_chat
  registerToolLogged({
    name: "whatsapp_get_direct_chat",
    description: "Find or resolve the direct (1-on-1) WhatsApp chat JID for a given phone number.",
    parameters: z.object({
      phone: z.string().min(1).describe("Phone number with country code (e.g. '+1234567890' or '1234567890') or existing JID"),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
    }),
    presentation: {
      label: {
        pending: "Resolving direct WhatsApp chat",
        completed: "Resolved direct WhatsApp chat",
      },
    },
    execute: async ({ phone, session_id }) => {
      const chat = await bridge.getDirectChat(phone, session_id);
      if (!chat) return JSON.stringify({ error: "No direct chat found for this number", phone });
      return JSON.stringify(chat, null, 2);
    },
  });

  // 10. whatsapp_get_contact_chats
  registerToolLogged({
    name: "whatsapp_get_contact_chats",
    description: "List all WhatsApp chats (direct and group) involving a specific contact identified by JID or phone number.",
    parameters: z.object({
      contact: z.string().min(1).describe("Contact JID (e.g. '1234567890@s.whatsapp.net') or phone number with country code"),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
    }),
    presentation: {
      label: {
        pending: "Fetching chats for contact",
        completed: "Fetched chats for contact",
      },
    },
    execute: async ({ contact, session_id }) => {
      const chats = await bridge.getContactChats(contact, session_id);
      return JSON.stringify(chats, null, 2);
    },
  });

  // 11. whatsapp_get_last_interaction
  registerToolLogged({
    name: "whatsapp_get_last_interaction",
    description: "Get the most recent WhatsApp message exchanged with a specific contact or in a given chat JID.",
    parameters: z.object({
      contact: z.string().min(1).describe("Contact JID (e.g. '1234567890@s.whatsapp.net') or phone number with country code"),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
    }),
    presentation: {
      label: {
        pending: "Fetching last WhatsApp interaction",
        completed: "Fetched last WhatsApp interaction",
      },
    },
    execute: async ({ contact, session_id }) => {
      const msg = await bridge.getLastInteraction(contact, session_id);
      if (!msg) return JSON.stringify({ error: "No messages found for this contact", contact });
      return JSON.stringify(msg, null, 2);
    },
  });

  // 12. whatsapp_get_message_context
  registerToolLogged({
    name: "whatsapp_get_message_context",
    description: "Retrieve messages immediately before and after a specific message ID to understand context.",
    parameters: z.object({
      message_id: z.string().min(1).describe("The ID of the target WhatsApp message"),
      chat_jid: z.string().min(1).describe("The JID of the chat containing the message"),
      context_size: z.number().optional().describe("Number of messages to retrieve before and after the target (default 5)"),
      session_id: z.string().optional().describe("Target account session id from whatsapp_list_accounts. Omit to use the active account."),
    }),
    presentation: {
      label: {
        pending: "Fetching WhatsApp message context",
        completed: "Fetched WhatsApp message context",
      },
    },
    execute: async ({ message_id, chat_jid, context_size = 5, session_id }) => {
      const ctx = await bridge.getMessageContext(message_id, chat_jid, context_size, session_id);
      return JSON.stringify(ctx, null, 2);
    },
  });

  // Configure agent tools so threads automatically have access
  bb.agents.configure((_context) => ({
    tools: [
      "whatsapp_list_accounts",
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
      { name: "contacts", summary: "Search contacts", usage: "bb whatsapp contacts <query>" },
      { name: "messages", summary: "List messages in a chat", usage: "bb whatsapp messages <chat_jid> [limit]" },
      { name: "send", summary: "Send a message (recipient or --to chat name)", usage: "bb whatsapp send --account <name|phone> --to <chat name> <message>  |  bb whatsapp send <recipient> <message>" },
      { name: "say", summary: "Broadcast a message to all chats (dry-run first)", usage: "bb whatsapp say --all [--groups] [--limit N] [--dry-run] [--yes] <message>" },
      { name: "claim", summary: "Take an exclusive agent claim on an account", usage: "bb whatsapp claim --account <name|phone> [--holder <name>] [--ttl <seconds>]" },
      { name: "release", summary: "Release your claim on an account", usage: "bb whatsapp release --account <name|phone> [--holder <name>]" },
      { name: "send-file", summary: "Send a file", usage: "bb whatsapp send-file <recipient> <path> [caption]" },
      { name: "start", summary: "Start the WhatsApp bridge daemon", usage: "bb whatsapp start" },
      { name: "stop", summary: "Stop the WhatsApp bridge daemon", usage: "bb whatsapp stop" },
      { name: "restart", summary: "Restart the WhatsApp bridge daemon", usage: "bb whatsapp restart" },
    ],
    async run(argv, _ctx) {
      // `bb whatsapp` and `bb whatsapp --help` print the cheat sheet: the
      // local agent probes it constantly, so it must exist and be fast.
      const first = argv[0]?.toLowerCase();
      if (!first || first === "--help" || first === "-h" || first === "help") {
        return {
          exitCode: 0,
          stdout: [
            "Не нужны: bb status, plugins list, чтение файлов/логов, sqlite, Get-ChildItem. Всё через bb whatsapp.",
            "",
            "WhatsApp CLI - cheat sheet (no session_id / JID needed, names resolve):",
            "",
            "  bb whatsapp send --to \"Mom\" \"привет\"                        send to a chat BY NAME",
            "  bb whatsapp send --account 16838505031 --to \"Mom\" \"текст\"     pick account by phone/name",
            "  bb whatsapp say --all \"текст\" --dry-run                     preview broadcast (count + recipients)",
            "  bb whatsapp say --all \"текст\" --yes                       broadcast to all chats (groups off; add --groups)",
            "  bb whatsapp messages \"Mom\" 20                             read a chat by name",
            "  bb whatsapp chats                                             list recent chats",
            "  bb whatsapp accounts                                          list accounts (id, name, phone, status)",
            "  bb whatsapp claim --account <name|phone> --holder my-agent    exclusive claim (TTL, default 10 min)",
            "  bb whatsapp release --account <name|phone> --holder my-agent  release your claim",
            "",
            "More: status, qr, contacts <query>, send-file, backup, restore, start, stop, restart.",
            "Every command also accepts --session <id> (see bb whatsapp accounts).",
          ].join("\n"),
        };
      }
      const sub = first;

      // Every read/send subcommand accepts `--session <id>` to target a
      // specific account; without it the active account is used.
      const takeSessionFlag = (args: string[]): { sessionId?: string; rest: string[] } => {
        const i = args.indexOf("--session");
        if (i === -1) return { rest: args };
        const rest = [...args];
        rest.splice(i, 1);
        const sessionId = rest.splice(i, 1)[0];
        return { sessionId, rest };
      };
      const { sessionId: cliSession, rest: restArgs } = takeSessionFlag(argv.slice(1));

      // `bb whatsapp <sub> --help` prints that subcommand's usage (the local
      // agent probes these; they must not fall through to weird behavior).
      if (restArgs.includes("--help") || restArgs.includes("-h")) {
        const usages: Record<string, string> = {
          send: 'bb whatsapp send [--account <name|phone>] [--to <chat name>] <recipient> <message>\n  Examples:\n  bb whatsapp send --to "Mom" "привет"\n  bb whatsapp send --account 16838505031 --to "Mom" "текст"\n  bb whatsapp send +12025551234 "hi"',
          say: 'bb whatsapp say --all [--groups] [--account <name|phone>] [--limit N] [--dry-run] [--yes] <message>\n  Broadcast to existing chats only. --dry-run lists recipients; >5 needs --yes.',
          messages: 'bb whatsapp messages <chat name|jid> [limit] [--session <id>]\n  Example: bb whatsapp messages "Mom" 20',
          chats: "bb whatsapp chats [--session <id>]\n  Without --session lists chats of EVERY account, grouped by account.",
          accounts: "bb whatsapp accounts\n  Lists accounts: * = active, session id, name, phone, status, claim holder.",
          contacts: 'bb whatsapp contacts <query> [--session <id>]',
          "send-file": "bb whatsapp send-file <recipient> <path> [caption] [--session <id>]",
          claim: "bb whatsapp claim --account <name|phone> [--holder <name>] [--ttl <seconds>]\n  Exclusive agent claim; default TTL 10 min, auto-expires.",
          release: "bb whatsapp release --account <name|phone> [--holder <name>]",
        };
        return { exitCode: 0, stdout: usages[sub] || "Run: bb whatsapp --help" };
      }

      // Generic --flag <value> extractor (flags are removed from the rest).
      const takeFlag = (args: string[], name: string): { value?: string; rest: string[] } => {
        const i = args.indexOf(name);
        if (i === -1) return { rest: args };
        const rest = [...args];
        rest.splice(i, 1);
        const value = rest.splice(i, 1)[0];
        return { value, rest };
      };
      const hasFlag = (args: string[], name: string): boolean => args.includes(name);
      const dropFlag = (args: string[], name: string): string[] => args.filter((a) => a !== name);

      // Resolve an account by session id, phone digits, or (case-insensitive) name.
      const resolveAccount = async (token: string): Promise<{ sessionId?: string; error?: string }> => {
        const sessions = await bridge.getSessions();
        const digits = token.replace(/[^0-9]/g, "");
        const lower = token.toLowerCase();
        const match =
          sessions.find((s) => s.id === token) ||
          (digits ? sessions.find((s) => s.phone === digits || s.phone.endsWith(digits)) : undefined) ||
          sessions.find((s) => (s.name || "").toLowerCase() === lower) ||
          sessions.find((s) => (s.name || "").toLowerCase().includes(lower));
        if (!match) {
          return { error: `No account matches "${token}". Run: bb whatsapp accounts` };
        }
        return { sessionId: match.id };
      };

      // Resolve a chat by exact/partial name or JID/number on one account.
      const resolveChat = async (
        query: string,
        sessionId?: string
      ): Promise<{ jid?: string; name?: string; error?: string }> => {
        if (query.includes("@")) return { jid: query, name: query };
        if (/^\+?[0-9]{5,}$/.test(query.replace(/[\s-]/g, ""))) return { jid: query, name: query };
        const chats = await bridge.getChats(query, sessionId);
        if (chats.length === 0) {
          return { error: `No chat matches "${query}". Check the name with: bb whatsapp chats` };
        }
        const lower = query.toLowerCase();
        const exact = chats.find((c) => (c.name || "").toLowerCase() === lower);
        const chosen = exact || chats[0];
        return { jid: chosen.jid, name: chosen.name || chosen.jid };
      };

      // Resolve a chat across ALL accounts: with one match the agent never
      // needs --account at all; with several, it gets a ready-to-run pick
      // list instead of having to list accounts/chats per session.
      const resolveChatAnywhere = async (
        query: string,
        sessionId?: string
      ): Promise<{ jid?: string; name?: string; sessionId?: string; error?: string }> => {
        if (query.includes("@")) return { jid: query, name: query, sessionId };
        if (/^\+?[0-9]{5,}$/.test(query.replace(/[\s-]/g, ""))) return { jid: query, name: query, sessionId };
        if (sessionId) {
          const one = await resolveChat(query, sessionId);
          return { ...one, sessionId };
        }
        const sessions = await bridge.getSessions();
        const hits: { jid: string; name: string; sessionId: string; accountLabel: string }[] = [];
        for (const s of sessions) {
          const chats = await bridge.getChats(query, s.id);
          for (const c of chats) {
            hits.push({
              jid: c.jid,
              name: c.name || c.jid,
              sessionId: s.id,
              accountLabel: s.phone ? `+${s.phone}` : s.name || s.id,
            });
          }
        }
        const lower = query.toLowerCase();
        const exact = hits.filter((h) => h.name.toLowerCase() === lower);
        const pool = exact.length ? exact : hits;
        if (pool.length === 0) {
          return { error: `No chat matches "${query}" on any account. List them: bb whatsapp chats` };
        }
        if (pool.length === 1) {
          return pool[0];
        }
        const list = pool
          .map((h) => `  "${h.name}" on ${h.accountLabel}  ->  bb whatsapp send --account "${h.accountLabel}" --to "${h.name}" "<text>"`)
          .join("\n");
        return { error: `"${query}" matches ${pool.length} chats - pick one and rerun:\n${list}` };
      };

      if (sub === "accounts") {
        const sessions = await bridge.getSessions();
        if (sessions.length === 0) {
          return { exitCode: 0, stdout: "No accounts configured." };
        }
        const lines = sessions.map((sess) => {
          const mark = sess.is_active ? "*" : " ";
          const phone = sess.phone ? `+${sess.phone}` : "(not paired)";
          const claim = sess.claim_holder ? `  claim: ${sess.claim_holder}` : "";
          return `${mark} ${sess.id}  ${sess.name}  ${phone}  [${sess.status}]${sess.connected ? " CONNECTED" : ""}${claim}`;
        });
        return {
          exitCode: 0,
          stdout: `WhatsApp Accounts (* = active):\n\n${lines.join("\n")}\n\nNo need to pick: bb whatsapp send --to "Chat Name" "text" resolves the account by chat name across all accounts. Manual targeting: --account <name|phone> or --session <id>.`,
        };
      }

      if (sub === "status") {
        const s = await bridge.getStatus(cliSession);
        return {
          exitCode: 0,
          stdout: `WhatsApp Bridge Status:\n  State: ${s.status.toUpperCase()}\n  Connected: ${s.connected ? "YES" : "NO"}\n  Phone: ${s.phone || "Not paired"}\n  Running: ${s.running ? "YES" : "NO"}\n${s.error ? `  Error: ${s.error}\n` : ""}`,
        };
      }

      if (sub === "qr") {
        const s = await bridge.getStatus(cliSession);
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
        const sessions = await bridge.getSessions();
        const targets = cliSession ? sessions.filter((s) => s.id === cliSession) : sessions;
        const sections: string[] = [];
        let total = 0;
        for (const s of targets.length ? targets : sessions.slice(0, 1)) {
          const chats = await bridge.getChats("", s.id);
          total += chats.length;
          const label = s.phone ? `+${s.phone}${s.name ? ` (${s.name})` : ""}` : s.name || s.id;
          const lines = chats.map((c) => `• ${c.name} (${c.jid})\n  Last: ${c.last_message || "—"} [${c.last_message_time || ""}]`);
          sections.push(`== ${label} ==\n${lines.join("\n\n") || "(no chats yet)"}`);
        }
        if (total === 0) {
          return { exitCode: 0, stdout: "No chats found or bridge not synced yet." };
        }
        return { exitCode: 0, stdout: `Recent WhatsApp Chats (${total}):\n\n${sections.join("\n\n")}\n\nSend to any chat by name: bb whatsapp send --to "Name" "text"` };
      }

      if (sub === "contacts") {
        const query = restArgs.join(" ");
        if (!query) {
          return { exitCode: 1, stderr: "Usage: bb whatsapp contacts <query> [--session <id>]" };
        }
        const contacts = await bridge.searchContacts(query, cliSession);
        if (contacts.length === 0) {
          return { exitCode: 0, stdout: "No contacts matched." };
        }
        const lines = contacts.map((c) => `• ${c.name || "(no name)"} - ${c.phone_number || c.jid} (${c.jid})`);
        return { exitCode: 0, stdout: `Contacts (${contacts.length}):\n\n${lines.join("\n")}` };
      }

      if (sub === "messages") {
        const rawChat = restArgs[0];
        const limit = Number(restArgs[1]) || 20;
        if (!rawChat) {
          return { exitCode: 1, stderr: "Usage: bb whatsapp messages <chat name|jid> [limit] [--session <id>]" };
        }
        const chat = await resolveChat(rawChat, cliSession);
        if (!chat.jid) {
          return { exitCode: 1, stderr: chat.error };
        }
        const msgs = await bridge.getMessages(chat.jid, limit, cliSession);
        if (msgs.length === 0) {
          return { exitCode: 0, stdout: "No messages found in this chat." };
        }
        const lines = msgs.map((m) => {
          const who = m.is_from_me ? "You" : (m.sender_name || m.sender);
          const media = m.media_type ? ` [${m.media_type}${m.filename ? ": " + m.filename : ""}]` : "";
          return `[${m.timestamp}] ${who}: ${m.content}${media}`;
        });
        return { exitCode: 0, stdout: lines.join("\n") };
      }

      if (sub === "send-file") {
        const recipient = restArgs[0];
        const filePath = restArgs[1];
        const caption = restArgs.slice(2).join(" ");
        if (!recipient || !filePath) {
          return { exitCode: 1, stderr: "Usage: bb whatsapp send-file <recipient> <path> [caption] [--session <id>]" };
        }
        const res = await bridge.sendMessage(recipient, caption, filePath, cliSession, undefined, "cli");
        return { exitCode: res.success ? 0 : 1, stdout: res.message };
      }

      if (sub === "send") {
        const accountF = takeFlag(restArgs, "--account");
        const toF = takeFlag(accountF.rest, "--to");
        const args = toF.rest;

        let sessionId = cliSession;
        if (accountF.value) {
          const acc = await resolveAccount(accountF.value);
          if (!acc.sessionId) return { exitCode: 1, stderr: acc.error };
          sessionId = acc.sessionId;
        }

        let recipient: string;
        let message: string;
        if (toF.value) {
          const chat = await resolveChatAnywhere(toF.value, sessionId);
          if (!chat.jid) return { exitCode: 1, stderr: chat.error };
          recipient = chat.jid;
          sessionId = chat.sessionId || sessionId;
          message = args.join(" ");
        } else {
          const raw = args[0];
          if (raw && !raw.includes("@") && !/^\+?[0-9]{5,}$/.test(raw.replace(/[\s-]/g, ""))) {
            // Positional recipient that is not a number/JID: treat as a chat name.
            const chat = await resolveChatAnywhere(raw, sessionId);
            if (!chat.jid) return { exitCode: 1, stderr: chat.error };
            recipient = chat.jid;
            sessionId = chat.sessionId || sessionId;
          } else {
            recipient = raw;
          }
          message = args.slice(1).join(" ");
        }
        if (!recipient || !message) {
          return { exitCode: 1, stderr: "Usage: bb whatsapp send [--account <name|phone>] [--to <chat name>] <recipient> <message>" };
        }
        const res = await bridge.sendMessage(recipient, message, undefined, sessionId, undefined, "cli");
        return { exitCode: res.success ? 0 : 1, stdout: res.message };
      }

      // Broadcast one message to existing chats only (never to new numbers).
      // The bridge's per-account send limits still apply and abort the run.
      if (sub === "say") {
        if (!hasFlag(restArgs, "--all")) {
          return { exitCode: 1, stderr: "Usage: bb whatsapp say --all [--groups] [--account <name|phone>] [--limit N] [--dry-run] [--yes] <message>" };
        }
        let args = dropFlag(restArgs, "--all");
        const includeGroups = hasFlag(args, "--groups");
        args = dropFlag(args, "--groups");
        const dryRun = hasFlag(args, "--dry-run");
        args = dropFlag(args, "--dry-run");
        const yes = hasFlag(args, "--yes");
        args = dropFlag(args, "--yes");
        const accountF = takeFlag(args, "--account");
        args = accountF.rest;
        const limitF = takeFlag(args, "--limit");
        args = limitF.rest;
        const message = args.join(" ").trim();
        if (!message) {
          return { exitCode: 1, stderr: "Usage: bb whatsapp say --all [--groups] [--account <name|phone>] [--limit N] [--dry-run] [--yes] <message>" };
        }

        let sessionId = cliSession;
        if (accountF.value) {
          const acc = await resolveAccount(accountF.value);
          if (!acc.sessionId) return { exitCode: 1, stderr: acc.error };
          sessionId = acc.sessionId;
        }

        const maxLimit = Math.min(Math.max(Number(limitF.value) || 20, 1), 50);
        const chats = await bridge.getChats("", sessionId);
        const targets = chats.filter((c) => includeGroups || !c.jid.endsWith("@g.us")).slice(0, maxLimit);
        if (targets.length === 0) {
          return { exitCode: 1, stderr: "No chats to broadcast to." };
        }
        const preview = targets.map((c, i) => `${i + 1}. ${c.name || c.jid}`).join("\n");
        if (dryRun) {
          return { exitCode: 0, stdout: `DRY RUN - would send to ${targets.length} chat(s):\n${preview}` };
        }
        if (targets.length > 5 && !yes) {
          return {
            exitCode: 1,
            stderr: `Broadcast to ${targets.length} chats needs confirmation. Preview: bb whatsapp say --all --dry-run <message>  |  Confirm: add --yes`,
          };
        }

        let sent = 0;
        const failed: string[] = [];
        for (const chat of targets) {
          const res = await bridge.sendMessage(chat.jid, message, undefined, sessionId, undefined, "cli");
          if (res.success) {
            sent += 1;
          } else {
            failed.push(`${chat.name || chat.jid}: ${res.message}`);
            break; // a limit (429) or disconnect aborts the run
          }
        }
        const failText = failed.length ? `\nStopped: ${failed[0]}` : "";
        return {
          exitCode: failed.length ? 1 : 0,
          stdout: `Broadcast done: ${sent}/${targets.length} sent.${failText}`,
        };
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

      if (sub === "backup") {
        const sessions = await bridge.getSessions();
        const target = argv[1] || sessions.find((s) => s.is_active)?.id || "default";
        const res = await bridge.backupSession(target);
        return { exitCode: res.success ? 0 : 1, stdout: res.success ? `Backup saved: ${res.path}` : res.message };
      }
      if (sub === "restore") {
        if (!argv[1] || !argv[2]) {
          return { exitCode: 1, stderr: "Usage: bb whatsapp restore <session_id> <backup-file.zip>" };
        }
        const res = await bridge.restoreSession(argv[1], argv[2]);
        return { exitCode: res.success ? 0 : 1, stdout: res.message };
      }

      // claim/release: exclusive agent claim on an account (see the
      // whatsapp_claim_session tool; this is its CLI twin).
      if (sub === "claim" || sub === "release") {
        const holderF = takeFlag(restArgs, "--holder");
        const ttlF = takeFlag(holderF.rest, "--ttl");
        const accountF = takeFlag(ttlF.rest, "--account");
        const token = accountF.value || cliSession || accountF.rest[0];
        if (!token) {
          return { exitCode: 1, stderr: `Usage: bb whatsapp ${sub} --account <name|phone|session_id> [--holder <name>]${sub === "claim" ? " [--ttl <seconds>]" : ""}` };
        }
        const acc = await resolveAccount(token);
        if (!acc.sessionId) return { exitCode: 1, stderr: acc.error };
        const holder = holderF.value || "cli";
        if (sub === "claim") {
          const res = await bridge.claimSession(acc.sessionId, holder, Number(ttlF.value) || 0);
          return {
            exitCode: res.success ? 0 : 1,
            stdout: res.success
              ? `Claimed ${acc.sessionId} as "${res.holder}" until ${res.expires_at}`
              : res.message,
          };
        }
        const res = await bridge.releaseSession(acc.sessionId, holder, false);
        return { exitCode: res.success ? 0 : 1, stdout: res.success ? `Released ${acc.sessionId}` : res.message };
      }

      return { exitCode: 1, stderr: `Unknown subcommand: ${sub}. Available: status, accounts, qr, chats, contacts, messages, send, say, send-file, claim, release, start, stop, restart, backup, restore. Most accept --session <id>; send/say/claim/release accept --account <name|phone> and send accepts --to <chat name>. Or run: bb whatsapp --help` };
    },
  });
}
