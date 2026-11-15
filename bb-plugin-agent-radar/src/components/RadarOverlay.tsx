import React, { useState, useEffect, useRef, useCallback } from "react";
import type { AgentRadarStatus } from "../types";
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
  SvgChevronDown,
  SvgChevronUp,
  SvgSparkles,
  SvgBot,
  SvgRefresh,
} from "../icons";
import { playReadyChime } from "./SoundEffect";

interface RadarOverlayProps {
  status: AgentRadarStatus | null;
  onRefresh: () => void;
}

export function RadarOverlay({ status, onRefresh }: RadarOverlayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);
  const prevCanWrite = useRef<boolean | null>(null);

  // Sound alert on state transition: BUSY -> READY
  useEffect(() => {
    if (!status) return;

    if (prevCanWrite.current === false && status.canWrite === true && soundEnabled) {
      playReadyChime(0.35);
    }
    prevCanWrite.current = status.canWrite;
  }, [status, soundEnabled]);

  if (!status || isDismissed) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          type="button"
          onClick={() => setIsDismissed(false)}
          className="px-3 py-1.5 rounded-full bg-card/90 backdrop-blur border border-border shadow-md hover:bg-accent text-xs flex items-center gap-1.5 font-medium transition-all"
        >
          <SvgActivity className="w-3.5 h-3.5 text-primary" />
          <span>Радар ИИ</span>
        </button>
      </div>
    );
  }

  const isBusy = !status.canWrite;

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m > 0 ? `${m}m ` : ""}${s}s`;
  };

  const getToolIcon = (tool?: string) => {
    if (!tool) return <SvgSparkles className="w-3.5 h-3.5 text-cyan-400" />;
    if (tool.includes("command")) return <SvgTerminal className="w-3.5 h-3.5 text-amber-400" />;
    if (tool.includes("edit") || tool.includes("write")) return <SvgEdit className="w-3.5 h-3.5 text-emerald-400" />;
    if (tool.includes("read")) return <SvgBookOpen className="w-3.5 h-3.5 text-blue-400" />;
    return <SvgActivity className="w-3.5 h-3.5 text-purple-400" />;
  };

  return (
    <div className="fixed top-14 right-4 z-50 pointer-events-auto transition-all duration-300">
      <div
        className={`rounded-xl border backdrop-blur-md shadow-2xl transition-all duration-300 overflow-hidden ${
          isBusy
            ? "bg-slate-950/95 border-amber-500/40 ring-1 ring-amber-500/20"
            : "bg-slate-950/90 border-emerald-500/40 ring-1 ring-emerald-500/20"
        } ${isExpanded ? "w-96" : "w-80"}`}
      >
        {/* Main Header / Pill Banner */}
        <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
          {/* Status Badge + Pulse Indicator */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative flex items-center justify-center shrink-0">
              {isBusy ? (
                <>
                  <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                </>
              ) : (
                <>
                  <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-emerald-400 opacity-50"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </>
              )}
            </div>

            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-xs font-bold tracking-wide uppercase ${
                    isBusy ? "text-amber-400" : "text-emerald-400"
                  }`}
                >
                  {isBusy ? "ИИ РАБОТАЕТ · НЕ ПИШИТЕ" : "ИИ СВОБОДЕН · МОЖНО ПИСАТЬ"}
                </span>
              </div>
              <span className="text-[11px] text-slate-300 truncate font-medium">
                {isBusy
                  ? status.currentTool
                    ? `Шаг: ${status.currentTool}`
                    : "Генерация ответа..."
                  : "Ожидает вашего сообщения"}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Stopwatch */}
            <div className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700/60 text-[10px] font-mono text-slate-300 flex items-center gap-1">
              <SvgClock className="w-2.5 h-2.5 text-slate-400" />
              <span>{formatSeconds(status.elapsedSeconds)}</span>
            </div>

            {/* Sound toggle */}
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? "Звуковой сигнал включен" : "Звуковой сигнал выключен"}
              className={`p-1 rounded hover:bg-slate-800 transition-colors ${
                soundEnabled ? "text-cyan-400" : "text-slate-500"
              }`}
            >
              {soundEnabled ? <SvgVolume2 className="w-3.5 h-3.5" /> : <SvgVolumeX className="w-3.5 h-3.5" />}
            </button>

            {/* Expand / Details */}
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Свернуть" : "Подробности активности"}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              {isExpanded ? <SvgChevronUp className="w-3.5 h-3.5" /> : <SvgChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Current Active Tool Snippet */}
        {isBusy && status.toolSummary && (
          <div className="px-3.5 pb-2.5 pt-0.5 border-t border-slate-800/80 bg-slate-900/40 flex items-start gap-2">
            <div className="mt-0.5 shrink-0">{getToolIcon(status.currentTool)}</div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-amber-200/90 font-mono truncate">{status.toolSummary}</p>
              {status.toolCommand && status.toolCommand !== status.toolSummary && (
                <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">{status.toolCommand}</p>
              )}
            </div>
          </div>
        )}

        {/* Expanded Drawer: Recent Actions & Steps History */}
        {isExpanded && (
          <div className="border-t border-slate-800 bg-slate-900/70 p-3 max-h-72 overflow-y-auto space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-1">
              <span>Хронология шагов агента</span>
              <button
                type="button"
                onClick={onRefresh}
                className="hover:text-slate-200 flex items-center gap-1 text-[10px]"
              >
                <SvgRefresh className="w-3 h-3" />
                <span>Обновить</span>
              </button>
            </div>

            {status.recentSteps.length === 0 ? (
              <p className="text-[11px] text-slate-500 text-center py-2">Шагов пока нет</p>
            ) : (
              status.recentSteps.map((step) => (
                <div
                  key={step.stepIndex}
                  className="p-2 rounded bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition-colors"
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5 font-mono">
                    <span className="flex items-center gap-1">
                      {getToolIcon(step.toolName)}
                      <span className="font-semibold text-slate-200">{step.toolName || step.type}</span>
                    </span>
                    <span>#{step.stepIndex}</span>
                  </div>

                  {step.toolSummary && (
                    <p className="text-[11px] text-slate-300 font-mono truncate">{step.toolSummary}</p>
                  )}
                  {step.thinkingPreview && !step.toolSummary && (
                    <p className="text-[10px] text-slate-400 italic truncate">{step.thinkingPreview}</p>
                  )}
                  {step.contentPreview && !step.toolSummary && !step.thinkingPreview && (
                    <p className="text-[10px] text-slate-400 truncate">{step.contentPreview}</p>
                  )}
                </div>
              ))
            )}

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>Модель: {status.model}</span>
              <button
                type="button"
                onClick={() => setIsDismissed(true)}
                className="text-slate-400 hover:text-slate-200 underline"
              >
                Скрыть радар
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
