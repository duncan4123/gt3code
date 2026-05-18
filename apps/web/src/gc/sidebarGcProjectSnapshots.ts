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

function isGcCityRootProject(
  member: Pick<SidebarProjectGroupMember, "cwd">,
  gcCityRootPaths: ReadonlySet<string>,
): boolean {
  const cwd = normalizeGcProjectPath(member.cwd);
  return Boolean(cwd && gcCityRootPaths.has(cwd));
}

function gcRigMemberGroupKey(member: Pick<SidebarProjectGroupMember, "cwd">): string {
  return normalizeGcProjectPath(member.cwd) ?? "";
}

function configuredCityRootNames(rigs: readonly GcConfigResult["rigs"][number][]): Set<string> {
  const rigNames = new Set(rigs.map((rig) => rig.name.trim()).filter(Boolean));
  const cityNames = new Set<string>();
  for (const rigName of rigNames) {
    const separatorIndex = rigName.indexOf("/");
    if (separatorIndex <= 0) {
      continue;
    }
    const cityName = rigName.slice(0, separatorIndex);
    if (rigNames.has(cityName)) {
      cityNames.add(cityName);
    }
  }
  return cityNames;
}

function gcRigProjectPaths(config: GcConfigResult): Set<string> {
  const cityRootNames = configuredCityRootNames(config.rigs);
  return new Set(
    config.rigs
      .filter((rig) => !cityRootNames.has(rig.name.trim()))
      .map((rig) => normalizeGcProjectPath(rig.path))
      .filter((path): path is string => Boolean(path)),
  );
}

function gcCityRootProjectPaths(config: GcConfigResult): Set<string> {
  const cityRootNames = configuredCityRootNames(config.rigs);
  return new Set(
    config.rigs
      .filter((rig) => cityRootNames.has(rig.name.trim()))
      .map((rig) => normalizeGcProjectPath(rig.path))
      .filter((path): path is string => Boolean(path)),
  );
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

  const gcRigPaths = gcRigProjectPaths(input.gcConfig);
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
    const rigMemberGroups = new Map<string, SidebarProjectGroupMember[]>();
    for (const member of rigMembers) {
      const key = gcRigMemberGroupKey(member);
      const existing = rigMemberGroups.get(key);
      if (existing) {
        existing.push(member);
      } else {
        rigMemberGroups.set(key, [member]);
      }
    }

    return [
      ...Array.from(rigMemberGroups.values()).map((members) =>
        members.length === 1
          ? singleMemberSnapshot(members[0]!, input.primaryEnvironmentId)
          : groupedRemainderSnapshot(snapshot, members, input.primaryEnvironmentId),
      ),
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
  if (!input.gcConfig) {
    return [...input.snapshots];
  }

  const gcCityRootPaths = gcCityRootProjectPaths(input.gcConfig);
  if (gcCityRootPaths.size === 0) {
    return [...input.snapshots];
  }

  return input.snapshots.flatMap((snapshot) => {
    const visibleMembers = snapshot.memberProjects.filter(
      (member) => !isGcCityRootProject(member, gcCityRootPaths),
    );
    if (visibleMembers.length === snapshot.memberProjects.length) {
      return [snapshot];
    }
    if (visibleMembers.length === 0) {
      return [];
    }
    return [groupedRemainderSnapshot(snapshot, visibleMembers, input.primaryEnvironmentId)];
  });
}
