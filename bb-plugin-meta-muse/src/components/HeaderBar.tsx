import React from "react";
import type { SystemStatus, MuseMode } from "../types";
import { SvgSparkles, SvgShield, SvgCpu, SvgKey } from "../icons";
import type { ApiConfig } from "./ApiConfigModal";

export type TabType = "chat" | "studio" | "tasks" | "vm";

interface HeaderBarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  systemStatus: SystemStatus | null;
  currentMode: MuseMode;
  onModeChange: (mode: MuseMode) => void;
  isModeChanging?: boolean;
  apiConfig: ApiConfig;
  onOpenApiModal: () => void;
}

const MODES: Array<{ mode: MuseMode; label: string; badgeColor: string; description: string }> = [
  {
    mode: "creative",
    label: "Creative",
    badgeColor: "border-[#E03E93]/60 bg-[#E03E93]/15 text-[#F472B6]",
    description: "Генеративное вдохновение, дизайн-концепты и визуализация",
  },
  {
    mode: "analytical",
    label: "Analytical",
    badgeColor: "border-[#0866FF]/60 bg-[#0866FF]/15 text-[#60A5FA]",
    description: "Глубокий анализ кода, архитектуры, логов и данных",
  },
  {
    mode: "proactive",
    label: "Proactive",
    badgeColor: "border-[#00C4B4]/60 bg-[#00C4B4]/15 text-[#2DD4BF]",
    description: "Фоновые подсказки, опережающие задачи и аудит",
  },
  {
    mode: "strict_sandbox",
    label: "Strict Mode",
    badgeColor: "border-amber-500/60 bg-amber-500/15 text-amber-300",
    description: "Строгий локальный режим без исходящих сетевых запросов",
  },
];

