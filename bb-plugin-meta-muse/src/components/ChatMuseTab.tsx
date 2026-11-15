import React, { useState, useRef, useEffect } from "react";
import type { MuseConversation, MuseMessage, MuseMode } from "../types";
import {
  SvgSparkles,
  SvgSend,
  SvgBot,
  SvgUser,
  SvgPlus,
  SvgTrash,
  SvgSearch,
  SvgDownload,
  SvgAlertTriangle,
} from "../icons";

interface ChatMuseTabProps {
  conversations: MuseConversation[];
  selectedConvId: string;
  onSelectConversation: (id: string) => void;
  onCreateConversation: (title?: string) => Promise<void>;
  onDeleteConversation: (id: string) => Promise<void>;
  messages: MuseMessage[];
  onSendMessage: (text: string) => Promise<void>;
  isSending: boolean;
  currentMode: MuseMode;
  onExportChat: (convId: string, format: "markdown" | "json") => Promise<void>;
  isApiConfigured: boolean;
  onOpenApiModal: () => void;
  lastChatError?: string | null;
}

const STARTER_PROMPTS = [
  "✦ Проанализируй состояние хост-процесса и памяти плагина",
  "✦ Создай фоновую задачу для проверки логов каждые 30 минут",
  "✦ Сохрани в долговременную память предпочтение по цветовой палитре обсидиана и циана",
  "✦ Объясни архитектуру автономного компаньона Meta Muse",
];

