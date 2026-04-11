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
// GC config inventory (for sidebar / config-aware UI)
// ---------------------------------------------------------------------------

export const GcConfigWorkspace = Schema.Struct({
  name: Schema.String,
  provider: Schema.optional(Schema.String),
  suspended: Schema.Boolean,
  session_template: Schema.optional(Schema.String),
});
export type GcConfigWorkspace = typeof GcConfigWorkspace.Type;

export const GcConfigAgent = Schema.Struct({
  name: Schema.String,
  dir: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  is_pool: Schema.optional(Schema.Boolean),
  scope: Schema.optional(Schema.String),
  suspended: Schema.Boolean,
});
export type GcConfigAgent = typeof GcConfigAgent.Type;

export const GcConfigRig = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  prefix: Schema.optional(Schema.String),
  suspended: Schema.Boolean,
});
export type GcConfigRig = typeof GcConfigRig.Type;

export const GcConfigProvider = Schema.Struct({
  display_name: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  prompt_mode: Schema.optional(Schema.String),
  prompt_flag: Schema.optional(Schema.String),
  ready_delay_ms: Schema.optional(Schema.Number),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type GcConfigProvider = typeof GcConfigProvider.Type;

export const GcConfigPatches = Schema.Struct({
  agent_count: Schema.Number,
  rig_count: Schema.Number,
  provider_count: Schema.Number,
});
export type GcConfigPatches = typeof GcConfigPatches.Type;

export const GcConfigResult = Schema.Struct({
  workspace: GcConfigWorkspace,
  agents: Schema.Array(GcConfigAgent),
  rigs: Schema.Array(GcConfigRig),
  providers: Schema.optional(Schema.Record(Schema.String, GcConfigProvider)),
  patches: Schema.optional(GcConfigPatches),
});
export type GcConfigResult = typeof GcConfigResult.Type;

// ---------------------------------------------------------------------------
// Sidebar virtual folder grouping
// ---------------------------------------------------------------------------

/** A virtual agent group nested under a rig folder in the sidebar. */
export interface VirtualAgentGroup<TThread> {
  id: string;
  label: string;
  qualifiedName: string;
  isConfigured: boolean;
  isPool: boolean;
  isSuspended: boolean;
  scope?: string;
  threads: TThread[];
}

/** A virtual rig group for sidebar thread grouping. */
export interface VirtualRigGroup<TThread> {
  id: string;
  label: string;
  isConfigured: boolean;
  isSuspended: boolean;
  agentGroups: VirtualAgentGroup<TThread>[];
}

function normalizeMetadataValue(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function agentFolderLabel(agent: string): string {
  const segments = agent.split("/").filter(Boolean);
  return segments.at(-1) ?? agent;
}

function configuredAgentQualifiedName(agent: Pick<GcConfigAgent, "dir" | "name">): string {
  const dir = normalizeMetadataValue(agent.dir);
  return dir ? `${dir}/${agent.name}` : agent.name;
}

/** Partition threads into rig folders, agent folders, and standalone threads. */
export function groupThreadsByRigAndAgent<
  TThread extends { customMetadata?: Record<string, string> },
>(
  threads: TThread[],
  options?: {
    config?: GcConfigResult | null;
    projectCwd?: string | null;
  },
): {
  standaloneThreads: TThread[];
  rigGroups: VirtualRigGroup<TThread>[];
} {
  const standaloneThreads: TThread[] = [];
  const rigGroupsById = new Map<
    string,
    {
      id: string;
      label: string;
      isConfigured: boolean;
      isSuspended: boolean;
      agentGroupsById: Map<string, VirtualAgentGroup<TThread>>;
    }
  >();

  const projectCwd = normalizeMetadataValue(options?.projectCwd ?? undefined);
  const relevantRigs = options?.config?.rigs.filter(
    (rig) => !projectCwd || normalizeMetadataValue(rig.path) === projectCwd,
  );
  if (relevantRigs && relevantRigs.length > 0) {
    const relevantRigNames = new Set(relevantRigs.map((rig) => rig.name));
    for (const rig of relevantRigs) {
      rigGroupsById.set(rig.name, {
        id: rig.name,
        label: rig.name,
        isConfigured: true,
        isSuspended: rig.suspended,
        agentGroupsById: new Map(),
      });
    }

    for (const agent of options?.config?.agents ?? []) {
      const rigName = normalizeMetadataValue(agent.dir);
      if (!rigName || !relevantRigNames.has(rigName)) {
        continue;
      }
      const rigGroup = rigGroupsById.get(rigName);
      if (!rigGroup) {
        continue;
      }
      const qualifiedName = configuredAgentQualifiedName(agent);
      rigGroup.agentGroupsById.set(qualifiedName, {
        id: `${rigName}/${qualifiedName}`,
        label: agentFolderLabel(qualifiedName),
        qualifiedName,
        isConfigured: true,
        isPool: agent.is_pool ?? false,
        isSuspended: agent.suspended,
        ...(agent.scope ? { scope: agent.scope } : {}),
        threads: [],
      });
    }
  }

  for (const thread of threads) {
    const meta = parseGcMeta(thread.customMetadata);
    const rig = normalizeMetadataValue(meta.rig);
    const agent = normalizeMetadataValue(meta.agent);
    if (!meta.isGcManaged || !rig || !agent) {
      standaloneThreads.push(thread);
      continue;
    }

    let rigGroup = rigGroupsById.get(rig);
    if (!rigGroup) {
      rigGroup = {
        id: rig,
        label: rig,
        isConfigured: false,
        isSuspended: false,
        agentGroupsById: new Map(),
      };
      rigGroupsById.set(rig, rigGroup);
    }

    const existingAgentGroup = rigGroup.agentGroupsById.get(agent);
    if (existingAgentGroup) {
      existingAgentGroup.threads.push(thread);
      continue;
    }

    rigGroup.agentGroupsById.set(agent, {
      id: `${rig}/${agent}`,
      label: agentFolderLabel(agent),
      qualifiedName: agent,
      isConfigured: false,
      isPool: false,
      isSuspended: false,
      threads: [thread],
    });
  }

  return {
    standaloneThreads,
    rigGroups: Array.from(rigGroupsById.values())
      .toSorted((a, b) => a.label.localeCompare(b.label))
      .map((rigGroup) => ({
        id: rigGroup.id,
        label: rigGroup.label,
        isConfigured: rigGroup.isConfigured,
        isSuspended: rigGroup.isSuspended,
        agentGroups: Array.from(rigGroup.agentGroupsById.values()).toSorted((a, b) =>
          a.label.localeCompare(b.label),
        ),
      })),
  };
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
    convoyGroups: Array.from(convoyGroupsById.values()).toSorted((a, b) =>
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

export const GcGetConfigInput = Schema.Struct({});
export type GcGetConfigInput = typeof GcGetConfigInput.Type;

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

export class GcGetConfigError extends Schema.TaggedErrorClass<GcGetConfigError>()(
  "GcGetConfigError",
  { message: Schema.String },
) {}