export function HeaderBar({
  activeTab,
  onTabChange,
  systemStatus,
  currentMode,
  onModeChange,
  isModeChanging,
  apiConfig,
  onOpenApiModal,
}: HeaderBarProps) {
  const isApiConfigured = Boolean(apiConfig.isConfigured || (apiConfig.apiKey && apiConfig.apiKey.trim().length > 0));

  return (
    <header className="flex flex-col md:flex-row items-center justify-between px-5 py-3 border-b border-slate-800/80 bg-[#10141E]/95 backdrop-blur-md gap-3 z-20">
      {/* Brand & Mode Controls */}
      <div className="flex items-center space-x-3 w-full md:w-auto justify-between md:justify-start">
        <div className="relative group flex items-center space-x-3">
          {/* Iridescent spectrum emblem */}
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#0866FF] via-[#E03E93] to-[#00C4B4] p-[1.5px] shadow-lg shadow-cyan-500/10 transition-transform duration-300 group-hover:scale-105">
            <div className="w-full h-full bg-[#0B0E14] rounded-[10px] flex items-center justify-center">
              <SvgSparkles className="w-4 h-4 text-cyan-300 animate-pulse" />
            </div>
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-sm tracking-wide bg-gradient-to-r from-white via-slate-100 to-cyan-200 bg-clip-text text-transparent">
                Meta Muse AI
              </h1>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border border-slate-700 bg-[#161C2B] text-slate-400">
                v{systemStatus?.version || "0.1.0"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center space-x-1.5 mt-0.5">
              <span>Iridescent Autonomous Companion</span>
            </p>
          </div>
        </div>

        {/* Mode Selector Pill Group */}
        <div className="hidden lg:flex items-center space-x-1 bg-[#161C2B]/80 p-1 rounded-xl border border-slate-800">
          {MODES.map((m) => (
            <button
              key={m.mode}
              onClick={() => onModeChange(m.mode)}
              disabled={isModeChanging}
              title={m.description}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                currentMode === m.mode
                  ? `${m.badgeColor} shadow-sm font-semibold`
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Tab Navigation */}
      <nav className="flex space-x-1 p-1 bg-[#161C2B] rounded-xl border border-slate-800/90 text-xs shadow-inner shadow-black/40">
        <button
          onClick={() => onTabChange("chat")}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg font-medium transition-all duration-200 ${
            activeTab === "chat"
              ? "bg-gradient-to-r from-[#0866FF]/25 via-[#E03E93]/20 to-[#00C4B4]/20 text-white border border-[#E03E93]/40 shadow-md shadow-pink-900/20"
              : "text-slate-400 hover:text-slate-200 hover:bg-[#1C2436]"
          }`}
        >
          <span className="text-[#00C4B4]">✦</span>
          <span>Чат и Муза</span>
        </button>

        <button
          onClick={() => onTabChange("studio")}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg font-medium transition-all duration-200 ${
            activeTab === "studio"
              ? "bg-gradient-to-r from-[#E03E93]/25 via-[#0866FF]/20 to-[#00C4B4]/20 text-white border border-[#E03E93]/40 shadow-md shadow-pink-900/20"
              : "text-slate-400 hover:text-slate-200 hover:bg-[#1C2436]"
          }`}
        >
          <span className="text-[#E03E93]">✧</span>
          <span>Студия Генерации</span>
        </button>

        <button
          onClick={() => onTabChange("tasks")}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg font-medium transition-all duration-200 ${
            activeTab === "tasks"
              ? "bg-gradient-to-r from-[#00C4B4]/25 via-[#0866FF]/20 to-[#E03E93]/20 text-white border border-[#00C4B4]/40 shadow-md shadow-cyan-900/20"
              : "text-slate-400 hover:text-slate-200 hover:bg-[#1C2436]"
          }`}
        >
          <span className="text-[#0866FF]">⚡</span>
          <span>Проактивные Задачи</span>
          {systemStatus && systemStatus.proactiveTasksCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full bg-cyan-950 text-cyan-300 text-[10px] font-mono border border-cyan-800/60">
              {systemStatus.proactiveTasksCount}
            </span>
          )}
        </button>

        <button
          onClick={() => onTabChange("vm")}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg font-medium transition-all duration-200 ${
            activeTab === "vm"
              ? "bg-gradient-to-r from-[#0866FF]/25 via-[#00C4B4]/20 to-[#E03E93]/20 text-white border border-[#0866FF]/40 shadow-md shadow-blue-900/20"
              : "text-slate-400 hover:text-slate-200 hover:bg-[#1C2436]"
          }`}
        >
          <span className="text-emerald-400">🛡️</span>
          <span>Процесс & Память</span>
        </button>
      </nav>

      {/* API Key Config & Host Status */}
      <div className="flex items-center space-x-2.5 text-[11px] font-mono">
        {/* Honest API Status Button */}
        <button
          onClick={onOpenApiModal}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border transition shadow-sm ${
            isApiConfigured
              ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300 hover:border-emerald-400"
              : "border-amber-500/50 bg-amber-950/40 text-amber-300 hover:border-amber-400 animate-pulse"
          }`}
          title="Настройка API эндпоинта и ключа"
        >
          <SvgKey className="w-3.5 h-3.5" />
          <span>{isApiConfigured ? "API: Подключен" : "API: Не настроен ⚠️"}</span>
        </button>

        {/* Honest Host Process / VM Badge */}
        <div className="hidden xl:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-[#161C2B] border border-slate-800 text-slate-300">
          <SvgShield className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-cyan-300 font-semibold uppercase">
            {systemStatus?.vmStatus || "host_process"}
          </span>
        </div>

        {systemStatus?.hardware && (
          <div className="hidden 2xl:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-[#161C2B] border border-slate-800 text-slate-400">
            <SvgCpu className="w-3.5 h-3.5 text-pink-400" />
            <span>RAM: {Math.round((systemStatus.hardware.totalMemoryMB - systemStatus.hardware.freeMemoryMB) / 1024 * 10) / 10} / {Math.round(systemStatus.hardware.totalMemoryMB / 1024 * 10) / 10} GB</span>
          </div>
        )}
      </div>
    </header>
  );
}
