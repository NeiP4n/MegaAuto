import React, { useState } from "react";
import type { AgentRadarStatus, AgentStep } from "../types";
import {
  SvgActivity,
  SvgCheckCircle,
  SvgAlertTriangle,
  SvgClock,
  SvgTerminal,
  SvgEdit,
  SvgBookOpen,
  SvgVolume2,
  SvgVolumeX,
  SvgSparkles,
  SvgBot,
  SvgRefresh,
  SvgCheck,
  SvgZap,
  SvgMessageCircle,
} from "../icons";
import { playReadyChime } from "./SoundEffect";

interface RadarNavPanelProps {
  status: AgentRadarStatus | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export function RadarNavPanel({ status, isLoading, onRefresh }: RadarNavPanelProps) {
  const [filter, setFilter] = useState<"all" | "tools" | "model">("all");
  const [soundEnabled, setSoundEnabled] = useState(true);

  if (!status) {
    return (
      <div className="flex-1 flex items-center justify-center h-full p-6 text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <SvgActivity className="w-8 h-8 text-primary animate-pulse" />
          <p className="text-sm">Загрузка данных радара активности ИИ...</p>
        </div>
      </div>
    );
  }

  const isBusy = !status.canWrite;

  const filteredSteps = status.recentSteps.filter((s) => {
    if (filter === "tools") return !!s.toolName;
    if (filter === "model") return s.type === "PLANNER_RESPONSE";
    return true;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden p-6 space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <SvgActivity className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <span>Agent Radar</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono">
                v0.1.0
              </span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Индикатор занятости и живой мониторинг шагов ассистента в реальном времени
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              playReadyChime(0.4);
            }}
            className="px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-accent text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <SvgVolume2 className="w-3.5 h-3.5 text-primary" />
            <span>Тест звука</span>
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-accent text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <SvgRefresh className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-primary" : "text-muted-foreground"}`} />
            <span>Обновить</span>
          </button>
        </div>
      </div>

      {/* Hero Status Banner */}
      <div
        className={`p-6 rounded-2xl border backdrop-blur shadow-sm transition-all ${
          isBusy
            ? "bg-muted/40 border-border ring-1 ring-border"
            : "bg-card border-border"
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="relative mt-1 shrink-0">
              {isBusy ? (
                <>
                  <span className="animate-ping absolute inline-flex h-6 w-6 rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-6 w-6 bg-primary text-primary-foreground flex items-center justify-center">
                    <SvgClock className="w-3.5 h-3.5" />
                  </span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-6 w-6 bg-muted text-muted-foreground flex items-center justify-center border border-border">
                  <SvgCheck className="w-3.5 h-3.5" />
                </span>
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-2 text-lg font-bold tracking-wide uppercase ${
                    isBusy ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {isBusy ? (
                    <>
                      <SvgAlertTriangle className="w-5 h-5 text-primary" />
                      <span>ИИ ЗАНЯТ — ПОДОЖДИТЕ (НЕ ПИШИТЕ)</span>
                    </>
                  ) : (
                    <>
                      <SvgCheckCircle className="w-5 h-5 text-muted-foreground" />
                      <span>ИИ СВОБОДЕН — МОЖНО ПИСАТЬ</span>
                    </>
                  )}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-background/60 font-mono text-muted-foreground border border-border">
                  шаг #{status.activeStepIndex ?? 0}
                </span>
              </div>
              <p className="text-sm text-foreground font-medium">{status.statusDescription}</p>
              {status.toolSummary && (
                <p className="text-xs font-mono text-foreground bg-muted px-2.5 py-1 rounded-md border border-border mt-1 inline-flex items-center gap-1.5">
                  <SvgZap className="w-3.5 h-3.5 text-primary" />
                  <span>{status.currentTool}: {status.toolSummary}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex md:flex-col items-center md:items-end justify-between gap-1 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border/40">
            <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
              <SvgClock className="w-3.5 h-3.5 text-primary" />
              <span>Таймер шага:</span>
              <span className="font-bold text-foreground text-sm">{status.elapsedSeconds}s</span>
            </div>
            <div className="text-[11px] font-mono text-muted-foreground">
              Модель: <span className="text-foreground font-medium">{status.model}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live Activity Stream */}
      <div className="flex-1 flex flex-col min-h-0 bg-card rounded-xl border border-border overflow-hidden">
        {/* Stream Header & Filters */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-card/60">
          <div className="flex items-center gap-2">
            <SvgBot className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-foreground">Поток недавних операций ассистента</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-muted font-mono text-muted-foreground">
              {filteredSteps.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Все
            </button>
            <button
              type="button"
              onClick={() => setFilter("tools")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filter === "tools" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Инструменты
            </button>
            <button
              type="button"
              onClick={() => setFilter("model")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filter === "model" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Ответы модели
            </button>
          </div>
        </div>

        {/* Steps List */}
        <div className="flex-1 overflow-y-auto divide-y divide-border p-2">
          {filteredSteps.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              Нет записей для отображения
            </div>
          ) : (
            filteredSteps.map((step) => (
              <div key={step.stepIndex} className="p-3 hover:bg-muted/40 transition-colors rounded-lg space-y-1">
                <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-semibold">#{step.stepIndex}</span>
                    <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase font-bold text-foreground">
                      {step.toolName || step.type}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{step.status}</span>
                  </div>
                  <span className="text-[10px]">{step.createdAt.split("T")[1]?.slice(0, 8)}</span>
                </div>

                {step.toolSummary && (
                  <p className="text-xs font-mono text-foreground font-medium pl-6">{step.toolSummary}</p>
                )}
                {step.toolCommand && step.toolCommand !== step.toolSummary && (
                  <pre className="text-[11px] font-mono text-muted-foreground bg-muted/60 p-2 rounded ml-6 overflow-x-auto">
                    {step.toolCommand}
                  </pre>
                )}
                {step.thinkingPreview && (
                  <p className="text-[11px] text-muted-foreground/80 italic pl-6 truncate flex items-center gap-1.5">
                    <SvgMessageCircle className="w-3 h-3 shrink-0" />
                    <span className="truncate">{step.thinkingPreview}</span>
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
