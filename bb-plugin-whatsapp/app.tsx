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
  SvgQrCode,
  SvgPhone,
  SvgTerminal,
  SvgPower,
  SvgCopy,
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
  status: "active" | "ready";
}

const REGISTERED_TOOLS: RegisteredToolInfo[] = [
  { name: "whatsapp_status", desc: "Check bridge state, connection, paired phone, and QR pairing status.", category: "System", status: "active" },
  { name: "whatsapp_list_chats", desc: "List recent WhatsApp chats with last message preview and timestamps.", category: "Read", status: "active" },
  { name: "whatsapp_list_messages", desc: "Query message history with filters (query, date, limit).", category: "Read", status: "active" },
  { name: "whatsapp_search_contacts", desc: "Lookup contacts by name or phone number.", category: "Read", status: "active" },
  { name: "whatsapp_get_chat", desc: "Get metadata and state for a specific chat by JID.", category: "Read", status: "active" },
  { name: "whatsapp_get_direct_chat", desc: "Find or resolve the 1-on-1 direct chat for a given phone number.", category: "Read", status: "active" },
  { name: "whatsapp_get_contact_chats", desc: "List all chats involving a specific contact or phone number.", category: "Read", status: "active" },
  { name: "whatsapp_get_last_interaction", desc: "Retrieve the most recent message exchanged with a contact.", category: "Read", status: "active" },
  { name: "whatsapp_get_message_context", desc: "Retrieve surrounding messages before and after a given message ID.", category: "Read", status: "active" },
  { name: "whatsapp_send_message", desc: "Dispatch text messages to any phone number or group JID.", category: "Write", status: "active" },
  { name: "whatsapp_send_file", desc: "Send documents, images, audio files to contacts.", category: "Write", status: "active" },
  { name: "whatsapp_download_media", desc: "Download attached media files to local disk and return their file path.", category: "Read", status: "active" },
];

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
      const res = await rpc.call("create_session", { name });
      if (res.success && res.session) {
        const newSid = res.session.id;
        setActiveSessionId(newSid);
        try {
          localStorage.setItem("bb_whatsapp_active_session", newSid);
        } catch {}
        setSelectedChat(null);
        setMessages([]);
        await fetchStatus(newSid);
        await fetchSessions();
      } else {
        setErrorMessage(res.message || "Failed to add a new account. Check the bridge and try again.");
      }
    } catch (e: any) {
      setErrorMessage(e?.message || "Failed to add a new account. Check the bridge and try again.");
    } finally {
      setCreatingSession(false);
    }
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length <= 1) return;
    if (!confirm("Are you sure you want to disconnect and remove this WhatsApp account session?")) {
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
      setTestResult(res.success ? "✓ Sent successfully" : `✗ Error: ${res.message}`);
      if (res.success) {
        fetchChats();
      }
    } catch (e: any) {
      setTestResult(`✗ Error: ${e.message}`);
    }
  };

  // Filter chats by search
  const filteredChats = chats.filter((c) => {
    if (!chatSearch.trim()) return true;
    const q = chatSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.jid.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col h-full bg-[#0c0d0e] text-[#e1e4ea] font-sans antialiased select-none overflow-hidden">
      {/* ============================================================ */}
      {/* 0. TOP ACCOUNT SESSIONS TABS BAR                            */}
      {/* ============================================================ */}
      <div className="h-9 bg-[#0b0c0e] border-b border-[rgba(255,255,255,0.08)] flex items-center px-3 gap-1.5 overflow-x-auto select-none shrink-0 no-scrollbar">
        {sessions.map((sess) => {
          const isActive = sess.id === activeSessionId;
          const phoneDisplay = sess.phone ? `+${sess.phone}` : sess.name || sess.id;
          return (
            <div
              key={sess.id}
              onClick={() => handleSwitchSession(sess.id)}
              className={`group relative flex items-center gap-2 px-3 py-1 rounded-md text-xs cursor-pointer transition-all border ${
                isActive
                  ? "bg-[#16171d] text-neutral-100 font-medium border-emerald-500/50 shadow-sm"
                  : "bg-[#101114] text-neutral-400 hover:text-neutral-200 hover:bg-[#14151a] border-[rgba(255,255,255,0.05)]"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  sess.connected
                    ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                    : sess.status === "needs_scan"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-neutral-500"
                }`}
                title={sess.status}
              />
              <span className="truncate max-w-[150px] tracking-tight">{phoneDisplay}</span>
              {sessions.length > 1 && (
                <button
                  onClick={(e) => handleDeleteSession(sess.id, e)}
                  title="Disconnect and remove session"
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-neutral-800 rounded text-neutral-500 hover:text-red-400 transition-opacity ml-0.5"
                >
                  <SvgX className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={() => handleCreateSession()}
          disabled={creatingSession}
          title="Add New WhatsApp Account / Session"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-neutral-400 hover:text-emerald-400 hover:bg-[#15171d] transition-colors ml-1 border border-dashed border-[rgba(255,255,255,0.12)] hover:border-emerald-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creatingSession ? (
            <SvgRefresh className="w-3 h-3 animate-spin" />
          ) : (
            <SvgPlus className="w-3 h-3" />
          )}
          <span className="text-[11px] font-medium">{creatingSession ? "Adding..." : "+ Account"}</span>
        </button>
      </div>

      {/* ============================================================ */}
      {/* 1. TOP HEADER / STATUS BAR                                  */}
      {/* ============================================================ */}
      <header className="h-12 px-4 bg-[#111215] border-b border-[rgba(255,255,255,0.07)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <SvgWhatsApp className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-100 tracking-wide">WhatsApp</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${
                  status.connected
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : status.status === "needs_scan"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    : "bg-neutral-800 text-neutral-400 border-neutral-700"
                }`}
              >
                ● {status.connected
                  ? "Connected"
                  : status.status === "needs_scan"
                  ? "Pairing Needed"
                  : status.status === "stopped"
                  ? "Bridge Stopped"
                  : status.status === "error"
                  ? "Error"
                  : "Connecting..."}
              </span>
            </div>
            {status.phone && (
              <span className="text-[10px] text-neutral-400 font-mono">+{status.phone}</span>
            )}
          </div>
        </div>

        {/* Header Actions & Tab Switch */}
        <div className="flex items-center gap-2">
          {status.connected && (
            <div className="flex bg-[#18191d] p-0.5 rounded-md border border-[rgba(255,255,255,0.06)] text-xs">
              <button
                onClick={() => setActiveTab("chats")}
                className={`px-3 py-1 rounded transition-colors ${
                  activeTab === "chats"
                    ? "bg-[#25272e] text-neutral-100 font-medium shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Chats
              </button>
              <button
                onClick={() => setActiveTab("tools")}
                className={`px-3 py-1 rounded transition-colors ${
                  activeTab === "tools"
                    ? "bg-[#25272e] text-neutral-100 font-medium shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Agent Tools ({REGISTERED_TOOLS.length})
              </button>
            </div>
          )}

          <button
            onClick={() => {
              fetchStatus();
              fetchChats();
            }}
            title="Refresh Status & Chats"
            className="p-2 rounded-md bg-[#18191d] hover:bg-[#202227] text-neutral-400 hover:text-neutral-200 border border-[rgba(255,255,255,0.06)] transition-all"
          >
            <SvgRefresh className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={async () => {
              await rpc.call("restart_bridge");
              fetchStatus();
            }}
            title="Restart WhatsApp Bridge"
            className="p-2 rounded-md bg-[#18191d] hover:bg-[#202227] text-amber-400/80 hover:text-amber-400 border border-[rgba(255,255,255,0.06)] transition-all"
          >
            <SvgPower className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ============================================================ */}
      {/* 2. MAIN CONTENT AREA                                         */}
      {/* ============================================================ */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* VIEW A: NOT CONNECTED / PAIRING SCREEN */}
        {!status.connected ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#0c0d0e] overflow-y-auto">
            <div className="max-w-md w-full bg-[#121316] border border-[rgba(255,255,255,0.08)] rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center">
              <div className="relative mb-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_30px_rgba(37,211,102,0.15)]">
                  <SvgWhatsApp className="w-8 h-8" />
                </div>
              </div>

              <h2 className="text-base font-semibold text-neutral-100 tracking-tight mb-1">
                Connect WhatsApp to Blackbox
              </h2>
              <p className="text-xs text-neutral-400 mb-6 max-w-xs leading-relaxed">
                Scan the QR code with your mobile app to enable AI agent tools, chat browsing, and message sending.
              </p>

              {/* QR Code Container */}
              <div className="relative bg-white p-3 rounded-xl border border-neutral-200 shadow-inner mb-6 flex items-center justify-center min-w-[260px] min-h-[260px]">
                {status.qrDataUrl ? (
                  <img
                    src={status.qrDataUrl}
                    alt="WhatsApp Pairing QR Code"
                    className="w-60 h-60 rounded-lg select-none"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 text-neutral-600 py-10">
                    <SvgRefresh className="w-6 h-6 animate-spin text-neutral-400" />
                    <span className="text-xs font-mono text-neutral-500">Generating pairing QR code...</span>
                  </div>
                )}
              </div>

              {/* Steps */}
              <div className="w-full bg-[#18191e] border border-[rgba(255,255,255,0.05)] rounded-xl p-3.5 mb-5 text-left text-xs space-y-2 text-neutral-300">
                <div className="flex items-center gap-2.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-[10px] flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span>Open WhatsApp on your phone</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-[10px] flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span>Tap <strong>Settings</strong> &gt; <strong>Linked Devices</strong></span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-[10px] flex items-center justify-center shrink-0">
                    3
                  </span>
                  <span>Tap <strong>Link a Device</strong> and point your camera here</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 w-full">
                <button
                  onClick={() => fetchStatus()}
                  className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                >
                  I Scanned It / Check
                </button>
                <button
                  onClick={async () => {
                    await rpc.call("restart_bridge");
                    fetchStatus();
                  }}
                  className="py-2 px-3 bg-[#1e2025] hover:bg-[#252830] text-neutral-300 rounded-lg text-xs font-medium border border-[rgba(255,255,255,0.08)] transition-colors"
                >
                  Restart Bridge
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === "tools" ? (
          /* VIEW B: AGENT TOOLS & DIAGNOSTICS */
          <div className="flex-1 flex flex-col p-6 bg-[#0c0d0e] overflow-y-auto">
            <div className="max-w-3xl w-full mx-auto space-y-6">
              {/* Header Card */}
              <div className="bg-[#121316] border border-[rgba(255,255,255,0.08)] rounded-xl p-5 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                    <SvgTerminal className="w-4 h-4" />
                    <span>WhatsApp MCP Agent Interface</span>
                  </div>
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    {REGISTERED_TOOLS.length} of {REGISTERED_TOOLS.length} Tools Active
                  </span>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed mb-4">
                  Full suite of WhatsApp multidevice tools registered in Blackbox. Autonomous agents and threads can query chat histories, inspect media, search contacts, and dispatch notifications.
                </p>

                {/* Status Badges */}
                <div className="grid grid-cols-3 gap-3 font-mono text-xs">
                  <div className="bg-[#18191e] p-2.5 rounded-lg border border-[rgba(255,255,255,0.05)]">
                    <div className="text-[10px] text-neutral-500 uppercase">Paired Phone</div>
                    <div className="text-neutral-200 mt-0.5">+{status.phone || "—"}</div>
                  </div>
                  <div className="bg-[#18191e] p-2.5 rounded-lg border border-[rgba(255,255,255,0.05)]">
                    <div className="text-[10px] text-neutral-500 uppercase">Synced Chats</div>
                    <div className="text-emerald-400 mt-0.5">{chats.length}</div>
                  </div>
                  <div className="bg-[#18191e] p-2.5 rounded-lg border border-[rgba(255,255,255,0.05)]">
                    <div className="text-[10px] text-neutral-500 uppercase">Engine Protocol</div>
                    <div className="text-neutral-200 mt-0.5">whatsmeow (Go Daemon)</div>
                  </div>
                </div>
              </div>

              {/* Direct Message Tester */}
              <div className="bg-[#121316] border border-[rgba(255,255,255,0.08)] rounded-xl p-5 shadow-lg">
                <h3 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider mb-3">
                  Quick Message Dispatcher
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-neutral-400 block mb-1">Recipient Phone or JID</label>
                    <input
                      type="text"
                      placeholder="e.g. +1234567890 or 1234567890@s.whatsapp.net"
                      value={testRecipient}
                      onChange={(e) => setTestRecipient(e.target.value)}
                      className="w-full bg-[#18191e] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-neutral-400 block mb-1">Message Text</label>
                    <textarea
                      placeholder="Write a test message..."
                      rows={2}
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      className="w-full bg-[#18191e] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500/50 resize-none"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={handleSendTestMessage}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
                    >
                      Send Message
                    </button>
                    {testResult && (
                      <span className="text-xs font-mono text-neutral-300">{testResult}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Registered Agent Tools List (All 12 Tools) */}
              <div className="bg-[#121316] border border-[rgba(255,255,255,0.08)] rounded-xl p-5 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider">
                    Registered MCP Agent Tools (12)
                  </h3>
                  <span className="text-[11px] text-neutral-500">Autonomous Agent Runtime</span>
                </div>
                <div className="divide-y divide-[rgba(255,255,255,0.05)] text-xs">
                  {REGISTERED_TOOLS.map((t, idx) => (
                    <div key={t.name} className="py-2.5 flex items-start justify-between gap-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-neutral-600 font-mono w-4">{idx + 1}.</span>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-emerald-400 font-medium">{t.name}</span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-mono uppercase ${
                                t.category === "Write"
                                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                  : t.category === "Read"
                                  ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                  : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                              }`}
                            >
                              {t.category}
                            </span>
                          </div>
                          <span className="text-neutral-400 text-[11px] mt-0.5 leading-tight">{t.desc}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        <span className="text-[10px] font-mono text-emerald-400">Ready</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* VIEW C: LIVE CHAT CLIENT (Left column: Chats list, Right column: Conversation) */
          <>
            {/* 2A. CHATS LIST SIDEBAR (w-80) */}
            <div className="w-80 bg-[#101114] border-r border-[rgba(255,255,255,0.07)] flex flex-col shrink-0">
              {/* Chat Search Bar + New Chat Trigger */}
              <div className="p-3 border-b border-[rgba(255,255,255,0.06)] flex items-center gap-2">
                <div className="relative flex-1 flex items-center">
                  <SvgSearch className="w-3.5 h-3.5 absolute left-3 text-neutral-500" />
                  <input
                    type="text"
                    placeholder="Search chats or contacts..."
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                    className="w-full bg-[#18191e] border border-[rgba(255,255,255,0.06)] rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500/40 transition-colors"
                  />
                </div>
                <button
                  onClick={() => setShowNewChatDialog(true)}
                  title="Start New Chat"
                  className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shrink-0 transition-colors shadow-sm"
                >
                  <SvgPlus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Chat Items */}
              <div className="flex-1 overflow-y-auto divide-y divide-[rgba(255,255,255,0.03)]">
                {filteredChats.length === 0 ? (
                  <div className="p-6 text-center text-xs text-neutral-500 flex flex-col items-center gap-2">
                    {chats.length === 0 ? (
                      <>
                        <SvgRefresh className="w-4 h-4 animate-spin text-neutral-600" />
                        <span>Loading chats or synchronizing...</span>
                      </>
                    ) : (
                      <>
                        <span>No matching chats found</span>
                        <button
                          onClick={() => setShowNewChatDialog(true)}
                          className="text-emerald-400 hover:underline text-[11px]"
                        >
                          + Start new conversation
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  filteredChats.map((chat) => {
                    const isSelected = selectedChat?.jid === chat.jid;
                    const initial = (chat.name || "U")[0].toUpperCase();

                    return (
                      <div
                        key={chat.jid}
                        onClick={() => {
                          setSelectedChat(chat);
                          setErrorMessage(null);
                        }}
                        className={`p-3 cursor-pointer flex items-center gap-3 transition-colors ${
                          isSelected
                            ? "bg-[#1c1e24] border-l-2 border-emerald-500 text-neutral-100"
                            : "hover:bg-[#15161a] text-neutral-300"
                        }`}
                      >
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-full bg-[#202228] border border-[rgba(255,255,255,0.08)] flex items-center justify-center font-semibold text-xs text-emerald-400 shrink-0">
                          {initial}
                        </div>

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className="text-xs font-medium truncate text-neutral-200">
                              {chat.name || chat.jid}
                            </span>
                            {chat.last_message_time && (
                              <span className="text-[10px] text-neutral-500 shrink-0 font-mono">
                                {new Date(chat.last_message_time).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 truncate">
                            {chat.last_is_from_me ? <span className="text-neutral-500">You: </span> : null}
                            {chat.last_message || "—"}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 2B. ACTIVE CONVERSATION PANE */}
            <div className="flex-1 flex flex-col bg-[#0c0d0e] overflow-hidden">
              {selectedChat ? (
                <>
                  {/* Chat Top Header */}
                  <div className="h-12 px-4 bg-[#111215] border-b border-[rgba(255,255,255,0.07)] flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-[#1e2026] text-emerald-400 font-semibold text-xs flex items-center justify-center">
                        {(selectedChat.name || "U")[0].toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-neutral-100">{selectedChat.name}</h3>
                        <span className="text-[10px] text-neutral-500 font-mono">{selectedChat.jid}</span>
                      </div>
                    </div>
                  </div>

                  {/* Error Feedback Banner */}
                  {errorMessage && (
                    <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center justify-between text-xs text-red-300">
                      <div className="flex items-center gap-2">
                        <SvgAlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                        <span>{errorMessage}</span>
                      </div>
                      <button
                        onClick={() => setErrorMessage(null)}
                        className="text-red-400 hover:text-red-200 text-xs px-1"
                      >
                        <SvgX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Messages Stream */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {messages.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-xs text-neutral-500">
                        No messages loaded for this chat yet.
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isMe = msg.is_from_me;
                        const timeStr = msg.timestamp
                          ? new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "";

                        const dlStatus = downloadingMedia[msg.id];
                        const dlPath = downloadedPaths[msg.id];

                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                          >
                            <div
                              className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed shadow-sm break-words ${
                                isMe
                                  ? "bg-emerald-600/90 text-white rounded-br-sm"
                                  : "bg-[#18191f] text-neutral-200 border border-[rgba(255,255,255,0.06)] rounded-bl-sm"
                              }`}
                            >
                              {/* Only show sender name in group chats. In 1-on-1 chats, never display raw number above bubble. */}
                              {!isMe && selectedChat?.jid?.endsWith("@g.us") && (
                                <div className="text-[10px] text-emerald-400 font-medium mb-0.5">
                                  {msg.sender_name || msg.sender.split("@")[0]}
                                </div>
                              )}

                              {msg.content && <p>{msg.content}</p>}

                              {/* Media Attachment View & Download Trigger */}
                              {msg.media_type && (
                                <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.12)]">
                                  <div className="flex items-center justify-between gap-3 bg-[rgba(0,0,0,0.2)] rounded-lg p-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      {msg.media_type.includes("image") ? (
                                        <SvgImage className="w-4 h-4 text-emerald-300 shrink-0" />
                                      ) : (
                                        <SvgFile className="w-4 h-4 text-emerald-300 shrink-0" />
                                      )}
                                      <div className="min-w-0">
                                        <p className="text-[11px] font-medium truncate text-neutral-100">
                                          {msg.filename || `${msg.media_type} attachment`}
                                        </p>
                                        <span className="text-[9px] text-neutral-400 font-mono">
                                          {msg.file_length > 0
                                            ? `${(msg.file_length / 1024).toFixed(1)} KB • `
                                            : ""}
                                          {msg.media_type}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Download Trigger */}
                                    <button
                                      onClick={() => handleDownloadMedia(msg)}
                                      disabled={dlStatus === "loading"}
                                      title={dlPath ? `Saved to: ${dlPath}` : "Download media to local disk"}
                                      className={`px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1 shrink-0 transition-colors ${
                                        dlStatus === "downloaded"
                                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                          : dlStatus === "loading"
                                          ? "bg-neutral-800 text-neutral-400"
                                          : "bg-emerald-600 hover:bg-emerald-500 text-white"
                                      }`}
                                    >
                                      {dlStatus === "loading" ? (
                                        <>
                                          <SvgRefresh className="w-3 h-3 animate-spin" />
                                          <span>Saving...</span>
                                        </>
                                      ) : dlStatus === "downloaded" ? (
                                        <>
                                          <SvgCheck className="w-3 h-3" />
                                          <span>Saved</span>
                                        </>
                                      ) : (
                                        <>
                                          <SvgDownload className="w-3 h-3" />
                                          <span>Download</span>
                                        </>
                                      )}
                                    </button>
                                  </div>

                                  {/* Download Path preview badge */}
                                  {dlPath && (
                                    <div className="mt-1 text-[9px] font-mono text-emerald-300/80 truncate">
                                      Saved: {dlPath}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Timestamp and Sent Indicators */}
                              <div
                                className={`flex items-center justify-end gap-1 text-[9px] mt-1 font-mono ${
                                  isMe ? "text-emerald-200/70" : "text-neutral-500"
                                }`}
                              >
                                <span>{timeStr}</span>
                                {isMe && <SvgCheckCheck className="w-3 h-3 text-emerald-300" />}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Message Composer */}
                  <div className="p-3 bg-[#111215] border-t border-[rgba(255,255,255,0.07)] flex items-center gap-2 shrink-0">
                    <input
                      type="text"
                      placeholder={`Message ${selectedChat.name}...`}
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      className="flex-1 bg-[#18191e] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!messageInput.trim() || sending}
                      className="p-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white rounded-xl transition-all shadow-sm flex items-center justify-center shrink-0"
                    >
                      {sending ? (
                        <SvgRefresh className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <SvgSend className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-neutral-500">
                  <SvgWhatsApp className="w-12 h-12 text-neutral-700 mb-3" />
                  <p className="text-xs mb-3">Select a chat on the left to start messaging</p>
                  <button
                    onClick={() => setShowNewChatDialog(true)}
                    className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs transition-colors"
                  >
                    + Start New Conversation
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* NEW CHAT MODAL DIALOG                                        */}
        {/* ============================================================ */}
        {showNewChatDialog && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#121316] border border-[rgba(255,255,255,0.1)] rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SvgPhone className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-semibold text-neutral-100 uppercase tracking-wider">
                    Start New Conversation
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setShowNewChatDialog(false);
                    setNewChatInput("");
                    setContactSearchResults([]);
                  }}
                  className="p-1 text-neutral-400 hover:text-neutral-200"
                >
                  <SvgX className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">
                  Recipient Phone Number or Contact Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. +1234567890 or John Doe"
                    value={newChatInput}
                    onChange={(e) => handleSearchContacts(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newChatInput.trim()) {
                        handleStartChat(newChatInput.trim());
                      }
                    }}
                    autoFocus
                    className="w-full bg-[#18191e] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                  />
                  {searchingContacts && (
                    <SvgRefresh className="w-3.5 h-3.5 animate-spin absolute right-3 top-2.5 text-neutral-500" />
                  )}
                </div>
              </div>

              {/* Matched Contacts List */}
              {contactSearchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto divide-y divide-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] rounded-lg bg-[#15161a]">
                  {contactSearchResults.map((contact) => (
                    <div
                      key={contact.jid}
                      onClick={() => handleStartChat(contact.jid, contact.name)}
                      className="p-2.5 hover:bg-[#1f2127] cursor-pointer flex items-center justify-between text-xs transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <SvgUser className="w-3.5 h-3.5 text-emerald-400" />
                        <div>
                          <p className="font-medium text-neutral-200">{contact.name}</p>
                          <span className="text-[10px] text-neutral-400 font-mono">{contact.phone_number || contact.jid}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-emerald-400 hover:underline">Chat &rarr;</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowNewChatDialog(false);
                    setNewChatInput("");
                    setContactSearchResults([]);
                  }}
                  className="px-3 py-1.5 bg-[#18191e] hover:bg-[#202228] text-neutral-300 rounded-lg text-xs font-medium border border-[rgba(255,255,255,0.08)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleStartChat(newChatInput.trim())}
                  disabled={!newChatInput.trim()}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                >
                  Open Chat
                </button>
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
