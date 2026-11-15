import React, { useState, useEffect } from "react";
import type { AgentRadarStatus } from "../types";
import { SvgActivity, SvgCheckCircle, SvgClock, SvgTerminal, SvgSparkles } from "../icons";

interface RadarSegmentProps {
  status: AgentRadarStatus | null;
  isExpanded?: boolean;
  onToggle?: () => void;
}

export function RadarSegment({ status, isExpanded, onToggle }: RadarSegmentProps) {
  if (!status) return null;

  const isBusy = !status.canWrite;

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <button
        type="button"
        onClick={onToggle}
        className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-2 border transition-all cursor-pointer ${
          isBusy
            ? "bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25"
            : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
        }`}
        title={isBusy ? "ИИ выполняет задачу — не отправляйте сообщение" : "ИИ свободен — можно отправлять сообщение"}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          {isBusy ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </>
          ) : (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </>
          )}
        </span>

        <span className="font-semibold uppercase tracking-wider text-[10px]">
          {isBusy ? "ИИ РАБОТАЕТ (НЕ ПИШИТЕ)" : "ИИ СВОБОДЕН (МОЖНО ПИСАТЬ)"}
        </span>

        {isBusy && status.currentTool && (
          <span className="text-amber-200/90 font-mono text-[10px] max-w-[200px] truncate border-l border-amber-500/30 pl-1.5">
            {status.currentTool}: {status.toolSummary || "шаг"}
          </span>
        )}

        <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-0.5 ml-1">
          <SvgClock className="w-2.5 h-2.5" />
          <span>{status.elapsedSeconds}s</span>
        </span>
      </button>

      {/* Expanded details below the row */}
      {isExpanded && (
        <div className="mt-1 p-2 rounded-lg bg-card/90 border border-border text-xs text-foreground shadow-lg space-y-1 w-full max-w-lg">
          <div className="flex items-center justify-between font-semibold text-muted-foreground text-[10px]">
            <span>Текущий статус диалога</span>
            <span className="font-mono text-cyan-400">{status.model}</span>
          </div>
          <p className="text-xs text-foreground font-medium">{status.statusDescription}</p>
          {status.toolCommand && (
            <div className="p-1.5 rounded bg-muted font-mono text-[11px] text-muted-foreground break-all">
              {status.toolCommand}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
