import { useEffect, useMemo, useState } from "react";
import { parseGcMeta, type GcThreadContextResult, type ThreadId } from "@t3tools/contracts";
import { readLocalApi } from "../localApi";

export function metadataValue(
  metadata: Readonly<Record<string, string>> | undefined,
  keys: readonly string[],
): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function resolveGcBeadGitContext(threadContext: GcThreadContextResult | null): {
  branch: string | null;
  worktreePath: string | null;
} {
  const metadata = threadContext?.bead?.metadata;
  return {
    branch: metadataValue(metadata, ["branch", "source_branch", "git_branch"]),
    worktreePath: metadataValue(metadata, ["work_dir", "worktree", "worktree_path"]),
  };
}

export function useGcThreadContext(input: {
  threadId: ThreadId;
  customMetadata: Readonly<Record<string, string>> | undefined;
}): GcThreadContextResult | null {
  const gcMeta = useMemo(() => parseGcMeta(input.customMetadata), [input.customMetadata]);
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
    const refreshThreadContext = () => {
      api.gc
        ?.getThreadContext({ threadId: input.threadId })
        .then((result) => {
          if (!cancelled) setThreadContext(result);
        })
        .catch(() => {
          // GC can be stopped independently; metadata-only rendering still works.
        });
    };

    refreshThreadContext();
    const refreshInterval = window.setInterval(refreshThreadContext, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
    };
  }, [gcMeta.isGcManaged, gcContextSignature, input.threadId]);

  return threadContext;
}
