import React, { useState } from "react";
import { SvgServer, SvgClose, SvgActivity } from "../icons";

interface AddInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, url: string, apiKey?: string) => Promise<void>;
}

export function AddInstanceModal({ isOpen, onClose, onAdd }: AddInstanceModalProps) {
  const [name, setName] = useState("n8n Production");
  const [url, setUrl] = useState("http://localhost:5678");
  const [apiKey, setApiKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    try {
      await onAdd(name.trim(), url.trim(), apiKey.trim() || undefined);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Не удалось подключить инстанс");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border/80 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SvgServer className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-semibold text-foreground">
              Подключение инстанса n8n
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <SvgClose className="w-3.5 h-3.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
          {error && (
            <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground">
              Имя инстанса
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Local n8n или Cloud VPS"
              className="w-full bg-secondary/80 border border-border/60 rounded px-3 py-1.5 text-xs text-foreground focus:outline-hidden focus:border-emerald-500/50"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground">
              URL сервера n8n
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:5678 или https://n8n.my-domain.com"
              className="w-full bg-secondary/80 border border-border/60 rounded px-3 py-1.5 text-xs font-mono text-foreground focus:outline-hidden focus:border-emerald-500/50"
              required
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Поддерживаются как локальные адреса, так и удалённые VPS.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground">
              API Ключ (X-N8N-API-KEY, опционально)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="n8n_api_..."
              className="w-full bg-secondary/80 border border-border/60 rounded px-3 py-1.5 text-xs font-mono text-foreground focus:outline-hidden focus:border-emerald-500/50"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Необходим для защищённых воркфлоу и чтения приватных логов.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-1.5 rounded bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              {isLoading && <SvgActivity className="w-3.5 h-3.5 animate-spin" />}
              <span>{isLoading ? "Проверка..." : "Подключить"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
