import { describe, expect, it } from "vitest";
import type { OrchestrationReadModel } from "@t3tools/contracts";

import { mergeGcPeekHits, previewGcPeekTargets, resolveGcPeekTargets } from "./peek.ts";

const modelSelection = {
  provider: "claudeAgent" as const,
  model: "claude-sonnet-4.5",
};

function makeSnapshot(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [],
    updatedAt: "2026-04-17T00:00:00.000Z",
    threads: [
      {
        id: "thread-1" as never,
        projectId: "project-1" as never,
        title: "Polecat 1",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        messages: [
          {
            id: "message-1" as never,
            role: "assistant",
            text: "checkpoint beta",
            turnId: null,
            streaming: false,
            createdAt: "2026-04-17T00:00:00.000Z",
            updatedAt: "2026-04-17T00:00:00.000Z",
          },
        ],
        customMetadata: {
          "gc.agent": "t3code/polecat",
          "gc.rig": "t3code",
          "gc.sessionName": "t3code--polecat-1",
        },
      },
      {
        id: "thread-2" as never,
        projectId: "project-2" as never,
        title: "Polecat 2",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        messages: [
          {
            id: "message-2" as never,
            role: "user",
            text: "build failed",
            turnId: null,
            streaming: false,
            createdAt: "2026-04-17T00:00:00.000Z",
            updatedAt: "2026-04-17T00:00:00.000Z",
          },
          {
            id: "message-3" as never,
            role: "assistant",
            text: "checkpoint alpha",
            turnId: null,
            streaming: false,
            createdAt: "2026-04-17T00:00:00.000Z",
            updatedAt: "2026-04-17T00:00:00.000Z",
          },
        ],
        customMetadata: {
          "gc.agent": "t3code/polecat",
          "gc.rig": "t3code",
          "gc.sessionName": "t3code--polecat-2",
        },
      },
      {
        id: "thread-archived" as never,
        projectId: "project-3" as never,
        title: "Archived Polecat",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        archivedAt: "2026-04-17T01:00:00.000Z",
        deletedAt: null,
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        messages: [],
        customMetadata: {
          "gc.agent": "t3code/polecat",
          "gc.rig": "t3code",
          "gc.sessionName": "t3code--polecat-old",
        },
      },
    ],
  };
}

describe("gc peek helpers", () => {
  it("resolves active threads by gc.agent", () => {
    const targets = resolveGcPeekTargets(makeSnapshot(), { agent: "t3code/polecat" });
    expect(targets).toEqual([
      {
        threadId: "thread-1",
        projectId: "project-1",
        agent: "t3code/polecat",
        rig: "t3code",
        sessionName: "t3code--polecat-1",
      },
      {
        threadId: "thread-2",
        projectId: "project-2",
        agent: "t3code/polecat",
        rig: "t3code",
        sessionName: "t3code--polecat-2",
      },
    ]);
  });

  it("resolves a specific active thread by gc.sessionName", () => {
    const targets = resolveGcPeekTargets(makeSnapshot(), { sessionName: "t3code--polecat-2" });
    expect(targets).toEqual([
      {
        threadId: "thread-2",
        projectId: "project-2",
        agent: "t3code/polecat",
        rig: "t3code",
        sessionName: "t3code--polecat-2",
      },
    ]);
  });

  it("merges snippets back with gc metadata", () => {
    const targets = resolveGcPeekTargets(makeSnapshot(), { agent: "t3code/polecat" });
    const result = mergeGcPeekHits(
      targets,
      [
        {
          results: [
            { threadId: "thread-2" as never, snippet: "checkpoint alpha" },
            { threadId: "thread-1" as never, snippet: "checkpoint beta" },
          ],
        },
      ],
      10,
    );

    expect(result).toEqual({
      results: [
        {
          threadId: "thread-2",
          projectId: "project-2",
          snippet: "checkpoint alpha",
          agent: "t3code/polecat",
          rig: "t3code",
          sessionName: "t3code--polecat-2",
        },
        {
          threadId: "thread-1",
          projectId: "project-1",
          snippet: "checkpoint beta",
          agent: "t3code/polecat",
          rig: "t3code",
          sessionName: "t3code--polecat-1",
        },
      ],
    });
  });

  it("previews latest thread messages when no query is provided", () => {
    const snapshot = makeSnapshot();
    const targets = resolveGcPeekTargets(snapshot, { sessionName: "t3code--polecat-2" });
    expect(previewGcPeekTargets(snapshot, targets, 2)).toEqual({
      results: [
        {
          threadId: "thread-2",
          projectId: "project-2",
          snippet: "checkpoint alpha",
          agent: "t3code/polecat",
          rig: "t3code",
          sessionName: "t3code--polecat-2",
        },
        {
          threadId: "thread-2",
          projectId: "project-2",
          snippet: "build failed",
          agent: "t3code/polecat",
          rig: "t3code",
          sessionName: "t3code--polecat-2",
        },
      ],
    });
  });
});
