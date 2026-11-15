import React, { useState, useEffect, useCallback } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type {
  MuseConversation,
  MuseMessage,
  MediaJob,
  ProactiveTask,
  VMStatus,
  MemoryRecord,
  SystemStatus,
  MuseMode,
} from "./src/types";

import { HeaderBar, type TabType } from "./src/components/HeaderBar";
import { ChatMuseTab } from "./src/components/ChatMuseTab";
import { MediaStudioTab } from "./src/components/MediaStudioTab";
import { ProactiveTasksTab } from "./src/components/ProactiveTasksTab";
import { VmMemoryTab } from "./src/components/VmMemoryTab";

function downloadFile(filename: string, content: string, mime: string) {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Failed to download file:", err);
  }
}

export function MetaMuseView() {
  const rpc = useRpc<typeof rpcContract>();

  // Navigation & Global Mode
  const [activeTab, setActiveTab] = useState<TabType>("chat");
  const [currentMode, setCurrentMode] = useState<MuseMode>("creative");
  const [isModeChanging, setIsModeChanging] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);

  // Tab 1: Chat & Muse state
  const [conversations, setConversations] = useState<MuseConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string>("");
  const [messages, setMessages] = useState<MuseMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  // Tab 2: Media Studio state
  const [mediaJobs, setMediaJobs] = useState<MediaJob[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Tab 3: Proactive Tasks state
  const [tasks, setTasks] = useState<ProactiveTask[]>([]);

  // Tab 4: VM & Memory state
  const [vmStatus, setVmStatus] = useState<VMStatus | null>(null);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);

  // ==========================================================================
  // DATA FETCHING HANDLERS
  // ==========================================================================

  const loadSystemStatus = useCallback(async () => {
    try {
      const res = await rpc.call("get_system_status", {});
      if (res) {
        setSystemStatus(res);
        if (!isModeChanging) {
          setCurrentMode(res.currentMode);
        }
      }
    } catch {
      // ignore
    }
  }, [rpc, isModeChanging]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await rpc.call("list_conversations", { limit: 50 });
      if (res && res.conversations) {
        setConversations(res.conversations);
        if (!selectedConvId && res.conversations.length > 0) {
          setSelectedConvId(res.conversations[0].id);
        }
      }
    } catch {
      // ignore
    }
  }, [rpc, selectedConvId]);

  const loadConversationMessages = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await rpc.call("get_conversation", { conversationId: id });
      if (res) {
        setMessages(res.messages);
      }
    } catch {
      // ignore
    }
  }, [rpc]);

  const loadMediaJobs = useCallback(async () => {
    try {
      const res = await rpc.call("list_media_jobs", { limit: 50 });
      if (res) {
        setMediaJobs(res.jobs);
      }
    } catch {
      // ignore
    }
  }, [rpc]);

  const loadTasks = useCallback(async () => {
    try {
      const res = await rpc.call("list_proactive_tasks", {});
      if (res) {
        setTasks(res.tasks);
      }
    } catch {
      // ignore
    }
  }, [rpc]);

  const loadVMStatus = useCallback(async (refresh = false) => {
    try {
      const res = await rpc.call("get_vm_status", { refresh });
      if (res) {
        setVmStatus(res);
      }
    } catch {
      // ignore
    }
  }, [rpc]);

  const loadMemories = useCallback(async () => {
    try {
      const res = await rpc.call("list_memories", { limit: 100 });
      if (res) {
        setMemories(res.memories);
      }
    } catch {
      // ignore
    }
  }, [rpc]);

  // Initial Load & Background Polling
  useEffect(() => {
    loadSystemStatus();
    loadConversations();
    loadMediaJobs();
    loadTasks();
    loadVMStatus();
    loadMemories();

    const interval = setInterval(() => {
      loadSystemStatus();
      loadMediaJobs();
      loadTasks();
    }, 4000);

    return () => clearInterval(interval);
  }, [loadSystemStatus, loadConversations, loadMediaJobs, loadTasks, loadVMStatus, loadMemories]);

  // Re-load messages when conversation changes
  useEffect(() => {
    if (selectedConvId) {
      loadConversationMessages(selectedConvId);
    }
  }, [selectedConvId, loadConversationMessages]);

  // ==========================================================================
  // ACTIONS: MODE & CHAT
  // ==========================================================================

  const handleModeChange = async (mode: MuseMode) => {
    setIsModeChanging(true);
    setCurrentMode(mode);
    try {
      await rpc.call("switch_mode", {
        mode,
        conversationId: selectedConvId || undefined,
      });
      loadSystemStatus();
    } catch {
      // ignore
    } finally {
      setIsModeChanging(false);
    }
  };

  const handleCreateConversation = async (title?: string) => {
    try {
      const res = await rpc.call("create_conversation", {
        title: title || `Новый диалог ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        mode: currentMode,
      });
      if (res) {
        setConversations((prev) => [res, ...prev]);
        setSelectedConvId(res.id);
        setMessages([]);
      }
    } catch {
      // ignore
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    try {
      const res = await rpc.call("delete_conversation", { conversationId: convId });
      if (res && res.success) {
        setConversations((prev) => prev.filter((c) => c.id !== convId));
        if (selectedConvId === convId) {
          const remaining = conversations.filter((c) => c.id !== convId);
          if (remaining.length > 0) {
            setSelectedConvId(remaining[0].id);
          } else {
            setSelectedConvId("");
            setMessages([]);
          }
        }
      }
    } catch {
      // ignore
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isSending) return;
    setIsSending(true);
    try {
      const res = await rpc.call("send_message", {
        conversationId: selectedConvId || undefined,
        content: text,
        mode: currentMode,
      });
      if (res) {
        if (!selectedConvId) {
          setSelectedConvId(res.conversationId);
        }
        setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
        loadConversations();
      }
    } catch {
      // ignore
    } finally {
      setIsSending(false);
    }
  };

  const handleExportChat = async (convId: string, format: "markdown" | "json") => {
    try {
      const res = await rpc.call("export_chat", { conversationId: convId, format });
      if (res) {
        const ext = format === "json" ? "json" : "md";
        const mime = format === "json" ? "application/json" : "text/markdown";
        const filename = `${res.title.replace(/[^a-zA-Z0-9_\u0400-\u04FF]/g, "_")}.${ext}`;
        downloadFile(filename, res.content, mime);
      }
    } catch {
      // ignore
    }
  };

  // ==========================================================================
  // ACTIONS: MEDIA STUDIO
  // ==========================================================================

  const handleGenerateMedia = async (params: {
    prompt: string;
    negativePrompt?: string;
    type: "image" | "video";
    stylePreset: string;
    aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
    seed?: number;
  }) => {
    setIsGenerating(true);
    try {
      const res = await rpc.call("generate_media", params);
      if (res) {
        setMediaJobs((prev) => [res, ...prev.filter((j) => j.id !== res.id)]);
      }
    } catch {
      // ignore
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteMediaJob = async (jobId: string) => {
    try {
      const res = await rpc.call("delete_media_job", { jobId });
      if (res && res.success) {
        setMediaJobs((prev) => prev.filter((j) => j.id !== jobId));
      }
    } catch {
      // ignore
    }
  };

  // ==========================================================================
  // ACTIONS: PROACTIVE TASKS
  // ==========================================================================

  const handleCreateTask = async (params: {
    title: string;
    description?: string;
    triggerType: "cron" | "interval" | "due_date";
    scheduleExpression: string;
    actionType: "reminder" | "digest" | "audit" | "web_poll" | "custom_script";
  }) => {
    try {
      const res = await rpc.call("create_proactive_task", params);
      if (res) {
        setTasks((prev) => [res, ...prev]);
        loadSystemStatus();
      }
    } catch {
      // ignore
    }
  };

  const handleToggleTaskStatus = async (taskId: string) => {
    try {
      const res = await rpc.call("toggle_task_status", { taskId });
      if (res) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? res : t)));
      }
    } catch {
      // ignore
    }
  };

  const handleTriggerTaskNow = async (taskId: string) => {
    try {
      const res = await rpc.call("trigger_task_now", { taskId });
      if (res && res.task) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? res.task : t)));
      }
    } catch {
      // ignore
    }
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      const res = await rpc.call("cancel_proactive_task", { taskId, deletePermanent: true });
      if (res && res.success) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        loadSystemStatus();
      }
    } catch {
      // ignore
    }
  };

  // ==========================================================================
  // ACTIONS: VM & MEMORY
  // ==========================================================================

  const handleRefreshVM = async () => {
    await loadVMStatus(true);
  };

  const handleStoreMemory = async (params: {
    key: string;
    content: string;
    category?: "preference" | "fact" | "project" | "instruction";
    confidence?: number;
    tags?: string[];
  }) => {
    try {
      const res = await rpc.call("store_memory", params);
      if (res) {
        setMemories((prev) => [res, ...prev.filter((m) => m.id !== res.id)]);
        loadSystemStatus();
      }
    } catch {
      // ignore
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    try {
      const res = await rpc.call("delete_memory", { memoryId });
      if (res && res.success) {
        setMemories((prev) => prev.filter((m) => m.id !== memoryId));
        loadSystemStatus();
      }
    } catch {
      // ignore
    }
  };

  const handleSearchMemory = async (
    query: string,
    category?: "preference" | "fact" | "project" | "instruction"
  ) => {
    if (!query.trim()) {
      loadMemories();
      return;
    }
    try {
      const res = await rpc.call("search_memory", { query, category });
      if (res && res.matches) {
        setMemories(res.matches);
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0B0E14] text-slate-100 font-sans select-none overflow-hidden relative">
      {/* Iridescent spectrum background glow */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[#0866FF]/10 blur-3xl" />
        <div className="absolute top-1/2 -right-32 w-96 h-96 rounded-full bg-[#E03E93]/10 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 w-96 h-96 rounded-full bg-[#00C4B4]/10 blur-3xl" />
      </div>

      {/* Iridescent Top Navigation & Telemetry Bar */}
      <HeaderBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        systemStatus={systemStatus}
        currentMode={currentMode}
        onModeChange={handleModeChange}
        isModeChanging={isModeChanging}
      />

      {/* Main View Port */}
      <main className="flex-1 overflow-hidden p-4 z-10">
        {activeTab === "chat" && (
          <ChatMuseTab
            conversations={conversations}
            selectedConvId={selectedConvId}
            onSelectConversation={setSelectedConvId}
            onCreateConversation={handleCreateConversation}
            onDeleteConversation={handleDeleteConversation}
            messages={messages}
            onSendMessage={handleSendMessage}
            isSending={isSending}
            currentMode={currentMode}
            onExportChat={handleExportChat}
          />
        )}

        {activeTab === "studio" && (
          <MediaStudioTab
            mediaJobs={mediaJobs}
            onGenerateMedia={handleGenerateMedia}
            onDeleteMediaJob={handleDeleteMediaJob}
            isGenerating={isGenerating}
          />
        )}

        {activeTab === "tasks" && (
          <ProactiveTasksTab
            tasks={tasks}
            onCreateTask={handleCreateTask}
            onToggleTaskStatus={handleToggleTaskStatus}
            onTriggerTaskNow={handleTriggerTaskNow}
            onCancelTask={handleCancelTask}
          />
        )}

        {activeTab === "vm" && (
          <VmMemoryTab
            vmStatus={vmStatus}
            onRefreshVM={handleRefreshVM}
            memories={memories}
            onStoreMemory={handleStoreMemory}
            onDeleteMemory={handleDeleteMemory}
            onSearchMemory={handleSearchMemory}
          />
        )}
      </main>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "meta-muse",
    title: "Meta Muse AI",
    icon: "Sparkles",
    path: "meta-muse",
    component: MetaMuseView,
  });

  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "meta-muse",
    title: "Meta Muse AI",
    icon: "Sparkles",
    layout: "flush",
    component: MetaMuseView,
  });
});
