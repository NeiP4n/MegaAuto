import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { Account, Project, ChatMessage, HubStatus, MessageMetadata, ExecutionStatus } from "./src/types";
import {
  SvgMessagesSquare,
  SvgLayers,
  SvgSearch,
  SvgSend,
  SvgRefresh,
  SvgActivity,
  SvgCheckCheck,
  SvgCheck,
  SvgBot,
  SvgUser,
  SvgServer,
  SvgZap,
  SvgSparkles,
  SvgTrash,
  SvgClose,
  SvgNetwork,
  SvgPlus,
  SvgChevronRight,
  SvgExternalLink,
  SvgCopy,
  SvgInfo,
  SvgAlertCircle,
  SvgCheckCircle,
  SvgClock,
  SvgCode,
  SvgPower,
} from "./src/icons";

// Helper for formatting timestamps safely without "Invalid Date"
export const formatSyncTime = (val?: string): string => {
  if (!val) return "Не синхронизировано";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

// ============================================================================
// MAIN PLUGIN COMPONENT: n8n PROJECT HUB (Multi-Instance n8n & Automations)
// ============================================================================
export function ProjectHubView() {
  const rpc = useRpc<typeof rpcContract>();

  // State
  const [activeTab, setActiveTab] = useState<"chats" | "accounts" | "n8n">("chats");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hubStatus, setHubStatus] = useState<HubStatus | null>(null);

  // Filters & Inputs
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<"all" | "n8n" | "telegram" | "unread">("all");
  const [inputText, setInputText] = useState("");
  const [sendMode, setSendMode] = useState<"command" | "message">("command");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Sync state
  const [isGlobalSyncing, setIsGlobalSyncing] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);

  // Copy URL state
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Message metadata payload expansion state
  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, boolean>>({});

  // Notification / Feedback banner state
  const [feedback, setFeedback] = useState<{
    id: number;
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const showFeedback = useCallback((type: "success" | "error" | "info", message: string) => {
    const id = Date.now();
    setFeedback({ id, type, message });
    setTimeout(() => {
      setFeedback((curr) => (curr?.id === id ? null : curr));
    }, 4500);
  }, []);

  // Modal: Connect New Account
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [newAccName, setNewAccName] = useState("");
  const [newAccChannel, setNewAccChannel] = useState<"n8n" | "telegram" | "webhook">("n8n");
  const [newAccUrl, setNewAccUrl] = useState("http://localhost:5678");
  const [newAccApiKey, setNewAccApiKey] = useState("");
  const [isCreatingAcc, setIsCreatingAcc] = useState(false);

  // Modal: Create New Project / Chat
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [newProjAccountId, setNewProjAccountId] = useState("");
  const [newProjChannel, setNewProjChannel] = useState<"n8n" | "telegram" | "webhook">("n8n");
  const [newProjWorkflowId, setNewProjWorkflowId] = useState("");
  const [newProjTags, setNewProjTags] = useState("");
  const [isCreatingProj, setIsCreatingProj] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll messages to bottom
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Copy to clipboard with visual feedback
  const handleCopyUrl = useCallback(
    (url: string, label = "Ссылка скопирована в буфер обмена") => {
      if (!url) return;
      navigator.clipboard
        .writeText(url)
        .then(() => {
          setCopiedUrl(url);
          showFeedback("info", label);
          setTimeout(() => {
            setCopiedUrl((curr) => (curr === url ? null : curr));
          }, 2000);
        })
        .catch(() => {
          showFeedback("error", "Не удалось скопировать в буфер обмена");
        });
    },
    [showFeedback]
  );

  // Toggle JSON payload viewer
  const togglePayload = useCallback((msgId: string) => {
    setExpandedPayloads((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  }, []);

  // Fetch all data via rpc.call
  const refreshAll = useCallback(async () => {
    try {
      const [accRes, projRes, statRes] = await Promise.all([
        rpc.call("get_accounts"),
        rpc.call("get_projects", {}),
        rpc.call("get_status"),
      ]);

      if (accRes && (accRes as any).ok) {
        setAccounts((accRes as any).accounts || []);
      }
      if (projRes && (projRes as any).ok) {
        setProjects((projRes as any).projects || []);
      }
      if (statRes) {
        setHubStatus(statRes as any);
        if (statRes.n8nBaseUrl && newAccUrl === "http://localhost:5678") {
          setNewAccUrl(statRes.n8nBaseUrl);
        }
      }
    } catch {
      // background polling
    }
  }, [rpc, newAccUrl]);

  // Keep selectedProjectId valid when projects list changes
  useEffect(() => {
    if (projects.length > 0) {
      if (!selectedProjectId || !projects.some((p) => p.id === selectedProjectId)) {
        setSelectedProjectId(projects[0].id);
      }
    } else {
      setSelectedProjectId("");
    }
  }, [projects, selectedProjectId]);

  // Set default account ID for project creation modal
  useEffect(() => {
    if (accounts.length > 0 && !newProjAccountId) {
      setNewProjAccountId(accounts[0].id);
    }
  }, [accounts, newProjAccountId]);

  // Global Sync Trigger (calls sync_n8n and refreshes all data)
  const handleGlobalSync = useCallback(async () => {
    if (isGlobalSyncing) return;
    setIsGlobalSyncing(true);
    try {
      const res = await rpc.call("sync_n8n", {});
      if (res?.ok) {
        showFeedback(
          "success",
          `Синхронизировано: ${res.syncedProjects ?? 0} проектов, ${res.syncedMessages ?? 0} событий n8n`
        );
      } else {
        showFeedback("error", res?.error || "Синхронизация n8n завершилась с ошибкой");
      }
    } catch (err: any) {
      showFeedback("error", `Ошибка sync_n8n: ${err?.message || "Не удалось связаться с сервером n8n"}`);
    } finally {
      await refreshAll();
      setIsGlobalSyncing(false);
    }
  }, [rpc, isGlobalSyncing, refreshAll, showFeedback]);

  // Per-Account Sync Trigger (calls sync_n8n with account parameters/accountId)
  const handleSyncAccount = useCallback(
    async (acc: Account) => {
      if (syncingAccountId) return;
      setSyncingAccountId(acc.id);
      try {
        const res = await rpc.call("sync_n8n", {
          accountId: acc.id,
          n8nBaseUrl: acc.url,
          apiKey: acc.apiKey,
        });

        if (res?.ok) {
          showFeedback(
            "success",
            `Инстанс "${acc.name}" успешно синхронизирован (${res.syncedProjects ?? 0} проектов)`
          );
        } else {
          showFeedback("error", res?.error || `Ошибка синхронизации инстанса ${acc.name}`);
        }
      } catch (err: any) {
        showFeedback(
          "error",
          `Ошибка вызова sync_n8n для "${acc.name}": ${err?.message || "Сеть или n8n недоступны"}`
        );
      } finally {
        await refreshAll();
        setSyncingAccountId(null);
      }
    },
    [rpc, syncingAccountId, refreshAll, showFeedback]
  );

  // Load messages for project
  const loadMessages = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setMessages([]);
        return;
      }
      try {
        setIsLoading(true);
        const res = await rpc.call("get_messages", { projectId });
        if (res?.ok) {
          setMessages(res.messages || []);
          await rpc.call("mark_as_read", { projectId });
          setProjects((prev) =>
            prev.map((p) => (p.id === projectId ? { ...p, unreadCount: 0 } : p))
          );
        } else {
          showFeedback("error", "Не удалось загрузить события потока");
        }
      } catch (err: any) {
        showFeedback("error", `Ошибка загрузки сообщений: ${err?.message || "Ошибка RPC"}`);
      } finally {
        setIsLoading(false);
      }
    },
    [rpc, showFeedback]
  );

  // Initial load
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // When selected project changes
  useEffect(() => {
    if (selectedProjectId) {
      loadMessages(selectedProjectId);
    } else {
      setMessages([]);
    }
  }, [selectedProjectId, loadMessages]);

  // Scroll on message updates
  useEffect(() => {
    scrollToBottom(false);
  }, [messages, scrollToBottom]);

  // Live polling
  useEffect(() => {
    const interval = setInterval(() => {
      refreshAll();
      if (selectedProjectId && activeTab === "chats") {
        rpc.call("get_messages", { projectId: selectedProjectId }).then((res) => {
          if (res?.ok) {
            setMessages(res.messages || []);
          }
        }).catch(() => {
          // ignore polling errors
        });
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [refreshAll, selectedProjectId, activeTab, rpc]);

  // Send command / message to n8n
  const handleSendMessage = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isSending || !selectedProjectId) return;

    setIsSending(true);
    try {
      const res = await rpc.call("send_message", {
        projectId: selectedProjectId,
        text: trimmed,
        mode: sendMode,
      });

      if (res?.ok) {
        setInputText("");
        const msgsRes = await rpc.call("get_messages", { projectId: selectedProjectId });
        if (msgsRes?.ok) {
          setMessages(msgsRes.messages || []);
        }
        refreshAll();
        setTimeout(() => scrollToBottom(true), 50);
      } else {
        showFeedback("error", res?.error || "Не удалось отправить команду / событие в n8n");
      }
    } catch (err: any) {
      showFeedback("error", `Ошибка отправки сообщения: ${err?.message || "Сервер n8n недоступен"}`);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  // Toggle AI Assistant for project
  const handleToggleAi = async (projectId: string, current: boolean) => {
    try {
      const res = await rpc.call("toggle_ai", { projectId, aiActive: !current });
      if (res?.ok && res.project) {
        setProjects((prev) =>
          prev.map((p) => (p.id === projectId ? res.project! : p))
        );
        showFeedback("info", `AI для проекта: ${!current ? "Включен" : "Отключен"}`);
      } else {
        showFeedback("error", "Не удалось переключить AI режим");
      }
    } catch (err: any) {
      showFeedback("error", `Ошибка toggle_ai: ${err?.message || "Ошибка RPC"}`);
    }
  };

  // Power switch (Кнопка включения/выключения потока/проекта)
  const handleToggleProjectStatus = useCallback(
    async (projectId: string, currentStatus: "online" | "idle" | "offline") => {
      const targetStatus = currentStatus === "online" ? "offline" : "online";
      try {
        const res = await rpc.call("toggle_project_status", {
          projectId,
          status: targetStatus,
        });

        if (res?.ok && res.project) {
          setProjects((prev) =>
            prev.map((p) => (p.id === projectId ? res.project! : p))
          );
          showFeedback(
            targetStatus === "online" ? "success" : "info",
            targetStatus === "online" ? "Поток включен (ВКЛ)" : "Поток отключен (ВЫКЛ)"
          );
        } else {
          showFeedback("error", "Не удалось изменить статус потока");
        }
      } catch (err: any) {
        showFeedback("error", `Ошибка переключения статуса: ${err?.message || "Ошибка RPC"}`);
      }
    },
    [rpc, showFeedback]
  );

  // Delete project / chat
  const handleDeleteProject = useCallback(
    async (projectId: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      try {
        const res = await rpc.call("delete_project", { projectId });
        if (res?.ok) {
          setProjects((prev) => prev.filter((p) => p.id !== projectId));
          if (selectedProjectId === projectId) {
            setSelectedProjectId("");
          }
          showFeedback("info", "Чат/поток удален");
          refreshAll();
        } else {
          showFeedback("error", "Не удалось удалить чат");
        }
      } catch (err: any) {
        showFeedback("error", `Ошибка удаления чата: ${err?.message || "Ошибка RPC"}`);
      }
    },
    [rpc, selectedProjectId, refreshAll, showFeedback]
  );

  // Create new project / chat
  const handleCreateProject = async () => {
    const name = newProjName.trim();
    const accountId = newProjAccountId || accounts[0]?.id;
    if (!name || !accountId || isCreatingProj) return;

    setIsCreatingProj(true);
    try {
      const tagsList = newProjTags
        ? newProjTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined;

      const res = await rpc.call("create_project", {
        accountId,
        name,
        channel: newProjChannel,
        workflowId: newProjWorkflowId.trim() || undefined,
        tags: tagsList,
      });

      if (res?.ok && res.project) {
        setProjects((prev) => [...prev, res.project]);
        setSelectedProjectId(res.project.id);
        setNewProjName("");
        setNewProjWorkflowId("");
        setNewProjTags("");
        setIsAddProjectOpen(false);
        showFeedback("success", `Чат/поток "${res.project.name}" успешно создан`);
        refreshAll();
      } else {
        showFeedback("error", "Не удалось создать чат/поток");
      }
    } catch (err: any) {
      showFeedback("error", `Ошибка создания чата: ${err?.message || "Неверные параметры"}`);
    } finally {
      setIsCreatingProj(false);
    }
  };

  // Create new n8n / gateway account
  const handleCreateAccount = async () => {
    const name = newAccName.trim();
    const url = newAccUrl.trim();
    if (!name || !url || isCreatingAcc) return;

    setIsCreatingAcc(true);
    try {
      const res = await rpc.call("create_account", {
        name,
        channel: newAccChannel,
        url,
        apiKey: newAccApiKey.trim() || undefined,
      });

      if (res?.ok) {
        setNewAccName("");
        setNewAccApiKey("");
        setIsAddAccountOpen(false);
        showFeedback("success", `Инстанс "${name}" успешно подключен`);
        refreshAll();
      } else {
        showFeedback("error", "Не удалось зарегистрировать инстанс n8n");
      }
    } catch (err: any) {
      showFeedback("error", `Ошибка добавления инстанса: ${err?.message || "Неверные данные"}`);
    } finally {
      setIsCreatingAcc(false);
    }
  };

  // Power switch for Account (Включение/выключение инстанса)
  const handleToggleAccount = async (accountId: string) => {
    try {
      const acc = accounts.find((a) => a.id === accountId);
      const isCurrentlyOnline = acc?.status === "online";
      const res = await rpc.call("disconnect_account", { accountId });
      if (res?.ok) {
        showFeedback(
          isCurrentlyOnline ? "info" : "success",
          isCurrentlyOnline ? "Инстанс выключен" : "Инстанс включен"
        );
      } else {
        showFeedback("error", "Не удалось изменить статус инстанса");
      }
      refreshAll();
    } catch (err: any) {
      showFeedback("error", `Ошибка переключения статуса: ${err?.message || "Ошибка RPC"}`);
    }
  };

  // Delete account
  const handleDeleteAccount = async (accountId: string) => {
    try {
      const res = await rpc.call("delete_account", { accountId });
      if (res?.ok) {
        showFeedback("info", "Инстанс удален");
      } else {
        showFeedback("error", "Не удалось удалить инстанс");
      }
      refreshAll();
    } catch (err: any) {
      showFeedback("error", `Ошибка удаления инстанса: ${err?.message || "Ошибка RPC"}`);
    }
  };

  // Filtered projects
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      // Filter by Account
      if (selectedAccountId !== "all" && p.accountId !== selectedAccountId) {
        return false;
      }

      // Search
      const matchesSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())) ||
        p.lastMessagePreview.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      // Filter pills
      if (selectedFilter === "n8n") return p.channel === "n8n";
      if (selectedFilter === "telegram") return p.channel === "telegram";
      if (selectedFilter === "unread") return p.unreadCount > 0;
      return true;
    });
  }, [projects, selectedAccountId, searchQuery, selectedFilter]);

  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId) || projects[0] || null;
  }, [projects, selectedProjectId]);

  const activeAccount = useMemo(() => {
    return accounts.find((a) => a.id === activeProject?.accountId);
  }, [accounts, activeProject]);

  const n8nDynamicUrl = hubStatus?.n8nBaseUrl || "http://localhost:5678";

  return (
    <div className="flex flex-col h-full w-full bg-background text-foreground select-none overflow-hidden font-sans relative">
      {/* ============================================================ */}
      {/* NOTIFICATION FEEDBACK TOAST / ALERT BANNER                    */}
      {/* ============================================================ */}
      {feedback && (
        <div className="absolute top-14 right-4 z-50 max-w-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div
            className={`flex items-start gap-2.5 p-3 rounded-xl border shadow-xl backdrop-blur-md ${
              feedback.type === "error"
                ? "bg-destructive/15 border-destructive/40 text-destructive"
                : feedback.type === "success"
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                : "bg-card/95 border-border text-foreground"
            }`}
          >
            {feedback.type === "error" ? (
              <SvgAlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
            ) : feedback.type === "success" ? (
              <SvgCheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            ) : (
              <SvgInfo className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
            )}
            <div className="flex-1 text-xs leading-relaxed break-words font-medium">
              {feedback.message}
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="p-0.5 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="Закрыть"
            >
              <SvgClose className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 1. TOP GLOBAL NAVIGATION & MULTI-INSTANCE DOCK BAR           */}
      {/* ============================================================ */}
      <header className="h-12 border-b border-border bg-card/60 backdrop-blur-md px-3.5 flex items-center justify-between gap-3 shrink-0">
        {/* Left: Brand & Tab Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shadow-xs">
              <SvgZap className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold tracking-tight text-foreground hidden sm:inline">
              n8n Project Hub
            </span>
          </div>

          {/* Mode Tabs */}
          <div className="flex items-center p-0.5 rounded-lg bg-secondary/70 border border-border/80">
            <button
              onClick={() => setActiveTab("chats")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                activeTab === "chats"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Чаты ({projects.length})
            </button>
            <button
              onClick={() => setActiveTab("accounts")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                activeTab === "accounts"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>Инстансы n8n</span>
              <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-emerald-500/15 text-emerald-400 font-mono">
                {accounts.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("n8n")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                activeTab === "n8n"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <SvgServer className="w-3 h-3 text-emerald-400" />
              <span>n8n Core</span>
            </button>
          </div>
        </div>

        {/* Right: Global Sync, n8n status & Connect Account button */}
        <div className="flex items-center gap-2">
          {/* Global Refresh & Sync Trigger */}
          <button
            onClick={handleGlobalSync}
            disabled={isGlobalSyncing}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all shadow-xs ${
              isGlobalSyncing
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                : "bg-secondary hover:bg-secondary/80 border-border text-foreground"
            }`}
            title={`Синхронизировать данные со всеми n8n серверами (${n8nDynamicUrl})`}
          >
            <SvgRefresh className={`w-3.5 h-3.5 ${isGlobalSyncing ? "animate-spin text-emerald-400" : ""}`} />
            <span className="hidden sm:inline">
              {isGlobalSyncing ? "Синхронизация..." : "Синхронизировать"}
            </span>
          </button>

          {/* n8n Status Pill */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border transition-all ${
              hubStatus?.n8nConnected
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-secondary border-border text-muted-foreground"
            }`}
            title={
              hubStatus?.n8nConnected
                ? `n8n активен на ${n8nDynamicUrl}`
                : `n8n подключение к ${n8nDynamicUrl}...`
            }
          >
            <span
              className={`w-2 h-2 rounded-full ${
                hubStatus?.n8nConnected ? "bg-emerald-400 animate-pulse" : "bg-destructive"
              }`}
            />
            <span className="font-medium">
              {hubStatus?.n8nConnected ? "n8n Online" : "n8n Offline"}
            </span>
          </div>

          {/* Quick Connect Account Button */}
          <button
            onClick={() => setIsAddAccountOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-all shadow-xs"
          >
            <SvgPlus className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Подключить инстанс</span>
          </button>
        </div>
      </header>

      {/* ============================================================ */}
      {/* 2. MULTI-INSTANCE QUICK SELECTOR STRIP                       */}
      {/* ============================================================ */}
      {activeTab === "chats" && (
        <div className="px-3.5 py-2 border-b border-border/80 bg-secondary/30 flex items-center justify-between gap-3 overflow-x-auto scrollbar-none shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mr-1">
              Инстанс:
            </span>

            {/* "All Instances" pill */}
            <button
              onClick={() => setSelectedAccountId("all")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 ${
                selectedAccountId === "all"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Все потоки
            </button>

            {/* Account Pills */}
            {accounts.map((acc) => {
              const isSelected = selectedAccountId === acc.id;
              const isOnline = acc.status === "online";
              return (
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  className={`flex items-center gap-2 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all shrink-0 ${
                    isSelected
                      ? "bg-accent/60 border-primary text-foreground shadow-xs"
                      : "bg-card/70 border-border text-muted-foreground hover:text-foreground hover:bg-card"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isOnline
                        ? "bg-emerald-400 ring-2 ring-emerald-400/20"
                        : "bg-muted-foreground"
                    }`}
                  />
                  <span className="truncate max-w-[140px]">{acc.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground opacity-80 flex items-center gap-0.5">
                    <SvgZap className="w-2.5 h-2.5 text-emerald-400" />
                    {acc.workflowsCount} wf
                  </span>
                  {acc.unreadTotal > 0 && (
                    <span className="px-1 py-0.2 rounded-full text-[9px] bg-primary text-primary-foreground font-bold font-mono">
                      {acc.unreadTotal}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setIsAddProjectOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition-colors"
              title="Создать новый чат или рабочий процесс"
            >
              <SvgPlus className="w-3.5 h-3.5" />
              <span>Новый чат</span>
            </button>

            <button
              onClick={handleGlobalSync}
              disabled={isGlobalSyncing}
              className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="Синхронизировать потоки с n8n"
            >
              <SvgRefresh className={`w-3.5 h-3.5 ${isGlobalSyncing ? "animate-spin text-emerald-400" : ""}`} />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 3. MAIN BODY AREA                                            */}
      {/* ============================================================ */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* ============================================================ */}
        {/* TAB 1: CONVERSATIONS & CHATS (Split View)                    */}
        {/* ============================================================ */}
        {activeTab === "chats" && (
          <>
            {/* Left Column: Project Cards List */}
            <aside className="w-80 sm:w-88 md:w-96 flex flex-col border-r border-border shrink-0 bg-card/40 backdrop-blur-sm">
              {/* Search & Filter Bar */}
              <div className="p-2.5 border-b border-border/60 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex-1 flex items-center">
                    <SvgSearch className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Поиск проектов, тегов..."
                      className="w-full bg-secondary/60 hover:bg-secondary/80 focus:bg-background border border-border/80 focus:border-primary/50 text-foreground placeholder:text-muted-foreground text-xs rounded-md pl-8 pr-2.5 py-1.5 transition-all outline-none"
                    />
                  </div>
                  <button
                    onClick={() => setIsAddProjectOpen(true)}
                    className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-all shrink-0"
                    title="Создать новый чат"
                  >
                    <SvgPlus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
                  {[
                    { id: "all", label: "Все" },
                    { id: "n8n", label: "n8n Workflows" },
                    { id: "telegram", label: "Telegram" },
                    { id: "unread", label: "События" },
                  ].map((f) => {
                    const active = selectedFilter === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setSelectedFilter(f.id as any)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors shrink-0 ${
                          active
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "bg-secondary/60 text-muted-foreground hover:text-foreground hover:bg-secondary"
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Project Cards List */}
              <div className="flex-1 overflow-y-auto divide-y divide-border/40 select-none">
                {filteredProjects.length === 0 ? (
                  <div className="p-8 text-center flex flex-col items-center justify-center h-full text-xs text-muted-foreground space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-secondary/80 border border-border flex items-center justify-center text-muted-foreground/60">
                      <SvgMessagesSquare className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground text-xs">Нет активных чатов и потоков</h4>
                      <p className="text-[11px] text-muted-foreground mt-1 max-w-[200px]">
                        Синхронизируйте рабочие процессы с n8n или создайте новый поток вручную.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <button
                        onClick={handleGlobalSync}
                        disabled={isGlobalSyncing}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition-all"
                      >
                        <SvgRefresh className={`w-3.5 h-3.5 ${isGlobalSyncing ? "animate-spin" : ""}`} />
                        <span>Синхронизировать</span>
                      </button>
                      <button
                        onClick={() => setIsAddProjectOpen(true)}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-all"
                      >
                        <SvgPlus className="w-3.5 h-3.5" />
                        <span>+ Создать чат</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  filteredProjects.map((proj) => {
                    const isSelected = proj.id === selectedProjectId;
                    const acc = accounts.find((a) => a.id === proj.accountId);
                    const isOnline = proj.status === "online";

                    return (
                      <div
                        key={proj.id}
                        onClick={() => setSelectedProjectId(proj.id)}
                        className={`group relative p-3 cursor-pointer transition-all border-l-2 ${
                          isSelected
                            ? "bg-accent/40 border-primary"
                            : "border-transparent hover:bg-accent/20"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isOnline
                                  ? "bg-emerald-500 ring-2 ring-emerald-500/20"
                                  : "bg-muted-foreground"
                              }`}
                            />
                            <h3
                              className={`text-xs font-semibold truncate ${
                                isSelected ? "text-foreground" : "text-foreground/90"
                              }`}
                            >
                              {proj.name}
                            </h3>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {proj.lastMessageTime}
                            </span>
                            {/* Quick delete icon on hover */}
                            <button
                              type="button"
                              onClick={(e) => handleDeleteProject(proj.id, e)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 hover:text-destructive text-muted-foreground transition-all shrink-0 ml-1"
                              title="Удалить чат"
                            >
                              <SvgTrash className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Account label & workflowId */}
                        <div className="flex items-center gap-2 mb-1.5 text-[10px] text-muted-foreground">
                          {acc && (
                            <span className="truncate max-w-[120px] bg-secondary px-1.5 py-0.5 rounded border border-border/60">
                              {acc.name}
                            </span>
                          )}
                          {proj.workflowId && (
                            <span className="flex items-center gap-1 font-mono text-emerald-400">
                              <SvgZap className="w-2.5 h-2.5" />
                              {proj.workflowId}
                            </span>
                          )}
                          {proj.aiActive && (
                            <span className="flex items-center gap-0.5 text-primary font-medium bg-primary/10 px-1 rounded border border-primary/20">
                              <SvgSparkles className="w-2.5 h-2.5" />
                              AI
                            </span>
                          )}
                          <span
                            className={`text-[9px] font-mono font-semibold px-1 rounded ${
                              isOnline ? "text-emerald-400" : "text-muted-foreground"
                            }`}
                          >
                            {isOnline ? "ВКЛ" : "ВЫКЛ"}
                          </span>
                        </div>

                        {/* Message snippet & Unread badge */}
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] text-muted-foreground truncate leading-relaxed">
                            {proj.lastMessagePreview || "Нет событий"}
                          </p>

                          {proj.unreadCount > 0 && (
                            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-primary text-primary-foreground shrink-0 shadow-xs font-mono">
                              {proj.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer info bar */}
              <div className="p-2.5 border-t border-border bg-card/60 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                <span>Проектов: {filteredProjects.length}</span>
                <span className="flex items-center gap-1">
                  <SvgServer className="w-3 h-3 text-emerald-400" />
                  n8n Hub Active
                </span>
              </div>
            </aside>

            {/* Right Column: Chat Feed & Composer */}
            <main className="flex-1 flex flex-col h-full bg-background min-w-0">
              {activeProject ? (
                <>
                  {/* Chat Header */}
                  <header className="h-14 px-4 border-b border-border flex items-center justify-between gap-3 bg-card/20 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-secondary border border-border flex items-center justify-center text-foreground shrink-0 shadow-xs">
                        {activeProject.channel === "telegram" ? (
                          <SvgSend className="w-4 h-4 text-sky-400" />
                        ) : (
                          <SvgZap className="w-4 h-4 text-emerald-400" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-semibold text-foreground truncate">
                            {activeProject.name}
                          </h2>
                          {activeAccount && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-secondary border border-border text-muted-foreground">
                              {activeAccount.name}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span
                            className={`flex items-center gap-1 font-mono ${
                              activeProject.status === "online" ? "text-emerald-400" : "text-muted-foreground"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                activeProject.status === "online"
                                  ? "bg-emerald-400 animate-pulse"
                                  : "bg-muted-foreground"
                              }`}
                            />
                            {activeProject.status === "online" ? "Поток активен" : "Поток выключен"}
                          </span>
                          <span>•</span>
                          <span>{activeProject.workflowId || "n8n Webhook"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Header Actions: Power Button, AI Toggle, Delete Chat */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Explicit Power ON/OFF Toggle ("Кнопка включения") */}
                      <button
                        type="button"
                        onClick={() =>
                          handleToggleProjectStatus(activeProject.id, activeProject.status)
                        }
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all shadow-xs ${
                          activeProject.status === "online"
                            ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25"
                            : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                        }`}
                        title={
                          activeProject.status === "online"
                            ? "Нажмите, чтобы выключить поток"
                            : "Нажмите, чтобы включить поток"
                        }
                      >
                        <SvgPower
                          className={`w-3.5 h-3.5 ${
                            activeProject.status === "online" ? "text-emerald-400" : "text-muted-foreground"
                          }`}
                        />
                        <span>{activeProject.status === "online" ? "ВКЛ (Активен)" : "ВЫКЛ (Отключен)"}</span>
                      </button>

                      {/* AI Triggers Button */}
                      <button
                        onClick={() => handleToggleAi(activeProject.id, activeProject.aiActive)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                          activeProject.aiActive
                            ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                            : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                        }`}
                        title="Автоматическая обработка событий n8n AI"
                      >
                        <SvgBot className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">
                          {activeProject.aiActive ? "AI Вкл" : "AI Выкл"}
                        </span>
                      </button>

                      {/* Delete Chat Button */}
                      <button
                        type="button"
                        onClick={() => handleDeleteProject(activeProject.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-secondary hover:bg-destructive/15 text-muted-foreground hover:text-destructive border border-border text-xs font-medium transition-all"
                        title="Удалить этот чат и историю событий"
                      >
                        <SvgTrash className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Удалить чат</span>
                      </button>

                      {/* Refresh Messages Button */}
                      <button
                        onClick={() => loadMessages(activeProject.id)}
                        className="p-1.5 rounded-lg hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                        title="Обновить ленту"
                      >
                        <SvgRefresh className="w-4 h-4" />
                      </button>
                    </div>
                  </header>

                  {/* Messages Feed */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
                    {isLoading ? (
                      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                        Загрузка событий...
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-muted-foreground space-y-2">
                        <SvgMessagesSquare className="w-8 h-8 opacity-40" />
                        <p className="text-xs">В этом потоке пока нет событий.</p>
                        <p className="text-[11px] opacity-75">
                          Отправьте команду ниже или запустите воркфлоу через webhook.
                        </p>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isUser = msg.sender === "user";
                        const isAgent = msg.sender === "agent";
                        const isWebhook = msg.sender === "webhook";
                        const isSystem = msg.sender === "system";

                        if (isSystem) {
                          return (
                            <div key={msg.id} className="flex justify-center my-2">
                              <div className="px-3 py-1 rounded-full text-[10px] font-mono bg-secondary/80 border border-border/80 text-muted-foreground flex items-center gap-1.5">
                                <SvgActivity className="w-3 h-3 text-emerald-400" />
                                <span>{msg.text}</span>
                                <span className="opacity-60">{msg.timestamp}</span>
                              </div>
                            </div>
                          );
                        }

                        const isRight = isUser || isAgent;
                        const meta = msg.metadata;

                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${isRight ? "items-end" : "items-start"}`}
                          >
                            <div className="flex items-center gap-1 mb-1 px-1 text-[10px] text-muted-foreground">
                              {isAgent ? (
                                <>
                                  <SvgBot className="w-3 h-3 text-emerald-400" />
                                  <span className="font-semibold text-emerald-400">
                                    {msg.senderName}
                                  </span>
                                </>
                              ) : isUser ? (
                                <>
                                  <SvgUser className="w-3 h-3 text-muted-foreground" />
                                  <span>Оператор</span>
                                </>
                              ) : isWebhook ? (
                                <>
                                  <SvgNetwork className="w-3 h-3 text-primary" />
                                  <span className="font-semibold text-foreground/90">
                                    {msg.senderName}
                                  </span>
                                </>
                              ) : (
                                <span className="font-semibold text-foreground/90">
                                  {msg.senderName}
                                </span>
                              )}
                              <span>•</span>
                              <span>{msg.timestamp}</span>
                            </div>

                            <div
                              className={`group relative rounded-2xl px-4 py-2.5 max-w-[85%] sm:max-w-[75%] text-xs leading-relaxed break-words shadow-xs border ${
                                isAgent
                                  ? "bg-emerald-500/10 border-emerald-500/25 text-foreground rounded-tr-xs"
                                  : isUser
                                  ? "bg-secondary border-border text-foreground rounded-tr-xs"
                                  : "bg-card border-border/70 text-foreground rounded-tl-xs"
                              }`}
                            >
                              <p className="whitespace-pre-wrap">{msg.text}</p>

                              {/* Rich Execution & Workflow Metadata */}
                              {meta && (
                                <div className="mt-2.5 pt-2 border-t border-border/50 flex flex-col gap-1.5">
                                  {/* Badges bar */}
                                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
                                    {/* Status Badge */}
                                    {meta.status && (
                                      <span
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border ${
                                          meta.status === "success"
                                            ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                                            : meta.status === "running"
                                            ? "bg-amber-500/15 border-amber-500/30 text-amber-400 animate-pulse"
                                            : meta.status === "error"
                                            ? "bg-destructive/15 border-destructive/30 text-destructive"
                                            : meta.status === "waiting"
                                            ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                                            : "bg-secondary border-border text-muted-foreground"
                                        }`}
                                      >
                                        <span
                                          className={`w-1.5 h-1.5 rounded-full ${
                                            meta.status === "success"
                                              ? "bg-emerald-400"
                                              : meta.status === "running"
                                              ? "bg-amber-400"
                                              : meta.status === "error"
                                              ? "bg-destructive"
                                              : "bg-muted-foreground"
                                          }`}
                                        />
                                        {meta.status}
                                      </span>
                                    )}

                                    {/* Workflow Name */}
                                    {meta.workflowName && (
                                      <span className="flex items-center gap-1 text-emerald-400 font-medium">
                                        <SvgZap className="w-2.5 h-2.5" />
                                        {meta.workflowName}
                                      </span>
                                    )}

                                    {/* Execution ID */}
                                    {meta.executionId && (
                                      <span
                                        className="text-muted-foreground bg-secondary/80 px-1 py-0.2 rounded border border-border/50 text-[9px]"
                                        title={`Execution ID: ${meta.executionId}`}
                                      >
                                        #{meta.executionId}
                                      </span>
                                    )}

                                    {/* Duration */}
                                    {meta.durationMs !== undefined && (
                                      <span className="text-muted-foreground flex items-center gap-0.5 ml-auto text-[9px]">
                                        <SvgClock className="w-2.5 h-2.5" />
                                        {meta.durationMs}ms
                                      </span>
                                    )}
                                  </div>

                                  {/* JSON Payload viewer (if payload has keys) */}
                                  {meta.payload &&
                                    typeof meta.payload === "object" &&
                                    Object.keys(meta.payload).length > 0 && (
                                      <div className="mt-1">
                                        <button
                                          type="button"
                                          onClick={() => togglePayload(msg.id)}
                                          className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground px-2 py-0.5 rounded bg-secondary/60 hover:bg-secondary border border-border/60 transition-colors"
                                        >
                                          <SvgCode className="w-3 h-3 text-emerald-400" />
                                          <span>
                                            {expandedPayloads[msg.id]
                                              ? "Скрыть JSON payload"
                                              : "Просмотреть JSON payload"}
                                          </span>
                                          <span className="opacity-60 text-[9px]">
                                            ({Object.keys(meta.payload).length} keys)
                                          </span>
                                        </button>

                                        {expandedPayloads[msg.id] && (
                                          <div className="mt-1.5 relative">
                                            <pre className="text-[10px] font-mono bg-background/90 text-foreground p-2.5 rounded-lg border border-border overflow-x-auto max-h-48 scrollbar-thin select-text">
                                              {JSON.stringify(meta.payload, null, 2)}
                                            </pre>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleCopyUrl(
                                                  JSON.stringify(meta.payload, null, 2),
                                                  "JSON payload скопирован в буфер"
                                                )
                                              }
                                              className="absolute top-1.5 right-1.5 p-1 rounded bg-secondary/90 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/60 transition-colors"
                                              title="Копировать JSON"
                                            >
                                              {copiedUrl === JSON.stringify(meta.payload, null, 2) ? (
                                                <SvgCheck className="w-3 h-3 text-emerald-400" />
                                              ) : (
                                                <SvgCopy className="w-3 h-3" />
                                              )}
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                </div>
                              )}

                              {isRight && (
                                <div className="flex justify-end items-center gap-1 mt-1 -mb-1 opacity-70">
                                  {msg.status === "read" || msg.status === "delivered" ? (
                                    <SvgCheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <SvgCheck className="w-3.5 h-3.5 text-muted-foreground" />
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Composer */}
                  <div className="p-3 border-t border-border bg-card/30">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">Режим:</span>
                        <div className="inline-flex rounded-md border border-border p-0.5 bg-secondary/50">
                          <button
                            type="button"
                            onClick={() => setSendMode("command")}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                              sendMode === "command"
                                ? "bg-emerald-500 text-white shadow-xs"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Команда для n8n AI
                          </button>
                          <button
                            type="button"
                            onClick={() => setSendMode("message")}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                              sendMode === "message"
                                ? "bg-background text-foreground shadow-xs"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Событие в поток
                          </button>
                        </div>
                      </div>

                      <span className="text-[10px] text-muted-foreground hidden sm:inline">
                        Enter — выполнить, Shift+Enter — новая строка
                      </span>
                    </div>

                    <div className="flex items-end gap-2 bg-secondary/60 hover:bg-secondary/80 focus-within:bg-background border border-border focus-within:border-emerald-500/50 rounded-xl p-2 transition-all">
                      <textarea
                        ref={inputRef}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        rows={2}
                        placeholder={
                          sendMode === "command"
                            ? `Запустить команду/workflow в ${activeProject.name}...`
                            : "Отправить тестовое событие или данные в webhook..."
                        }
                        className="flex-1 bg-transparent border-0 text-foreground placeholder:text-muted-foreground text-xs resize-none outline-none leading-relaxed p-1"
                      />

                      <button
                        onClick={handleSendMessage}
                        disabled={!inputText.trim() || isSending}
                        className="h-8 px-3 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-xs flex items-center justify-center gap-1.5 transition-all shrink-0 shadow-xs"
                      >
                        <SvgZap className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">
                          {isSending ? "Отправка..." : "Выполнить"}
                        </span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs p-8 text-center space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-secondary/80 border border-border flex items-center justify-center text-muted-foreground/60 shadow-xs">
                    <SvgZap className="w-7 h-7 text-emerald-400/60" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Выберите поток или создайте новый</h3>
                    <p className="text-[11px] text-muted-foreground mt-1 max-w-sm">
                      Подключите рабочие процессы из n8n, чтобы управлять ими в реальном времени, отправлять триггеры и отслеживать журнал выполнений.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={handleGlobalSync}
                      disabled={isGlobalSyncing}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 font-medium text-xs transition-all shadow-xs"
                    >
                      <SvgRefresh className={`w-3.5 h-3.5 ${isGlobalSyncing ? "animate-spin" : ""}`} />
                      <span>Синхронизировать с n8n</span>
                    </button>
                    <button
                      onClick={() => setIsAddProjectOpen(true)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-xs transition-all shadow-xs"
                    >
                      <SvgPlus className="w-3.5 h-3.5" />
                      <span>Создать чат</span>
                    </button>
                  </div>
                </div>
              )}
            </main>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 2: VISUAL n8n INSTANCES & GATEWAYS DASHBOARD             */}
        {/* ============================================================ */}
        {activeTab === "accounts" && (
          <div className="flex-1 overflow-y-auto p-6 bg-background">
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Header section */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                    <SvgServer className="w-5 h-5 text-emerald-400" />
                    Подключенные инстансы n8n и шлюзы
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Управление локальными и удаленными серверами n8n, Telegram-ботами и Webhook-маршрутизацией.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGlobalSync}
                    disabled={isGlobalSyncing}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary hover:bg-secondary/80 border border-border text-foreground text-xs font-medium transition-all shadow-xs"
                    title="Синхронизировать все инстансы"
                  >
                    <SvgRefresh className={`w-3.5 h-3.5 ${isGlobalSyncing ? "animate-spin text-emerald-400" : ""}`} />
                    <span>{isGlobalSyncing ? "Синхронизация..." : "Синхронизировать все"}</span>
                  </button>

                  <button
                    onClick={() => setIsAddAccountOpen(true)}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-xs shadow-sm transition-all"
                  >
                    <SvgPlus className="w-4 h-4" />
                    <span>Добавить n8n инстанс</span>
                  </button>
                </div>
              </div>

              {/* Grid of Account Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {accounts.map((acc) => {
                  const isOnline = acc.status === "online";
                  const isSyncingThis = syncingAccountId === acc.id;

                  return (
                    <div
                      key={acc.id}
                      className="group rounded-2xl border border-border bg-card/70 hover:bg-card hover:border-emerald-500/40 transition-all p-5 flex flex-col justify-between shadow-xs relative overflow-hidden"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-secondary border border-border flex items-center justify-center text-foreground shrink-0 shadow-xs">
                              {acc.channel === "telegram" ? (
                                <SvgSend className="w-5 h-5 text-sky-400" />
                              ) : acc.channel === "webhook" ? (
                                <SvgNetwork className="w-5 h-5 text-violet-400" />
                              ) : (
                                <SvgZap className="w-5 h-5 text-emerald-400" />
                              )}
                            </div>

                            <div>
                              <h3 className="text-xs font-bold text-foreground group-hover:text-emerald-400 transition-colors">
                                {acc.name}
                              </h3>
                              <p className="text-[11px] font-mono text-muted-foreground mt-0.5 truncate max-w-[140px]">
                                {acc.url}
                              </p>
                            </div>
                          </div>

                          {/* Status Badge */}
                          <div
                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                              isOnline
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                : "bg-destructive/10 border-destructive/30 text-destructive"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isOnline
                                  ? "bg-emerald-400 ring-2 ring-emerald-400/20"
                                  : "bg-destructive"
                              }`}
                            />
                            <span>{isOnline ? "В сети" : "Отключен"}</span>
                          </div>
                        </div>

                        {/* Stats block */}
                        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground mb-3">
                          <div className="bg-secondary/40 rounded-lg p-2.5 border border-border/30">
                            <span className="block text-[10px] opacity-75">Workflows:</span>
                            <span className="font-bold text-foreground text-xs font-mono text-emerald-400">
                              {acc.workflowsCount} активных
                            </span>
                          </div>
                          <div className="bg-secondary/40 rounded-lg p-2.5 border border-border/30">
                            <span className="block text-[10px] opacity-75">Выполнений:</span>
                            <span className="font-bold text-foreground text-xs font-mono">
                              {acc.executionsCount} запусков
                            </span>
                          </div>
                        </div>

                        {/* Last sync info (Safely formatted, never Invalid Date) */}
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mb-4 px-1">
                          <span>Синхронизация:</span>
                          <span>{formatSyncTime(acc.lastSync)}</span>
                        </div>
                      </div>

                      {/* Card Action Buttons */}
                      <div className="pt-3 border-t border-border/60 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          {/* Dedicated Per-Account Sync Button */}
                          <button
                            onClick={() => handleSyncAccount(acc)}
                            disabled={isSyncingThis}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition-all disabled:opacity-50"
                            title="Синхронизировать воркфлоу с этого инстанса"
                          >
                            <SvgRefresh className={`w-3.5 h-3.5 ${isSyncingThis ? "animate-spin text-emerald-400" : ""}`} />
                            <span>{isSyncingThis ? "Синхронизация..." : "Синхронизировать"}</span>
                          </button>

                          {/* Open Streams */}
                          <button
                            onClick={() => {
                              setSelectedAccountId(acc.id);
                              setActiveTab("chats");
                            }}
                            className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-secondary hover:bg-accent/60 text-foreground text-xs font-medium transition-all border border-border"
                            title="Открыть чаты инстанса"
                          >
                            <span>Потоки</span>
                            <SvgChevronRight className="w-3 h-3 text-muted-foreground" />
                          </button>
                        </div>

                        {/* Power ON / OFF Button & Delete */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30 text-[11px]">
                          {/* Instance Power ON/OFF Toggle */}
                          <button
                            onClick={() => handleToggleAccount(acc.id)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold transition-all border ${
                              isOnline
                                ? "bg-secondary hover:bg-destructive/15 hover:border-destructive/30 hover:text-destructive text-muted-foreground border-border"
                                : "bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-400"
                            }`}
                            title={isOnline ? "Выключить этот инстанс" : "Включить этот инстанс"}
                          >
                            <SvgPower className={`w-3.5 h-3.5 ${isOnline ? "text-emerald-400" : "text-muted-foreground"}`} />
                            <span>{isOnline ? "Выключить" : "Включить инстанс"}</span>
                          </button>

                          <button
                            onClick={() => handleDeleteAccount(acc.id)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Удалить инстанс"
                          >
                            <SvgTrash className="w-3 h-3" />
                            <span>Удалить</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Card to Add Account */}
                <div
                  onClick={() => setIsAddAccountOpen(true)}
                  className="rounded-2xl border-2 border-dashed border-border/80 hover:border-emerald-500/50 bg-card/20 hover:bg-card/40 transition-all p-6 flex flex-col items-center justify-center text-center cursor-pointer min-h-[220px]"
                >
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 mb-3 shadow-xs">
                    <SvgPlus className="w-6 h-6" />
                  </div>
                  <h4 className="text-xs font-bold text-foreground">Подключить n8n инстанс</h4>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-[200px]">
                    Локальный n8n, VPS сервер, Cloud или Webhook шлюз
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 3: VISUAL n8n CORE SERVICE DASHBOARD                    */}
        {/* ============================================================ */}
        {activeTab === "n8n" && (
          <div className="flex-1 overflow-y-auto p-6 bg-background">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                    <SvgZap className="w-5 h-5 text-emerald-400" />
                    Локальный n8n Automation Engine
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Статус сервиса n8n, динамические вебхук-эндпоинты и параметры маршрутизации.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGlobalSync}
                    disabled={isGlobalSyncing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground text-xs font-medium transition-all"
                  >
                    <SvgRefresh className={`w-3.5 h-3.5 ${isGlobalSyncing ? "animate-spin text-emerald-400" : ""}`} />
                    <span>Синхронизировать</span>
                  </button>

                  <a
                    href={n8nDynamicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-medium transition-all"
                  >
                    <span>Открыть n8n Web-UI</span>
                    <SvgExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Status Banner */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl border border-border bg-card/60">
                  <span className="text-[11px] text-muted-foreground block mb-1">Статус n8n</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        hubStatus?.n8nConnected ? "bg-emerald-400 animate-pulse" : "bg-destructive"
                      }`}
                    />
                    <span className="text-sm font-bold text-foreground">
                      {hubStatus?.n8nConnected ? "200 OK (Работает)" : "Подключение..."}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground mt-2 block">
                    Версия: {hubStatus?.n8nVersion || "n8n Core"}
                  </span>
                </div>

                <div className="p-4 rounded-xl border border-border bg-card/60">
                  <span className="text-[11px] text-muted-foreground block mb-1">Порт и адрес</span>
                  <span className="text-sm font-bold text-foreground font-mono block truncate">
                    {n8nDynamicUrl}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground mt-2 block">
                    Протокол: REST + Webhook
                  </span>
                </div>

                <div className="p-4 rounded-xl border border-border bg-card/60">
                  <span className="text-[11px] text-muted-foreground block mb-1">Хранилище n8n</span>
                  <span className="text-sm font-bold text-foreground block">
                    {hubStatus?.sqliteStatus === "connected"
                      ? "SQLite Подключена"
                      : hubStatus?.sqliteStatus === "fallback_local"
                      ? "Локальное хранилище"
                      : "Хранилище активно"}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground mt-2 block truncate">
                    ~/.n8n/database.sqlite
                  </span>
                </div>
              </div>

              {/* Dynamic Webhooks Section */}
              <div className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-foreground flex items-center gap-2">
                    <SvgNetwork className="w-4 h-4 text-emerald-400" />
                    Активные Webhook эндпоинты для чатов и триггеров
                  </h3>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    Кликните для копирования URL
                  </span>
                </div>

                {/* Base Engine Webhooks */}
                <div className="space-y-2 text-xs font-mono">
                  {[
                    {
                      method: "POST",
                      path: `${n8nDynamicUrl.replace(/\/+$/, "")}/webhook/api/projects/${selectedProjectId || ":projectId"}/send`,
                      desc: "Отправка команд и триггер воркфлоу",
                    },
                    {
                      method: "GET",
                      path: `${n8nDynamicUrl.replace(/\/+$/, "")}/api/v1/workflows`,
                      desc: "REST API: список рабочих процессов n8n",
                    },
                    {
                      method: "GET",
                      path: `${n8nDynamicUrl.replace(/\/+$/, "")}/api/v1/executions`,
                      desc: "REST API: журнал и аудит выполнений",
                    },
                  ].map((ep) => {
                    const isCopied = copiedUrl === ep.path;
                    return (
                      <div
                        key={ep.path}
                        className="p-3 rounded-xl bg-secondary/50 border border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-secondary/80 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              ep.method === "POST"
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                            }`}
                          >
                            {ep.method}
                          </span>
                          <span className="text-foreground truncate select-all">{ep.path}</span>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                          <span className="text-[10px] text-muted-foreground font-sans">
                            {ep.desc}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyUrl(ep.path, `Эндпоинт скопирован: ${ep.path}`)}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-sans transition-all border ${
                              isCopied
                                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                                : "bg-card border-border hover:bg-accent/60 text-muted-foreground hover:text-foreground"
                            }`}
                            title="Скопировать URL"
                          >
                            {isCopied ? (
                              <>
                                <SvgCheck className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Скопировано!</span>
                              </>
                            ) : (
                              <>
                                <SvgCopy className="w-3.5 h-3.5" />
                                <span>Копировать</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Per-Account Webhooks */}
                {accounts.length > 0 && (
                  <div className="pt-3 border-t border-border/40">
                    <h4 className="text-[11px] font-semibold text-muted-foreground mb-2.5 uppercase tracking-wider">
                      Эндпоинты зарегистрированных инстансов:
                    </h4>
                    <div className="space-y-2 text-xs font-mono">
                      {accounts.map((acc) => {
                        const targetEndpoint =
                          acc.channel === "n8n"
                            ? `${acc.url.replace(/\/+$/, "")}/webhook/api/projects/${selectedProjectId || ":projectId"}/send`
                            : acc.url;
                        const isCopied = copiedUrl === targetEndpoint;

                        return (
                          <div
                            key={acc.id}
                            className="p-3 rounded-xl bg-card border border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-emerald-500/30 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-secondary border border-border text-foreground uppercase">
                                {acc.channel}
                              </span>
                              <span className="text-xs font-semibold text-foreground truncate max-w-[120px]">
                                {acc.name}
                              </span>
                              <span className="text-muted-foreground truncate select-all text-[11px]">
                                {targetEndpoint}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                handleCopyUrl(targetEndpoint, `Webhook для "${acc.name}" скопирован`)
                              }
                              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-sans transition-all border shrink-0 ${
                                isCopied
                                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                                  : "bg-secondary border-border hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                              }`}
                              title="Скопировать URL"
                            >
                              {isCopied ? (
                                <>
                                  <SvgCheck className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Скопировано!</span>
                                </>
                              ) : (
                                <>
                                  <SvgCopy className="w-3.5 h-3.5" />
                                  <span>Копировать</span>
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* 4. MODAL: CONNECT NEW INSTANCE                               */}
      {/* ============================================================ */}
      {isAddAccountOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl relative">
            <button
              onClick={() => setIsAddAccountOpen(false)}
              className="absolute right-4 top-4 p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <SvgClose className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
                <SvgServer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Подключить n8n инстанс</h3>
                <p className="text-[11px] text-muted-foreground">
                  Добавьте n8n сервер, Telegram шлюз или внешний вебхук.
                </p>
              </div>
            </div>

            {/* Form */}
            <div className="space-y-4">
              {/* Channel Selector */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1.5">
                  Тип подключения
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "n8n", label: "n8n Server", icon: SvgZap },
                    { id: "telegram", label: "Telegram", icon: SvgSend },
                    { id: "webhook", label: "Webhook", icon: SvgNetwork },
                  ].map((ch) => {
                    const active = newAccChannel === ch.id;
                    const Icon = ch.icon;
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => setNewAccChannel(ch.id as any)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                          active
                            ? "bg-emerald-500/10 border-emerald-500 text-foreground shadow-xs"
                            : "bg-secondary/50 border-border text-muted-foreground hover:bg-secondary"
                        }`}
                      >
                        <Icon className={`w-4 h-4 ${active ? "text-emerald-400" : "text-muted-foreground"}`} />
                        <span>{ch.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Account Name */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1.5">
                  Название сервера / отдела
                </label>
                <input
                  type="text"
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  placeholder="Например: n8n Production VPS или Telegram Gateway"
                  className="w-full bg-secondary/60 focus:bg-background border border-border focus:border-emerald-500/50 text-foreground text-xs rounded-xl px-3 py-2 outline-none transition-all"
                />
              </div>

              {/* URL */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1.5">
                  Адрес сервера / Webhook URL
                </label>
                <input
                  type="text"
                  value={newAccUrl}
                  onChange={(e) => setNewAccUrl(e.target.value)}
                  placeholder="http://localhost:5678 или https://n8n.mycompany.com"
                  className="w-full bg-secondary/60 focus:bg-background border border-border focus:border-emerald-500/50 text-foreground text-xs rounded-xl px-3 py-2 outline-none font-mono transition-all"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1.5">
                  API Key (необязательно)
                </label>
                <input
                  type="password"
                  value={newAccApiKey}
                  onChange={(e) => setNewAccApiKey(e.target.value)}
                  placeholder="n8n_api_key_..."
                  className="w-full bg-secondary/60 focus:bg-background border border-border focus:border-emerald-500/50 text-foreground text-xs rounded-xl px-3 py-2 outline-none font-mono transition-all"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddAccountOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleCreateAccount}
                  disabled={!newAccName.trim() || !newAccUrl.trim() || isCreatingAcc}
                  className="px-4 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 text-xs font-medium transition-all shadow-xs"
                >
                  {isCreatingAcc ? "Подключение..." : "Подключить инстанс"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 5. MODAL: CREATE NEW PROJECT / CHAT                          */}
      {/* ============================================================ */}
      {isAddProjectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl relative">
            <button
              onClick={() => setIsAddProjectOpen(false)}
              className="absolute right-4 top-4 p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <SvgClose className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
                <SvgMessagesSquare className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Создать новый чат / поток</h3>
                <p className="text-[11px] text-muted-foreground">
                  Добавьте отдельный поток для воркфлоу n8n или триггеров.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Select Account / Instance */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1.5">
                  Привязать к инстансу
                </label>
                <select
                  value={newProjAccountId}
                  onChange={(e) => setNewProjAccountId(e.target.value)}
                  className="w-full bg-secondary/60 focus:bg-background border border-border focus:border-emerald-500/50 text-foreground text-xs rounded-xl px-3 py-2 outline-none transition-all"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.url})
                    </option>
                  ))}
                </select>
              </div>

              {/* Project Name */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1.5">
                  Название потока
                </label>
                <input
                  type="text"
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  placeholder="Например: Orders Sync Pipeline"
                  className="w-full bg-secondary/60 focus:bg-background border border-border focus:border-emerald-500/50 text-foreground text-xs rounded-xl px-3 py-2 outline-none transition-all"
                />
              </div>

              {/* Channel Selector */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1.5">
                  Канал
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "n8n", label: "n8n Workflow" },
                    { id: "telegram", label: "Telegram" },
                    { id: "webhook", label: "Webhook" },
                  ].map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setNewProjChannel(ch.id as any)}
                      className={`p-2 rounded-xl border text-xs font-medium transition-all ${
                        newProjChannel === ch.id
                          ? "bg-emerald-500/10 border-emerald-500 text-foreground shadow-xs"
                          : "bg-secondary/50 border-border text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      {ch.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Workflow ID */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1.5">
                  ID воркфлоу в n8n (необязательно)
                </label>
                <input
                  type="text"
                  value={newProjWorkflowId}
                  onChange={(e) => setNewProjWorkflowId(e.target.value)}
                  placeholder="Например: Wf-Order-Sync-01"
                  className="w-full bg-secondary/60 focus:bg-background border border-border focus:border-emerald-500/50 text-foreground text-xs rounded-xl px-3 py-2 outline-none font-mono transition-all"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1.5">
                  Теги (через запятую)
                </label>
                <input
                  type="text"
                  value={newProjTags}
                  onChange={(e) => setNewProjTags(e.target.value)}
                  placeholder="orders, sync, production"
                  className="w-full bg-secondary/60 focus:bg-background border border-border focus:border-emerald-500/50 text-foreground text-xs rounded-xl px-3 py-2 outline-none transition-all"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddProjectOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleCreateProject}
                  disabled={!newProjName.trim() || !newProjAccountId || isCreatingProj}
                  className="px-4 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 text-xs font-medium transition-all shadow-xs"
                >
                  {isCreatingProj ? "Создание..." : "Создать чат"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  // 1. Sidebar Nav Panel: Blackbox side navigation
  app.slots.navPanel({
    id: "project-hub",
    title: "Project Hub",
    icon: "MessagesSquare",
    path: "project-hub",
    component: ProjectHubView,
  });

  // 2. Thread Panel Tab: Tab alongside thread chat
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "project-hub",
    title: "Project Hub",
    icon: "MessagesSquare",
    layout: "flush",
    component: ProjectHubView,
  });
});
