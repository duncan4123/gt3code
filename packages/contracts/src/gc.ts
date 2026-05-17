/**
 * Gas City integration types.
 *
 * These schemas define the gc.* customMetadata keys that the t3bridge
 * provider sets on OrchestrationThread via thread.meta.update, and
 * the activity kinds it dispatches via thread.activity.append.
 *
 * Source of truth: gascity/internal/runtime/t3bridge/provider.go
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { OrchestrationThreadShell } from "./orchestration.ts";

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
  /** Rig repository path. */
  rigPath: Schema.optional(Schema.String),
  /** City name. */
  city: Schema.optional(Schema.String),
  /** Current bead ID. */
  bead: Schema.optional(Schema.String),
  /** Current bead title. */
  beadTitle: Schema.optional(Schema.String),
  /** Current bead status. */
  beadStatus: Schema.optional(Schema.String),
  /** Current bead type. */
  beadType: Schema.optional(Schema.String),
  /** Current bead priority. */
  beadPriority: Schema.optional(Schema.String),
  /** Current bead assignee. */
  beadAssignee: Schema.optional(Schema.String),
  /** Current bead labels, comma-separated. */
  beadLabels: Schema.optional(Schema.String),
  /** Current bead description. */
  beadDescription: Schema.optional(Schema.String),
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
  /** Session startup template from GC. */
  startupTemplate: Schema.optional(Schema.String),
  /** Provider model requested by GC at startup. */
  startupModel: Schema.optional(Schema.String),
  /** Working directory requested by GC at startup. */
  startupWorkDir: Schema.optional(Schema.String),
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
      rigPath: undefined,
      city: undefined,
      bead: undefined,
      beadTitle: undefined,
      beadStatus: undefined,
      beadType: undefined,
      beadPriority: undefined,
      beadAssignee: undefined,
      beadLabels: undefined,
      beadDescription: undefined,
      convoy: undefined,
      convoyTitle: undefined,
      convoyStatus: undefined,
      convoyClosedCount: undefined,
      convoyTotalCount: undefined,
      provider: undefined,
      runtimeProvider: undefined,
      state: undefined,
      startupTemplate: undefined,
      startupModel: undefined,
      startupWorkDir: undefined,
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
    rigPath: customMetadata["gc.rigPath"],
    city: customMetadata["gc.city"],
    bead: customMetadata["gc.bead"],
    beadTitle: customMetadata["gc.beadTitle"],
    beadStatus: customMetadata["gc.beadStatus"],
    beadType: customMetadata["gc.beadType"],
    beadPriority: customMetadata["gc.beadPriority"],
    beadAssignee: customMetadata["gc.beadAssignee"],
    beadLabels: customMetadata["gc.beadLabels"],
    beadDescription: customMetadata["gc.beadDescription"],
    convoy: customMetadata["gc.convoy"],
    convoyTitle: customMetadata["gc.convoyTitle"],
    convoyStatus: customMetadata["gc.convoyStatus"],
    convoyClosedCount: customMetadata["gc.convoyClosedCount"],
    convoyTotalCount: customMetadata["gc.convoyTotalCount"],
    provider: customMetadata["gc.provider"],
    runtimeProvider: customMetadata["gc.runtimeProvider"],
    state: customMetadata["gc.state"],
    startupTemplate: customMetadata["gc.startupTemplate"],
    startupModel: customMetadata["gc.startupModel"],
    startupWorkDir: customMetadata["gc.startupWorkDir"],
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
  path: Schema.optional(Schema.String),
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

export const GcWakeMode = Schema.Union([Schema.Literal("resume"), Schema.Literal("fresh")]);
export type GcWakeMode = typeof GcWakeMode.Type;

export const GcLifecycleStatus = Schema.Struct({
  supervisorRunning: Schema.Boolean,
  controllerRunning: Schema.Boolean,
  supervisorPort: Schema.optional(Schema.Number),
  supervisorUrl: Schema.optional(Schema.String),
});
export type GcLifecycleStatus = typeof GcLifecycleStatus.Type;

export const GcConfigAgent = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  dir: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  session_template: Schema.optional(Schema.String),
  work_dir: Schema.optional(Schema.String),
  prompt_template: Schema.optional(Schema.String),
  start_command: Schema.optional(Schema.String),
  default_sling_formula: Schema.optional(Schema.String),
  is_pool: Schema.optional(Schema.Boolean),
  min_active_sessions: Schema.optional(Schema.Number),
  max_active_sessions: Schema.optional(Schema.Number),
  wake_mode: Schema.optional(GcWakeMode),
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
  lifecycle: Schema.optional(GcLifecycleStatus),
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
  lifecycle: Schema.optional(GcLifecycleStatus),
});
export type GcConfigResult = typeof GcConfigResult.Type;

