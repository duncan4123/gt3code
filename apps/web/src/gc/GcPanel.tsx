import { memo } from "react";
import { parseGcMeta, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import type { Thread, ThreadShell } from "../types";
import GcContextSidebar from "./GcContextSidebar";
import { useGcThreadContext } from "./gcThreadContext";

interface GcPanelProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  thread: Pick<Thread | ThreadShell, "customMetadata"> | null | undefined;
}

const GcPanel = memo(function GcPanel({ threadId, thread }: GcPanelProps) {
  const customMetadata = thread?.customMetadata;
  const gcMeta = parseGcMeta(customMetadata);
  const threadContext = useGcThreadContext({
    threadId,
    customMetadata,
  });

  if (!customMetadata || !gcMeta.isGcManaged) {
    return null;
  }

  return <GcContextSidebar metadata={customMetadata} threadContext={threadContext} />;
});

export default GcPanel;
