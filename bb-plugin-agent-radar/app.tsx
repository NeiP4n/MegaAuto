import React, { useEffect, useState, useCallback } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { AgentRadarStatus } from "./src/types";
import { RadarOverlay } from "./src/components/RadarOverlay";
import { RadarSegment } from "./src/components/RadarSegment";
import { RadarNavPanel } from "./src/components/RadarNavPanel";

// Global hook for polling radar status across all mounted slots
function useRadarStatus() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<AgentRadarStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await rpc.call("get_radar_status", {});
      if (res) {
        setStatus(res);
      }
    } catch {
      // ignore
    }
  }, [rpc]);

  useEffect(() => {
    fetchStatus();
    // 1.5s live polling interval for instant feedback
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { status, isLoading, refresh: fetchStatus };
}

// 1. App Overlay Wrapper
function AppOverlayView() {
  const { status, refresh } = useRadarStatus();
  return <RadarOverlay status={status} onRefresh={refresh} />;
}

// 2. Thread Composer Context Segment Wrapper
function ThreadContextSegmentSummary(props: any) {
  const { status } = useRadarStatus();
  return <RadarSegment status={status} isExpanded={props.isExpanded} onToggle={props.onToggle} />;
}

// 3. Nav Panel & Thread Tab View
function NavPanelView() {
  const { status, isLoading, refresh } = useRadarStatus();
  return <RadarNavPanel status={status} isLoading={isLoading} onRefresh={refresh} />;
}

export default definePluginApp((app) => {
  // 1. Floating App Overlay (visible everywhere in the app)
  app.slots.experimental_appOverlay({
    id: "agent-radar-hud",
    component: AppOverlayView,
  });

  // 2. Composer Context Segment (visible directly above the prompt input)
  app.slots.experimental_threadContextSegment({
    id: "agent-radar-segment",
    title: "Радар занятости ИИ",
    group: "agent-radar",
    order: 0,
    summary: ThreadContextSegmentSummary,
  });

  // 3. Left Navigation Bar Panel
  app.slots.navPanel({
    id: "agent-radar",
    title: "Agent Radar",
    icon: "Activity",
    path: "agent-radar",
    component: NavPanelView,
  });

  // 4. Thread Header Tab
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "agent-radar",
    title: "Agent Radar",
    icon: "Activity",
    layout: "flush",
    component: NavPanelView,
  });
});
