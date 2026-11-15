import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createRequire } from "node:module";

// Dynamic runtime import of Patchright (Playwright's undetected stealth fork)
function getPatchright() {
  const req = createRequire(import.meta.url);
  return req("patchright");
}

// --- Smart URL / Search Query Resolver ---
export function resolveInputToUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "about:blank";

  // Protocols
  if (/^(https?:\/\/|about:|file:\/\/)/i.test(trimmed)) {
    return trimmed;
  }

  // Localhost
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  // IPv4 address
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `http://${trimmed}`;
  }

  // Domain with TLD without spaces
  if (!/\s/.test(trimmed)) {
    const domainMatch = trimmed.match(/^([a-zA-Z0-9-]+\.)+([a-zA-Z]{2,})(:\d+)?(\/.*)?$/);
    if (domainMatch) {
      return `https://${trimmed}`;
    }
  }

  // Otherwise: Google Search
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

// --- RPC Schemas ---
const tabSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  isLoading: z.boolean(),
});

const statusSchema = z.object({
  running: z.boolean(),
  engine: z.enum(["patchright", "chrome"]),
  port: z.number(),
  version: z.string(),
  activeTabId: z.string(),
  tabs: z.array(tabSummarySchema),
  currentUrl: z.string(),
  currentTitle: z.string(),
  screenshot: z.string().nullable(),
  stealth: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  error: z.string().nullable(),
});

const navigateInputSchema = z.object({
  url: z.string().min(1),
  tabId: z.string().optional(),
  stealth: z.boolean().optional(),
});

const switchTabInputSchema = z.object({
  tabId: z.string(),
});

const closeTabInputSchema = z.object({
  tabId: z.string(),
});

const tabActionInputSchema = z.object({
  tabId: z.string().optional(),
});

const clickInputSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  selector: z.string().optional(),
  tabId: z.string().optional(),
});

const fillInputSchema = z.object({
  selector: z.string(),
  value: z.string(),
  tabId: z.string().optional(),
});

const typeInputSchema = z.object({
  text: z.string(),
  tabId: z.string().optional(),
});

const keyInputSchema = z.object({
  key: z.string(),
  code: z.string().optional(),
  tabId: z.string().optional(),
});

const scrollInputSchema = z.object({
  direction: z.enum(["up", "down", "top", "bottom"]).optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  selector: z.string().optional(),
  tabId: z.string().optional(),
});

const contentInputSchema = z.object({
  format: z.enum(["text", "html", "links", "markdown", "snapshot"]),
  selector: z.string().optional(),
  tabId: z.string().optional(),
});

const contentOutputSchema = z.object({
  ok: z.boolean(),
  content: z.string(),
  error: z.string().nullable(),
});

const evalInputSchema = z.object({
  expression: z.string(),
  tabId: z.string().optional(),
});

const evalOutputSchema = z.object({
  ok: z.boolean(),
  result: z.string().nullable(),
  error: z.string().nullable(),
});

