import React, { useEffect, useState, useCallback, useMemo } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { Account, N8nWorkflow, N8nExecution, WebhookDispatchResult, PingInstanceResult } from "./src/types";
import { InstanceList } from "./src/components/InstanceList";
import { WorkflowList } from "./src/components/WorkflowList";
import { ExecutionLog } from "./src/components/ExecutionLog";
import { WebhookConsole } from "./src/components/WebhookConsole";
import { AddInstanceModal } from "./src/components/AddInstanceModal";
import { SvgZap, SvgActivity, SvgRefresh, SvgCheckCircle, SvgAlertCircle, SvgPlay, SvgSquare } from "./src/icons";

function isLocalPort5678(url: string): boolean {
  const clean = (url || "").trim();
  return (
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):5678(\/|\?|$)/i.test(clean) ||
    /^(localhost|127\.0\.0\.1|\[::1\]):5678(\/|\?|$)/i.test(clean)
  );
}

export function ProjectHubView() {
  const rpc = useRpc<typeof rpcContract>();

  // State: Instances
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [pingingId, setPingingId] = useState<string | null>(null);

  // State: Local n8n server process
  const [isServerBusy, setIsServerBusy] = useState(false);
  const [isServerRunning, setIsServerRunning] = useState(false);
  const [serverLogs, setServerLogs] = useState<string[]>([]);

  // State: Workflows & Executions
  const [workflows, setWorkflows] = useState<N8nWorkflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [executions, setExecutions] = useState<N8nExecution[]>([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [isLoadingExecutions, setIsLoadingExecutions] = useState(false);

  // Modal: Add Instance
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Active Instance & Workflow
  const activeAccount = useMemo(() => {
    return accounts.find((a) => a.id === selectedAccountId) || accounts[0] || null;
  }, [accounts, selectedAccountId]);

  const isLocalActive = useMemo(() => {
    if (!activeAccount) return false;
    return isLocalPort5678(activeAccount.url);
  }, [activeAccount]);

  const activeWorkflow = useMemo(() => {
    return workflows.find((w) => w.id === selectedWorkflowId) || workflows[0] || null;
  }, [workflows, selectedWorkflowId]);

  // Poll Local Server Status
  const pollServerStatus = useCallback(async () => {
    try {
      const res = await rpc.call("get_local_server_status", {});
      if (res?.ok) {
        setIsServerRunning(res.running);
        if (res.logs) setServerLogs(res.logs);

        // Sync local account badge immediately if local server status matches
        if (res.running) {
          setAccounts((prev) =>
            prev.map((a) =>
              isLocalPort5678(a.url) && a.status !== "online"
                ? { ...a, status: "online", lastSync: new Date().toISOString() }
                : a
            )
          );
        } else if (!isServerBusy) {
          setAccounts((prev) =>
            prev.map((a) =>
              isLocalPort5678(a.url) && a.status === "online"
                ? { ...a, status: "offline" }
                : a
            )
          );
        }
      }
    } catch {
      // ignore
    }
  }, [rpc, isServerBusy]);

  useEffect(() => {
    pollServerStatus();
    const interval = setInterval(pollServerStatus, 5000);
    return () => clearInterval(interval);
  }, [pollServerStatus]);

  // Load Accounts / Instances
  const loadAccounts = useCallback(async () => {
    try {
      const res = await rpc.call("get_accounts", null);
      if (res?.ok && res.accounts) {
        setAccounts(res.accounts);
        if (!selectedAccountId && res.accounts.length > 0) {
          setSelectedAccountId(res.accounts[0].id);
        }
      }
    } catch {
      // offline fallback
    }
  }, [rpc, selectedAccountId]);

  // Ping an instance
  const handlePingAccount = useCallback(async (accountId: string) => {
    setPingingId(accountId);
    try {
      const res = (await rpc.call("ping_instance", { accountId })) as unknown as PingInstanceResult;
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === accountId
            ? { ...a, status: res.status, latencyMs: res.latencyMs, lastSync: new Date().toISOString() }
            : a
        )
      );
      if (res.status === "online") {
        setIsServerRunning(true);
      }
    } catch {
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountId ? { ...a, status: "offline", latencyMs: undefined } : a))
      );
    } finally {
      setPingingId(null);
    }
  }, [rpc]);

  // Load Workflows for active account
  const loadWorkflows = useCallback(async (accId: string) => {
    if (!accId) return;
    setIsLoadingWorkflows(true);
    try {
      const res = await rpc.call("get_workflows", { accountId: accId });
      if (res?.ok && res.workflows) {
        setWorkflows(res.workflows);
        if (!selectedWorkflowId && res.workflows.length > 0) {
          setSelectedWorkflowId(res.workflows[0].id);
        }
      } else {
        setWorkflows([]);
      }
    } catch {
      setWorkflows([]);
    } finally {
      setIsLoadingWorkflows(false);
    }
  }, [rpc, selectedWorkflowId]);

  // Load Executions for selected workflow
  const loadExecutions = useCallback(async (accId: string, wfId?: string) => {
    if (!accId) return;
    setIsLoadingExecutions(true);
    try {
      const payload: { accountId: string; workflowId?: string } = { accountId: accId };
      if (wfId) payload.workflowId = wfId;
      const res = await rpc.call("get_executions", payload);
      if (res?.ok && res.executions) {
        setExecutions(res.executions);
      } else {
        setExecutions([]);
      }
    } catch {
      setExecutions([]);
    } finally {
      setIsLoadingExecutions(false);
    }
  }, [rpc]);

  // Initial load
  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // When active account changes, ping it and load its workflows
  useEffect(() => {
    if (activeAccount?.id) {
      handlePingAccount(activeAccount.id);
      loadWorkflows(activeAccount.id);
    }
  }, [activeAccount?.id, handlePingAccount, loadWorkflows]);

  // When active workflow changes, load executions
  useEffect(() => {
    if (activeAccount?.id && activeWorkflow?.id) {
      loadExecutions(activeAccount.id, activeWorkflow.id);
    } else {
      setExecutions([]);
    }
  }, [activeAccount?.id, activeWorkflow?.id, loadExecutions]);

  // Auto-refresh ping every 30s
  useEffect(() => {
    if (!activeAccount?.id) return;
    const interval = setInterval(() => {
      handlePingAccount(activeAccount.id);
    }, 30000);
    return () => clearInterval(interval);
  }, [activeAccount?.id, handlePingAccount]);

  // Toggle local server start/stop
  const handleToggleLocalServer = async () => {
    setIsServerBusy(true);
    try {
      if (isServerRunning) {
        await rpc.call("stop_local_server", {});
        setIsServerRunning(false);
        setIsServerBusy(false);
        setAccounts((prev) =>
          prev.map((a) =>
            isLocalPort5678(a.url)
              ? { ...a, status: "offline" }
              : a
          )
        );
        if (activeAccount?.id) {
          handlePingAccount(activeAccount.id);
        }
      } else {
        const startRes = await rpc.call("start_local_server", {});
        if (!startRes?.ok) {
          setIsServerBusy(false);
          return;
        }

        if (startRes.message?.includes("уже") || startRes.message?.includes("already")) {
          setIsServerRunning(true);
          setIsServerBusy(false);
          setAccounts((prev) =>
            prev.map((a) =>
              isLocalPort5678(a.url)
                ? { ...a, status: "online", lastSync: new Date().toISOString() }
                : a
            )
          );
          if (activeAccount?.id) {
            handlePingAccount(activeAccount.id);
            loadWorkflows(activeAccount.id);
          }
          return;
        }

        setAccounts((prev) =>
          prev.map((a) =>
            isLocalPort5678(a.url)
              ? { ...a, status: "syncing" }
              : a
          )
        );

        let inFlight = false;
        let attempts = 0;
        const maxAttempts = 60;
        const checkInterval = setInterval(async () => {
          if (inFlight) return;
          inFlight = true;
          attempts++;
          try {
            const statusRes = await rpc.call("get_local_server_status", {});
            if (statusRes?.logs) setServerLogs(statusRes.logs);
            if (statusRes?.running) {
              clearInterval(checkInterval);
              setIsServerRunning(true);
              setIsServerBusy(false);
              setAccounts((prev) =>
                prev.map((a) =>
                  isLocalPort5678(a.url)
                    ? { ...a, status: "online", lastSync: new Date().toISOString() }
                    : a
                )
              );
              if (activeAccount?.id) {
                handlePingAccount(activeAccount.id);
                loadWorkflows(activeAccount.id);
              }
              return;
            }
          } catch {
            // keep checking
          } finally {
            inFlight = false;
          }
          if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            setIsServerBusy(false);
            if (activeAccount?.id) handlePingAccount(activeAccount.id);
          }
        }, 1000);
      }
    } catch {
      setIsServerBusy(false);
    }
  };

  // Add Instance
  const handleAddInstance = async (name: string, url: string, apiKey?: string) => {
    const payload: { name: string; channel: "n8n"; url: string; apiKey?: string } = {
      name,
      channel: "n8n",
      url,
    };
    const cleanKey = apiKey?.trim();
    if (cleanKey) {
      payload.apiKey = cleanKey;
    }
    const res = await rpc.call("create_account", payload);
    if (res?.ok && res.account) {
      setAccounts((prev) => [...prev, res.account]);
      setSelectedAccountId(res.account.id);
      handlePingAccount(res.account.id);
    }
  };

  // Delete Instance
  const handleDeleteInstance = async (accountId: string) => {
    await rpc.call("delete_account", { accountId });
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    if (selectedAccountId === accountId) {
      setSelectedAccountId(accounts.find((a) => a.id !== accountId)?.id || "");
    }
  };

  // Dispatch Webhook
  const handleDispatchWebhook = async (
    path: string,
    payload: Record<string, unknown>
  ): Promise<WebhookDispatchResult> => {
    if (!activeAccount) {
      return { ok: false, error: "Нет выбранного активного инстанса n8n" };
    }
    const res = (await rpc.call("dispatch_webhook", {
      accountId: activeAccount.id,
      path,
      method: "POST",
      payload,
    })) as WebhookDispatchResult;

    // Refresh executions after webhook dispatch
    if (activeWorkflow?.id) {
      setTimeout(() => loadExecutions(activeAccount.id, activeWorkflow.id), 1200);
    }

    return res;
  };

  return (
    <div className="flex flex-col h-full w-full bg-background text-foreground select-none overflow-hidden font-sans">
      {/* Top Bar: Hub Header */}
      <header className="h-11 border-b border-border/40 bg-card/60 backdrop-blur-md px-3.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
            <SvgZap className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold tracking-tight text-foreground">
            n8n Hub
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            v2.0
          </span>
        </div>

        {/* Global Connection Badge & Server Control */}
        <div className="flex items-center gap-3">
          {activeAccount && (
            <div className="flex items-center gap-2 text-xs font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  isServerBusy || activeAccount.status === "syncing"
                    ? "bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                    : activeAccount.status === "online"
                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                    : "bg-rose-500"
                }`}
              />
              <span className="text-muted-foreground">
                {activeAccount.name}:
              </span>
              <span
                className={
                  isServerBusy || activeAccount.status === "syncing"
                    ? "text-amber-400 font-bold"
                    : activeAccount.status === "online"
                    ? "text-emerald-400 font-bold"
                    : "text-rose-400"
                }
              >
                {isServerBusy || activeAccount.status === "syncing"
                  ? "STARTING..."
                  : activeAccount.status === "online"
                  ? "CONNECTED"
                  : "OFFLINE"}
              </span>
              {activeAccount.latencyMs !== undefined && (
                <span className="text-muted-foreground text-[10px]">
                  ({activeAccount.latencyMs}ms)
                </span>
              )}
            </div>
          )}

          {/* Quick Start / Stop Server Button in Header */}
          {isLocalActive && (
            <button
              onClick={handleToggleLocalServer}
              disabled={isServerBusy}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                isServerBusy
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse"
                  : isServerRunning
                  ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20"
                  : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(52,211,153,0.15)]"
              }`}
              title={isServerRunning ? "Остановить локальный n8n" : "Запустить локальный n8n на порту 5678"}
            >
              {isServerBusy ? (
                <>
                  <SvgActivity className="w-3.5 h-3.5 animate-spin" />
                  <span>Запуск...</span>
                </>
              ) : isServerRunning ? (
                <>
                  <SvgSquare className="w-3 h-3 text-rose-400" />
                  <span>Остановить n8n</span>
                </>
              ) : (
                <>
                  <SvgPlay className="w-3 h-3 text-emerald-400" />
                  <span>Запустить n8n</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={() => {
              if (activeAccount?.id) {
                handlePingAccount(activeAccount.id);
                loadWorkflows(activeAccount.id);
                if (activeWorkflow?.id) loadExecutions(activeAccount.id, activeWorkflow.id);
                pollServerStatus();
              }
            }}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
            title="Обновить всё"
          >
            <SvgRefresh className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* 3-Column Core Workspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* Column 1: Instances Sidebar */}
        <InstanceList
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          onSelectAccount={(id) => {
            setSelectedAccountId(id);
            setSelectedWorkflowId("");
          }}
          onAddAccount={() => setIsAddModalOpen(true)}
          onDeleteAccount={handleDeleteInstance}
          onPingAccount={handlePingAccount}
          pingingId={pingingId}
          onToggleServer={handleToggleLocalServer}
          isServerRunning={isServerRunning}
          isServerBusy={isServerBusy}
        />

        {/* Column 2: Workflows List */}
        <WorkflowList
          workflows={workflows}
          selectedWorkflowId={selectedWorkflowId}
          onSelectWorkflow={(id) => setSelectedWorkflowId(id)}
          onRefresh={() => {
            if (activeAccount?.id) loadWorkflows(activeAccount.id);
          }}
          isLoading={isLoadingWorkflows}
          instanceName={activeAccount?.name || ""}
          isLocalInstance={isLocalActive}
          isOffline={activeAccount?.status !== "online"}
          onStartServer={handleToggleLocalServer}
          isServerStarting={isServerBusy}
        />

        {/* Column 3: Detail Workspace (Top: Execution/Server Log, Bottom: Webhook Console) */}
        <section className="flex-1 flex flex-col h-full overflow-hidden bg-background">
          {activeWorkflow ? (
            <>
              {/* Upper Section: Execution Log + Server Terminal */}
              <div className="flex-1 flex flex-col min-h-[220px] overflow-hidden">
                <ExecutionLog
                  executions={executions}
                  isLoading={isLoadingExecutions}
                  serverLogs={serverLogs}
                  isServerRunning={isServerRunning}
                />
              </div>

              {/* Lower Section: Webhook Console & Dispatcher */}
              <div className="h-[280px] shrink-0">
                <WebhookConsole
                  instanceUrl={activeAccount?.url || "http://localhost:5678"}
                  workflowId={activeWorkflow.id}
                  workflowName={activeWorkflow.name}
                  onDispatch={handleDispatchWebhook}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <ExecutionLog
                executions={[]}
                isLoading={false}
                serverLogs={serverLogs}
                isServerRunning={isServerRunning}
              />
            </div>
          )}
        </section>
      </main>

      {/* Add Instance Modal */}
      <AddInstanceModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddInstance}
      />
    </div>
  );
}

// Register ProjectHubView into Blackbox UI slots
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "project-hub",
    title: "Project Hub",
    icon: "MessagesSquare",
    path: "project-hub",
    component: ProjectHubView,
  });

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
