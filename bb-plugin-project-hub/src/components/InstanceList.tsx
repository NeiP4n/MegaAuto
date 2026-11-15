import React from "react";
import type { Account } from "../types";
import { SvgServer, SvgZap, SvgPlus, SvgTrash, SvgRefresh, SvgActivity } from "../icons";

interface InstanceListProps {
  accounts: Account[];
  selectedAccountId: string;
  onSelectAccount: (id: string) => void;
  onAddAccount: () => void;
  onDeleteAccount: (id: string) => void;
  onPingAccount: (id: string) => void;
  pingingId?: string | null;
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  isServerBusy?: boolean;
}

export function InstanceList({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onAddAccount,
  onDeleteAccount,
  onPingAccount,
  pingingId,
  onToggleServer,
  isServerRunning,
  isServerBusy,
}: InstanceListProps) {
  return (
    <aside className="w-64 border-r border-border/40 bg-card/40 flex flex-col shrink-0 h-full select-none">
      {/* Header */}
      <div className="h-11 px-3.5 border-b border-border/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SvgServer className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
            Инстансы n8n
          </span>
          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-secondary text-foreground">
            {accounts.length}
          </span>
        </div>
        <button
          onClick={onAddAccount}
          className="p-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 transition-all text-xs flex items-center gap-1 font-medium"
          title="Добавить n8n инстанс"
        >
          <SvgPlus className="w-3.5 h-3.5" />
          <span>Новый</span>
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {accounts.length === 0 ? (
          <div className="text-center py-8 px-3 text-xs text-muted-foreground">
            Нет подключенных инстансов.
            <button
              onClick={onAddAccount}
              className="mt-2 text-emerald-600 dark:text-emerald-400 hover:underline block mx-auto font-medium"
            >
              + Подключить n8n
            </button>
          </div>
        ) : (
          accounts.map((acc) => {
            const isSelected = acc.id === selectedAccountId;
            const isOnline = acc.status === "online";
            const isPinging = pingingId === acc.id;

            return (
              <div
                key={acc.id}
                onClick={() => onSelectAccount(acc.id)}
                className={`group relative p-2.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-secondary/90 border-emerald-500/40 shadow-xs"
                    : "bg-card/50 border-border/30 hover:bg-card/90 hover:border-border/60"
                }`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isOnline
                            ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                            : "bg-destructive/80"
                        }`}
                      />
                      <span className="text-xs font-semibold text-foreground truncate">
                        {acc.name}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
                      {acc.url.replace(/^https?:\/\//, "")}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {(acc.url.includes("localhost") || acc.url.includes("127.0.0.1")) && onToggleServer && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleServer();
                        }}
                        disabled={isServerBusy}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-all ${
                          isServerBusy
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse"
                            : isOnline
                            ? "bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20"
                            : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        }`}
                        title={isOnline ? "Остановить n8n" : "Запустить n8n"}
                      >
                        {isServerBusy ? "..." : isOnline ? "Стоп" : "Старт"}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPingAccount(acc.id);
                      }}
                      disabled={isPinging}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      title="Проверить пинг (/healthz)"
                    >
                      <SvgActivity className={`w-3.5 h-3.5 ${isPinging ? "animate-spin text-emerald-600 dark:text-emerald-400" : ""}`} />
                    </button>
                    {accounts.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteAccount(acc.id);
                        }}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Удалить инстанс"
                      >
                        <SvgTrash className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Footer metrics */}
                <div className="mt-2 pt-1.5 border-t border-border/20 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="font-mono">
                    {acc.latencyMs !== undefined ? `${acc.latencyMs} ms` : isOnline ? "online" : "offline"}
                  </span>
                  <span>
                    {acc.workflowsCount || 0} воркфлоу
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
