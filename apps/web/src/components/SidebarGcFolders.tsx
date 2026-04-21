import {
  ChevronRightIcon,
  FolderIcon,
  LoaderCircleIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { SidebarMenuSubItem } from "./ui/sidebar";
import { Badge } from "./ui/badge";
import type { ThreadId } from "@t3tools/contracts";
import { type GcAgentActionState, summarizeGcRuntimeStates } from "./sidebar/gcSidebarControls";

export interface SidebarGcAgentGroup {
  id: string;
  label: string;
  qualifiedName: string;
  isSuspended: boolean;
  isPool: boolean;
  maxActiveSessions?: number;
  namedSessionMode?: "always" | "on_demand";
  runtimeState: {
    label: string;
    tone: "info" | "muted" | "success" | "warning";
  };
  threadIds: readonly ThreadId[];
}

export interface SidebarGcRigGroup {
  id: string;
  label: string;
  kind: "workspace" | "rig";
  isSuspended: boolean;
  agentGroups: readonly SidebarGcAgentGroup[];
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
  onAdjustAgentMaxActiveSessions: (agent: string, maxActiveSessions: number) => void;
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

export function SidebarGcFolders(props: SidebarGcFoldersProps) {
  const [collapsedRigIds, setCollapsedRigIds] = useState<Set<string>>(() => new Set());
  const [collapsedAgentIds, setCollapsedAgentIds] = useState<Set<string>>(() => new Set());

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
          <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground/60 uppercase">
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
              <span className="truncate">{rigGroup.label}</span>
              <span className="truncate text-[9px] font-medium tracking-normal text-muted-foreground/60 lowercase">
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
                    aria-label={
                      rigGroup.isSuspended
                        ? rigGroup.kind === "workspace"
                          ? `Resume city ${rigGroup.label}`
                          : `Resume rig ${rigGroup.label}`
                        : rigGroup.kind === "workspace"
                          ? `Suspend city ${rigGroup.label}`
                          : `Suspend rig ${rigGroup.label}`
                    }
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
                {rigGroup.isSuspended
                  ? rigGroup.kind === "workspace"
                    ? `Resume city ${rigGroup.label}`
                    : `Resume rig ${rigGroup.label}`
                  : rigGroup.kind === "workspace"
                    ? `Suspend city ${rigGroup.label}`
                    : `Suspend rig ${rigGroup.label}`}
              </TooltipPopup>
            </Tooltip>
          </div>
        </SidebarMenuSubItem>
        {!collapsedRigIds.has(rigGroup.id) &&
          rigGroup.agentGroups.map((agentGroup) => {
            const isMutating = props.gcAgentMutationsInFlight.has(agentGroup.qualifiedName);
            const actionState = props.gcAgentActionStateByAgent.get(agentGroup.qualifiedName);
            const testIdSuffix = gcControlTestIdSuffix(agentGroup.qualifiedName);
            const actionLabel = agentGroup.isSuspended
              ? `Resume ${agentGroup.qualifiedName}`
              : `Suspend ${agentGroup.qualifiedName}`;
            const showNamedSessionModeControl = !agentGroup.isPool;
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
              agentGroup.isPool && typeof agentGroup.maxActiveSessions === "number";
            return (
              <Fragment key={`agent-${rigGroup.id}-${agentGroup.id}`}>
                <SidebarMenuSubItem
                  className="w-full"
                  data-thread-selection-safe
                  data-testid={`gc-agent-folder-${testIdSuffix}`}
                >
                  <div className="flex items-center gap-1.5 px-4 py-1 text-[10px] font-medium text-muted-foreground/60">
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
                      <span className="truncate">{agentGroup.label}</span>
                    </button>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <div className="ml-auto flex items-center gap-1">
                            {canAdjustPoolSize ? (
                              <>
                                <button
                                  type="button"
                                  data-thread-selection-safe
                                  data-testid={`gc-agent-pool-decrement-${testIdSuffix}`}
                                  aria-label={`Decrease ${agentGroup.qualifiedName} max sessions`}
                                  disabled={isMutating || (agentGroup.maxActiveSessions ?? 0) <= 0}
                                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    props.onAdjustAgentMaxActiveSessions(
                                      agentGroup.qualifiedName,
                                      Math.max(0, (agentGroup.maxActiveSessions ?? 0) - 1),
                                    );
                                  }}
                                >
                                  <MinusIcon className="size-3.5 shrink-0" />
                                </button>
                                <Badge
                                  variant="outline"
                                  data-testid={`gc-agent-pool-max-${testIdSuffix}`}
                                  className="h-5 rounded-full px-1.5 text-[9px] font-semibold tracking-wide uppercase"
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
                                className="inline-flex h-5 cursor-pointer items-center justify-center rounded-md px-1.5 text-[9px] font-semibold tracking-wide text-muted-foreground/70 uppercase transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
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
                              variant="outline"
                              data-testid={`gc-agent-status-${testIdSuffix}`}
                              className={`h-5 rounded-full px-1.5 text-[9px] font-semibold tracking-wide uppercase ${statusBadgeClassName(
                                agentGroup.runtimeState.tone,
                              )}`}
                            >
                              {agentGroup.runtimeState.label}
                            </Badge>
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
                          <div className="text-[10px] text-muted-foreground">
                            {actionState?.kind === "pool-size"
                              ? `Updating pool size to max ${actionState.maxActiveSessions}.`
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
                        </div>
                      </TooltipPopup>
                    </Tooltip>
                  </div>
                </SidebarMenuSubItem>
                {!collapsedAgentIds.has(agentGroup.qualifiedName) &&
                  props.renderThreadRows(agentGroup.threadIds, "pl-6")}
              </Fragment>
            );
          })}
      </Fragment>
    );
  });
}
