import {
  ChevronRightIcon,
  FolderIcon,
  LoaderCircleIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { SidebarMenuSubItem } from "../components/ui/sidebar";
import { Badge } from "../components/ui/badge";
import type { GcLifecycleStatus, ThreadId } from "@t3tools/contracts";
import type { SidebarGcThreadGroupingMode } from "@t3tools/contracts/settings";
import {
  type GcAgentActionState,
  type GcWakeMode,
  gcSessionNameForQualifiedAgent,
  summarizeGcRuntimeStates,
} from "./sidebar/gcSidebarControls";
import {
  isGcSidebarFolderExpanded,
  useGcSidebarUiStateStore,
} from "./sidebar/gcSidebarUiStateStore";

export interface SidebarGcThreadGroup {
  id: string;
  label: string;
  kind: "convoy" | "formula";
  status?: string;
  progressLabel?: string;
  threadIds: readonly ThreadId[];
  agentGroups?: readonly SidebarGcAgentGroup[];
}

export interface SidebarGcAgentGroup {
  id: string;
  label: string;
  qualifiedName: string;
  isExplicitlySuspended: boolean;
  isSuspended: boolean;
  isPool: boolean;
  minActiveSessions?: number;
  maxActiveSessions?: number;
  wakeMode?: GcWakeMode;
  namedSessionMode?: "always" | "on_demand";
  scope?: string;
  provider?: string;
  description?: string;
  workDir?: string;
  promptTemplate?: string;
  startCommand?: string;
  defaultSlingFormula?: string;
  runtimeState: {
    label: string;
    tone: "info" | "muted" | "success" | "warning";
  };
  threadIds: readonly ThreadId[];
  threadGroups?: readonly SidebarGcThreadGroup[];
}

export interface SidebarGcRigGroup {
  id: string;
  label: string;
  kind: "workspace" | "rig";
  isConfigured?: boolean;
  isSuspended: boolean;
  lifecycle?: GcLifecycleStatus;
  agentGroups: readonly SidebarGcAgentGroup[];
  threadGroups?: readonly SidebarGcThreadGroup[];
}

function gcControlTestIdSuffix(value: string): string {
  return value.replaceAll("/", "--");
}

interface SidebarGcFoldersProps {
  rigGroups: readonly SidebarGcRigGroup[];
  flattenRootRigFolders?: boolean;
  flattenRigGroupIds?: ReadonlySet<string>;
  indentDepth?: number;
  nestedParentId?: string;
  workspaceActionScope?: "city" | "rig";
  gcAgentMutationsInFlight: ReadonlySet<string>;
  gcAgentStartsInFlight?: ReadonlySet<string>;
  gcSupervisorMutationInFlight?: boolean;
  gcControllerMutationInFlight?: boolean;
  gcCityControllerMutationsInFlight?: ReadonlySet<string>;
  gcRigMutationsInFlight: ReadonlySet<string>;
  gcCityMutationInFlight: boolean;
  gcThreadGroupingMode: SidebarGcThreadGroupingMode;
  gcAgentActionStateByAgent: ReadonlyMap<string, GcAgentActionState>;
  gcRigActionStateByRig: ReadonlyMap<string, "resume" | "suspend">;
  gcCityActionState: "resume" | "suspend" | null;
  onToggleCitySuspended: (
    suspended: boolean,
    affectedAgents: readonly SidebarGcAgentGroup[],
  ) => void;
  onToggleRigSuspended: (
    rig: string,
    suspended: boolean,
    affectedAgents: readonly SidebarGcAgentGroup[],
  ) => void;
  onToggleAgentSuspended: (
    agent: string,
    suspended: boolean,
    agentGroup: SidebarGcAgentGroup,
  ) => void;
  onAdjustAgentMinActiveSessions: (agent: string, minActiveSessions: number) => void;
  onAdjustAgentMaxActiveSessions: (agent: string, maxActiveSessions: number) => void;
  onWakeAgentSession?: (agent: string, sessionName?: string) => void;
  onToggleAgentWakeMode: (agent: string, wakeMode: GcWakeMode) => void;
  onToggleAgentSessionMode: (agent: string, mode: "always" | "on_demand") => void;
  onSetSupervisorRunning?: (city: string, running: boolean) => void;
  onSetControllerRunning?: (city: string, running: boolean) => void;
  renderWorkspaceRows?: (workspaceId: string) => ReactNode;
  renderThreadRows: (threadIds: readonly ThreadId[], indentClassName?: string) => ReactNode;
}

function statusBadgeClassName(tone: "info" | "muted" | "success" | "warning"): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "warning":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "info":
      return "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "muted":
      return "border-border/70 bg-muted/60 text-muted-foreground";
  }
}

function gcConfigToggleLabel(
  kind: "workspace" | "rig" | "agent",
  label: string,
  isSuspended: boolean,
): string {
  if (isSuspended) {
    return kind === "workspace"
      ? `Resume city ${label} in config`
      : kind === "rig"
        ? `Resume rig ${label} in config`
        : `Resume ${label} in config`;
  }

  return kind === "workspace"
    ? `Suspend city ${label} in config`
    : kind === "rig"
      ? `Suspend rig ${label} in config`
      : `Suspend ${label} in config`;
}

const NON_WAKEABLE_AGENT_RUNTIME_LABELS = new Set(["Running", "Ready", "Connecting", "Starting"]);

function hasVisibleAgentThreads(agentGroup: SidebarGcAgentGroup): boolean {
  return (
    agentGroup.threadIds.length > 0 ||
    Boolean(agentGroup.threadGroups?.some((threadGroup) => threadGroup.threadIds.length > 0))
  );
}

function canWakeAgentSession(agentGroup: SidebarGcAgentGroup): boolean {
  return (
    Boolean(agentGroup.namedSessionMode) &&
    !agentGroup.isPool &&
    !agentGroup.isSuspended &&
    (!NON_WAKEABLE_AGENT_RUNTIME_LABELS.has(agentGroup.runtimeState.label) ||
      !hasVisibleAgentThreads(agentGroup))
  );
}

