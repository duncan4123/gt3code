#!/usr/bin/env bun

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

if (typeof Bun !== "undefined" && process.env.T3_AUDIT_NODE_REEXEC !== "1") {
  const result = cp.spawnSync("node", [__filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env,
      T3_AUDIT_NODE_REEXEC: "1",
    },
  });
  process.exit(result.status ?? 1);
}

function loadSqliteDatabase() {
  const candidates = [
    "better-sqlite3",
    (() => {
      try {
        return require.resolve("better-sqlite3", {
          paths: [
            "/data/projects/t3code/packages/doltlite",
            "/data/projects/t3code/apps/server",
            "/data/projects/t3code",
          ],
        });
      } catch {
        return null;
      }
    })(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  try {
    const { DatabaseSync } = require("node:sqlite");
    return DatabaseSync;
  } catch {}
  if (typeof Bun !== "undefined") {
    try {
      return require("bun:sqlite").Database;
    } catch {}
  }
  throw new Error("Unable to load a supported SQLite driver");
}

const Database = loadSqliteDatabase();

function runJson(command, args) {
  const output = cp.execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  try {
    return JSON.parse(output);
  } catch {
    const lines = output.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const candidate = lines.slice(index).join("\n").trim();
      if (!candidate.startsWith("[") && !candidate.startsWith("{")) {
        continue;
      }
      try {
        return JSON.parse(candidate);
      } catch {}
    }
    throw new Error(`Unable to parse JSON output from ${command} ${args.join(" ")}`);
  }
}

function tryRunJson(command, args) {
  try {
    return { ok: true, value: runJson(command, args) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function safeJsonParse(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function deriveSessionName(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  if (typeof metadata["gc.sessionName"] === "string" && metadata["gc.sessionName"]) {
    return metadata["gc.sessionName"];
  }
  const env = safeJsonParse(metadata["gc.sessionEnv"]);
  if (env && typeof env.GC_SESSION_NAME === "string" && env.GC_SESSION_NAME) {
    return env.GC_SESSION_NAME;
  }
  const agent = metadata["gc.agent"];
  if (typeof agent === "string" && agent.length > 0) {
    return agent.includes("/") ? agent.replace("/", "--") : agent;
  }
  return null;
}

function parseMetadata(raw) {
  const metadata = safeJsonParse(raw);
  return metadata && typeof metadata === "object" ? metadata : {};
}

function parseSessionEnv(metadata) {
  const env = safeJsonParse(metadata["gc.sessionEnv"]);
  return env && typeof env === "object" && !Array.isArray(env) ? env : {};
}

function getRequiredEnvKeys(session, metadata, env) {
  const required = [
    "GC_SESSION_NAME",
    "GC_AGENT",
    "GC_ALIAS",
    "GC_CITY",
    "GC_CITY_PATH",
    "GC_TEMPLATE",
  ];
  const rig =
    metadata["gc.rig"] ||
    env.GC_RIG ||
    (typeof session?.Rig === "string" ? session.Rig : null) ||
    (typeof session?.rig === "string" ? session.rig : null) ||
    null;
  if (rig) {
    required.push("GC_RIG", "GC_RIG_ROOT");
  }
  return required;
}

function summarizeThreadRow(row) {
  const metadata = parseMetadata(row.customMetadata);
  const env = parseSessionEnv(metadata);
  return {
    threadId: row.threadId,
    title: row.title,
    projectTitle: row.projectTitle,
    workspaceRoot: row.workspaceRoot,
    worktreePath: row.worktreePath,
    metadata,
    env,
    projectionStatus: row.projectionStatus,
    providerName: row.providerName,
    providerSessionId: row.providerSessionId,
    providerThreadId: row.providerThreadId,
    runtimeStatus: row.runtimeStatus,
    runtimeProviderName: row.runtimeProviderName,
    resumeCursor: safeJsonParse(row.resumeCursorJson),
    lastError: row.lastError,
  };
}

function printHeader(label) {
  process.stdout.write(`\n=== ${label} ===\n`);
}

function resolveProjectionDbPath() {
  if (process.env.T3_STATE_PROJ_DB) {
    return process.env.T3_STATE_PROJ_DB;
  }

  const candidates = [
    path.join(os.homedir(), ".t3", "dev", "state-proj.sqlite"),
    path.join(os.homedir(), ".t3", "userdata", "state-proj.sqlite"),
    path.join(os.homedir(), ".t3", "dev", "userdata", "state-proj.sqlite"),
    path.join(os.homedir(), ".t3", "state-proj.sqlite"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function main() {
  const dbPath = resolveProjectionDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Projection DB not found at ${dbPath}`);
  }

  const sessionListResult = tryRunJson("/home/ubuntu/go/bin/gc", ["session", "list", "--json"]);
  const sessions =
    sessionListResult.ok && Array.isArray(sessionListResult.value) ? sessionListResult.value : [];

  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `
        SELECT
          t.thread_id AS threadId,
          t.title AS title,
          t.worktree_path AS worktreePath,
          t.custom_metadata AS customMetadata,
          p.title AS projectTitle,
          p.workspace_root AS workspaceRoot,
          s.status AS projectionStatus,
          s.provider_name AS providerName,
          s.provider_session_id AS providerSessionId,
          s.provider_thread_id AS providerThreadId,
          s.last_error AS lastError,
          r.status AS runtimeStatus,
          r.provider_name AS runtimeProviderName,
          r.resume_cursor_json AS resumeCursorJson
        FROM projection_threads t
        JOIN projection_projects p
          ON p.project_id = t.project_id
        LEFT JOIN projection_thread_sessions s
          ON s.thread_id = t.thread_id
        LEFT JOIN provider_session_runtime r
          ON r.thread_id = t.thread_id
        WHERE t.deleted_at IS NULL
          AND p.deleted_at IS NULL
        ORDER BY t.updated_at DESC, t.thread_id ASC
      `,
    )
    .all();

  const bindings = new Map();
  for (const row of rows) {
    const info = summarizeThreadRow(row);
    const sessionName = deriveSessionName(info.metadata);
    if (!sessionName) {
      continue;
    }
    if (!bindings.has(sessionName)) {
      bindings.set(sessionName, []);
    }
    bindings.get(sessionName).push(info);
  }

  const activeSessions = sessions.filter((session) => session.State === "active");
  const asleepSessions = sessions.filter((session) => session.State === "asleep");
  const dbRunningThreads = rows
    .map((row) => summarizeThreadRow(row))
    .filter((thread) => {
      const runtime = String(thread.runtimeStatus ?? "").toLowerCase();
      const projection = String(thread.projectionStatus ?? "").toLowerCase();
      return (
        runtime === "running" ||
        runtime === "ready" ||
        projection === "running" ||
        projection === "ready"
      );
    });
  const sessionAuditItems =
    activeSessions.length > 0
      ? activeSessions.map((session) => ({
          key:
            (typeof session.SessionName === "string" && session.SessionName) ||
            (typeof session.Name === "string" && session.Name) ||
            null,
          gcState: session.State,
          rig:
            (typeof session.Rig === "string" && session.Rig) ||
            (typeof session.Template === "string" && session.Template.includes("/")
              ? session.Template.split("/")[0]
              : null),
        }))
      : dbRunningThreads.map((thread) => ({
          key: deriveSessionName(thread.metadata),
          gcState: "db-runtime",
          rig: thread.metadata["gc.rig"] ?? thread.env.GC_RIG ?? null,
        }));

  printHeader("Summary");
  process.stdout.write(
    `projection_db=${dbPath}\nactive_sessions=${activeSessions.length}\nasleep_sessions=${asleepSessions.length}\ndb_running_threads=${dbRunningThreads.length}\n`,
  );
  if (!sessionListResult.ok) {
    process.stdout.write(`session_list_error=${sessionListResult.error}\n`);
  }

  const failures = [];

  printHeader("Running Session Audit");
  for (const session of sessionAuditItems) {
    const sessionName = session.key;
    if (!sessionName) {
      continue;
    }
    const matches = bindings.get(sessionName) ?? [];
    const thread = matches[0] ?? null;

    if (!thread) {
      failures.push({ sessionName, reason: "missing-thread-binding" });
      process.stdout.write(
        `FAIL ${sessionName}: no thread with matching gc.sessionName/gc.agent\n`,
      );
      continue;
    }

    const requiredEnvKeys = getRequiredEnvKeys(session, thread.metadata, thread.env);
    const missingEnvKeys = requiredEnvKeys.filter((key) => typeof thread.env[key] !== "string");
    const issues = [];
    if (thread.metadata["gc.agent"] == null) {
      issues.push("missing gc.agent");
    }
    if (deriveSessionName(thread.metadata) == null) {
      issues.push("missing gc.sessionName");
    }
    if (!thread.metadata["gc.sessionEnv"]) {
      issues.push("missing gc.sessionEnv");
    }
    if (missingEnvKeys.length > 0) {
      issues.push(`missing env keys: ${missingEnvKeys.join(", ")}`);
    }
    if (!thread.projectionStatus) {
      issues.push("missing projection_thread_sessions row");
    }
    if (!thread.runtimeStatus) {
      issues.push("missing provider_session_runtime row");
    }

    const statusLine = [
      `gc=${session.gcState}`,
      `thread=${thread.threadId}`,
      `project=${thread.projectTitle}`,
      `projection=${thread.projectionStatus ?? "-"}`,
      `runtime=${thread.runtimeStatus ?? "-"}`,
      `provider=${thread.runtimeProviderName ?? thread.providerName ?? "-"}`,
    ].join(" ");

    if (issues.length > 0) {
      failures.push({ sessionName, reason: issues.join("; ") });
      process.stdout.write(`FAIL ${sessionName}: ${issues.join("; ")}\n  ${statusLine}\n`);
      continue;
    }

    process.stdout.write(`OK   ${sessionName}\n  ${statusLine}\n`);
  }

  const focusNames = new Set(
    [...activeSessions, ...asleepSessions]
      .map((session) => session.Name)
      .filter(
        (name) =>
          typeof name === "string" &&
          (name.includes("crew") || name.includes("control-dispatcher") || name.includes("boot")),
      ),
  );
  if (focusNames.size === 0) {
    for (const thread of rows.map((row) => summarizeThreadRow(row))) {
      const sessionName = deriveSessionName(thread.metadata);
      if (
        sessionName &&
        (sessionName.includes("crew") ||
          sessionName.includes("control-dispatcher") ||
          sessionName.includes("boot"))
      ) {
        focusNames.add(sessionName);
      }
    }
  }

  printHeader("Crew And Dispatcher Detail");
  for (const sessionName of [...focusNames].sort()) {
    const matches = bindings.get(sessionName) ?? [];
    if (matches.length === 0) {
      process.stdout.write(`MISS ${sessionName}: no matching thread metadata\n`);
      continue;
    }
    for (const thread of matches) {
      process.stdout.write(
        [
          `HIT  ${sessionName}`,
          `thread=${thread.threadId}`,
          `title=${JSON.stringify(thread.title)}`,
          `project=${thread.projectTitle}`,
          `projection=${thread.projectionStatus ?? "-"}`,
          `runtime=${thread.runtimeStatus ?? "-"}`,
          `gc.agent=${thread.metadata["gc.agent"] ?? "-"}`,
          `gc.rig=${thread.metadata["gc.rig"] ?? "-"}`,
          `GC_SESSION_NAME=${thread.env.GC_SESSION_NAME ?? "-"}`,
          `GC_AGENT=${thread.env.GC_AGENT ?? "-"}`,
          `GC_RIG=${thread.env.GC_RIG ?? "-"}`,
        ].join(" "),
      );
      process.stdout.write("\n");
    }
  }

  printHeader("Result");
  if (failures.length === 0) {
    process.stdout.write(
      "All active sessions have matching T3 thread bindings and required GC env metadata.\n",
    );
    return;
  }

  for (const failure of failures) {
    process.stdout.write(`- ${failure.sessionName}: ${failure.reason}\n`);
  }
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
