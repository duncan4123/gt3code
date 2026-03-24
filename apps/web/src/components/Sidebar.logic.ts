import type { Thread } from "../types";
import { cn } from "../lib/utils";
import {
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export type SidebarNewThreadEnvMode = "local" | "worktree";

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready"
    | "Drained"
    | "Stopped";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

/** Extract gc.* metadata from a thread's customMetadata. */
export interface GcMeta {
  isGcManaged: boolean;
  agent: string | undefined;
  rig: string | undefined;
  city: string | undefined;
  bead: string | undefined;
  beadTitle: string | undefined;
  beadStatus: string | undefined;
  beadType: string | undefined;
  beadPriority: string | undefined;
  beadAssignee: string | undefined;
  beadLabels: string | undefined;
  beadDescription: string | undefined;
  molecule: string | undefined;
  formula: string | undefined;
  convoy: string | undefined;
  convoyTitle: string | undefined;
  convoyStatus: string | undefined;
  convoyClosedCount: string | undefined;
  convoyTotalCount: string | undefined;
  convoyChildren: string | undefined;
  doltPort: string | undefined;
  doltDatabase: string | undefined;
  state: string | undefined;
  provider: string | undefined;
  runtimeProvider: string | undefined;
  startupTemplate: string | undefined;
  startupModel: string | undefined;
  role: string | undefined;
}

const EMPTY_GC_META: GcMeta = {
  isGcManaged: false,
  agent: undefined,
  rig: undefined,
  city: undefined,
  bead: undefined,
  beadTitle: undefined,
  beadStatus: undefined,
  beadType: undefined,
  beadPriority: undefined,
  beadAssignee: undefined,
  beadLabels: undefined,
  beadDescription: undefined,
  molecule: undefined,
  formula: undefined,
  convoy: undefined,
  convoyTitle: undefined,
  convoyStatus: undefined,
  convoyClosedCount: undefined,
  convoyTotalCount: undefined,
  convoyChildren: undefined,
  doltPort: undefined,
  doltDatabase: undefined,
  state: undefined,
  provider: undefined,
  runtimeProvider: undefined,
  startupTemplate: undefined,
  startupModel: undefined,
  role: undefined,
};

export function getGcMetadata(customMetadata?: Record<string, string>): GcMeta {
  if (!customMetadata || !customMetadata["gc.agent"]) {
    return EMPTY_GC_META;
  }
  return {
    isGcManaged: true,
    agent: customMetadata["gc.agent"],
    rig: customMetadata["gc.rig"],
    city: customMetadata["gc.city"],
    bead: customMetadata["gc.bead"],
    beadTitle: customMetadata["gc.beadTitle"],
    beadStatus: customMetadata["gc.beadStatus"],
    beadType: customMetadata["gc.beadType"],
    beadPriority: customMetadata["gc.beadPriority"],
    beadAssignee: customMetadata["gc.beadAssignee"],
    beadLabels: customMetadata["gc.beadLabels"],
    beadDescription: customMetadata["gc.beadDescription"],
    molecule: customMetadata["gc.molecule"],
    formula: customMetadata["gc.formula"],
    convoy: customMetadata["gc.convoy"],
    convoyTitle: customMetadata["gc.convoyTitle"],
    convoyStatus: customMetadata["gc.convoyStatus"],
    convoyClosedCount: customMetadata["gc.convoyClosedCount"],
    convoyTotalCount: customMetadata["gc.convoyTotalCount"],
    convoyChildren: customMetadata["gc.convoyChildren"],
    doltPort: customMetadata["gc.doltPort"],
    doltDatabase: customMetadata["gc.doltDatabase"],
    state: customMetadata["gc.state"],
    provider: customMetadata["gc.provider"],
    runtimeProvider: customMetadata["gc.runtimeProvider"],
    startupTemplate: customMetadata["gc.startupTemplate"],
    startupModel: customMetadata["gc.startupModel"],
    role: customMetadata["gc.role"],
  };
}

/** Returns true if a thread is archived (GC state is "drained" or "archived"). */
export function isThreadArchived(customMetadata?: Record<string, string>): boolean {
  const state = customMetadata?.["gc.state"];
  return state === "drained" || state === "archived";
}

/** Count GC-managed threads per project. */
export function countGcAgents(
  threads: ReadonlyArray<{ projectId: string; customMetadata?: Record<string, string> }>,
  projectId: string,
): number {
  return threads.filter((t) => t.projectId === projectId && t.customMetadata?.["gc.agent"]).length;
}

export interface ConvoyThreadLike {
  customMetadata?: Record<string, string>;
}

export interface VirtualConvoyGroup<TThread extends ConvoyThreadLike> {
  id: string;
  label: string;
  status: string | undefined;
  closedCount: number | null;
  totalCount: number | null;
  formula: string | undefined;
  molecule: string | undefined;
  threads: TThread[];
}

export function groupThreadsByVirtualConvoy<TThread extends ConvoyThreadLike>(
  threads: ReadonlyArray<TThread>,
): {
  standaloneThreads: TThread[];
  convoyGroups: VirtualConvoyGroup<TThread>[];
} {
  const standaloneThreads: TThread[] = [];
  const convoyGroupsById = new Map<string, VirtualConvoyGroup<TThread>>();

  for (const thread of threads) {
    const gcMeta = getGcMetadata(thread.customMetadata);
    const convoyId = gcMeta.convoy?.trim();
    // Operator threads (e.g. convoymaster) stay standalone even with a convoy ID.
    // Only worker threads get grouped into convoy virtual folders.
    if (!convoyId || gcMeta.role === "operator") {
      standaloneThreads.push(thread);
      continue;
    }

    const existingGroup = convoyGroupsById.get(convoyId);
    if (existingGroup) {
      existingGroup.threads.push(thread);
      continue;
    }

    convoyGroupsById.set(convoyId, {
      id: convoyId,
      label: gcMeta.convoyTitle?.trim() || convoyId,
      status: gcMeta.convoyStatus,
      closedCount: gcMeta.convoyClosedCount ? Number(gcMeta.convoyClosedCount) : null,
      totalCount: gcMeta.convoyTotalCount ? Number(gcMeta.convoyTotalCount) : null,
      formula: gcMeta.formula?.trim() || undefined,
      molecule: gcMeta.molecule?.trim() || undefined,
      threads: [thread],
    });
  }

  for (const group of convoyGroupsById.values()) {
    const formulas = new Set(
      group.threads
        .map((thread) => getGcMetadata(thread.customMetadata).formula?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    const molecules = new Set(
      group.threads
        .map((thread) => getGcMetadata(thread.customMetadata).molecule?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    group.formula = formulas.size === 1 ? [...formulas][0] : undefined;
    group.molecule = molecules.size === 1 ? [...molecules][0] : undefined;
  }

  const convoyGroups = Array.from(convoyGroupsById.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  return { standaloneThreads, convoyGroups };
}

const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Working: 3,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
  Drained: 0,
  Stopped: 0,
};


type ThreadStatusInput = Pick<
  Thread,
  "interactionMode" | "latestTurn" | "lastVisitedAt" | "proposedPlans" | "session"
>;

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewThreadEnvMode(input: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  defaultEnvMode: SidebarNewThreadEnvMode;
}): SidebarNewThreadEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-7 w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-primary/22 text-foreground font-medium hover:bg-primary/26 hover:text-foreground dark:bg-primary/30 dark:hover:bg-primary/36",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-primary/15 text-foreground hover:bg-primary/19 hover:text-foreground dark:bg-primary/22 dark:hover:bg-primary/28",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-accent/85 text-foreground font-medium hover:bg-accent hover:text-foreground dark:bg-accent/55 dark:hover:bg-accent/70",
    );
  }

  return cn(baseClassName, "text-muted-foreground hover:bg-accent hover:text-foreground");
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  gcState?: string | undefined;
}): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread, gcState } = input;

  // GC lifecycle states take priority when session is not actively running.
  if (gcState === "drained" && thread.session?.status !== "running") {
    return {
      label: "Drained",
      colorClass: "text-zinc-500 dark:text-zinc-400/70",
      dotClass: "bg-zinc-400 dark:bg-zinc-500/70",
      pulse: false,
    };
  }
  if (gcState === "stopped" && thread.session?.status !== "running") {
    return {
      label: "Stopped",
      colorClass: "text-zinc-400 dark:text-zinc-500/60",
      dotClass: "bg-zinc-300 dark:bg-zinc-600/60",
      pulse: false,
    };
  }

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  // Use completedAt as the reliable completion signal — activeTurnId can be permanently
  // stale when the server lifecycle guard rejects status updates.
  const sidebarTurnDone = !!thread.latestTurn?.completedAt;

  if (thread.session?.status === "running" && !sidebarTurnDone) {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    hasActionableProposedPlan(
      findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
    );
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}
