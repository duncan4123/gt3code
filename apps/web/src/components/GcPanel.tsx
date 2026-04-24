import { memo, useEffect, useMemo, useState } from "react";
import {
  type EnvironmentId,
  type GcThreadContextResult,
  type ThreadId,
  parseGcMeta,
} from "@t3tools/contracts";
import { readLocalApi } from "../localApi";
import type { Thread, ThreadShell } from "../types";
import GcContextSidebar from "./GcContextSidebar";

interface GcPanelProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  thread: Pick<Thread | ThreadShell, "customMetadata"> | null | undefined;
}

const GcPanel = memo(function GcPanel({ environmentId, threadId, thread }: GcPanelProps) {
  const gcMeta = useMemo(() => parseGcMeta(thread?.customMetadata), [thread?.customMetadata]);
  const gcContextSignature = [
    gcMeta.bead ?? "",
    gcMeta.convoy ?? "",
    gcMeta.formula ?? "",
    gcMeta.molecule ?? "",
  ].join("|");

  const [threadContext, setThreadContext] = useState<GcThreadContextResult | null>(null);

  useEffect(() => {
    setThreadContext(null);
    if (!gcMeta.isGcManaged) return;
    const api = readLocalApi();
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
  }, [environmentId, threadId, gcMeta.isGcManaged, gcContextSignature]);

  if (!thread?.customMetadata || !gcMeta.isGcManaged) {
    return null;
  }

  return <GcContextSidebar metadata={thread.customMetadata} threadContext={threadContext} />;
});

export default GcPanel;
