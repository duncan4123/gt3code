/**
 * lifecycle — Process lifecycle guard for MCP server.
 *
 * Detects parent process death (ppid polling) and OS signals to prevent
 * orphaned MCP server processes consuming 100% CPU (issue #103).
 *
 * Stdin close is not a standalone shutdown signal. The MCP stdio transport
 * owns stdin, and transient pipe events can otherwise close the transport
 * while the parent process is still alive.
 *
 * Cross-platform: macOS, Linux, Windows.
 */

import { execFileSync } from "node:child_process";

export interface LifecycleGuardOptions {
  /** Interval in ms to check parent liveness. Default: 30_000 */
  checkIntervalMs?: number;
  /** Called when parent death or OS signal is detected. */
  onShutdown: () => void;
  /** Injectable parent-alive check (for testing). Default: ppid-based check. */
  isParentAlive?: () => boolean;
}

/** Read grandparent PID via `ps -o ppid= -p $PPID`. Returns NaN on failure or Windows. */
function readGrandparentPpidImpl(): number {
  if (process.platform === "win32") return NaN;
  const ppid = process.ppid;
  if (!ppid || ppid <= 1) return NaN;
  try {
    const out = execFileSync("ps", ["-o", "ppid=", "-p", String(ppid)], {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) ? n : NaN;
  } catch {
    return NaN;
  }
}

/** Injectable dependencies for {@link makeDefaultIsParentAlive}. */
export interface IsParentAliveDeps {
  /** Read the current ppid. Default: `() => process.ppid`. */
  getPpid?: () => number;
  /** Read the grandparent ppid. Default: ps-based POSIX probe, NaN on Windows. */
  readGrandparentPpid?: () => number;
}

/**
 * Build a parent-liveness check that handles wrapper processes.
 *
 * A plain ppid comparison can miss launches like:
 * `start.mjs -> npm exec -> context-mode server`. If the original session
 * owner dies, the grandparent can reparent to init while the direct parent
 * remains alive.
 */
export function makeDefaultIsParentAlive(deps: IsParentAliveDeps = {}): () => boolean {
  const getPpid = deps.getPpid ?? (() => process.ppid);
  const readGp = deps.readGrandparentPpid ?? readGrandparentPpidImpl;
  const originalPpid = getPpid();
  const originalGrandparentPpid = readGp();

  return () => {
    const ppid = getPpid();
    if (ppid !== originalPpid) return false;
    if (ppid === 0 || ppid === 1) return false;

    if (!Number.isNaN(originalGrandparentPpid) && originalGrandparentPpid > 1) {
      if (readGp() === 1) return false;
    }

    return true;
  };
}

const defaultIsParentAlive = makeDefaultIsParentAlive();

/**
 * Start the lifecycle guard. Returns a cleanup function.
 * Skipped automatically when stdin is a TTY (e.g. OpenCode ts-plugin).
 */
export function startLifecycleGuard(opts: LifecycleGuardOptions): () => void {
  const interval = opts.checkIntervalMs ?? 30_000;
  const check = opts.isParentAlive ?? defaultIsParentAlive;
  let stopped = false;

  const shutdown = () => {
    if (stopped) return;
    stopped = true;
    opts.onShutdown();
  };

  // P0: Periodic parent liveness check
  const timer = setInterval(() => {
    if (!check()) shutdown();
  }, interval);
  timer.unref();

  // P0: OS signals — terminal close, kill, ctrl+c
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
  if (process.platform !== "win32") signals.push("SIGHUP");
  for (const sig of signals) process.on(sig, shutdown);

  // Treat stdin EOF as an immediate parent-liveness probe, not as a shutdown
  // signal by itself. This preserves orphan cleanup without spurious MCP closes.
  const onStdinEnd = () => {
    if (!check()) shutdown();
  };
  if (!process.stdin.isTTY) {
    process.stdin.on("end", onStdinEnd);
  }

  return () => {
    stopped = true;
    clearInterval(timer);
    for (const sig of signals) process.removeListener(sig, shutdown);
    process.stdin.removeListener("end", onStdinEnd);
  };
}
