import type {
  GcPeekThreadMessagesInput,
  GcPeekThreadMessagesResult,
  OrchestrationReadModel,
  OrchestrationSearchThreadMessagesResult,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { parseGcMeta } from "@t3tools/contracts";

interface PeekTarget {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly agent?: string;
  readonly rig?: string;
  readonly sessionName?: string;
}

function isThreadSearchable(thread: OrchestrationReadModel["threads"][number]): boolean {
  return thread.deletedAt === null && thread.archivedAt === null;
}

export function resolveGcPeekTargets(
  snapshot: OrchestrationReadModel,
  input: Pick<GcPeekThreadMessagesInput, "agent" | "sessionName">,
): ReadonlyArray<PeekTarget> {
  const matches = snapshot.threads.flatMap((thread) => {
    if (!isThreadSearchable(thread)) {
      return [];
    }
    const meta = parseGcMeta(thread.customMetadata);
    if (!meta.isGcManaged) {
      return [];
    }
    if (input.sessionName && meta.sessionName !== input.sessionName) {
      return [];
    }
    if (input.agent && meta.agent !== input.agent) {
      return [];
    }
    return [
      {
        threadId: thread.id,
        projectId: thread.projectId,
        ...(meta.agent ? { agent: meta.agent } : {}),
        ...(meta.rig ? { rig: meta.rig } : {}),
        ...(meta.sessionName ? { sessionName: meta.sessionName } : {}),
      } satisfies PeekTarget,
    ];
  });

  const deduped = new Map<ThreadId, PeekTarget>();
  for (const match of matches) {
    deduped.set(match.threadId, match);
  }
  return [...deduped.values()];
}

export function mergeGcPeekHits(
  targets: ReadonlyArray<PeekTarget>,
  perThreadResults: ReadonlyArray<OrchestrationSearchThreadMessagesResult>,
  limit: number,
): GcPeekThreadMessagesResult {
  const byThreadId = new Map(targets.map((target) => [target.threadId, target] as const));
  const results = perThreadResults
    .flatMap((result) => result.results)
    .flatMap((hit) => {
      const target = byThreadId.get(hit.threadId);
      if (!target) {
        return [];
      }
      return [
        {
          threadId: hit.threadId,
          projectId: target.projectId,
          snippet: hit.snippet,
          ...(target.agent ? { agent: target.agent } : {}),
          ...(target.rig ? { rig: target.rig } : {}),
          ...(target.sessionName ? { sessionName: target.sessionName } : {}),
        },
      ];
    })
    .slice(0, limit);

  return { results };
}

export function previewGcPeekTargets(
  snapshot: OrchestrationReadModel,
  targets: ReadonlyArray<PeekTarget>,
  limit: number,
): GcPeekThreadMessagesResult {
  const results = targets.flatMap((target) => {
    const thread = snapshot.threads.find((candidate) => candidate.id === target.threadId);
    if (!thread) {
      return [];
    }
    const snippets = [...thread.messages]
      .filter((message) => message.text.trim().length > 0)
      .toReversed()
      .slice(0, Math.max(limit, 1))
      .map((message) => ({
        threadId: target.threadId,
        projectId: target.projectId,
        snippet: message.text,
        ...(target.agent ? { agent: target.agent } : {}),
        ...(target.rig ? { rig: target.rig } : {}),
        ...(target.sessionName ? { sessionName: target.sessionName } : {}),
      }));
    return snippets;
  });

  return { results };
}