export const GcSidebarLayoutAgentGroup = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  qualifiedName: Schema.String,
  isConfigured: Schema.Boolean,
  isPool: Schema.Boolean,
  isSuspended: Schema.Boolean,
  minActiveSessions: Schema.optional(Schema.Number),
  maxActiveSessions: Schema.optional(Schema.Number),
  wakeMode: Schema.optional(GcWakeMode),
  namedSessionMode: Schema.optional(GcNamedSessionMode),
  scope: Schema.optional(Schema.String),
  threads: Schema.Array(OrchestrationThreadShell),
});
export type GcSidebarLayoutAgentGroup = typeof GcSidebarLayoutAgentGroup.Type;

export const GcSidebarLayoutRigGroup = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Union([Schema.Literal("workspace"), Schema.Literal("rig")]),
  isConfigured: Schema.Boolean,
  isSuspended: Schema.Boolean,
  lifecycle: Schema.optional(GcLifecycleStatus),
  agentGroups: Schema.Array(GcSidebarLayoutAgentGroup),
});
export type GcSidebarLayoutRigGroup = typeof GcSidebarLayoutRigGroup.Type;

export const GcSidebarLayoutResult = Schema.Struct({
  config: GcConfigResult,
  rigGroups: Schema.Array(GcSidebarLayoutRigGroup),
  standaloneThreads: Schema.Array(OrchestrationThreadShell),
});
export type GcSidebarLayoutResult = typeof GcSidebarLayoutResult.Type;

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
  isExplicitlySuspended: boolean;
  isSuspended: boolean;
  minActiveSessions?: number;
  maxActiveSessions?: number;
  wakeMode?: GcWakeMode;
  namedSessionMode?: GcNamedSessionMode;
  scope?: string;
  provider?: string;
  description?: string;
  workDir?: string;
  promptTemplate?: string;
  startCommand?: string;
  defaultSlingFormula?: string;
  threads: TThread[];
}

/** A virtual rig group for sidebar thread grouping. */
export interface VirtualRigGroup<TThread> {
  id: string;
  label: string;
  kind: "workspace" | "rig";
  isConfigured: boolean;
  isSuspended: boolean;
  lifecycle?: GcLifecycleStatus;
  agentGroups: VirtualAgentGroup<TThread>[];
}

interface MutableVirtualRigGroup<TThread> {
  id: string;
  label: string;
  kind: "workspace" | "rig";
  isConfigured: boolean;
  isSuspended: boolean;
  lifecycle?: GcLifecycleStatus;
  agentGroupsById: Map<string, VirtualAgentGroup<TThread>>;
}

function normalizeMetadataValue(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return null;
  }
  return trimmed;
}

function qualifyMergedMultiCityRigId(input: {
  rig: string | null;
  city: string | null;
  isMergedMultiCityConfig: boolean;
  multiCityWorkspaceIds: ReadonlySet<string>;
  configRigByName: ReadonlyMap<string, GcConfigRig>;
}): string | null {
  if (
    !input.rig ||
    !input.isMergedMultiCityConfig ||
    !input.city ||
    !input.multiCityWorkspaceIds.has(input.city) ||
    input.rig === input.city ||
    input.rig.startsWith(`${input.city}/`)
  ) {
    return input.rig;
  }

  const cityScopedRig = `${input.city}/${input.rig}`;
  return input.configRigByName.has(cityScopedRig) ? cityScopedRig : input.rig;
}

function qualifyMergedMultiCityAgent(input: {
  agent: string | null;
  city: string | null;
  originalRig: string | null;
  resolvedRig: string | null;
  isMergedMultiCityConfig: boolean;
  multiCityWorkspaceIds: ReadonlySet<string>;
}): string | null {
  if (
    !input.agent ||
    !input.resolvedRig ||
    !input.isMergedMultiCityConfig ||
    !input.city ||
    !input.multiCityWorkspaceIds.has(input.city) ||
    (input.resolvedRig !== input.city && !input.resolvedRig.startsWith(`${input.city}/`))
  ) {
    return input.agent;
  }

  if (input.agent === input.resolvedRig || input.agent.startsWith(`${input.resolvedRig}/`)) {
    return input.agent;
  }

  const rigCandidates = [
    input.originalRig,
    input.originalRig ? pathBasename(input.originalRig) : null,
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of new Set(rigCandidates)) {
    if (input.agent.startsWith(`${candidate}/`)) {
      return `${input.resolvedRig}/${input.agent.slice(candidate.length + 1)}`;
    }
  }

  return `${input.resolvedRig}/${input.agent}`;
}

