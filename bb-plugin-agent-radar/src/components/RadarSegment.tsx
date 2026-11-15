import React, { useState, useEffect } from "react";
import type { AgentRadarStatus } from "../types";
import { SvgActivity, SvgCheckCircle, SvgClock, SvgTerminal, SvgSparkles, SvgChevronDown, SvgChevronUp } from "../icons";

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

  const isBusy = status ? !status.canWrite : false;

  return (
    <div className="w-full py-1">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between border transition-all cursor-pointer shadow-sm ${
          isBusy
            ? "bg-amber-500/15 border-amber-500/50 text-amber-300 hover:bg-amber-500/25 ring-1 ring-amber-500/20"
            : "bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/25 ring-1 ring-emerald-500/20"
        }`}
        title={
          isBusy
            ? "ИИ выполняет системную команду — пожалуйста, подождите завершения шага"
            : "ИИ свободен — можно отправлять следующее сообщение"
        }
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {isBusy ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-80"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </>
            ) : (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </>
            )}
          </span>

          <span className="font-bold uppercase tracking-wider text-[11px] shrink-0">
            {isBusy ? "⏳ ИИ ВЫПОЛНЯЕТ ЗАДАЧУ (НЕ ПИШИТЕ)" : "🟢 ИИ СВОБОДЕН (МОЖНО ПИСАТЬ)"}
          </span>

          {isBusy && status?.currentTool && (
            <span className="text-amber-200 font-mono text-[11px] truncate border-l border-amber-500/30 pl-2">
              {status.currentTool}: {status.toolSummary || "шаг"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1 bg-background/50 px-2 py-0.5 rounded border border-border">
            <SvgClock className="w-3 h-3 text-primary" />
            <span className="font-bold text-foreground">{localSeconds}s</span>
          </span>
          {isExpanded ? <SvgChevronUp className="w-3.5 h-3.5" /> : <SvgChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {/* Expanded details below the row */}
      {isExpanded && status && (
        <div className="mt-1.5 p-3 rounded-xl bg-card border border-border text-xs text-foreground shadow-xl space-y-2">
          <div className="flex items-center justify-between font-semibold text-muted-foreground text-[10px]">
            <span>Детали текущей операции ассистента</span>
            <span className="font-mono text-cyan-400">{status.model}</span>
          </div>

          <p className="text-xs text-foreground font-medium">{status.statusDescription}</p>

          {status.toolCommand && (
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-mono text-muted-foreground">Команда в терминале:</span>
              <pre className="p-2 rounded bg-muted/80 font-mono text-[11px] text-foreground overflow-x-auto whitespace-pre-wrap">
                {status.toolCommand}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
