import React, { useState, useRef, useEffect } from "react";
import type { N8nExecution } from "../types";
import { SvgClock, SvgCheckCircle, SvgAlertCircle, SvgActivity, SvgTerminal } from "../icons";

interface ExecutionLogProps {
  executions: N8nExecution[];
  isLoading: boolean;
  serverLogs?: string[];
  isServerRunning?: boolean;
}

export function ExecutionLog({ executions, isLoading, serverLogs = [], isServerRunning }: ExecutionLogProps) {
  const [activeTab, setActiveTab] = useState<"executions" | "server">("executions");
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === "server") {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [serverLogs, activeTab]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-text font-sans">
      {/* Tabs Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5 bg-card/20 shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("executions")}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              activeTab === "executions"
                ? "bg-secondary text-foreground border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
            }`}
          >
            История запусков ({executions.length})
          </button>
          <button
            onClick={() => setActiveTab("server")}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === "server"
                ? "bg-secondary text-foreground border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
            }`}
          >
            <SvgTerminal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Сервер n8n</span>
            {isServerRunning && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
        </div>
      </div>

      {/* Tab 1: Executions */}
      {activeTab === "executions" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground gap-2 py-10">
              <SvgActivity className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400" />
              <span>Загрузка истории запусков...</span>
            </div>
          ) : executions.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-xs text-muted-foreground py-12 px-4 text-center">
              <SvgClock className="w-8 h-8 opacity-30 mb-2" />
              <p>Нет зарегистрированных запусков для этого воркфлоу.</p>
              <p className="text-[11px] opacity-60 mt-1">
                Запустите воркфлоу вручную или отправьте вебхук-триггер из консоли.
              </p>
            </div>
          ) : (
            executions.map((exec) => {
              const isSuccess = exec.status === "success";
              const isError = exec.status === "error";

              return (
                <div
                  key={exec.id}
                  className={`p-2.5 rounded-lg border transition-all text-xs ${
                    isSuccess
                      ? "bg-card/40 border-border/30 hover:border-emerald-500/30"
                      : isError
                      ? "bg-destructive/5 border-destructive/20"
                      : "bg-amber-500/5 border-amber-500/20"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                      {isSuccess ? (
                        <SvgCheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : isError ? (
                        <SvgAlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                      ) : (
                        <SvgClock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
                      )}
                      <span className="text-foreground font-semibold">#{exec.id}</span>
                      <span className="text-muted-foreground">({exec.mode || "trigger"})</span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                      {exec.durationMs !== undefined && <span>{exec.durationMs}ms</span>}
                      <span>
                        {new Date(exec.startedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>

                  {isError && exec.errorMessage && (
                    <div className="mt-1.5 p-2 rounded bg-destructive/10 border border-destructive/20 text-[11px] text-destructive font-mono break-words leading-relaxed">
                      {exec.errorNodeName && (
                        <span className="font-bold underline block mb-0.5">
                          Узел: {exec.errorNodeName}
                        </span>
                      )}
                      {exec.errorMessage}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 2: Live Server Logs */}
      {activeTab === "server" && (
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs bg-muted/50 space-y-1">
          {serverLogs.length === 0 ? (
            <div className="text-muted-foreground text-center py-10 text-[11px]">
              Логи сервера n8n пока пусты. Нажмите «Запустить n8n» для старта.
            </div>
          ) : (
            serverLogs.map((log, idx) => (
              <div key={idx} className="text-muted-foreground leading-relaxed break-all hover:text-foreground">
                <span className="text-emerald-600/70 dark:text-emerald-500/70 select-none mr-2">›</span>
                {log}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}
