import { memo, useEffect, useMemo, useState } from "react";
import { type GcThreadContextResult, type ThreadId, parseGcMeta } from "@t3tools/contracts";
import { useStore } from "../store";
import { readNativeApi } from "../nativeApi";
import GcContextSidebar from "./GcContextSidebar";

interface GcPanelProps {
  threadId: ThreadId;
}

const GcPanel = memo(function GcPanel({ threadId }: GcPanelProps) {
  const thread = useStore((store) => store.threads.find((entry) => entry.id === threadId) ?? null);
  const gcMeta = useMemo(
    () => parseGcMeta(thread?.customMetadata),
    [thread?.customMetadata],
  );

  const [threadContext, setThreadContext] = useState<GcThreadContextResult | null>(null);

  useEffect(() => {
    if (!gcMeta.isGcManaged) return;
    const api = readNativeApi();
    if (!api) return;
    let cancelled = false;
    api.gc
      ?.getThreadContext({ threadId })
      .then((result) => {
        if (!cancelled) setThreadContext(result);
      })
      .catch(() => {
        // GC API unavailable — sidebar falls back to metadata-only display
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, gcMeta.isGcManaged]);

  if (!thread?.customMetadata || !gcMeta.isGcManaged) {
    return null;
  }

  return (
    <GcContextSidebar
      metadata={thread.customMetadata}
      threadContext={threadContext}
    />
  );
});

export default GcPanel;
