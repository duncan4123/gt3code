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

  it("seeds configured agent folders from grouped project members", () => {
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
          named_session_mode: "always",
        },
        {
          name: "deacon",
          suspended: false,
          named_session_mode: "on_demand",
        },
      ],
    } as const;

    const rigResult = groupThreadsByRigAndAgent([], {
      config,
      projectCwd: "/data/projects/shared-group",
      projectName: "Shared Group",
      projectMembers: [
        {
          cwd: "/data/projects/t3code",
          name: "t3code",
        },
      ],
    });

    expect(rigResult.rigGroups.map((group) => group.id)).toEqual(["t3code"]);
    expect(rigResult.rigGroups[0]?.agentGroups[0]).toMatchObject({
      qualifiedName: "t3code/gastown.crew",
      label: "crew",
      namedSessionMode: "always",
    });

    const cityResult = groupThreadsByRigAndAgent([], {
      config,
      projectCwd: "/data/projects/shared-group",
      projectName: "Shared Group",
      projectMembers: [
        {
          cwd: "/data/projects/gc",
          name: "gc",
        },
      ],
    });

    expect(cityResult.rigGroups.map((group) => group.id)).toEqual(["gc"]);
    expect(cityResult.rigGroups[0]?.agentGroups[0]).toMatchObject({
      qualifiedName: "deacon",
      namedSessionMode: "on_demand",
    });
  });

  it("enriches thread-created named-session rows from config", () => {
    const { rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          customMetadata: {
            "gc.agent": "gascity/gastown.witness",
            "gc.rig": "gascity",
            "gc.agentQualified": "gascity/gastown.witness",
            "gc.agentLabel": "witness",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "gc",
            suspended: false,
          },
          rigs: [
            {
              name: "gascity",
              path: "/data/projects/gascity",
              suspended: false,
            },
          ],
          agents: [
            {
              name: "gastown.witness",
              dir: "gascity",
              suspended: false,
              named_session_mode: "on_demand",
            },
          ],
        },
        projectCwd: "/data/projects/some-other-project",
      },
    );

    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]?.agentGroups[0]).toMatchObject({
      qualifiedName: "gascity/gastown.witness",
      isConfigured: true,
      isPool: false,
      namedSessionMode: "on_demand",
    });
  });

  it("enriches thread-created pool rows from config", () => {
    const { rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          customMetadata: {
            "gc.agent": "gascity/gastown.polecat",
            "gc.rig": "gascity",
            "gc.agentQualified": "gascity/gastown.polecat",
            "gc.agentLabel": "polecat",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "gc",
            suspended: false,
          },
          rigs: [
            {
              name: "gascity",
              path: "/data/projects/gascity",
              suspended: false,
            },
          ],
          agents: [
            {
              name: "gastown.polecat",
              dir: "gascity",
              suspended: false,
              is_pool: true,
              min_active_sessions: 0,
              max_active_sessions: 5,
              wake_mode: "fresh",
            },
          ],
        },
        projectCwd: "/data/projects/some-other-project",
      },
    );

    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]?.agentGroups[0]).toMatchObject({
      qualifiedName: "gascity/gastown.polecat",
      isConfigured: true,
      isPool: true,
      minActiveSessions: 0,
      maxActiveSessions: 5,
      wakeMode: "fresh",
    });
    expect(rigGroups[0]?.agentGroups[0]?.namedSessionMode).toBeUndefined();
  });
});