const actionOutputSchema = z.object({
  ok: z.boolean(),
  activeTabId: z.string(),
  tabs: z.array(tabSummarySchema),
  url: z.string(),
  title: z.string(),
  screenshot: z.string().nullable(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  error: z.string().nullable(),
});

export const rpcContract = defineRpcContract({
  get_status: { input: z.null(), output: statusSchema },
  navigate: { input: navigateInputSchema, output: actionOutputSchema },
  new_tab: { input: z.object({ url: z.string().optional() }), output: actionOutputSchema },
  switch_tab: { input: switchTabInputSchema, output: actionOutputSchema },
  close_tab: { input: closeTabInputSchema, output: actionOutputSchema },
  navigate_back: { input: tabActionInputSchema, output: actionOutputSchema },
  navigate_forward: { input: tabActionInputSchema, output: actionOutputSchema },
  reload: { input: tabActionInputSchema, output: actionOutputSchema },
  click: { input: clickInputSchema, output: actionOutputSchema },
  fill: { input: fillInputSchema, output: actionOutputSchema },
  type_text: { input: typeInputSchema, output: actionOutputSchema },
  send_key: { input: keyInputSchema, output: actionOutputSchema },
  scroll: { input: scrollInputSchema, output: actionOutputSchema },
  get_content: { input: contentInputSchema, output: contentOutputSchema },
  evaluate: { input: evalInputSchema, output: evalOutputSchema },
  restart_engine: { input: z.null(), output: statusSchema },
  switch_engine: { input: z.object({ engine: z.enum(["patchright", "chrome"]) }), output: statusSchema },
});

// --- Tab Definition ---
interface TabState {
  id: string;
  page: any;
  url: string;
  title: string;
  screenshot: string | null;
  history: string[];
  historyIndex: number;
  isLoading: boolean;
}

// --- Browser Controller (Patchright + Google Chrome) ---
class BrowserController {
  private browser: any = null;
  private context: any = null;
  public engineType: "patchright" | "chrome" = "patchright";
  public port = 9222;
  public version = "131.0";
  public stealth = true;
  public lastError: string | null = null;
  private isStarting = false;

  private tabs: Map<string, TabState> = new Map();
  private activeTabId = "";
  private tabCounter = 0;
  public currentThreadId = "thr_ewfspnvvtc";

  constructor(private log: (msg: string) => void) {}

  public getUserDataDir(): string {
    const os = require("node:os");
    const path = require("node:path");
    const fs = require("node:fs");

    // Default / Main thread preserves existing WhatsApp session in patchright-chrome-profile
    if (!this.currentThreadId || this.currentThreadId === "thr_ewfspnvvtc" || this.currentThreadId === "main") {
      return path.join(os.homedir(), ".bb", "patchright-chrome-profile");
    }

    // Every other thread gets its own isolated profile directory: 1 Thread = 1 distinct browser session!
    const profilesDir = path.join(os.homedir(), ".bb", "browser-profiles");
    if (!fs.existsSync(profilesDir)) {
      try { fs.mkdirSync(profilesDir, { recursive: true }); } catch {}
    }
    const threadDir = path.join(profilesDir, this.currentThreadId);
    if (!fs.existsSync(threadDir)) {
      try { fs.mkdirSync(threadDir, { recursive: true }); } catch {}
    }
    return threadDir;
  }

  public async switchThreadSession(threadId: string): Promise<any> {
    if (this.currentThreadId !== threadId) {
      this.log(`Switching browser session to thread: ${threadId}`);
      this.currentThreadId = threadId;
      await this.restart();
    }
    return this.getStatus();
  }

  public async start(): Promise<boolean> {
    if (this.browser && this.context) {
      return true;
    }
    if (this.isStarting) return false;
    this.isStarting = true;

    try {
      this.lastError = null;
      this.log(`Launching ${this.engineType} engine with Google Chrome...`);

      const { chromium } = getPatchright();
      const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

      const launchArgs = [
        "--no-sandbox",
        "--disable-infobars",
        "--disable-dev-shm-usage",
        "--window-size=1280,800",
      ];
      if (this.stealth) {
        launchArgs.push("--disable-blink-features=AutomationControlled");
      }

      const userDataDir = this.getUserDataDir();
      this.context = await chromium.launchPersistentContext(userDataDir, {
        executablePath: chromePath,
        headless: true,
        args: launchArgs,
        viewport: { width: 1280, height: 800 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        deviceScaleFactor: 1,
      });
      this.browser = this.context;

      this.log(`${this.engineType} engine launched successfully with persistent profile.`);

      // Create initial tab if empty
      if (this.tabs.size === 0) {
        await this.createTab("https://web.whatsapp.com");
      }

      return true;
    } catch (err: any) {
      this.lastError = `Failed to start ${this.engineType}: ${err?.message ?? err}`;
      this.log(this.lastError);
      return false;
    } finally {
      this.isStarting = false;
    }
  }

  // --- Multi-Tab Management ---
  public async createTab(initialUrl = "https://web.whatsapp.com"): Promise<TabState> {
    await this.start();
    const resolvedUrl = resolveInputToUrl(initialUrl);

    this.tabCounter++;
    const tabId = `tab-${this.tabCounter}`;

    let page: any;
    const existing = this.context.pages ? this.context.pages() : [];
    if (this.tabs.size === 0 && existing.length > 0) {
      page = existing[0];
    } else {
      page = await this.context.newPage();
    }

    const newTab: TabState = {
      id: tabId,
      page,
      url: resolvedUrl,
      title: "New Tab",
      screenshot: null,
      history: [resolvedUrl],
      historyIndex: 0,
      isLoading: false,
    };

    this.tabs.set(tabId, newTab);
    this.activeTabId = tabId;

    await this.navigateInternal(newTab, resolvedUrl);
    return newTab;
  }

  public async switchTab(tabId: string): Promise<TabState | null> {
    if (!this.tabs.has(tabId)) return null;
    this.activeTabId = tabId;
    const tab = this.tabs.get(tabId)!;
    try {
      await tab.page.bringToFront();
    } catch {}
    if (!tab.screenshot) {
      await this.capture(tab);
    }
    return tab;
  }

  public async closeTab(tabId: string): Promise<{ activeTabId: string; ok: boolean }> {
    const tab = this.tabs.get(tabId);
    if (!tab) return { activeTabId: this.activeTabId, ok: false };

    try {
      await tab.page.close();
    } catch {}

    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        this.activeTabId = remaining[remaining.length - 1];
        const nextTab = this.tabs.get(this.activeTabId)!;
        await nextTab.page.bringToFront().catch(() => null);
      } else {
        await this.createTab("https://web.whatsapp.com");
      }
    }

    return { activeTabId: this.activeTabId, ok: true };
  }

  private getTab(tabId?: string): TabState | null {
    const targetId = tabId || this.activeTabId;
    return this.tabs.get(targetId) || null;
  }

  private async capture(tab: TabState): Promise<void> {
    try {
      const buf = await tab.page.screenshot({ type: "jpeg", quality: 80 });
      tab.screenshot = `data:image/jpeg;base64,${buf.toString("base64")}`;
      tab.title = (await tab.page.title()) || "New Tab";
      tab.url = tab.page.url();
    } catch (e: any) {
      this.log(`Capture warning: ${e?.message ?? e}`);
    }
  }

  private async navigateInternal(tab: TabState, resolvedUrl: string): Promise<void> {
    tab.isLoading = true;
    try {
      this.log(`Navigating tab ${tab.id} to ${resolvedUrl}...`);
      await tab.page.goto(resolvedUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      // Give pages with dynamic content (e.g. WhatsApp Web QR code) time to initialize
      await new Promise((r) => setTimeout(r, 1200));

      tab.url = tab.page.url();
      await this.capture(tab);
    } catch (err: any) {
      this.lastError = `Navigation failed: ${err?.message ?? err}`;
      try {
        await this.capture(tab);
      } catch {}
    } finally {
      tab.isLoading = false;
    }
  }

  public async navigate(inputUrl: string, tabId?: string, stealth?: boolean) {
    if (stealth !== undefined && stealth !== this.stealth) {
      this.stealth = stealth;
      await this.restart();
    }

    await this.start();
    const tab = this.getTab(tabId);
    if (!tab) return this.getActionOutput();

    const resolvedUrl = resolveInputToUrl(inputUrl);

    if (tab.historyIndex >= 0 && tab.historyIndex < tab.history.length - 1) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
    }
    tab.history.push(resolvedUrl);
    tab.historyIndex = tab.history.length - 1;

    await this.navigateInternal(tab, resolvedUrl);
    return this.getActionOutput();
  }

  public async navigateBack(tabId?: string) {
    const tab = this.getTab(tabId);
    if (!tab || tab.historyIndex <= 0) return this.getActionOutput();

    tab.historyIndex--;
    try {
      await tab.page.goBack({ waitUntil: "domcontentloaded", timeout: 8000 });
    } catch {
      await this.navigateInternal(tab, tab.history[tab.historyIndex]);
    }
    await this.capture(tab);
    return this.getActionOutput();
  }

  public async navigateForward(tabId?: string) {
    const tab = this.getTab(tabId);
    if (!tab || tab.historyIndex >= tab.history.length - 1) return this.getActionOutput();

    tab.historyIndex++;
    try {
      await tab.page.goForward({ waitUntil: "domcontentloaded", timeout: 8000 });
    } catch {
      await this.navigateInternal(tab, tab.history[tab.historyIndex]);
    }
    await this.capture(tab);
    return this.getActionOutput();
  }

  public async reload(tabId?: string) {
    const tab = this.getTab(tabId);
    if (!tab) return this.getActionOutput();

    try {
      await tab.page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
      await new Promise((r) => setTimeout(r, 1000));
      await this.capture(tab);
    } catch {}
    return this.getActionOutput();
  }

  // --- Click & Selectors ---
  public async click(params: { x?: number; y?: number; selector?: string; tabId?: string }) {
    const tab = this.getTab(params.tabId);
    if (!tab) return { ...this.getActionOutput(), ok: false, error: "No active tab" };

    try {
      if (params.selector) {
        await tab.page.click(params.selector, { timeout: 4000 });
      } else if (params.x !== undefined && params.y !== undefined) {
        await tab.page.mouse.click(params.x, params.y);
      }

      await new Promise((r) => setTimeout(r, 400));
      await this.capture(tab);
      return this.getActionOutput();
    } catch (err: any) {
      return { ...this.getActionOutput(), ok: false, error: String(err) };
    }
  }

  // --- Fill Input by Selector ---
  public async fill(selector: string, value: string, tabId?: string) {
    const tab = this.getTab(tabId);
    if (!tab) return { ...this.getActionOutput(), ok: false, error: "No active tab" };

    try {
      await tab.page.fill(selector, value, { timeout: 4000 });
      await new Promise((r) => setTimeout(r, 200));
      await this.capture(tab);
      return this.getActionOutput();
    } catch (err: any) {
      return { ...this.getActionOutput(), ok: false, error: String(err) };
    }
  }

  public async typeText(text: string, tabId?: string) {
    const tab = this.getTab(tabId);
    if (!tab) return { ...this.getActionOutput(), ok: false, error: "No active tab" };

    try {
      await tab.page.keyboard.type(text);
      await new Promise((r) => setTimeout(r, 200));
      await this.capture(tab);
      return this.getActionOutput();
    } catch (err: any) {
      return { ...this.getActionOutput(), ok: false, error: String(err) };
    }
  }

  public async sendKey(key: string, _code?: string, tabId?: string) {
    const tab = this.getTab(tabId);
    if (!tab) return { ...this.getActionOutput(), ok: false, error: "No active tab" };

    try {
      await tab.page.keyboard.press(key);
      await new Promise((r) => setTimeout(r, 200));
      await this.capture(tab);
      return this.getActionOutput();
    } catch (err: any) {
      return { ...this.getActionOutput(), ok: false, error: String(err) };
    }
  }

  public async scroll(params: { direction?: "up" | "down" | "top" | "bottom"; deltaX?: number; deltaY?: number; selector?: string; tabId?: string }) {
    const tab = this.getTab(params.tabId);
    if (!tab) return { ...this.getActionOutput(), ok: false, error: "No active tab" };

    try {
      if (params.selector) {
        await tab.page.$eval(params.selector, (el: any) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      } else if (params.direction === "top") {
        await tab.page.evaluate(() => window.scrollTo(0, 0));
      } else if (params.direction === "bottom") {
        await tab.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      } else {
        const dy = params.deltaY ?? (params.direction === "up" ? -350 : 350);
        await tab.page.mouse.wheel(params.deltaX ?? 0, dy);
      }

      await new Promise((r) => setTimeout(r, 250));
      await this.capture(tab);
      return this.getActionOutput();
    } catch (err: any) {
      return { ...this.getActionOutput(), ok: false, error: String(err) };
    }
  }

  // --- Snapshot of Interactive Elements for AI Agent (9999% precision!) ---
  public async getSnapshot(tabId?: string): Promise<string> {
    const tab = this.getTab(tabId);
    if (!tab) return "No active tab";

    try {
      const snap = await tab.page.evaluate(() => {
        const items: string[] = [];
        let ref = 1;
        const elements = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [onclick]');
        elements.forEach((el: any) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(el).display === "none") return;
          const tag = el.tagName.toLowerCase();
          let desc = tag;
          if (tag === "a") desc = `Link "${(el.innerText || el.href).trim().slice(0, 50)}"`;
          else if (tag === "button" || el.getAttribute("role") === "button") desc = `Button "${el.innerText.trim().slice(0, 40)}"`;
          else if (tag === "input") desc = `Input [${el.type || "text"}] name="${el.name || ""}" placeholder="${el.placeholder || ""}" value="${el.value || ""}"`;
          else if (tag === "select") desc = `Select name="${el.name || ""}"`;

          let sel = tag;
          if (el.id) sel += "#" + el.id;
          else if (el.name) sel += `[name="${el.name}"]`;
          else if (el.className && typeof el.className === "string") sel += "." + Array.from(el.classList).slice(0, 2).join(".");

          items.push(`[${ref++}] ${desc} -> selector: "${sel}" (x: ${Math.round(rect.x + rect.width / 2)}, y: ${Math.round(rect.y + rect.height / 2)})`);
        });
        return items.slice(0, 100).join("\n");
      });
      return snap || "No interactive elements found";
    } catch (e: any) {
      return `Snapshot error: ${e}`;
    }
  }

  public async getContent(format: "text" | "html" | "links" | "markdown" | "snapshot", selector?: string, tabId?: string): Promise<{ ok: boolean; content: string; error: string | null }> {
    const tab = this.getTab(tabId);
    if (!tab) return { ok: false, content: "", error: "No active tab" };

    if (format === "snapshot") {
      const snap = await this.getSnapshot(tabId);
      return { ok: true, content: snap, error: null };
    }

    try {
      let content = "";
      if (format === "html") {
        content = selector ? await tab.page.$eval(selector, (el: any) => el.outerHTML) : await tab.page.content();
      } else if (format === "text") {
        content = await tab.page.innerText(selector || "body");
      } else if (format === "links") {
        const links = await tab.page.evaluate(() => {
          return Array.from(document.querySelectorAll("a"))
            .map((a: any) => ({ text: a.innerText.trim(), href: a.href }))
            .filter((l) => l.href && l.href.startsWith("http"));
        });
        content = JSON.stringify(links, null, 2);
      } else if (format === "markdown") {
        content = await tab.page.evaluate(() => {
          let text = "# " + document.title + "\n\n";
          document.querySelectorAll("h1, h2, h3, p, li").forEach((el: any) => {
            const t = el.innerText.trim();
            if (!t) return;
            const tag = el.tagName.toLowerCase();
            if (tag === "h1") text += "\n# " + t + "\n";
            else if (tag === "h2") text += "\n## " + t + "\n";
            else if (tag === "h3") text += "\n### " + t + "\n";
            else if (tag === "li") text += "- " + t + "\n";
            else text += t + "\n\n";
          });
          return text;
        });
      }

      return { ok: true, content, error: null };
    } catch (err: any) {
      return { ok: false, content: "", error: String(err) };
    }
  }

  public async evaluate(expression: string, tabId?: string): Promise<{ ok: boolean; result: string | null; error: string | null }> {
    const tab = this.getTab(tabId);
    if (!tab) return { ok: false, result: null, error: "No active tab" };

    try {
      const res = await tab.page.evaluate(expression);
      return { ok: true, result: JSON.stringify(res, null, 2), error: null };
    } catch (err: any) {
      return { ok: false, result: null, error: String(err) };
    }
  }

  public async switchEngine(engine: "patchright" | "chrome"): Promise<any> {
    const currentTab = this.getTab();
    const currentUrl = currentTab?.url || "https://web.whatsapp.com";
    this.log(`Switching browser engine to ${engine}...`);
    this.engineType = engine;
    this.stealth = engine === "patchright";
    await this.restart();
    if (this.tabs.size > 0 && currentUrl) {
      const activeTab = this.getTab();
      if (activeTab) {
        await this.navigateInternal(activeTab, currentUrl);
      }
    }
    return this.getStatus();
  }

  public async restart(): Promise<void> {
    this.log(`Restarting ${this.engineType} engine...`);
    if (this.context) {
      try {
        await this.context.close();
      } catch {}
      this.context = null;
      this.browser = null;
    }
    this.tabs.clear();
    this.activeTabId = "";
    await new Promise((r) => setTimeout(r, 400));
    await this.start();
  }

  public getTabsSummary() {
    return Array.from(this.tabs.values()).map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      canGoBack: t.historyIndex > 0,
      canGoForward: t.historyIndex < t.history.length - 1,
      isLoading: t.isLoading,
    }));
  }

  public getActionOutput() {
    const tab = this.getTab();
    return {
      ok: true,
      activeTabId: this.activeTabId,
      tabs: this.getTabsSummary(),
      url: tab?.url || "about:blank",
      title: tab?.title || "New Tab",
      screenshot: tab?.screenshot || null,
      canGoBack: tab ? tab.historyIndex > 0 : false,
      canGoForward: tab ? tab.historyIndex < tab.history.length - 1 : false,
      error: this.lastError,
    };
  }

  public getStatus() {
    const tab = this.getTab();
    return {
      running: this.browser !== null && this.context !== null,
      engine: this.engineType,
      port: this.port,
      version: this.version,
      activeTabId: this.activeTabId,
      tabs: this.getTabsSummary(),
      currentUrl: tab?.url || "about:blank",
      currentTitle: tab?.title || "New Tab",
      screenshot: tab?.screenshot || null,
      stealth: this.stealth,
      canGoBack: tab ? tab.historyIndex > 0 : false,
      canGoForward: tab ? tab.historyIndex < tab.history.length - 1 : false,
      error: this.lastError,
    };
  }

  public async dispose() {
    this.log("Disposing browser controller...");
    if (this.context) {
      try {
        await this.context.close();
      } catch {}
      this.context = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
    }
    this.tabs.clear();
  }
}

