import React, { useState } from "react";
import { SvgSend, SvgCode, SvgActivity, SvgCheck, SvgCopy } from "../icons";
import type { WebhookDispatchResult } from "../types";

interface WebhookConsoleProps {
  instanceUrl: string;
  workflowId: string;
  workflowName: string;
  onDispatch: (path: string, payload: Record<string, unknown>) => Promise<WebhookDispatchResult>;
}

export function WebhookConsole({
  instanceUrl,
  workflowId,
  workflowName,
  onDispatch,
}: WebhookConsoleProps) {
  const defaultPath = `/webhook/n8n-${workflowId}`;
  const [webhookPath, setWebhookPath] = useState(defaultPath);
  const [jsonPayload, setJsonPayload] = useState('{\n  "action": "trigger",\n  "test": true\n}');
  const [isSending, setIsSending] = useState(false);
  const [lastResult, setLastResult] = useState<WebhookDispatchResult | null>(null);
  const [copied, setCopied] = useState(false);

  const cleanBase = instanceUrl.replace(/\/+$/, "");
  const fullWebhookUrl = `${cleanBase}${webhookPath.startsWith("/") ? webhookPath : "/" + webhookPath}`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(fullWebhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = async () => {
    // Confirmation check for production webhooks
    const isProductionWebhook = !webhookPath.includes("test") && !jsonPayload.includes('"test": true');
    if (isProductionWebhook) {
      const confirmed = window.confirm(`Отправить запрос на рабочий вебхук n8n (${webhookPath})?`);
      if (!confirmed) return;
    }

    let parsedPayload: Record<string, unknown> = {};
    try {
      if (jsonPayload.trim()) {
        parsedPayload = JSON.parse(jsonPayload);
      }
    } catch {
      setLastResult({
        ok: false,
        error: "Ошибка синтаксиса JSON в теле запроса",
      });
      return;
    }

    setIsSending(true);
    setLastResult(null);
    try {
      const res = await onDispatch(webhookPath, parsedPayload);
      setLastResult(res);
    } catch (err: any) {
      setLastResult({
        ok: false,
        error: err?.message || "Ошибка отправки запроса в вебхук",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card/20 border-t border-border/40 select-none">
      {/* Header bar */}
      <div className="px-3.5 py-2 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SvgCode className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
            Вебхук-триггер & Консоль
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopyUrl}
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground bg-secondary/60 hover:bg-secondary px-2 py-1 rounded transition-colors"
            title="Скопировать полный URL вебхука"
          >
            {copied ? <SvgCheck className="w-3 h-3 text-emerald-400" /> : <SvgCopy className="w-3 h-3" />}
            <span>{copied ? "Скопировано" : "URL вебхука"}</span>
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2.5 flex-1 overflow-y-auto">
        {/* Endpoint path input */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-wider">
            Путь вебхука (POST)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-muted-foreground/80 truncate shrink-0">
              {cleanBase}
            </span>
            <input
              type="text"
              value={webhookPath}
              onChange={(e) => setWebhookPath(e.target.value)}
              placeholder="/webhook/my-trigger"
              className="flex-1 bg-secondary/80 border border-border/40 rounded px-2.5 py-1 text-xs font-mono text-foreground focus:outline-hidden focus:border-emerald-500/50"
            />
          </div>
        </div>

        {/* JSON Payload editor */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-wider">
            Тело запроса (JSON Payload)
          </label>
          <textarea
            value={jsonPayload}
            onChange={(e) => setJsonPayload(e.target.value)}
            rows={4}
            className="w-full bg-secondary/60 border border-border/40 rounded p-2 text-xs font-mono text-foreground focus:outline-hidden focus:border-emerald-500/50 leading-relaxed resize-none"
            spellCheck={false}
          />
        </div>

        {/* Send Action */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleSend}
            disabled={isSending}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-medium text-xs transition-all disabled:opacity-50"
          >
            {isSending ? (
              <SvgActivity className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <SvgSend className="w-3.5 h-3.5" />
            )}
            <span>{isSending ? "Отправка..." : "Отправить триггер в n8n"}</span>
          </button>

          {lastResult && (
            <div className="text-[11px] font-mono flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  lastResult.ok ? "bg-emerald-400" : "bg-rose-500"
                }`}
              />
              <span className={lastResult.ok ? "text-emerald-400" : "text-rose-400"}>
                {lastResult.statusCode ? `HTTP ${lastResult.statusCode}` : lastResult.ok ? "OK" : "Error"}
              </span>
              {lastResult.durationMs !== undefined && (
                <span className="text-muted-foreground">({lastResult.durationMs}ms)</span>
              )}
            </div>
          )}
        </div>

        {/* Response Viewer */}
        {lastResult && (
          <div className="mt-2 p-2 rounded bg-secondary/80 border border-border/40 text-[11px] font-mono select-text">
            <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
              Ответ вебхука:
            </div>
            {lastResult.error ? (
              <div className="text-rose-400 break-words">{lastResult.error}</div>
            ) : (
              <pre className="text-foreground/90 overflow-x-auto whitespace-pre-wrap max-h-36">
                {JSON.stringify(lastResult.response, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
