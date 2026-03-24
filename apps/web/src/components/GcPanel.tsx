import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { type GcThreadContextResult, type ThreadId } from "@t3tools/contracts";

import { useStore } from "../store";
import { readNativeApi } from "../nativeApi";
import { deriveGcTimelineEvents, deriveWorkedBeadHistory } from "../session-logic";
import { getGcMetadata } from "./Sidebar.logic";
import GcContextSidebar from "./GcContextSidebar";

interface GcPanelProps {
  threadId: ThreadId;
}

const GcPanel = memo(function GcPanel({ threadId }: GcPanelProps) {
  const thread = useStore((store) => store.threads.find((entry) => entry.id === threadId) ?? null);
  const gcMetadata = getGcMetadata(thread?.customMetadata);
  const gcTimelineEvents = useMemo(
    () => deriveGcTimelineEvents(thread?.activities ?? []),
    [thread?.activities],
  );
  const workedBeads = useMemo(() => deriveWorkedBeadHistory(gcTimelineEvents), [gcTimelineEvents]);

  const [threadContext, setThreadContext] = useState<GcThreadContextResult | null>(null);

  useEffect(() => {
    if (!gcMetadata.isGcManaged) return;
    const api = readNativeApi();
    if (!api) return;
    let cancelled = false;
    api.gc
      .getThreadContext({ threadId })
      .then((result) => {
        if (!cancelled) setThreadContext(result);
      })
      .catch(() => {
        // GC API unavailable — sidebar falls back to metadata-only display
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, gcMetadata.isGcManaged]);

  const handleSelectWorkedBead = useCallback((sourceEventId: string) => {
    const target = document.querySelector<HTMLElement>(`[data-gc-event-id="${sourceEventId}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  if (!thread?.customMetadata || !gcMetadata.isGcManaged) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No GC context is available for this thread.
      </div>
    );
  }

  return (
    <GcContextSidebar
      metadata={thread.customMetadata}
      workedBeads={workedBeads}
      onSelectWorkedBead={handleSelectWorkedBead}
      threadContext={threadContext}
      gcEvents={gcTimelineEvents}
    />
  );
});

export default GcPanel;
