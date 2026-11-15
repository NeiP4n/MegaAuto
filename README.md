# MegaAuto

A unified monorepo of automation and messaging plugins for [Blackbox (BB)](https://get-bb.com).

## 📦 Plugins Overview

| Plugin | Directory | Description | Key Tech |
| :--- | :--- | :--- | :--- |
| **WhatsApp Multi-Account MCP** | [`bb-plugin-whatsapp`](./bb-plugin-whatsapp) | Full-featured WhatsApp multidevice bridge (`whatsmeow`), multi-account session management, 12 MCP agent tools, contact name resolution, and real-time chat UI. | Go (`whatsmeow`), TypeScript, React, SQLite, MCP |
| **Browser Choice (Patchright + Chrome)** | [`bb-plugin-browser-choice`](./bb-plugin-browser-choice) | Anti-detect / stealth browser (Patchright) and standard Google Chrome CDP engine for autonomous browsing and Cloudflare bypass. | Patchright, Chrome CDP, React, TypeScript |
| **Project Hub (n8n Workflow Automation)** | [`bb-plugin-project-hub`](./bb-plugin-project-hub) | Multi-instance monitoring and bi-directional command dispatch across n8n servers, Telegram bots, and custom webhooks. | n8n REST API & Webhooks, React, TypeScript |

---

## 🚀 Quick Setup & Installation

Each plugin can be developed or installed directly into Blackbox:

### WhatsApp Plugin
```bash
cd bb-plugin-whatsapp
npm install
# Bridge binary is precompiled in bridge/whatsapp-bridge.exe
# To recompile bridge from source:
cd bridge && go build -o whatsapp-bridge.exe . && cd ..
bb plugin build .
```

### Browser Choice Plugin
```bash
cd bb-plugin-browser-choice
npm install
bb plugin build .
```

### Project Hub Plugin
```bash
cd bb-plugin-project-hub
npm install
bb plugin build .
```

---

## 🛠 Local Development & Testing

Run any plugin in watch mode within Blackbox:
```bash
bb plugin dev <plugin-directory>
```
Or reload an installed plugin:
```bash
bb plugin reload <plugin-id>
```
