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
  SvgFile,
  SvgAlertTriangle,
  SvgDownload,
  SvgPlus,
  SvgX,
  SvgImage,
  SvgUser,
} from "./components/icons";

interface RegisteredToolInfo {
  name: string;
  desc: string;
  category: "Read" | "Write" | "System";
}

const REGISTERED_TOOLS: RegisteredToolInfo[] = [
  { name: "whatsapp_status", desc: "Check bridge state, connection, paired phone, and QR pairing status.", category: "System" },
  { name: "whatsapp_list_chats", desc: "List recent WhatsApp chats with last message preview and timestamps.", category: "Read" },
  { name: "whatsapp_list_messages", desc: "Query message history with filters (query, date, limit).", category: "Read" },
  { name: "whatsapp_search_contacts", desc: "Lookup contacts by name or phone number.", category: "Read" },
  { name: "whatsapp_get_chat", desc: "Get metadata and state for a specific chat by JID.", category: "Read" },
  { name: "whatsapp_get_direct_chat", desc: "Find or resolve the 1-on-1 direct chat for a given phone number.", category: "Read" },
  { name: "whatsapp_get_contact_chats", desc: "List all chats involving a specific contact or phone number.", category: "Read" },
  { name: "whatsapp_get_last_interaction", desc: "Retrieve the most recent message exchanged with a contact.", category: "Read" },
  { name: "whatsapp_get_message_context", desc: "Retrieve surrounding messages before and after a given message ID.", category: "Read" },
  { name: "whatsapp_send_message", desc: "Dispatch text messages to any phone number or group JID.", category: "Write" },
  { name: "whatsapp_send_file", desc: "Send documents, images, audio files to contacts.", category: "Write" },
  { name: "whatsapp_download_media", desc: "Download attached media files to local disk and return their file path.", category: "Read" },
];

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
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<"chats" | "tools">("chats");

  // Error banner feedback
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  // Fetch messages with optimistic preservation so sent messages never disappear
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
          setMessages((prev) => {
            const now = Date.now();
            // Retain recent optimistic unconfirmed messages (< 15s) not yet in msgs
            const pendingOptimistic = prev.filter(
              (p) =>
                p.chat_jid === chatJid &&
                p.id.startsWith("opt-") &&
                now - new Date(p.timestamp).getTime() < 15000 &&
                !msgs.some((m) => m.content === p.content && m.is_from_me)
            );
            return [...msgs, ...pendingOptimistic];
          });
        }
      } catch (e) {
        console.error("fetchMessages error:", e);
      }
    },
    [rpc, activeSessionId]
  );

  // Multi-account session actions
  const handleSwitchSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
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
          setSelectedChat(cList[0]);
          fetchMessages(cList[0].jid, sessionId);
        }
      }
    } catch (e) {
      console.error("Failed to switch session:", e);
    }
  };

  const handleCreateSession = async (name?: string) => {
    if (creatingSession) return;
    setCreatingSession(true);
    setErrorMessage(null);
    try {
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

  // Initial load and periodic polling
  useEffect(() => {
    let mounted = true;

    async function load() {
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
  }, [fetchStatus, fetchSessions, fetchChats, fetchMessages, activeSessionId]);

  // When selected chat changes, load its messages and poll them
  useEffect(() => {
    if (!selectedChat) return;
    fetchMessages(selectedChat.jid, activeSessionId);
    const msgTimer = setInterval(() => {
      fetchMessages(selectedChat.jid, activeSessionId);
    }, 2500);
    return () => clearInterval(msgTimer);
  }, [selectedChat, fetchMessages, activeSessionId]);

  // Scroll to bottom of message list on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Send message from conversation composer with full optimistic feedback & persistence
  const handleSendMessage = async () => {
    if (!selectedChat || !messageInput.trim() || sending) return;
    setSending(true);
    setErrorMessage(null);
    const text = messageInput.trim();
    const tempId = "opt-" + Date.now();
    const nowIso = new Date().toISOString();

    // Optimistically add message
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        chat_jid: selectedChat.jid,
        sender: "me",
        content: text,
        timestamp: nowIso,
        is_from_me: true,
        media_type: "",
        filename: "",
        url: "",
        file_length: 0,
      },
    ]);
    setMessageInput("");

    try {
      const res = await rpc.call("send_message", {
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
        setErrorMessage(res.message || "Failed to deliver message. Check bridge connection.");
      }
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
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
        setDownloadingMedia((prev) => ({ ...prev, [msg.id]: "failed" }));
        setErrorMessage(res.message || "Failed to download media. It may have expired on WhatsApp servers.");
      }
    } catch (e: any) {
      setDownloadingMedia((prev) => ({ ...prev, [msg.id]: "failed" }));
      setErrorMessage(e?.message || "Communication error with WhatsApp bridge.");
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

  const connectionLabel = status.connected
    ? "Connected"
    : status.status === "needs_scan"
    ? "Pairing needed"
    : status.status === "stopped"
    ? "Bridge stopped"
    : status.status === "error"
    ? "Error"
    : "Connecting...";

  return (
    <div className="wa-root flex flex-col h-full bg-[var(--wa-app-bg)] text-[var(--wa-text)] font-sans antialiased overflow-hidden">
      <style>{WA_STYLES}</style>

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
                    : "bg-[var(--wa-text-secondary)]"
                }`}
                title={sess.status}
              />
              <span className="truncate max-w-[140px]">{label}</span>
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
                : "bg-[var(--wa-text-secondary)]"
            }`}
          />
          {connectionLabel}
        </span>
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
                        : "Requesting QR code..."}
                    </span>
                  </div>
                )}
              </div>

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
                  onClick={async () => {
                    await rpc.call("restart_bridge");
                    fetchStatus();
                  }}
                  className="py-2 px-4 border border-[var(--wa-border)] text-[var(--wa-text-secondary)] hover:bg-[var(--wa-hover)] rounded-full text-[14px] transition-colors"
                >
                  Restart bridge
                </button>
              </div>
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
                    {REGISTERED_TOOLS.length} tools registered
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
                  <span className="text-[12px] text-[var(--wa-text-secondary)]">12 tools</span>
                </div>
                <div className="divide-y divide-[var(--wa-border)] text-[13px]">
                  {REGISTERED_TOOLS.map((t) => (
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
                        <span className="text-[var(--wa-text-secondary)] text-[12px] mt-0.5 leading-snug">{t.desc}</span>
                      </div>
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--wa-accent-strong)] shrink-0 mt-1.5" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ---------- CHAT CLIENT ---------- */
          <>
            {/* Chat list column */}
            <div className="w-[340px] max-w-[40%] bg-[var(--wa-panel)] border-r border-[var(--wa-border)] flex flex-col shrink-0">
              {/* List header: title + tabs + new chat */}
              <div className="h-[60px] px-4 bg-[var(--wa-header)] flex items-center justify-between shrink-0">
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
              </div>

              {/* Search */}
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

              {/* Chat items */}
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
            </div>

            {/* Conversation column */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {selectedChat ? (
                <>
                  {/* Conversation header */}
                  <div className="h-[60px] px-4 bg-[var(--wa-header)] flex items-center gap-3 shrink-0">
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
                  <div className="wa-chat-doodle flex-1 overflow-y-auto px-[8%] py-4 space-y-1.5">
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
                              {msg.media_type && (
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
                                </div>
                              )}

                              {/* Time + ticks */}
                              <span className="float-right flex items-center gap-1 text-[11px] mt-1 ml-2 mr-1 text-[var(--wa-text-secondary)]">
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

                  {/* Composer */}
                  <div className="px-4 py-2 bg-[var(--wa-header)] flex items-center gap-2 shrink-0">
                    <input
                      type="text"
                      placeholder="Type a message"
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
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
                      disabled={!messageInput.trim() || sending}
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
