---
name: meta-muse
description: "Meta Muse companion: conversation history, proactive task scheduling (cron/interval/due date), and associative long-term memory. Media generation and the VM sandbox are not connected yet - tools report that honestly instead of simulating results."
---

# Meta Muse AI Companion & Autonomous Assistant Skill

Этот скилл открывает доступ к возможностям **Meta Muse AI** — персонального автономного ассистента с продвинутым студийным генератором медиа, изолированной песочницей VM, проактивным планировщиком фоновых задач и ассоциативной базой долговременной памяти.

---

## 🚀 Возможности CLI (`bb muse`)

```bash
# 1. Проверка общего статуса Meta Muse (память, VM, задачи, медиа-очередь)
bb muse status

# 2. Интерактивный диалог с Музой или отправка быстрого сообщения
bb muse chat "Привет, Муза! Предложи 3 креативных концепта для анимации"
bb muse chat --list
bb muse chat --history <conversationId>

# 3. Управление проактивными задачами
bb muse tasks list
bb muse tasks create "Утренний дайджест" "0 9 * * *" "digest"
bb muse tasks status <taskId>
bb muse tasks cancel <taskId>

# 4. Проверка состояния защищённой изолированной VM-песочницы
bb muse vm status
bb muse vm isolate

# 5. Поиск и сохранение долговременных воспоминаний
bb muse memory list
bb muse memory search "палитра"
bb muse memory store "color_pref" "Пользователь предпочитает неоновые и глубокие обсидиановые градиенты"

# 6. Список всех доступных инструментов Meta Muse
bb muse tools
```

---

## 🛠 Набор инструментов агента (15 Tools)

1. `muse_send_message` — Отправка сообщения Музе с выбором режима (`creative`, `analytical`, `proactive`, `strict_sandbox`).
2. `muse_list_conversations` — Получение списка активных бесед и метаданных.
3. `muse_get_conversation_history` — Загрузка истории сообщений конкретного диалога.
4. `muse_generate_media` — Постановка задачи генерации изображения или видео в медиа-студию (с выбором пресета стилей, пропорций и сида).
5. `muse_manage_schedule` — Настройка расписаний и планировщика задач (cron, интервалы).
6. `muse_list_proactive_tasks` — Список всех проактивных задач и их текущего статуса.
7. `muse_create_task` — Создание новой автономной фоновой задачи (напоминание, аудит, опрос, дайджест).
8. `muse_get_task_status` — Просмотр подробного состояния и логов выполнения задачи.
9. `muse_cancel_task` — Приостановка или удаление задачи из планировщика.
10. `muse_search_memory` — Семантический и теговый поиск по долговременной памяти Музы.
11. `muse_store_memory` — Сохранение факта, предпочтения или проектной директивы в память.
12. `muse_get_vm_status` — Проверка состояния изолированной VM (CPU, память, процессы, сетевая политика).
13. `muse_switch_mode` — Мгновенное переключение рабочего профиля Музы.
14. `muse_get_system_status` — Получение полной аппаратной и программной телеметрии системы.
15. `muse_export_chat` — Экспорт переписки в Markdown или JSON формат.

---

## 🎨 Режимы работы Музы (Modes)

- **Creative**: Фокус на генерации идей, медиа-промптах, дизайне, иридисцентных палитрах и сторителлинге.
- **Analytical**: Строгий анализ данных, аудит кода, структурированные таблицы и верификация фактов.
- **Proactive**: Автономный мониторинг, предупреждения о дедлайнах, регулярные дайджесты и авто-синхронизация.
- **Strict Sandbox**: Полная изоляция выполнения в безопасной VM без доступа к внешним непроверенным сетям.
