/**
 * Gas City integration types.
 *
 * These schemas define the gc.* customMetadata keys that the t3bridge
 * provider sets on OrchestrationThread via thread.meta.update, and
 * the activity kinds it dispatches via thread.activity.append.
 *
 * Source of truth: gascity/internal/runtime/t3bridge/provider.go
 */
import * as Schema from "effect/Schema";

// ---------------------------------------------------------------------------
// gc.* metadata keys (set on OrchestrationThread.customMetadata)
// ---------------------------------------------------------------------------

/** Parsed gc.* metadata from a thread's customMetadata record. */
export const GcThreadMeta = Schema.Struct({
  /** Whether this thread is managed by Gas City. */
  isGcManaged: Schema.Boolean,
  /** Agent qualified name (e.g. "t3code/polecat"). */
  agent: Schema.optional(Schema.String),
  /** Rig name. */
  rig: Schema.optional(Schema.String),
  /** City name. */
  city: Schema.optional(Schema.String),
  /** Current bead ID. */
  bead: Schema.optional(Schema.String),
  /** Current bead title. */
  beadTitle: Schema.optional(Schema.String),
  /** Convoy ID. */
  convoy: Schema.optional(Schema.String),
  /** Convoy title. */
  convoyTitle: Schema.optional(Schema.String),
  /** Convoy status (open/closed). */
  convoyStatus: Schema.optional(Schema.String),
  /** Number of closed beads in convoy. */
  convoyClosedCount: Schema.optional(Schema.String),
  /** Total beads in convoy. */
  convoyTotalCount: Schema.optional(Schema.String),
  /** Session provider (e.g. "exec:gc-session-t3"). */
  provider: Schema.optional(Schema.String),
  /** Runtime provider kind (e.g. "codex", "claudeAgent"). */
  runtimeProvider: Schema.optional(Schema.String),
  /** Session state (active/archived). */
  state: Schema.optional(Schema.String),
  /** Molecule ID (formula instance). */
  molecule: Schema.optional(Schema.String),
  /** Formula name. */
  formula: Schema.optional(Schema.String),
});
export type GcThreadMeta = typeof GcThreadMeta.Type;

/** Extract GcThreadMeta from a raw customMetadata record. */
export function parseGcMeta(customMetadata?: Record<string, string>): GcThreadMeta {
  if (!customMetadata || !customMetadata["gc.agent"]) {
    return {
      isGcManaged: false,
      agent: undefined,
      rig: undefined,
      city: undefined,
      bead: undefined,
      beadTitle: undefined,
      convoy: undefined,
      convoyTitle: undefined,
      convoyStatus: undefined,
      convoyClosedCount: undefined,
      convoyTotalCount: undefined,
      provider: undefined,
      runtimeProvider: undefined,
      state: undefined,
      molecule: undefined,
      formula: undefined,
    };
  }
  return {
    isGcManaged: true,
    agent: customMetadata["gc.agent"],
    rig: customMetadata["gc.rig"],
    city: customMetadata["gc.city"],
    bead: customMetadata["gc.bead"],
    beadTitle: customMetadata["gc.beadTitle"],
    convoy: customMetadata["gc.convoy"],
    convoyTitle: customMetadata["gc.convoyTitle"],
    convoyStatus: customMetadata["gc.convoyStatus"],
    convoyClosedCount: customMetadata["gc.convoyClosedCount"],
    convoyTotalCount: customMetadata["gc.convoyTotalCount"],
    provider: customMetadata["gc.provider"],
    runtimeProvider: customMetadata["gc.runtimeProvider"],
    state: customMetadata["gc.state"],
    molecule: customMetadata["gc.molecule"],
    formula: customMetadata["gc.formula"],
  };
}

// ---------------------------------------------------------------------------
// GC activity kinds (dispatched via thread.activity.append)
// ---------------------------------------------------------------------------

/** Activity kinds the t3bridge provider dispatches. */
export const GcActivityKind = {
  SessionStarted: "gc.session.started",
  SessionReused: "gc.session.reused",
  StateChanged: "gc.state.changed",
  BeadClaimed: "gc.bead.claimed",
  BeadClosed: "gc.bead.closed",
  PromptSent: "gc.prompt.sent",
  NudgeSent: "gc.nudge.sent",
} as const;
export type GcActivityKind = (typeof GcActivityKind)[keyof typeof GcActivityKind];

/** Check if an activity kind is a GC activity. */
export function isGcActivityKind(kind: string): kind is GcActivityKind {
  return Object.values(GcActivityKind).includes(kind as GcActivityKind);
}

// ---------------------------------------------------------------------------
// Convoy grouping (for sidebar virtual folders)
// ---------------------------------------------------------------------------

/** A virtual convoy group for sidebar thread grouping. */
export interface VirtualConvoyGroup<TThread> {
  id: string;
  label: string;
  status: string | undefined;
  closedCount: number | null;
  totalCount: number | null;
  threads: TThread[];
}

/** Partition threads into convoy groups and standalone threads. */
export function groupThreadsByConvoy<TThread extends { customMetadata?: Record<string, string> }>(
  threads: TThread[],
): {
  standaloneThreads: TThread[];
  convoyGroups: VirtualConvoyGroup<TThread>[];
} {
  const standaloneThreads: TThread[] = [];
  const convoyGroupsById = new Map<string, VirtualConvoyGroup<TThread>>();

  for (const thread of threads) {
    const meta = parseGcMeta(thread.customMetadata);
    const convoyId = meta.convoy?.trim();
    if (!convoyId) {
      standaloneThreads.push(thread);
      continue;
    }

    const existing = convoyGroupsById.get(convoyId);
    if (existing) {
      existing.threads.push(thread);
      continue;
    }

    convoyGroupsById.set(convoyId, {
      id: convoyId,
      label: meta.convoyTitle?.trim() || convoyId,
      status: meta.convoyStatus,
      closedCount: meta.convoyClosedCount ? Number(meta.convoyClosedCount) : null,
      totalCount: meta.convoyTotalCount ? Number(meta.convoyTotalCount) : null,
      threads: [thread],
    });
  }

  return {
    standaloneThreads,
    convoyGroups: Array.from(convoyGroupsById.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
  };
}

// ---------------------------------------------------------------------------
// RPC schemas (for gc.getThreadContext WS method)
// ---------------------------------------------------------------------------

export const GcGetThreadContextInput = Schema.Struct({
  threadId: Schema.String,
});
export type GcGetThreadContextInput = typeof GcGetThreadContextInput.Type;

const GcBeadSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  status: Schema.String,
  priority: Schema.Number,
  issueType: Schema.String,
  assignee: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const GcConvoyChildSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
});

const GcConvoySchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  children: Schema.Array(GcConvoyChildSchema),
  closedCount: Schema.Number,
  totalCount: Schema.Number,
});

const GcFormulaStepSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  needs: Schema.optional(Schema.Array(Schema.String)),
});

const GcFormulaSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  version: Schema.Number,
  steps: Schema.Array(GcFormulaStepSchema),
});

export const GcThreadContextResult = Schema.Struct({
  bead: Schema.NullOr(GcBeadSchema),
  convoy: Schema.NullOr(GcConvoySchema),
  formula: Schema.NullOr(GcFormulaSchema),
});
export type GcThreadContextResult = typeof GcThreadContextResult.Type;

export class GcGetThreadContextError extends Schema.TaggedErrorClass<GcGetThreadContextError>()(
  "GcGetThreadContextError",
  { message: Schema.String },
) {}
