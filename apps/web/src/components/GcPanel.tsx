import { memo } from "react";
import { parseGcMeta, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import type { Thread, ThreadShell } from "../types";
import GcContextSidebar from "./GcContextSidebar";
import { useGcThreadContext } from "../lib/gcThreadContext";

interface GcPanelProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  thread: Pick<Thread | ThreadShell, "customMetadata"> | null | undefined;
}

const GcPanel = memo(function GcPanel({ threadId, thread }: GcPanelProps) {
  const gcMeta = parseGcMeta(thread?.customMetadata);
  const threadContext = useGcThreadContext({
    threadId,
    customMetadata: thread?.customMetadata,
  });

  if (!thread?.customMetadata || !gcMeta.isGcManaged) {
    return null;
  }

  return <GcContextSidebar metadata={thread.customMetadata} threadContext={threadContext} />;
});

export default GcPanel;
