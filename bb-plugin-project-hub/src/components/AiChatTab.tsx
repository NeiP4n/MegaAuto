import React, { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../types";
import { SvgBot, SvgUser, SvgSend, SvgTrash, SvgSparkles, SvgActivity, SvgZap } from "../icons";

interface AiChatTabProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => Promise<{ ok: boolean; error?: string }>;
  onClearHistory: () => Promise<void>;
  isLoadingHistory: boolean;
  isSending: boolean;
  n8nConnected: boolean;
}

const QUICK_PROMPTS = [
  "Как создать Telegram-бота в n8n?",
  "Напиши JS-код для Code ноды (парсинг JSON)",
  "Проверь статус локального n8n и базу SQLite",
  "Что умеет Gemini 3.8 Flash ACP в связке с n8n?",
];

export function AiChatTab({
  messages,
  onSendMessage,
  onClearHistory,
  isLoadingHistory,
  isSending,
  n8nConnected,
}: AiChatTabProps) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isSending) return;
    setInputText("");
    await onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderFormattedText = (text: string) => {
    // Basic Markdown formatting helper for lines and code blocks
    const lines = text.split("\n");
    return lines.map((line, idx) => {
      if (line.startsWith("### ")) {
        return (
          <div key={idx} className="font-bold text-foreground text-xs mt-2 mb-1 flex items-center gap-1.5">
            <SvgSparkles className="w-3 h-3 text-primary" />
            <span>{line.replace("### ", "")}</span>
          </div>
        );
      }
      if (line.startsWith("```")) {
        return null; // handled around blocks
      }
      if (line.startsWith("* ") || line.startsWith("- ")) {
        return (
          <div key={idx} className="text-xs text-foreground/90 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-primary">
            {line.replace(/^[\*\-]\s+/, "")}
          </div>
        );
      }
      if (line.trim() === "") {
        return <div key={idx} className="h-1.5" />;
      }
      return (
        <div key={idx} className="text-xs text-foreground/90 leading-relaxed">
          {line}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col h-full w-full bg-background select-text font-sans overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-3.5 py-2 bg-card/30 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
            <SvgSparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground tracking-tight">
                n8n AI Chat Agent
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-primary/15 text-primary border border-primary/30">
                gemini-3.8-flash (acp)
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground mr-1">
            <span className={`w-2 h-2 rounded-full ${n8nConnected ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-destructive"}`} />
            <span>{n8nConnected ? "n8n online" : "n8n offline"}</span>
          </div>

          <button
            onClick={onClearHistory}
            disabled={messages.length === 0}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            title="Очистить историю чата"
          >
            <SvgTrash className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {isLoadingHistory ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground gap-2">
            <SvgActivity className="w-4 h-4 animate-spin text-primary" />
            <span>Загрузка истории чата...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto py-8">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-3">
              <SvgSparkles className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              AI Агент n8n готов к диалогу
            </h3>
            <p className="text-xs text-muted-foreground mt-1 mb-4 leading-relaxed">
              Модель <span className="text-primary font-mono">Gemini 3.8 Flash ACP</span> подключена напрямую к движку n8n. Задавайте вопросы по созданию сценариев, нодам и скриптам.
            </p>

            {/* Quick Prompts */}
            <div className="w-full grid grid-cols-1 gap-1.5 text-left">
              {QUICK_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInputText(prompt);
                    textareaRef.current?.focus();
                  }}
                  className="px-3 py-2 rounded-lg bg-card/60 hover:bg-card border border-border/40 hover:border-primary/40 text-xs text-foreground/80 hover:text-foreground transition-all cursor-pointer text-left"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.sender === "user";
            return (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}
              >
                {!isUser && (
                  <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <SvgBot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2.5 shadow-sm text-xs ${
                    isUser
                      ? "bg-emerald-500/15 border border-emerald-500/30 text-foreground"
                      : "bg-card/80 border border-border/50 text-foreground backdrop-blur-sm"
                  }`}
                >
                  {/* Sender Header */}
                  <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground mb-1">
                    <span className="font-semibold text-foreground/80">
                      {isUser ? "Вы (Оператор)" : msg.senderName || "Gemini 3.8 Flash"}
                    </span>
                    <span className="font-mono">{msg.timestamp}</span>
                  </div>

                  {/* Body */}
                  <div className="space-y-1">
                    {renderFormattedText(msg.text)}
                  </div>

                  {/* Metadata pills for AI */}
                  {!isUser && msg.metadata?.durationMs && (
                    <div className="mt-2 pt-1.5 border-t border-border/30 flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                      <span className="text-primary inline-flex items-center gap-1">
                        <SvgZap className="w-3 h-3" />
                        {msg.metadata.durationMs}ms
                      </span>
                      <span>•</span>
                      <span>engine: n8n VM</span>
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                    <SvgUser className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* In-Flight Indicator */}
        {isSending && (
          <div className="flex gap-2.5 justify-start">
            <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center text-primary shrink-0 animate-pulse">
              <SvgBot className="w-4 h-4" />
            </div>
            <div className="bg-card/70 border border-primary/30 rounded-xl px-3.5 py-2.5 flex items-center gap-2 text-xs text-primary">
              <SvgActivity className="w-3.5 h-3.5 animate-spin text-primary" />
              <span>Gemini 3.8 Flash обрабатывает запрос в n8n...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="p-3 border-t border-border/40 bg-card/30 shrink-0">
        <div className="relative flex items-end gap-2 bg-background border border-border/50 rounded-xl p-1.5 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Задайте вопрос n8n AI Агенту (Gemini 3.8 Flash ACP)..."
            className="flex-1 bg-transparent border-0 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none resize-none max-h-24 min-h-[32px]"
          />

          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isSending}
            className="p-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary border border-primary/40 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer shrink-0"
            title="Отправить (Enter)"
          >
            <SvgSend className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1 mt-1.5 font-mono">
          <span>Нажмите Enter для отправки, Shift+Enter для новой строки</span>
          <span className="text-primary/80">Gemini 3.8 Flash • ACP Ready</span>
        </div>
      </div>
    </div>
  );
}
