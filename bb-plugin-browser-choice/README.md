# Browser Choice (Patchright + Chrome) Plugin for BB

Интеграция антидетект-движка **Patchright** (undetected stealth Playwright fork) и **Google Chrome** прямо в BB.

## Возможности
1. **Выбор движка через выпадающий список (Dropdown)**:
   - 🛡️ **Patchright + Chrome (Stealth / Anti-Detect)**: обход Cloudflare, bot-detection, полноценный рендеринг WebCrypto, Canvas, ServiceWorkers для сложных веб-приложений (WhatsApp Web и др.).
   - 🌐 **Google Chrome (Standard Chromium)**: стандартный запуск системного Google Chrome через CDP.
2. **Интерфейс в BB**:
   - Вкладка `Browser` в боковой панели и панели треда.
   - Omnibox со строкой поиска и URL.
   - Мультивкладочность (открытие, переключение, закрытие табов).
   - Интерактивный клик, ввод текста, горячие клавиши, прокрутка и скриншоты.
3. **Команды CLI (`bb patchright`)**:
   - `bb patchright status` — проверка состояния движка и открытых вкладок.
   - `bb patchright open <url>` — открытие и загрузка страницы.
   - `bb patchright dump <url> [--format text|html|links|markdown|snapshot]` — дамп содержимого страницы.
4. **Инструмент для AI-агентов (`patchright_browse`)**:
   - Позволяет AI-агентам автономно серфить страницы, вводить данные и взаимодействовать с элементами без блокировок.
