import { useEffect, useState, useRef, useCallback } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import {
  SvgArrowLeft,
  SvgArrowRight,
  SvgRefresh,
  SvgLock,
  SvgClose,
  SvgStar,
  SvgSearch,
  SvgGlobe,
  SvgShield,
  SvgGlasses,
  SvgBook,
  SvgGithub,
  SvgHackerNews,
  SvgKeyboard,
  SvgWrench,
  SvgAlertTriangle,
  SvgCopy,
  SvgEnter,
  SvgTab,
  SvgPlus,
} from "./components/icons";

interface TabSummary {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

export function BrowserView() {
  const rpc = useRpc<typeof rpcContract>();

  const [status, setStatus] = useState<{
    running: boolean;
    engine?: "patchright" | "chrome";
    activeTabId: string;
    tabs: TabSummary[];
    currentUrl: string;
    currentTitle: string;
    screenshot: string | null;
    stealth: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    version: string;
    port: number;
    error: string | null;
  }>({
    running: false,
    activeTabId: "tab-1",
    tabs: [
      {
        id: "tab-1",
        url: "https://news.ycombinator.com",
        title: "Hacker News",
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
      },
    ],
    currentUrl: "https://news.ycombinator.com",
    currentTitle: "Hacker News",
    screenshot: null,
    stealth: false,
    canGoBack: false,
    canGoForward: false,
    version: "0.2.6",
    port: 9222,
    error: null,
  });

  const [urlInput, setUrlInput] = useState("https://news.ycombinator.com");
  const [isLoading, setIsLoading] = useState(false);
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [devToolsTab, setDevToolsTab] = useState<"console" | "elements" | "text" | "snapshot" | "settings">("console");
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [textContent, setTextContent] = useState("");
  const [evalInput, setEvalInput] = useState("document.title");
  const [evalResult, setEvalResult] = useState("");
  const [floatingTypeOpen, setFloatingTypeOpen] = useState(false);
  const [floatingText, setFloatingText] = useState("");

  const imgRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const omniboxRef = useRef<HTMLInputElement>(null);

  // Poll status periodically or on mount
  const shotRevRef = useRef<number>(-1);
  const refreshStatus = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const s = await rpc.call("get_status");
      const rev: number | undefined = (s as any).shotRev;
      setStatus((prev) => {
        const next = { ...s, screenshot: s.screenshot ?? prev.screenshot };
        // skip re-render when nothing visible changed
        const same =
          prev.running === next.running &&
          prev.activeTabId === next.activeTabId &&
          prev.currentUrl === next.currentUrl &&
          prev.currentTitle === next.currentTitle &&
          prev.stealth === next.stealth &&
          prev.canGoBack === next.canGoBack &&
          prev.canGoForward === next.canGoForward &&
          prev.error === next.error &&
          prev.version === next.version &&
          JSON.stringify(prev.tabs) === JSON.stringify(next.tabs);
        return same ? prev : next;
      });
      if (s.currentUrl && s.currentUrl !== "about:blank" && document.activeElement !== omniboxRef.current) {
        setUrlInput(s.currentUrl);
      }
      if (rev !== undefined && rev !== shotRevRef.current) {
        shotRevRef.current = rev;
        const shot = await rpc.call("get_screenshot");
        if (shot.screenshot) setStatus((prev) => (prev.screenshot === shot.screenshot ? prev : { ...prev, screenshot: shot.screenshot }));
      }
    } catch (e: any) {
      setStatus((prev) => (prev.error === String(e) ? prev : { ...prev, error: String(e) }));
    }
  }, [rpc]);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // Handle navigate (URL or Google Search)
  const handleNavigate = async (targetQuery?: string) => {
    const query = targetQuery ?? urlInput;
    if (!query) return;
    setIsLoading(true);
    try {
      const res = await rpc.call("navigate", {
        url: query,
        tabId: status.activeTabId,
        stealth: status.stealth,
      });
      if (res.ok) {
        setStatus((prev) => ({
          ...prev,
          running: true,
          activeTabId: res.activeTabId,
          tabs: res.tabs,
          currentUrl: res.url,
          currentTitle: res.title,
          screenshot: res.screenshot,
          canGoBack: res.canGoBack,
          canGoForward: res.canGoForward,
          error: null,
        }));
        setUrlInput(res.url);
      } else {
        setStatus((prev) => ({ ...prev, error: res.error }));
      }
    } catch (e: any) {
      setStatus((prev) => ({ ...prev, error: String(e) }));
    } finally {
      setIsLoading(false);
    }
  };

  // Create new tab
  const handleNewTab = async (initialUrl = "https://news.ycombinator.com") => {
    setIsLoading(true);
    try {
      const res = await rpc.call("new_tab", { url: initialUrl });
      if (res.ok) {
        setStatus((prev) => ({
          ...prev,
          activeTabId: res.activeTabId,
          tabs: res.tabs,
          currentUrl: res.url,
          currentTitle: res.title,
          screenshot: res.screenshot,
          canGoBack: res.canGoBack,
          canGoForward: res.canGoForward,
        }));
        setUrlInput(res.url);
      }
    } catch (e: any) {
      setStatus((prev) => ({ ...prev, error: String(e) }));
    } finally {
      setIsLoading(false);
    }
  };

  // Switch tab
  const handleSwitchTab = async (tabId: string) => {
    if (tabId === status.activeTabId) return;
    setIsLoading(true);
    try {
      const res = await rpc.call("switch_tab", { tabId });
      if (res.ok) {
        setStatus((prev) => ({
          ...prev,
          activeTabId: res.activeTabId,
          tabs: res.tabs,
          currentUrl: res.url,
          currentTitle: res.title,
          screenshot: res.screenshot,
          canGoBack: res.canGoBack,
          canGoForward: res.canGoForward,
        }));
        setUrlInput(res.url);
      }
    } catch (e: any) {
      setStatus((prev) => ({ ...prev, error: String(e) }));
    } finally {
      setIsLoading(false);
    }
  };

  // Close tab
  const handleCloseTab = async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    try {
      const res = await rpc.call("close_tab", { tabId });
      if (res.ok) {
        setStatus((prev) => ({
          ...prev,
          activeTabId: res.activeTabId,
          tabs: res.tabs,
          currentUrl: res.url,
          currentTitle: res.title,
          screenshot: res.screenshot,
          canGoBack: res.canGoBack,
          canGoForward: res.canGoForward,
        }));
        setUrlInput(res.url);
      }
    } catch (err: any) {
      setStatus((prev) => ({ ...prev, error: String(err) }));
    }
  };

  const handleBack = async () => {
    if (!status.canGoBack || isLoading) return;
    setIsLoading(true);
    try {
      const res = await rpc.call("navigate_back", { tabId: status.activeTabId });
      if (res.ok) {
        setStatus((prev) => ({
          ...prev,
          currentUrl: res.url,
          currentTitle: res.title,
          screenshot: res.screenshot,
          canGoBack: res.canGoBack,
          canGoForward: res.canGoForward,
        }));
        setUrlInput(res.url);
      }
    } catch {} finally {
      setIsLoading(false);
    }
  };

  const handleForward = async () => {
    if (!status.canGoForward || isLoading) return;
    setIsLoading(true);
    try {
      const res = await rpc.call("navigate_forward", { tabId: status.activeTabId });
      if (res.ok) {
        setStatus((prev) => ({
          ...prev,
          currentUrl: res.url,
          currentTitle: res.title,
          screenshot: res.screenshot,
          canGoBack: res.canGoBack,
          canGoForward: res.canGoForward,
        }));
        setUrlInput(res.url);
      }
    } catch {} finally {
      setIsLoading(false);
    }
  };

  const handleReload = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const res = await rpc.call("reload", { tabId: status.activeTabId });
      if (res.ok) {
        setStatus((prev) => ({
          ...prev,
          screenshot: res.screenshot,
          currentTitle: res.title,
        }));
      }
    } catch {} finally {
      setIsLoading(false);
    }
  };

  // Click on page: calculate proportional coordinates
  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const naturalW = imgRef.current.naturalWidth || 1280;
    const naturalH = imgRef.current.naturalHeight || 720;

    const scaleX = naturalW / rect.width;
    const scaleY = naturalH / rect.height;

    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    setIsLoading(true);
    try {
      const res = await rpc.call("click", { x, y, tabId: status.activeTabId });
      if (res.screenshot) {
        setStatus((prev) => ({
          ...prev,
          screenshot: res.screenshot,
          currentTitle: res.title,
          canGoBack: res.canGoBack,
          canGoForward: res.canGoForward,
        }));
      }
    } catch (err: any) {
      setStatus((prev) => ({ ...prev, error: String(err) }));
    } finally {
      setIsLoading(false);
    }
  };

  // Mouse wheel scroll
  const handleWheel = async (e: React.WheelEvent<HTMLDivElement>) => {
    try {
      const deltaY = e.deltaY > 0 ? 350 : -350;
      const res = await rpc.call("scroll", { deltaX: 0, deltaY, tabId: status.activeTabId });
      if (res.screenshot) {
        setStatus((prev) => ({ ...prev, screenshot: res.screenshot }));
      }
    } catch {}
  };

  // Direct keystroke sending when viewport is focused
  const handleViewportKeyDown = async (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (e.key === "Tab" || e.key === "Enter" || e.key === "Backspace" || e.key === "Escape" || e.key.startsWith("Arrow") || e.key.length === 1) {
      if (e.key === "Tab" || e.key === "Backspace") {
        e.preventDefault();
      }
      try {
        const res = await rpc.call("send_key", { key: e.key, code: e.code, tabId: status.activeTabId });
        if (res.screenshot) {
          setStatus((prev) => ({ ...prev, screenshot: res.screenshot }));
        }
      } catch {}
    }
  };

  const handleSendFloatingText = async () => {
    if (!floatingText) return;
    setIsLoading(true);
    try {
      const res = await rpc.call("type_text", { text: floatingText, tabId: status.activeTabId });
      if (res.screenshot) {
        setStatus((prev) => ({ ...prev, screenshot: res.screenshot }));
      }
      setFloatingText("");
    } catch {} finally {
      setIsLoading(false);
    }
  };

  const fetchDevToolsContent = async (format: "text" | "html" | "links" | "snapshot") => {
    setDevToolsTab(format === "html" ? "elements" : format === "snapshot" ? "snapshot" : "text");
    try {
      const res = await rpc.call("get_content", { format, tabId: status.activeTabId });
      if (res.ok) {
        setTextContent(res.content);
      }
    } catch (err: any) {
      setTextContent(`Error: ${err}`);
    }
  };

  const handleEvaluate = async () => {
    if (!evalInput) return;
    try {
      const res = await rpc.call("evaluate", { expression: evalInput, tabId: status.activeTabId });
      setEvalResult(res.result ?? String(res.error));
    } catch (err: any) {
      setEvalResult(`Error: ${err}`);
    }
  };

  const bookmarks = [
    { title: "Google", url: "https://www.google.com", icon: <SvgSearch className="w-3 h-3 text-muted-foreground" /> },
    { title: "Hacker News", url: "https://news.ycombinator.com", icon: <SvgHackerNews className="w-3 h-3" /> },
    { title: "GitHub", url: "https://github.com", icon: <SvgGithub className="w-3 h-3 text-foreground" /> },
    { title: "Patchright Repo", url: "https://github.com/Kaliiiiiiiiii-tools/patchright", icon: <SvgShield className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> },
    { title: "Wikipedia", url: "https://en.wikipedia.org", icon: <SvgBook className="w-3 h-3 text-muted-foreground" /> },
  ];

  return (
    <div
      tabIndex={0}
      onKeyDown={handleViewportKeyDown}
      className="flex flex-col h-full w-full bg-background text-foreground font-sans text-xs select-none outline-none"
    >
      {/* ============================================================ */}
      {/* 1. TOP TAB STRIP (Multi-Tab Browser Chrome)                  */}
      {/* ============================================================ */}
      <div className="flex items-center justify-between px-2 pt-1.5 pb-0 bg-background border-b border-border select-none">
        {/* Tab strip: Renders ALL active tabs */}
        <div className="flex items-end gap-1 flex-1 overflow-x-auto scrollbar-none pr-2">
          {status.tabs.map((tab) => {
            const isActive = tab.id === status.activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => handleSwitchTab(tab.id)}
                className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-t-lg max-w-[220px] min-w-[120px] shadow-sm border-t border-x cursor-pointer transition-colors ${
                  isActive
                    ? "bg-card text-foreground border-border font-medium"
                    : "bg-card hover:bg-accent text-muted-foreground border-transparent hover:text-foreground"
                }`}
              >
                {/* Favicon or Spinner */}
                {tab.isLoading ? (
                  <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
                ) : (
                  <SvgGlobe className="w-3 h-3 shrink-0 text-muted-foreground" />
                )}

                {/* Title */}
                <span className="truncate text-xs flex-1">
                  {tab.title || "New Tab"}
                </span>

                {/* Close tab icon */}
                <button
                  onClick={(e) => handleCloseTab(e, tab.id)}
                  title="Close tab"
                  className={`p-0.5 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-opacity ${
                    isActive ? "opacity-70 group-hover:opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <SvgClose className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}

          {/* New Tab (+) Button */}
          <button
            onClick={() => handleNewTab()}
            title="Open new tab"
            className="p-1 px-2.5 mb-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-sm font-bold flex items-center justify-center"
          >
            <SvgPlus className="w-3 h-3" />
          </button>
        </div>

        {/* Right Controls: Stealth mode, Browser engine status */}
        <div className="flex items-center gap-2 pb-1 shrink-0">
          <button
            onClick={() => {
              const newStealth = !status.stealth;
              setStatus((p) => ({ ...p, stealth: newStealth }));
              handleNavigate();
            }}
            title={status.stealth ? "Stealth Mode active (Anti-detect enabled)" : "Click to enable Stealth Mode"}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium transition-colors ${
              status.stealth
                ? "bg-purple-500/10 border-purple-500/40 text-purple-600 dark:text-purple-300 shadow-sm"
                : "bg-muted/80 border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <SvgGlasses className="w-3.5 h-3.5" />
            <span>{status.stealth ? "Stealth ON" : "Stealth"}</span>
          </button>

          {/* Browser Engine Dropdown Selector */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-muted/90 rounded-md border border-border text-[11px] font-sans shadow-sm">
            <span className={`w-2 h-2 rounded-full shrink-0 ${status.running ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
            <span className="text-muted-foreground text-[11px] font-medium shrink-0">Браузер:</span>
            <select
              value={status.engine || "patchright"}
              onChange={async (e) => {
                const targetEngine = e.target.value as "patchright" | "chrome";
                try {
                  setIsLoading(true);
                  const res = await rpc.call("switch_engine", { engine: targetEngine });
                  setStatus(res);
                  setUrlInput(res.currentUrl);
                } catch (err: any) {
                  setStatus((p: any) => ({ ...p, error: String(err) }));
                } finally {
                  setIsLoading(false);
                }
              }}
              className="bg-transparent text-foreground text-xs font-medium focus:outline-none cursor-pointer py-0.5 pr-1 hover:text-foreground"
            >
              <option value="patchright" className="bg-card text-emerald-600 dark:text-emerald-300 font-semibold">
                Patchright + Chrome (Stealth / Anti-Detect)
              </option>
              <option value="chrome" className="bg-card text-primary font-semibold">
                Google Chrome (Standard Chromium)
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2. CHROME NAVIGATION & SMART OMNIBOX TOOLBAR                 */}
      {/* ============================================================ */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border/50 shadow-sm">
        {/* Navigation buttons: Back, Forward, Reload */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleBack}
            disabled={!status.canGoBack || isLoading}
            title="Back"
            className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
              status.canGoBack && !isLoading
                ? "hover:bg-accent text-foreground"
                : "opacity-40 text-muted-foreground cursor-default"
            }`}
          >
            <SvgArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleForward}
            disabled={!status.canGoForward || isLoading}
            title="Forward"
            className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
              status.canGoForward && !isLoading
                ? "hover:bg-accent text-foreground"
                : "opacity-40 text-muted-foreground cursor-default"
            }`}
          >
            <SvgArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleReload}
            title="Reload"
            className={`w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent text-foreground transition-colors ${
              isLoading ? "animate-spin text-primary" : ""
            }`}
          >
            <SvgRefresh className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Smart Omnibox (Search Google or Type URL) */}
        <div className="flex-1 flex items-center gap-2 px-3 py-1 bg-background hover:bg-muted focus-within:bg-muted border border-border focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/50 rounded-full transition-all">
          <SvgLock className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />

          <input
            ref={omniboxRef}
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleNavigate();
                omniboxRef.current?.blur();
              }
            }}
            onFocus={(e) => e.target.select()}
            placeholder="Search with Google or enter web address..."
            className="w-full bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground font-sans"
          />

          {urlInput && (
            <button
              onClick={() => setUrlInput("")}
              className="text-muted-foreground hover:text-foreground text-xs px-1"
              title="Clear"
            >
              <SvgClose className="w-2.5 h-2.5" />
            </button>
          )}
          <span className="text-muted-foreground hover:text-amber-600 hover:dark:text-amber-400 cursor-pointer text-xs" title="Bookmark">
            <SvgStar className="w-3 h-3" />
          </span>
        </div>

        {/* Right Toolbar Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setFloatingTypeOpen(!floatingTypeOpen)}
            title="Toggle input bar"
            className={`px-2 py-1 rounded text-xs border transition-colors flex items-center gap-1.5 ${
              floatingTypeOpen
                ? "bg-primary border-primary text-primary-foreground"
                : "bg-muted hover:bg-accent border-border text-foreground"
            }`}
          >
            <SvgKeyboard className="w-3.5 h-3.5" />
            <span>Type</span>
          </button>

          <button
            onClick={() => setDevToolsOpen(!devToolsOpen)}
            title="Inspect / DevTools (Console, Elements, Snapshot)"
            className={`px-2 py-1 rounded text-xs border transition-colors flex items-center gap-1.5 ${
              devToolsOpen
                ? "bg-primary border-primary text-primary-foreground"
                : "bg-muted hover:bg-accent border-border text-foreground"
            }`}
          >
            <SvgWrench className="w-3.5 h-3.5" />
            <span>DevTools</span>
          </button>

          <button
            onClick={() => setShowBookmarks(!showBookmarks)}
            title="Toggle bookmarks bar"
            className={`w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ${
              showBookmarks ? "text-primary" : ""
            }`}
          >
            <SvgStar className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 3. BOOKMARKS BAR                                             */}
      {/* ============================================================ */}
      {showBookmarks && (
        <div className="flex items-center gap-2 px-3 py-1 bg-card border-b border-border/50 text-[11px] text-foreground overflow-x-auto scrollbar-none shrink-0">
          {bookmarks.map((bm) => (
            <button
              key={bm.url}
              onClick={() => {
                setUrlInput(bm.url);
                handleNavigate(bm.url);
              }}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-accent text-foreground hover:text-foreground transition-colors shrink-0"
            >
              <span>{bm.icon}</span>
              <span>{bm.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* Floating Type Capsule (if open) */}
      {floatingTypeOpen && (
        <div className="bg-card border-b border-primary/50 px-3 py-1.5 flex items-center gap-2 shadow-lg shrink-0">
          <span className="text-muted-foreground text-xs shrink-0">Send input to page:</span>
          <input
            type="text"
            value={floatingText}
            onChange={(e) => setFloatingText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSendFloatingText();
            }}
            placeholder="Type text and press Enter..."
            autoFocus
            className="flex-1 bg-muted border border-border rounded px-2.5 py-1 text-xs text-foreground outline-none font-sans"
          />
          <button
            onClick={handleSendFloatingText}
            className="px-3 py-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-xs font-medium"
          >
            Send
          </button>
          <div className="flex items-center gap-1 text-xs pl-2 border-l border-border">
            <button
              onClick={() => rpc.call("send_key", { key: "Enter", tabId: status.activeTabId }).then(refreshStatus)}
              className="px-2 py-0.5 bg-muted hover:bg-accent text-foreground rounded border border-border flex items-center gap-1"
            >
              <SvgEnter className="w-2.5 h-2.5" />
              <span>Enter</span>
            </button>
            <button
              onClick={() => rpc.call("send_key", { key: "Tab", tabId: status.activeTabId }).then(refreshStatus)}
              className="px-2 py-0.5 bg-muted hover:bg-accent text-foreground rounded border border-border flex items-center gap-1"
            >
              <SvgTab className="w-2.5 h-2.5" />
              <span>Tab</span>
            </button>
            <button
              onClick={() => rpc.call("send_key", { key: "Escape", tabId: status.activeTabId }).then(refreshStatus)}
              className="px-2 py-0.5 bg-muted hover:bg-accent text-foreground rounded border border-border"
            >
              Esc
            </button>
            <button
              onClick={() => setFloatingTypeOpen(false)}
              className="text-muted-foreground hover:text-foreground px-1 ml-1"
            >
              <SvgClose className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      )}

      {/* Error alert banner */}
      {status.error && (
        <div className="bg-destructive/10 border-b border-destructive/30 text-destructive px-3 py-1 text-xs flex items-center justify-between shrink-0">
          <span className="flex items-center gap-1.5">
            <SvgAlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{status.error}</span>
          </span>
          <button onClick={() => setStatus((p) => ({ ...p, error: null }))} className="text-destructive hover:text-foreground">
            <SvgClose className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* 4. MAIN BROWSER VIEWPORT (EDGE-TO-EDGE)                       */}
      {/* ============================================================ */}
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        className="flex-1 w-full h-full overflow-y-auto bg-white relative flex flex-col"
        style={{ scrollBehavior: "smooth" }}
      >
        {status.screenshot ? (
          <img
            ref={imgRef}
            src={status.screenshot}
            alt={status.currentTitle}
            onClick={handleImageClick}
            title="Click anywhere to interact with the webpage"
            className="w-full h-auto block select-none cursor-pointer"
            style={{
              imageRendering: "auto",
              minHeight: "100%",
            }}
          />
        ) : (
          <div className="flex-1 w-full flex flex-col items-center justify-center bg-background text-muted-foreground p-8">
            <SvgGlobe className="w-10 h-10 mb-3 text-muted-foreground" />
            <p className="text-base font-semibold text-foreground">New Tab</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm text-center">
              Type a search query or URL in the address bar above.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setUrlInput("https://www.google.com");
                  handleNavigate("https://www.google.com");
                }}
                className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-xs font-medium"
              >
                Open Google
              </button>
              <button
                onClick={() => {
                  setUrlInput("https://news.ycombinator.com");
                  handleNavigate("https://news.ycombinator.com");
                }}
                className="px-3 py-1.5 bg-muted hover:bg-accent text-foreground rounded text-xs"
              >
                Hacker News
              </button>
            </div>
          </div>
        )}

        {/* Loading overlay indicator */}
        {isLoading && (
          <div className="absolute top-2 right-4 bg-card/90 text-foreground border border-border px-3 py-1 rounded-full shadow-lg flex items-center gap-2 backdrop-blur-sm pointer-events-none">
            <span className="w-2.5 h-2.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-[11px] font-medium">Loading...</span>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* 5. INTEGRATED CHROME DEVTOOLS DRAWER                         */}
      {/* ============================================================ */}
      {devToolsOpen && (
        <div className="h-64 border-t border-border bg-card flex flex-col shadow-2xl shrink-0">
          <div className="flex items-center justify-between px-2 bg-card border-b border-border/50 text-xs">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-muted-foreground mr-2 text-[11px] uppercase tracking-wider">
                DevTools
              </span>
              <button
                onClick={() => setDevToolsTab("console")}
                className={`px-3 py-1 font-medium transition-colors border-b-2 ${
                  devToolsTab === "console"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Console
              </button>
              <button
                onClick={() => fetchDevToolsContent("snapshot")}
                className={`px-3 py-1 font-medium transition-colors border-b-2 ${
                  devToolsTab === "snapshot"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Elements Snapshot (9999%)
              </button>
              <button
                onClick={() => fetchDevToolsContent("text")}
                className={`px-3 py-1 font-medium transition-colors border-b-2 ${
                  devToolsTab === "text"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Page Text
              </button>
              <button
                onClick={() => fetchDevToolsContent("html")}
                className={`px-3 py-1 font-medium transition-colors border-b-2 ${
                  devToolsTab === "elements"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Elements (HTML)
              </button>
              <button
                onClick={() => setDevToolsTab("settings")}
                className={`px-3 py-1 font-medium transition-colors border-b-2 ${
                  devToolsTab === "settings"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Engine Info
              </button>
            </div>
            <button
              onClick={() => setDevToolsOpen(false)}
              className="text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-accent"
              title="Close DevTools"
            >
              <SvgClose className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 p-2 overflow-auto font-mono text-xs text-foreground">
            {devToolsTab === "console" && (
              <div className="h-full flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-primary font-bold">&gt;</span>
                  <input
                    type="text"
                    value={evalInput}
                    onChange={(e) => setEvalInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEvaluate();
                    }}
                    placeholder="Evaluate JavaScript expression (e.g. document.title, location.href)..."
                    className="flex-1 bg-muted border border-border rounded px-2.5 py-1 text-foreground outline-none"
                  />
                  <button
                    onClick={handleEvaluate}
                    className="px-2.5 py-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-xs font-sans"
                  >
                    Run
                  </button>
                </div>
                <pre className="flex-1 bg-muted p-2 rounded border border-border overflow-auto text-emerald-600 dark:text-emerald-400 whitespace-pre-wrap">
                  {evalResult || "<undefined> (type expression above and press Enter)"}
                </pre>
              </div>
            )}

            {(devToolsTab === "text" || devToolsTab === "elements" || devToolsTab === "snapshot") && (
              <div className="h-full flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-muted-foreground font-sans text-[11px]">
                  <span>{devToolsTab === "snapshot" ? "AI Interactive Elements Tree" : `Extracted ${devToolsTab}`}:</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(textContent)}
                    className="px-2 py-0.5 bg-muted hover:bg-accent text-foreground rounded border border-border flex items-center gap-1.5"
                  >
                    <SvgCopy className="w-3 h-3" />
                    <span>Copy to clipboard</span>
                  </button>
                </div>
                <textarea
                  readOnly
                  value={textContent}
                  className="flex-1 bg-muted text-foreground p-2 rounded border border-border resize-none outline-none leading-relaxed"
                />
              </div>
            )}

            {devToolsTab === "settings" && (
              <div className="p-2 space-y-2 font-sans text-xs">
                <div className="text-sm font-semibold text-foreground">Patchright Engine Status</div>
                <div className="bg-muted p-3 rounded border border-border space-y-1 font-mono text-[11px]">
                  <div>Engine: <span className="text-emerald-600 dark:text-emerald-400">Patchright + Google Chrome</span> (v{status.version})</div>
                  <div>CDP Port: <span className="text-primary">{status.port}</span></div>
                  <div>WebSocket: <span className="text-foreground">ws://127.0.0.1:{status.port}/devtools/browser</span></div>
                  <div>Active Tabs: <span className="text-emerald-600 dark:text-emerald-400">{status.tabs.length}</span></div>
                  <div>Status: <span className={status.running ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{status.running ? "Active & Connected" : "Connecting..."}</span></div>
                </div>
                <button
                  onClick={() => rpc.call("restart_engine").then(refreshStatus)}
                  className="px-3 py-1.5 bg-muted hover:bg-accent text-foreground rounded border border-border text-xs mt-2"
                >
                  Restart Browser Engine
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 6. MINIMAL CHROME STATUS BAR                                 */}
      {/* ============================================================ */}
      <div className="px-3 py-0.5 bg-background border-t border-border text-[11px] text-muted-foreground flex items-center justify-between select-none shrink-0">
        <span className="truncate max-w-[60%]">{status.currentUrl}</span>
        <div className="flex items-center gap-3 text-muted-foreground">
          <span>{status.currentTitle}</span>
          <span className="text-emerald-600 dark:text-emerald-500 font-mono inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            Tab {status.activeTabId}
          </span>
        </div>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  // 1. Sidebar Nav Panel: Browser
  app.slots.navPanel({
    id: "browser-choice",
    title: "Browser",
    icon: "Globe",
    path: "browser-choice",
    component: BrowserView,
  });

  // 2. Thread Panel Tab: Side-by-side with thread chat
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "browser-choice",
    title: "Browser",
    icon: "Globe",
    layout: "flush",
    component: BrowserView,
  });
});
