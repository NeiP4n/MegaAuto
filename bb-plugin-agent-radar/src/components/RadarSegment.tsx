import React, { useState, useEffect } from "react";
import type { AgentRadarStatus } from "../types";
import { SvgActivity, SvgCheckCircle, SvgClock, SvgTerminal } from "../icons";

interface RadarSegmentProps {
  status: AgentRadarStatus | null;
  isExpanded?: boolean;
  onToggle?: () => void;
}

export function RadarSegment({ status, isExpanded, onToggle }: RadarSegmentProps) {
  const [localSeconds, setLocalSeconds] = useState(0);

  useEffect(() => {
    if (status) {
      setLocalSeconds(status.elapsedSeconds);
    }
  }, [status?.elapsedSeconds]);

  useEffect(() => {
    const timer = setInterval(() => {
      setLocalSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!status) return null;

  const isBusy = !status.canWrite;

  return (
    <div className="w-full py-0.5">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full px-2.5 py-1 rounded-md text-xs font-medium flex items-center justify-between border transition-all cursor-pointer ${
          isBusy
            ? "bg-muted border-border text-foreground ring-1 ring-border"
            : "bg-card border-border text-muted-foreground hover:text-foreground"
        }`}
        title={
          isBusy
            ? "ИИ выполняет системную команду — сообщение встанет в очередь"
            : "ИИ свободен — можно отправлять следующее сообщение"
        }
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2 w-2 shrink-0">
            {isBusy ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-2 w-2 bg-muted-foreground/60"></span>
            )}
          </span>

          <span className="font-semibold uppercase tracking-wider text-[10px] shrink-0">
            {isBusy ? "ИИ выполняет задачу" : "ИИ свободен"}
          </span>

          {isBusy && status.currentTool && (
            <span className="text-muted-foreground font-mono text-[11px] truncate border-l border-border pl-2">
              {status.currentTool}: {status.toolSummary || "шаг"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
            <SvgClock className="w-3 h-3 text-muted-foreground" />
            <span className="font-medium text-foreground">{localSeconds}s</span>
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-1.5 p-2.5 rounded-lg bg-card border border-border text-xs text-foreground shadow-sm space-y-1.5">
          <div className="flex items-center justify-between text-muted-foreground font-mono text-[10px]">
            <span>Модель: {status.model}</span>
            <span>Диалог: {status.conversationId.slice(0, 8)}...</span>
          </div>
          <p className="text-foreground font-medium">{status.statusDescription}</p>
          {status.toolCommand && (
            <pre className="p-1.5 rounded bg-muted font-mono text-[10px] text-foreground overflow-x-auto whitespace-pre-wrap">
              {status.toolCommand}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
