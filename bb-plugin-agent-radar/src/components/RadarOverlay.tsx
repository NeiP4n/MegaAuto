import React, { useState, useEffect, useRef } from "react";
import type { AgentRadarStatus } from "../types";
import {
  SvgActivity,
  SvgCheckCircle,
  SvgClock,
  SvgTerminal,
  SvgEdit,
  SvgBookOpen,
  SvgVolume2,
  SvgVolumeX,
  SvgChevronDown,
  SvgChevronUp,
  SvgSparkles,
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
  const [localSeconds, setLocalSeconds] = useState(0);
  const prevCanWrite = useRef<boolean | null>(null);

  // Smooth 1s timer tick
  useEffect(() => {
    if (status) {
      setLocalSeconds(status.elapsedSeconds);
    }
  }, [status?.elapsedSeconds]);

  useEffect(() => {
    const timer = setInterval(() => {
      setLocalSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Sound alert on state transition: BUSY -> READY
  useEffect(() => {
    if (!status) return;
    if (prevCanWrite.current === false && status.canWrite === true && soundEnabled) {
      playReadyChime(0.4);
    }
    prevCanWrite.current = status.canWrite;
  }, [status, soundEnabled]);

  const isBusy = status ? !status.canWrite : false;

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
    <div className="fixed top-3 right-4 z-50 pointer-events-auto transition-all duration-300 font-sans">
      <div
        className={`rounded-xl border backdrop-blur-md shadow-2xl transition-all duration-300 overflow-hidden ${
          isBusy
            ? "bg-slate-950/95 border-amber-500/60 ring-2 ring-amber-500/30 shadow-amber-500/10"
            : "bg-slate-950/95 border-emerald-500/60 ring-2 ring-emerald-500/30 shadow-emerald-500/10"
        } ${isExpanded ? "w-96" : "w-84"}`}
      >
        {/* Main Header / Pill Banner */}
        <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
          {/* Status Badge + Pulse Indicator */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative flex items-center justify-center shrink-0">
              {isBusy ? (
                <>
                  <span className="animate-ping absolute inline-flex h-3.5 w-3.5 rounded-full bg-amber-400 opacity-80"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500 shadow-sm"></span>
                </>
              ) : (
                <>
                  <span className="animate-ping absolute inline-flex h-3.5 w-3.5 rounded-full bg-emerald-400 opacity-60"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-sm"></span>
                </>
              )}
            </div>

            <div className="flex flex-col min-w-0">
              <span
                className={`text-[11px] font-black tracking-wider uppercase flex items-center gap-1.5 ${
                  isBusy ? "text-amber-400" : "text-emerald-400"
                }`}
              >
                {isBusy ? (
                  <>
                    <span className="text-amber-400">⏳</span>
                    <span>ИИ РАБОТАЕТ · НЕ ПИШИТЕ</span>
                  </>
                ) : (
                  <>
                    <span className="text-emerald-400">🟢</span>
                    <span>ИИ СВОБОДЕН · МОЖНО ПИСАТЬ</span>
                  </>
                )}
              </span>

              <span className="text-[11px] text-slate-200 truncate font-medium">
                {status
                  ? isBusy
                    ? status.currentTool
                      ? `Действие: ${status.currentTool}`
                      : "Выполняет операцию..."
                    : "Ожидает вашего сообщения"
                  : "Подключение к радару..."}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Stopwatch */}
            <div className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-[11px] font-mono font-bold text-slate-200 flex items-center gap-1">
              <SvgClock className="w-3 h-3 text-cyan-400" />
              <span>{formatSeconds(localSeconds)}</span>
            </div>

            {/* Sound toggle */}
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? "Звуковой сигнал включен (перезвон при готовности)" : "Звук выключен"}
              className={`p-1.5 rounded-md hover:bg-slate-800 transition-colors ${
                soundEnabled ? "text-cyan-400" : "text-slate-500"
              }`}
            >
              {soundEnabled ? <SvgVolume2 className="w-3.5 h-3.5" /> : <SvgVolumeX className="w-3.5 h-3.5" />}
            </button>

            {/* Expand / Details */}
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Свернуть подробности" : "Показать что делает ИИ"}
              className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              {isExpanded ? <SvgChevronUp className="w-3.5 h-3.5" /> : <SvgChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Current Active Tool Snippet */}
        {isBusy && status?.toolSummary && (
          <div className="px-3.5 pb-2.5 pt-1 border-t border-slate-800/80 bg-slate-900/60 flex items-start gap-2">
            <div className="mt-0.5 shrink-0">{getToolIcon(status.currentTool)}</div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-amber-300 font-mono font-semibold truncate">{status.toolSummary}</p>
              {status.toolCommand && status.toolCommand !== status.toolSummary && (
                <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5 bg-black/40 px-1.5 py-0.5 rounded">
                  {status.toolCommand}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Expanded Drawer: Recent Actions & Steps History */}
        {isExpanded && status && (
          <div className="border-t border-slate-800 bg-slate-900/90 p-3 max-h-80 overflow-y-auto space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300 mb-1">
              <span className="flex items-center gap-1.5">
                <SvgActivity className="w-3.5 h-3.5 text-cyan-400" />
                <span>Живой журнал шагов ИИ</span>
              </span>
              <button
                type="button"
                onClick={onRefresh}
                className="hover:text-cyan-400 text-slate-400 flex items-center gap-1 text-[10px] transition-colors"
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
                  className="p-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5 font-mono">
                    <span className="flex items-center gap-1.5">
                      {getToolIcon(step.toolName)}
                      <span className="font-bold text-slate-200">{step.toolName || step.type}</span>
                    </span>
                    <span className="text-slate-500">#{step.stepIndex}</span>
                  </div>

                  {step.toolSummary && (
                    <p className="text-[11px] text-slate-300 font-mono truncate">{step.toolSummary}</p>
                  )}
                  {step.toolCommand && step.toolCommand !== step.toolSummary && (
                    <pre className="text-[10px] text-slate-400 font-mono bg-black/40 p-1 rounded mt-1 truncate">
                      {step.toolCommand}
                    </pre>
                  )}
                </div>
              ))
            )}

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>Модель: <span className="text-cyan-400">{status.model}</span></span>
              <span>Диалог: {status.conversationId.slice(0, 8)}...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
