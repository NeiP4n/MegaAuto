import React, { useState, useEffect } from "react";
import { useComposer } from "@get-bb/plugin-sdk/app";
import type { AgentRadarStatus } from "../types";
import {
  SvgActivity,
  SvgCheckCircle,
  SvgClock,
  SvgTerminal,
  SvgEdit,
  SvgBookOpen,
  SvgSparkles,
  SvgChevronDown,
  SvgChevronUp,
} from "../icons";

interface ComposerStatusBannerProps {
  status: AgentRadarStatus | null;
}

export function ComposerStatusBanner({ status }: ComposerStatusBannerProps) {
  const composer = useComposer();
  const [localSeconds, setLocalSeconds] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

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

  if (composer.scope.kind !== "thread") return null;
  if (!status) return null;

  const isBusy = !status.canWrite;

  const getToolIcon = (tool?: string) => {
    if (!tool) return <SvgSparkles className="w-3.5 h-3.5 text-cyan-400" />;
    if (tool.includes("command")) return <SvgTerminal className="w-3.5 h-3.5 text-amber-400" />;
    if (tool.includes("edit") || tool.includes("write")) return <SvgEdit className="w-3.5 h-3.5 text-emerald-400" />;
    if (tool.includes("read")) return <SvgBookOpen className="w-3.5 h-3.5 text-blue-400" />;
    return <SvgActivity className="w-3.5 h-3.5 text-purple-400" />;
  };

  return (
    <div className="w-full border-b border-border/40 bg-muted/20 text-xs select-none transition-colors">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex min-h-7 items-center justify-between px-3 py-1 cursor-pointer hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2 w-2 shrink-0">
            {isBusy ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            )}
          </span>

          <span className={`font-semibold tracking-tight text-[11px] ${isBusy ? "text-amber-400" : "text-emerald-400"}`}>
            {isBusy ? "ИИ занят" : "ИИ свободен"}
          </span>

          {isBusy ? (
            <div className="flex items-center gap-1.5 min-w-0 text-muted-foreground font-mono text-[11px] truncate">
              <span>·</span>
              <span className="shrink-0">{getToolIcon(status.currentTool)}</span>
              <span className="text-foreground font-medium">{status.currentTool || "шаг"}:</span>
              <span className="truncate">{status.toolSummary || "выполнение..."}</span>
            </div>
          ) : (
            <span className="text-muted-foreground text-[11px] truncate">· можно писать сообщение</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isBusy && (
            <>
              <span className="text-[10px] text-muted-foreground/80 font-mono hidden sm:inline">
                сообщение встанет в очередь
              </span>
              <span className="font-mono text-[11px] text-muted-foreground flex items-center gap-1">
                <SvgClock className="w-3 h-3 text-primary/70" />
                <span className="text-foreground font-medium">{localSeconds}s</span>
              </span>
            </>
          )}
          {isExpanded ? (
            <SvgChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <SvgChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="p-3 border-t border-border/30 bg-background/80 space-y-2 text-[11px]">
          <div className="flex items-center justify-between text-muted-foreground font-mono text-[10px]">
            <span>Модель: {status.model}</span>
            <span>Диалог: {status.conversationId.slice(0, 8)}...</span>
          </div>

          <p className="text-foreground font-medium">{status.statusDescription}</p>

          {status.toolCommand && (
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-mono text-muted-foreground">Команда:</span>
              <pre className="p-2 rounded bg-muted/60 font-mono text-[11px] text-foreground overflow-x-auto whitespace-pre-wrap">
                {status.toolCommand}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
