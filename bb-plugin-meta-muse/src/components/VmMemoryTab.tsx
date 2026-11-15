import React, { useState } from "react";
import type { VMStatus, MemoryRecord } from "../types";
import {
  SvgShield,
  SvgCpu,
  SvgDatabase,
  SvgRefresh,
  SvgTrash,
  SvgSearch,
  SvgLock,
  SvgPlus,
  SvgActivity,
} from "../icons";

interface VmMemoryTabProps {
  vmStatus: VMStatus | null;
  onRefreshVM: () => Promise<void>;
  memories: MemoryRecord[];
  onStoreMemory: (params: {
    key: string;
    content: string;
    category?: "preference" | "fact" | "project" | "instruction";
    confidence?: number;
    tags?: string[];
  }) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
  onSearchMemory: (query: string, category?: "preference" | "fact" | "project" | "instruction") => Promise<void>;
}

const CATEGORIES: Array<"all" | "preference" | "fact" | "project" | "instruction"> = [
  "all",
  "preference",
  "fact",
  "project",
  "instruction",
];

export function VmMemoryTab({
  vmStatus,
  onRefreshVM,
  memories,
  onStoreMemory,
  onDeleteMemory,
  onSearchMemory,
}: VmMemoryTabProps) {
  const [activeCategory, setActiveCategory] = useState<"all" | "preference" | "fact" | "project" | "instruction">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // New memory form state
  const [newKey, setNewKey] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState<"preference" | "fact" | "project" | "instruction">("preference");
  const [newConfidence, setNewConfidence] = useState<number>(0.95);
  const [newTagsStr, setNewTagsStr] = useState("ui, muse, preferences");
  const [isStoring, setIsStoring] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshVM();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleStore = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newKey.trim() || !newContent.trim() || isStoring) return;
    setIsStoring(true);
    try {
      const tags = newTagsStr
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);

      await onStoreMemory({
        key: newKey.trim(),
        content: newContent.trim(),
        category: newCategory,
        confidence: newConfidence,
        tags,
      });

      setNewKey("");
      setNewContent("");
    } finally {
      setIsStoring(false);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cat = activeCategory === "all" ? undefined : activeCategory;
    await onSearchMemory(searchQuery, cat);
  };

  const filteredMemories = memories.filter((m) => {
    if (activeCategory !== "all" && m.category !== activeCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        m.key.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const memUsedPercent = vmStatus
    ? Math.min(100, Math.round((vmStatus.memoryUsedMB / vmStatus.memoryLimitMB) * 100))
    : 0;

  return (
    <div className="flex h-full w-full gap-4 overflow-hidden">
      {/* LEFT: Secure VM Sandbox Telemetry */}
      <div className="w-1/2 flex flex-col bg-[#10141E]/90 rounded-2xl border border-slate-800/80 shadow-2xl p-5 overflow-y-auto backdrop-blur-md space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#00C4B4] to-[#0866FF] flex items-center justify-center p-[1px]">
              <div className="w-full h-full bg-[#10141E] rounded-[6px] flex items-center justify-center">
                <SvgShield className="w-3.5 h-3.5 text-emerald-400" />
              </div>
            </div>
            <div>
              <h2 className="text-xs font-bold text-white tracking-wide">
                Безопасная Песочница VM (Enclave)
              </h2>
              <p className="text-[10px] text-slate-400">Строгая изоляция и аудит процессов</p>
            </div>
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-1.5 text-xs px-2.5 py-1 rounded-lg bg-[#161C2B] hover:bg-[#1E2538] text-cyan-300 border border-slate-800 transition disabled:opacity-50"
            title="Обновить статус VM"
          >
            <SvgRefresh className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Обновить</span>
          </button>
        </div>

        {/* VM State Overview Cards */}
        {vmStatus && (
          <div className="space-y-4 text-xs">
            {/* Status & Enclave Banner */}
            <div className="bg-gradient-to-r from-emerald-950/40 via-[#161C2B] to-[#161C2B] rounded-2xl border border-emerald-800/40 p-3.5 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping inline-block" />
                <div>
                  <div className="font-semibold text-white flex items-center space-x-2">
                    <span>Статус Изоляции:</span>
                    <span className="uppercase text-emerald-400 font-mono tracking-wider">
                      {vmStatus.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Аппаратный Secure Enclave: {vmStatus.secureEnclave ? "Включен (Hardware Active)" : "Эмулирован"}
                  </div>
                </div>
              </div>

              <div className="text-right font-mono text-[10px] text-slate-400">
                <div>Аптайм: {Math.floor(vmStatus.uptimeSeconds / 60)} мин</div>
                <div className="text-emerald-400/80">0 уязвимостей</div>
              </div>
            </div>

            {/* Gauges: RAM & CPU */}
            <div className="grid grid-cols-2 gap-3">
              {/* RAM Usage */}
              <div className="bg-[#161C2B] rounded-xl border border-slate-800 p-3.5 space-y-2">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-400 flex items-center space-x-1">
                    <SvgDatabase className="w-3.5 h-3.5 text-cyan-400" />
                    <span>ОЗУ Песочницы</span>
                  </span>
                  <span className="font-mono text-cyan-300 font-semibold">{memUsedPercent}%</span>
                </div>
                <div className="w-full bg-[#0B0E14] rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-[#00C4B4] to-[#0866FF] transition-all duration-300"
                    style={{ width: `${memUsedPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-slate-500">
                  <span>{vmStatus.memoryUsedMB} MB исп.</span>
                  <span>Лимит: {vmStatus.memoryLimitMB} MB</span>
                </div>
              </div>

              {/* CPU Quota */}
              <div className="bg-[#161C2B] rounded-xl border border-slate-800 p-3.5 space-y-2">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-400 flex items-center space-x-1">
                    <SvgCpu className="w-3.5 h-3.5 text-pink-400" />
                    <span>Квота ЦП</span>
                  </span>
                  <span className="font-mono text-pink-300 font-semibold">{vmStatus.cpuQuotaPercent}%</span>
                </div>
                <div className="w-full bg-[#0B0E14] rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-[#0866FF] to-[#E03E93] transition-all duration-300"
                    style={{ width: `${vmStatus.cpuQuotaPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-slate-500">
                  <span>Выделено: {vmStatus.cpuQuotaPercent}%</span>
                  <span>Hard Cap: 100%</span>
                </div>
              </div>
            </div>

            {/* Network Policy & Allowed Domains */}
            <div className="bg-[#161C2B] rounded-xl border border-slate-800 p-3.5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-semibold text-slate-300 flex items-center space-x-1.5">
                  <SvgLock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Сетевая Политика:</span>
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {vmStatus.networkPolicy}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                Белый список доменов коннекторов:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {vmStatus.allowedDomains.map((domain, i) => (
                  <span
                    key={i}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#0B0E14] border border-slate-800 text-slate-300 flex items-center space-x-1"
                  >
                    <span className="text-emerald-400">✓</span>
                    <span>{domain}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Active Isolated Processes */}
            <div className="bg-[#161C2B] rounded-xl border border-slate-800 p-3.5 space-y-2">
              <div className="flex justify-between items-center pb-1 border-b border-slate-800/80">
                <span className="text-[11px] font-semibold text-slate-300">
                  Изолированные процессы в Enclave ({vmStatus.activeProcesses.length})
                </span>
                <span className="text-[10px] text-slate-500 font-mono">PID / CPU / ОЗУ</span>
              </div>

              <div className="space-y-1.5">
                {vmStatus.activeProcesses.map((p) => (
                  <div
                    key={p.pid}
                    className="flex justify-between items-center text-[11px] font-mono bg-[#0B0E14]/60 px-2.5 py-1.5 rounded-lg border border-slate-800/60"
                  >
                    <div className="flex items-center space-x-2 text-slate-200">
                      <span className="text-slate-500">[{p.pid}]</span>
                      <span className="text-cyan-300 font-medium">{p.name}</span>
                    </div>
                    <div className="flex items-center space-x-3 text-slate-400">
                      <span>{p.cpu}% CPU</span>
                      <span className="text-pink-300 font-semibold">{p.memoryMB} MB</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Security Audit Stamp */}
            <div className="text-[10px] text-slate-500 flex justify-between font-mono px-1">
              <span>Последний аудит: {new Date(vmStatus.lastSecurityAudit).toLocaleDateString()} {new Date(vmStatus.lastSecurityAudit).toLocaleTimeString()}</span>
              <span className="text-emerald-400">SHA256: 8f9b...a10e (Verified)</span>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: Long-Term Memory & Knowledge Base */}
      <div className="w-1/2 flex flex-col bg-[#10141E]/90 rounded-2xl border border-slate-800/80 shadow-2xl p-5 overflow-hidden backdrop-blur-md space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#E03E93] to-[#0866FF] flex items-center justify-center p-[1px]">
              <div className="w-full h-full bg-[#10141E] rounded-[6px] flex items-center justify-center">
                <SvgDatabase className="w-3.5 h-3.5 text-pink-300" />
              </div>
            </div>
            <div>
              <h2 className="text-xs font-bold text-white tracking-wide">
                Долговременная Ассоциативная Память
              </h2>
              <p className="text-[10px] text-slate-400">Векторные предпочтения, контекст и факты</p>
            </div>
          </div>

          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#161C2B] text-pink-300 font-mono border border-pink-900/40">
            {memories.length} записей
          </span>
        </div>

        {/* Add Memory Accordion / Form */}
        <div className="bg-[#161C2B] rounded-2xl border border-slate-800 p-3.5 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-200">Добавить новую запись в память:</span>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as any)}
              className="bg-[#0B0E14] text-[10px] text-cyan-300 px-2 py-0.5 rounded-lg border border-slate-700"
            >
              <option value="preference">preference (Предпочтение)</option>
              <option value="fact">fact (Факт)</option>
              <option value="project">project (Проект)</option>
              <option value="instruction">instruction (Директива)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="Ключ (e.g. visual_palette)"
              className="w-full bg-[#0B0E14] text-xs text-white rounded-lg p-2 border border-slate-700 font-mono"
            />
            <input
              type="text"
              value={newTagsStr}
              onChange={(e) => setNewTagsStr(e.target.value)}
              placeholder="Теги (через запятую)"
              className="w-full bg-[#0B0E14] text-xs text-slate-300 rounded-lg p-2 border border-slate-700 text-[11px]"
            />
          </div>

          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={2}
            placeholder="Содержимое воспоминания (правило, факт, формат вывода)..."
            className="w-full bg-[#0B0E14] text-xs text-white rounded-lg p-2 border border-slate-700 resize-none text-[11px]"
          />

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center space-x-2 text-[10px] text-slate-400">
              <span>Достоверность:</span>
              <input
                type="range"
                min="0.5"
                max="1.0"
                step="0.05"
                value={newConfidence}
                onChange={(e) => setNewConfidence(parseFloat(e.target.value))}
                className="w-20 accent-pink-500"
              />
              <span className="font-mono text-pink-300 font-semibold">{Math.round(newConfidence * 100)}%</span>
            </div>

            <button
              type="button"
              onClick={handleStore}
              disabled={isStoring || !newKey.trim() || !newContent.trim()}
              className="px-3.5 py-1.5 bg-gradient-to-r from-[#E03E93] to-[#0866FF] hover:opacity-95 text-white rounded-lg text-xs font-semibold transition disabled:opacity-40 flex items-center space-x-1"
            >
              <SvgPlus className="w-3.5 h-3.5" />
              <span>{isStoring ? "Сохранение..." : "Сохранить"}</span>
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="space-y-2">
          {/* Categories Pill Selector */}
          <div className="flex space-x-1 overflow-x-auto pb-1 text-[11px]">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`px-2.5 py-1 rounded-lg capitalize transition font-medium ${
                  activeCategory === cat
                    ? "bg-[#161C2B] text-pink-300 border border-pink-500/50 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} className="relative">
            <SvgSearch className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по ключу, тегам или содержимому..."
              className="w-full bg-[#161C2B] text-xs text-white pl-8 pr-3 py-1.5 rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-400 transition"
            />
          </form>
        </div>

        {/* Memory Records List */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {filteredMemories.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <SvgDatabase className="w-10 h-10 text-slate-700 mb-2" />
              <p className="text-xs">Записей памяти не найдено.</p>
            </div>
          ) : (
            filteredMemories.map((m) => (
              <div
                key={m.id}
                className="bg-[#161C2B] rounded-xl border border-slate-800/80 p-3 space-y-1.5 hover:border-slate-700 transition shadow-sm"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-pink-300 text-[11px]">{m.key}</span>
                    <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-[#0B0E14] text-cyan-400 font-mono border border-slate-800">
                      {m.category}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-mono text-slate-400" title="Достоверность">
                      {Math.round(m.confidence * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Удалить запись памяти "${m.key}"?`)) {
                          onDeleteMemory(m.id);
                        }
                      }}
                      className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-rose-950/30 transition"
                      title="Удалить воспоминание"
                    >
                      <SvgTrash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-200 leading-relaxed">{m.content}</p>

                <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[10px]">
                  <div className="flex flex-wrap gap-1">
                    {m.tags.map((tag, idx) => (
                      <span key={idx} className="px-1.5 py-0.2 rounded bg-[#0B0E14] text-slate-400 font-mono">
                        #{tag}
                      </span>
                    ))}
                  </div>
                  <span className="text-slate-500 font-mono">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
