import React, { useState } from "react";
import { SvgKey, SvgCheck, SvgAlertTriangle } from "../icons";

export interface ApiConfig {
  apiKey?: string;
  endpointUrl?: string;
  mediaEndpointUrl?: string;
  modelName?: string;
  isConfigured?: boolean;
}

interface ApiConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ApiConfig;
  onSave: (config: {
    apiKey?: string;
    clearApiKey?: boolean;
    endpointUrl?: string;
    mediaEndpointUrl?: string;
    modelName?: string;
  }) => Promise<void>;
}

export function ApiConfigModal({
  isOpen,
  onClose,
  config,
  onSave,
}: ApiConfigModalProps) {
  const [apiKey, setApiKey] = useState(config.apiKey || "");
  const [endpointUrl, setEndpointUrl] = useState(config.endpointUrl || "");
  const [mediaEndpointUrl, setMediaEndpointUrl] = useState(config.mediaEndpointUrl || "");
  const [showKey, setShowKey] = useState(false);
  const [clearRequested, setClearRequested] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setApiKey(config.apiKey || "");
      setEndpointUrl(config.endpointUrl || "");
      setMediaEndpointUrl(config.mediaEndpointUrl || "");
      setShowKey(false);
      setClearRequested(false);
      setErrorMessage(null);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const trimmedKey = apiKey.trim();
      // Protect genuine key from accidental empty overwrite or masked bullets (••••••••)
      let keyPayload: string | undefined = undefined;
      if (!clearRequested && trimmedKey && !trimmedKey.includes("•")) {
        keyPayload = trimmedKey;
      }

      await onSave({
        apiKey: keyPayload,
        clearApiKey: clearRequested,
        endpointUrl: endpointUrl.trim() || undefined,
        mediaEndpointUrl: mediaEndpointUrl.trim() || undefined,
      });
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 600);
    } catch (err: any) {
      setSavedSuccess(false);
      setErrorMessage(err?.message || "Ошибка: не удалось сохранить конфигурацию на диск.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#10141E] rounded-2xl border border-slate-700/80 shadow-2xl p-6 cursor-default space-y-4"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#0866FF] to-[#E03E93] p-[1px] flex items-center justify-center">
              <div className="w-full h-full bg-[#10141E] rounded-[10px] flex items-center justify-center">
                <SvgKey className="w-4 h-4 text-cyan-300" />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">
                Настройки Meta Muse API
              </h3>
              <p className="text-[11px] text-slate-400">
                Конфигурация реального провайдера для диалогов и генераций
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded-lg hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-[#161C2B] rounded-xl border border-amber-900/40 p-3 flex items-start space-x-2.5 text-xs text-amber-200/90">
          <SvgAlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed">
            Meta Muse работает без симуляций. При отсутствии настроенного ключа все запросы к модели честно возвращают ошибку конфигурации.
          </p>
        </div>

        {/* Error Banner if saving failed */}
        {errorMessage && (
          <div className="bg-rose-950/50 rounded-xl border border-rose-500/80 p-3 flex items-start space-x-2.5 text-xs text-rose-200">
            <SvgAlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed font-mono">{errorMessage}</p>
          </div>
        )}

        {/* Settings Form */}
        <form onSubmit={handleSave} className="space-y-3.5 text-xs">
          <div>
            <label className="text-[11px] text-slate-300 font-medium block mb-1">
              Chat Endpoint URL (OpenAI-совместимый или Muse Gateway):
            </label>
            <input
              type="text"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full bg-[#161C2B] text-xs text-slate-100 rounded-xl p-2.5 border border-slate-700/80 focus:outline-none focus:border-cyan-400 font-mono"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] text-slate-300 font-medium">
                API Ключ (Bearer Token):
              </label>
              <div className="flex items-center space-x-2">
                {config.isConfigured && !clearRequested && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearRequested(true);
                      setApiKey("");
                    }}
                    className="text-[10px] text-rose-400 hover:text-rose-300 hover:underline"
                  >
                    Очистить ключ
                  </button>
                )}
                {clearRequested && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearRequested(false);
                      setApiKey(config.apiKey || "");
                    }}
                    className="text-[10px] text-slate-400 hover:text-slate-300"
                  >
                    Отменить очистку
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="text-[10px] text-slate-400 hover:text-cyan-300"
                >
                  {showKey ? "Скрыть" : "Показать"}
                </button>
              </div>
            </div>
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (clearRequested) setClearRequested(false);
              }}
              placeholder={config.isConfigured ? "•••••••• (сохранён в памяти)" : "sk-..."}
              className="w-full bg-[#161C2B] text-xs text-slate-100 rounded-xl p-2.5 border border-slate-700/80 focus:outline-none focus:border-cyan-400 font-mono"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-300 font-medium block mb-1">
              Media Endpoint URL (Опционально, для генерации изображений; видео API не поддерживает):
            </label>
            <input
              type="text"
              value={mediaEndpointUrl}
              onChange={(e) => setMediaEndpointUrl(e.target.value)}
              placeholder="По умолчанию использует Chat Endpoint (/images/generations)"
              className="w-full bg-[#161C2B] text-xs text-slate-100 rounded-xl p-2.5 border border-slate-700/80 focus:outline-none focus:border-cyan-400 font-mono"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 bg-[#161C2B] hover:bg-[#1E2538] text-slate-300 text-xs rounded-xl border border-slate-700"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-gradient-to-r from-[#00C4B4] via-[#0866FF] to-[#E03E93] hover:opacity-95 text-white text-xs font-semibold rounded-xl shadow-md flex items-center space-x-1.5 disabled:opacity-50"
            >
              {savedSuccess ? (
                <>
                  <SvgCheck className="w-3.5 h-3.5" />
                  <span>Сохранено!</span>
                </>
              ) : (
                <span>{isSaving ? "Сохранение..." : "Сохранить конфигурацию"}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