// --- Plugin Entrypoint ---
export default function (bb: BbPluginApi) {
  const controller = new BrowserController((msg) => bb.log.info(msg));

  // Implement RPCs for the frontend
  bb.rpc.register(rpcContract, {
    get_status: async () => controller.getStatus(),
    navigate: async (input) => controller.navigate(input.url, input.tabId, input.stealth),
    new_tab: async (input) => {
      await controller.createTab(input.url || "https://web.whatsapp.com");
      return controller.getActionOutput();
    },
    switch_tab: async (input) => {
      await controller.switchTab(input.tabId);
      return controller.getActionOutput();
    },
    close_tab: async (input) => {
      await controller.closeTab(input.tabId);
      return controller.getActionOutput();
    },
    navigate_back: async (input) => controller.navigateBack(input.tabId),
    navigate_forward: async (input) => controller.navigateForward(input.tabId),
    reload: async (input) => controller.reload(input.tabId),
    click: async (input) => controller.click(input),
    fill: async (input) => controller.fill(input.selector, input.value, input.tabId),
    type_text: async (input) => controller.typeText(input.text, input.tabId),
    send_key: async (input) => controller.sendKey(input.key, input.code, input.tabId),
    scroll: async (input) => controller.scroll(input),
    get_content: async (input) => controller.getContent(input.format, input.selector, input.tabId),
    evaluate: async (input) => controller.evaluate(input.expression, input.tabId),
    restart_engine: async () => {
      await controller.restart();
      return controller.getStatus();
    },
    switch_engine: async (input) => {
      return await controller.switchEngine(input.engine);
    },
  });

  // Register CLI Command
  bb.cli.register({
    name: "patchright",
    summary: "Interact with the Patchright & Chrome browser",
    commands: [
      {
        name: "open",
        summary: "Open a URL or search query",
        usage: "bb patchright open <query-or-url>",
      },
      {
        name: "status",
        summary: "Get current browser engine and tab status",
        usage: "bb patchright status",
      },
      {
        name: "dump",
        summary: "Dump text, markdown, links, or snapshot from URL",
        usage: "bb patchright dump <query-or-url> [--format text|html|links|markdown|snapshot]",
      },
    ],
    run: async (argv) => {
      const sub = argv[0];
      const args = argv.slice(1);

      if (sub === "session") {
        const threadId = args[0];
        if (threadId) {
          const res = await controller.switchThreadSession(threadId);
          return { exitCode: 0, stdout: JSON.stringify(res, null, 2) };
        }
        return { exitCode: 0, stdout: JSON.stringify({ currentThreadId: controller.currentThreadId, userDataDir: controller.getUserDataDir() }, null, 2) };
      }

      if (sub === "status") {
        await controller.start();
        return { exitCode: 0, stdout: JSON.stringify(controller.getStatus(), null, 2) };
      }

      if (sub === "open") {
        const query = args.join(" ").trim();
        if (!query) return { exitCode: 1, stderr: "Usage: bb patchright open <query-or-url>" };
        await controller.start();
        const res = await controller.navigate(query);
        return { exitCode: 0, stdout: `Navigated: ${res.title} (${res.url})` };
      }

      if (sub === "dump") {
        const formatArgIndex = args.indexOf("--format");
        let format: any = "text";
        let targetArgs = [...args];
        if (formatArgIndex !== -1 && args[formatArgIndex + 1]) {
          format = args[formatArgIndex + 1];
          targetArgs.splice(formatArgIndex, 2);
        }
        const query = targetArgs.join(" ").trim();
        await controller.start();
        if (query && query !== "current" && query !== ".") {
          await controller.navigate(query);
        }
        const res = await controller.getContent(format);
        return { exitCode: res.ok ? 0 : 1, stdout: res.content || "", stderr: res.error || undefined };
      }

      if (sub === "click") {
        const sel = args.join(" ").trim();
        await controller.start();
        // Check if selector is coordinates x,y
        const coordMatch = sel.match(/^(\d+),(\d+)$/);
        const res = coordMatch
          ? await controller.click({ x: parseInt(coordMatch[1]), y: parseInt(coordMatch[2]) })
          : await controller.click({ selector: sel });
        return { exitCode: res.ok ? 0 : 1, stdout: res.ok ? "Clicked" : "Click failed", stderr: res.error || undefined };
      }

      if (sub === "type") {
        const text = args.join(" ");
        await controller.start();
        const res = await controller.typeText(text);
        return { exitCode: res.ok ? 0 : 1, stdout: res.ok ? `Typed: "${text}"` : "Type failed", stderr: res.error || undefined };
      }

      if (sub === "key") {
        const key = args[0] || "Enter";
        await controller.start();
        const res = await controller.sendKey(key);
        return { exitCode: res.ok ? 0 : 1, stdout: res.ok ? `Key ${key} sent` : "Key failed", stderr: res.error || undefined };
      }

      if (sub === "eval") {
        const expr = args.join(" ").trim();
        await controller.start();
        const res = await controller.evaluate(expr);
        return { exitCode: res.ok ? 0 : 1, stdout: res.result || "", stderr: res.error || undefined };
      }

      if (sub === "snapshot") {
        await controller.start();
        const snap = await controller.getSnapshot();
        return { exitCode: 0, stdout: snap };
      }

      return { exitCode: 0, stdout: "Usage: bb patchright [status|open|dump|click|type|key|eval|snapshot]" };
    },
  });

  // Register AI Agent tools (eagerly available for DeepMind / Claude / BB agents)
  bb.agents.registerTool({
    name: "patchright_browse",
    description: "Superhuman browser control powered by Patchright + Google Chrome: search Google, navigate URLs, manage multi-tabs, click by selector/coordinates, fill inputs, press keys, scroll, take element snapshots, and extract data.",
    parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "navigate",
                "new_tab",
                "switch_tab",
                "close_tab",
                "list_tabs",
                "click",
                "fill",
                "type",
                "press_key",
                "scroll",
                "snapshot",
                "get_text",
                "get_html",
                "get_links",
                "get_markdown",
                "evaluate",
                "screenshot",
              ],
            },
            url: { type: "string", description: "URL or search query" },
            tab_id: { type: "string", description: "Target tab ID (e.g. 'tab-1')" },
            selector: { type: "string", description: "CSS selector for click, fill, or scroll" },
            value: { type: "string", description: "Value to fill into input" },
            text: { type: "string", description: "Text to type" },
            key: { type: "string", description: "Key to press ('Enter', 'Tab', 'Escape', etc.)" },
            x: { type: "number", description: "X coordinate for click" },
            y: { type: "number", description: "Y coordinate for click" },
            direction: { type: "string", enum: ["up", "down", "top", "bottom"], description: "Scroll direction" },
            expression: { type: "string", description: "JavaScript expression to evaluate" },
          },
          required: ["action"],
        },
        execute: async (args: any) => {
          await controller.start();
          const action = args.action;

          switch (action) {
            case "navigate": {
              if (!args.url) return "Error: 'url' parameter required for navigate";
              const res = await controller.navigate(args.url, args.tab_id);
              const snippet = (await controller.getContent("text", undefined, res.activeTabId)).content.slice(0, 500);
              return `Loaded: ${res.title} (${res.url})\n\nPage excerpt:\n${snippet}`;
            }

            case "new_tab": {
              const tab = await controller.createTab(args.url || "about:blank");
              return `Opened new tab ${tab.id} at ${tab.url}`;
            }

            case "switch_tab": {
              if (!args.tab_id) return "Error: 'tab_id' parameter required";
              const tab = await controller.switchTab(args.tab_id);
              return tab ? `Switched to tab ${tab.id}: ${tab.title}` : `Tab ${args.tab_id} not found`;
            }

            case "close_tab": {
              if (!args.tab_id) return "Error: 'tab_id' parameter required";
              const res = await controller.closeTab(args.tab_id);
              return `Closed tab. Active tab is now ${res.activeTabId}`;
            }

            case "list_tabs": {
              const status = controller.getStatus();
              return JSON.stringify(status.tabs, null, 2);
            }

            case "click": {
              const res = await controller.click({
                x: args.x,
                y: args.y,
                selector: args.selector,
                tabId: args.tab_id,
              });
              return res.ok ? `Clicked successfully at ${args.selector || `${args.x},${args.y}`}` : `Click failed: ${res.error}`;
            }

            case "fill": {
              if (!args.selector) return "Error: 'selector' required for fill";
              const res = await controller.fill(args.selector, args.value || "", args.tab_id);
              return res.ok ? `Filled selector '${args.selector}'` : `Fill failed: ${res.error}`;
            }

            case "type": {
              if (!args.text) return "Error: 'text' required for type";
              const res = await controller.typeText(args.text, args.tab_id);
              return res.ok ? `Typed text: "${args.text}"` : `Type failed: ${res.error}`;
            }

            case "press_key": {
              if (!args.key) return "Error: 'key' required for press_key";
              const res = await controller.sendKey(args.key, undefined, args.tab_id);
              return res.ok ? `Pressed key: ${args.key}` : `Key press failed: ${res.error}`;
            }

            case "scroll": {
              const res = await controller.scroll({
                direction: args.direction,
                selector: args.selector,
                tabId: args.tab_id,
              });
              return res.ok ? `Scrolled ${args.direction || args.selector || "down"}` : `Scroll failed: ${res.error}`;
            }

            case "snapshot": {
              const snap = await controller.getSnapshot(args.tab_id);
              return `Interactive Elements Snapshot:\n${snap}`;
            }

            case "get_text": {
              const res = await controller.getContent("text", args.selector, args.tab_id);
              return res.content;
            }

            case "get_html": {
              const res = await controller.getContent("html", args.selector, args.tab_id);
              return res.content;
            }

            case "get_links": {
              const res = await controller.getContent("links", undefined, args.tab_id);
              return res.content;
            }

            case "get_markdown": {
              const res = await controller.getContent("markdown", undefined, args.tab_id);
              return res.content;
            }

            case "evaluate": {
              if (!args.expression) return "Error: 'expression' required for evaluate";
              const res = await controller.evaluate(args.expression, args.tab_id);
              return res.ok ? res.result : `Evaluate error: ${res.error}`;
            }

            case "screenshot": {
              const st = controller.getStatus();
              return st.screenshot ? "Screenshot captured (base64 available in status)" : "No screenshot available";
            }

            default:
              return `Unknown action: ${action}`;
          }
        },
  });

  bb.agents.configure((_context) => ({
    tools: ["patchright_browse"],
    skills: [],
  }));
}
