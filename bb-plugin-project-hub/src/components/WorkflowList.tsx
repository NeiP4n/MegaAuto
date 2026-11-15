import React, { useState, useMemo } from "react";
import type { N8nWorkflow } from "../types";
import { SvgZap, SvgSearch, SvgRefresh, SvgCheckCircle, SvgAlertCircle, SvgClock, SvgPower } from "../icons";

interface WorkflowListProps {
  workflows: N8nWorkflow[];
  selectedWorkflowId: string;
  onSelectWorkflow: (id: string) => void;
  onRefresh: () => void;
  isLoading: boolean;
  instanceName: string;
  isLocalInstance?: boolean;
  isOffline?: boolean;
  onStartServer?: () => void;
  isServerStarting?: boolean;
}

export function WorkflowList({
  workflows,
  selectedWorkflowId,
  onSelectWorkflow,
  onRefresh,
  isLoading,
  instanceName,
  isLocalInstance,
  isOffline,
  onStartServer,
  isServerStarting,
}: WorkflowListProps) {
  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");

  const filtered = useMemo(() => {
    return workflows.filter((w) => {
      if (filterActive === "active" && !w.active) return false;
      if (filterActive === "inactive" && w.active) return false;
      if (search && !w.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [workflows, filterActive, search]);

  return (
    <section className="flex-1 border-r border-border/40 bg-background/50 flex flex-col min-w-[320px] max-w-[480px] h-full select-none">
      {/* Header bar */}
      <div className="h-11 px-3.5 border-b border-border/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <SvgZap className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate">
            {instanceName || "Воркфлоу n8n"}
          </span>
          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-secondary text-muted-foreground shrink-0">
            {workflows.length}
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title="Обновить воркфлоу"
        >
          <SvgRefresh className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-emerald-400" : ""}`} />
        </button>
      </div>

      {/* Search & Filters */}
      <div className="p-2.5 border-b border-border/30 space-y-2">
        <div className="relative">
          <SvgSearch className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по воркфлоу..."
            className="w-full bg-secondary/60 border border-border/40 rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:border-emerald-500/50 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1 text-[11px]">
          {(["all", "active", "inactive"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterActive(mode)}
              className={`px-2 py-0.5 rounded transition-all capitalize font-medium ${
                filterActive === mode
                  ? "bg-secondary text-foreground border border-border/60"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
              }`}
            >
              {mode === "all" ? "Все" : mode === "active" ? "Активные" : "Выкл"}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 text-xs text-muted-foreground">
            {isLocalInstance && isOffline ? (
              <div className="p-4 rounded-xl border border-border/40 bg-card/60 max-w-xs text-center space-y-3">
                <div className={`w-9 h-9 rounded-full ${isServerStarting ? "bg-amber-500/15 text-amber-400 animate-pulse" : "bg-rose-500/10 text-rose-400"} mx-auto flex items-center justify-center font-bold text-sm`}>
                  {isServerStarting ? "⏳" : "!"}
                </div>
                <div>
                  <div className="font-semibold text-foreground text-xs">
                    {isServerStarting ? "Локальный n8n запускается..." : "Локальный сервер выключен"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {isServerStarting
                      ? "Инициализация нод и запуск n8n процесса (обычно 10-25 сек)..."
                      : "Запустите n8n для загрузки сценариев и отправки вебхук-команд."}
                  </div>
                </div>
                {onStartServer && (
                  <button
                    onClick={onStartServer}
                    disabled={isServerStarting}
                    className="w-full py-2 px-3 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition-all flex items-center justify-center gap-1.5 shadow-[0_0_12px_rgba(52,211,153,0.15)] cursor-pointer"
                  >
                    {isServerStarting ? "Запуск сервера..." : "▶ Запустить локальный n8n"}
                  </button>
                )}
              </div>
            ) : (
              workflows.length === 0 ? "Воркфлоу не найдены или инстанс оффлайн." : "Ничего не найдено по фильтру."
            )}
          </div>
        ) : (
          filtered.map((w) => {
            const isSelected = w.id === selectedWorkflowId;
            const lastStatus = w.lastExecution?.status;

            return (
              <div
                key={w.id}
                onClick={() => onSelectWorkflow(w.id)}
                className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-secondary border-emerald-500/50 shadow-xs"
                    : "bg-card/30 border-border/20 hover:bg-card/70 hover:border-border/50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-foreground truncate">
                        {w.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase px-1.5 py-0.2 rounded ${
                          w.active
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-muted/30 text-muted-foreground border border-border/30"
                        }`}
                      >
                        {w.active ? "Active" : "Paused"}
                      </span>

                      {lastStatus && (
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded ${
                            lastStatus === "success"
                              ? "text-emerald-400 bg-emerald-500/10"
                              : lastStatus === "error"
                              ? "text-rose-400 bg-rose-500/10"
                              : "text-amber-400 bg-amber-500/10"
                          }`}
                        >
                          {lastStatus === "success" ? (
                            <SvgCheckCircle className="w-2.5 h-2.5" />
                          ) : lastStatus === "error" ? (
                            <SvgAlertCircle className="w-2.5 h-2.5" />
                          ) : (
                            <SvgClock className="w-2.5 h-2.5 animate-spin" />
                          )}
                          <span className="capitalize">{lastStatus}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