function agentFolderLabel(agent: string): string {
  const segments = agent.split("/").filter(Boolean);
  const scoped = segments.at(-1) ?? agent;
  const dotIndex = scoped.lastIndexOf(".");
  return dotIndex >= 0 ? scoped.slice(dotIndex + 1) : scoped;
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

function gcAgentVirtualMetadata(
  agent: GcConfigAgent | undefined,
): Partial<VirtualAgentGroup<never>> {
  if (!agent) {
    return {};
  }
  return {
    ...(agent.provider ? { provider: agent.provider } : {}),
    ...(agent.description ? { description: agent.description } : {}),
    ...(agent.work_dir ? { workDir: agent.work_dir } : {}),
    ...(agent.prompt_template ? { promptTemplate: agent.prompt_template } : {}),
    ...(agent.start_command ? { startCommand: agent.start_command } : {}),
    ...(agent.default_sling_formula ? { defaultSlingFormula: agent.default_sling_formula } : {}),
  };
}

function isImplicitProviderLane(agent: GcConfigAgent): boolean {
  return (
    agent.name === agent.provider &&
    agent.prompt_template === ".gc/system/packs/core/assets/prompts/pool-worker.md" &&
    typeof agent.default_sling_formula === "string"
  );
}

function findConfiguredAgent(
  config: GcConfigResult | null | undefined,
  qualifiedAgent: string,
): GcConfigResult["agents"][number] | undefined {
  if (!config) {
    return undefined;
  }

  const exactMatch = config.agents.find(
    (entry) => configuredAgentQualifiedName(entry) === qualifiedAgent,
  );
  if (exactMatch) {
    return exactMatch;
  }

  const candidateLabels = new Set(candidateAgentLabels(qualifiedAgent));
  if (candidateLabels.size === 0) {
    return undefined;
  }

  return config.agents.find((entry) => {
    const qualifiedName = configuredAgentQualifiedName(entry);
    return candidateAgentLabels(qualifiedName).some((label) => candidateLabels.has(label));
  });
}

function normalizeGcPath(value: string | null | undefined): string | null {
  const normalized = normalizeMetadataValue(value ?? undefined);
  if (!normalized) {
    return null;
  }
  const path = normalized.replace(/\\/g, "/").replace(/\/+$/, "");
  return path.length > 0 ? path : null;
}

function projectContextMatchesRigPath(projectCwds: ReadonlySet<string>, rigPath: string): boolean {
  const normalizedRigPath = normalizeGcPath(rigPath);
  if (!normalizedRigPath) {
    return false;
  }

  for (const projectCwd of projectCwds) {
    const normalizedProjectCwd = normalizeGcPath(projectCwd);
    if (normalizedProjectCwd && normalizedProjectCwd === normalizedRigPath) {
      return true;
    }
  }

  return false;
}

function expandRelevantRigsWithMultiCityRoots(
  rigs: readonly GcConfigRig[],
  relevantRigs: readonly GcConfigRig[],
  cityRootNames: ReadonlySet<string>,
): GcConfigRig[] {
  if (relevantRigs.length === 0) {
    return [];
  }

  const relevantRigNames = new Set(relevantRigs.map((rig) => rig.name));
  const requiredCityRoots = new Set<string>();
  for (const rig of relevantRigs) {
    for (const cityName of cityRootNames) {
      if (rig.name === cityName || rig.name.startsWith(`${cityName}/`)) {
        requiredCityRoots.add(cityName);
      }
    }
  }

  return rigs.filter((rig) => relevantRigNames.has(rig.name) || requiredCityRoots.has(rig.name));
}

function multiCityWorkspaceRigNames(rigs: readonly GcConfigRig[]): Set<string> {
  const rigNames = new Set(
    rigs.flatMap((rig) => {
      const name = normalizeMetadataValue(rig.name);
      return name ? [name] : [];
    }),
  );
  const workspaceRigNames = new Set<string>();
  for (const rigName of rigNames) {
    const separatorIndex = rigName.indexOf("/");
    if (separatorIndex <= 0) {
      continue;
    }
    const cityName = rigName.slice(0, separatorIndex);
    if (rigNames.has(cityName)) {
      workspaceRigNames.add(cityName);
    }
  }
  return workspaceRigNames;
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
    config?: GcConfigResult | null | undefined;
    projectCwd?: string | null | undefined;
    projectName?: string | null | undefined;
    projectMembers?:
      | ReadonlyArray<{
          cwd?: string | null | undefined;
          name?: string | null | undefined;
        }>
      | undefined;
  },
): {
  standaloneThreads: TThread[];
  rigGroups: VirtualRigGroup<TThread>[];
} {
  const standaloneThreads: TThread[] = [];
  const rigGroupsById = new Map<string, MutableVirtualRigGroup<TThread>>();

  const projectCwd = normalizeMetadataValue(options?.projectCwd ?? undefined);
  const projectName = normalizeMetadataValue(options?.projectName ?? undefined);
  const workspaceName = normalizeMetadataValue(options?.config?.workspace.name);
  const workspaceSuspended = options?.config?.workspace.suspended ?? false;
  const multiCityWorkspaceIds = multiCityWorkspaceRigNames(options?.config?.rigs ?? []);
  const isMergedMultiCityConfig = workspaceName?.toLowerCase() === "cities";
  const projectCwds = new Set<string>();
  const projectLabels = new Set<string>();

  const addProjectContext = (context?: {
    cwd?: string | null | undefined;
    name?: string | null | undefined;
  }): void => {
    const normalizedCwd = normalizeMetadataValue(context?.cwd ?? undefined);
    if (normalizedCwd) {
      projectCwds.add(normalizedCwd);
      const baseName = normalizeMetadataValue(pathBasename(normalizedCwd));
      if (baseName) {
        projectLabels.add(baseName);
      }
    }

    const normalizedName = normalizeMetadataValue(context?.name ?? undefined);
    if (normalizedName) {
      projectLabels.add(normalizedName);
    }
  };

  addProjectContext({ cwd: projectCwd, name: projectName });
  for (const member of options?.projectMembers ?? []) {
    addProjectContext(member);
  }
  const isGlobalScope =
    projectCwds.size === 0 && projectLabels.size === 0 && options?.config !== undefined;
  const addConfiguredAgentGroup = (
    rigGroup: MutableVirtualRigGroup<TThread>,
    agent: GcConfigResult["agents"][number],
  ): void => {
    const qualifiedName = configuredAgentQualifiedName(agent);
    const existingGroup = findMatchingAgentGroup(rigGroup.agentGroupsById, qualifiedName);
    if (existingGroup) {
      existingGroup.isConfigured = true;
      existingGroup.isPool = agent.is_pool ?? existingGroup.isPool;
      existingGroup.isExplicitlySuspended = agent.suspended;
      existingGroup.isSuspended = rigGroup.isSuspended || agent.suspended;
      if (typeof agent.min_active_sessions === "number") {
        existingGroup.minActiveSessions = agent.min_active_sessions;
      }
      if (typeof agent.max_active_sessions === "number") {
        existingGroup.maxActiveSessions = agent.max_active_sessions;
      }
      if (agent.wake_mode) {
        existingGroup.wakeMode = agent.wake_mode;
      }
      if (agent.named_session_mode) {
        existingGroup.namedSessionMode = agent.named_session_mode;
      }
      if (agent.scope) {
        existingGroup.scope = agent.scope;
      }
      Object.assign(existingGroup, gcAgentVirtualMetadata(agent));
      return;
    }
    rigGroup.agentGroupsById.set(qualifiedName, {
      id: `${rigGroup.id}/${qualifiedName}`,
      label: agentFolderLabel(qualifiedName),
      qualifiedName,
      isConfigured: true,
      isPool: agent.is_pool ?? false,
      isExplicitlySuspended: agent.suspended,
      isSuspended: rigGroup.isSuspended || agent.suspended,
      ...(typeof agent.min_active_sessions === "number"
        ? { minActiveSessions: agent.min_active_sessions }
        : {}),
      ...(typeof agent.max_active_sessions === "number"
        ? { maxActiveSessions: agent.max_active_sessions }
        : {}),
      ...(agent.wake_mode ? { wakeMode: agent.wake_mode } : {}),
      ...(agent.named_session_mode ? { namedSessionMode: agent.named_session_mode } : {}),
      ...(agent.scope ? { scope: agent.scope } : {}),
      ...gcAgentVirtualMetadata(agent),
      threads: [],
    });
  };

  const isCityAliasProject = [...projectLabels].some((label) =>
    ["city", "gc"].some(
      (alias) => label.localeCompare(alias, undefined, { sensitivity: "accent" }) === 0,
    ),
  );
  const isCityProject = Boolean(
    workspaceName &&
    ([...projectLabels].some(
      (label) => label.localeCompare(workspaceName, undefined, { sensitivity: "accent" }) === 0,
    ) ||
      isCityAliasProject),
  );
  let cityScopedRigGroupId: string | null = null;
  const configRigs = options?.config?.rigs ?? [];
  const configRigByName = new Map(configRigs.map((rig) => [rig.name, rig] as const));
  const threadReferencedRigIds = new Set<string>();
  for (const thread of threads) {
    const meta = parseGcMeta(thread.customMetadata);
    const resolvedCity = normalizeMetadataValue(meta.city);
    const canonicalGroupId = normalizeMetadataValue(meta.groupId);
    const rig = normalizeMetadataValue(meta.rig);
    const agent = normalizeMetadataValue(meta.agentQualified) ?? normalizeMetadataValue(meta.agent);
    const cityWorkspaceGroupId =
      resolvedCity && multiCityWorkspaceIds.has(resolvedCity) ? resolvedCity : null;
    let resolvedRig =
      meta.groupKind === "workspace" && cityWorkspaceGroupId
        ? cityWorkspaceGroupId
        : (canonicalGroupId ?? rig ?? deriveRigIdFromQualifiedAgent(agent ?? ""));
    resolvedRig = qualifyMergedMultiCityRigId({
      rig: resolvedRig,
      city: resolvedCity,
      isMergedMultiCityConfig,
      multiCityWorkspaceIds,
      configRigByName,
    });
    if (resolvedRig) {
      threadReferencedRigIds.add(resolvedRig);
    }
  }
  const directlyRelevantRigs = configRigs.filter(
    (rig) =>
      projectCwds.size === 0 ||
      projectContextMatchesRigPath(projectCwds, rig.path) ||
      threadReferencedRigIds.has(rig.name),
  );
  const shouldIncludeMultiCityRoots = isGlobalScope || isCityProject;
  const relevantRigs =
    isMergedMultiCityConfig && shouldIncludeMultiCityRoots
      ? expandRelevantRigsWithMultiCityRoots(
          configRigs,
          directlyRelevantRigs,
          multiCityWorkspaceIds,
        )
      : directlyRelevantRigs;
  const displayRigs =
    isMergedMultiCityConfig && workspaceName
      ? relevantRigs.filter(
          (rig) =>
            rig.name.localeCompare(workspaceName, undefined, { sensitivity: "accent" }) !== 0,
        )
      : relevantRigs;
  if (displayRigs && displayRigs.length > 0) {
    const relevantRigNames = new Set(displayRigs.map((rig) => rig.name));
    for (const rig of displayRigs) {
      const isMultiCityWorkspace = isMergedMultiCityConfig && multiCityWorkspaceIds.has(rig.name);
      rigGroupsById.set(rig.name, {
        id: rig.name,
        label: rig.name,
        kind: isMultiCityWorkspace ? "workspace" : "rig",
        isConfigured: true,
        isSuspended: rig.suspended,
        ...(rig.lifecycle ? { lifecycle: rig.lifecycle } : {}),
        agentGroupsById: new Map(),
      });
    }

    if ((isCityProject || isGlobalScope) && workspaceName) {
      const workspaceRig = displayRigs.find(
        (rig) => rig.name.localeCompare(workspaceName, undefined, { sensitivity: "accent" }) === 0,
      );
      if (workspaceRig) {
        cityScopedRigGroupId = workspaceRig.name;
        const existingWorkspaceRig = rigGroupsById.get(workspaceRig.name);
        if (existingWorkspaceRig) {
          existingWorkspaceRig.kind = "workspace";
          existingWorkspaceRig.label = workspaceName.toUpperCase();
          existingWorkspaceRig.isSuspended = workspaceSuspended;
          if (workspaceRig.lifecycle) {
            existingWorkspaceRig.lifecycle = workspaceRig.lifecycle;
          } else if (options?.config?.lifecycle) {
            existingWorkspaceRig.lifecycle = options.config.lifecycle;
          }
        }
      }
    }

    for (const agent of options?.config?.agents ?? []) {
      if (isImplicitProviderLane(agent)) {
        continue;
      }
      const rigName = normalizeMetadataValue(agent.dir);
      if (!rigName || !relevantRigNames.has(rigName)) {
        continue;
      }
      const rigGroup = rigGroupsById.get(rigName);
      if (!rigGroup) {
        continue;
      }
      addConfiguredAgentGroup(rigGroup, agent);
    }
  }

  if (
    (!cityScopedRigGroupId || !rigGroupsById.has(cityScopedRigGroupId)) &&
    workspaceName &&
    (isCityProject || isGlobalScope) &&
    !isMergedMultiCityConfig
  ) {
    const cityGroupId = workspaceName;
    cityScopedRigGroupId = cityGroupId;
    rigGroupsById.set(cityGroupId, {
      id: cityGroupId,
      label:
        isCityAliasProject && projectName ? projectName.toUpperCase() : workspaceName.toUpperCase(),
      kind: "workspace",
      isConfigured: true,
      isSuspended: workspaceSuspended,
      ...(options?.config?.lifecycle ? { lifecycle: options.config.lifecycle } : {}),
      agentGroupsById: new Map(),
    });
  }

  if (cityScopedRigGroupId) {
    const cityGroup = rigGroupsById.get(cityScopedRigGroupId);
    if (cityGroup) {
      for (const agent of options?.config?.agents ?? []) {
        if (isImplicitProviderLane(agent)) {
          continue;
        }
        const rigName = normalizeMetadataValue(agent.dir);
        if (rigName) continue;
        addConfiguredAgentGroup(cityGroup, agent);
      }
    }
  }

  for (const thread of threads) {
    const meta = parseGcMeta(thread.customMetadata);
    const rig = normalizeMetadataValue(meta.rig);
    const agent = normalizeMetadataValue(meta.agent);
    const resolvedCity = normalizeMetadataValue(meta.city);
    const canonicalGroupId = normalizeMetadataValue(meta.groupId);
    const canonicalGroupLabel = normalizeMetadataValue(meta.groupLabel);
    const canonicalAgentQualified = normalizeMetadataValue(meta.agentQualified);
    const canonicalAgentLabel = normalizeMetadataValue(meta.agentLabel);
    const cityWorkspaceGroupId =
      resolvedCity && multiCityWorkspaceIds.has(resolvedCity) ? resolvedCity : cityScopedRigGroupId;
    let resolvedRig =
      meta.groupKind === "workspace" && cityWorkspaceGroupId
        ? cityWorkspaceGroupId
        : (canonicalGroupId ?? rig ?? null);
    let resolvedAgent = canonicalAgentQualified ?? agent;

    resolvedRig = qualifyMergedMultiCityRigId({
      rig: resolvedRig,
      city: resolvedCity,
      isMergedMultiCityConfig,
      multiCityWorkspaceIds,
      configRigByName,
    });

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

    resolvedRig = qualifyMergedMultiCityRigId({
      rig: resolvedRig,
      city: resolvedCity,
      isMergedMultiCityConfig,
      multiCityWorkspaceIds,
      configRigByName,
    });
    resolvedAgent = qualifyMergedMultiCityAgent({
      agent: resolvedAgent,
      city: resolvedCity,
      originalRig: rig,
      resolvedRig,
      isMergedMultiCityConfig,
      multiCityWorkspaceIds,
    });

    if (isMergedMultiCityConfig && resolvedCity && !multiCityWorkspaceIds.has(resolvedCity)) {
      standaloneThreads.push(thread);
      continue;
    }
    if (
      isMergedMultiCityConfig &&
      meta.groupKind === "workspace" &&
      resolvedRig &&
      !multiCityWorkspaceIds.has(resolvedRig)
    ) {
      standaloneThreads.push(thread);
      continue;
    }

    if ((!meta.isGcManaged && !resolvedAgent) || !resolvedRig || !resolvedAgent) {
      standaloneThreads.push(thread);
      continue;
    }

    let rigGroup = rigGroupsById.get(resolvedRig);
    if (rigGroup && meta.groupKind === "workspace" && canonicalGroupLabel) {
      rigGroup.label = canonicalGroupLabel;
    }
    const resolvedRigLifecycle =
      configRigByName.get(resolvedRig)?.lifecycle ??
      (resolvedRig === cityScopedRigGroupId ? options?.config?.lifecycle : undefined);
    if (rigGroup && !rigGroup.lifecycle && resolvedRigLifecycle) {
      rigGroup.lifecycle = resolvedRigLifecycle;
    }
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
        isSuspended:
          meta.groupKind === "workspace" || resolvedRig === cityScopedRigGroupId
            ? workspaceSuspended
            : false,
        ...(resolvedRigLifecycle ? { lifecycle: resolvedRigLifecycle } : {}),
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
      const configuredAgent = findConfiguredAgent(
        options?.config,
        existingAgentGroup.qualifiedName,
      );
      if (configuredAgent) {
        existingAgentGroup.isConfigured = true;
        existingAgentGroup.isPool = configuredAgent.is_pool ?? existingAgentGroup.isPool;
        existingAgentGroup.isExplicitlySuspended = configuredAgent.suspended;
        existingAgentGroup.isSuspended = ensuredRigGroup.isSuspended || configuredAgent.suspended;
        if (typeof configuredAgent.min_active_sessions === "number") {
          existingAgentGroup.minActiveSessions = configuredAgent.min_active_sessions;
        }
        if (typeof configuredAgent.max_active_sessions === "number") {
          existingAgentGroup.maxActiveSessions = configuredAgent.max_active_sessions;
        }
        if (configuredAgent.wake_mode) {
          existingAgentGroup.wakeMode = configuredAgent.wake_mode;
        }
        if (configuredAgent.named_session_mode) {
          existingAgentGroup.namedSessionMode = configuredAgent.named_session_mode;
        }
        if (configuredAgent.scope) {
          existingAgentGroup.scope = configuredAgent.scope;
        }
        Object.assign(existingAgentGroup, gcAgentVirtualMetadata(configuredAgent));
      }
      continue;
    }

    const configuredAgent = findConfiguredAgent(options?.config, resolvedAgent);
    ensuredRigGroup.agentGroupsById.set(resolvedAgent, {
      id: `${resolvedRig}/${resolvedAgent}`,
      label: canonicalAgentLabel ?? agentFolderLabel(resolvedAgent),
      qualifiedName: resolvedAgent,
      isConfigured: Boolean(configuredAgent),
      isPool: configuredAgent?.is_pool ?? false,
      isExplicitlySuspended: configuredAgent?.suspended ?? false,
      isSuspended: ensuredRigGroup.isSuspended || configuredAgent?.suspended || false,
      ...(typeof configuredAgent?.min_active_sessions === "number"
        ? { minActiveSessions: configuredAgent.min_active_sessions }
        : {}),
      ...(typeof configuredAgent?.max_active_sessions === "number"
        ? { maxActiveSessions: configuredAgent.max_active_sessions }
        : {}),
      ...(configuredAgent?.wake_mode ? { wakeMode: configuredAgent.wake_mode } : {}),
      ...(configuredAgent?.named_session_mode
        ? { namedSessionMode: configuredAgent.named_session_mode }
        : {}),
      ...(configuredAgent?.scope ? { scope: configuredAgent.scope } : {}),
      ...gcAgentVirtualMetadata(configuredAgent),
      threads: [thread],
    });
  }

  if (options?.config && workspaceName) {
    for (const cityGroup of rigGroupsById.values()) {
      if (cityGroup.kind !== "workspace") {
        continue;
      }
      if (isMergedMultiCityConfig && !multiCityWorkspaceIds.has(cityGroup.id)) {
        continue;
      }
      cityGroup.isConfigured = true;
      cityGroup.isSuspended = cityGroup.isSuspended || workspaceSuspended;
      if (!cityGroup.lifecycle && options.config.lifecycle) {
        cityGroup.lifecycle = options.config.lifecycle;
      }
      for (const agent of options.config.agents) {
        if (isImplicitProviderLane(agent)) {
          continue;
        }
        if (normalizeMetadataValue(agent.dir)) {
          continue;
        }
        addConfiguredAgentGroup(cityGroup, agent);
      }
    }
  }

  return {
    standaloneThreads,
    rigGroups: Array.from(rigGroupsById.values())
      .toSorted((a, b) => a.label.localeCompare(b.label))
      .map((rigGroup) => {
        const result: VirtualRigGroup<TThread> = {
          id: rigGroup.id,
          label: rigGroup.label,
          kind: rigGroup.kind,
          isConfigured: rigGroup.isConfigured,
          isSuspended: rigGroup.isSuspended,
          agentGroups: Array.from(rigGroup.agentGroupsById.values()).toSorted((a, b) =>
            a.label.localeCompare(b.label),
          ),
        };
        if (rigGroup.lifecycle) {
          result.lifecycle = rigGroup.lifecycle;
        }
        return result;
      }),
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

export const GcStartInput = Schema.Struct({});
export type GcStartInput = typeof GcStartInput.Type;

export const GcSetSupervisorRunningInput = Schema.Struct({
  running: Schema.Boolean,
  city: Schema.optional(Schema.String),
});
export type GcSetSupervisorRunningInput = typeof GcSetSupervisorRunningInput.Type;

export const GcSetControllerRunningInput = Schema.Struct({
  running: Schema.Boolean,
  city: Schema.optional(Schema.String),
});
export type GcSetControllerRunningInput = typeof GcSetControllerRunningInput.Type;

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

export const GcAddRigInput = Schema.Struct({
  path: Schema.String,
  name: Schema.optional(Schema.String),
  startSuspended: Schema.optional(Schema.Boolean),
  includeGastown: Schema.optional(Schema.Boolean),
});
export type GcAddRigInput = typeof GcAddRigInput.Type;

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

export const GcSetAgentMinActiveSessionsInput = Schema.Struct({
  agent: Schema.String,
  minActiveSessions: Schema.Number,
});
export type GcSetAgentMinActiveSessionsInput = typeof GcSetAgentMinActiveSessionsInput.Type;

export const GcSetAgentWakeModeInput = Schema.Struct({
  agent: Schema.String,
  wakeMode: GcWakeMode,
});
export type GcSetAgentWakeModeInput = typeof GcSetAgentWakeModeInput.Type;

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

export const GcWakeSessionInput = Schema.Struct({
  sessionName: TrimmedNonEmptyString,
});
export type GcWakeSessionInput = typeof GcWakeSessionInput.Type;

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
  type: Schema.optional(Schema.String),
  assignee: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.String),
  ref: Schema.optional(Schema.String),
  labels: Schema.optional(Schema.Array(Schema.String)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  ephemeral: Schema.optional(Schema.Boolean),
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

const GcRuntimeMcpServerSchema = Schema.Struct({
  name: Schema.String,
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
  source: Schema.Literals(["projected", "source"]),
  path: Schema.optional(Schema.String),
});

const GcRuntimeSkillSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  source: Schema.Literals(["materialized", "source"]),
  description: Schema.optional(Schema.String),
});

