/**
 * Gas City integration types.
 *
 * These schemas define the gc.* customMetadata keys that the t3bridge
 * provider sets on OrchestrationThread via thread.meta.update, and
 * the activity kinds it dispatches via thread.activity.append.
 *
 * Source of truth: gascity/internal/runtime/t3bridge/provider.go
 */
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

// ---------------------------------------------------------------------------
// gc.* metadata keys (set on OrchestrationThread.customMetadata)
// ---------------------------------------------------------------------------

/** Parsed gc.* metadata from a thread's customMetadata record. */
export const GcThreadMeta = Schema.Struct({
  /** Whether this thread is managed by Gas City. */
  isGcManaged: Schema.Boolean,
  /** Agent qualified name (e.g. "t3code/polecat"). */
  agent: Schema.optional(Schema.String),
  /** Canonical GC session name (e.g. "t3code--polecat"). */
  sessionName: Schema.optional(Schema.String),
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
  /** Session startup env forwarded from Gas City into the provider process. */
  sessionEnv: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Molecule ID (formula instance). */
  molecule: Schema.optional(Schema.String),
  /** Formula name. */
  formula: Schema.optional(Schema.String),
  /** Canonical sidebar group kind. */
  groupKind: Schema.optional(Schema.Union([Schema.Literal("workspace"), Schema.Literal("rig")])),
  /** Canonical sidebar group id. */
  groupId: Schema.optional(Schema.String),
  /** Canonical sidebar group label. */
  groupLabel: Schema.optional(Schema.String),
  /** Canonical agent qualified name for grouping. */
  agentQualified: Schema.optional(Schema.String),
  /** Canonical agent label for grouping. */
  agentLabel: Schema.optional(Schema.String),
});
export type GcThreadMeta = typeof GcThreadMeta.Type;

function parseGcSessionEnv(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const env = Object.entries(parsed).flatMap(([key, entryValue]) =>
      typeof entryValue === "string" ? [[key, entryValue] as const] : [],
    );
    return env.length > 0 ? Object.fromEntries(env) : undefined;
  } catch {
    return undefined;
  }
}

function parseGcSessionName(
  customMetadata: Record<string, string>,
  sessionEnv: Record<string, string> | undefined,
): string | undefined {
  return customMetadata["gc.sessionName"] ?? sessionEnv?.GC_SESSION_NAME;
}