export function ChatMuseTab({
  conversations,
  selectedConvId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  messages,
  onSendMessage,
  isSending,
  currentMode,
  onExportChat,
  isApiConfigured,
  onOpenApiModal,
  lastChatError,
}: ChatMuseTabProps) {
  const [inputText, setInputText] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const activeConv = conversations.find((c) => c.id === selectedConvId);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isSending) return;
    const text = inputText;
    setInputText("");
    await onSendMessage(text);
  };

  const handleSuggestionClick = async (suggestion: string) => {
    if (isSending) return;
    await onSendMessage(suggestion);
  };

  return (
    <div className="flex h-full w-full gap-4 overflow-hidden">
      {/* LEFT: Conversations Sidebar */}
      <aside className="w-72 flex flex-col bg-[#10141E]/90 rounded-2xl border border-slate-800/80 shadow-xl overflow-hidden backdrop-blur-md">
        {/* Sidebar Header */}
        <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-slate-200 tracking-wide">Диалоги Музы</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#161C2B] text-slate-400 font-mono border border-slate-700/60">
              {conversations.length}
            </span>
          </div>

          <button
            onClick={() => onCreateConversation()}
            className="flex items-center space-x-1 text-xs px-2.5 py-1 rounded-lg bg-gradient-to-r from-[#0866FF]/30 to-[#00C4B4]/30 text-cyan-300 border border-cyan-800/60 hover:border-cyan-500/80 hover:brightness-110 transition shadow-sm"
          >
            <SvgPlus className="w-3.5 h-3.5" />
            <span>Новый</span>
          </button>
        </div>

        {/* Search filter */}
        <div className="p-2 border-b border-slate-800/60">
          <div className="relative">
            <SvgSearch className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Поиск диалогов..."
              className="w-full bg-[#161C2B] text-xs text-slate-200 pl-8 pr-3 py-1.5 rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500/60 transition"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500 space-y-1">
              <p>Нет диалогов (чистый старт).</p>
              <p className="text-[11px] text-slate-600">Нажмите «+ Новый», чтобы создать сессию.</p>
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isSelected = selectedConvId === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => onSelectConversation(c.id)}
                  className={`group relative flex items-center justify-between p-2.5 rounded-xl text-xs cursor-pointer transition-all duration-200 ${
                    isSelected
                      ? "bg-gradient-to-r from-[#161C2B] to-[#1A2234] text-white border border-[#00C4B4]/40 shadow-md shadow-cyan-950/20"
                      : "text-slate-400 hover:text-slate-200 hover:bg-[#161C2B]/60 border border-transparent"
                  }`}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="font-medium truncate flex items-center space-x-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-[#00C4B4]" : "bg-slate-600"}`} />
                      <span className="truncate">{c.title}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center space-x-2 mt-1">
                      <span className="font-mono uppercase text-slate-400">{c.mode}</span>
                      <span>•</span>
                      <span>{c.messageCount} сообщ.</span>
                    </div>
                  </div>

                  {/* Delete conversation */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Удалить диалог "${c.title}"?`)) {
                        onDeleteConversation(c.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 transition rounded hover:bg-rose-950/40"
                    title="Удалить диалог"
                  >
                    <SvgTrash className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* RIGHT: Chat Timeline & Interactive Canvas */}
      <section className="flex-1 flex flex-col bg-[#10141E]/90 rounded-2xl border border-slate-800/80 shadow-2xl overflow-hidden backdrop-blur-md relative">
        {/* Chat Header Bar */}
        <div className="px-5 py-3 border-b border-slate-800/80 flex items-center justify-between bg-[#161C2B]/50">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#0866FF] to-[#E03E93] flex items-center justify-center p-[1px] shadow-sm">
              <div className="w-full h-full bg-[#10141E] rounded-[7px] flex items-center justify-center">
                <SvgBot className="w-4 h-4 text-cyan-300" />
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">
                {activeConv?.title || "Интерактивная Муза"}
              </h2>
              <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                <span className="flex items-center space-x-1">
                  <span className={`w-2 h-2 rounded-full ${isApiConfigured ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <span className={isApiConfigured ? "text-emerald-400" : "text-amber-400"}>
                    {isApiConfigured ? "API подключен" : "API не настроен"}
                  </span>
                </span>
                <span>•</span>
                <span>Режим: <strong className="text-cyan-300 font-normal">{currentMode}</strong></span>
              </div>
            </div>
          </div>

          {/* Export Actions */}
          <div className="flex items-center space-x-2">
            <button
              onClick={async () => {
                if (!selectedConvId) return;
                setIsExporting(true);
                try {
                  await onExportChat(selectedConvId, "markdown");
                } finally {
                  setIsExporting(false);
                }
              }}
              disabled={isExporting || !selectedConvId}
              className="flex items-center space-x-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#161C2B] hover:bg-[#1E2538] text-slate-300 border border-slate-700/80 transition disabled:opacity-50"
              title="Экспорт в Markdown"
            >
              <SvgDownload className="w-3.5 h-3.5 text-cyan-400" />
              <span>Экспорт .md</span>
            </button>
          </div>
        </div>

        {/* Unconfigured API Banner if needed */}
        {!isApiConfigured && (
          <div className="bg-[#161C2B] border-b border-amber-900/40 px-5 py-2.5 flex items-center justify-between text-xs text-amber-200">
            <div className="flex items-center space-x-2">
              <SvgAlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Meta Muse API не настроен. Укажите API ключ или эндпоинт в настройках для выполнения реальных диалогов.</span>
            </div>
            <button
              onClick={onOpenApiModal}
              className="text-xs px-2.5 py-1 rounded-lg bg-amber-950/60 hover:bg-amber-900/60 border border-amber-800 text-amber-300 font-medium transition shrink-0 ml-3"
            >
              Настроить API
            </button>
          </div>
        )}

        {/* Error notification if last chat error */}
        {lastChatError && (
          <div className="bg-rose-950/60 border-b border-rose-900/60 px-5 py-2.5 flex items-center space-x-2 text-xs text-rose-200">
            <SvgAlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{lastChatError}</span>
          </div>
        )}

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#0866FF] via-[#E03E93] to-[#00C4B4] p-[2px] shadow-xl shadow-cyan-500/20">
                <div className="w-full h-full bg-[#0B0E14] rounded-[14px] flex items-center justify-center">
                  <SvgSparkles className="w-8 h-8 text-cyan-300" />
                </div>
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Диалог Meta Muse</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Без фейковых заглушек и симуляций. Все запросы направляются напрямую в сконфигурированный API провайдер.
                </p>
              </div>

              {/* Starter chips */}
              <div className="w-full space-y-2 pt-2">
                <span className="text-[11px] font-medium text-slate-400 block uppercase tracking-wider">
                  Рекомендуемые запросы:
                </span>
                <div className="grid grid-cols-1 gap-2 text-left">
                  {STARTER_PROMPTS.map((starter, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSuggestionClick(starter.replace("✦ ", ""))}
                      className="text-xs p-2.5 rounded-xl bg-[#161C2B] hover:bg-[#1C2436] text-slate-200 border border-slate-800 hover:border-cyan-500/50 transition duration-200 text-left"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${isUser ? "items-end" : "items-start"} animate-fadeIn`}
                >
                  <div className="flex items-center space-x-2 mb-1 px-1">
                    <span className="text-[10px] text-slate-500">
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {isUser ? "Вы" : "Meta Muse"}
                    </span>
                  </div>

                  {/* Bubble Content */}
                  <div
                    className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-4 text-xs leading-relaxed shadow-lg transition-all ${
                      isUser
                        ? "bg-gradient-to-br from-[#0866FF] to-[#0052CC] text-white shadow-blue-900/30 border border-blue-400/20"
                        : "bg-[#161C2B]/90 text-slate-100 border border-slate-700/60 backdrop-blur-md shadow-black/40"
                    }`}
                  >
                    <div className="whitespace-pre-wrap select-text">{m.content}</div>

                    {/* Media Attachments */}
                    {m.mediaUrls && m.mediaUrls.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-slate-700/40">
                        {m.mediaUrls.map((url, i) => (
                          <div
                            key={i}
                            onClick={() => setLightboxUrl(url)}
                            className="relative group rounded-lg overflow-hidden border border-slate-600/50 cursor-pointer aspect-video bg-black/40"
                          >
                            <img
                              src={url}
                              alt="Generated preview"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                              <span className="text-[10px] font-medium text-white px-2 py-1 bg-black/60 rounded">
                                Просмотр
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Muse Proactive Suggestions Chips */}
                  {!isUser && m.suggestions && m.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5 max-w-[85%]">
                      {m.suggestions.map((s, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSuggestionClick(s)}
                          disabled={isSending}
                          className="text-[11px] px-3 py-1 rounded-full bg-[#161C2B] hover:bg-[#1E2538] text-cyan-300 border border-cyan-800/60 hover:border-cyan-400 transition-all shadow-sm flex items-center space-x-1"
                        >
                          <span className="text-[#00C4B4]">✦</span>
                          <span>{s}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Typing indicator */}
          {isSending && (
            <div className="flex flex-col items-start animate-pulse">
              <div className="flex items-center space-x-2 mb-1 px-1">
                <span className="text-[10px] font-semibold text-cyan-400">Meta Muse думает...</span>
              </div>
              <div className="rounded-2xl px-4 py-3 bg-[#161C2B]/90 border border-cyan-800/50 flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-[#0866FF] animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 rounded-full bg-[#E03E93] animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 rounded-full bg-[#00C4B4] animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input Bar */}
        <div className="p-4 border-t border-slate-800/80 bg-[#10141E]/95">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Задайте вопрос Музе, опишите медиа-идею или поставьте задачу..."
                className="w-full bg-[#161C2B] text-xs text-white placeholder-slate-500 rounded-xl px-4 py-3 border border-slate-700/80 focus:outline-none focus:border-cyan-400/80 focus:ring-1 focus:ring-cyan-400/30 transition shadow-inner"
              />
            </div>

            <button
              type="submit"
              disabled={isSending || !inputText.trim()}
              className="px-5 py-3 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#0866FF] via-[#E03E93] to-[#00C4B4] text-white hover:opacity-95 transition-all shadow-md shadow-pink-900/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1.5"
            >
              <span>{isSending ? "Обработка..." : "Отправить"}</span>
              <SvgSend className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </section>

      {/* Lightbox Modal */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 cursor-pointer"
        >
          <div className="relative max-w-4xl max-h-[90vh] rounded-2xl overflow-hidden border border-slate-700 shadow-2xl">
            <img src={lightboxUrl} alt="Preview" className="w-full h-auto max-h-[85vh] object-contain" />
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute top-3 right-3 px-3 py-1 bg-black/70 hover:bg-black text-white text-xs rounded-full border border-slate-600"
            >
              ✕ Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
