import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { GcThreadContextResult, groupThreadsByRigAndAgent, parseGcMeta } from "./gc.ts";

describe("parseGcMeta", () => {
  it("decodes serialized GC session env metadata", () => {
    expect(
      parseGcMeta({
        "gc.agent": "t3code/polecat",
        "gc.rigPath": "/data/projects/t3code",
        "gc.startupWorkDir": "/data/projects/t3code/worktrees/gc-123",
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
      rigPath: "/data/projects/t3code",
      startupWorkDir: "/data/projects/t3code/worktrees/gc-123",
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

describe("GcThreadContextResult", () => {
  it("preserves bead ref and metadata needed for GC hook display", () => {
    const decoded = Schema.decodeUnknownSync(GcThreadContextResult)({
      bead: {
        id: "gc-123",
        title: "Hooked bead",
        description: "Current work",
        status: "in_progress",
        priority: 1,
        issueType: "task",
        ref: "mol-polecat-work",
        metadata: {
          branch: "polecat/gc-123",
          target: "integration/gc-sa2y",
          work_dir: "/data/projects/t3code/worktrees/gc-123",
          molecule_id: "gc-123.1",
        },
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z",
      },
      convoy: null,
      formula: null,
    });

    expect(decoded.bead?.ref).toBe("mol-polecat-work");
    expect(decoded.bead?.metadata?.branch).toBe("polecat/gc-123");
    expect(decoded.bead?.metadata?.target).toBe("integration/gc-sa2y");
    expect(decoded.bead?.metadata?.work_dir).toBe("/data/projects/t3code/worktrees/gc-123");
    expect(decoded.bead?.metadata?.molecule_id).toBe("gc-123.1");
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

  it("includes configured city-scoped agents under a threadless city project", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent([], {
      config: {
        workspace: {
          name: "t3code",
          suspended: false,
        },
        rigs: [],
        agents: [
          {
            name: "gastown.boot",
            suspended: false,
            scope: "city",
            named_session_mode: "always",
          },
          {
            name: "gastown.dog",
            suspended: false,
            scope: "city",
            min_active_sessions: 0,
            max_active_sessions: 3,
          },
          {
            name: "codex",
            provider: "codex",
            prompt_template: ".gc/system/packs/core/assets/prompts/pool-worker.md",
            default_sling_formula: "mol-do-work",
            suspended: false,
          },
        ],
      },
      projectName: "city",
      projectCwd: "/home/ubuntu/.local/state/t3code/gascity/current/city",
    });

    expect(standaloneThreads).toEqual([]);
    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]).toMatchObject({
      id: "t3code",
      label: "CITY",
      kind: "workspace",
      isConfigured: true,
    });
    expect(rigGroups[0]?.agentGroups.map((group) => group.qualifiedName)).toEqual([
      "gastown.boot",
      "gastown.dog",
    ]);
    expect(rigGroups[0]?.agentGroups[0]).toMatchObject({
      label: "boot",
      namedSessionMode: "always",
    });
    expect(rigGroups[0]?.agentGroups[1]).toMatchObject({
      label: "dog",
      minActiveSessions: 0,
      maxActiveSessions: 3,
    });
  });

  it("does not show implicit provider lanes as agent folders", () => {
    const { rigGroups } = groupThreadsByRigAndAgent([], {
      config: {
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
            name: "codex",
            provider: "codex",
            prompt_template: ".gc/system/packs/core/assets/prompts/pool-worker.md",
            default_sling_formula: "mol-do-work",
            suspended: false,
          },
          {
            name: "codex",
            dir: "t3code",
            provider: "codex",
            prompt_template: ".gc/system/packs/core/assets/prompts/pool-worker.md",
            default_sling_formula: "mol-do-work",
            suspended: false,
          },
          {
            name: "control-dispatcher",
            dir: "t3code",
            description: "Built-in deterministic graph.v2 workflow control worker",
            start_command: "gc convoy control --serve",
            max_active_sessions: 1,
            suspended: false,
          },
        ],
      },
      projectCwd: "/data/projects/t3code",
    });

    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]?.agentGroups.map((group) => group.qualifiedName)).toEqual([
      "t3code/control-dispatcher",
    ]);
    expect(rigGroups[0]?.agentGroups[0]).toMatchObject({
      description: "Built-in deterministic graph.v2 workflow control worker",
      startCommand: "gc convoy control --serve",
      maxActiveSessions: 1,
    });
  });

  it("backfills configured city agents into metadata-created workspace folders", () => {
    const { rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          customMetadata: {
            "gc.agent": "gastown__mayor",
            "gc.groupKind": "workspace",
            "gc.groupId": "city",
            "gc.groupLabel": "CITY",
            "gc.agentQualified": "gastown.mayor",
            "gc.agentLabel": "mayor",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "t3code",
            suspended: false,
          },
          rigs: [],
          agents: [
            {
              name: "gastown.dog",
              provider: "codex",
              min_active_sessions: 0,
              max_active_sessions: 3,
              wake_mode: "fresh",
              suspended: false,
            },
            {
              name: "gastown.mayor",
              provider: "codex",
              named_session_mode: "always",
              suspended: false,
            },
            {
              name: "codex",
              provider: "codex",
              prompt_template: ".gc/system/packs/core/assets/prompts/pool-worker.md",
              default_sling_formula: "mol-do-work",
              suspended: false,
            },
          ],
        },
        projectName: "city",
      },
    );

    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]).toMatchObject({
      id: "t3code",
      label: "CITY",
      kind: "workspace",
    });
    expect(rigGroups[0]?.agentGroups.map((group) => group.qualifiedName)).toEqual([
      "gastown.dog",
      "gastown.mayor",
    ]);
    expect(rigGroups[0]?.agentGroups[0]).toMatchObject({
      label: "dog",
      isPool: false,
      minActiveSessions: 0,
      maxActiveSessions: 3,
    });
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