const GcRuntimeDetailsSchema = Schema.Struct({
  workDir: Schema.optional(Schema.String),
  mcpConfigPath: Schema.optional(Schema.String),
  mcpServers: Schema.Array(GcRuntimeMcpServerSchema),
  skills: Schema.Array(GcRuntimeSkillSchema),
});

export const GcThreadContextResult = Schema.Struct({
  bead: Schema.NullOr(GcBeadSchema),
  convoy: Schema.NullOr(GcConvoySchema),
  formula: Schema.NullOr(GcFormulaSchema),
  runtime: Schema.optionalKey(GcRuntimeDetailsSchema),
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

export class GcStartError extends Schema.TaggedErrorClass<GcStartError>()("GcStartError", {
  message: Schema.String,
}) {}

export class GcSetSupervisorRunningError extends Schema.TaggedErrorClass<GcSetSupervisorRunningError>()(
  "GcSetSupervisorRunningError",
  { message: Schema.String },
) {}

export class GcSetControllerRunningError extends Schema.TaggedErrorClass<GcSetControllerRunningError>()(
  "GcSetControllerRunningError",
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

export class GcAddRigError extends Schema.TaggedErrorClass<GcAddRigError>()("GcAddRigError", {
  message: Schema.String,
}) {}

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

export class GcSetAgentMinActiveSessionsError extends Schema.TaggedErrorClass<GcSetAgentMinActiveSessionsError>()(
  "GcSetAgentMinActiveSessionsError",
  { message: Schema.String },
) {}

export class GcSetAgentWakeModeError extends Schema.TaggedErrorClass<GcSetAgentWakeModeError>()(
  "GcSetAgentWakeModeError",
  { message: Schema.String },
) {}

export class GcWakeSessionError extends Schema.TaggedErrorClass<GcWakeSessionError>()(
  "GcWakeSessionError",
  { message: Schema.String },
) {}
