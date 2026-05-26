import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

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

  it("parses richer bead metadata for sidebar cards", () => {
    expect(
      parseGcMeta({
        "gc.agent": "t3code/polecat",
        "gc.bead": "t3-123",
        "gc.beadTitle": "Restore GC sidebar",
        "gc.beadStatus": "in_progress",
        "gc.beadType": "task",
        "gc.beadPriority": "1",
        "gc.beadAssignee": "t3code/polecat",
        "gc.beadLabels": "gc:merge,sidebar",
        "gc.beadDescription": "Bring back the hover card.",
      }),
    ).toMatchObject({
      bead: "t3-123",
      beadTitle: "Restore GC sidebar",
      beadStatus: "in_progress",
      beadType: "task",
      beadPriority: "1",
      beadAssignee: "t3code/polecat",
      beadLabels: "gc:merge,sidebar",
      beadDescription: "Bring back the hover card.",
    });
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
    expect(rigGroups[0]?.agentGroups[1]?.isExplicitlySuspended).toBe(true);
  });

  it("keeps explicit agent suspension separate from inherited rig suspension", () => {
    const { rigGroups } = groupThreadsByRigAndAgent([], {
      config: {
        workspace: {
          name: "city",
          suspended: false,
        },
        rigs: [
          {
            name: "test-rig",
            path: "/data/projects/test-rig",
            suspended: true,
          },
        ],
        agents: [
          {
            name: "refinery",
            dir: "test-rig",
            suspended: false,
          },
          {
            name: "witness",
            dir: "test-rig",
            suspended: true,
          },
        ],
      },
      projectCwd: "/data/projects/test-rig",
    });

    expect(rigGroups[0]?.isSuspended).toBe(true);
    expect(rigGroups[0]?.agentGroups.map((group) => group.isSuspended)).toEqual([true, true]);
    expect(rigGroups[0]?.agentGroups.map((group) => group.isExplicitlySuspended)).toEqual([
      false,
      true,
    ]);
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

  it("does not show implicit provider or control lanes as agent folders", () => {
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
    expect(rigGroups[0]?.agentGroups).toEqual([]);
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

  it("keeps rig-qualified worker sessions under their rig when stale metadata says workspace", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-worker",
          customMetadata: {
            "gc.agent": "t3code/worker",
            "gc.agentQualified": "t3code/worker",
            "gc.agentLabel": "worker",
            "gc.city": "gc",
            "gc.groupKind": "workspace",
            "gc.groupId": "gc",
            "gc.groupLabel": "GC",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "gastown",
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
              name: "worker",
              dir: "t3code",
              suspended: false,
              is_pool: true,
            },
          ],
        },
        projectCwd: "/data/projects/t3code",
        projectName: "t3code",
      },
    );

    expect(standaloneThreads).toEqual([]);
    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]).toMatchObject({
      id: "t3code",
      kind: "rig",
    });
    expect(rigGroups[0]?.agentGroups).toHaveLength(1);
    expect(rigGroups[0]?.agentGroups[0]).toMatchObject({
      label: "worker",
      qualifiedName: "t3code/worker",
      isConfigured: true,
      isPool: true,
    });
    expect(rigGroups[0]?.agentGroups[0]?.threads.map((thread) => thread.id)).toEqual([
      "thread-worker",
    ]);
  });

  it("treats merged multicity root dirs as city folders without a synthetic cities group", () => {
    const { rigGroups } = groupThreadsByRigAndAgent([], {
      config: {
        workspace: {
          name: "Cities",
          suspended: false,
        },
        rigs: [
          {
            name: "Cities",
            path: "/cities",
            suspended: false,
          },
          {
            name: "gastown",
            path: "/cities/gastown",
            suspended: false,
          },
          {
            name: "gastown/t3code",
            path: "/data/projects/t3code",
            suspended: false,
          },
          {
            name: "gascity-br",
            path: "/cities/gascity-br",
            suspended: false,
            lifecycle: {
              supervisorRunning: true,
              controllerRunning: true,
              supervisorPort: 41341,
            },
          },
          {
            name: "gascity-br/beads_rust",
            path: "/data/projects/beads_rust",
            suspended: false,
          },
        ],
        agents: [
          {
            name: "mayor",
            dir: "gastown",
            suspended: false,
          },
          {
            name: "refinery",
            dir: "gastown/t3code",
            suspended: false,
          },
          {
            name: "mayor",
            dir: "gascity-br",
            suspended: false,
          },
          {
            name: "polecat",
            dir: "gascity-br/beads_rust",
            suspended: false,
          },
        ],
      },
    });

    expect(rigGroups.map((group) => group.id)).toEqual([
      "gascity-br",
      "gascity-br/beads_rust",
      "gastown",
      "gastown/t3code",
    ]);
    expect(rigGroups.find((group) => group.id === "gascity-br")).toMatchObject({
      kind: "workspace",
      lifecycle: {
        supervisorRunning: true,
        controllerRunning: true,
        supervisorPort: 41341,
      },
      agentGroups: [{ qualifiedName: "gascity-br/mayor" }],
    });
    expect(rigGroups.find((group) => group.id === "gascity-br/beads_rust")).toMatchObject({
      kind: "rig",
      agentGroups: [{ qualifiedName: "gascity-br/beads_rust/polecat" }],
    });
    expect(rigGroups.some((group) => group.id.toLowerCase() === "cities")).toBe(false);

    const projectScopedResult = groupThreadsByRigAndAgent([], {
      config: {
        workspace: {
          name: "cities",
          suspended: false,
        },
        rigs: [
          {
            name: "gastown",
            path: "/repo/packages/gascity-config/config/cities/gastown",
            suspended: false,
          },
          {
            name: "gastown/t3code",
            path: "/repo",
            suspended: false,
          },
          {
            name: "gastown/beads-doltlite",
            path: "/repo/packages/beads-doltlite",
            suspended: false,
          },
        ],
        agents: [
          {
            name: "mayor",
            dir: "gastown",
            suspended: false,
          },
          {
            name: "refinery",
            dir: "gastown/t3code",
            suspended: false,
          },
          {
            name: "polecat",
            dir: "gastown/beads-doltlite",
            suspended: false,
          },
        ],
      },
      projectCwd: "/repo",
      projectName: "t3code",
    });

    expect(projectScopedResult.rigGroups.map((group) => group.id)).toEqual(["gastown/t3code"]);
    expect(projectScopedResult.rigGroups.some((group) => group.id === "gastown")).toBe(false);

    const cityDisplayResult = groupThreadsByRigAndAgent([], {
      config: {
        workspace: {
          name: "Cities",
          suspended: false,
        },
        rigs: [
          {
            name: "gastown",
            path: "/cities/gastown",
            suspended: true,
          },
          {
            name: "gascity-br",
            path: "/cities/gascity-br",
            suspended: false,
          },
        ],
        agents: [],
      },
    });

    expect(cityDisplayResult.rigGroups.map((group) => group.id)).toEqual(["gascity-br", "gastown"]);
    expect(cityDisplayResult.rigGroups.some((group) => group.id.toLowerCase() === "cities")).toBe(
      false,
    );
  });

  it("keeps project-owned multicity rig folders even when ownership comes from thread metadata", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-worker",
          customMetadata: {
            "gc.agent": "t3-jj/worker",
            "gc.agentQualified": "t3-jj/worker",
            "gc.city": "gascity-br",
            "gc.rig": "t3-jj",
            "gc.groupKind": "rig",
            "gc.groupId": "t3-jj",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "cities",
            suspended: false,
          },
          rigs: [
            {
              name: "gascity-br",
              path: "/repo/packages/gascity-config/config/cities/gascity-br",
              suspended: false,
            },
            {
              name: "gascity-br/t3-jj",
              path: "/repo/packages/gascity-config/config/cities/gascity-br/rigs/t3code",
              suspended: false,
            },
          ],
          agents: [
            {
              name: "worker",
              dir: "gascity-br/t3-jj",
              suspended: false,
              min_active_sessions: 1,
              max_active_sessions: 4,
              wake_mode: "fresh",
            },
          ],
        },
        projectCwd: "/repo",
        projectName: "t3code",
      },
    );

    expect(standaloneThreads).toEqual([]);
    expect(rigGroups.map((group) => group.id)).toEqual(["gascity-br/t3-jj"]);
    expect(rigGroups[0]).toMatchObject({
      kind: "rig",
      agentGroups: [
        {
          qualifiedName: "gascity-br/t3-jj/worker",
          minActiveSessions: 1,
          maxActiveSessions: 4,
          wakeMode: "fresh",
          threads: [{ id: "thread-worker" }],
        },
      ],
    });
  });

  it("normalizes stale multicity rig metadata under the configured city rig", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          customMetadata: {
            "gc.agent": "beads_rust/control-dispatcher",
            "gc.city": "gascity-br",
            "gc.rig": "beads_rust",
            "gc.groupKind": "rig",
            "gc.groupId": "beads_rust",
            "gc.agentQualified": "beads_rust/control-dispatcher",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "cities",
            suspended: false,
          },
          rigs: [
            {
              name: "gascity-br",
              path: "/cities/gascity-br",
              suspended: false,
            },
            {
              name: "gascity-br/beads_rust",
              path: "/repo/packages/gascity-config/config/cities/gascity-br/rigs/beads_rust",
              suspended: false,
            },
          ],
          agents: [
            {
              name: "control-dispatcher",
              dir: "gascity-br/beads_rust",
              suspended: false,
            },
          ],
        },
      },
    );

    expect(standaloneThreads).toEqual([]);
    expect(rigGroups.some((group) => group.id === "beads_rust")).toBe(false);
    expect(rigGroups.find((group) => group.id === "gascity-br/beads_rust")).toMatchObject({
      kind: "rig",
      agentGroups: [
        {
          qualifiedName: "gascity-br/beads_rust/control-dispatcher",
          threads: [{ id: "thread-1" }],
        },
      ],
    });
  });

  it("does not expose foreign-city thread rigs as controls for the active city", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-foreign-city",
          customMetadata: {
            "gc.agent": "beads-doltlite/polecat",
            "gc.agentQualified": "beads-doltlite/polecat",
            "gc.city": "gastown",
            "gc.rig": "beads-doltlite",
            "gc.groupKind": "rig",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "gascity-br",
            suspended: false,
          },
          rigs: [
            {
              name: "t3-jj",
              path: "/repo/packages/gascity-config/config/cities/gascity-br/rigs/t3code",
              suspended: false,
            },
          ],
          agents: [],
        },
      },
    );

    expect(rigGroups.map((group) => group.id)).toEqual(["gascity-br", "t3-jj"]);
    expect(rigGroups.some((group) => group.id === "beads-doltlite")).toBe(false);
    expect(standaloneThreads.map((thread) => thread.id)).toEqual(["thread-foreign-city"]);
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

  it("seeds configured agent folders only under the matching rig project", () => {
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
        {
          name: "beads-doltlite",
          path: "/data/projects/t3code/packages/beads-doltlite",
          suspended: false,
        },
      ],
      agents: [
        {
          name: "gastown.crew",
          dir: "t3code",
          suspended: false,
          is_pool: true,
          min_active_sessions: 1,
          max_active_sessions: 3,
        },
        {
          name: "polecat",
          dir: "beads-doltlite",
          suspended: false,
          named_session_mode: "on_demand",
        },
      ],
    } as const;

    const packageProjectResult = groupThreadsByRigAndAgent([], {
      config,
      projectCwd: "/data/projects/t3code/packages/gascity",
      projectName: "gascity",
    });

    expect(packageProjectResult.rigGroups).toEqual([]);

    const repositoryProjectResult = groupThreadsByRigAndAgent([], {
      config,
      projectCwd: "/data/projects/t3code",
      projectName: "t3code",
    });

    expect(repositoryProjectResult.rigGroups.map((group) => group.id)).toEqual(["t3code"]);
    expect(
      repositoryProjectResult.rigGroups.find((group) => group.id === "t3code")?.agentGroups[0],
    ).toMatchObject({
      qualifiedName: "t3code/gastown.crew",
      minActiveSessions: 1,
      maxActiveSessions: 3,
    });

    const beadsProjectResult = groupThreadsByRigAndAgent([], {
      config,
      projectCwd: "/data/projects/t3code/packages/beads-doltlite",
      projectName: "beads-doltlite",
    });

    expect(beadsProjectResult.rigGroups.map((group) => group.id)).toEqual(["beads-doltlite"]);
    expect(
      beadsProjectResult.rigGroups.find((group) => group.id === "beads-doltlite")?.agentGroups[0],
    ).toMatchObject({
      qualifiedName: "beads-doltlite/polecat",
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

  it("does not let stale workspace metadata relabel configured city folders", () => {
    const { rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          customMetadata: {
            "gc.city": "gascity-br",
            "gc.groupId": "gascity-br",
            "gc.groupLabel": "GASTOWN",
            "gc.groupKind": "workspace",
            "gc.agent": "mayor",
            "gc.agentQualified": "gascity-br/mayor",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "cities",
            path: "/repo/packages/gascity-config/config/cities",
            suspended: false,
          },
          rigs: [
            {
              name: "gascity-br",
              path: "/repo/packages/gascity-config/config/cities/gascity-br",
              suspended: false,
            },
            {
              name: "gascity-br/t3-jj",
              path: "/repo/packages/gascity-config/config/cities/gascity-br/rigs/t3code",
              suspended: false,
            },
          ],
          agents: [
            {
              name: "mayor",
              dir: "gascity-br",
              suspended: false,
            },
          ],
        },
      },
    );

    expect(rigGroups.find((group) => group.id === "gascity-br")).toMatchObject({
      label: "GASCITY-BR",
      kind: "workspace",
    });
  });

  it("keeps unqualified workspace thread agents in their metadata city", () => {
    const { rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          title: "city-b__mayor · mayor",
          customMetadata: {
            "gc.city": "city-b",
            "gc.groupId": "city-b",
            "gc.groupKind": "workspace",
            "gc.agent": "mayor",
            "gc.agentQualified": "mayor",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "cities",
            suspended: false,
          },
          rigs: [
            {
              name: "city-a",
              path: "/fixtures/cities/city-a",
              suspended: false,
            },
            {
              name: "city-a/repo-main",
              path: "/fixtures/repos/city-a/repo-main",
              suspended: false,
            },
            {
              name: "city-b",
              path: "/fixtures/cities/city-b",
              suspended: false,
            },
            {
              name: "city-b/repo-main",
              path: "/fixtures/repos/city-b/repo-main",
              suspended: false,
            },
          ],
          agents: [
            {
              name: "mayor",
              dir: "city-a",
              suspended: false,
            },
            {
              name: "mayor",
              dir: "city-b",
              suspended: false,
            },
          ],
        },
      },
    );

    expect(
      rigGroups
        .find((group) => group.id === "city-a")
        ?.agentGroups.find((agent) => agent.qualifiedName === "city-a/mayor")?.threads,
    ).toEqual([]);
    expect(
      rigGroups
        .find((group) => group.id === "city-b")
        ?.agentGroups.find((agent) => agent.qualifiedName === "city-b/mayor")?.threads,
    ).toHaveLength(1);
  });

  it("recovers legacy title-only city workspace threads from configured session names", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          title: "city-a__mayor · city-a.mayor",
        },
      ],
      {
        config: {
          workspace: {
            name: "cities",
            suspended: false,
          },
          rigs: [
            {
              name: "city-a",
              path: "/fixtures/cities/city-a",
              suspended: false,
            },
            {
              name: "city-a/repo-main",
              path: "/fixtures/repos/city-a/repo-main",
              suspended: false,
            },
          ],
          agents: [
            {
              name: "mayor",
              dir: "city-a",
              scope: "city",
              suspended: false,
              named_session_mode: "always",
            },
          ],
        },
      },
    );

    expect(standaloneThreads).toEqual([]);
    expect(
      rigGroups
        .find((group) => group.id === "city-a")
        ?.agentGroups.find((agent) => agent.qualifiedName === "city-a/mayor")?.threads,
    ).toHaveLength(1);
  });

  it("recovers legacy title-only rig threads from local t3bridge session names", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          title: "repo-main--worker · worker",
        },
      ],
      {
        config: {
          workspace: {
            name: "cities",
            suspended: false,
          },
          rigs: [
            {
              name: "city-a",
              path: "/fixtures/cities/city-a",
              suspended: false,
            },
            {
              name: "city-a/repo-main",
              path: "/fixtures/repos/city-a/repo-main",
              suspended: false,
            },
          ],
          agents: [
            {
              name: "worker",
              dir: "city-a/repo-main",
              scope: "rig",
              suspended: false,
              named_session_mode: "always",
            },
          ],
        },
      },
    );

    expect(standaloneThreads).toEqual([]);
    expect(
      rigGroups
        .find((group) => group.id === "city-a/repo-main")
        ?.agentGroups.find((agent) => agent.qualifiedName === "city-a/repo-main/worker")?.threads,
    ).toHaveLength(1);
  });

  it("repairs stale legacy GC metadata when the configured session name is more specific", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-1",
          title: "repo-main--worker · worker",
          customMetadata: {
            "gc.agent": "worker",
            "gc.agentQualified": "worker",
            "gc.groupKind": "rig",
            "gc.groupId": "repo-main",
            "gc.rig": "repo-main",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "cities",
            suspended: false,
          },
          rigs: [
            {
              name: "city-a",
              path: "/fixtures/cities/city-a",
              suspended: false,
            },
            {
              name: "city-a/repo-main",
              path: "/fixtures/repos/city-a/repo-main",
              suspended: false,
            },
          ],
          agents: [
            {
              name: "worker",
              dir: "city-a/repo-main",
              scope: "rig",
              suspended: false,
              named_session_mode: "always",
            },
          ],
        },
      },
    );

    expect(standaloneThreads).toEqual([]);
    expect(
      rigGroups
        .find((group) => group.id === "city-a/repo-main")
        ?.agentGroups.find((agent) => agent.qualifiedName === "city-a/repo-main/worker")?.threads,
    ).toHaveLength(1);
    expect(rigGroups.find((group) => group.id === "repo-main")).toBeUndefined();
  });

  it("does not create rig folders for implicit provider or control agents", () => {
    const { standaloneThreads, rigGroups } = groupThreadsByRigAndAgent(
      [
        {
          id: "thread-worker",
          customMetadata: {
            "gc.agent": "t3code/worker",
            "gc.agentQualified": "t3code/worker",
            "gc.agentLabel": "worker",
            "gc.rig": "t3code",
          },
        },
        {
          id: "thread-codex",
          customMetadata: {
            "gc.agent": "t3code/codex",
            "gc.agentQualified": "t3code/codex",
            "gc.agentLabel": "codex",
            "gc.rig": "t3code",
          },
        },
        {
          id: "thread-control-dispatcher",
          customMetadata: {
            "gc.agent": "t3code/control-dispatcher",
            "gc.agentQualified": "t3code/control-dispatcher",
            "gc.agentLabel": "control-dispatcher",
            "gc.rig": "t3code",
          },
        },
      ],
      {
        config: {
          workspace: {
            name: "gastown",
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
              name: "worker",
              dir: "t3code",
              suspended: false,
              is_pool: true,
            },
            {
              name: "codex",
              dir: "t3code",
              suspended: false,
              provider: "codex",
              prompt_template: ".gc/system/packs/core/assets/prompts/pool-worker.md",
              default_sling_formula: "mol-do-work",
            },
            {
              name: "control-dispatcher",
              dir: "t3code",
              suspended: false,
              description: "Built-in deterministic graph.v2 workflow control worker",
              start_command:
                "gc internal convoy control --serve --follow --city gastown",
            },
          ],
        },
        projectCwd: "/data/projects/t3code",
        projectName: "t3code",
      },
    );

    expect(rigGroups).toHaveLength(1);
    expect(rigGroups[0]).toMatchObject({
      id: "t3code",
      kind: "rig",
    });
    expect(rigGroups[0]?.agentGroups.map((group) => group.qualifiedName)).toEqual([
      "t3code/worker",
    ]);
    expect(rigGroups[0]?.agentGroups[0]?.threads.map((thread) => thread.id)).toEqual([
      "thread-worker",
    ]);
    expect(standaloneThreads.map((thread) => thread.id)).toEqual([
      "thread-codex",
      "thread-control-dispatcher",
    ]);
  });
});
