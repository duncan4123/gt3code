import { describe, expect, it } from "vitest";

import {
  getGcMetadata,
  groupThreadsByVirtualConvoy,
  hasUnseenCompletion,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  shouldClearThreadSelectionOnMouseDown,
} from "./Sidebar.logic";

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): Parameters<typeof hasUnseenCompletion>[0]["latestTurn"] {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        proposedPlans: [],
        session: null,
      }),
    ).toBe(true);
  });
});

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("resolveSidebarNewThreadEnvMode", () => {
  it("uses the app default when the caller does not request a specific mode", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        defaultEnvMode: "worktree",
      }),
    ).toBe("worktree");
  });

  it("preserves an explicit requested mode over the app default", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        requestedEnvMode: "local",
        defaultEnvMode: "worktree",
      }),
    ).toBe("local");
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    proposedPlans: [],
    session: {
      provider: "codex" as const,
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
              implementedAt: null,
              implementationThreadId: null,
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("does not show plan ready after the proposed plan was implemented elsewhere", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
              implementedAt: "2026-03-09T10:06:00.000Z",
              implementationThreadId: "thread-implement" as never,
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveThreadRowClassName", () => {
  it("uses the darker selected palette when a thread is both selected and active", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: true });
    expect(className).toContain("bg-primary/22");
    expect(className).toContain("hover:bg-primary/26");
    expect(className).toContain("dark:bg-primary/30");
    expect(className).not.toContain("bg-accent/85");
  });

  it("uses selected hover colors for selected threads", () => {
    const className = resolveThreadRowClassName({ isActive: false, isSelected: true });
    expect(className).toContain("bg-primary/15");
    expect(className).toContain("hover:bg-primary/19");
    expect(className).toContain("dark:bg-primary/22");
    expect(className).not.toContain("hover:bg-accent");
  });

  it("keeps the accent palette for active-only threads", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: false });
    expect(className).toContain("bg-accent/85");
    expect(className).toContain("hover:bg-accent");
  });
});

describe("getGcMetadata", () => {
  it("extracts convoy and formula metadata when present", () => {
    expect(
      getGcMetadata({
        "gc.agent": "gascity/codex",
        "gc.molecule": "gc-mol-7",
        "gc.formula": "mol-do-work",
        "gc.convoy": "gc-jsd2",
        "gc.convoyTitle": "T3 Virtual Convoy Folders",
      }),
    ).toMatchObject({
      isGcManaged: true,
      molecule: "gc-mol-7",
      formula: "mol-do-work",
      convoy: "gc-jsd2",
      convoyTitle: "T3 Virtual Convoy Folders",
    });
  });
});

describe("groupThreadsByVirtualConvoy", () => {
  it("leaves non-convoy threads as standalone", () => {
    const result = groupThreadsByVirtualConvoy([
      { customMetadata: {} },
      { customMetadata: { "gc.agent": "gascity/codex" } },
    ]);

    expect(result.standaloneThreads).toHaveLength(2);
    expect(result.convoyGroups).toHaveLength(0);
  });

  it("groups threads by convoy id and prefers convoy title for labels", () => {
    const result = groupThreadsByVirtualConvoy([
      {
        customMetadata: {
          "gc.agent": "gascity/codex-1",
          "gc.convoy": "gc-jsd2",
          "gc.convoyTitle": "T3 Virtual Convoy Folders",
        },
      },
      {
        customMetadata: {
          "gc.agent": "gascity/claude-1",
          "gc.convoy": "gc-jsd2",
          "gc.convoyTitle": "T3 Virtual Convoy Folders",
        },
      },
      {
        customMetadata: {
          "gc.agent": "gascity/codex-2",
          "gc.convoy": "gc-abc1",
        },
      },
      {
        customMetadata: {
          "gc.agent": "gascity/codex-3",
        },
      },
    ]);

    expect(result.standaloneThreads).toHaveLength(1);
    expect(result.convoyGroups).toHaveLength(2);
    expect(result.convoyGroups[0]).toMatchObject({
      id: "gc-abc1",
      label: "gc-abc1",
    });
    expect(result.convoyGroups[1]).toMatchObject({
      id: "gc-jsd2",
      label: "T3 Virtual Convoy Folders",
      status: undefined,
    });
    expect(result.convoyGroups[1]?.threads).toHaveLength(2);
  });

  it("preserves convoy progress metadata on the virtual folder", () => {
    const result = groupThreadsByVirtualConvoy([
      {
        customMetadata: {
          "gc.agent": "gascity/codex-1",
          "gc.convoy": "gc-ybah",
          "gc.convoyTitle": "Convoy metadata proof",
          "gc.convoyStatus": "open",
          "gc.convoyClosedCount": "1",
          "gc.convoyTotalCount": "3",
        },
      },
    ]);

    expect(result.convoyGroups[0]).toMatchObject({
      id: "gc-ybah",
      label: "Convoy metadata proof",
      status: "open",
      closedCount: 1,
      totalCount: 3,
    });
  });
});
