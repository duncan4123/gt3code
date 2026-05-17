import { scopeProjectRef } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { GcConfigResult } from "@t3tools/contracts";

import type {
  EnvironmentPresence,
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";

function normalizeGcProjectPath(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized ? normalized : null;
}

function isGcRigProject(
  member: Pick<SidebarProjectGroupMember, "cwd">,
  gcRigPaths: ReadonlySet<string>,
): boolean {
  const cwd = normalizeGcProjectPath(member.cwd);
  return Boolean(cwd && gcRigPaths.has(cwd));
}

function gcOwnedProjectPaths(gcConfig: GcConfigResult | null): Set<string> {
  const paths = new Set<string>();
  const workspacePath = normalizeGcProjectPath(gcConfig?.workspace.path);
  if (workspacePath) {
    paths.add(workspacePath);
  }
  for (const rig of gcConfig?.rigs ?? []) {
    const rigPath = normalizeGcProjectPath(rig.path);
    if (rigPath) {
      paths.add(rigPath);
    }
  }
  return paths;
}

function environmentPresenceForMember(
  member: Pick<SidebarProjectGroupMember, "environmentId">,
  primaryEnvironmentId: EnvironmentId | null,
): EnvironmentPresence {
  if (!primaryEnvironmentId) {
    return "local-only";
  }
  return member.environmentId === primaryEnvironmentId ? "local-only" : "remote-only";
}

function singleMemberSnapshot(
  member: SidebarProjectGroupMember,
  primaryEnvironmentId: EnvironmentId | null,
): SidebarProjectSnapshot {
  return {
    ...member,
    projectKey: member.physicalProjectKey,
    displayName: member.name,
    groupedProjectCount: 1,
    environmentPresence: environmentPresenceForMember(member, primaryEnvironmentId),
    memberProjects: [member],
    memberProjectRefs: [scopeProjectRef(member.environmentId, member.id)],
    remoteEnvironmentLabels:
      primaryEnvironmentId !== null &&
      member.environmentId !== primaryEnvironmentId &&
      member.environmentLabel
        ? [member.environmentLabel]
        : [],
  };
}

function groupedRemainderSnapshot(
  snapshot: SidebarProjectSnapshot,
  members: readonly SidebarProjectGroupMember[],
  primaryEnvironmentId: EnvironmentId | null,
): SidebarProjectSnapshot {
  if (members.length === 1) {
    return singleMemberSnapshot(members[0]!, primaryEnvironmentId);
  }

  const hasLocal =
    primaryEnvironmentId !== null &&
    members.some((member) => member.environmentId === primaryEnvironmentId);
  const hasRemote =
    primaryEnvironmentId !== null &&
    members.some((member) => member.environmentId !== primaryEnvironmentId);
  const remoteEnvironmentLabels = members
    .filter(
      (member) => primaryEnvironmentId !== null && member.environmentId !== primaryEnvironmentId,
    )
    .flatMap((member) => (member.environmentLabel ? [member.environmentLabel] : []))
    .filter((label, index, labels) => labels.indexOf(label) === index);

  return {
    ...snapshot,
    groupedProjectCount: members.length,
    environmentPresence: hasLocal && hasRemote ? "mixed" : hasRemote ? "remote-only" : "local-only",
    memberProjects: members,
    memberProjectRefs: members.map((member) => scopeProjectRef(member.environmentId, member.id)),
    remoteEnvironmentLabels,
  };
}

export function splitGcRigProjectSnapshots(input: {
  snapshots: readonly SidebarProjectSnapshot[];
  gcConfig: GcConfigResult | null;
  primaryEnvironmentId: EnvironmentId | null;
}): SidebarProjectSnapshot[] {
  if (!input.gcConfig) {
    return [...input.snapshots];
  }

  const gcRigPaths = new Set(
    input.gcConfig.rigs
      .filter((rig) => rig.isRepository === true)
      .map((rig) => normalizeGcProjectPath(rig.path))
      .filter((path): path is string => Boolean(path)),
  );
  if (gcRigPaths.size === 0) {
    return [...input.snapshots];
  }

  return input.snapshots.flatMap((snapshot) => {
    if (snapshot.memberProjects.length <= 1) {
      return [snapshot];
    }

    const rigMembers = snapshot.memberProjects.filter((member) =>
      isGcRigProject(member, gcRigPaths),
    );
    if (rigMembers.length === 0) {
      return [snapshot];
    }

    const remainderMembers = snapshot.memberProjects.filter(
      (member) => !isGcRigProject(member, gcRigPaths),
    );
    return [
      ...rigMembers.map((member) => singleMemberSnapshot(member, input.primaryEnvironmentId)),
      ...(remainderMembers.length > 0
        ? [groupedRemainderSnapshot(snapshot, remainderMembers, input.primaryEnvironmentId)]
        : []),
    ];
  });
}

export function filterGcOwnedProjectSnapshots(input: {
  snapshots: readonly SidebarProjectSnapshot[];
  gcConfig: GcConfigResult | null;
  primaryEnvironmentId: EnvironmentId | null;
}): SidebarProjectSnapshot[] {
  const gcProjectPaths = gcOwnedProjectPaths(input.gcConfig);
  if (gcProjectPaths.size === 0) {
    return [...input.snapshots];
  }

  return input.snapshots.flatMap((snapshot) => {
    const members = snapshot.memberProjects;
    if (members.length === 0) {
      const cwd = normalizeGcProjectPath(snapshot.cwd);
      return cwd && gcProjectPaths.has(cwd) ? [] : [snapshot];
    }
    const nonGcMembers = members.filter((member) => {
      const cwd = normalizeGcProjectPath(member.cwd);
      return !(cwd && gcProjectPaths.has(cwd));
    });
    if (nonGcMembers.length === 0) {
      return [];
    }
    if (nonGcMembers.length === members.length) {
      return [snapshot];
    }
    return [groupedRemainderSnapshot(snapshot, nonGcMembers, input.primaryEnvironmentId)];
  });
}