const RIG_FOLDER_INDENT_CLASSES = ["px-2", "px-4", "px-6"] as const;
const AGENT_FOLDER_INDENT_CLASSES = ["px-4", "px-6", "px-8"] as const;
const THREAD_GROUP_INDENT_CLASSES = ["px-6", "px-8", "px-10"] as const;
const THREAD_INDENT_CLASSES = ["pl-6", "pl-8", "pl-10"] as const;
const CONVOY_AGENT_INDENT_CLASSES = ["px-6", "px-8", "px-10"] as const;
const CONVOY_THREAD_GROUP_INDENT_CLASSES = ["px-8", "px-10", "px-12"] as const;
const CONVOY_THREAD_INDENT_CLASSES = ["pl-10", "pl-12", "pl-14"] as const;

function gcDepthClassName(depth: number, classNames: readonly string[]): string {
  return classNames[Math.min(depth, classNames.length - 1)] ?? classNames[0] ?? "";
}

function gcNestedRigParentId(
  rigGroup: SidebarGcRigGroup,
  workspaceGroupIds: ReadonlySet<string>,
  unscopedRigParentId?: string | null,
): string | null {
  if (rigGroup.kind === "workspace") {
    return null;
  }
  const segments = rigGroup.id.split("/").filter(Boolean);
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const candidate = segments.slice(0, index).join("/");
    if (workspaceGroupIds.has(candidate)) {
      return candidate;
    }
  }
  if (unscopedRigParentId) {
    return unscopedRigParentId;
  }
  return null;
}

function gcRigGroupDisplayLabel(rigGroup: SidebarGcRigGroup, parentId: string | undefined): string {
  const label = rigGroup.label.trim();
  const fallbackLabel =
    rigGroup.id.split("/").toReversed().find(Boolean) ??
    (rigGroup.kind === "workspace" ? "City" : "Rig");
  if (!parentId) {
    return label || fallbackLabel;
  }
  const parentPrefix = `${parentId}/`;
  if (label.startsWith(parentPrefix)) {
    return label.slice(parentPrefix.length) || fallbackLabel;
  }
  if (label === rigGroup.id && rigGroup.id.startsWith(parentPrefix)) {
    return rigGroup.id.slice(parentPrefix.length) || fallbackLabel;
  }
  return label || fallbackLabel;
}

function gcAgentEffectiveRuntimeState(
  rigGroup: SidebarGcRigGroup,
  agentGroup: SidebarGcAgentGroup,
): SidebarGcAgentGroup["runtimeState"] {
  if (rigGroup.kind === "rig" && rigGroup.isSuspended && !agentGroup.isExplicitlySuspended) {
    return {
      label: "Rig suspended",
      tone: "muted",
    };
  }
  return agentGroup.runtimeState;
}

function GcThreadGroupBadges({
  threadGroup,
  primary,
}: {
  threadGroup: SidebarGcThreadGroup;
  primary: boolean;
}) {
  return (
    <>
      <Badge
        size="sm"
        variant="outline"
        className="rounded-full px-1.5 text-[.55rem] tracking-wide uppercase"
      >
        {threadGroup.kind}
      </Badge>
      {threadGroup.kind === "convoy" ? (
        <Badge
          size="sm"
          variant="outline"
          className="rounded-full px-1.5 text-[.55rem] tracking-wide uppercase"
        >
          {primary ? "primary" : "secondary"}
        </Badge>
      ) : null}
    </>
  );
}

