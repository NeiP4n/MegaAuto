import React, { useState, useEffect } from "react";
import { experimental_CollapsibleStackCard as StackCard, useComposer } from "@get-bb/plugin-sdk/app";
import type { AgentRadarStatus } from "../types";

interface ComposerStatusBannerProps {
  status: AgentRadarStatus | null;
}

export function ComposerStatusBanner({ status }: ComposerStatusBannerProps) {
  const composer = useComposer();
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

  if (composer.scope.kind !== "thread") return null;
  if (!status) return null;

  const isBusy = !status.canWrite;

  const toolName = status.currentTool ? status.currentTool.slice(0, 24) : "шаг";
  const cardTitle = isBusy
    ? `ИИ выполняет: ${toolName} (${localSeconds}s) · Сообщение встанет в очередь`
    : "ИИ свободен · Можно писать сообщение";

  const cardIcon = isBusy
    ? status.currentTool?.includes("command")
      ? "Terminal"
      : status.currentTool?.includes("edit") || status.currentTool?.includes("write")
        ? "Edit"
        : "Terminal"
    : "CircleCheck";

  return (
    <div className="w-full">
      <StackCard
        label="Статус ИИ"
        title={cardTitle}
        icon={cardIcon}
        isActive={isBusy}
      >
        <div className="p-3 bg-muted/20 border-t border-border/40 space-y-2 text-xs">
          <div className="flex items-center justify-between text-muted-foreground font-mono text-[11px]">
            <span>Модель: <span className="text-foreground font-medium">{status.model}</span></span>
            <span>Диалог: {status.conversationId.slice(0, 8)}...</span>
          </div>

          <p className="text-foreground font-medium">{status.statusDescription}</p>

          {status.toolSummary && (
            <div className="p-2 rounded bg-muted/60 border border-border/40 font-mono text-[11px] text-foreground">
              <span className="text-muted-foreground mr-1.5">$</span>
              <span>{status.toolSummary}</span>
            </div>
          )}

          {status.toolCommand && status.toolCommand !== status.toolSummary && (
            <pre className="p-2 rounded bg-background border border-border/40 font-mono text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap">
              {status.toolCommand}
            </pre>
          )}

          <div className="flex items-center justify-between pt-1 text-[10px] text-muted-foreground font-mono">
            <span>Шаг #{status.activeStepIndex ?? 0}</span>
            <span>Время шага: {localSeconds}s</span>
          </div>
        </div>
      </StackCard>
    </div>
  );
}
