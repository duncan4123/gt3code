import type { TurnDiffSummary } from "../types";

function isReadyCheckpointStatus(status: TurnDiffSummary["status"]): boolean {
  return status === undefined || status === "ready";
}

function resolveReadyCheckpointTurnCount(
  summary: Pick<TurnDiffSummary, "turnId" | "status" | "checkpointTurnCount">,
  inferredCheckpointTurnCountByTurnId: Record<string, number>,
): number | undefined {
  const checkpointTurnCount =
    summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
  if (typeof checkpointTurnCount !== "number") {
    return undefined;
  }
  return isReadyCheckpointStatus(summary.status) ? checkpointTurnCount : undefined;
}

export function getCheckpointDiffState(input: {
  readonly selectedTurn: TurnDiffSummary | undefined;
  readonly orderedTurnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  readonly inferredCheckpointTurnCountByTurnId: Record<string, number>;
}) {
  const selectedCheckpointTurnCount = input.selectedTurn
    ? resolveReadyCheckpointTurnCount(input.selectedTurn, input.inferredCheckpointTurnCountByTurnId)
    : undefined;

  const conversationCheckpointTurnCount = input.selectedTurn
    ? undefined
    : input.orderedTurnDiffSummaries
        .map((summary) =>
          resolveReadyCheckpointTurnCount(summary, input.inferredCheckpointTurnCountByTurnId),
        )
        .filter((value): value is number => typeof value === "number")
        .reduce<number | undefined>(
          (latest, value) => (latest === undefined || value > latest ? value : latest),
          undefined,
        );

  let unavailableReason: string | null = null;
  if (input.selectedTurn) {
    if (input.selectedTurn.status === "missing") {
      unavailableReason = "Checkpoint still processing for this turn.";
    } else if (input.selectedTurn.status === "error") {
      unavailableReason = "Checkpoint failed for this turn.";
    }
  } else if (
    input.orderedTurnDiffSummaries.length > 0 &&
    typeof conversationCheckpointTurnCount !== "number"
  ) {
    unavailableReason = "No completed checkpoints available yet.";
  }

  return {
    selectedCheckpointTurnCount,
    conversationCheckpointTurnCount,
    unavailableReason,
  };
}