/** Extract GcThreadMeta from a raw customMetadata record. */
export function parseGcMeta(customMetadata?: Record<string, string>): GcThreadMeta {
  if (!customMetadata || !customMetadata["gc.agent"]) {
    return {
      isGcManaged: false,
      agent: undefined,
      sessionName: undefined,
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
      sessionEnv: undefined,
      molecule: undefined,
      formula: undefined,
      groupKind: undefined,
      groupId: undefined,
      groupLabel: undefined,
      agentQualified: undefined,
      agentLabel: undefined,
    };
  }
  const sessionEnv = parseGcSessionEnv(customMetadata["gc.sessionEnv"]);
  return {
    isGcManaged: true,
    agent: customMetadata["gc.agent"],
    sessionName: parseGcSessionName(customMetadata, sessionEnv),
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
    sessionEnv,
    molecule: customMetadata["gc.molecule"],
    formula: customMetadata["gc.formula"],
    groupKind:
      customMetadata["gc.groupKind"] === "workspace" || customMetadata["gc.groupKind"] === "rig"
        ? customMetadata["gc.groupKind"]
        : undefined,
    groupId: customMetadata["gc.groupId"],
    groupLabel: customMetadata["gc.groupLabel"],
    agentQualified: customMetadata["gc.agentQualified"],
    agentLabel: customMetadata["gc.agentLabel"],
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

export const GcNamedSessionMode = Schema.Union([
  Schema.Literal("always"),
  Schema.Literal("on_demand"),
]);
export type GcNamedSessionMode = typeof GcNamedSessionMode.Type;

export const GcConfigAgent = Schema.Struct({
  name: Schema.String,
  dir: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  is_pool: Schema.optional(Schema.Boolean),
  min_active_sessions: Schema.optional(Schema.Number),
  max_active_sessions: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
  suspended: Schema.Boolean,
  named_session_mode: Schema.optional(GcNamedSessionMode),
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
  maxActiveSessions?: number;
  namedSessionMode?: GcNamedSessionMode;
  scope?: string;
  threads: TThread[];
}

/** A virtual rig group for sidebar thread grouping. */
export interface VirtualRigGroup<TThread> {
  id: string;
  label: string;
  kind: "workspace" | "rig";
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

function pathBasename(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function configuredAgentQualifiedName(agent: Pick<GcConfigAgent, "dir" | "name">): string {
  const dir = normalizeMetadataValue(agent.dir);
  return dir ? `${dir}/${agent.name}` : agent.name;
}

function candidateAgentLabels(agent: string): string[] {
  const trimmed = agent.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const labels = new Set<string>([trimmed, agentFolderLabel(trimmed)]);
  const lastDotSegment = trimmed
    .split(".")
    .toReversed()
    .find((segment) => segment.length > 0);
  if (lastDotSegment) {
    labels.add(lastDotSegment);
  }
  return [...labels];
}

export function parseGcSessionTitleSegments(title?: string): {
  sessionName: string | null;
  agentHint: string | null;
} {
  const trimmed = normalizeMetadataValue(title);
  if (!trimmed) {
    return { sessionName: null, agentHint: null };
  }
  const parts = trimmed.split("·").map((part) => normalizeMetadataValue(part) ?? "");
  if (parts.length >= 2) {
    return {
      sessionName: normalizeMetadataValue(parts[0] ?? undefined),
      agentHint: normalizeMetadataValue(parts.at(-1) ?? undefined),
    };
  }
  return { sessionName: null, agentHint: trimmed };
}

function configuredAgentSessionName(agent: Pick<GcConfigAgent, "dir" | "name">): string {
  const qualifiedName = configuredAgentQualifiedName(agent);
  return qualifiedName.replaceAll("/", "--").replaceAll(".", "__");
}

function deriveRigIdFromQualifiedAgent(agent: string): string | null {
  const normalized = normalizeMetadataValue(agent);
  if (!normalized) {
    return null;
  }

  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex <= 0) {
    return null;
  }

  return normalizeMetadataValue(normalized.slice(0, lastSlashIndex));
}

function findMatchingAgentGroup<TThread>(
  agentGroupsById: ReadonlyMap<string, VirtualAgentGroup<TThread>>,
  agent: string,
): VirtualAgentGroup<TThread> | undefined {
  const exactMatch = agentGroupsById.get(agent);
  if (exactMatch) {
    return exactMatch;
  }

  const candidateLabels = new Set(candidateAgentLabels(agent));
  if (candidateLabels.size === 0) {
    return undefined;
  }

  return [...agentGroupsById.values()].find((group) => candidateLabels.has(group.label));
}

/** Partition threads into rig folders, agent folders, and standalone threads. */
export function groupThreadsByRigAndAgent<
  TThread extends {
    customMetadata?: Record<string, string> | undefined;
    title?: string | undefined;
  },
>(
  threads: TThread[],
  options?: {
    config?: GcConfigResult | null;
    projectCwd?: string | null;
    projectName?: string | null;
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
      kind: "workspace" | "rig";
      isConfigured: boolean;
      isSuspended: boolean;
      agentGroupsById: Map<string, VirtualAgentGroup<TThread>>;
    }
  >();

  const projectCwd = normalizeMetadataValue(options?.projectCwd ?? undefined);
  const projectName = normalizeMetadataValue(options?.projectName ?? undefined);
  const workspaceName = normalizeMetadataValue(options?.config?.workspace.name);
  const projectDirName = projectCwd ? normalizeMetadataValue(pathBasename(projectCwd)) : null;
  const isCityProject = Boolean(
    workspaceName &&
    ((projectName &&
      projectName.localeCompare(workspaceName, undefined, { sensitivity: "accent" }) === 0) ||
      (projectDirName &&
        projectDirName.localeCompare(workspaceName, undefined, { sensitivity: "accent" }) === 0)),
  );
  let cityScopedRigGroupId: string | null = null;
  const relevantRigs = options?.config?.rigs.filter(
    (rig) => !projectCwd || normalizeMetadataValue(rig.path) === projectCwd,
  );
  if (relevantRigs && relevantRigs.length > 0) {
    const relevantRigNames = new Set(relevantRigs.map((rig) => rig.name));
    for (const rig of relevantRigs) {
      rigGroupsById.set(rig.name, {
        id: rig.name,
        label: rig.name,
        kind: "rig",
        isConfigured: true,
        isSuspended: rig.suspended,
        agentGroupsById: new Map(),
      });
    }

    if (isCityProject && workspaceName) {
      const workspaceRig = relevantRigs.find(
        (rig) => rig.name.localeCompare(workspaceName, undefined, { sensitivity: "accent" }) === 0,
      );
      if (workspaceRig) {
        cityScopedRigGroupId = workspaceRig.name;
      }
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
        isSuspended: rigGroup.isSuspended || agent.suspended,
        ...(typeof agent.max_active_sessions === "number"
          ? { maxActiveSessions: agent.max_active_sessions }
          : {}),
        ...(agent.named_session_mode ? { namedSessionMode: agent.named_session_mode } : {}),
        ...(agent.scope ? { scope: agent.scope } : {}),
        threads: [],
      });
    }
  }

  if ((!relevantRigs || relevantRigs.length === 0) && isCityProject && workspaceName) {
    const cityGroupId = workspaceName;
    cityScopedRigGroupId = cityGroupId;
    rigGroupsById.set(cityGroupId, {
      id: cityGroupId,
      label: workspaceName.toUpperCase(),
      kind: "workspace",
      isConfigured: true,
      isSuspended: options?.config?.workspace.suspended ?? false,
      agentGroupsById: new Map(),
    });
  }

  if (cityScopedRigGroupId) {
    const cityGroup = rigGroupsById.get(cityScopedRigGroupId);
    if (cityGroup) {
      for (const agent of options?.config?.agents ?? []) {
        const rigName = normalizeMetadataValue(agent.dir);
        if (rigName) continue;
        const qualifiedName = configuredAgentQualifiedName(agent);
        if (cityGroup.agentGroupsById.has(qualifiedName)) {
          continue;
        }
        cityGroup.agentGroupsById.set(qualifiedName, {
          id: `${cityScopedRigGroupId}/${qualifiedName}`,
          label: agentFolderLabel(qualifiedName),
          qualifiedName,
          isConfigured: true,
          isPool: agent.is_pool ?? false,
          isSuspended: cityGroup.isSuspended || agent.suspended,
          ...(typeof agent.max_active_sessions === "number"
            ? { maxActiveSessions: agent.max_active_sessions }
            : {}),
          ...(agent.named_session_mode ? { namedSessionMode: agent.named_session_mode } : {}),
          ...(agent.scope ? { scope: agent.scope } : {}),
          threads: [],
        });
      }
    }
  }

  for (const thread of threads) {
    const meta = parseGcMeta(thread.customMetadata);
    const rig = normalizeMetadataValue(meta.rig);
    const agent = normalizeMetadataValue(meta.agent);
    const canonicalGroupId = normalizeMetadataValue(meta.groupId);
    const canonicalGroupLabel = normalizeMetadataValue(meta.groupLabel);
    const canonicalAgentQualified = normalizeMetadataValue(meta.agentQualified);
    const canonicalAgentLabel = normalizeMetadataValue(meta.agentLabel);
    let resolvedRig = canonicalGroupId ?? rig ?? null;
    let resolvedAgent = canonicalAgentQualified ?? agent;

    if (!resolvedRig && resolvedAgent && options?.config) {
      const configuredAgent = options.config.agents.find(
        (entry) => configuredAgentQualifiedName(entry) === resolvedAgent,
      );
      if (configuredAgent) {
        resolvedRig = normalizeMetadataValue(configuredAgent.dir) ?? cityScopedRigGroupId;
      }
    }

    if (!resolvedRig && resolvedAgent) {
      resolvedRig = deriveRigIdFromQualifiedAgent(resolvedAgent);
    }

    if (!resolvedRig) {
      resolvedRig = cityScopedRigGroupId;
    }

    if (!meta.isGcManaged && options?.config) {
      const { sessionName, agentHint } = parseGcSessionTitleSegments(thread.title);
      const configuredGroups = Array.from(rigGroupsById.values());
      let fallbackMatch: { rigId: string; agentGroup: VirtualAgentGroup<TThread> } | undefined;

      if (agentHint) {
        for (const group of configuredGroups) {
          const matched = findMatchingAgentGroup(group.agentGroupsById, agentHint);
          if (matched) {
            fallbackMatch = { rigId: group.id, agentGroup: matched };
            break;
          }
        }
      }

      if (!fallbackMatch && sessionName) {
        for (const configuredAgent of options.config.agents) {
          if (configuredAgentSessionName(configuredAgent) !== sessionName) {
            continue;
          }
          const rigId = normalizeMetadataValue(configuredAgent.dir) ?? cityScopedRigGroupId;
          if (!rigId) {
            continue;
          }
          const rigGroup = rigGroupsById.get(rigId);
          if (!rigGroup) {
            continue;
          }
          const qualifiedName = configuredAgentQualifiedName(configuredAgent);
          const matched = rigGroup.agentGroupsById.get(qualifiedName);
          if (matched) {
            fallbackMatch = { rigId, agentGroup: matched };
            break;
          }
        }
      }

      if (fallbackMatch) {
        resolvedRig = fallbackMatch.rigId;
        resolvedAgent = fallbackMatch.agentGroup.qualifiedName;
      }
    }

    if ((!meta.isGcManaged && !resolvedAgent) || !resolvedRig || !resolvedAgent) {
      standaloneThreads.push(thread);
      continue;
    }

    let rigGroup = rigGroupsById.get(resolvedRig);
    if (!rigGroup) {
      rigGroup = {
        id: resolvedRig,
        label:
          canonicalGroupLabel ??
          (resolvedRig === cityScopedRigGroupId
            ? (workspaceName?.toUpperCase() ?? resolvedRig)
            : resolvedRig),
        kind:
          meta.groupKind === "workspace" || meta.groupKind === "rig"
            ? meta.groupKind
            : resolvedRig === cityScopedRigGroupId
              ? "workspace"
              : "rig",
        isConfigured: false,
        isSuspended: false,
        agentGroupsById: new Map(),
      };
      rigGroupsById.set(resolvedRig, rigGroup);
    }
    const ensuredRigGroup = rigGroup!;

    const existingAgentGroup = findMatchingAgentGroup(
      ensuredRigGroup.agentGroupsById,
      resolvedAgent,
    );
    if (existingAgentGroup) {
      existingAgentGroup.threads.push(thread);
      continue;
    }

    ensuredRigGroup.agentGroupsById.set(resolvedAgent, {
      id: `${resolvedRig}/${resolvedAgent}`,
      label: canonicalAgentLabel ?? agentFolderLabel(resolvedAgent),
      qualifiedName: resolvedAgent,
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
        kind: rigGroup.kind,
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

export const GcSetAgentSuspendedInput = Schema.Struct({
  agent: Schema.String,
  suspended: Schema.Boolean,
});
export type GcSetAgentSuspendedInput = typeof GcSetAgentSuspendedInput.Type;

export const GcSetRigSuspendedInput = Schema.Struct({
  rig: Schema.String,
  suspended: Schema.Boolean,
});
export type GcSetRigSuspendedInput = typeof GcSetRigSuspendedInput.Type;

export const GcSetCitySuspendedInput = Schema.Struct({
  suspended: Schema.Boolean,
});
export type GcSetCitySuspendedInput = typeof GcSetCitySuspendedInput.Type;

export const GcSetAgentSessionModeInput = Schema.Struct({
  agent: Schema.String,
  mode: GcNamedSessionMode,
});
export type GcSetAgentSessionModeInput = typeof GcSetAgentSessionModeInput.Type;

export const GcSetAgentMaxActiveSessionsInput = Schema.Struct({
  agent: Schema.String,
  maxActiveSessions: Schema.Number,
});
export type GcSetAgentMaxActiveSessionsInput = typeof GcSetAgentMaxActiveSessionsInput.Type;

export const GcFindThreadBindingInput = Schema.Struct({
  sessionName: Schema.String,
});
export type GcFindThreadBindingInput = typeof GcFindThreadBindingInput.Type;

export const GcSubmitSessionInput = Schema.Struct({
  threadId: ThreadId,
  message: TrimmedNonEmptyString,
});
export type GcSubmitSessionInput = typeof GcSubmitSessionInput.Type;

export const GcStopSessionInput = Schema.Struct({
  threadId: ThreadId,
});
export type GcStopSessionInput = typeof GcStopSessionInput.Type;

export const GcRespondToPendingInput = Schema.Struct({
  threadId: ThreadId,
  action: TrimmedNonEmptyString,
  requestId: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type GcRespondToPendingInput = typeof GcRespondToPendingInput.Type;

export const GcPeekThreadMessagesInput = Schema.Struct({
  query: Schema.optional(TrimmedNonEmptyString),
  agent: Schema.optional(Schema.String),
  sessionName: Schema.optional(Schema.String),
  limit: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(25))),
});
export type GcPeekThreadMessagesInput = typeof GcPeekThreadMessagesInput.Type;

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

export const GcThreadBindingResultItem = Schema.Struct({
  sessionName: Schema.String,
  threadId: Schema.String,
  projectId: Schema.String,
});
export type GcThreadBindingResultItem = typeof GcThreadBindingResultItem.Type;

export const GcFindThreadBindingResult = Schema.NullOr(GcThreadBindingResultItem);
export type GcFindThreadBindingResult = typeof GcFindThreadBindingResult.Type;

export const GcSessionActionResult = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
});
export type GcSessionActionResult = typeof GcSessionActionResult.Type;

export const GcSubmitSessionResult = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  queued: Schema.Boolean,
  intent: Schema.String,
});
export type GcSubmitSessionResult = typeof GcSubmitSessionResult.Type;

export const GcPeekThreadMessagesHit = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  snippet: Schema.String,
  agent: Schema.optional(Schema.String),
  rig: Schema.optional(Schema.String),
  sessionName: Schema.optional(Schema.String),
});
export type GcPeekThreadMessagesHit = typeof GcPeekThreadMessagesHit.Type;

