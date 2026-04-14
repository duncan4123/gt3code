import { ChevronRightIcon, FolderIcon, LoaderCircleIcon, PlayIcon, SquareIcon } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { SidebarMenuSubItem } from "./ui/sidebar";
import type { ThreadId } from "@t3tools/contracts";

export interface SidebarGcAgentGroup {
  id: string;
  label: string;
  qualifiedName: string;
  isSuspended: boolean;
  threadIds: readonly ThreadId[];
}

export interface SidebarGcRigGroup {
  id: string;
  label: string;
  isSuspended: boolean;
  agentGroups: readonly SidebarGcAgentGroup[];
}

function gcControlTestIdSuffix(value: string): string {
  return value.replaceAll("/", "--");
}

interface SidebarGcFoldersProps {
  rigGroups: readonly SidebarGcRigGroup[];
  gcAgentMutationsInFlight: ReadonlySet<string>;
  gcRigMutationsInFlight: ReadonlySet<string>;
  onToggleRigSuspended: (rig: string, suspended: boolean) => void;
  onToggleAgentSuspended: (agent: string, suspended: boolean) => void;
  renderThreadRows: (threadIds: readonly ThreadId[], indentClassName?: string) => ReactNode;
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

  return props.rigGroups.map((rigGroup) => (
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
          </button>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  data-thread-selection-safe
                  data-testid={`gc-rig-action-${gcControlTestIdSuffix(rigGroup.id)}`}
                  data-gc-rig={rigGroup.id}
                  data-gc-action-icon={
                    props.gcRigMutationsInFlight.has(rigGroup.id)
                      ? "loading"
                      : rigGroup.isSuspended
                        ? "play"
                        : "stop"
                  }
                  aria-label={
                    rigGroup.isSuspended
                      ? `Resume rig ${rigGroup.label}`
                      : `Suspend rig ${rigGroup.label}`
                  }
                  disabled={props.gcRigMutationsInFlight.has(rigGroup.id)}
                  className="ml-auto inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onToggleRigSuspended(rigGroup.id, !rigGroup.isSuspended);
                  }}
                >
                  {props.gcRigMutationsInFlight.has(rigGroup.id) ? (
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
                ? `Resume rig ${rigGroup.label}`
                : `Suspend rig ${rigGroup.label}`}
            </TooltipPopup>
          </Tooltip>
        </div>
      </SidebarMenuSubItem>
      {!collapsedRigIds.has(rigGroup.id) &&
        rigGroup.agentGroups.map((agentGroup) => {
          const isMutating = props.gcAgentMutationsInFlight.has(agentGroup.qualifiedName);
          const testIdSuffix = gcControlTestIdSuffix(agentGroup.qualifiedName);
          const actionLabel = agentGroup.isSuspended
            ? `Resume ${agentGroup.qualifiedName}`
            : `Suspend ${agentGroup.qualifiedName}`;
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
                          className="ml-auto inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            props.onToggleAgentSuspended(
                              agentGroup.qualifiedName,
                              !agentGroup.isSuspended,
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
                </div>
              </SidebarMenuSubItem>
              {!collapsedAgentIds.has(agentGroup.qualifiedName) &&
                props.renderThreadRows(agentGroup.threadIds, "pl-6")}
            </Fragment>
          );
        })}
    </Fragment>
  ));
}
