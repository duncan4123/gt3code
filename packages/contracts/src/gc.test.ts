import { describe, expect, it } from "vitest";

import { groupThreadsByRigAndAgent } from "./gc";

describe("groupThreadsByRigAndAgent", () => {
  it("groups GC-managed threads into rig and agent folders", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent([
      {
        id: "thread-1",
        customMetadata: {
          "gc.agent": "t3code/refinery",
          "gc.rig": "alpha",
        },
      },
      {
        id: "thread-2",
        customMetadata: {
          "gc.agent": "t3code/refinery",
          "gc.rig": "alpha",
        },
      },
      {
        id: "thread-3",
        customMetadata: {
          "gc.agent": "t3code/witness",
          "gc.rig": "alpha",
        },
      },
      {
        id: "thread-4",
        customMetadata: {
          "gc.agent": "ops/mayor",
          "gc.rig": "beta",
        },
      },
    ]);

    expect(standaloneThreads).toHaveLength(0);
    expect(rigGroups.map((group) => group.label)).toEqual(["alpha", "beta"]);
    expect(rigGroups[0]?.agentGroups.map((group) => group.label)).toEqual(["refinery", "witness"]);
    expect(rigGroups[0]?.agentGroups[0]?.threads.map((thread) => thread.id)).toEqual([
      "thread-1",
      "thread-2",
    ]);
    expect(rigGroups[1]?.agentGroups[0]?.qualifiedName).toBe("ops/mayor");
  });

  it("leaves non-GC and incomplete GC metadata as standalone threads", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent([
      { id: "thread-1" },
      {
        id: "thread-2",
        customMetadata: {
          "gc.agent": "t3code/refinery",
        },
      },
      {
        id: "thread-3",
        customMetadata: {
          "gc.agent": "t3code/witness",
          "gc.rig": "alpha",
        },
      },
    ]);

    expect(standaloneThreads.map((thread) => thread.id)).toEqual(["thread-1", "thread-2"]);
    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]?.label).toBe("alpha");
    expect(rigGroups[0]?.agentGroups[0]?.threads.map((thread) => thread.id)).toEqual(["thread-3"]);
  });

  it("includes configured agent folders even when no threads exist yet", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          customMetadata: {
            "gc.agent": "t3code/refinery",
            "gc.rig": "t3code",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "city",
            suspended: false,
          },
          rigs: [
            {
              name: "t3code",
              path: "/data/projects/t3code",
              suspended: false,
            },
          ],
          agents: [
            {
              name: "refinery",
              dir: "t3code",
              suspended: false,
            },
            {
              name: "witness",
              dir: "t3code",
              is_pool: true,
              suspended: true,
            },
          ],
        },
        projectCwd: "/data/projects/t3code",
      },
    );

    expect(standaloneThreads).toHaveLength(0);
    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]?.label).toBe("t3code");
    expect(rigGroups[0]?.agentGroups.map((group) => group.label)).toEqual(["refinery", "witness"]);
    expect(rigGroups[0]?.agentGroups[0]?.isConfigured).toBe(true);
    expect(rigGroups[0]?.agentGroups[0]?.threads.map((thread) => thread.id)).toEqual(["thread-1"]);
    expect(rigGroups[0]?.agentGroups[1]?.threads).toEqual([]);
    expect(rigGroups[0]?.agentGroups[1]?.isPool).toBe(true);
    expect(rigGroups[0]?.agentGroups[1]?.isSuspended).toBe(true);
  });
});
