import { useEffect, useState, useRef, useCallback } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type {
  rpcContract,
  WhatsAppStatus,
  WhatsAppChat,
  WhatsAppMessage,
  WhatsAppContact,
  WhatsAppSessionInfo,
} from "./server";
import {
  SvgWhatsApp,
  SvgSearch,
  SvgSend,
  SvgRefresh,
  SvgCheck,
  SvgCheckCheck,
  SvgPhone,
  SvgTerminal,
  SvgPower,
  SvgEye,
  SvgEyeOff,
  SvgFile,
  SvgAlertTriangle,
  SvgDownload,
  SvgPlus,
  SvgX,
  SvgImage,
  SvgUser,
  SvgLock,
  SvgChevronLeft,
  SvgChevronRight,
} from "./components/icons";

// Inline preview for an incoming image message: lazily pulls the bytes
// through the bridge (cached on disk after the first fetch) and opens a
// lightbox on click. On failure the download chip below stays as the
// fallback, so a missing preview never breaks the bubble.
function MediaImagePreview({
  msg,
  onOpen,
  sessionId,
}: {
  msg: WhatsAppMessage;
  onOpen: (url: string) => void;
  sessionId?: string;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const previewArgs: { message_id: string; chat_jid: string; session_id?: string } = {
          message_id: msg.id,
          chat_jid: msg.chat_jid,
        };
        if (sessionId) previewArgs.session_id = sessionId;
        const res = await rpc.call("get_media_preview", previewArgs);
        if (cancelled) return;
        if (res.success && res.data_url) {
          setDataUrl(res.data_url);
          setFailed(false);
        } else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [msg.id, msg.chat_jid, attempt, sessionId]);

  if (failed) {
    return (
      <button
        onClick={() => {
          setFailed(false);
          setDataUrl(null);
          setAttempt((a) => a + 1);
        }}
        className="mx-1 mt-1.5 text-[12px] text-[var(--wa-text-secondary)] underline decoration-dotted underline-offset-2 hover:text-[var(--wa-text)] transition-colors"
      >
        Не удалось загрузить — повторить
      </button>
    );
  }
  if (!dataUrl) {
    return (
      <div className="mx-1 mt-1.5 w-[280px] h-[180px] rounded-md bg-[rgba(0,0,0,0.15)] flex items-center justify-center">
        <SvgRefresh className="w-5 h-5 animate-spin text-[var(--wa-icon)]" />
      </div>
    );
  }
  return (
    <img
      src={dataUrl}
      alt={msg.filename || "photo"}
      onClick={() => onOpen(dataUrl)}
      className="rounded-md max-w-[280px] max-h-[320px] object-cover mx-1 mt-1.5 cursor-zoom-in"
    />
  );
}

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

interface RegisteredToolInfo {
  name: string;
  description: string;
  category: "Read" | "Write" | "System";
}

/**
 * WhatsApp Web look: the layout, bubbles and palette follow the WhatsApp Web
 * dark theme, with a light-theme fallback via prefers-color-scheme.
 * All colors are plain CSS variables; no proprietary assets.
 */
const WA_STYLES = `
.wa-root {
  --wa-app-bg: #111b21;
  --wa-chat-bg: #0b141a;
  --wa-header: #202c33;
  --wa-panel: #111b21;
  --wa-panel-raised: #202c33;
  --wa-hover: #2a3942;
  --wa-active: #2a3942;
  --wa-input: #2a3942;
  --wa-text: #e9edef;
  --wa-text-secondary: #8696a0;
  --wa-icon: #aebac1;
  --wa-accent: #00a884;
  --wa-accent-strong: #06cf9c;
  --wa-bubble-out: #005c4b;
  --wa-bubble-in: #202c33;
  --wa-border: rgba(134, 150, 160, 0.15);
  --wa-danger: #f15c6d;
  --wa-warning: #f0b330;
  --wa-tick-read: #53bdeb;
  --wa-doodle: rgba(134, 150, 160, 0.05);
}
@media (prefers-color-scheme: light) {
  .wa-root {
    --wa-app-bg: #ffffff;
    --wa-chat-bg: #efeae2;
    --wa-header: #f0f2f5;
    --wa-panel: #ffffff;
    --wa-panel-raised: #f0f2f5;
    --wa-hover: #f0f2f5;
    --wa-active: #e9edef;
    --wa-input: #f0f2f5;
    --wa-text: #111b21;
    --wa-text-secondary: #667781;
    --wa-icon: #54656f;
    --wa-bubble-out: #d9fdd3;
    --wa-bubble-in: #ffffff;
    --wa-border: #d1d7db;
    --wa-doodle: rgba(11, 20, 26, 0.04);
  }
}
.wa-root ::-webkit-scrollbar { width: 6px; height: 6px; }
.wa-root ::-webkit-scrollbar-thumb { background: rgba(134, 150, 160, 0.3); border-radius: 3px; }
.wa-root ::-webkit-scrollbar-track { background: transparent; }
.wa-chat-doodle {
  background-color: var(--wa-chat-bg);
  background-image: radial-gradient(var(--wa-doodle) 1px, transparent 1px);
  background-size: 22px 22px;
}
`;

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatListTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (d.getTime() > weekAgo) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
}

function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const cls = size === "lg" ? "w-10 h-10 text-base" : "w-[49px] h-[49px] text-lg";
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <div
      className={`${cls} rounded-full bg-[#6b7c85] text-white flex items-center justify-center font-normal shrink-0 select-none`}
    >
      {initial || <SvgUser className="w-5 h-5" />}
    </div>
  );
}

