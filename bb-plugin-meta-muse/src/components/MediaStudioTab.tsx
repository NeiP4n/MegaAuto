import React, { useState } from "react";
import type { MediaJob } from "../types";
import {
  SvgWand,
  SvgImage,
  SvgVideo,
  SvgTrash,
  SvgRefresh,
  SvgSparkles,
  SvgAlertTriangle,
} from "../icons";

interface MediaStudioTabProps {
  mediaJobs: MediaJob[];
  onGenerateMedia: (params: {
    prompt: string;
    negativePrompt?: string;
    type: "image" | "video";
    stylePreset: string;
    aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
    seed?: number;
  }) => Promise<void>;
  onDeleteMediaJob: (jobId: string) => Promise<void>;
  isGenerating: boolean;
  isApiConfigured: boolean;
  onOpenApiModal: () => void;
  lastError?: string | null;
}

const STYLE_PRESETS = [
  { id: "Iridescent Spectrum", name: "Иридисцентный Спектр", desc: "Обсидиан, неоновый циан, пурпур и глянец" },
  { id: "Neon Cyberpunk", name: "Неоновый Киберпанк", desc: "Контрастный ночной свет, дождь, хромированные детали" },
  { id: "Fluid Glassmorphism", name: "Флюидное Матовое Стекло", desc: "Глубокая прозрачность, мягкие градиенты, блюр" },
  { id: "Photorealistic Studio", name: "Фотореалистичная Студия", desc: "8k, студийное освещение, высокая детализация" },
  { id: "Deep Obsidian Noir", name: "Обсидиановый Нуар", desc: "Монохромная глубина с тонкими световыми акцентами" },
  { id: "Bioluminescent Hologram", name: "Биолюминесцентная Голограмма", desc: "Мерцающие фотоны, лазурное и фиолетовое свечение" },
];

const ASPECT_RATIOS: Array<{ id: "1:1" | "16:9" | "9:16" | "4:3" | "3:4"; label: string; desc: string; previewClass: string }> = [
  { id: "16:9", label: "16:9", desc: "Широкий", previewClass: "w-7 h-4" },
  { id: "1:1", label: "1:1", desc: "Квадрат", previewClass: "w-5 h-5" },
  { id: "9:16", label: "9:16", desc: "Stories / Reels", previewClass: "w-4 h-7" },
  { id: "4:3", label: "4:3", desc: "Классик", previewClass: "w-6 h-4.5" },
  { id: "3:4", label: "3:4", desc: "Портрет", previewClass: "w-4.5 h-6" },
];

const PROMPT_SUGGESTIONS = [
  "Futuristic AI muse core in deep obsidian void, floating iridescent chrome rings, fluid cyan light streams, 8k",
  "Cybernetic neural node interface, translucent frosted glass cards, magenta laser grid, cinematic depth of field",
  "Bioluminescent digital butterfly hovering over an iridescent quantum processor, raytracing reflections",
  "Minimalist architectural glass pavilion on obsidian lake at twilight, neon aurora borealis reflections",
];

