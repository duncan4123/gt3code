/**
 * MCP readiness sentinel — checks if any context-mode MCP server is alive.
 *
 * Server writes <tmp>/context-mode-mcp-ready-<MCP_PID> after connect().
 * Hooks scan sentinels and probe PID liveness instead of trusting process.ppid,
 * which is unreliable through shell wrappers.
 */
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SENTINEL_PREFIX = "context-mode-mcp-ready-";

export function sentinelDir() {
  const override = process.env.CONTEXT_MODE_MCP_SENTINEL_DIR;
  if (override && override.length > 0) return override;
  return process.platform === "win32" ? tmpdir() : "/tmp";
}

export function sentinelPathForPid(pid) {
  return join(sentinelDir(), `${SENTINEL_PREFIX}${pid}`);
}

export function sentinelPath() {
  return join(sentinelDir(), `${SENTINEL_PREFIX}${process.ppid}`);
}

export function isMCPReady() {
  try {
    const dir = sentinelDir();
    const files = readdirSync(dir).filter((f) => f.startsWith(SENTINEL_PREFIX));
    for (const f of files) {
      const fullPath = join(dir, f);
      try {
        const pid = parseInt(readFileSync(fullPath, "utf8"), 10);
        if (Number.isNaN(pid)) continue;
        process.kill(pid, 0);
        return true;
      } catch {
        try { unlinkSync(fullPath); } catch { /* stale or unreadable */ }
      }
    }
    return false;
  } catch {
    return false;
  }
}