export function SidebarGcFolders(props: SidebarGcFoldersProps) {
  const folderExpandedById = useGcSidebarUiStateStore((state) => state.folderExpandedById);
  const toggleFolderExpanded = useGcSidebarUiStateStore((state) => state.toggleFolderExpanded);
  const workspaceSuspensionHint =
    "Workspace is suspended. Gas City will not start or reconcile agents until GC is resumed.";
  const indentDepth = props.indentDepth ?? 0;
  const workspaceActionScope = props.workspaceActionScope ?? "city";
  const workspaceGroupIds = new Set(
    props.rigGroups
      .filter((rigGroup) => rigGroup.kind === "workspace")
      .map((rigGroup) => rigGroup.id),
  );
  const singleWorkspaceGroupId =
    !props.nestedParentId && workspaceGroupIds.size === 1
      ? ([...workspaceGroupIds][0] ?? null)
      : null;
  const nestedRigIds = new Set<string>();
  const childRigGroupsByWorkspaceId = new Map<string, SidebarGcRigGroup[]>();
  for (const rigGroup of props.rigGroups) {
    const parentId = gcNestedRigParentId(rigGroup, workspaceGroupIds, singleWorkspaceGroupId);
    if (!parentId) {
      continue;
    }
    nestedRigIds.add(rigGroup.id);
    const existing = childRigGroupsByWorkspaceId.get(parentId) ?? [];
    existing.push(rigGroup);
    childRigGroupsByWorkspaceId.set(parentId, existing);
  }
  const visibleRigGroups = props.nestedParentId
    ? props.rigGroups
    : props.rigGroups.filter((rigGroup) => !nestedRigIds.has(rigGroup.id));
  const flattenedRootRigGroup =
    props.flattenRootRigFolders &&
    !props.nestedParentId &&
    visibleRigGroups.length === 1 &&
    (visibleRigGroups[0]?.kind === "rig" || visibleRigGroups[0]?.kind === "workspace")
      ? visibleRigGroups[0]
      : null;
  const isConfiguredRigActionDisabled = (rigGroup: SidebarGcRigGroup): boolean =>
    rigGroup.kind === "rig" && rigGroup.isConfigured === false;
  const rigFolderIndentClassName = gcDepthClassName(indentDepth, RIG_FOLDER_INDENT_CLASSES);
  const agentFolderIndentClassName = gcDepthClassName(indentDepth, AGENT_FOLDER_INDENT_CLASSES);
  const threadGroupIndentClassName = gcDepthClassName(indentDepth, THREAD_GROUP_INDENT_CLASSES);
  const threadIndentClassName = gcDepthClassName(indentDepth, THREAD_INDENT_CLASSES);

  const rigFolderKey = (rigId: string) => `rig:${rigId}`;
  const workspaceFolderKey = (rigId: string) => `workspace:${rigId}`;
  const agentFolderKey = (agentId: string) => `agent:${agentId}`;
  const threadGroupFolderKey = (groupId: string) => `thread-group:${groupId}`;
  const isFolderExpanded = (folderId: string) =>
    isGcSidebarFolderExpanded(folderExpandedById, folderId);

  const renderAgentGroup = (
    rigGroup: SidebarGcRigGroup,
    agentGroup: SidebarGcAgentGroup,
    options: {
      readonly agentIndentClassName: string;
      readonly threadIndentClassName: string;
      readonly threadGroupIndentClassName: string;
      readonly keyPrefix?: string;
    },
  ) => {
    const isMutating = props.gcAgentMutationsInFlight.has(agentGroup.qualifiedName);
    const actionState = props.gcAgentActionStateByAgent.get(agentGroup.qualifiedName);
    const displayRuntimeState = gcAgentEffectiveRuntimeState(rigGroup, agentGroup);
    const actionLabel = gcConfigToggleLabel(
      "agent",
      agentGroup.qualifiedName,
      agentGroup.isExplicitlySuspended,
    );
    const hasScaleControls = agentGroup.isPool;
    const showNamedSessionModeControl = Boolean(agentGroup.namedSessionMode);
    const nextNamedSessionMode = !showNamedSessionModeControl
      ? null
      : agentGroup.namedSessionMode === "always"
        ? "on_demand"
        : agentGroup.namedSessionMode === "on_demand"
          ? "always"
          : null;
    const sessionModeLabel = !showNamedSessionModeControl
      ? null
      : agentGroup.namedSessionMode === "always"
        ? "auto"
        : agentGroup.namedSessionMode === "on_demand"
          ? "demand"
          : null;
    const maxActiveSessions = agentGroup.maxActiveSessions;
    const canAdjustPoolSize =
      hasScaleControls &&
      !isMutating &&
      !agentGroup.isSuspended &&
      !rigGroup.isSuspended &&
      !props.gcCityMutationInFlight;
    const canIncreasePool =
      canAdjustPoolSize &&
      (typeof agentGroup.maxActiveSessions !== "number" ||
        typeof agentGroup.minActiveSessions !== "number" ||
        agentGroup.minActiveSessions < agentGroup.maxActiveSessions);
    const canDecreasePool =
      canAdjustPoolSize &&
      typeof agentGroup.minActiveSessions === "number" &&
      agentGroup.minActiveSessions > 0;
    const canAdjustPoolMaximum = canAdjustPoolSize && typeof maxActiveSessions === "number";
    const canIncreasePoolMaximum = canAdjustPoolMaximum;
    const canDecreasePoolMaximum =
      canAdjustPoolMaximum &&
      (maxActiveSessions ?? 0) > Math.max(0, agentGroup.minActiveSessions ?? 0);
    const canShowWakeSession = Boolean(props.onWakeAgentSession) && canWakeAgentSession(agentGroup);
    const canWakeSession =
      canShowWakeSession &&
      canWakeAgentSession(agentGroup) &&
      !rigGroup.isSuspended &&
      !isMutating &&
      !actionState &&
      !props.gcAgentStartsInFlight?.has(agentGroup.qualifiedName);
    const fragmentKey = `${options.keyPrefix ?? ""}${agentGroup.qualifiedName}`;
    const wakeSessionName =
      rigGroup.kind === "workspace"
        ? gcSessionNameForQualifiedAgent(agentGroup.qualifiedName, {
            cityWorkspaceId: rigGroup.id,
          })
        : gcSessionNameForQualifiedAgent(agentGroup.qualifiedName);
    const groupedThreadIds = new Set(
      (agentGroup.threadGroups ?? []).flatMap((threadGroup) => threadGroup.threadIds),
    );
    const ungroupedThreadIds = agentGroup.threadIds.filter(
      (threadId) => !groupedThreadIds.has(threadId),
    );

    return (
      <Fragment key={fragmentKey}>
        <SidebarMenuSubItem
          className="w-full"
          data-testid={`gc-agent-folder-${gcControlTestIdSuffix(fragmentKey)}`}
        >
          <div
            className={`flex items-center gap-1.5 py-0.5 text-muted-foreground/60 ${options.agentIndentClassName}`}
          >
            <button
              type="button"
              data-thread-selection-safe
              data-testid={`gc-agent-folder-toggle-${gcControlTestIdSuffix(fragmentKey)}`}
              aria-expanded={isFolderExpanded(agentFolderKey(fragmentKey))}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleFolderExpanded(agentFolderKey(fragmentKey));
              }}
            >
              <ChevronRightIcon
                className={`size-3 shrink-0 transition-transform ${
                  isFolderExpanded(agentFolderKey(fragmentKey)) ? "rotate-90" : ""
                }`}
              />
              <FolderIcon className="size-3 shrink-0" />
              <span className="truncate text-xs font-medium leading-none">{agentGroup.label}</span>
            </button>
            <div className="ml-auto flex items-center gap-1" data-thread-selection-safe>
              {canShowWakeSession ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-thread-selection-safe
                        data-testid={`gc-agent-wake-${gcControlTestIdSuffix(fragmentKey)}`}
                        data-gc-agent={agentGroup.qualifiedName}
                        aria-label={`Wake ${agentGroup.qualifiedName}`}
                        disabled={!canWakeSession}
                        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-50"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          props.onWakeAgentSession?.(agentGroup.qualifiedName, wakeSessionName);
                        }}
                      >
                        {actionState?.kind === "wake" ||
                        props.gcAgentStartsInFlight?.has(agentGroup.qualifiedName) ? (
                          <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
                        ) : (
                          <RotateCcwIcon className="size-3.5 shrink-0" />
                        )}
                      </button>
                    }
                  />
                  <TooltipPopup side="top">Wake session</TooltipPopup>
                </Tooltip>
              ) : null}
              {hasScaleControls ? (
                <div className="flex items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`gc-agent-pool-min-decrement-${gcControlTestIdSuffix(fragmentKey)}`}
                          data-gc-agent={agentGroup.qualifiedName}
                          aria-label={`Decrease minimum active sessions for ${agentGroup.qualifiedName}`}
                          disabled={!canDecreasePool}
                          className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            props.onAdjustAgentMinActiveSessions(
                              agentGroup.qualifiedName,
                              Math.max(0, (agentGroup.minActiveSessions ?? 0) - 1),
                            );
                          }}
                        >
                          <MinusIcon className="size-3" />
                        </button>
                      }
                    />
                    <TooltipPopup side="top">Decrease minimum active sessions</TooltipPopup>
                  </Tooltip>
                  <Badge
                    size="sm"
                    variant="outline"
                    data-testid={`gc-agent-pool-min-${gcControlTestIdSuffix(fragmentKey)}`}
                    className="rounded-full px-1.5 text-[.55rem] tracking-wide uppercase"
                  >
                    min {agentGroup.minActiveSessions ?? 0}
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`gc-agent-pool-min-increment-${gcControlTestIdSuffix(fragmentKey)}`}
                          data-gc-agent={agentGroup.qualifiedName}
                          aria-label={`Increase minimum active sessions for ${agentGroup.qualifiedName}`}
                          disabled={!canIncreasePool}
                          className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            props.onAdjustAgentMinActiveSessions(
                              agentGroup.qualifiedName,
                              (agentGroup.minActiveSessions ?? 0) + 1,
                            );
                          }}
                        >
                          <PlusIcon className="size-3" />
                        </button>
                      }
                    />
                    <TooltipPopup side="top">Increase minimum active sessions</TooltipPopup>
                  </Tooltip>
                </div>
              ) : null}
              {hasScaleControls && typeof maxActiveSessions === "number" ? (
                <div className="flex items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`gc-agent-pool-decrement-${gcControlTestIdSuffix(fragmentKey)}`}
                          data-gc-agent={agentGroup.qualifiedName}
                          aria-label={`Decrease maximum active sessions for ${agentGroup.qualifiedName}`}
                          disabled={!canDecreasePoolMaximum}
                          className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            props.onAdjustAgentMaxActiveSessions(
                              agentGroup.qualifiedName,
                              Math.max(
                                Math.max(0, agentGroup.minActiveSessions ?? 0),
                                maxActiveSessions - 1,
                              ),
                            );
                          }}
                        >
                          <MinusIcon className="size-3" />
                        </button>
                      }
                    />
                    <TooltipPopup side="top">Decrease maximum active sessions</TooltipPopup>
                  </Tooltip>
                  <Badge
                    size="sm"
                    variant="outline"
                    data-testid={`gc-agent-pool-max-${gcControlTestIdSuffix(fragmentKey)}`}
                    className="rounded-full px-1.5 text-[.55rem] tracking-wide uppercase"
                  >
                    max {maxActiveSessions}
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`gc-agent-pool-increment-${gcControlTestIdSuffix(fragmentKey)}`}
                          data-gc-agent={agentGroup.qualifiedName}
                          aria-label={`Increase maximum active sessions for ${agentGroup.qualifiedName}`}
                          disabled={!canIncreasePoolMaximum}
                          className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-50"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            props.onAdjustAgentMaxActiveSessions(
                              agentGroup.qualifiedName,
                              maxActiveSessions + 1,
                            );
                          }}
                        >
                          <PlusIcon className="size-3" />
                        </button>
                      }
                    />
                    <TooltipPopup side="top">Increase maximum active sessions</TooltipPopup>
                  </Tooltip>
                </div>
              ) : null}
              {nextNamedSessionMode ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-thread-selection-safe
                        data-testid={`gc-agent-session-mode-${gcControlTestIdSuffix(fragmentKey)}`}
                        data-gc-agent={agentGroup.qualifiedName}
                        aria-label={`Switch ${agentGroup.qualifiedName} to ${nextNamedSessionMode} sessions`}
                        disabled={isMutating}
                        className="inline-flex h-5 cursor-pointer items-center justify-center rounded-md px-1.5 text-[.55rem] font-medium tracking-wide text-muted-foreground/70 uppercase transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-50"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          props.onToggleAgentSessionMode(
                            agentGroup.qualifiedName,
                            nextNamedSessionMode,
                          );
                        }}
                      >
                        {sessionModeLabel}
                      </button>
                    }
                  />
                  <TooltipPopup side="top">Switch named session mode</TooltipPopup>
                </Tooltip>
              ) : null}
              {agentGroup.wakeMode ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-thread-selection-safe
                        data-testid={`gc-agent-wake-mode-${gcControlTestIdSuffix(fragmentKey)}`}
                        data-gc-agent={agentGroup.qualifiedName}
                        aria-label={`Switch ${agentGroup.qualifiedName} wake mode`}
                        disabled={isMutating}
                        className="inline-flex h-5 cursor-pointer items-center justify-center rounded-md px-1.5 text-[.55rem] font-medium tracking-wide text-muted-foreground/70 uppercase transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-50"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          props.onToggleAgentWakeMode(
                            agentGroup.qualifiedName,
                            agentGroup.wakeMode === "resume" ? "fresh" : "resume",
                          );
                        }}
                      >
                        {agentGroup.wakeMode}
                      </button>
                    }
                  />
                  <TooltipPopup side="top">Switch wake mode</TooltipPopup>
                </Tooltip>
              ) : null}
              <Badge
                size="sm"
                variant="outline"
                data-testid={`gc-agent-status-${gcControlTestIdSuffix(fragmentKey)}`}
                className={`rounded-full px-1.5 text-[.55rem] tracking-wide uppercase ${statusBadgeClassName(
                  displayRuntimeState.tone,
                )}`}
              >
                {displayRuntimeState.label}
              </Badge>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-thread-selection-safe
                      data-testid={`gc-agent-toggle-${gcControlTestIdSuffix(fragmentKey)}`}
                      data-gc-agent-action={gcControlTestIdSuffix(fragmentKey)}
                      data-gc-agent={agentGroup.qualifiedName}
                      data-gc-action-icon={
                        isMutating ? "loading" : agentGroup.isExplicitlySuspended ? "play" : "stop"
                      }
                      aria-label={actionLabel}
                      disabled={isMutating}
                      className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onToggleAgentSuspended(
                          agentGroup.qualifiedName,
                          !agentGroup.isExplicitlySuspended,
                          agentGroup,
                        );
                      }}
                    >
                      {isMutating ? (
                        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
                      ) : agentGroup.isExplicitlySuspended ? (
                        <PlayIcon className="size-3.5 shrink-0" />
                      ) : (
                        <SquareIcon className="size-3.5 shrink-0" />
                      )}
                    </button>
                  }
                />
                <TooltipPopup side="top">{actionLabel}</TooltipPopup>
              </Tooltip>
            </div>
          </div>
        </SidebarMenuSubItem>
        {isFolderExpanded(agentFolderKey(fragmentKey)) &&
          (agentGroup.threadGroups && agentGroup.threadGroups.length > 0 ? (
            <>
              {agentGroup.threadGroups.map((threadGroup) => {
                const groupKey = `${fragmentKey}:${threadGroup.id}`;
                const groupExpanded = isFolderExpanded(threadGroupFolderKey(groupKey));
                return (
                  <Fragment key={groupKey}>
                    <SidebarMenuSubItem
                      className="w-full"
                      data-thread-selection-safe
                      data-testid={`gc-thread-group-${gcControlTestIdSuffix(groupKey)}`}
                    >
                      <div
                        className={`flex items-center gap-1.5 py-0.5 text-muted-foreground/60 ${options.threadGroupIndentClassName}`}
                      >
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`gc-thread-group-toggle-${gcControlTestIdSuffix(groupKey)}`}
                          aria-expanded={groupExpanded}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleFolderExpanded(threadGroupFolderKey(groupKey));
                          }}
                        >
                          <ChevronRightIcon
                            className={`size-3 shrink-0 transition-transform ${
                              groupExpanded ? "rotate-90" : ""
                            }`}
                          />
                          <FolderIcon className="size-3 shrink-0" />
                          <span className="truncate text-[11px] font-medium leading-none">
                            {threadGroup.label}
                          </span>
                          <GcThreadGroupBadges threadGroup={threadGroup} primary={false} />
                          {threadGroup.progressLabel ? (
                            <span className="text-[.625rem] text-muted-foreground/55">
                              {threadGroup.progressLabel}
                            </span>
                          ) : null}
                          {threadGroup.status ? (
                            <span className="text-[.625rem] text-muted-foreground/55">
                              {threadGroup.status}
                            </span>
                          ) : null}
                        </button>
                      </div>
                    </SidebarMenuSubItem>
                    {groupExpanded &&
                      props.renderThreadRows(threadGroup.threadIds, options.threadIndentClassName)}
                  </Fragment>
                );
              })}
              {ungroupedThreadIds.length > 0
                ? props.renderThreadRows(ungroupedThreadIds, options.threadIndentClassName)
                : null}
            </>
          ) : (
            props.renderThreadRows(agentGroup.threadIds, options.threadIndentClassName)
          ))}
      </Fragment>
    );
  };

  const renderRigGroupContents = (
    rigGroup: SidebarGcRigGroup,
    options: {
      readonly agentIndentClassName: string;
      readonly threadGroupIndentClassName: string;
      readonly threadIndentClassName: string;
    },
  ) =>
    props.gcThreadGroupingMode === "convoy" && rigGroup.threadGroups ? (
      <>
        {rigGroup.agentGroups.map((agentGroup) =>
          renderAgentGroup(
            rigGroup,
            {
              ...agentGroup,
              threadIds: [],
              threadGroups: [],
            },
            {
              agentIndentClassName: options.agentIndentClassName,
              threadGroupIndentClassName: options.threadGroupIndentClassName,
              threadIndentClassName: options.threadIndentClassName,
              keyPrefix: `${rigGroup.id}:controls:`,
            },
          ),
        )}
        {rigGroup.threadGroups.map((threadGroup) => {
          const groupKey = `${rigGroup.id}:${threadGroup.id}`;
          const groupExpanded = isFolderExpanded(threadGroupFolderKey(groupKey));
          return (
            <Fragment key={groupKey}>
              <SidebarMenuSubItem
                className="w-full"
                data-thread-selection-safe
                data-testid={`gc-thread-group-${gcControlTestIdSuffix(groupKey)}`}
              >
                <div
                  className={`flex items-center gap-1.5 py-0.5 text-muted-foreground/60 ${options.agentIndentClassName}`}
                >
                  <button
                    type="button"
                    data-thread-selection-safe
                    data-testid={`gc-thread-group-toggle-${gcControlTestIdSuffix(groupKey)}`}
                    aria-expanded={groupExpanded}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleFolderExpanded(threadGroupFolderKey(groupKey));
                    }}
                  >
                    <ChevronRightIcon
                      className={`size-3 shrink-0 transition-transform ${
                        groupExpanded ? "rotate-90" : ""
                      }`}
                    />
                    <FolderIcon className="size-3 shrink-0" />
                    <span className="truncate text-[11px] font-medium leading-none">
                      {threadGroup.label}
                    </span>
                    <GcThreadGroupBadges threadGroup={threadGroup} primary />
                    {threadGroup.progressLabel ? (
                      <span className="text-[.625rem] text-muted-foreground/55">
                        {threadGroup.progressLabel}
                      </span>
                    ) : null}
                    {threadGroup.status ? (
                      <span className="text-[.625rem] text-muted-foreground/55">
                        {threadGroup.status}
                      </span>
                    ) : null}
                  </button>
                </div>
              </SidebarMenuSubItem>
              {groupExpanded &&
                threadGroup.agentGroups?.map((agentGroup) =>
                  renderAgentGroup(rigGroup, agentGroup, {
                    agentIndentClassName: gcDepthClassName(
                      indentDepth,
                      CONVOY_AGENT_INDENT_CLASSES,
                    ),
                    threadGroupIndentClassName: gcDepthClassName(
                      indentDepth,
                      CONVOY_THREAD_GROUP_INDENT_CLASSES,
                    ),
                    threadIndentClassName: gcDepthClassName(
                      indentDepth,
                      CONVOY_THREAD_INDENT_CLASSES,
                    ),
                    keyPrefix: `${groupKey}:`,
                  }),
                )}
            </Fragment>
          );
        })}
      </>
    ) : (
      rigGroup.agentGroups.map((agentGroup) =>
        renderAgentGroup(rigGroup, agentGroup, {
          agentIndentClassName: options.agentIndentClassName,
          threadGroupIndentClassName: options.threadGroupIndentClassName,
          threadIndentClassName: options.threadIndentClassName,
        }),
      )
    );

  if (flattenedRootRigGroup) {
    return renderRigGroupContents(flattenedRootRigGroup, {
      agentIndentClassName: rigFolderIndentClassName,
      threadGroupIndentClassName: agentFolderIndentClassName,
      threadIndentClassName,
    });
  }

  return visibleRigGroups.map((rigGroup) => {
    const childRigGroups = childRigGroupsByWorkspaceId.get(rigGroup.id) ?? [];
    if (props.flattenRigGroupIds?.has(rigGroup.id)) {
      return (
        <Fragment key={`flattened-rig-${rigGroup.id}`}>
          {renderRigGroupContents(rigGroup, {
            agentIndentClassName: rigFolderIndentClassName,
            threadGroupIndentClassName: agentFolderIndentClassName,
            threadIndentClassName,
          })}
          {isFolderExpanded(rigFolderKey(rigGroup.id)) && childRigGroups.length > 0 ? (
            <SidebarGcFolders
              {...props}
              rigGroups={childRigGroups}
              indentDepth={indentDepth}
              nestedParentId={rigGroup.id}
              workspaceActionScope={workspaceActionScope}
            />
          ) : null}
        </Fragment>
      );
    }
    const displayLabel = gcRigGroupDisplayLabel(rigGroup, props.nestedParentId);
    const isCityFolder = rigGroup.kind === "workspace";
    const lifecycle = isCityFolder ? rigGroup.lifecycle : undefined;
    const supervisorMutationInFlight = Boolean(props.gcSupervisorMutationInFlight && lifecycle);
    const controllerMutationInFlight = Boolean(
      lifecycle &&
      (props.gcControllerMutationInFlight ||
        props.gcCityControllerMutationsInFlight?.has(rigGroup.id)),
    );
    const supervisorActionLabel = lifecycle?.supervisorRunning
      ? `Stop shared Gas City supervisor from ${displayLabel}`
      : `Start shared Gas City supervisor from ${displayLabel}`;
    const controllerActionLabel = lifecycle?.controllerRunning
      ? `Suspend city controller for ${displayLabel}`
      : `Resume city controller for ${displayLabel}`;
    const cityFolderUsesRigAction = isCityFolder && workspaceActionScope === "rig";
    const workspaceActionState = cityFolderUsesRigAction
      ? props.gcRigActionStateByRig.get(rigGroup.id)
      : props.gcCityActionState;
    const workspaceMutationInFlight = cityFolderUsesRigAction
      ? props.gcRigMutationsInFlight.has(rigGroup.id)
      : props.gcCityMutationInFlight;
    const rigStateSummary =
      rigGroup.kind === "workspace"
        ? workspaceActionState === "resume"
          ? "Resuming"
          : workspaceActionState === "suspend"
            ? "Suspending"
            : summarizeGcRuntimeStates(
                rigGroup.agentGroups.map((agentGroup) => agentGroup.runtimeState),
                { suspended: rigGroup.isSuspended },
              )
        : props.gcRigActionStateByRig.get(rigGroup.id) === "resume"
          ? "Resuming"
          : props.gcRigActionStateByRig.get(rigGroup.id) === "suspend"
            ? "Suspending"
            : summarizeGcRuntimeStates(
                rigGroup.agentGroups.map((agentGroup) => agentGroup.runtimeState),
                { suspended: rigGroup.isSuspended },
              );
    const renderDirectAgentGroups = (keyPrefix?: string) =>
      rigGroup.agentGroups.map((agentGroup) =>
        renderAgentGroup(rigGroup, agentGroup, {
          agentIndentClassName: agentFolderIndentClassName,
          threadGroupIndentClassName,
          threadIndentClassName,
          ...(keyPrefix ? { keyPrefix } : {}),
        }),
      );
    const renderWorkspaceAgentFolder = () => {
      if (rigGroup.kind !== "workspace" || rigGroup.agentGroups.length === 0) {
        return null;
      }
      const workspaceKey = workspaceFolderKey(rigGroup.id);
      const workspaceExpanded = isFolderExpanded(workspaceKey);
      return (
        <Fragment key={`workspace-${rigGroup.id}`}>
          <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
            <div
              className={`flex items-center gap-1.5 py-0.5 text-muted-foreground/60 ${agentFolderIndentClassName}`}
            >
              <button
                type="button"
                data-thread-selection-safe
                aria-expanded={workspaceExpanded}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleFolderExpanded(workspaceKey);
                }}
              >
                <ChevronRightIcon
                  className={`size-3 shrink-0 transition-transform ${
                    workspaceExpanded ? "rotate-90" : ""
                  }`}
                />
                <FolderIcon className="size-3 shrink-0" />
                <span className="truncate text-[11px] font-medium leading-none">workspace</span>
              </button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-thread-selection-safe
                      data-testid={`gc-workspace-action-${gcControlTestIdSuffix(rigGroup.id)}`}
                      data-gc-action-icon={
                        workspaceMutationInFlight
                          ? "loading"
                          : rigGroup.isSuspended
                            ? "play"
                            : "stop"
                      }
                      aria-label={gcConfigToggleLabel(
                        "workspace",
                        `${displayLabel} workspace`,
                        rigGroup.isSuspended,
                      )}
                      disabled={workspaceMutationInFlight}
                      className="ml-auto inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (cityFolderUsesRigAction) {
                          props.onToggleRigSuspended(
                            rigGroup.id,
                            !rigGroup.isSuspended,
                            rigGroup.agentGroups,
                          );
                          return;
                        }
                        props.onToggleCitySuspended(!rigGroup.isSuspended, rigGroup.agentGroups);
                      }}
                    >
                      {workspaceMutationInFlight ? (
                        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
                      ) : rigGroup.isSuspended ? (
                        <PlayIcon className="size-3.5 shrink-0" />
                      ) : (
                        <SquareIcon className="size-3.5 shrink-0" />
                      )}
                    </button>
                  }
                />
                <TooltipPopup side="top">
                  <div className="space-y-1">
                    <div>
                      {gcConfigToggleLabel(
                        "workspace",
                        `${displayLabel} workspace`,
                        rigGroup.isSuspended,
                      )}
                    </div>
                    {rigGroup.isSuspended ? (
                      <div className="max-w-56 text-[10px] text-muted-foreground">
                        {workspaceSuspensionHint}
                      </div>
                    ) : null}
                  </div>
                </TooltipPopup>
              </Tooltip>
            </div>
          </SidebarMenuSubItem>
          {workspaceExpanded ? renderDirectAgentGroups(`${rigGroup.id}:workspace:`) : null}
        </Fragment>
      );
    };
    return (
      <Fragment key={`rig-${rigGroup.id}`}>
        <SidebarMenuSubItem
          className="w-full"
          data-testid={`gc-rig-folder-${gcControlTestIdSuffix(rigGroup.id)}`}
        >
          <div
            className={`flex items-center gap-1.5 py-1 text-foreground/75 uppercase ${rigFolderIndentClassName}`}
          >
            <button
              type="button"
              data-thread-selection-safe
              data-testid={`gc-rig-toggle-${gcControlTestIdSuffix(rigGroup.id)}`}
              aria-expanded={isFolderExpanded(rigFolderKey(rigGroup.id))}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleFolderExpanded(rigFolderKey(rigGroup.id));
              }}
            >
              <ChevronRightIcon
                className={`size-3 shrink-0 transition-transform ${
                  isFolderExpanded(rigFolderKey(rigGroup.id)) ? "rotate-90" : ""
                }`}
              />
              <FolderIcon className="size-3 shrink-0" />
              <span
                className={`truncate text-xs font-bold leading-none ${
                  isCityFolder ? "max-w-28 shrink-0" : "min-w-0"
                }`}
              >
                {displayLabel}
              </span>
              {isCityFolder ? (
                <Badge
                  size="sm"
                  variant="outline"
                  data-testid={`gc-city-label-${gcControlTestIdSuffix(rigGroup.id)}`}
                  className="shrink-0 rounded-full px-1.5 text-[.55rem] tracking-wide uppercase"
                >
                  city
                </Badge>
              ) : null}
              {rigGroup.kind === "workspace" && rigGroup.isSuspended ? (
                <Badge
                  size="sm"
                  variant="outline"
                  className="shrink-0 rounded-full border-amber-500/25 bg-amber-500/10 px-1.5 tracking-wide text-amber-700 uppercase dark:text-amber-300"
                >
                  blocks starts
                </Badge>
              ) : null}
              <span className="min-w-0 truncate text-[.625rem] font-medium tracking-normal text-muted-foreground/60 lowercase sm:text-[.625rem]">
                {rigStateSummary}
              </span>
            </button>
            {lifecycle && props.onSetSupervisorRunning ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-thread-selection-safe
                      data-testid={`gc-city-supervisor-${gcControlTestIdSuffix(rigGroup.id)}`}
                      data-gc-city={rigGroup.id}
                      aria-label={supervisorActionLabel}
                      disabled={supervisorMutationInFlight}
                      className="ml-auto inline-flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[.55rem] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 hover:text-emerald-800 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onSetSupervisorRunning?.(rigGroup.id, !lifecycle.supervisorRunning);
                      }}
                    >
                      {supervisorMutationInFlight ? (
                        <LoaderCircleIcon className="size-3 shrink-0 animate-spin" />
                      ) : lifecycle.supervisorRunning ? (
                        <SquareIcon className="size-3 shrink-0" />
                      ) : (
                        <PlayIcon className="size-3 shrink-0" />
                      )}
                      <span>Sup</span>
                    </button>
                  }
                />
                <TooltipPopup side="top">
                  <div className="space-y-1">
                    <div>{supervisorActionLabel}</div>
                    <div className="max-w-56 text-[10px] text-muted-foreground">
                      Shared supervisor. Stopping it affects all cities.
                      {typeof lifecycle.supervisorPort === "number"
                        ? ` Port ${lifecycle.supervisorPort}.`
                        : lifecycle.supervisorUrl
                          ? ` ${lifecycle.supervisorUrl}.`
                          : ""}
                    </div>
                  </div>
                </TooltipPopup>
              </Tooltip>
            ) : null}
            {lifecycle && props.onSetControllerRunning ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-thread-selection-safe
                      data-testid={`gc-city-controller-${gcControlTestIdSuffix(rigGroup.id)}`}
                      data-gc-city={rigGroup.id}
                      aria-label={controllerActionLabel}
                      disabled={controllerMutationInFlight}
                      className={`inline-flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[.55rem] font-medium text-sky-700 transition-colors hover:bg-sky-500/10 hover:text-sky-800 disabled:cursor-wait disabled:opacity-60 dark:text-sky-300 ${
                        props.onSetSupervisorRunning ? "" : "ml-auto"
                      }`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onSetControllerRunning?.(rigGroup.id, !lifecycle.controllerRunning);
                      }}
                    >
                      {controllerMutationInFlight ? (
                        <LoaderCircleIcon className="size-3 shrink-0 animate-spin" />
                      ) : lifecycle.controllerRunning ? (
                        <SquareIcon className="size-3 shrink-0" />
                      ) : (
                        <PlayIcon className="size-3 shrink-0" />
                      )}
                      <span>Ctl</span>
                    </button>
                  }
                />
                <TooltipPopup side="top">{controllerActionLabel}</TooltipPopup>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-thread-selection-safe
                    data-testid={`${
                      rigGroup.kind === "workspace" && !cityFolderUsesRigAction
                        ? "gc-city-action"
                        : `gc-rig-action-${gcControlTestIdSuffix(rigGroup.id)}`
                    }`}
                    {...(rigGroup.kind === "workspace" && !cityFolderUsesRigAction
                      ? { "data-gc-city": rigGroup.id }
                      : { "data-gc-rig": rigGroup.id })}
                    data-gc-action-icon={
                      rigGroup.kind === "workspace"
                        ? workspaceMutationInFlight
                          ? "loading"
                          : rigGroup.isSuspended
                            ? "play"
                            : "stop"
                        : props.gcRigMutationsInFlight.has(rigGroup.id)
                          ? "loading"
                          : rigGroup.isSuspended
                            ? "play"
                            : "stop"
                    }
                    aria-label={gcConfigToggleLabel(
                      rigGroup.kind,
                      displayLabel,
                      rigGroup.isSuspended,
                    )}
                    disabled={
                      rigGroup.kind === "workspace"
                        ? workspaceMutationInFlight
                        : props.gcRigMutationsInFlight.has(rigGroup.id) ||
                          isConfiguredRigActionDisabled(rigGroup)
                    }
                    className={`inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60 ${
                      lifecycle ? "" : "ml-auto"
                    }`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (rigGroup.kind === "workspace") {
                        if (cityFolderUsesRigAction) {
                          props.onToggleRigSuspended(
                            rigGroup.id,
                            !rigGroup.isSuspended,
                            rigGroup.agentGroups,
                          );
                          return;
                        }
                        props.onToggleCitySuspended(!rigGroup.isSuspended, rigGroup.agentGroups);
                        return;
                      }
                      props.onToggleRigSuspended(
                        rigGroup.id,
                        !rigGroup.isSuspended,
                        rigGroup.agentGroups,
                      );
                    }}
                  >
                    {(
                      rigGroup.kind === "workspace"
                        ? workspaceMutationInFlight
                        : props.gcRigMutationsInFlight.has(rigGroup.id)
                    ) ? (
                      <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
                    ) : rigGroup.isSuspended ? (
                      <PlayIcon className="size-3.5 shrink-0" />
                    ) : (
                      <SquareIcon className="size-3.5 shrink-0" />
                    )}
                  </button>
                }
              />
              <TooltipPopup side="top">
                <div className="space-y-1">
                  <div>
                    {gcConfigToggleLabel(rigGroup.kind, displayLabel, rigGroup.isSuspended)}
                  </div>
                  {rigGroup.kind === "workspace" && rigGroup.isSuspended ? (
                    <div className="max-w-56 text-[10px] text-muted-foreground">
                      {workspaceSuspensionHint}
                    </div>
                  ) : null}
                </div>
              </TooltipPopup>
            </Tooltip>
          </div>
        </SidebarMenuSubItem>
        {isFolderExpanded(rigFolderKey(rigGroup.id)) &&
          (props.gcThreadGroupingMode === "convoy" && rigGroup.threadGroups ? (
            <>
              {rigGroup.agentGroups.map((agentGroup) =>
                renderAgentGroup(
                  rigGroup,
                  {
                    ...agentGroup,
                    threadIds: [],
                    threadGroups: [],
                  },
                  {
                    agentIndentClassName: agentFolderIndentClassName,
                    threadGroupIndentClassName,
                    threadIndentClassName,
                    keyPrefix: `${rigGroup.id}:controls:`,
                  },
                ),
              )}
              {rigGroup.threadGroups.map((threadGroup) => {
                const groupKey = `${rigGroup.id}:${threadGroup.id}`;
                const groupExpanded = isFolderExpanded(threadGroupFolderKey(groupKey));
                return (
                  <Fragment key={groupKey}>
                    <SidebarMenuSubItem
                      className="w-full"
                      data-thread-selection-safe
                      data-testid={`gc-thread-group-${gcControlTestIdSuffix(groupKey)}`}
                    >
                      <div
                        className={`flex items-center gap-1.5 py-0.5 text-muted-foreground/60 ${agentFolderIndentClassName}`}
                      >
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`gc-thread-group-toggle-${gcControlTestIdSuffix(groupKey)}`}
                          aria-expanded={groupExpanded}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleFolderExpanded(threadGroupFolderKey(groupKey));
                          }}
                        >
                          <ChevronRightIcon
                            className={`size-3 shrink-0 transition-transform ${
                              groupExpanded ? "rotate-90" : ""
                            }`}
                          />
                          <FolderIcon className="size-3 shrink-0" />
                          <span className="truncate text-[11px] font-medium leading-none">
                            {threadGroup.label}
                          </span>
                          <GcThreadGroupBadges threadGroup={threadGroup} primary />
                          {threadGroup.progressLabel ? (
                            <span className="text-[.625rem] text-muted-foreground/55">
                              {threadGroup.progressLabel}
                            </span>
                          ) : null}
                          {threadGroup.status ? (
                            <span className="text-[.625rem] text-muted-foreground/55">
                              {threadGroup.status}
                            </span>
                          ) : null}
                        </button>
                      </div>
                    </SidebarMenuSubItem>
                    {groupExpanded &&
                      threadGroup.agentGroups?.map((agentGroup) =>
                        renderAgentGroup(rigGroup, agentGroup, {
                          agentIndentClassName: gcDepthClassName(
                            indentDepth,
                            CONVOY_AGENT_INDENT_CLASSES,
                          ),
                          threadGroupIndentClassName: gcDepthClassName(
                            indentDepth,
                            CONVOY_THREAD_GROUP_INDENT_CLASSES,
                          ),
                          threadIndentClassName: gcDepthClassName(
                            indentDepth,
                            CONVOY_THREAD_INDENT_CLASSES,
                          ),
                          keyPrefix: `${groupKey}:`,
                        }),
                      )}
                  </Fragment>
                );
              })}
            </>
          ) : rigGroup.kind === "workspace" ? (
            renderWorkspaceAgentFolder()
          ) : (
            renderDirectAgentGroups()
          ))}
        {isFolderExpanded(rigFolderKey(rigGroup.id)) && rigGroup.kind === "workspace"
          ? props.renderWorkspaceRows?.(rigGroup.id)
          : null}
        {isFolderExpanded(rigFolderKey(rigGroup.id)) && childRigGroups.length > 0 ? (
          <SidebarGcFolders
            {...props}
            rigGroups={childRigGroups}
            indentDepth={indentDepth + 1}
            nestedParentId={rigGroup.id}
            workspaceActionScope={workspaceActionScope}
          />
        ) : null}
      </Fragment>
    );
  });
}
