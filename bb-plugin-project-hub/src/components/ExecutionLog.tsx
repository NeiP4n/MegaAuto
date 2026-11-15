import React from "react";
import type { N8nExecution } from "../types";
import { SvgClock, SvgCheckCircle, SvgAlertCircle, SvgActivity } from "../icons";

interface ExecutionLogProps {
  executions: N8nExecution[];
  isLoading: boolean;
}

export function ExecutionLog({ executions, isLoading }: ExecutionLogProps) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground gap-2 py-10">
        <SvgActivity className="w-4 h-4 animate-spin text-emerald-400" />
        <span>Загрузка истории запусков...</span>
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-xs text-muted-foreground py-12 px-4 text-center">
        <SvgClock className="w-8 h-8 opacity-30 mb-2" />
        <p>Нет зарегистрированных запусков для этого воркфлоу.</p>
        <p className="text-[11px] opacity-60 mt-1">
          Запустите воркфлоу вручную или отправьте вебхук-триггер из консоли.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2 select-text font-sans">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        История запусков ({executions.length})
      </div>

      {executions.map((exec) => {
        const isSuccess = exec.status === "success";
        const isError = exec.status === "error";
        const isRunning = exec.status === "running";

        return (
          <div
            key={exec.id}
            className={`p-2.5 rounded-lg border transition-all text-xs ${
              isSuccess
                ? "bg-card/40 border-border/30 hover:border-emerald-500/30"
                : isError
                ? "bg-rose-500/5 border-rose-500/20"
                : "bg-amber-500/5 border-amber-500/20"
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                {isSuccess ? (
                  <SvgCheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : isError ? (
                  <SvgAlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                ) : (
                  <SvgClock className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                )}
                <span className="text-foreground font-semibold">#{exec.id}</span>
                <span className="text-muted-foreground">({exec.mode || "trigger"})</span>
              </div>

              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                {exec.durationMs !== undefined && (
                  <span>{exec.durationMs}ms</span>
                )}
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
              <div className="mt-1.5 p-2 rounded bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-400 font-mono break-words leading-relaxed">
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
      })}
    </div>
  );
}