export function MediaStudioTab({
  mediaJobs,
  onGenerateMedia,
  onDeleteMediaJob,
  isGenerating,
  isApiConfigured,
  onOpenApiModal,
  lastError,
}: MediaStudioTabProps) {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [showNegative, setShowNegative] = useState(false);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [stylePreset, setStylePreset] = useState("Iridescent Spectrum");
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "16:9" | "9:16" | "4:3" | "3:4">("16:9");
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [activePreviewJob, setActivePreviewJob] = useState<MediaJob | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    setLocalError(null);
    try {
      await onGenerateMedia({
        prompt,
        negativePrompt: negativePrompt.trim() ? negativePrompt : undefined,
        type: mediaType,
        stylePreset,
        aspectRatio,
        seed: seed || Math.floor(Math.random() * 1000000),
      });
      setPrompt("");
    } catch (err: any) {
      setLocalError(err?.message || "Ошибка при обращении к API генерации");
    }
  };

  const handleUsePrompt = (job: MediaJob) => {
    setPrompt(job.prompt);
    if (job.negativePrompt) {
      setNegativePrompt(job.negativePrompt);
      setShowNegative(true);
    }
    setMediaType(job.type);
    setStylePreset(job.stylePreset);
    setAspectRatio(job.aspectRatio);
  };

  const displayError = localError || lastError;

  return (
    <div className="flex h-full w-full gap-4 overflow-hidden">
      {/* LEFT: Generation Parameters Studio */}
      <div className="w-96 flex flex-col bg-[#10141E]/90 rounded-2xl border border-slate-800/80 shadow-2xl p-5 overflow-y-auto backdrop-blur-md space-y-4">
        {/* Studio Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#E03E93] to-[#0866FF] flex items-center justify-center p-[1px]">
              <div className="w-full h-full bg-[#10141E] rounded-[6px] flex items-center justify-center">
                <SvgWand className="w-3.5 h-3.5 text-pink-300" />
              </div>
            </div>
            <div>
              <h2 className="text-xs font-bold text-white tracking-wide">Студия Создания Медиа</h2>
              <p className="text-[10px] text-slate-400">Iridescent Studio Engine</p>
            </div>
          </div>

          {/* Type Toggle */}
          <div className="flex bg-[#161C2B] p-0.5 rounded-lg border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setMediaType("image")}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition ${
                mediaType === "image"
                  ? "bg-gradient-to-r from-[#0866FF] to-[#0064E0] text-white shadow-sm font-medium"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <SvgImage className="w-3.5 h-3.5" />
              <span>Фото</span>
            </button>
            <button
              type="button"
              onClick={() => setMediaType("video")}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition ${
                mediaType === "video"
                  ? "bg-gradient-to-r from-[#E03E93] to-[#A855F7] text-white shadow-sm font-medium"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <SvgVideo className="w-3.5 h-3.5" />
              <span>Видео</span>
            </button>
          </div>
        </div>

        {mediaType === "video" && (
          <div className="bg-[#161C2B] rounded-xl border border-sky-900/50 p-2.5 text-xs text-slate-300">
            <span className="text-sky-400 font-medium mr-1.5">ℹ️ Видео:</span>
            <span>Генерация видео временно недоступна в подключенном API (поддерживаются только изображения).</span>
          </div>
        )}

        {/* Warning if API is not configured */}
        {!isApiConfigured && (
          <div className="bg-[#161C2B] rounded-xl border border-amber-900/50 p-3 space-y-1.5 text-xs">
            <div className="flex items-center space-x-2 text-amber-300 font-medium">
              <SvgAlertTriangle className="w-4 h-4 text-amber-400" />
              <span>API не настроен</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Для генерации реальных медиа укажите действующий API ключ или эндпоинт в настройках. Без симуляций и моков.
            </p>
            <button
              type="button"
              onClick={onOpenApiModal}
              className="text-[11px] text-cyan-300 hover:underline pt-0.5"
            >
              Настроить API ключ →
            </button>
          </div>
        )}

        {/* Error notification if any */}
        {displayError && (
          <div className="bg-rose-950/40 rounded-xl border border-rose-800/60 p-3 flex items-start space-x-2.5 text-xs text-rose-200">
            <SvgAlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-rose-300">Ошибка запроса:</span>
              <p className="text-[11px] text-rose-200/90 leading-relaxed">{displayError}</p>
            </div>
          </div>
        )}

        {/* Prompt Input Area */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-[11px]">
            <label className="text-slate-300 font-medium">Промпт:</label>
            <span className="text-slate-500 font-mono text-[10px]">{prompt.length} символов</span>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Опишите желаемую сцену, неоновые переливы, фактуру обсидиана и стиль..."
            className="w-full bg-[#161C2B] text-xs text-white rounded-xl p-3 border border-slate-700/80 focus:outline-none focus:border-pink-500/80 focus:ring-1 focus:ring-pink-500/30 transition resize-none placeholder-slate-500"
          />

          {/* Quick inspiration chips */}
          <div className="pt-1">
            <span className="text-[10px] text-slate-400 block mb-1">Идеи для промпта:</span>
            <div className="flex flex-col gap-1">
              {PROMPT_SUGGESTIONS.slice(0, 2).map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(s)}
                  className="text-left text-[10px] text-slate-400 hover:text-cyan-300 p-1.5 rounded-lg bg-[#161C2B]/50 hover:bg-[#161C2B] border border-slate-800 transition truncate"
                >
                  ✦ {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Negative Prompt toggle */}
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowNegative(!showNegative)}
            className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center space-x-1"
          >
            <span>{showNegative ? "▼" : "▶"} Негативный промпт (исключения)</span>
          </button>
          {showNegative && (
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              placeholder="blurry, low quality, artifacts, watermark, distorted, oversaturated..."
              className="w-full bg-[#161C2B] text-xs text-white rounded-lg p-2.5 border border-slate-700/80 focus:outline-none focus:border-rose-500/80 transition resize-none text-[11px]"
            />
          )}
        </div>

        {/* Style Presets */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-slate-300 font-medium block">Художественный стиль:</label>
          <div className="grid grid-cols-2 gap-2">
            {STYLE_PRESETS.map((p) => {
              const isSelected = stylePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setStylePreset(p.id)}
                  className={`text-left p-2 rounded-xl border text-xs transition ${
                    isSelected
                      ? "bg-gradient-to-br from-[#161C2B] to-[#1E2538] border-[#E03E93]/70 text-white shadow-sm shadow-pink-950/30"
                      : "bg-[#161C2B]/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                  }`}
                >
                  <div className={`font-semibold text-[11px] ${isSelected ? "text-pink-300" : ""}`}>
                    {p.name}
                  </div>
                  <div className="text-[9px] text-slate-500 truncate mt-0.5">{p.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Aspect Ratio Cards */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-slate-300 font-medium block">Пропорции сторон:</label>
          <div className="grid grid-cols-5 gap-1.5">
            {ASPECT_RATIOS.map((ar) => {
              const isSelected = aspectRatio === ar.id;
              return (
                <button
                  key={ar.id}
                  type="button"
                  onClick={() => setAspectRatio(ar.id)}
                  className={`flex flex-col items-center justify-center p-2 rounded-xl border transition ${
                    isSelected
                      ? "bg-[#161C2B] border-cyan-400 text-cyan-300 shadow-sm"
                      : "bg-[#161C2B]/40 border-slate-800 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  <div className={`border border-current rounded-sm ${ar.previewClass} mb-1 flex items-center justify-center`} />
                  <span className="text-[10px] font-mono font-semibold">{ar.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Seed input */}
        <div className="flex items-center justify-between bg-[#161C2B] p-2.5 rounded-xl border border-slate-800 text-xs">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400">Случайный Сид (Seed):</span>
            <span className="text-[11px] text-slate-200 font-mono">{seed || "Auto (случайный)"}</span>
          </div>
          <button
            type="button"
            onClick={() => setSeed(Math.floor(Math.random() * 999999))}
            className="p-1.5 text-slate-400 hover:text-cyan-300 rounded hover:bg-slate-800 transition"
            title="Сгенерировать случайный сид"
          >
            <SvgRefresh className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Submit Generate Button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="w-full py-3 rounded-xl text-xs font-bold tracking-wide bg-gradient-to-r from-[#E03E93] via-[#0866FF] to-[#00C4B4] text-white hover:brightness-110 transition-all shadow-lg shadow-pink-900/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
        >
          <SvgSparkles className="w-4 h-4" />
          <span>{isGenerating ? "Запрос к API генерации..." : "Сгенерировать в Музе"}</span>
        </button>
      </div>

      {/* RIGHT: Jobs Queue & Media Gallery */}
      <div className="flex-1 flex flex-col bg-[#10141E]/90 rounded-2xl border border-slate-800/80 shadow-2xl p-5 overflow-hidden backdrop-blur-md">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
          <div className="flex items-center space-x-2">
            <h3 className="text-xs font-bold text-white tracking-wide">Очередь и Галерея Генераций</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#161C2B] text-slate-400 font-mono border border-slate-800">
              {mediaJobs.length} работ
            </span>
          </div>

          <div className="text-[11px] text-slate-400">
            Движок: <span className="text-cyan-300 font-mono">Meta Muse Creative Real API</span>
          </div>
        </div>

        {/* Gallery Grid */}
        <div className="flex-1 overflow-y-auto pr-1">
          {mediaJobs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
              <SvgImage className="w-12 h-12 text-slate-700" />
              <p className="text-xs font-medium text-slate-400">Галерея пуста (нет сохраненных генераций).</p>
              <p className="text-[11px] text-slate-600 max-w-sm">
                Стартуем с чистого листа. Задайте промпт слева и отправьте реальный запрос к провайдеру для создания первого изображения или видео.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mediaJobs.map((job) => {
                const isCompleted = job.status === "completed";
                const isRendering = job.status === "rendering";
                const isFailed = job.status === "failed";

                return (
                  <div
                    key={job.id}
                    className="group bg-[#161C2B] rounded-2xl border border-slate-800/80 hover:border-slate-700 p-3 space-y-2.5 transition duration-200 shadow-md flex flex-col justify-between"
                  >
                    {/* Media Preview Box */}
                    <div
                      onClick={() => isCompleted && setActivePreviewJob(job)}
                      className="relative w-full aspect-video rounded-xl overflow-hidden bg-black/60 border border-slate-800 flex items-center justify-center cursor-pointer"
                    >
                      {job.resultUrl ? (
                        <img
                          src={job.resultUrl}
                          alt={job.prompt}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="flex flex-col items-center space-y-1 p-3 text-center">
                          {isRendering ? (
                            <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                          ) : isFailed ? (
                            <SvgAlertTriangle className="w-6 h-6 text-rose-400" />
                          ) : (
                            <SvgSparkles className="w-6 h-6 text-slate-600" />
                          )}
                          <span
                            className={`text-[10px] uppercase font-mono ${
                              isFailed ? "text-rose-400" : "text-slate-400"
                            }`}
                          >
                            {job.status}
                          </span>
                        </div>
                      )}

                      {/* Status Overlay Badge */}
                      <div className="absolute top-2 left-2 flex items-center space-x-1 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-sm border border-slate-700 text-[9px] font-mono">
                        <span className="uppercase text-cyan-300">{job.type}</span>
                        <span>•</span>
                        <span
                          className={
                            isCompleted
                              ? "text-emerald-400"
                              : isRendering
                              ? "text-cyan-400 animate-pulse"
                              : isFailed
                              ? "text-rose-400"
                              : "text-amber-400"
                          }
                        >
                          {isCompleted ? "Готово" : isFailed ? "Ошибка" : `${job.progress}%`}
                        </span>
                      </div>
                    </div>

                    {/* Error display if failed */}
                    {job.error && (
                      <div className="text-[10px] p-2 rounded-lg bg-rose-950/40 border border-rose-900/60 text-rose-300">
                        {job.error}
                      </div>
                    )}

                    {/* Progress Bar if Rendering */}
                    {isRendering && (
                      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-[#0866FF] via-[#E03E93] to-[#00C4B4] h-full transition-all duration-300"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    )}

                    {/* Prompt Info */}
                    <div className="space-y-1">
                      <p className="text-xs text-slate-200 line-clamp-2 leading-relaxed" title={job.prompt}>
                        {job.prompt}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                        <span className="truncate max-w-[140px] text-slate-400">{job.stylePreset}</span>
                        <span className="font-mono text-cyan-400">{job.aspectRatio}</span>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => handleUsePrompt(job)}
                        className="text-[10px] text-cyan-300 hover:text-cyan-200 hover:underline flex items-center space-x-1"
                      >
                        <span>Повторить промпт</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteMediaJob(job.id)}
                        className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-rose-950/30 transition"
                        title="Удалить из галереи"
                      >
                        <SvgTrash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {activePreviewJob && (
        <div
          onClick={() => setActivePreviewJob(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-6 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-4xl max-h-[90vh] bg-[#10141E] rounded-2xl border border-slate-700 p-4 shadow-2xl flex flex-col space-y-3 cursor-default"
          >
            {activePreviewJob.resultUrl && (
              <img
                src={activePreviewJob.resultUrl}
                alt={activePreviewJob.prompt}
                className="w-full max-h-[65vh] object-contain rounded-xl border border-slate-800"
              />
            )}
            <div>
              <p className="text-xs text-slate-200">{activePreviewJob.prompt}</p>
              <div className="flex items-center space-x-3 text-[10px] text-slate-400 font-mono mt-1">
                <span>Стиль: {activePreviewJob.stylePreset}</span>
                <span>•</span>
                <span>Формат: {activePreviewJob.aspectRatio}</span>
                {activePreviewJob.seed && <span>• Сид: {activePreviewJob.seed}</span>}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setActivePreviewJob(null)}
                className="px-4 py-1.5 bg-[#161C2B] hover:bg-[#1E2538] text-white text-xs rounded-xl border border-slate-700"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
