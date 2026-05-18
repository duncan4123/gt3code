import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type GcConfigResult,
  type RepositoryIdentity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import type { Project } from "../types";
import {
  filterGcOwnedProjectSnapshots,
  splitGcRigProjectSnapshots,
} from "./sidebarGcProjectSnapshots";

const environmentId = EnvironmentId.make("env-primary");

function makeProject(input: { id: string; name: string; cwd: string }): Project {
  return {
    id: ProjectId.make(input.id),
    environmentId,
    name: input.name,
    cwd: input.cwd,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4-mini",
    },
    scripts: [],
  };
}

function makeGcConfig(): GcConfigResult {
  return {
    workspace: {
      name: "cities",
      path: "/home/user/cities",
      suspended: false,
    },
    agents: [],
    rigs: [
      {
        name: "user-city",
        path: "/home/user/cities/user-city",
        suspended: false,
        isRepository: false,
      },
      {
        name: "user-city/customer-api",
        path: "/home/user/work/customer-api",
        suspended: false,
        isRepository: true,
      },
      {
        name: "user-city/docs-site",
        path: "/home/user/work/docs-site",
        suspended: false,
        isRepository: true,
      },
      {
        name: "user-city/generated-scratch",
        path: "/home/user/cities/user-city/rigs/generated-scratch",
        suspended: false,
        isRepository: false,
      },
    ],
  };
}

function snapshots(
  projects: readonly Project[],
  groupingMode: "repository" | "repository_path" = "repository_path",
) {
  return buildSidebarProjectSnapshots({
    projects: [...projects],
    settings: {
      sidebarProjectGroupingMode: groupingMode,
      sidebarProjectGroupingOverrides: {},
    },
    primaryEnvironmentId: environmentId,
    resolveEnvironmentLabel: () => null,
  });
}

function repositoryIdentity(canonicalKey: string): RepositoryIdentity {
  return {
    canonicalKey,
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "https://example.test/repo.git",
    },
  };
}

describe("filterGcOwnedProjectSnapshots", () => {
  it("removes GC city roots and keeps rig project rows in the normal Projects list", () => {
    const visible = filterGcOwnedProjectSnapshots({
      snapshots: snapshots([
        makeProject({ id: "city", name: "user-city", cwd: "/home/user/cities/user-city" }),
        makeProject({ id: "rig", name: "customer-api", cwd: "/home/user/work/customer-api/" }),
        makeProject({
          id: "non-repo",
          name: "generated-scratch",
          cwd: "/home/user/cities/user-city/rigs/generated-scratch",
        }),
        makeProject({ id: "regular", name: "server", cwd: "/home/user/work/server" }),
      ]),
      gcConfig: makeGcConfig(),
      primaryEnvironmentId: environmentId,
    });

    expect(visible.map((snapshot) => snapshot.displayName)).toEqual([
      "customer-api",
      "generated-scratch",
      "server",
    ]);
  });

  it("keeps every member when a grouped project contains both GC and non-GC projects", () => {
    const [grouped] = snapshots(
      [
        {
          ...makeProject({ id: "rig", name: "customer-api", cwd: "/home/user/work/customer-api" }),
          repositoryIdentity: repositoryIdentity("repo-key"),
        },
        {
          ...makeProject({ id: "regular", name: "server", cwd: "/home/user/work/server" }),
          repositoryIdentity: repositoryIdentity("repo-key"),
        },
      ],
      "repository",
    );

    const [split] = splitGcRigProjectSnapshots({
      snapshots: grouped ? [grouped] : [],
      gcConfig: makeGcConfig(),
      primaryEnvironmentId: environmentId,
    }).filter((snapshot) => snapshot.memberProjects.some((member) => member.name === "server"));

    const visible = filterGcOwnedProjectSnapshots({
      snapshots: split ? [split] : [],
      gcConfig: makeGcConfig(),
      primaryEnvironmentId: environmentId,
    });

    expect(visible).toHaveLength(1);
    expect(visible[0]?.memberProjects.map((member) => member.name)).toEqual(["server"]);
  });

  it("removes GC city members from mixed repository groups", () => {
    const [grouped] = snapshots(
      [
        {
          ...makeProject({ id: "city", name: "user-city", cwd: "/home/user/cities/user-city" }),
          repositoryIdentity: repositoryIdentity("repo-key"),
        },
        {
          ...makeProject({ id: "regular", name: "server", cwd: "/home/user/work/server" }),
          repositoryIdentity: repositoryIdentity("repo-key"),
        },
      ],
      "repository",
    );

    const visible = filterGcOwnedProjectSnapshots({
      snapshots: grouped ? [grouped] : [],
      gcConfig: makeGcConfig(),
      primaryEnvironmentId: environmentId,
    });

    expect(visible).toHaveLength(1);
    expect(visible[0]?.memberProjects.map((member) => member.name)).toEqual(["server"]);
    expect(visible[0]?.groupedProjectCount).toBe(1);
  });

  it("removes city roots from grouped repository rows", () => {
    const [grouped] = snapshots(
      [
        {
          ...makeProject({ id: "root", name: "customer-api", cwd: "/home/user/work/customer-api" }),
          repositoryIdentity: repositoryIdentity("repo-key"),
        },
        {
          ...makeProject({ id: "city", name: "user-city", cwd: "/home/user/cities/user-city" }),
          repositoryIdentity: repositoryIdentity("repo-key"),
        },
        {
          ...makeProject({
            id: "generated",
            name: "generated-scratch",
            cwd: "/home/user/cities/user-city/rigs/generated-scratch",
          }),
          repositoryIdentity: repositoryIdentity("repo-key"),
        },
      ],
      "repository",
    );

    const visible = filterGcOwnedProjectSnapshots({
      snapshots: grouped ? [grouped] : [],
      gcConfig: makeGcConfig(),
      primaryEnvironmentId: environmentId,
    });

    expect(visible).toHaveLength(1);
    expect(visible[0]?.memberProjects.map((member) => member.name)).toEqual([
      "customer-api",
      "generated-scratch",
    ]);
  });

  it("does not duplicate project rows for multiple records of the same repository rig path", () => {
    const [grouped] = snapshots(
      [
        {
          ...makeProject({
            id: "rig-a",
            name: "customer-api",
            cwd: "/home/user/work/customer-api",
          }),
          repositoryIdentity: repositoryIdentity("repo-key"),
        },
        {
          ...makeProject({
            id: "rig-b",
            name: "customer-api",
            cwd: "/home/user/work/customer-api/",
          }),
          repositoryIdentity: repositoryIdentity("repo-key"),
        },
      ],
      "repository",
    );

    const split = splitGcRigProjectSnapshots({
      snapshots: grouped ? [grouped] : [],
      gcConfig: makeGcConfig(),
      primaryEnvironmentId: environmentId,
    });

    expect(split).toHaveLength(1);
    expect(split[0]?.displayName).toBe("customer-api");
    expect(split[0]?.memberProjects.map((member) => member.id)).toEqual([
      ProjectId.make("rig-a"),
      ProjectId.make("rig-b"),
    ]);
  });
});