export function WhatsAppView() {
  const rpc = useRpc<typeof rpcContract>();

  // Multi-Account Session state
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    try {
      return localStorage.getItem("bb_whatsapp_active_session") || "default";
    } catch {
      return "default";
    }
  });
  const [sessions, setSessions] = useState<WhatsAppSessionInfo[]>([]);

  // State
  const [status, setStatus] = useState<WhatsAppStatus>({
    running: false,
    connected: false,
    status: "connecting",
    phone: "",
    qr: "",
    qrDataUrl: null,
    serverTime: new Date().toISOString(),
    error: null,
  });

  const [chats, setChats] = useState<WhatsAppChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<WhatsAppChat | null>(null);
  // Narrow layout (<700px): show either the list or the open chat, never
  // both squeezed together, with a back button to return to the list.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("bb_whatsapp_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth < 700 : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 699px)");
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    setIsNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const msgListRef = useRef<HTMLDivElement>(null);
  // Per-account memory of the open chat and its scroll position, so
  // switching account tabs and coming back lands where you left off.
  const chatMemoryRef = useRef<Map<string, { jid: string | null; scrollTop: number }>>(new Map());
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const lastMsgKeyRef = useRef<string>("");
  const chatOpenedAtRef = useRef<number>(0);
  const [chatSearch, setChatSearch] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [attachment, setAttachment] = useState<{
    dataUrl: string;
    base64: string;
    mime: string;
    filename: string;
    size: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<"chats" | "tools">("chats");

  // Error banner feedback
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [qrStalled, setQrStalled] = useState(false);
  const [agentActivity, setAgentActivity] = useState<AgentActivityEntry[]>([]);
  const [registeredTools, setRegisteredTools] = useState<RegisteredToolInfo[]>([]);

  // Account creation in progress (blocks double-click session collisions)
  const [creatingSession, setCreatingSession] = useState(false);

  // New Chat Modal state
  const [showNewChatDialog, setShowNewChatDialog] = useState(false);
  const [newChatInput, setNewChatInput] = useState("");
  const [contactSearchResults, setContactSearchResults] = useState<WhatsAppContact[]>([]);
  const [searchingContacts, setSearchingContacts] = useState(false);

  // Media download state tracking (messageId -> status / path)
  const [downloadingMedia, setDownloadingMedia] = useState<Record<string, "loading" | "downloaded" | "failed">>({});
  const [downloadedPaths, setDownloadedPaths] = useState<Record<string, string>>({});

  // Direct test sender state
  const [testRecipient, setTestRecipient] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<any>(null);

  // Fetch status of the selected session
  const fetchStatus = useCallback(
    async (sid?: string) => {
      try {
        const targetSid = sid || activeSessionId;
        const s = await rpc.call("get_status", { session_id: targetSid });
        setStatus(s);
        if (s.sessions && Array.isArray(s.sessions) && s.sessions.length > 0) {
          setSessions(s.sessions);
        }
        return s;
      } catch (e: any) {
        setStatus((prev) => ({ ...prev, error: String(e) }));
        return null;
      }
    },
    [rpc, activeSessionId]
  );

  // Fetch sessions list
  const fetchSessions = useCallback(async () => {
    try {
      const list = await rpc.call("get_sessions");
      if (Array.isArray(list) && list.length > 0) {
        setSessions(list);
      }
    } catch (e) {
      console.error("fetchSessions error:", e);
    }
  }, [rpc]);

  // Fetch chats for the current session
  const fetchChats = useCallback(
    async (query?: string, sid?: string) => {
      try {
        const targetSid = sid || activeSessionId;
        const list = await rpc.call("get_chats", { query: query || "", session_id: targetSid });
        if (Array.isArray(list)) {
          setChats(list);
          return list;
        }
        return [];
      } catch (e) {
        console.error("fetchChats error:", e);
        return [];
      }
    },
    [rpc, activeSessionId]
  );

  // Fetch the recent window and MERGE it into the list: pages of older
  // history loaded by scrolling up must survive the 2.5s poll.
  const fetchMessages = useCallback(
    async (chatJid: string, sid?: string) => {
      const targetSid = sid || activeSessionId;
      try {
        const msgs = await rpc.call("get_messages", {
          chat_jid: chatJid,
          limit: 50,
          session_id: targetSid,
        });
        if (Array.isArray(msgs)) {
          const fetched = msgs as WhatsAppMessage[];
          setMessages((prev) => {
            const now = Date.now();
            const fetchedIds = new Set(fetched.map((m) => m.id));
            const oldestFetchedTs = fetched.length > 0 ? new Date(fetched[0].timestamp).getTime() : Number.MAX_SAFE_INTEGER;
            // Keep older-than-window pages the user loaded by scrolling up.
            const olderPages = prev.filter(
              (p) =>
                p.chat_jid === chatJid &&
                !p.id.startsWith("opt-") &&
                !fetchedIds.has(p.id) &&
                new Date(p.timestamp).getTime() < oldestFetchedTs
            );
            // Retain recent optimistic unconfirmed messages (< 15s) not yet in msgs
            const pendingOptimistic = prev.filter(
              (p) =>
                p.chat_jid === chatJid &&
                p.id.startsWith("opt-") &&
                now - new Date(p.timestamp).getTime() < 15000 &&
                !fetched.some((m) => m.content === p.content && m.is_from_me)
            );
            return [...olderPages, ...fetched, ...pendingOptimistic];
          });
          // A full page means there may be more history behind it.
          setHasMoreHistory(fetched.length >= 50);
        }
      } catch (e) {
        console.error("fetchMessages error:", e);
      }
    },
    [rpc, activeSessionId]
  );

  // Scroll-up pagination: load the next 50 older than our oldest message.
  const loadOlderMessages = useCallback(async () => {
    if (!selectedChat || loadingOlder || !hasMoreHistory) return;
    const oldest = messages.find((m) => !m.id.startsWith("opt-"));
    if (!oldest) return;
    setLoadingOlder(true);
    setHistoryNote(null);
    const el = msgListRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    try {
      const older = await rpc.call("get_messages", {
        chat_jid: selectedChat.jid,
        limit: 50,
        before: oldest.timestamp,
        session_id: activeSessionId,
      });
      if (Array.isArray(older)) {
        if (older.length < 50) setHasMoreHistory(false);
        if (older.length > 0) {
          setMessages((prev) => {
            const ids = new Set(prev.map((p) => p.id));
            return [...(older as WhatsAppMessage[]).filter((o) => !ids.has(o.id)), ...prev];
          });
          // Keep the viewport where it was instead of jumping.
          requestAnimationFrame(() => {
            if (el) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
          });
        }
      }
    } catch (e) {
      console.error("loadOlderMessages error:", e);
    }
    setLoadingOlder(false);
  }, [selectedChat, loadingOlder, hasMoreHistory, messages, rpc, activeSessionId]);

  // When local history runs out, ask the paired phone for older messages
  // (whatsmeow on-demand history sync). They land in the store shortly;
  // re-enable paging so the next scroll-up picks them up.
  const askPhoneForHistory = useCallback(async () => {
    if (!selectedChat) return;
    setLoadingOlder(true);
    setHistoryNote(null);
    try {
      const res = await rpc.call("fetch_chat_history", {
        chat_jid: selectedChat.jid,
        count: 50,
        session_id: activeSessionId,
      });
      setHistoryNote(res?.message || "Requested older messages from the phone.");
      if (res?.success) {
        setHasMoreHistory(true);
        setTimeout(() => {
          setLoadingOlder(false);
          loadOlderMessages();
        }, 4000);
        return;
      }
    } catch (e) {
      setHistoryNote(e instanceof Error ? e.message : String(e));
    }
    setLoadingOlder(false);
  }, [selectedChat, rpc, activeSessionId, loadOlderMessages]);

  // Multi-account session actions
  const handleSwitchSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    // Remember where we are on the account we leave.
    chatMemoryRef.current.set(activeSessionId, {
      jid: selectedChat?.jid ?? null,
      scrollTop: msgListRef.current?.scrollTop ?? 0,
    });
    setActiveSessionId(sessionId);
    try {
      localStorage.setItem("bb_whatsapp_active_session", sessionId);
    } catch {}
    setSelectedChat(null);
    setMessages([]);
    try {
      await rpc.call("switch_session", { session_id: sessionId });
      const s = await fetchStatus(sessionId);
      if (s?.connected) {
        const cList = await fetchChats("", sessionId);
        if (cList.length > 0) {
          const remembered = chatMemoryRef.current.get(sessionId);
          const restored = remembered?.jid ? cList.find((c) => c.jid === remembered.jid) : undefined;
          const target = restored || cList[0];
          // Restore the scroll only when we actually got the same chat back;
          // applied by the scroll effect below once messages render.
          if (restored && remembered) {
            pendingScrollRestoreRef.current = remembered.scrollTop;
          }
          setSelectedChat(target);
          fetchMessages(target.jid, sessionId);
        }
      }
    } catch (e) {
      console.error("Failed to switch session:", e);
    }
  };

  // Retry pairing / recover a stuck session: rebuild the client in place.
  const handleRetrySession = useCallback(async () => {
    setQrStalled(false);
    try {
      await rpc.call("restart_session", { session_id: activeSessionId });
    } catch (e) {
      console.error("restart_session failed:", e);
    }
    await fetchStatus(activeSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, activeSessionId]);

  const handleCreateSession = async (name?: string) => {
    if (creatingSession) return;
    setCreatingSession(true);
    setErrorMessage(null);
    try {
      // Reuse an existing unpaired session instead of spawning a new junk
      // account tab on every click.
      const unpaired = sessions.find((s) => !s.phone && !s.connected);
      if (unpaired) {
        setActiveSessionId(unpaired.id);
        try {
          localStorage.setItem("bb_whatsapp_active_session", unpaired.id);
        } catch {}
        setSelectedChat(null);
        setMessages([]);
        setActiveTab("chats");
        setStatus((prev) => ({
          ...prev,
          session_id: unpaired.id,
          connected: false,
          status: "connecting",
          phone: "",
          qr: "",
          qrDataUrl: null,
        }));
        await fetchStatus(unpaired.id);
        return;
      }
      // The RPC runtime rejects undefined property values ("not a JSON
      // value"), so omit `name` entirely when no label was given.
      const res = await rpc.call("create_session", name ? { name } : {});
      if (res.success && res.session) {
        const newSid = res.session.id;
        setActiveSessionId(newSid);
        try {
          localStorage.setItem("bb_whatsapp_active_session", newSid);
        } catch {}
        setSelectedChat(null);
        setMessages([]);
        setActiveTab("chats");
        // Optimistically show the pairing screen for the new account so the
        // user gets immediate feedback even before the bridge answers.
        setStatus((prev) => ({
          ...prev,
          session_id: newSid,
          connected: false,
          status: "needs_scan",
          phone: "",
          qr: "",
          qrDataUrl: null,
        }));
        // Bridge no longer switches the active account on create; make the
        // bridge-side active pointer follow the UI's choice explicitly.
        rpc.call("switch_session", { session_id: newSid }).catch(() => {});
        const s = await fetchStatus(newSid);
        // A stale bridge binary silently falls back to the active account for
        // unknown session ids; detect that instead of showing "nothing happened".
        if (s && s.session_id && s.session_id !== newSid) {
          setErrorMessage(
            "The bridge ignored the new account and returned the existing one. The bundled whatsapp-bridge.exe is outdated - rebuild it (in bb-plugin-whatsapp/bridge run: go build -o whatsapp-bridge.exe .) and restart the bridge."
          );
        }
        await fetchSessions();
      } else {
        setErrorMessage(res.message || "Failed to add a new account. Check the bridge and try again.");
      }
    } catch (e: any) {
      console.error("create_session failed:", e);
      setErrorMessage(e?.message || "Failed to add a new account. Check the bridge and try again.");
    } finally {
      setCreatingSession(false);
    }
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length <= 1) return;
    if (!confirm("Disconnect and remove this WhatsApp account from Blackbox?")) {
      return;
    }
    try {
      await rpc.call("delete_session", { session_id: sessionId });
      const remaining = sessions.filter((s) => s.id !== sessionId);
      setSessions(remaining);
      if (activeSessionId === sessionId && remaining.length > 0) {
        handleSwitchSession(remaining[0].id);
      }
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  // Live feed of what agent tools do through this bridge.
  const fetchActivity = useCallback(async () => {
    try {
      const res = await rpc.call("get_agent_activity", {});
      if (res && Array.isArray(res.entries)) {
        setAgentActivity(res.entries as AgentActivityEntry[]);
      }
    } catch {
      // older server without the feed - stay quiet
    }
    try {
      const res = await rpc.call("get_registered_tools", {});
      if (res && Array.isArray(res.tools)) {
        setRegisteredTools(res.tools as RegisteredToolInfo[]);
      }
    } catch {
      // older server without the registry - stay quiet
    }
  }, [rpc]);

  // Mark the QR wait as stalled after 15s without a code so the pairing
  // screen can say so and offer Retry instead of spinning forever.
  useEffect(() => {
    if (status.connected || status.qrDataUrl || status.phone || status.pairing || status.syncing || status.status === "stopped" || status.status === "error") {
      setQrStalled(false);
      return;
    }
    setQrStalled(false);
    const t = setTimeout(() => setQrStalled(true), 15000);
    return () => clearTimeout(t);
  }, [status.connected, status.qrDataUrl, status.phone, status.status, status.session_id]);

  // Initial load and periodic polling
  useEffect(() => {
    let mounted = true;

    async function load() {
      fetchActivity();
      await fetchSessions();
      const s = await fetchStatus(activeSessionId);
      if (mounted && s?.connected) {
        const cList = await fetchChats("", activeSessionId);
        if (mounted && cList.length > 0) {
          setSelectedChat((curr) => {
            const chosen = curr ?? cList[0];
            fetchMessages(chosen.jid, activeSessionId);
            return chosen;
          });
        }
      }
    }

    load();

    pollTimerRef.current = setInterval(async () => {
      fetchActivity();
      const s = await fetchStatus(activeSessionId);
      if (s?.connected) {
        const cList = await fetchChats("", activeSessionId);
        setSelectedChat((curr) => {
          if (!curr && cList.length > 0) {
            fetchMessages(cList[0].jid, activeSessionId);
            return cList[0];
          }
          return curr;
        });
      }
    }, 2500);

    return () => {
      mounted = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchStatus, fetchSessions, fetchChats, fetchMessages, fetchActivity, activeSessionId]);

  // When selected chat changes, load its messages and poll them
  useEffect(() => {
    if (!selectedChat) return;
    setHasMoreHistory(false);
    setHistoryNote(null);
    setLoadingOlder(false);
    lastMsgKeyRef.current = "";
    chatOpenedAtRef.current = Date.now();
    fetchMessages(selectedChat.jid, activeSessionId);
    const msgTimer = setInterval(() => {
      fetchMessages(selectedChat.jid, activeSessionId);
    }, 2500);
    return () => clearInterval(msgTimer);
  }, [selectedChat, fetchMessages, activeSessionId]);

  // Scroll to bottom only when a new message lands at the end (or the chat
  // changed) - prepending older history must not yank the viewport down.
  useEffect(() => {
    // Account switch restore: jump back to where this chat was left
    // instead of scrolling to the newest message.
    if (pendingScrollRestoreRef.current != null && messages.length > 0) {
      const y = pendingScrollRestoreRef.current;
      pendingScrollRestoreRef.current = null;
      const el = msgListRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = y;
        });
      }
      const last = messages[messages.length - 1];
      if (last) lastMsgKeyRef.current = `${selectedChat?.jid}:${last.id}`;
      return;
    }
    const last = messages[messages.length - 1];
    const key = last ? `${selectedChat?.jid}:${last.id}` : "";
    if (key && key !== lastMsgKeyRef.current) {
      lastMsgKeyRef.current = key;
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, selectedChat]);

  const loadAttachmentFile = (file: File, fallbackName?: string) => {
    if (file.size > 15 * 1024 * 1024) {
      setErrorMessage("File is too large (max 15 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.split(",", 2)[1] || "";
      if (!base64) {
        setErrorMessage("Could not read the selected file.");
        return;
      }
      setAttachment({
        dataUrl,
        base64,
        mime: file.type || "application/octet-stream",
        filename: file.name || fallbackName || "file",
        size: file.size,
      });
    };
    reader.onerror = () => setErrorMessage("Could not read the selected file.");
    reader.readAsDataURL(file);
  };

  // Ctrl+V: pasting an image (screenshot, copied picture) into the composer
  // attaches it - the caption field and preview are the existing attachment UI.
  const handleComposerPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const file = Array.from(e.clipboardData?.files || []).find((f) =>
      f.type.startsWith("image/")
    ) || e.clipboardData?.files?.[0];
    if (!file) return; // plain text paste - let the input handle it
    e.preventDefault();
    const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    loadAttachmentFile(file, `pasted-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`);
  };

  // Send message from conversation composer with full optimistic feedback & persistence
  const handleAttachmentPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    loadAttachmentFile(file);
  };

  const handleSendMessage = async () => {
    if (!selectedChat || sending) return;
    const text = messageInput.trim();
    const att = attachment;
    if (!text && !att) return;
    setSending(true);
    setErrorMessage(null);
    const tempId = "opt-" + Date.now();
    const nowIso = new Date().toISOString();

    // Optimistically add message (with local preview for attachments)
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        chat_jid: selectedChat.jid,
        sender: "me",
        content: text,
        timestamp: nowIso,
        is_from_me: true,
        media_type: att
          ? att.mime.startsWith("image/")
            ? "image"
            : att.mime.startsWith("video/")
            ? "video"
            : "document"
          : "",
        filename: att?.filename || "",
        url: att?.dataUrl || "",
        file_length: att?.size || 0,
      },
    ]);
    setMessageInput("");
    setAttachment(null);

    try {
      const res = att
        ? await rpc.call("send_media", {
            recipient: selectedChat.jid,
            caption: text,
            mime_type: att.mime,
            filename: att.filename,
            data_base64: att.base64,
            session_id: activeSessionId,
          })
        : await rpc.call("send_message", {
            recipient: selectedChat.jid,
            message: text,
            session_id: activeSessionId,
          });

      if (res.success) {
        if (res.id) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? {
                    ...m,
                    id: res.id!,
                    timestamp: res.timestamp || m.timestamp,
                    chat_jid: res.chat_jid || m.chat_jid,
                  }
                : m
            )
          );
        }
        setTimeout(() => fetchMessages(selectedChat.jid, activeSessionId), 600);
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setMessageInput(text);
        if (att) setAttachment(att);
        setErrorMessage(res.message || "Failed to deliver message. Check bridge connection.");
      }
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setMessageInput(text);
      if (att) setAttachment(att);
      setErrorMessage(e?.message || "Communication error with WhatsApp bridge.");
    } finally {
      setSending(false);
    }
  };

  // Media download handler: goes through the plugin RPC and reports real
  // failures. Never fake a saved file.
  const handleDownloadMedia = async (msg: WhatsAppMessage) => {
    if (!msg.id || downloadingMedia[msg.id] === "loading") return;

    setDownloadingMedia((prev) => ({ ...prev, [msg.id]: "loading" }));
    setErrorMessage(null);
    try {
      const res = await rpc.call("download_media", {
        message_id: msg.id,
        chat_jid: msg.chat_jid || selectedChat?.jid || "",
        session_id: activeSessionId,
      });

      if (res.success && res.path) {
        setDownloadingMedia((prev) => ({ ...prev, [msg.id]: "downloaded" }));
        setDownloadedPaths((prev) => ({ ...prev, [msg.id]: res.path! }));
      } else {
        // Quiet per-bubble failure state (retry inline), not the global banner.
        setDownloadingMedia((prev) => ({ ...prev, [msg.id]: "failed" }));
      }
    } catch {
      setDownloadingMedia((prev) => ({ ...prev, [msg.id]: "failed" }));
    }
  };

  // Contact search for new chat modal
  const handleSearchContacts = async (query: string) => {
    setNewChatInput(query);
    if (!query.trim()) {
      setContactSearchResults([]);
      return;
    }
    setSearchingContacts(true);
    try {
      const res = await rpc.call("search_contacts", { query: query.trim() });
      if (Array.isArray(res)) {
        setContactSearchResults(res);
      }
    } catch (e) {
      console.error("search_contacts error:", e);
    } finally {
      setSearchingContacts(false);
    }
  };

  // Start new chat with phone number or selected contact
  const handleStartChat = (recipient: string, name?: string) => {
    let clean = recipient.trim();
    if (!clean) return;

    // Normalize phone number to JID if needed
    let jid = clean;
    if (!jid.includes("@")) {
      jid = clean.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
    }

    const displayName = name || clean;
    const existing = chats.find((c) => c.jid === jid);

    if (existing) {
      setSelectedChat(existing);
    } else {
      const newChat: WhatsAppChat = {
        jid,
        name: displayName,
        last_message: "",
        last_message_time: new Date().toISOString(),
        last_sender: "",
        last_is_from_me: false,
      };
      setChats((prev) => [newChat, ...prev]);
      setSelectedChat(newChat);
    }

    setShowNewChatDialog(false);
    setNewChatInput("");
    setContactSearchResults([]);
  };

  // Send test message from tools pane
  const handleSendTestMessage = async () => {
    if (!testRecipient.trim() || !testMessage.trim()) return;
    setTestResult("Sending...");
    try {
      const res = await rpc.call("send_message", {
        recipient: testRecipient.trim(),
        message: testMessage.trim(),
        session_id: activeSessionId,
      });
      setTestResult(res.success ? "Sent" : `Error: ${res.message}`);
      if (res.success) {
        fetchChats();
      }
    } catch (e: any) {
      setTestResult(`Error: ${e.message}`);
    }
  };

  // Filter chats by search
  const filteredChats = chats.filter((c) => {
    if (!chatSearch.trim()) return true;
    const q = chatSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.jid.toLowerCase().includes(q);
  });

  const isTab = (t: string) => activeTab === t;
  const agentMsgIds = new Set(
    agentActivity.filter((a) => a.kind === "send" && a.message_id).map((a) => a.message_id as string)
  );

  const connectionLabel = status.connected
    ? "Connected"
    : status.status === "needs_scan"
    ? "Pairing needed"
    : status.status === "logged_out"
    ? "Logged out"
    : status.status === "stopped"
    ? "Bridge stopped"
    : status.status === "error"
    ? "Error"
    : "Connecting...";

  return (
    <div className="wa-root flex flex-col h-full bg-[var(--wa-app-bg)] text-[var(--wa-text)] font-sans antialiased overflow-hidden">
      <style>{WA_STYLES}</style>

      {/* Photo lightbox: click anywhere to close */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.88)] flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="photo"
            className="max-w-full max-h-full rounded-md object-contain shadow-2xl"
          />
          <button
            onClick={() => setLightboxUrl(null)}
            title="Close"
            className="absolute top-4 right-4 p-2 rounded-full text-white/80 hover:bg-white/10 transition-colors"
          >
            <SvgX className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* ==================== ACCOUNT SESSION BAR ==================== */}
      <div className="h-11 bg-[var(--wa-header)] border-b border-[var(--wa-border)] flex items-center px-2 gap-1 overflow-x-auto shrink-0 no-scrollbar">
        {sessions.map((sess) => {
          const isActive = sess.id === activeSessionId;
          const label = sess.phone ? `+${sess.phone}` : sess.name || sess.id;
          return (
            <div
              key={sess.id}
              onClick={() => handleSwitchSession(sess.id)}
              className={`group relative flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[13px] cursor-pointer transition-colors ${
                isActive
                  ? "bg-[var(--wa-active)] text-[var(--wa-text)]"
                  : "text-[var(--wa-text-secondary)] hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)]"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  sess.connected
                    ? "bg-[var(--wa-accent-strong)]"
                    : sess.status === "needs_scan"
                    ? "bg-[var(--wa-warning)] animate-pulse"
                    : sess.status === "logged_out"
                    ? "bg-[var(--wa-danger)]"
                    : "bg-[var(--wa-text-secondary)]"
                }`}
                title={sess.status}
              />
              <span className="truncate max-w-[140px]">{label}</span>
              {sess.claim_holder && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await rpc.call("force_release_session", { session_id: sess.id });
                  }}
                  title={`Claimed by agent "${sess.claim_holder}"${
                    sess.claim_expires_at
                      ? ` until ${new Date(sess.claim_expires_at).toLocaleTimeString()}`
                      : ""
                  } - click to force-release`}
                  className="flex items-center gap-0.5 px-1 h-4.5 rounded text-[10px] leading-none text-[var(--wa-warning)] hover:bg-[var(--wa-hover)] transition-colors shrink-0"
                >
                  <SvgLock className="w-2.5 h-2.5" />
                  <span className="max-w-[72px] truncate">{sess.claim_holder}</span>
                </button>
              )}
              {sessions.length > 1 && (
                <button
                  onClick={(e) => handleDeleteSession(sess.id, e)}
                  title="Disconnect and remove this account"
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--wa-text-secondary)] hover:text-[var(--wa-danger)] transition-opacity"
                >
                  <SvgX className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={() => handleCreateSession()}
          disabled={creatingSession}
          title="Link another WhatsApp account"
          className="flex items-center gap-1 px-2.5 h-7 rounded-md text-[13px] text-[var(--wa-accent-strong)] hover:bg-[var(--wa-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {creatingSession ? (
            <SvgRefresh className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <SvgPlus className="w-3.5 h-3.5" />
          )}
          <span>{creatingSession ? "Adding..." : "Account"}</span>
        </button>

        <div className="flex-1" />

        {/* Connection state + bridge controls */}
        <span
          className={`flex items-center gap-1.5 text-[12px] shrink-0 ${
            status.connected ? "text-[var(--wa-accent-strong)]" : "text-[var(--wa-text-secondary)]"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status.connected
                ? "bg-[var(--wa-accent-strong)]"
                : status.status === "needs_scan"
                ? "bg-[var(--wa-warning)] animate-pulse"
                : status.status === "logged_out"
                ? "bg-[var(--wa-danger)]"
                : "bg-[var(--wa-text-secondary)]"
            }`}
          />
          {connectionLabel}
        </span>
        <button
          onClick={async () => {
            const next = !status.appearOffline;
            await rpc.call("set_appear_offline", { session_id: activeSessionId, appear_offline: next });
            fetchStatus(activeSessionId);
          }}
          title={status.appearOffline
            ? "Appear offline is ON - contacts can't see when you're online. Click to show your presence again."
            : "Appear offline is OFF. Click to hide your online status (reading here never sends read receipts either)."}
          className={`p-1.5 rounded-full transition-colors shrink-0 ${status.appearOffline ? "text-[var(--wa-accent)] bg-[rgba(0,168,132,0.12)]" : "text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]"}`}
        >
          {status.appearOffline ? <SvgEyeOff className="w-4 h-4" /> : <SvgEye className="w-4 h-4" />}
        </button>
        <button
          onClick={() => {
            fetchStatus();
            fetchChats();
          }}
          title="Refresh"
          className="p-1.5 rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)] transition-colors shrink-0"
        >
          <SvgRefresh className="w-4 h-4" />
        </button>
        <button
          onClick={async () => {
            await rpc.call("restart_bridge");
            fetchStatus();
          }}
          title="Restart bridge"
          className="p-1.5 rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)] transition-colors shrink-0"
        >
          <SvgPower className="w-4 h-4" />
        </button>
      </div>

      {/* Global error banner: visible in every view (chats, tools, pairing) */}
      {errorMessage && (
        <div className="bg-[rgba(241,92,109,0.1)] border-b border-[rgba(241,92,109,0.3)] px-4 py-2 flex items-center justify-between gap-3 text-[13px] text-[var(--wa-danger)] shrink-0">
          <div className="flex items-start gap-2 min-w-0">
            <SvgAlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-words">{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-[var(--wa-danger)] hover:opacity-70 px-1 shrink-0"
            title="Dismiss"
          >
            <SvgX className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ==================== MAIN AREA ==================== */}
      <div className="flex-1 flex overflow-hidden relative">
        {!status.connected ? (
          /* ---------- PAIRING / CONNECTING SCREEN ---------- */
          <div className="wa-chat-doodle flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
            <div className="max-w-sm w-full bg-[var(--wa-panel)] border border-[var(--wa-border)] rounded-lg p-8 flex flex-col items-center text-center shadow-lg">
              {status.status === "logged_out" ? (
                /* Account was force-logged-out: credentials are dead, re-pair */
                <>
                  <div className="w-12 h-12 rounded-full bg-[rgba(241,92,109,0.12)] flex items-center justify-center text-[var(--wa-danger)] mb-4">
                    <SvgAlertTriangle className="w-6 h-6" />
                  </div>
                  <h2 className="text-lg font-light text-[var(--wa-text)] mb-1">
                    Account logged out
                  </h2>
                  <p className="text-[13px] text-[var(--wa-text-secondary)] mb-6 leading-relaxed">
                    WhatsApp closed this session{status.phone ? ` (+${status.phone})` : ""}. This usually happens when a second bridge instance used the same account. Start pairing again to get a fresh QR code.
                  </p>
                  {status.error && (
                    <div className="w-full mb-4 px-3 py-2 rounded-md bg-[rgba(241,92,109,0.1)] border border-[rgba(241,92,109,0.3)] text-[12px] text-[var(--wa-danger)] text-left break-words">
                      {status.error}
                    </div>
                  )}
                  <button
                    onClick={handleRetrySession}
                    className="w-full py-2 px-4 bg-[var(--wa-accent)] hover:bg-[var(--wa-accent-strong)] text-[#111b21] rounded-full text-[14px] font-medium transition-colors"
                  >
                    Re-pair account
                  </button>
                </>
              ) : status.phone && status.error && status.error.includes("Another bridge instance") ? (
                /* StreamReplaced: a second bridge took over this account.
                   Loud and explicit - no fake "reconnecting" spinner, the
                   session stays down until the user resolves it. */
                <>
                  <div className="w-12 h-12 rounded-full bg-[rgba(241,92,109,0.12)] flex items-center justify-center text-[var(--wa-danger)] mb-4">
                    <SvgAlertTriangle className="w-6 h-6" />
                  </div>
                  <h2 className="text-lg font-light text-[var(--wa-danger)] mb-1">
                    Another bridge is using this account
                  </h2>
                  <p className="text-[13px] text-[var(--wa-text-secondary)] mb-6 leading-relaxed">
                    A second bridge instance connected with this account's keys, so this copy stepped back - two clients fighting for one account is what gets it force-logged out by WhatsApp. Close the other bridge (check for a second Blackbox window or a manually started whatsapp-bridge.exe), then take the account back.
                  </p>
                  <div className="flex items-center gap-2.5 w-full">
                    <button
                      onClick={() => fetchStatus()}
                      className="flex-1 py-2 px-4 border border-[var(--wa-border)] text-[var(--wa-text-secondary)] hover:bg-[var(--wa-hover)] rounded-full text-[14px] transition-colors"
                    >
                      Check again
                    </button>
                    <button
                      onClick={handleRetrySession}
                      className="flex-1 py-2 px-4 bg-[var(--wa-accent)] hover:bg-[var(--wa-accent-strong)] text-[#111b21] rounded-full text-[14px] font-medium transition-colors"
                    >
                      Use this device instead
                    </button>
                  </div>
                </>
              ) : status.phone ? (
                /* Paired but offline: reconnecting, NO QR exists for this state */
                <>
                  <div className="w-12 h-12 rounded-full bg-[var(--wa-panel-raised)] flex items-center justify-center text-[var(--wa-accent-strong)] mb-4">
                    <SvgRefresh className="w-6 h-6 animate-spin" />
                  </div>
                  <h2 className="text-lg font-light text-[var(--wa-text)] mb-1">
                    Reconnecting to WhatsApp
                  </h2>
                  <p className="text-[13px] text-[var(--wa-text-secondary)] mb-6 leading-relaxed">
                    +{status.phone} is still paired. The bridge is restoring the connection; this usually takes a few seconds. No QR code is needed.
                  </p>
                  {status.error && (
                    <div className="w-full mb-4 px-3 py-2 rounded-md bg-[rgba(241,92,109,0.1)] border border-[rgba(241,92,109,0.3)] text-[12px] text-[var(--wa-danger)] text-left break-words">
                      {status.error}
                    </div>
                  )}
                  <div className="flex items-center gap-2.5 w-full">
                    <button
                      onClick={() => fetchStatus()}
                      className="flex-1 py-2 px-4 bg-[var(--wa-accent)] hover:bg-[var(--wa-accent-strong)] text-[#111b21] rounded-full text-[14px] font-medium transition-colors"
                    >
                      Check now
                    </button>
                    <button
                      onClick={handleRetrySession}
                      className="py-2 px-4 border border-[var(--wa-border)] text-[var(--wa-text-secondary)] hover:bg-[var(--wa-hover)] rounded-full text-[14px] transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                </>
              ) : (
                /* Unpaired: real pairing flow with QR */
                <>
                  <div className="w-12 h-12 rounded-full bg-[var(--wa-panel-raised)] flex items-center justify-center text-[var(--wa-accent-strong)] mb-4">
                    <SvgWhatsApp className="w-6 h-6" />
                  </div>

                  <h2 className="text-lg font-light text-[var(--wa-text)] mb-1">
                    Link WhatsApp to Blackbox
                  </h2>
                  <p className="text-[13px] text-[var(--wa-text-secondary)] mb-6 leading-relaxed">
                    Scan the QR code with your phone to enable chats and agent tools.
                  </p>

                  <div className="bg-white p-3 rounded-lg mb-6 flex items-center justify-center w-[264px] h-[264px]">
                    {status.qrDataUrl ? (
                      <img
                        src={status.qrDataUrl}
                        alt="Pairing QR code"
                        className="w-60 h-60 select-none"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 text-neutral-500">
                        <SvgRefresh className="w-6 h-6 animate-spin" />
                        <span className="text-xs">
                          {status.status === "stopped"
                            ? "Bridge is stopped"
                            : status.status === "error"
                            ? "Bridge error"
                            : status.pairing || status.syncing
                            ? "Syncing..."
                            : "Requesting QR code..."}
                        </span>
                      </div>
                    )}
                  </div>

                  {(status.pairing || status.syncing) && (
                    <div className="w-full mb-4 px-3 py-2 rounded-md bg-[rgba(0,168,132,0.1)] border border-[rgba(0,168,132,0.35)] text-[12px] text-[var(--wa-accent)] text-left break-words">
                      Phone is logging in and syncing your chats. This can take several minutes - please wait and don't press Retry, restarting now would interrupt the pairing.
                    </div>
                  )}

                  {qrStalled && !status.qrDataUrl && !status.pairing && !status.syncing && (
                    <div className="w-full mb-4 px-3 py-2 rounded-md bg-[rgba(240,179,48,0.1)] border border-[rgba(240,179,48,0.35)] text-[12px] text-[var(--wa-warning)] text-left break-words">
                      No QR code yet. The bridge may be stuck or an outdated whatsapp-bridge.exe is still running. Try pairing again; if it repeats, rebuild the exe (bridge\go build -o whatsapp-bridge.exe .).
                    </div>
                  )}

                  {status.error && (
                    <div className="w-full mb-4 px-3 py-2 rounded-md bg-[rgba(241,92,109,0.1)] border border-[rgba(241,92,109,0.3)] text-[12px] text-[var(--wa-danger)] text-left break-words">
                      {status.error}
                    </div>
                  )}

                  <div className="w-full text-left text-[13px] space-y-2.5 text-[var(--wa-text-secondary)] mb-6">
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full border border-[var(--wa-accent)] text-[var(--wa-accent-strong)] text-[11px] flex items-center justify-center shrink-0">1</span>
                      <span>Open WhatsApp on your phone</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full border border-[var(--wa-accent)] text-[var(--wa-accent-strong)] text-[11px] flex items-center justify-center shrink-0">2</span>
                      <span>Tap Settings &gt; Linked devices</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full border border-[var(--wa-accent)] text-[var(--wa-accent-strong)] text-[11px] flex items-center justify-center shrink-0">3</span>
                      <span>Tap Link a device and point your camera at the code</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 w-full">
                    <button
                      onClick={() => fetchStatus()}
                      className="flex-1 py-2 px-4 bg-[var(--wa-accent)] hover:bg-[var(--wa-accent-strong)] text-[#111b21] rounded-full text-[14px] font-medium transition-colors"
                    >
                      I scanned it
                    </button>
                    <button
                      onClick={handleRetrySession}
                      disabled={Boolean(status.pairing || status.syncing)}
                      title={status.pairing || status.syncing ? "Wait for the sync to finish - restarting now would interrupt the pairing" : undefined}
                      className="py-2 px-4 border border-[var(--wa-border)] text-[var(--wa-text-secondary)] hover:bg-[var(--wa-hover)] rounded-full text-[14px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      Retry pairing
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : activeTab === "tools" ? (
          /* ---------- AGENT TOOLS & DIAGNOSTICS ---------- */
          <div className="flex-1 flex flex-col bg-[var(--wa-chat-bg)] overflow-y-auto">
            {/* Tools header: always-visible way back to Chats */}
            <div className="h-[60px] px-3 bg-[var(--wa-header)] flex items-center gap-2 shrink-0 sticky top-0 z-10 border-b border-[var(--wa-border)]">
              <button
                onClick={() => setActiveTab("chats")}
                title="Back to chats"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] text-[var(--wa-text-secondary)] hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)] transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                </svg>
                <span>Chats</span>
              </button>
              <span className="text-[15px] font-medium text-[var(--wa-text)]">Agent tools</span>
            </div>
            <div className="max-w-3xl w-full mx-auto space-y-4 p-6">
              <div className="bg-[var(--wa-panel)] border border-[var(--wa-border)] rounded-lg p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-[var(--wa-text)] font-medium text-[15px]">
                    <SvgTerminal className="w-4 h-4 text-[var(--wa-accent-strong)]" />
                    <span>Agent interface</span>
                  </div>
                  <span className="text-[12px] text-[var(--wa-accent-strong)]">
                    {registeredTools.length} tools registered
                  </span>
                </div>
                <p className="text-[13px] text-[var(--wa-text-secondary)] leading-relaxed mb-4">
                  Agents in Blackbox threads can read chat history, resolve contacts and send messages through this bridge.
                </p>
                <div className="grid grid-cols-3 gap-2.5 text-[13px]">
                  <div className="bg-[var(--wa-panel-raised)] p-2.5 rounded-md">
                    <div className="text-[11px] text-[var(--wa-text-secondary)] uppercase tracking-wide">Paired phone</div>
                    <div className="text-[var(--wa-text)] mt-0.5">+{status.phone || "—"}</div>
                  </div>
                  <div className="bg-[var(--wa-panel-raised)] p-2.5 rounded-md">
                    <div className="text-[11px] text-[var(--wa-text-secondary)] uppercase tracking-wide">Synced chats</div>
                    <div className="text-[var(--wa-accent-strong)] mt-0.5">{chats.length}</div>
                  </div>
                  <div className="bg-[var(--wa-panel-raised)] p-2.5 rounded-md">
                    <div className="text-[11px] text-[var(--wa-text-secondary)] uppercase tracking-wide">Engine</div>
                    <div className="text-[var(--wa-text)] mt-0.5">whatsmeow</div>
                  </div>
                </div>
              </div>

              <div className="bg-[var(--wa-panel)] border border-[var(--wa-border)] rounded-lg p-5">
                <h3 className="text-[13px] font-medium text-[var(--wa-text)] uppercase tracking-wide mb-3">
                  Quick dispatcher
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-[12px] text-[var(--wa-text-secondary)] block mb-1">Recipient phone or JID</label>
                    <input
                      type="text"
                      placeholder="+1234567890 or 1234567890@s.whatsapp.net"
                      value={testRecipient}
                      onChange={(e) => setTestRecipient(e.target.value)}
                      className="w-full bg-[var(--wa-input)] border border-transparent rounded-lg px-3 py-2 text-[13px] text-[var(--wa-text)] placeholder-[var(--wa-text-secondary)] focus:outline-none focus:border-[var(--wa-accent)]"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] text-[var(--wa-text-secondary)] block mb-1">Message</label>
                    <textarea
                      placeholder="Type a test message..."
                      rows={2}
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      className="w-full bg-[var(--wa-input)] border border-transparent rounded-lg px-3 py-2 text-[13px] text-[var(--wa-text)] placeholder-[var(--wa-text-secondary)] focus:outline-none focus:border-[var(--wa-accent)] resize-none"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={handleSendTestMessage}
                      className="px-5 py-2 bg-[var(--wa-accent)] hover:bg-[var(--wa-accent-strong)] text-[#111b21] rounded-full text-[14px] font-medium transition-colors"
                    >
                      Send
                    </button>
                    {testResult && (
                      <span className="text-[12px] text-[var(--wa-text-secondary)]">{testResult}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-[var(--wa-panel)] border border-[var(--wa-border)] rounded-lg p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[13px] font-medium text-[var(--wa-text)] uppercase tracking-wide">
                    Registered agent tools
                  </h3>
                  <span className="text-[12px] text-[var(--wa-text-secondary)]">{registeredTools.length} tools</span>
                </div>
                <div className="divide-y divide-[var(--wa-border)] text-[13px]">
                  {registeredTools.map((t) => (
                    <div key={t.name} className="py-2.5 flex items-start justify-between gap-4">
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[var(--wa-accent-strong)]">{t.name}</span>
                          <span
                            className={`text-[10px] px-1.5 rounded ${
                              t.category === "Write"
                                ? "bg-[rgba(240,179,48,0.12)] text-[var(--wa-warning)]"
                                : t.category === "Read"
                                ? "bg-[rgba(83,189,235,0.12)] text-[var(--wa-tick-read)]"
                                : "bg-[var(--wa-panel-raised)] text-[var(--wa-text-secondary)]"
                            }`}
                          >
                            {t.category}
                          </span>
                        </div>
                        <span className="text-[var(--wa-text-secondary)] text-[12px] mt-0.5 leading-snug">{t.description}</span>
                      </div>
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--wa-accent-strong)] shrink-0 mt-1.5" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Live agent activity: what the AI does through this bridge */}
              <div className="bg-[var(--wa-panel)] border border-[var(--wa-border)] rounded-lg p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[13px] font-medium text-[var(--wa-text)] uppercase tracking-wide">
                    Agent activity
                  </h3>
                  <span className="text-[12px] text-[var(--wa-text-secondary)]">
                    {agentActivity.length} events
                  </span>
                </div>
                {agentActivity.length === 0 ? (
                  <p className="text-[13px] text-[var(--wa-text-secondary)]">
                    Nothing yet. Every tool an agent calls through this bridge shows up here in real time.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--wa-border)] text-[13px] max-h-72 overflow-y-auto">
                    {agentActivity.map((a, i) => (
                      <div key={a.ts + i} className="py-2 flex items-start gap-2.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                            a.ok ? "bg-[var(--wa-accent-strong)]" : "bg-[var(--wa-danger)]"
                          }`}
                        />
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[var(--wa-accent-strong)]">{a.tool}</span>
                            {a.kind === "send" && (
                              <span className="text-[10px] px-1.5 rounded bg-[rgba(240,179,48,0.12)] text-[var(--wa-warning)]">
                                sent
                              </span>
                            )}
                            <span className="text-[11px] text-[var(--wa-text-secondary)]">
                              {formatTime(a.ts)}
                              {a.duration_ms != null ? ` - ${a.duration_ms}ms` : ""}
                            </span>
                          </div>
                          {a.recipient && (
                            <span className="text-[12px] text-[var(--wa-text)] truncate">
                              to: {a.recipient}
                            </span>
                          )}
                          {a.summary && (
                            <span className="text-[12px] text-[var(--wa-text-secondary)] break-words">
                              {a.summary}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ---------- CHAT CLIENT ---------- */
          <>
            {/* Chat list column */}
            <div className={isNarrow ? (selectedChat ? "hidden" : "flex-1 bg-[var(--wa-panel)] border-r border-[var(--wa-border)] flex flex-col min-w-0") : sidebarCollapsed ? "w-[56px] bg-[var(--wa-panel)] border-r border-[var(--wa-border)] flex flex-col shrink-0" : "w-[340px] max-w-[40%] bg-[var(--wa-panel)] border-r border-[var(--wa-border)] flex flex-col shrink-0"}>
              {/* List header: title + tabs + new chat */}
              <div className={`h-[60px] bg-[var(--wa-header)] flex items-center shrink-0 ${sidebarCollapsed ? "justify-center px-0" : "justify-between px-4"}`}>
                {!sidebarCollapsed && (
                <>
                <div className="flex bg-[var(--wa-input)] p-0.5 rounded-full text-[13px]">
                  <button
                    onClick={() => setActiveTab("chats")}
                    className={`px-3.5 py-1 rounded-full transition-colors ${
                      isTab("chats")
                        ? "bg-[var(--wa-active)] text-[var(--wa-text)]"
                        : "text-[var(--wa-text-secondary)] hover:text-[var(--wa-text)]"
                    }`}
                  >
                    Chats
                  </button>
                  <button
                    onClick={() => setActiveTab("tools")}
                    className={`px-3.5 py-1 rounded-full transition-colors ${
                      isTab("tools")
                        ? "bg-[var(--wa-active)] text-[var(--wa-text)]"
                        : "text-[var(--wa-text-secondary)] hover:text-[var(--wa-text)]"
                    }`}
                  >
                    Agent tools
                  </button>
                </div>
                <button
                  onClick={() => setShowNewChatDialog(true)}
                  title="New chat"
                  className="p-2 rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)] transition-colors"
                >
                  <SvgPlus className="w-5 h-5" />
                </button>
                </>
                )}
                <button
                  onClick={() =>
                    setSidebarCollapsed((v) => {
                      const next = !v;
                      try {
                        localStorage.setItem("bb_whatsapp_sidebar_collapsed", next ? "1" : "0");
                      } catch { /* storage unavailable - keep in-memory only */ }
                      return next;
                    })
                  }
                  title={sidebarCollapsed ? "Show chat list" : "Hide chat list"}
                  className="p-2 rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)] transition-colors"
                >
                  {sidebarCollapsed ? <SvgChevronRight className="w-4 h-4" /> : <SvgChevronLeft className="w-4 h-4" />}
                </button>
              </div>

              {/* Search */}
              {!sidebarCollapsed && (
              <div className="px-3 py-2 shrink-0">
                <div className="relative flex items-center">
                  <SvgSearch className="w-4 h-4 absolute left-3 text-[var(--wa-text-secondary)]" />
                  <input
                    type="text"
                    placeholder="Search or start a new chat"
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                    className="w-full bg-[var(--wa-input)] border border-transparent rounded-lg pl-9 pr-3 py-1.5 text-[14px] text-[var(--wa-text)] placeholder-[var(--wa-text-secondary)] focus:outline-none"
                  />
                </div>
              </div>

              )}
              {/* Chat items */}
              {!sidebarCollapsed && (
              <div className="flex-1 overflow-y-auto">
                {filteredChats.length === 0 ? (
                  <div className="p-8 text-center text-[13px] text-[var(--wa-text-secondary)] flex flex-col items-center gap-2">
                    {chats.length === 0 ? (
                      <>
                        <SvgRefresh className="w-4 h-4 animate-spin" />
                        <span>Syncing chats...</span>
                      </>
                    ) : (
                      <span>No chats found</span>
                    )}
                  </div>
                ) : (
                  filteredChats.map((chat) => {
                    const isSelected = selectedChat?.jid === chat.jid;
                    return (
                      <div
                        key={chat.jid}
                        onClick={() => {
                          setSelectedChat(chat);
                          setErrorMessage(null);
                        }}
                        className={`px-3 py-2 cursor-pointer flex items-center gap-3 transition-colors border-t border-[var(--wa-border)] first:border-t-0 ${
                          isSelected ? "bg-[var(--wa-active)]" : "hover:bg-[var(--wa-hover)]"
                        }`}
                      >
                        <Avatar name={chat.name || chat.jid} />
                        <div className="flex-1 min-w-0 py-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[16px] text-[var(--wa-text)] truncate">
                              {chat.name || chat.jid}
                            </span>
                            <span className="text-[12px] text-[var(--wa-text-secondary)] shrink-0">
                              {formatListTime(chat.last_message_time)}
                            </span>
                          </div>
                          <p className="text-[13px] text-[var(--wa-text-secondary)] truncate mt-0.5">
                            {chat.last_is_from_me ? (
                              <SvgCheckCheck className="w-3.5 h-3.5 inline mr-1 text-[var(--wa-tick-read)]" />
                            ) : null}
                            {chat.last_message || " "}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              )}
            </div>

            {/* Conversation column */}
            <div className={isNarrow && !selectedChat ? "hidden" : "flex-1 flex flex-col overflow-hidden min-w-0"}>
              {selectedChat ? (
                <>
                  {/* Conversation header */}
                  <div className="h-[60px] px-4 bg-[var(--wa-header)] flex items-center gap-3 shrink-0">
                    {isNarrow && (
                      <button
                        onClick={() => setSelectedChat(null)}
                        className="mr-1 -ml-1 p-1.5 rounded-full hover:bg-[var(--wa-border)] transition-colors text-[var(--wa-text-secondary)]"
                        title="Back to chats"
                      >
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                      </button>
                    )}
                    <Avatar name={selectedChat.name || selectedChat.jid} size="lg" />
                    <div className="min-w-0">
                      <h3 className="text-[16px] text-[var(--wa-text)] truncate leading-tight">
                        {selectedChat.name || selectedChat.jid}
                      </h3>
                      <span className="text-[13px] text-[var(--wa-text-secondary)] truncate block">
                        {selectedChat.jid.endsWith("@g.us") ? "Group" : "online"}
                      </span>
                    </div>
                  </div>

                  {/* Messages */}
                  <div
                    ref={msgListRef}
                    onScroll={(e) => {
                      // Ignore the smooth scroll-to-bottom that runs right
                      // after opening a chat - it passes through the top.
                      if (Date.now() - chatOpenedAtRef.current < 2000) return;
                      const el = e.currentTarget;
                      if (el.scrollTop < 80 && hasMoreHistory && !loadingOlder) {
                        loadOlderMessages();
                      }
                    }}
                    className="wa-chat-doodle flex-1 overflow-y-auto px-[8%] py-4 space-y-1.5"
                  >
                    {messages.length > 0 && (
                      <div className="flex justify-center pb-2">
                        {loadingOlder ? (
                          <span className="bg-[var(--wa-panel-raised)] text-[var(--wa-text-secondary)] text-[12px] px-3 py-1 rounded-full">
                            Loading older messages...
                          </span>
                        ) : hasMoreHistory ? (
                          <button
                            onClick={loadOlderMessages}
                            className="bg-[var(--wa-panel-raised)] text-[var(--wa-accent)] text-[12px] px-3 py-1 rounded-full hover:brightness-110 transition"
                          >
                            Load older messages
                          </button>
                        ) : (
                          <button
                            onClick={askPhoneForHistory}
                            title="WhatsApp delivers full history on first pairing; afterwards the phone can backfill older messages on request"
                            className="bg-[var(--wa-panel-raised)] text-[var(--wa-accent)] text-[12px] px-3 py-1 rounded-full hover:brightness-110 transition"
                          >
                            Ask phone for older messages
                          </button>
                        )}
                      </div>
                    )}
                    {historyNote && (
                      <div className="flex justify-center pb-1">
                        <span className="bg-[var(--wa-panel-raised)] text-[var(--wa-text-secondary)] text-[12px] px-3 py-1 rounded-full">
                          {historyNote}
                        </span>
                      </div>
                    )}
                    {messages.length === 0 ? (
                      <div className="h-full flex items-center justify-center">
                        <span className="bg-[var(--wa-panel-raised)] text-[var(--wa-text-secondary)] text-[13px] px-4 py-1.5 rounded-md">
                          No messages here yet
                        </span>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isMe = msg.is_from_me;
                        const dlStatus = downloadingMedia[msg.id];
                        const dlPath = downloadedPaths[msg.id];

                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                          >
                            <div
                              className={`relative max-w-[65%] rounded-lg px-2 pt-1.5 pb-1 text-[14.2px] leading-[19px] shadow-sm break-words ${
                                isMe
                                  ? "bg-[var(--wa-bubble-out)] text-[var(--wa-text)] rounded-tr-none"
                                  : "bg-[var(--wa-bubble-in)] text-[var(--wa-text)] rounded-tl-none"
                              }`}
                            >
                              {!isMe && selectedChat?.jid?.endsWith("@g.us") && (
                                <div className="text-[12.5px] text-[var(--wa-tick-read)] font-medium px-1">
                                  {msg.sender_name || msg.sender.split("@")[0]}
                                </div>
                              )}

                              {msg.content && (
                                <p className="px-1 whitespace-pre-wrap">{msg.content}</p>
                              )}

                              {/* Media attachment */}
                              {msg.media_type && msg.media_type.includes("image") && msg.url.startsWith("data:") ? (
                                <img
                                  src={msg.url}
                                  alt={msg.filename || "photo"}
                                  onClick={() => setLightboxUrl(msg.url)}
                                  className="rounded-md max-w-[280px] max-h-[320px] object-cover mx-1 mt-1.5 cursor-zoom-in"
                                />
                              ) : msg.media_type ? (
                                <>
                                {msg.media_type.includes("image") && (
                                  <MediaImagePreview msg={msg} onOpen={setLightboxUrl} sessionId={activeSessionId} />
                                )}
                                <div className="mx-1 mt-1.5">
                                  <div className="flex items-center justify-between gap-3 bg-[rgba(0,0,0,0.15)] rounded-md p-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      {msg.media_type.includes("image") ? (
                                        <SvgImage className="w-4 h-4 text-[var(--wa-accent-strong)] shrink-0" />
                                      ) : (
                                        <SvgFile className="w-4 h-4 text-[var(--wa-accent-strong)] shrink-0" />
                                      )}
                                      <div className="min-w-0">
                                        <p className="text-[13px] truncate text-[var(--wa-text)]">
                                          {msg.filename || `${msg.media_type} attachment`}
                                        </p>
                                        <span className="text-[11px] text-[var(--wa-text-secondary)]">
                                          {msg.file_length > 0
                                            ? `${(msg.file_length / 1024).toFixed(1)} KB • `
                                            : ""}
                                          {msg.media_type}
                                        </span>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => handleDownloadMedia(msg)}
                                      disabled={dlStatus === "loading"}
                                      title={dlPath ? `Saved to: ${dlPath}` : "Download to disk"}
                                      className={`p-1.5 rounded-full shrink-0 transition-colors ${
                                        dlStatus === "downloaded"
                                          ? "text-[var(--wa-accent-strong)]"
                                          : dlStatus === "failed"
                                          ? "text-[var(--wa-danger)]"
                                          : "text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]"
                                      }`}
                                    >
                                      {dlStatus === "loading" ? (
                                        <SvgRefresh className="w-4 h-4 animate-spin" />
                                      ) : dlStatus === "downloaded" ? (
                                        <SvgCheck className="w-4 h-4" />
                                      ) : (
                                        <SvgDownload className="w-4 h-4" />
                                      )}
                                    </button>
                                  </div>
                                  {dlPath && (
                                    <div className="mt-1 text-[11px] text-[var(--wa-text-secondary)] truncate">
                                      Saved: {dlPath}
                                    </div>
                                  )}
                                  {/* Images already carry the retry row inside the preview - keep one retry per bubble. */}
                                  {dlStatus === "failed" && !dlPath && !msg.media_type.includes("image") && (
                                    <button
                                      onClick={() => handleDownloadMedia(msg)}
                                      className="mt-1 text-[12px] text-[var(--wa-text-secondary)] underline decoration-dotted underline-offset-2 hover:text-[var(--wa-text)] transition-colors"
                                    >
                                      Не удалось загрузить — повторить
                                    </button>
                                  )}
                                </div>
                                </>
                              ) : null}

                              {/* Time + ticks (+ agent badge for tool-sent messages) */}
                              <span className="float-right flex items-center gap-1 text-[11px] mt-1 ml-2 mr-1 text-[var(--wa-text-secondary)]">
                                {isMe && agentMsgIds.has(msg.id) && (
                                  <span className="text-[10px] px-1 rounded bg-[rgba(83,189,235,0.12)] text-[var(--wa-tick-read)]">
                                    agent
                                  </span>
                                )}
                                {formatTime(msg.timestamp)}
                                {isMe && <SvgCheckCheck className="w-3.5 h-3.5 text-[var(--wa-tick-read)]" />}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Attachment preview */}
                  {attachment && (
                    <div className="px-4 py-2 bg-[var(--wa-header)] border-t border-[var(--wa-border)] flex items-center gap-3 shrink-0">
                      {attachment.mime.startsWith("image/") ? (
                        <img
                          src={attachment.dataUrl}
                          alt={attachment.filename}
                          className="w-12 h-12 rounded-md object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-[var(--wa-panel-raised)] flex items-center justify-center text-[var(--wa-accent-strong)] shrink-0">
                          <SvgFile className="w-5 h-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-[var(--wa-text)] truncate">{attachment.filename}</p>
                        <span className="text-[11px] text-[var(--wa-text-secondary)]">
                          {(attachment.size / 1024).toFixed(1)} KB - caption goes in the message box
                        </span>
                      </div>
                      <button
                        onClick={() => setAttachment(null)}
                        title="Remove attachment"
                        className="p-1.5 rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)] shrink-0"
                      >
                        <SvgX className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Composer */}
                  <div className="px-4 py-2 bg-[var(--wa-header)] flex items-center gap-2 shrink-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={handleAttachmentPick}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      title="Send a photo or video"
                      className="w-10 h-10 rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)] transition-colors flex items-center justify-center shrink-0"
                    >
                      <SvgImage className="w-5 h-5" />
                    </button>
                    <input
                      type="text"
                      placeholder={attachment ? "Add a caption..." : "Type a message"}
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onPaste={handleComposerPaste}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      className="flex-1 bg-[var(--wa-input)] border border-transparent rounded-lg px-4 py-2.5 text-[15px] text-[var(--wa-text)] placeholder-[var(--wa-text-secondary)] focus:outline-none"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={(!messageInput.trim() && !attachment) || sending}
                      className="w-10 h-10 bg-[var(--wa-accent)] hover:bg-[var(--wa-accent-strong)] disabled:bg-[var(--wa-input)] disabled:text-[var(--wa-text-secondary)] text-[#111b21] rounded-full transition-colors flex items-center justify-center shrink-0"
                    >
                      {sending ? (
                        <SvgRefresh className="w-5 h-5 animate-spin" />
                      ) : (
                        <SvgSend className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="wa-chat-doodle flex-1 flex flex-col items-center justify-center text-center p-6 border-b-[6px] border-[var(--wa-accent)]">
                  <div className="w-16 h-16 rounded-full bg-[var(--wa-panel-raised)] flex items-center justify-center text-[var(--wa-text-secondary)] mb-4">
                    <SvgWhatsApp className="w-8 h-8" />
                  </div>
                  <p className="text-[14px] text-[var(--wa-text-secondary)] mb-4">
                    Select a chat to start messaging
                  </p>
                  <button
                    onClick={() => setShowNewChatDialog(true)}
                    className="px-5 py-2 bg-[var(--wa-accent)] hover:bg-[var(--wa-accent-strong)] text-[#111b21] rounded-full text-[14px] font-medium transition-colors"
                  >
                    New chat
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ---------- NEW CHAT MODAL ---------- */}
        {showNewChatDialog && (
          <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--wa-panel)] border border-[var(--wa-border)] rounded-lg max-w-sm w-full shadow-xl overflow-hidden">
              <div className="px-4 py-3 bg-[var(--wa-header)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SvgPhone className="w-4 h-4 text-[var(--wa-accent-strong)]" />
                  <h3 className="text-[15px] font-medium text-[var(--wa-text)]">New chat</h3>
                </div>
                <button
                  onClick={() => {
                    setShowNewChatDialog(false);
                    setNewChatInput("");
                    setContactSearchResults([]);
                  }}
                  className="p-1 rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]"
                >
                  <SvgX className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Phone number or contact name"
                    value={newChatInput}
                    onChange={(e) => handleSearchContacts(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newChatInput.trim()) {
                        handleStartChat(newChatInput.trim());
                      }
                    }}
                    autoFocus
                    className="w-full bg-[var(--wa-input)] border border-transparent rounded-lg px-3 py-2 text-[14px] text-[var(--wa-text)] placeholder-[var(--wa-text-secondary)] focus:outline-none focus:border-[var(--wa-accent)]"
                  />
                  {searchingContacts && (
                    <SvgRefresh className="w-4 h-4 animate-spin absolute right-3 top-2.5 text-[var(--wa-text-secondary)]" />
                  )}
                </div>

                {contactSearchResults.length > 0 && (
                  <div className="max-h-48 overflow-y-auto divide-y divide-[var(--wa-border)] border border-[var(--wa-border)] rounded-lg">
                    {contactSearchResults.map((contact) => (
                      <div
                        key={contact.jid}
                        onClick={() => handleStartChat(contact.jid, contact.name)}
                        className="px-3 py-2.5 hover:bg-[var(--wa-hover)] cursor-pointer flex items-center gap-3 transition-colors"
                      >
                        <Avatar name={contact.name || contact.jid} size="lg" />
                        <div className="min-w-0">
                          <p className="text-[14px] text-[var(--wa-text)] truncate">{contact.name}</p>
                          <span className="text-[12px] text-[var(--wa-text-secondary)]">
                            {contact.phone_number || contact.jid}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => {
                      setShowNewChatDialog(false);
                      setNewChatInput("");
                      setContactSearchResults([]);
                    }}
                    className="px-4 py-1.5 text-[var(--wa-accent-strong)] hover:bg-[var(--wa-hover)] rounded-full text-[14px] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleStartChat(newChatInput.trim())}
                    disabled={!newChatInput.trim()}
                    className="px-5 py-1.5 bg-[var(--wa-accent)] hover:bg-[var(--wa-accent-strong)] disabled:opacity-40 text-[#111b21] rounded-full text-[14px] font-medium transition-colors"
                  >
                    Open chat
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  // 1. Sidebar Nav Panel: WhatsApp
  app.slots.navPanel({
    id: "whatsapp",
    title: "WhatsApp",
    icon: "MessageSquare",
    path: "whatsapp",
    component: WhatsAppView,
  });

  // 2. Thread Panel Tab: Side-by-side with chat
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "whatsapp",
    title: "WhatsApp",
    icon: "MessageSquare",
    layout: "flush",
    component: WhatsAppView,
  });
});
