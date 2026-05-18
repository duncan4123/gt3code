import { useEffect } from "react";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type GcConfigResult,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { readLocalApi } from "../localApi";
import { newCommandId, newProjectId } from "../lib/utils";
import { toastManager } from "../components/ui/toast";

interface GcRigProject {
  cwd: string;
}

const pendingGcRigProjectCwds = new Set<string>();

function normalizeProjectPath(path: string): string {
  return path.trim().replace(/\/+$/, "");
}

function projectNameFromRigName(rigName: string): string {
  const segments = rigName.split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]?.trim();
    if (segment) {
      return segment;
    }
  }
  return rigName;
}

export function configuredWorkspaceRigNames(
  rigs: readonly GcConfigResult["rigs"][number][],
): Set<string> {
  const rigNames = new Set(rigs.map((rig) => rig.name.trim()).filter(Boolean));
  const workspaceRigNames = new Set<string>();
  for (const rigName of rigNames) {
    const separatorIndex = rigName.indexOf("/");
    if (separatorIndex <= 0) {
      continue;
    }
    const workspaceName = rigName.slice(0, separatorIndex);
    if (rigNames.has(workspaceName)) {
      workspaceRigNames.add(workspaceName);
    }
  }
  return workspaceRigNames;
}

export function resolveMissingGcRigProjects(input: {
  projects: readonly GcRigProject[];
  gcConfig: GcConfigResult | null;
  pendingCwds: ReadonlySet<string>;
}): GcConfigResult["rigs"] {
  if (!input.gcConfig) {
    return [];
  }

  const existingCwds = new Set(
    input.projects
      .map((project) => normalizeProjectPath(project.cwd))
      .filter((cwd) => cwd.length > 0),
  );
  const workspaceRigNames = configuredWorkspaceRigNames(input.gcConfig.rigs);

  return input.gcConfig.rigs.filter((rig) => {
    const rigName = rig.name.trim();
    if (workspaceRigNames.has(rigName)) {
      return false;
    }
    if (rig.isRepository !== true) {
      return false;
    }
    const normalizedRigPath = normalizeProjectPath(rig.path);
    return (
      normalizedRigPath.length > 0 &&
      !existingCwds.has(normalizedRigPath) &&
      !input.pendingCwds.has(normalizedRigPath)
    );
  });
}

export function useGcRigProjects(input: {
  projects: readonly GcRigProject[];
  gcConfig: GcConfigResult | null;
  isProjectSnapshotReady: boolean;
}): void {
  useEffect(() => {
    const existingProjectCwds = new Set(
      input.projects
        .map((project) => normalizeProjectPath(project.cwd))
        .filter((cwd) => cwd.length > 0),
    );
    for (const pendingCwd of pendingGcRigProjectCwds) {
      if (existingProjectCwds.has(pendingCwd)) {
        pendingGcRigProjectCwds.delete(pendingCwd);
      }
    }
  }, [input.projects]);

  useEffect(() => {
    const api = readLocalApi();
    if (!api || !input.gcConfig) {
      return;
    }
    if (!input.isProjectSnapshotReady && input.projects.length === 0) {
      return;
    }

    const missingRigs = resolveMissingGcRigProjects({
      projects: input.projects,
      gcConfig: input.gcConfig,
      pendingCwds: pendingGcRigProjectCwds,
    });
    for (const rig of missingRigs) {
      const normalizedRigPath = normalizeProjectPath(rig.path);
      if (!normalizedRigPath) {
        continue;
      }
      pendingGcRigProjectCwds.add(normalizedRigPath);
      void api.orchestration
        .dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId: newProjectId(),
          title: projectNameFromRigName(rig.name),
          workspaceRoot: rig.path,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make("codex")] ?? "gpt-5.4-mini",
          },
          createdAt: new Date().toISOString(),
        })
        .catch((error) => {
          pendingGcRigProjectCwds.delete(normalizedRigPath);
          toastManager.add({
            type: "error",
            title: `Failed to add GC rig "${rig.name}"`,
            description:
              error instanceof Error
                ? error.message
                : `An error occurred while creating the ${rig.name} project.`,
          });
        });
    }
  }, [input.gcConfig, input.isProjectSnapshotReady, input.projects]);
}
