import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpProcessRecord {
  pid: number;
  projectDir: string;
  startedAt: string;
  version: string;
}

export interface RestartProcessDeps {
  describeProcess: (pid: number) => string | null;
  isProcessAlive: (pid: number) => boolean;
  removeRecord: () => void;
  terminateProcess: (pid: number, force?: boolean) => void;
  wait: (ms: number) => Promise<void>;
}

export type RestartResult =
  | { kind: "not-found" }
  | { kind: "stale"; pid: number }
  | { kind: "terminated"; pid: number; forced: boolean }
  | { kind: "foreign"; pid: number; command: string }
  | { kind: "failed"; pid: number };

function normalizeProjectDir(projectDir: string): string {
  return projectDir.replace(/\\/g, "/");
}

function getProjectHash(projectDir: string): string {
  return createHash("sha256")
    .update(normalizeProjectDir(projectDir))
    .digest("hex")
    .slice(0, 16);
}

function getRegistryDir(homeDir = homedir()): string {
  return join(homeDir, ".context-mode", "mcp");
}

function isSameOrParentProject(parent: string, child: string): boolean {
  const normalizedParent = normalizeProjectDir(parent).replace(/\/+$/, "");
  const normalizedChild = normalizeProjectDir(child).replace(/\/+$/, "");
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(`${normalizedParent}/`)
  );
}

export function getMcpRegistryPath(projectDir: string, homeDir = homedir()): string {
  return join(getRegistryDir(homeDir), `${getProjectHash(projectDir)}.json`);
}

export function writeMcpProcessRecord(
  record: McpProcessRecord,
  homeDir = homedir(),
): string {
  const registryDir = getRegistryDir(homeDir);
  mkdirSync(registryDir, { recursive: true });
  const target = getMcpRegistryPath(record.projectDir, homeDir);
  writeFileSync(target, JSON.stringify(record, null, 2) + "\n", "utf-8");
  return target;
}

export function readMcpProcessRecord(
  projectDir: string,
  homeDir = homedir(),
): McpProcessRecord | null {
  const target = getMcpRegistryPath(projectDir, homeDir);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf-8")) as Partial<McpProcessRecord>;
    if (
      typeof parsed.pid !== "number"
      || typeof parsed.projectDir !== "string"
      || typeof parsed.startedAt !== "string"
      || typeof parsed.version !== "string"
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      projectDir: parsed.projectDir,
      startedAt: parsed.startedAt,
      version: parsed.version,
    };
  } catch {
    return null;
  }
}

export function listMcpProcessRecords(homeDir = homedir()): McpProcessRecord[] {
  const dir = getRegistryDir(homeDir);
  if (!existsSync(dir)) return [];

  const records: McpProcessRecord[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf-8")) as Partial<McpProcessRecord>;
      if (
        typeof parsed.pid === "number" &&
        typeof parsed.projectDir === "string" &&
        typeof parsed.startedAt === "string" &&
        typeof parsed.version === "string"
      ) {
        records.push({
          pid: parsed.pid,
          projectDir: parsed.projectDir,
          startedAt: parsed.startedAt,
          version: parsed.version,
        });
      }
    } catch {
      // Ignore malformed records; readMcpProcessRecord handles exact lookups.
    }
  }
  return records;
}

export function resolveMcpProcessRecordForProject(
  projectDir: string,
  homeDir = homedir(),
): McpProcessRecord | null {
  const exact = readMcpProcessRecord(projectDir, homeDir);
  if (exact) return exact;

  return listMcpProcessRecords(homeDir)
    .filter((record) => isSameOrParentProject(record.projectDir, projectDir))
    .sort((a, b) => normalizeProjectDir(b.projectDir).length - normalizeProjectDir(a.projectDir).length)[0] ?? null;
}

export function removeMcpProcessRecord(projectDir: string, homeDir = homedir()): void {
  const target = getMcpRegistryPath(projectDir, homeDir);
  rmSync(target, { force: true });
}

export function removeMcpProcessRecordIfPid(
  projectDir: string,
  pid: number,
  homeDir = homedir(),
): void {
  const current = readMcpProcessRecord(projectDir, homeDir);
  if (current?.pid !== pid) return;
  removeMcpProcessRecord(projectDir, homeDir);
}

export function isLikelyContextModeProcess(command: string | null | undefined): boolean {
  if (!command) return false;
  const normalized = command.toLowerCase();
  return [
    "context-mode",
    "context-mode-doltlite",
    "server.bundle.mjs",
    "build/server.js",
    "start.mjs",
  ].some((needle) => normalized.includes(needle));
}

export async function restartRecordedMcpProcess(
  record: McpProcessRecord | null,
  deps: RestartProcessDeps,
  timeoutMs = 2_000,
): Promise<RestartResult> {
  if (!record) return { kind: "not-found" };

  const { pid } = record;
  const command = deps.describeProcess(pid);
  if (command && !isLikelyContextModeProcess(command)) {
    return { kind: "foreign", pid, command };
  }

  if (!deps.isProcessAlive(pid)) {
    deps.removeRecord();
    return { kind: "stale", pid };
  }

  deps.terminateProcess(pid, false);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!deps.isProcessAlive(pid)) {
      deps.removeRecord();
      return { kind: "terminated", pid, forced: false };
    }
    await deps.wait(100);
  }

  if (deps.isProcessAlive(pid)) {
    deps.terminateProcess(pid, true);
    await deps.wait(100);
  }

  if (!deps.isProcessAlive(pid)) {
    deps.removeRecord();
    return { kind: "terminated", pid, forced: true };
  }

  return { kind: "failed", pid };
}
