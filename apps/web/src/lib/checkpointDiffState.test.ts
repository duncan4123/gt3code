import { describe, expect, it } from "vitest";
import { getCheckpointDiffState } from "./checkpointDiffState";
import type { TurnDiffSummary } from "../types";

function summary(
  input: Partial<TurnDiffSummary> & Pick<TurnDiffSummary, "turnId" | "completedAt">,
) {
  return {
    files: [],
    ...input,
  } satisfies TurnDiffSummary;
}

describe("getCheckpointDiffState", () => {
  it("uses latest ready checkpoint for conversation diff selection", () => {
    const state = getCheckpointDiffState({
      selectedTurn: undefined,
      orderedTurnDiffSummaries: [
        summary({
          turnId: "turn-3" as never,
          completedAt: "2026-04-21T00:00:03.000Z",
          checkpointTurnCount: 3,
          status: "missing",
        }),
        summary({
          turnId: "turn-2" as never,
          completedAt: "2026-04-21T00:00:02.000Z",
          checkpointTurnCount: 2,
          status: "ready",
        }),
      ],
      inferredCheckpointTurnCountByTurnId: {},
    });

    expect(state.conversationCheckpointTurnCount).toBe(2);
    expect(state.unavailableReason).toBeNull();
  });

  it("blocks selected diff when checkpoint is still missing", () => {
    const state = getCheckpointDiffState({
      selectedTurn: summary({
        turnId: "turn-3" as never,
        completedAt: "2026-04-21T00:00:03.000Z",
        checkpointTurnCount: 3,
        status: "missing",
      }),
      orderedTurnDiffSummaries: [],
      inferredCheckpointTurnCountByTurnId: {},
    });

    expect(state.selectedCheckpointTurnCount).toBeUndefined();
    expect(state.unavailableReason).toBe("Checkpoint still processing for this turn.");
  });
});
