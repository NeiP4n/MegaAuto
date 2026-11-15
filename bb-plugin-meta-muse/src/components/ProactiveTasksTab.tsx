import React, { useState } from "react";
import type { ProactiveTask } from "../types";
import {
  SvgClock,
  SvgPlay,
  SvgPause,
  SvgTrash,
  SvgCheckCircle,
  SvgAlertCircle,
  SvgZap,
  SvgActivity,
} from "../icons";

interface ProactiveTasksTabProps {
  tasks: ProactiveTask[];
  onCreateTask: (params: {
    title: string;
    description?: string;
    triggerType: "cron" | "interval" | "due_date";
    scheduleExpression: string;
    actionType: "reminder" | "digest" | "audit" | "web_poll" | "custom_script";
  }) => Promise<void>;
  onToggleTaskStatus: (taskId: string) => Promise<void>;
  onTriggerTaskNow: (taskId: string) => Promise<void>;
  onCancelTask: (taskId: string) => Promise<void>;
}

const SCHEDULE_PRESETS = [
  { label: "15м", value: "15m" },
  { label: "30м", value: "30m" },
  { label: "1 час", value: "1h" },
  { label: "6 часов", value: "6h" },
  { label: "Каждое утро (09:00)", value: "0 9 * * *" },
  { label: "Еженедельно", value: "0 0 * * 0" },
];

