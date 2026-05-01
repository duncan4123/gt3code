import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, test } from "vitest";
import {
  getMcpRegistryPath,
  isLikelyContextModeProcess,
  readMcpProcessRecord,
  removeMcpProcessRecord,
  removeMcpProcessRecordIfPid,
  resolveMcpProcessRecordForProject,
  restartRecordedMcpProcess,
  writeMcpProcessRecord,
  type McpProcessRecord,
} from "../src/mcp-registry.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "context-mode-mcp-"));
  cleanupDirs.push(dir);
  return dir;
}

function sampleRecord(projectDir = "/tmp/project"): McpProcessRecord {
  return {
    pid: 4242,
    projectDir,
    startedAt: "2026-04-14T00:00:00.000Z",
    version: "1.0.80",
  };
}

describe("mcp-registry", () => {
  test("normalizes path separators when deriving registry paths", () => {
    const home = makeTempHome();
    const windows = getMcpRegistryPath("C:\\repo\\demo", home);
    const unix = getMcpRegistryPath("C:/repo/demo", home);
    assert.equal(windows, unix);
  });

  test("writes, reads, and removes process records", () => {
    const home = makeTempHome();
    const record = sampleRecord();

    writeMcpProcessRecord(record, home);
    assert.deepEqual(readMcpProcessRecord(record.projectDir, home), record);

    removeMcpProcessRecord(record.projectDir, home);
    assert.equal(readMcpProcessRecord(record.projectDir, home), null);
  });

  test("removeMcpProcessRecordIfPid preserves a newer record", () => {
    const home = makeTempHome();
    const record = sampleRecord();
    writeMcpProcessRecord(record, home);

    writeMcpProcessRecord({ ...record, pid: 5000 }, home);
    removeMcpProcessRecordIfPid(record.projectDir, record.pid, home);

    assert.deepEqual(readMcpProcessRecord(record.projectDir, home), {
      ...record,
      pid: 5000,
    });
  });

  test("resolves nearest parent project record for subdirectory restarts", () => {
    const home = makeTempHome();
    const repo = sampleRecord("/data/projects/t3code");
    const nested = sampleRecord("/data/projects/t3code/apps/server");
    writeMcpProcessRecord(repo, home);

    assert.deepEqual(
      resolveMcpProcessRecordForProject("/data/projects/t3code/apps/server", home),
      repo,
    );

    writeMcpProcessRecord({ ...nested, pid: 5000 }, home);
    assert.deepEqual(
      resolveMcpProcessRecordForProject("/data/projects/t3code/apps/server/src", home),
      { ...nested, pid: 5000 },
    );
  });

  test("returns null for malformed registry JSON", () => {
    const home = makeTempHome();
    const target = getMcpRegistryPath("/tmp/project", home);
    writeMcpProcessRecord(sampleRecord(), home);
    writeFileSync(target, "{not-json", "utf-8");
    assert.equal(readMcpProcessRecord("/tmp/project", home), null);
  });

  test("identifies likely context-mode process commands", () => {
    assert.equal(isLikelyContextModeProcess("node /tmp/context-mode/start.mjs"), true);
    assert.equal(isLikelyContextModeProcess("node /tmp/server.bundle.mjs"), true);
    assert.equal(isLikelyContextModeProcess("python app.py"), false);
  });

  test("restartRecordedMcpProcess clears stale records", async () => {
    let removed = 0;
    const result = await restartRecordedMcpProcess(sampleRecord(), {
      describeProcess: () => "node /tmp/context-mode/start.mjs",
      isProcessAlive: () => false,
      removeRecord: () => { removed++; },
      terminateProcess: () => { throw new Error("should not terminate stale pid"); },
      wait: async () => {},
    });

    assert.deepEqual(result, { kind: "stale", pid: 4242 });
    assert.equal(removed, 1);
  });

  test("restartRecordedMcpProcess refuses foreign processes", async () => {
    const result = await restartRecordedMcpProcess(sampleRecord(), {
      describeProcess: () => "python unrelated.py",
      isProcessAlive: () => true,
      removeRecord: () => {},
      terminateProcess: () => { throw new Error("should not terminate foreign pid"); },
      wait: async () => {},
    });

    assert.deepEqual(result, {
      kind: "foreign",
      pid: 4242,
      command: "python unrelated.py",
    });
  });

  test("restartRecordedMcpProcess terminates recorded server", async () => {
    let alive = true;
    let removed = 0;
    const terminateCalls: Array<{ pid: number; force: boolean }> = [];

    const result = await restartRecordedMcpProcess(sampleRecord(), {
      describeProcess: () => "node /tmp/context-mode/start.mjs",
      isProcessAlive: () => alive,
      removeRecord: () => { removed++; },
      terminateProcess: (pid, force = false) => {
        terminateCalls.push({ pid, force });
        alive = false;
      },
      wait: async () => {},
    });

    assert.deepEqual(result, { kind: "terminated", pid: 4242, forced: false });
    assert.deepEqual(terminateCalls, [{ pid: 4242, force: false }]);
    assert.equal(removed, 1);
  });
});
