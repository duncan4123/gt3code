import { describe, expect, it } from "vitest";

import { groupThreadsByRigAndAgent, parseGcMeta } from "./gc.ts";

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

  it("leaves non-GC threads standalone and recovers a missing rig from the agent name", () => {
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
          "gc.rig": "t3code",
        },
      },
    ]);

    expect(standaloneThreads.map((thread) => thread.id)).toEqual(["thread-1"]);
    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]?.label).toBe("t3code");
    expect(rigGroups[0]?.agentGroups[0]?.threads.map((thread) => thread.id)).toEqual(["thread-2"]);
    expect(rigGroups[0]?.agentGroups[1]?.threads.map((thread) => thread.id)).toEqual(["thread-3"]);
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

  it("prefers canonical stamped group metadata over project heuristics", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          customMetadata: {
            "gc.agent": "t3code/gastown.crew",
            "gc.groupKind": "rig",
            "gc.groupId": "t3code",
            "gc.groupLabel": "t3code",
            "gc.agentQualified": "t3code/gastown.crew",
            "gc.agentLabel": "crew",
          },
        },
        {
          id: "thread-2",
          customMetadata: {
            "gc.agent": "gastown.boot",
            "gc.groupKind": "workspace",
            "gc.groupId": "gc",
            "gc.groupLabel": "GC",
            "gc.agentQualified": "gastown.boot",
            "gc.agentLabel": "boot",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "gc",
            suspended: false,
          },
          rigs: [],
          agents: [],
        },
        projectName: "wrong-name",
        projectCwd: "/tmp/not-the-city",
      },
    );

    expect(standaloneThreads).toEqual([]);
    expect(rigGroups.map((group) => group.id)).toEqual(["gc", "t3code"]);
    expect(rigGroups[0]?.label).toBe("GC");
    expect(rigGroups[0]?.agentGroups[0]?.label).toBe("boot");
    expect(rigGroups[1]?.agentGroups[0]?.qualifiedName).toBe("t3code/gastown.crew");
  });

  it("falls back to configured agent matching from thread titles when gc metadata is absent", () => {
    const config = {
      workspace: {
        name: "gc",
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
          name: "gastown.crew",
          dir: "t3code",
          suspended: false,
        },
        {
          name: "gastown.deacon",
          suspended: false,
          scope: "city",
        },
      ],
    } as const;

    const rigResult = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          title: "t3code--gastown__crew · gastown.crew",
          customMetadata: {},
        },
      ],
      {
        config,
        projectName: "t3code",
        projectCwd: "/data/projects/t3code",
      },
    );

    expect(rigResult.standaloneThreads).toEqual([]);
    expect(rigResult.rigGroups.map((group) => group.id)).toEqual(["t3code"]);
    expect(rigResult.rigGroups[0]?.agentGroups[0]?.qualifiedName).toBe("t3code/gastown.crew");
    expect(rigResult.rigGroups[0]?.agentGroups[0]?.threads.map((thread) => thread.id)).toEqual([
      "thread-1",
    ]);

    const cityResult = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-2",
          title: "gastown__deacon · gastown.deacon",
          customMetadata: {},
        },
      ],
      {
        config,
        projectName: "gc",
        projectCwd: "/data/projects/gc",
      },
    );

    expect(cityResult.standaloneThreads).toEqual([]);
    expect(cityResult.rigGroups.map((group) => group.id)).toEqual(["gc"]);
    expect(cityResult.rigGroups[0]?.agentGroups[0]?.qualifiedName).toBe("gastown.deacon");
    expect(cityResult.rigGroups[0]?.agentGroups[0]?.threads.map((thread) => thread.id)).toEqual([
      "thread-2",
    ]);
  });
});
