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
import { Fragment, type ReactNode, useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { SidebarMenuSubItem } from "./ui/sidebar";
import { Badge } from "./ui/badge";
import type { ThreadId } from "@t3tools/contracts";
import type { SidebarGcThreadGroupingMode } from "@t3tools/contracts/settings";
import {
  type GcAgentActionState,
  type GcWakeMode,
  summarizeGcRuntimeStates,
} from "./sidebar/gcSidebarControls";

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
  isSuspended: boolean;
  agentGroups: readonly SidebarGcAgentGroup[];
  threadGroups?: readonly SidebarGcThreadGroup[];
}

function gcControlTestIdSuffix(value: string): string {
  return value.replaceAll("/", "--");
}

interface SidebarGcFoldersProps {
  rigGroups: readonly SidebarGcRigGroup[];
  gcAgentMutationsInFlight: ReadonlySet<string>;
  gcAgentStartsInFlight?: ReadonlySet<string>;
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
  onWakeAgentSession: (agent: string) => void;
  onToggleAgentWakeMode: (agent: string, wakeMode: GcWakeMode) => void;
  onToggleAgentSessionMode: (agent: string, mode: "always" | "on_demand") => void;
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

function gcAgentSourceLabel(agentGroup: SidebarGcAgentGroup): string {
  if (agentGroup.promptTemplate?.includes("/.gc/system/")) {
    return "system";
  }
  if (
    agentGroup.promptTemplate?.includes("/packs/") ||
    agentGroup.promptTemplate?.startsWith("packs/")
  ) {
    return "pack";
  }
  if (agentGroup.startCommand) {
    return "built-in";
  }
  return agentGroup.scope ?? "agent";
}

const NON_WAKEABLE_AGENT_RUNTIME_LABELS = new Set(["Running", "Ready", "Connecting", "Starting"]);

function canWakeAgentSession(agentGroup: SidebarGcAgentGroup): boolean {
  return (
    Boolean(agentGroup.namedSessionMode) &&
    !agentGroup.isPool &&
    !agentGroup.isSuspended &&
    !NON_WAKEABLE_AGENT_RUNTIME_LABELS.has(agentGroup.runtimeState.label)
  );
}

export function SidebarGcFolders(props: SidebarGcFoldersProps) {
  const [collapsedRigIds, setCollapsedRigIds] = useState<Set<string>>(() => new Set());
  const [collapsedAgentIds, setCollapsedAgentIds] = useState<Set<string>>(() => new Set());
  const [collapsedThreadGroupIds, setCollapsedThreadGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const workspaceSuspensionHint =
    "Workspace is suspended. Gas City will not start or reconcile agents until GC is resumed.";

  const toggleRig = (rigId: string) => {
    setCollapsedRigIds((current) => {
      const next = new Set(current);
      if (next.has(rigId)) {
        next.delete(rigId);
      } else {
        next.add(rigId);
      }
      return next;
    });
  };

  const toggleAgent = (agentId: string) => {
    setCollapsedAgentIds((current) => {
      const next = new Set(current);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  const toggleThreadGroup = (groupId: string) => {
    setCollapsedThreadGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

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
    const actionLabel = gcConfigToggleLabel(
      "agent",
      agentGroup.qualifiedName,
      agentGroup.isSuspended,
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
    const canWakeSession =
      canWakeAgentSession(agentGroup) &&
      !rigGroup.isSuspended &&
      !isMutating &&
      !actionState &&
      !props.gcAgentStartsInFlight?.has(agentGroup.qualifiedName);
    const sourceLabel = gcAgentSourceLabel(agentGroup);
    const fragmentKey = `${options.keyPrefix ?? ""}${agentGroup.qualifiedName}`;

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
              data-testid={`gc-agent-toggle-${gcControlTestIdSuffix(fragmentKey)}`}
              aria-expanded={!collapsedAgentIds.has(fragmentKey)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleAgent(fragmentKey);
              }}
            >
              <ChevronRightIcon
                className={`size-3 shrink-0 transition-transform ${
                  collapsedAgentIds.has(fragmentKey) ? "" : "rotate-90"
                }`}
              />
              <FolderIcon className="size-3 shrink-0" />
              <span className="truncate text-xs font-medium leading-none">{agentGroup.label}</span>
              <Badge
                size="sm"
                variant="outline"
                className={`rounded-full px-1.5 text-[.55rem] tracking-wide uppercase ${statusBadgeClassName(
                  agentGroup.runtimeState.tone,
                )}`}
              >
                {agentGroup.runtimeState.label}
              </Badge>
            </button>
            {canWakeAgentSession(agentGroup) ? (
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
                        props.onWakeAgentSession(agentGroup.qualifiedName);
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-thread-selection-safe
                    data-testid={`gc-agent-action-${gcControlTestIdSuffix(fragmentKey)}`}
                    data-gc-agent={agentGroup.qualifiedName}
                    data-gc-action-icon={
                      isMutating
                        ? "loading"
                        : agentGroup.isSuspended
                          ? "play"
                          : "stop"
                    }
                    aria-label={actionLabel}
                    disabled={isMutating}
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      props.onToggleAgentSuspended(
                        agentGroup.qualifiedName,
                        !agentGroup.isSuspended,
                        agentGroup,
                      );
                    }}
                  >
                    {isMutating ? (
                      <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
                    ) : agentGroup.isSuspended ? (
                      <PlayIcon className="size-3.5 shrink-0" />
                    ) : (
                      <SquareIcon className="size-3.5 shrink-0" />
                    )}
                  </button>
                }
              />
              <TooltipPopup side="top">{actionLabel}</TooltipPopup>
            </Tooltip>
            {hasScaleControls ? (
              <div className="flex items-center gap-0.5" data-thread-selection-safe>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-thread-selection-safe
                        data-testid={`gc-agent-scale-down-${gcControlTestIdSuffix(fragmentKey)}`}
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
                <span className="min-w-6 text-center text-[.625rem] text-muted-foreground/70">
                  {agentGroup.minActiveSessions ?? 0}
                  {typeof agentGroup.maxActiveSessions === "number"
                    ? `/${agentGroup.maxActiveSessions}`
                    : ""}
                </span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-thread-selection-safe
                        data-testid={`gc-agent-scale-up-${gcControlTestIdSuffix(fragmentKey)}`}
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
                        props.onToggleAgentSessionMode(agentGroup.qualifiedName, nextNamedSessionMode);
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/45">
                    {actionState || props.gcAgentStartsInFlight?.has(agentGroup.qualifiedName) ? (
                      <LoaderCircleIcon className="size-3 animate-spin" />
                    ) : (
                      <span className="text-[.55rem]">i</span>
                    )}
                  </span>
                }
              />
              <TooltipPopup side="top">
                <div className="space-y-1">
                  <div className="text-xs font-medium">{agentGroup.qualifiedName}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {agentGroup.isPool
                      ? `Pool minimum is ${agentGroup.minActiveSessions ?? 0}${
                          typeof agentGroup.maxActiveSessions === "number"
                            ? ` of ${agentGroup.maxActiveSessions}`
                            : ""
                        }.`
                      : agentGroup.namedSessionMode
                        ? `Named session mode is ${agentGroup.namedSessionMode}.`
                        : typeof agentGroup.maxActiveSessions === "number"
                          ? `Pool capacity is ${agentGroup.maxActiveSessions}.`
                          : "No named session mode configured."}
                  </div>
                  <div className="max-w-72 space-y-0.5 text-[10px] text-muted-foreground/80">
                    <div>
                      scope {agentGroup.scope ?? "unknown"} · source {sourceLabel}
                      {agentGroup.provider ? ` · provider ${agentGroup.provider}` : ""}
                    </div>
                    {agentGroup.defaultSlingFormula ? (
                      <div>formula {agentGroup.defaultSlingFormula}</div>
                    ) : null}
                    {agentGroup.workDir ? <div>work {agentGroup.workDir}</div> : null}
                    {agentGroup.startCommand ? <div>starts via command</div> : null}
                  </div>
                </div>
              </TooltipPopup>
            </Tooltip>
          </div>
        </SidebarMenuSubItem>
        {!collapsedAgentIds.has(fragmentKey) &&
          (agentGroup.threadGroups && agentGroup.threadGroups.length > 0 ? (
            <>
              {agentGroup.threadGroups.map((threadGroup) => {
                const groupKey = `${fragmentKey}:${threadGroup.id}`;
                const groupCollapsed = collapsedThreadGroupIds.has(groupKey);
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
                          aria-expanded={!groupCollapsed}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleThreadGroup(groupKey);
                          }}
                        >
                          <ChevronRightIcon
                            className={`size-3 shrink-0 transition-transform ${
                              groupCollapsed ? "" : "rotate-90"
                            }`}
                          />
                          <FolderIcon className="size-3 shrink-0" />
                          <span className="truncate text-[11px] font-medium leading-none">
                            {threadGroup.label}
                          </span>
                          <Badge
                            size="sm"
                            variant="outline"
                            className="rounded-full px-1.5 text-[.55rem] tracking-wide uppercase"
                          >
                            {threadGroup.kind}
                          </Badge>
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
                    {!groupCollapsed &&
                      props.renderThreadRows(threadGroup.threadIds, options.threadIndentClassName)}
                  </Fragment>
                );
              })}
            </>
          ) : (
            props.renderThreadRows(agentGroup.threadIds, options.threadIndentClassName)
          ))}
      </Fragment>
    );
  };

  return props.rigGroups.map((rigGroup) => {
    const rigStateSummary =
      rigGroup.kind === "workspace"
        ? props.gcCityActionState === "resume"
          ? "Resuming"
          : props.gcCityActionState === "suspend"
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
    return (
      <Fragment key={`rig-${rigGroup.id}`}>
        <SidebarMenuSubItem
          className="w-full"
          data-testid={`gc-rig-folder-${gcControlTestIdSuffix(rigGroup.id)}`}
        >
          <div className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground/60 uppercase">
            <button
              type="button"
              data-thread-selection-safe
              data-testid={`gc-rig-toggle-${gcControlTestIdSuffix(rigGroup.id)}`}
              aria-expanded={!collapsedRigIds.has(rigGroup.id)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleRig(rigGroup.id);
              }}
            >
              <ChevronRightIcon
                className={`size-3 shrink-0 transition-transform ${
                  collapsedRigIds.has(rigGroup.id) ? "" : "rotate-90"
                }`}
              />
              <FolderIcon className="size-3 shrink-0" />
              <span className="truncate text-xs font-semibold leading-none">{rigGroup.label}</span>
              {rigGroup.kind === "workspace" && rigGroup.isSuspended ? (
                <Badge
                  size="sm"
                  variant="outline"
                  className="rounded-full border-amber-500/25 bg-amber-500/10 px-1.5 tracking-wide text-amber-700 uppercase dark:text-amber-300"
                >
                  blocks starts
                </Badge>
              ) : null}
              <span className="truncate text-[.625rem] font-medium tracking-normal text-muted-foreground/60 lowercase sm:text-[.625rem]">
                {rigStateSummary}
              </span>
            </button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-thread-selection-safe
                    data-testid={`${
                      rigGroup.kind === "workspace"
                        ? "gc-city-action"
                        : `gc-rig-action-${gcControlTestIdSuffix(rigGroup.id)}`
                    }`}
                    {...(rigGroup.kind === "workspace"
                      ? { "data-gc-city": rigGroup.id }
                      : { "data-gc-rig": rigGroup.id })}
                    data-gc-action-icon={
                      rigGroup.kind === "workspace"
                        ? props.gcCityMutationInFlight
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
                      rigGroup.label,
                      rigGroup.isSuspended,
                    )}
                    disabled={
                      rigGroup.kind === "workspace"
                        ? props.gcCityMutationInFlight
                        : props.gcRigMutationsInFlight.has(rigGroup.id)
                    }
                    className="ml-auto inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (rigGroup.kind === "workspace") {
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
                        ? props.gcCityMutationInFlight
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
                    {gcConfigToggleLabel(rigGroup.kind, rigGroup.label, rigGroup.isSuspended)}
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
        {!collapsedRigIds.has(rigGroup.id) &&
          (props.gcThreadGroupingMode === "convoy" && rigGroup.threadGroups ? (
            <>
              {rigGroup.threadGroups.map((threadGroup) => {
                const groupKey = `${rigGroup.id}:${threadGroup.id}`;
                const groupCollapsed = collapsedThreadGroupIds.has(groupKey);
                return (
                  <Fragment key={groupKey}>
                    <SidebarMenuSubItem
                      className="w-full"
                      data-thread-selection-safe
                      data-testid={`gc-thread-group-${gcControlTestIdSuffix(groupKey)}`}
                    >
                      <div className="flex items-center gap-1.5 px-4 py-0.5 text-muted-foreground/60">
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`gc-thread-group-toggle-${gcControlTestIdSuffix(groupKey)}`}
                          aria-expanded={!groupCollapsed}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleThreadGroup(groupKey);
                          }}
                        >
                          <ChevronRightIcon
                            className={`size-3 shrink-0 transition-transform ${
                              groupCollapsed ? "" : "rotate-90"
                            }`}
                          />
                          <FolderIcon className="size-3 shrink-0" />
                          <span className="truncate text-[11px] font-medium leading-none">
                            {threadGroup.label}
                          </span>
                          <Badge
                            size="sm"
                            variant="outline"
                            className="rounded-full px-1.5 text-[.55rem] tracking-wide uppercase"
                          >
                            {threadGroup.kind}
                          </Badge>
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
                    {!groupCollapsed &&
                      threadGroup.agentGroups?.map((agentGroup) =>
                        renderAgentGroup(rigGroup, agentGroup, {
                          agentIndentClassName: "px-6",
                          threadGroupIndentClassName: "px-8",
                          threadIndentClassName: "pl-10",
                          keyPrefix: `${groupKey}:`,
                        }),
                      )}
                  </Fragment>
                );
              })}
            </>
          ) : (
            rigGroup.agentGroups.map((agentGroup) => {
            const isMutating = props.gcAgentMutationsInFlight.has(agentGroup.qualifiedName);
            const actionState = props.gcAgentActionStateByAgent.get(agentGroup.qualifiedName);
            const testIdSuffix = gcControlTestIdSuffix(agentGroup.qualifiedName);
            const actionLabel = gcConfigToggleLabel(
              "agent",
              agentGroup.qualifiedName,
              agentGroup.isSuspended,
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
            const canAdjustPoolSize =
              hasScaleControls && typeof agentGroup.maxActiveSessions === "number";
            const canAdjustPoolMinimum =
              hasScaleControls && typeof agentGroup.minActiveSessions === "number";
            const nextWakeMode =
              agentGroup.wakeMode === "resume"
                ? "fresh"
                : agentGroup.wakeMode === "fresh"
                  ? "resume"
                  : null;
            const canWakeSession =
              canWakeAgentSession(agentGroup) &&
              !rigGroup.isSuspended &&
              !isMutating &&
              !actionState &&
              !props.gcAgentStartsInFlight?.has(agentGroup.qualifiedName);
            const sourceLabel = gcAgentSourceLabel(agentGroup);
            return (
              <Fragment key={`agent-${rigGroup.id}-${agentGroup.id}`}>
                <SidebarMenuSubItem
                  className="w-full"
                  data-thread-selection-safe
                  data-testid={`gc-agent-folder-${testIdSuffix}`}
                >
                  <div className="flex items-center gap-1.5 px-4 py-1 text-muted-foreground/60">
                    <button
                      type="button"
                      data-thread-selection-safe
                      data-testid={`gc-agent-folder-toggle-${testIdSuffix}`}
                      aria-expanded={!collapsedAgentIds.has(agentGroup.qualifiedName)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleAgent(agentGroup.qualifiedName);
                      }}
                    >
                      <ChevronRightIcon
                        className={`size-3 shrink-0 transition-transform ${
                          collapsedAgentIds.has(agentGroup.qualifiedName) ? "" : "rotate-90"
                        }`}
                      />
                      <FolderIcon className="size-3 shrink-0" />
                      <span className="truncate text-xs font-medium leading-none">
                        {agentGroup.label}
                      </span>
                      <span className="rounded-full border border-border/60 px-1.5 py-0 text-[.55rem] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                        {sourceLabel}
                      </span>
                      {agentGroup.provider ? (
                        <span className="rounded-full border border-border/60 px-1.5 py-0 text-[.55rem] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                          {agentGroup.provider}
                        </span>
                      ) : null}
                    </button>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <div className="ml-auto flex items-center gap-1">
                            {nextWakeMode ? (
                              <button
                                type="button"
                                data-thread-selection-safe
                                data-testid={`gc-agent-wake-mode-${testIdSuffix}`}
                                data-gc-agent-wake-mode={agentGroup.qualifiedName}
                                aria-label={`Set ${agentGroup.qualifiedName} wake mode to ${nextWakeMode}`}
                                disabled={isMutating}
                                className="inline-flex h-5 cursor-pointer items-center justify-center rounded-md px-1.5 font-semibold tracking-wide text-muted-foreground/70 text-xs uppercase transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60 sm:text-[.625rem]"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  props.onToggleAgentWakeMode(
                                    agentGroup.qualifiedName,
                                    nextWakeMode,
                                  );
                                }}
                              >
                                {agentGroup.wakeMode}
                              </button>
                            ) : null}
                            {canAdjustPoolMinimum ? (
                              <>
                                <button
                                  type="button"
                                  data-thread-selection-safe
                                  data-testid={`gc-agent-pool-min-decrement-${testIdSuffix}`}
                                  aria-label={`Decrease ${agentGroup.qualifiedName} minimum sessions`}
                                  disabled={isMutating || (agentGroup.minActiveSessions ?? 0) <= 0}
                                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    props.onAdjustAgentMinActiveSessions(
                                      agentGroup.qualifiedName,
                                      Math.max(0, (agentGroup.minActiveSessions ?? 0) - 1),
                                    );
                                  }}
                                >
                                  <MinusIcon className="size-3.5 shrink-0" />
                                </button>
                                <Badge
                                  size="sm"
                                  variant="outline"
                                  data-testid={`gc-agent-pool-min-${testIdSuffix}`}
                                  className="rounded-full px-1.5 tracking-wide uppercase"
                                >
                                  min {agentGroup.minActiveSessions}
                                </Badge>
                                <button
                                  type="button"
                                  data-thread-selection-safe
                                  data-testid={`gc-agent-pool-min-increment-${testIdSuffix}`}
                                  aria-label={`Increase ${agentGroup.qualifiedName} minimum sessions`}
                                  disabled={
                                    isMutating ||
                                    (typeof agentGroup.maxActiveSessions === "number" &&
                                      (agentGroup.minActiveSessions ?? 0) >=
                                        agentGroup.maxActiveSessions)
                                  }
                                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    props.onAdjustAgentMinActiveSessions(
                                      agentGroup.qualifiedName,
                                      (agentGroup.minActiveSessions ?? 0) + 1,
                                    );
                                  }}
                                >
                                  <PlusIcon className="size-3.5 shrink-0" />
                                </button>
                              </>
                            ) : null}
                            {canAdjustPoolSize ? (
                              <>
                                <button
                                  type="button"
                                  data-thread-selection-safe
                                  data-testid={`gc-agent-pool-decrement-${testIdSuffix}`}
                                  aria-label={`Decrease ${agentGroup.qualifiedName} max sessions`}
                                  disabled={
                                    isMutating ||
                                    (agentGroup.maxActiveSessions ?? 0) <=
                                      Math.max(0, agentGroup.minActiveSessions ?? 0)
                                  }
                                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    props.onAdjustAgentMaxActiveSessions(
                                      agentGroup.qualifiedName,
                                      Math.max(
                                        Math.max(0, agentGroup.minActiveSessions ?? 0),
                                        (agentGroup.maxActiveSessions ?? 0) - 1,
                                      ),
                                    );
                                  }}
                                >
                                  <MinusIcon className="size-3.5 shrink-0" />
                                </button>
                                <Badge
                                  size="sm"
                                  variant="outline"
                                  data-testid={`gc-agent-pool-max-${testIdSuffix}`}
                                  className="rounded-full px-1.5 tracking-wide uppercase"
                                >
                                  max {agentGroup.maxActiveSessions}
                                </Badge>
                                <button
                                  type="button"
                                  data-thread-selection-safe
                                  data-testid={`gc-agent-pool-increment-${testIdSuffix}`}
                                  aria-label={`Increase ${agentGroup.qualifiedName} max sessions`}
                                  disabled={isMutating}
                                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    props.onAdjustAgentMaxActiveSessions(
                                      agentGroup.qualifiedName,
                                      (agentGroup.maxActiveSessions ?? 0) + 1,
                                    );
                                  }}
                                >
                                  <PlusIcon className="size-3.5 shrink-0" />
                                </button>
                              </>
                            ) : null}
                            {sessionModeLabel && nextNamedSessionMode ? (
                              <button
                                type="button"
                                data-thread-selection-safe
                                data-testid={`gc-agent-session-mode-${testIdSuffix}`}
                                data-gc-agent-session-mode={agentGroup.qualifiedName}
                                aria-label={`Set ${agentGroup.qualifiedName} session mode to ${nextNamedSessionMode}`}
                                disabled={isMutating}
                                className="inline-flex h-5 cursor-pointer items-center justify-center rounded-md px-1.5 font-semibold tracking-wide text-muted-foreground/70 text-xs uppercase transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60 sm:text-[.625rem]"
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
                            ) : null}
                            <Badge
                              size="sm"
                              variant="outline"
                              data-testid={`gc-agent-status-${testIdSuffix}`}
                              className={`rounded-full px-1.5 tracking-wide uppercase ${statusBadgeClassName(
                                agentGroup.runtimeState.tone,
                              )}`}
                            >
                              {agentGroup.runtimeState.label}
                            </Badge>
                            {canWakeAgentSession(agentGroup) ? (
                              <button
                                type="button"
                                data-thread-selection-safe
                                data-testid={`gc-agent-wake-${testIdSuffix}`}
                                data-gc-agent={agentGroup.qualifiedName}
                                aria-label={`Wake ${agentGroup.qualifiedName}`}
                                disabled={!canWakeSession}
                                className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-50"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  props.onWakeAgentSession(agentGroup.qualifiedName);
                                }}
                              >
                                {actionState?.kind === "wake" ||
                                props.gcAgentStartsInFlight?.has(agentGroup.qualifiedName) ? (
                                  <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
                                ) : (
                                  <RotateCcwIcon className="size-3.5 shrink-0" />
                                )}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              data-thread-selection-safe
                              data-testid={`gc-agent-toggle-${testIdSuffix}`}
                              data-gc-agent={agentGroup.qualifiedName}
                              data-gc-action-icon={
                                isMutating ? "loading" : agentGroup.isSuspended ? "play" : "stop"
                              }
                              aria-label={actionLabel}
                              disabled={isMutating}
                              className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                props.onToggleAgentSuspended(
                                  agentGroup.qualifiedName,
                                  !agentGroup.isSuspended,
                                  agentGroup,
                                );
                              }}
                            >
                              {isMutating ? (
                                <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
                              ) : agentGroup.isSuspended ? (
                                <PlayIcon className="size-3.5 shrink-0" />
                              ) : (
                                <SquareIcon className="size-3.5 shrink-0" />
                              )}
                            </button>
                          </div>
                        }
                      />
                      <TooltipPopup side="top">
                        <div className="space-y-1">
                          <div>{actionLabel}</div>
                          {agentGroup.description ? (
                            <div className="max-w-72 text-[10px] text-muted-foreground">
                              {agentGroup.description}
                            </div>
                          ) : null}
                          <div className="text-[10px] text-muted-foreground">
                            {actionState?.kind === "pool-size"
                              ? `Updating pool size to max ${actionState.maxActiveSessions}.`
                              : actionState?.kind === "pool-min"
                                ? `Updating pool minimum to ${actionState.minActiveSessions}.`
                                : actionState?.kind === "wake-mode"
                                  ? `Switching wake mode to ${actionState.wakeMode}.`
                                  : actionState?.kind === "session-mode"
                                    ? actionState.targetMode === "always"
                                      ? "Switching named session mode to auto-start."
                                      : "Switching named session mode to on-demand."
                                    : `${agentGroup.runtimeState.label}. ${
                                        agentGroup.namedSessionMode === "always"
                                          ? "Named session auto-start is enabled."
                                          : agentGroup.namedSessionMode === "on_demand"
                                            ? "Named session starts on demand."
                                            : agentGroup.isPool &&
                                                typeof agentGroup.maxActiveSessions === "number"
                                              ? `Pool capacity is ${agentGroup.maxActiveSessions}.`
                                              : "No named session mode configured."
                                      }`}
                          </div>
                          <div className="max-w-72 space-y-0.5 text-[10px] text-muted-foreground/80">
                            <div>
                              scope {agentGroup.scope ?? "unknown"} · source {sourceLabel}
                              {agentGroup.provider ? ` · provider ${agentGroup.provider}` : ""}
                            </div>
                            {agentGroup.defaultSlingFormula ? (
                              <div>formula {agentGroup.defaultSlingFormula}</div>
                            ) : null}
                            {agentGroup.workDir ? <div>work {agentGroup.workDir}</div> : null}
                            {agentGroup.startCommand ? <div>starts via command</div> : null}
                          </div>
                        </div>
                      </TooltipPopup>
                    </Tooltip>
                  </div>
                </SidebarMenuSubItem>
                {!collapsedAgentIds.has(agentGroup.qualifiedName) &&
                  (agentGroup.threadGroups && agentGroup.threadGroups.length > 0 ? (
                    <>
                      {agentGroup.threadGroups.map((threadGroup) => {
                        const groupKey = `${agentGroup.qualifiedName}:${threadGroup.id}`;
                        const groupCollapsed = collapsedThreadGroupIds.has(groupKey);
                        return (
                          <Fragment key={groupKey}>
                            <SidebarMenuSubItem
                              className="w-full"
                              data-thread-selection-safe
                              data-testid={`gc-thread-group-${gcControlTestIdSuffix(groupKey)}`}
                            >
                              <div className="flex items-center gap-1.5 px-6 py-0.5 text-muted-foreground/60">
                                <button
                                  type="button"
                                  data-thread-selection-safe
                                  data-testid={`gc-thread-group-toggle-${gcControlTestIdSuffix(groupKey)}`}
                                  aria-expanded={!groupCollapsed}
                                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 transition-colors hover:bg-accent hover:text-foreground"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    toggleThreadGroup(groupKey);
                                  }}
                                >
                                  <ChevronRightIcon
                                    className={`size-3 shrink-0 transition-transform ${
                                      groupCollapsed ? "" : "rotate-90"
                                    }`}
                                  />
                                  <FolderIcon className="size-3 shrink-0" />
                                  <span className="truncate text-[11px] font-medium leading-none">
                                    {threadGroup.label}
                                  </span>
                                  <Badge
                                    size="sm"
                                    variant="outline"
                                    className="rounded-full px-1.5 text-[.55rem] tracking-wide uppercase"
                                  >
                                    {threadGroup.kind}
                                  </Badge>
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
                            {!groupCollapsed &&
                              props.renderThreadRows(threadGroup.threadIds, "pl-8")}
                          </Fragment>
                        );
                      })}
                    </>
                  ) : (
                    props.renderThreadRows(agentGroup.threadIds, "pl-6")
                  ))}
              </Fragment>
            );
            })
          ))}
      </Fragment>
    );
  });
}
