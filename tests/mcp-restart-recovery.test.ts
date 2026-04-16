import { strict as assert } from "node:assert";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "context-mode-restart-"));
  cleanupDirs.push(dir);
  return dir;
}

function startServer(env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  const proc = spawn("node", ["start.mjs"], {
    cwd: ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  return proc;
}

function send(proc: ChildProcessWithoutNullStreams, msg: Record<string, unknown>): void {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

function createCollector(proc: ChildProcessWithoutNullStreams): Array<Record<string, any>> {
  let buffer = "";
  const responses: Array<Record<string, any>> = [];
  proc.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        responses.push(JSON.parse(trimmed));
      } catch {
        // Ignore non-JSON noise from the child process.
      }
    }
  });
  return responses;
}

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function initialize(
  proc: ChildProcessWithoutNullStreams,
  responses: Array<Record<string, any>>,
): Promise<void> {
  send(proc, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "restart-test", version: "1.0" },
    },
  });
  send(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
  await waitFor(() => responses.find((r) => r.id === 1), 5_000, "initialize response");
}

async function callTool(
  proc: ChildProcessWithoutNullStreams,
  responses: Array<Record<string, any>>,
  id: number,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  send(proc, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const response = await waitFor(() => responses.find((r) => r.id === id), 15_000, `${name} response`);
  assert.equal(response.error, undefined, `${name} returned JSON-RPC error`);
  assert.equal(response.result?.isError, undefined, `${name} returned tool error`);
  return response.result?.content?.[0]?.text ?? "";
}

function readRegistry(home: string): { pid: number } | null {
  const dir = join(home, ".context-mode", "mcp");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  if (!files.length) return null;
  return JSON.parse(readFileSync(join(dir, files[0]), "utf8")) as { pid: number };
}

function isPidGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error: any) {
    return error?.code !== "EPERM";
  }

  try {
    const state = spawnSync("ps", ["-p", String(pid), "-o", "stat="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).stdout.trim();
    return state.startsWith("Z");
  } catch {
    return false;
  }
}

test("cli restart stops the recorded MCP server and a fresh server answers the next tool call", async () => {
  const home = makeTempHome();
  const env = {
    ...process.env,
    HOME: home,
    CLAUDE_PROJECT_DIR: ROOT,
    CONTEXT_MODE_PROJECT_DIR: ROOT,
  };
  const probe = `restart-recovery-${Date.now()}`;
  let firstPid = -1;

  const first = startServer(env);
  const firstResponses = createCollector(first);
  try {
    await initialize(first, firstResponses);
    const firstRegistry = await waitFor(() => readRegistry(home), 5_000, "first registry entry");
    firstPid = firstRegistry.pid;
    const firstOutput = await callTool(first, firstResponses, 2, "ctx_execute", {
      language: "shell",
      code: `echo ${probe}`,
    });
    assert.match(firstOutput, new RegExp(probe));

    const restart = spawnSync("node", ["cli.bundle.mjs", "restart"], {
      cwd: ROOT,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(restart.status, 0, restart.stderr || restart.stdout);
    assert.match(restart.stdout, new RegExp(`Stopped context-mode MCP PID ${firstRegistry.pid}`));

    await waitFor(() => isPidGone(firstRegistry.pid) ? true : null, 5_000, "first server exit");
    assert.equal(readRegistry(home), null);
  } finally {
    if (first.exitCode === null && !first.killed) first.kill("SIGTERM");
  }

  const second = startServer(env);
  const secondResponses = createCollector(second);
  try {
    await initialize(second, secondResponses);
    const secondRegistry = await waitFor(() => readRegistry(home), 5_000, "second registry entry");
    assert.notEqual(secondRegistry.pid, firstPid);

    const secondOutput = await callTool(second, secondResponses, 3, "ctx_execute", {
      language: "shell",
      code: `echo ${probe}`,
    });
    assert.match(secondOutput, new RegExp(probe));
  } finally {
    if (second.exitCode === null && !second.killed) second.kill("SIGTERM");
  }
});