export function ProactiveTasksTab({
  tasks,
  onCreateTask,
  onToggleTaskStatus,
  onTriggerTaskNow,
  onCancelTask,
}: ProactiveTasksTabProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<"cron" | "interval" | "due_date">("interval");
  const [scheduleExpression, setScheduleExpression] = useState("1h");
  const [actionType, setActionType] = useState<"reminder" | "digest" | "audit" | "web_poll" | "custom_script">("digest");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!title.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onCreateTask({
        title,
        description: description.trim() ? description : undefined,
        triggerType,
        scheduleExpression,
        actionType,
      });
      setTitle("");
      setDescription("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeCount = tasks.filter((t) => t.status === "active").length;

  return (
    <div className="flex h-full w-full gap-4 overflow-hidden">
      {/* LEFT: Create Proactive Task */}
      <div className="w-96 flex flex-col bg-[#10141E]/90 rounded-2xl border border-slate-800/80 shadow-2xl p-5 overflow-y-auto backdrop-blur-md space-y-4">
        <div className="flex items-center space-x-2.5 pb-3 border-b border-slate-800/80">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#00C4B4] to-[#0866FF] flex items-center justify-center p-[1px]">
            <div className="w-full h-full bg-[#10141E] rounded-[6px] flex items-center justify-center">
              <SvgZap className="w-3.5 h-3.5 text-cyan-300" />
            </div>
          </div>
          <div>
            <h2 className="text-xs font-bold text-white tracking-wide">Новая Проактивная Задача</h2>
            <p className="text-[10px] text-slate-400">Автономное фоновое расписание</p>
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-3 text-xs">
          <div>
            <label className="text-[11px] text-slate-300 font-medium block mb-1">
              Название задачи:
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Утренний дайджест активности и аудит кода"
              className="w-full bg-[#161C2B] text-xs text-white rounded-xl p-2.5 border border-slate-700/80 focus:outline-none focus:border-cyan-400"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-300 font-medium block mb-1">
              Описание / инструкция:
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Что именно должна выполнить Муза в момент триггера..."
              className="w-full bg-[#161C2B] text-xs text-white rounded-xl p-2.5 border border-slate-700/80 focus:outline-none focus:border-cyan-400 resize-none text-[11px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-300 font-medium block mb-1">
                Тип действия:
              </label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as any)}
                className="w-full bg-[#161C2B] text-xs text-white rounded-xl p-2 border border-slate-700/80"
              >
                <option value="digest">Дайджест</option>
                <option value="reminder">Напоминание</option>
                <option value="audit">Аудит безопасности</option>
                <option value="web_poll">Опрос внешних API</option>
                <option value="custom_script">Скрипт песочницы</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] text-slate-300 font-medium block mb-1">
                Тип триггера:
              </label>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as any)}
                className="w-full bg-[#161C2B] text-xs text-white rounded-xl p-2 border border-slate-700/80"
              >
                <option value="interval">Интервал (e.g. 1h)</option>
                <option value="cron">Крон (0 9 * * *)</option>
                <option value="due_date">Точная дата</option>
              </select>
            </div>
          </div>

          {/* Schedule presets */}
          <div>
            <label className="text-[11px] text-slate-300 font-medium block mb-1">
              Расписание (интервал / крон):
            </label>
            <input
              type="text"
              value={scheduleExpression}
              onChange={(e) => setScheduleExpression(e.target.value)}
              placeholder="15m, 1h, или 0 9 * * *"
              className="w-full bg-[#161C2B] font-mono text-xs text-cyan-300 rounded-xl p-2.5 border border-slate-700/80 focus:outline-none focus:border-cyan-400"
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {SCHEDULE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setScheduleExpression(p.value)}
                  className="text-[10px] px-2 py-0.5 rounded-lg bg-[#161C2B] hover:bg-[#1E2538] text-slate-400 hover:text-cyan-300 border border-slate-800 transition"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim()}
            className="w-full py-3 rounded-xl text-xs font-bold tracking-wide bg-gradient-to-r from-[#00C4B4] via-[#0866FF] to-[#E03E93] text-white hover:brightness-110 transition shadow-lg shadow-cyan-900/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center space-x-2 pt-3"
          >
            <SvgClock className="w-4 h-4" />
            <span>{isSubmitting ? "Планирование..." : "+ Запланировать Задачу"}</span>
          </button>
        </div>

        {/* Engine Status Banner */}
        <div className="bg-[#161C2B]/80 rounded-xl border border-slate-800 p-3 space-y-1.5 text-[11px]">
          <div className="flex items-center space-x-2 text-emerald-400 font-medium">
            <SvgCheckCircle className="w-3.5 h-3.5" />
            <span>Диспетчер задач активен</span>
          </div>
          <p className="text-slate-400 text-[10px] leading-relaxed">
            Фоновый планировщик Meta Muse непрерывно мониторит интервалы и выполняет запланированные проверки в изолированной среде.
          </p>
        </div>
      </div>

      {/* RIGHT: Tasks List & Execution Log */}
      <div className="flex-1 flex flex-col bg-[#10141E]/90 rounded-2xl border border-slate-800/80 shadow-2xl p-5 overflow-hidden backdrop-blur-md">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
          <div className="flex items-center space-x-2">
            <h3 className="text-xs font-bold text-white tracking-wide">
              Список Фоновых Задач
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#161C2B] text-cyan-300 font-mono border border-cyan-800/60">
              {activeCount} активно / {tasks.length} всего
            </span>
          </div>

          <div className="flex items-center space-x-2 text-[11px] text-slate-400">
            <SvgActivity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Календарь и Диспетчер: Синхронизировано</span>
          </div>
        </div>

        {/* Tasks Scroll Area */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {tasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <SvgClock className="w-12 h-12 text-slate-700 mb-2" />
              <p className="text-xs">Задач пока нет.</p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Заполните форму слева, чтобы настроить периодический аудит или дайджест.
              </p>
            </div>
          ) : (
            tasks.map((task) => {
              const isActive = task.status === "active";
              const isExpanded = expandedTaskId === task.id;

              return (
                <div
                  key={task.id}
                  className="bg-[#161C2B] rounded-2xl border border-slate-800/80 hover:border-slate-700/80 p-4 transition duration-200 shadow-md space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-xs text-white">{task.title}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                            isActive
                              ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800/60"
                              : "bg-amber-950/80 text-amber-400 border border-amber-800/60"
                          }`}
                        >
                          {task.status}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#10141E] text-slate-400 border border-slate-800 uppercase font-mono">
                          {task.actionType}
                        </span>
                      </div>

                      {task.description && (
                        <p className="text-xs text-slate-300 leading-relaxed">{task.description}</p>
                      )}

                      <div className="flex items-center space-x-3 text-[11px] text-slate-400 font-mono pt-0.5">
                        <span>Расписание: <strong className="text-cyan-300 font-normal">{task.scheduleExpression}</strong></span>
                        <span>•</span>
                        <span>Выполнено: {task.runCount} раз</span>
                        {task.nextRun && (
                          <>
                            <span>•</span>
                            <span>След: {new Date(task.nextRun).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-2 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => onTriggerTaskNow(task.id)}
                        className="flex items-center space-x-1 text-xs px-2.5 py-1.5 rounded-lg bg-[#1E2538] hover:bg-[#28324C] text-cyan-300 border border-cyan-800/60 transition shadow-sm"
                        title="Запустить немедленно"
                      >
                        <SvgPlay className="w-3 h-3" />
                        <span>Пуск</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleTaskStatus(task.id)}
                        className="flex items-center space-x-1 text-xs px-2.5 py-1.5 rounded-lg bg-[#1E2538] hover:bg-[#28324C] text-slate-300 border border-slate-700 transition"
                      >
                        {isActive ? <SvgPause className="w-3 h-3 text-amber-400" /> : <SvgPlay className="w-3 h-3 text-emerald-400" />}
                        <span>{isActive ? "Пауза" : "Старт"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Удалить задачу "${task.title}"?`)) {
                            onCancelTask(task.id);
                          }
                        }}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 transition"
                        title="Удалить задачу"
                      >
                        <SvgTrash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Execution Logs */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center space-x-1"
                    >
                      <span>{isExpanded ? "▼ Скрыть логи выполнения" : `▶ Логи выполнения (${task.logs?.length || 0})`}</span>
                    </button>

                    {isExpanded && (
                      <div className="mt-2 p-2.5 rounded-xl bg-[#0B0E14] border border-slate-800/80 font-mono text-[11px] space-y-1 max-h-36 overflow-y-auto">
                        {!task.logs || task.logs.length === 0 ? (
                          <div className="text-slate-600">Логов выполнения пока нет.</div>
                        ) : (
                          task.logs.map((log, idx) => (
                            <div key={idx} className="flex space-x-2">
                              <span className="text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                              <span
                                className={`uppercase font-bold ${
                                  log.level === "error"
                                    ? "text-rose-400"
                                    : log.level === "warn"
                                    ? "text-amber-400"
                                    : "text-cyan-400"
                                }`}
                              >
                                [{log.level}]
                              </span>
                              <span className="text-slate-300">{log.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
