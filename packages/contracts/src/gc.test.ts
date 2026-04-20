import { describe, expect, it } from "vitest";

import { groupThreadsByRigAndAgent, parseGcMeta } from "./gc.js";

describe("parseGcMeta", () => {
  it("decodes serialized GC session env metadata", () => {
    expect(
      parseGcMeta({
        "gc.agent": "t3code/polecat",
        "gc.sessionEnv": JSON.stringify({
          GC_AGENT: "t3code/polecat",
          GC_SESSION_NAME: "t3code--polecat",
          GC_CITY_ROOT: "/data/projects/gc",
          GT_ROOT: "/data/projects/gc",
        }),
      }),
    ).toMatchObject({
      isGcManaged: true,
      sessionName: "t3code--polecat",
      sessionEnv: {
        GC_AGENT: "t3code/polecat",
        GC_SESSION_NAME: "t3code--polecat",
        GC_CITY_ROOT: "/data/projects/gc",
        GT_ROOT: "/data/projects/gc",
      },
    });
  });

  it("prefers an explicit gc.sessionName over the serialized session env", () => {
    expect(
      parseGcMeta({
        "gc.agent": "t3code/polecat",
        "gc.sessionName": "explicit-session",
        "gc.sessionEnv": JSON.stringify({
          GC_SESSION_NAME: "env-session",
        }),
      }).sessionName,
    ).toBe("explicit-session");
  });

  it("ignores invalid serialized GC session env metadata", () => {
    expect(
      parseGcMeta({
        "gc.agent": "t3code/polecat",
        "gc.sessionEnv": "{invalid-json",
      }).sessionEnv,
    ).toBeUndefined();
  });
});

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

  it("includes configured agent folders when a rig has no threads at all", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent([], {
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
            suspended: true,
          },
        ],
      },
      projectCwd: "/data/projects/t3code",
    });

    expect(standaloneThreads).toEqual([]);
    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]?.label).toBe("t3code");
    expect(rigGroups[0]?.agentGroups.map((group) => group.label)).toEqual(["refinery", "witness"]);
    expect(rigGroups[0]?.agentGroups.map((group) => group.threads)).toEqual([[], []]);
  });

  it("includes configured city-scoped agents under the gc project even when suspended", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent([], {
      config: {
        workspace: {
          name: "gc",
          suspended: false,
        },
        rigs: [],
        agents: [
          {
            name: "mayor",
            suspended: false,
            scope: "city",
          },
          {
            name: "deacon",
            suspended: true,
            scope: "city",
          },
        ],
      },
      projectName: "gc",
      projectCwd: "/data/projects/gc",
    });

    expect(standaloneThreads).toEqual([]);
    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]?.label).toBe("GC");
    expect(rigGroups[0]?.agentGroups.map((group) => group.label)).toEqual(["deacon", "mayor"]);
    expect(rigGroups[0]?.agentGroups.map((group) => group.isSuspended)).toEqual([true, false]);
  });
});