export const GcPeekThreadMessagesResult = Schema.Struct({
  results: Schema.Array(GcPeekThreadMessagesHit),
});
export type GcPeekThreadMessagesResult = typeof GcPeekThreadMessagesResult.Type;

export class GcGetThreadContextError extends Schema.TaggedErrorClass<GcGetThreadContextError>()(
  "GcGetThreadContextError",
  { message: Schema.String },
) {}

export class GcFindThreadBindingError extends Schema.TaggedErrorClass<GcFindThreadBindingError>()(
  "GcFindThreadBindingError",
  { message: Schema.String },
) {}

export class GcSubmitSessionError extends Schema.TaggedErrorClass<GcSubmitSessionError>()(
  "GcSubmitSessionError",
  { message: Schema.String },
) {}

export class GcStopSessionError extends Schema.TaggedErrorClass<GcStopSessionError>()(
  "GcStopSessionError",
  { message: Schema.String },
) {}

export class GcRespondToPendingError extends Schema.TaggedErrorClass<GcRespondToPendingError>()(
  "GcRespondToPendingError",
  { message: Schema.String },
) {}

export class GcPeekThreadMessagesError extends Schema.TaggedErrorClass<GcPeekThreadMessagesError>()(
  "GcPeekThreadMessagesError",
  { message: Schema.String },
) {}

export class GcGetConfigError extends Schema.TaggedErrorClass<GcGetConfigError>()(
  "GcGetConfigError",
  { message: Schema.String },
) {}

export class GcSetAgentSuspendedError extends Schema.TaggedErrorClass<GcSetAgentSuspendedError>()(
  "GcSetAgentSuspendedError",
  { message: Schema.String },
) {}

export class GcSetRigSuspendedError extends Schema.TaggedErrorClass<GcSetRigSuspendedError>()(
  "GcSetRigSuspendedError",
  { message: Schema.String },
) {}

export class GcSetCitySuspendedError extends Schema.TaggedErrorClass<GcSetCitySuspendedError>()(
  "GcSetCitySuspendedError",
  { message: Schema.String },
) {}

export class GcSetAgentSessionModeError extends Schema.TaggedErrorClass<GcSetAgentSessionModeError>()(
  "GcSetAgentSessionModeError",
  { message: Schema.String },
) {}

export class GcSetAgentMaxActiveSessionsError extends Schema.TaggedErrorClass<GcSetAgentMaxActiveSessionsError>()(
  "GcSetAgentMaxActiveSessionsError",
  { message: Schema.String },
) {}
