import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

async function seedReadModel(
  customMetadata?: Record<string, string>,
): Promise<OrchestrationReadModel> {
  const now = new Date().toISOString();
  const initial = createEmptyReadModel(now);
  const withProject = await Effect.runPromise(
    projectEvent(initial, {
      sequence: 1,
      eventId: asEventId("evt-project-create"),
      aggregateKind: "project",
      aggregateId: asProjectId("project-gc-meta"),
      type: "project.created",
      occurredAt: now,
      commandId: asCommandId("cmd-project-create"),
      causationEventId: null,
      correlationId: asCommandId("cmd-project-create"),
      metadata: {},
      payload: {
        projectId: asProjectId("project-gc-meta"),
        title: "GC Meta Project",
        workspaceRoot: "/tmp/project-gc-meta",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId("evt-thread-create"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-gc-meta"),
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-thread-create"),
      causationEventId: null,
      correlationId: asCommandId("cmd-thread-create"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-gc-meta"),
        projectId: asProjectId("project-gc-meta"),
        title: "GC Meta Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
        ...(customMetadata ? { customMetadata } : {}),
      },
    }),
  );
}

describe("decideOrchestrationCommand GC metadata stamping", () => {
  it("stamps canonical GC folder fields onto incoming thread metadata updates", async () => {
    const readModel = await seedReadModel();

    const event = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: asCommandId("cmd-thread-meta-gc"),
          threadId: asThreadId("thread-gc-meta"),
          customMetadata: {
            "gc.agent": "t3code/polecat",
            "gc.rig": "t3code",
            "gc.sessionName": "t3code--polecat-1",
          },
        },
        readModel,
      }),
    );

    expect(Array.isArray(event)).toBe(false);
    expect(event).toMatchObject({
      type: "thread.meta-updated",
      payload: {
        customMetadata: {
          "gc.agent": "t3code/polecat",
          "gc.rig": "t3code",
          "gc.sessionName": "t3code--polecat-1",
          "gc.groupKind": "rig",
          "gc.groupId": "t3code",
          "gc.groupLabel": "t3code",
          "gc.agentQualified": "t3code/polecat",
          "gc.agentLabel": "polecat",
        },
      },
    });
  });

  it("backfills canonical GC folder fields on title-only thread updates", async () => {
    const readModel = await seedReadModel({
      "gc.agent": "t3code/polecat",
      "gc.rig": "t3code",
      "gc.sessionName": "t3code--polecat-1",
    });

    const event = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: asCommandId("cmd-thread-meta-title"),
          threadId: asThreadId("thread-gc-meta"),
          title: "Renamed thread",
        },
        readModel,
      }),
    );

    expect(Array.isArray(event)).toBe(false);
    expect(event).toMatchObject({
      type: "thread.meta-updated",
      payload: {
        title: "Renamed thread",
        customMetadata: {
          "gc.groupKind": "rig",
          "gc.groupId": "t3code",
          "gc.groupLabel": "t3code",
          "gc.agentQualified": "t3code/polecat",
          "gc.agentLabel": "polecat",
        },
      },
    });
  });
});
