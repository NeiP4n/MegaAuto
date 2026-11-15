---
name: n8n
description: "Control local & remote n8n automation instances, inspect and trigger workflows, dispatch webhooks, monitor execution history, and manage the local n8n server lifecycle. Use when orchestrating n8n nodes, triggering automations, checking execution logs, or troubleshooting n8n."
---

# n8n Automation & Project Hub Management Skill

Этот скилл обеспечивает полный цикл управления локальными и удалёнными инстансами автоматизации **n8n** внутри Blackbox (BB) и через плагин **Project Hub**. Скилл доступен как для агентов через инструменты, так и для человека через CLI и интерфейс плагина.

---

## 🚀 Быстрая шпаргалка по CLI (`bb project-hub`)

```bash
# 1. Проверка статуса n8n, задержки (latency) и числа подключённых аккаунтов
bb project-hub status

# 2. Управление локальным процессом n8n (статус, запуск, полная остановка)
bb project-hub server status
bb project-hub server start
bb project-hub server stop

# 3. Список подключённых инстансов n8n
bb project-hub accounts

# 4. Список сценариев (с подтягиванием статуса АКТИВЕН / ПАУЗА)
bb project-hub workflows
bb project-hub workflows <accountId>

# 5. Отправка вебхука с произвольным JSON-телом в n8n
bb project-hub webhook my-endpoint '{"event": "lead_created", "userId": 42}'

# 6. Синхронизация сценариев в карточки проектов
bb project-hub sync

# 7. Список проектов и отправка интерактивных команд/сообщений
bb project-hub list
bb project-hub send <projectId> "Выполнить резервное копирование"
```

---

## 🛠 Архитектура и возможности плагина

1. **Dual-Mode чтение данных**:
   - **Официальный REST API**: используется при наличии `X-N8N-API-KEY`.
   - **Автономный SQLite Fallback**: если ключ не задан или на локальном мастере (порт 5678), плагин безопасно читает `~/.n8n/database.sqlite` в строгом режиме `readOnly: true`. Никаких блокировок базы данных.
2. **Гарантированное управление жизненным циклом**:
   - Автоматический поиск PID на порту 5678 (через системный `netstat`/`lsof`), даже если n8n был запущен внешне.
   - Двухэтапная остановка: мягкий сигнал (`taskkill /t` или `SIGTERM`), ожидание освобождения порта до 3 секунд и эскалация в принудительное завершение (`taskkill /f /t` или `SIGKILL`).
   - Таймаут готовности при старте до 30 секунд для надёжного запуска холодного n8n на Windows.
3. **Безопасность корпоративного уровня**:
   - Шифрование API-ключей at-rest алгоритмом **AES-256-GCM** с префиксом `enc:v1:`.
   - Защита вебхуков: строгий запрет HTTP-редиректов (`redirect: "manual"`), валидация URL через WHATWG-парсер, защита от Path Traversal (`/webhook/../`), двойного URL-декодирования и сохранения pathname инстанса.

---

## 📋 Инструменты агентов (Agent Tools)

Агенты в Blackbox могут вызывать инструменты напрямую:

| Инструмент | Параметры | Описание |
|---|---|---|
| `project_hub_list_accounts` | — | Список всех инстансов со статусами (`online`/`offline`), latency (мс) и счётчиками воркфлоу |
| `project_hub_get_workflows` | `accountId` | Получение списка воркфлоу, тегов, активности и последнего execution |
| `project_hub_get_executions` | `accountId`, `workflowId` | История запусков, время выполнения, статус (`success`, `error`), имя упавшей ноды |
| `project_hub_dispatch_webhook` | `path`, `payload`, `method` | Отправка вебхука в n8n с возвратом HTTP-кода и ответа ноды |
| `project_hub_server_status` | — | Проверка доступности порта 5678, PID процесса и последних консольных логов |
| `project_hub_manage_server` | `action: "start" \| "status"` | Запуск сервера или опрос его состояния |

---

## 🧩 Практические рецепты автоматизаций

### Рецепт 1: Приём вебхука в n8n и возврат ответа
1. В веб-редакторе n8n (`http://localhost:5678`) добавьте ноду **Webhook**:
   - **HTTP Method**: `POST`
   - **Path**: `incoming-lead`
   - **Response Mode**: `When Last Node Finishes` (или `Using 'Respond to Webhook' Node`)
2. Соедините с нодой **Code** или базой данных.
3. Активируйте воркфлоу (переключатель **Active** в правом верхнем углу).
4. Протестируйте вызов из Blackbox:
   ```bash
   bb project-hub webhook incoming-lead '{"name": "Иван", "email": "ivan@example.com"}'
   ```

### Рецепт 2: Telegram-бот с AI-агентом
1. Добавьте ноду **Telegram Trigger** (укажите токен бота из BotFather).
2. Подключите ноду **AI Agent**:
   - **Model**: OpenAI Chat Model / Anthropic Chat Model / Local Ollama.
   - **Memory**: Window Buffer Memory.
   - **Tools**: Нода Calculator, HTTP Request или поиск.
3. В Project Hub этот сценарий появится как проект, и сообщения можно отслеживать прямо в чате хаба.

### Рецепт 3: Регулярный мониторинг и CRON
1. Нода **Schedule Trigger** (интервал: каждые 15 минут).
2. Нода **HTTP Request** (проверка доступности внешнего сервиса).
3. Нода **If**: если статус `>= 400`, отправить оповещение.
4. В Project Hub вы увидите историю выполнений и предупреждения при сбоях.

---

## 🔧 Диагностика и решение проблем

* **Сервер не запускается, порт 5678 занят**:
  Выполните `bb project-hub server stop`. Плагин автоматически вычислит занявший порт процесс (PID) и полностью освободит порт.
* **Вебхук возвращает 404**:
  В n8n производственный вебхук (`/webhook/<path>`) отвечает только тогда, когда воркфлоу **активирован** (тумблер **Active** в n8n). Для неактивного воркфлоу используйте тестовый путь `/webhook-test/<path>`.
* **Воркфлоу не видны после создания**:
  Нажмите иконку обновления 🔄 в UI плагина или выполните `bb project-hub sync`. Данные синхронизируются мгновенно.
