import React, { useEffect, useState, useCallback } from "react";
import { definePluginApp, useRpc, useComposer } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { AgentRadarStatus } from "./src/types";
import { ComposerStatusBanner } from "./src/components/ComposerStatusBanner";
import { RadarNavPanel } from "./src/components/RadarNavPanel";

function useRadarStatus(threadId?: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<AgentRadarStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await rpc.call("get_radar_status", { threadId });
      if (res) {
        setStatus(res);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [rpc, threadId]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { status, isLoading, refresh: fetchStatus };
}

// Composer Banner Wrapper (renders natively directly inside the chat prompt card)
function ComposerStatusBannerWrapper() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : undefined;
  const { status } = useRadarStatus(threadId);
  return <ComposerStatusBanner status={status} />;
}

// Left Nav Panel
function NavPanelView() {
  const { status, isLoading, refresh } = useRadarStatus();
  return <RadarNavPanel status={status} isLoading={isLoading} onRefresh={refresh} />;
}

// Thread Tab (receives threadId from context props)
function ThreadTabView({ threadId }: { threadId?: string }) {
  const { status, isLoading, refresh } = useRadarStatus(threadId);
  return <RadarNavPanel status={status} isLoading={isLoading} onRefresh={refresh} />;
}

export default definePluginApp((app) => {
  // 1. Native Composer Customization (renders seamlessly inside the prompt input box)
  app.composer.customize({
    id: "agent-status",
    scopes: ["thread"],
    banners: [
      {
        id: "status-strip",
        chrome: "bare",
        component: ComposerStatusBannerWrapper,
      },
    ],
  });

  // 2. Left Navigation Bar Panel
  app.slots.navPanel({
    id: "agent-radar",
    title: "Agent Radar",
    icon: "Terminal",
    path: "agent-radar",
    component: NavPanelView,
  });

  // 3. Thread Tab
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "agent-radar",
    title: "Agent Radar",
    icon: "Terminal",
    layout: "flush",
    component: ThreadTabView,
  });
});
