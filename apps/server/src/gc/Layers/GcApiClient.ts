/**
 * GcApiClientLive — Effect layer implementing the GcApiClient service.
 *
 * Connects to the Gas City REST API (default port 9443) and provides
 * typed access to beads, convoys, formulas, and the SSE event stream.
 *
 * Source of truth: gascity/internal/api/ handlers
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Effect, Layer, Stream, PubSub, Config, Option } from "effect";
import type {
  GcConfigAgent,
  GcConfigResult,
  GcSessionActionResult,
  GcSubmitSessionResult,
} from "@t3tools/contracts";
import {
  GcApiClient,
  type GcApiClientShape,
  type GcBead,
  type GcConvoy,
  type GcFormula,
  type GcEvent,
} from "../Services/GcApiClient.ts";
import {
  buildGcAgentActionPath,
  buildGcCityPath,
  buildGcRigActionPath,
  extractGcProblemMessage,
  resolveGcCityNameFromSupervisorCities,
} from "../apiPaths.ts";
import { createResourceCache } from "../resourceCache.ts";

const GC_API_DEFAULT_URL = "http://localhost:9443";
const GC_API_REQUEST_TIMEOUT_MS = 30_000;
const GC_CLI_REQUEST_TIMEOUT_MS = 8_000;

function logGcWarning(message: string, context: Record<string, unknown>): void {
  console.warn("[gc-api]", message, context);
}

function logGcError(message: string, context: Record<string, unknown>): void {
  console.error("[gc-api]", message, context);
}

function logGcInfo(message: string, context: Record<string, unknown>): void {
  console.info("[gc-api]", message, context);
}

async function runLoggedGcMutation<T>(
  kind: string,
  target: string,
  requested: Record<string, unknown>,
  run: () => Promise<{ result: T; path: string }>,
): Promise<T> {
  const startedAt = Date.now();
  logGcInfo("mutation started", {
    kind,
    target,
    ...requested,
  });
  try {
    const { result, path } = await run();
    logGcInfo("mutation succeeded", {
      kind,
      target,
      path,
      durationMs: Date.now() - startedAt,
      ...requested,
    });
    return result;
  } catch (error) {
    logGcError("mutation failed", {
      kind,
      target,
      durationMs: Date.now() - startedAt,
      ...requested,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function escapePathSegments(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeGcConfig(raw: unknown, cityPath: string): GcConfigResult | null {
  const candidate =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "Body" in raw &&
    (raw as { Body?: unknown }).Body !== undefined
      ? (raw as { Body: unknown }).Body
      : raw;

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const workspaceRaw =
    record.workspace && typeof record.workspace === "object" && !Array.isArray(record.workspace)
      ? (record.workspace as Record<string, unknown>)
      : {};
  const workspaceName =
    typeof workspaceRaw.name === "string" && workspaceRaw.name.trim().length > 0
      ? workspaceRaw.name
      : path.basename(cityPath);
  const namedSessionModes = new Map<string, "always" | "on_demand">();
  const namedSessions = Array.isArray(record.named_session) ? record.named_session : [];
  for (const value of namedSessions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const named = value as Record<string, unknown>;
    if (typeof named.template !== "string" || named.template.trim().length === 0) {
      continue;
    }
    const mode = named.mode === "always" || named.mode === "on_demand" ? named.mode : undefined;
    if (!mode) {
      continue;
    }
    const dir =
      typeof named.dir === "string" && named.dir.trim().length > 0 ? named.dir.trim() : "";
    const identity = dir ? `${dir}/${named.template}` : named.template;
    namedSessionModes.set(identity, mode);
  }

  const agentValues = Array.isArray(record.agents)
    ? record.agents
    : Array.isArray(record.agent)
      ? record.agent
      : [];

  const agents = agentValues.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const agent = value as Record<string, unknown>;
    if (typeof agent.name !== "string" || agent.name.trim().length === 0) {
      return [];
    }
    const namedSessionMode: "always" | "on_demand" | undefined =
      agent.named_session_mode === "always" || agent.named_session_mode === "on_demand"
        ? agent.named_session_mode
        : undefined;
    const qualifiedName =
      typeof agent.name === "string" && agent.name.includes("/")
        ? agent.name
        : typeof agent.dir === "string" && agent.dir.trim().length > 0
          ? `${agent.dir}/${String(agent.name)}`
          : String(agent.name);
    const derivedNamedSessionMode = namedSessionModes.get(qualifiedName);
    const effectiveNamedSessionMode =
      typeof agent.is_pool === "boolean" && agent.is_pool
        ? undefined
        : (namedSessionMode ?? derivedNamedSessionMode ?? "always");
    const wakeMode: "resume" | "fresh" | undefined =
      agent.wake_mode === "resume" || agent.wake_mode === "fresh" ? agent.wake_mode : undefined;
    return [
      {
        name: agent.name,
        ...(typeof agent.dir === "string" ? { dir: agent.dir } : {}),
        ...(typeof agent.provider === "string" ? { provider: agent.provider } : {}),
        ...(typeof agent.session_template === "string"
          ? { session_template: agent.session_template }
          : {}),
        ...(typeof agent.is_pool === "boolean" ? { is_pool: agent.is_pool } : {}),
        ...(typeof agent.min_active_sessions === "number"
          ? { min_active_sessions: agent.min_active_sessions }
          : {}),
        ...(typeof agent.max_active_sessions === "number"
          ? { max_active_sessions: agent.max_active_sessions }
          : {}),
        ...(wakeMode ? { wake_mode: wakeMode } : {}),
        ...(typeof agent.scope === "string" ? { scope: agent.scope } : {}),
        suspended: Boolean(agent.suspended),
        ...(effectiveNamedSessionMode ? { named_session_mode: effectiveNamedSessionMode } : {}),
      },
    ];
  });

  const rigValues = Array.isArray(record.rigs)
    ? record.rigs
    : Array.isArray(record.rig)
      ? record.rig
      : [];

  const rigs = rigValues.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const rig = value as Record<string, unknown>;
    if (
      typeof rig.name !== "string" ||
      rig.name.trim().length === 0 ||
      typeof rig.path !== "string" ||
      rig.path.trim().length === 0
    ) {
      return [];
    }
    return [
      {
        name: rig.name,
        path: rig.path,
        ...(typeof rig.prefix === "string" ? { prefix: rig.prefix } : {}),
        suspended: Boolean(rig.suspended),
      },
    ];
  });

  const providers =
    record.providers && typeof record.providers === "object" && !Array.isArray(record.providers)
      ? Object.fromEntries(
          Object.entries(record.providers as Record<string, unknown>).flatMap(([name, value]) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
              return [];
            }
            const provider = value as Record<string, unknown>;
            return [
              [
                name,
                {
                  ...(typeof provider.display_name === "string"
                    ? { display_name: provider.display_name }
                    : {}),
                  ...(typeof provider.command === "string" ? { command: provider.command } : {}),
                  ...(Array.isArray(provider.args)
                    ? {
                        args: provider.args.filter(
                          (entry): entry is string => typeof entry === "string",
                        ),
                      }
                    : {}),
                  ...(typeof provider.prompt_mode === "string"
                    ? { prompt_mode: provider.prompt_mode }
                    : {}),
                  ...(typeof provider.prompt_flag === "string"
                    ? { prompt_flag: provider.prompt_flag }
                    : {}),
                  ...(typeof provider.ready_delay_ms === "number"
                    ? { ready_delay_ms: provider.ready_delay_ms }
                    : {}),
                  ...(provider.env &&
                  typeof provider.env === "object" &&
                  !Array.isArray(provider.env)
                    ? {
                        env: Object.fromEntries(
                          Object.entries(provider.env as Record<string, unknown>).flatMap(
                            ([envKey, envValue]) =>
                              typeof envValue === "string" ? [[envKey, envValue] as const] : [],
                          ),
                        ),
                      }
                    : {}),
                },
              ] as const,
            ];
          }),
        )
      : undefined;

  const patches =
    record.patches && typeof record.patches === "object" && !Array.isArray(record.patches)
      ? {
          agent_count:
            typeof (record.patches as Record<string, unknown>).agent_count === "number"
              ? ((record.patches as Record<string, unknown>).agent_count as number)
              : 0,
          rig_count:
            typeof (record.patches as Record<string, unknown>).rig_count === "number"
              ? ((record.patches as Record<string, unknown>).rig_count as number)
              : 0,
          provider_count:
            typeof (record.patches as Record<string, unknown>).provider_count === "number"
              ? ((record.patches as Record<string, unknown>).provider_count as number)
              : 0,
        }
      : undefined;

  return {
    workspace: {
      name: workspaceName,
      ...(typeof workspaceRaw.provider === "string" ? { provider: workspaceRaw.provider } : {}),
      suspended: Boolean(workspaceRaw.suspended),
      ...(typeof workspaceRaw.session_template === "string"
        ? { session_template: workspaceRaw.session_template }
        : {}),
    },
    agents,
    rigs,
    ...(providers ? { providers } : {}),
    ...(patches ? { patches } : {}),
  };
}

function resolveAgentConfigKey(agent: Pick<GcConfigAgent, "dir" | "name">): string {
  return agent.name.includes("/") ? agent.name : configuredAgentQualifiedName(agent);
}

function updateCachedAgentSuspended(
  config: GcConfigResult | null,
  name: string,
  suspended: boolean,
): GcConfigResult | null {
  if (!config) {
    return null;
  }
  return {
    ...config,
    agents: config.agents.map((agent) =>
      resolveAgentConfigKey(agent) === name ? { ...agent, suspended } : agent,
    ),
  };
}

function updateCachedAgentSessionMode(
  config: GcConfigResult | null,
  name: string,
  mode: "always" | "on_demand" | "disabled",
): GcConfigResult | null {
  if (!config) {
    return null;
  }
  return {
    ...config,
    agents: config.agents.map((agent) =>
      resolveAgentConfigKey(agent) === name
        ? mode === "disabled"
          ? {
              ...agent,
              named_session_mode: undefined,
            }
          : {
              ...agent,
              named_session_mode: mode,
            }
        : agent,
    ),
  };
}

function updateCachedAgentMaxActiveSessions(
  config: GcConfigResult | null,
  name: string,
  maxActiveSessions: number,
): GcConfigResult | null {
  if (!config) {
    return null;
  }
  return {
    ...config,
    agents: config.agents.map((agent) =>
      resolveAgentConfigKey(agent) === name
        ? {
            ...agent,
            max_active_sessions: maxActiveSessions,
            ...(typeof agent.min_active_sessions === "number" &&
            agent.min_active_sessions > maxActiveSessions
              ? { min_active_sessions: maxActiveSessions }
              : {}),
          }
        : agent,
    ),
  };
}

function updateCachedAgentMinActiveSessions(
  config: GcConfigResult | null,
  name: string,
  minActiveSessions: number,
): GcConfigResult | null {
  if (!config) {
    return null;
  }
  return {
    ...config,
    agents: config.agents.map((agent) =>
      resolveAgentConfigKey(agent) === name
        ? {
            ...agent,
            min_active_sessions: minActiveSessions,
            ...(typeof agent.max_active_sessions === "number" &&
            agent.max_active_sessions < minActiveSessions
              ? { max_active_sessions: minActiveSessions }
              : {}),
          }
        : agent,
    ),
  };
}

function updateCachedAgentWakeMode(
  config: GcConfigResult | null,
  name: string,
  wakeMode: "resume" | "fresh",
): GcConfigResult | null {
  if (!config) {
    return null;
  }
  return {
    ...config,
    agents: config.agents.map((agent) =>
      resolveAgentConfigKey(agent) === name ? { ...agent, wake_mode: wakeMode } : agent,
    ),
  };
}

function isPoolAgent(config: GcConfigResult | null, name: string): boolean {
  if (!config) {
    return false;
  }
  return config.agents.some(
    (agent) => resolveAgentConfigKey(agent) === name && agent.is_pool === true,
  );
}

function configuredAgentQualifiedName(agent: Pick<GcConfigAgent, "dir" | "name">): string {
  const dir = typeof agent.dir === "string" && agent.dir.trim().length > 0 ? agent.dir.trim() : "";
  return dir ? `${dir}/${agent.name}` : agent.name;
}

function resolveNamedSessionTemplate(
  agent: Pick<GcConfigAgent, "name" | "session_template" | "named_session_mode">,
): string {
  if (typeof agent.session_template === "string" && agent.session_template.trim().length > 0) {
    return agent.session_template.trim();
  }
  if (agent.named_session_mode && agent.name.includes(".")) {
    return agent.name.slice(agent.name.lastIndexOf(".") + 1);
  }
  return agent.name;
}

function findConfiguredAgentIdentity(
  config: GcConfigResult | null,
  qualifiedAgentName: string,
): { readonly dir: string; readonly template: string } | null {
  if (!config) {
    return null;
  }

  const normalizedName = sanitizeKey(qualifiedAgentName);
  const direct = config.agents.find((agent) => resolveAgentConfigKey(agent) === normalizedName);
  if (direct) {
    return {
      dir: typeof direct.dir === "string" ? direct.dir.trim() : "",
      template: resolveNamedSessionTemplate(direct),
    };
  }

  const unqualified = normalizedName.includes("/")
    ? normalizedName.slice(normalizedName.indexOf("/") + 1)
    : normalizedName;
  const fallback = config.agents.find(
    (agent) =>
      agent.name === unqualified &&
      (typeof agent.dir === "string" ? agent.dir.trim() : "") ===
        (normalizedName.includes("/") ? normalizedName.slice(0, normalizedName.indexOf("/")) : ""),
  );
  if (!fallback) {
    return null;
  }

  return {
    dir: typeof fallback.dir === "string" ? fallback.dir.trim() : "",
    template: resolveNamedSessionTemplate(fallback),
  };
}

function updateCachedRigSuspended(
  config: GcConfigResult | null,
  name: string,
  suspended: boolean,
): GcConfigResult | null {
  if (!config) {
    return null;
  }
  return {
    ...config,
    rigs: config.rigs.map((rig) => (rig.name === name ? { ...rig, suspended } : rig)),
  };
}

interface RawApiBead {
  id: string;
  title: string;
  description: string;
  status: string;
  type: string;
  priority?: number;
  assignee?: string;
  parent_id?: string;
  ref?: string;
  labels?: string[];
  metadata?: Record<string, string>;
  ephemeral?: boolean;
  created_at: string;
  updated_at?: string;
}

const normalizeBeadResponse = (raw: RawApiBead): GcBead => ({
  id: raw.id,
  title: raw.title,
  description: raw.description,
  status: raw.status,
  priority: raw.priority ?? 0,
  issueType: raw.type,
  createdAt: raw.created_at,
  updatedAt: raw.updated_at ?? raw.created_at,
  ...(raw.type ? { type: raw.type } : {}),
  ...(raw.assignee ? { assignee: raw.assignee } : {}),
  ...(raw.parent_id ? { parentId: raw.parent_id } : {}),
  ...(raw.ref ? { ref: raw.ref } : {}),
  ...(raw.labels ? { labels: raw.labels } : {}),
  ...(raw.metadata ? { metadata: raw.metadata } : {}),
  ...(raw.ephemeral !== undefined ? { ephemeral: raw.ephemeral } : {}),
});

interface RawApiConvoy {
  convoy: { id: string; title: string; status: string };
  children: Array<{ id: string; title: string; status: string }>;
  progress: { closed: number; total: number };
}

const normalizeConvoyResponse = (raw: RawApiConvoy): GcConvoy => ({
  id: raw.convoy.id,
  title: raw.convoy.title,
  status: raw.convoy.status,
  children: raw.children.map((c) => ({ id: c.id, title: c.title, status: c.status })),
  closedCount: raw.progress.closed,
  totalCount: raw.progress.total,
});

const sanitizeKey = (value: string): string => value.trim();

const BEAD_CACHE_TTL_MS = 3_000;
const CONVOY_CACHE_TTL_MS = 5_000;
const FORMULA_CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 512;

function isGcCityRoot(candidatePath: string): boolean {
  return (
    existsSync(path.join(candidatePath, "city.toml")) && existsSync(path.join(candidatePath, ".gc"))
  );
}

function findGcCityRootUpward(startCwd: string): string | null {
  let current = path.resolve(startCwd);
  while (true) {
    if (isGcCityRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function cityTomlMentionsRigPath(cityPath: string, rigPath: string): boolean {
  try {
    const content = readFileSync(path.join(cityPath, "city.toml"), "utf8");
    return content.includes(`path = "${rigPath}"`);
  } catch {
    return false;
  }
}

function findSiblingGcCityRoot(startCwd: string): string | null {
  const resolvedStart = path.resolve(startCwd);
  let searchDir = path.dirname(resolvedStart);

  while (true) {
    const preferred = path.join(searchDir, "gc");
    if (isGcCityRoot(preferred)) {
      return preferred;
    }

    try {
      for (const entry of readdirSync(searchDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(searchDir, entry.name);
        if (!isGcCityRoot(candidate)) continue;
        if (cityTomlMentionsRigPath(candidate, resolvedStart)) {
          return candidate;
        }
      }
    } catch {
      // Keep walking upward.
    }

    const parent = path.dirname(searchDir);
    if (parent === searchDir) {
      return null;
    }
    searchDir = parent;
  }
}

function findRegisteredGcCityRoot(startCwd: string): string | null {
  const registryPath = path.join(process.env.HOME ?? "/home/ubuntu", ".gc", "cities.toml");
  if (!existsSync(registryPath)) {
    return null;
  }

  const resolvedStart = path.resolve(startCwd);
  const lines = readFileSync(registryPath, "utf8").split("\n");

  let currentSection: "cities" | "rigs" | null = null;
  let currentCityPath: string | null = null;
  let currentRigPath: string | null = null;
  let currentRigDefaultCity: string | null = null;

  const flushRig = (): string | null => {
    if (
      currentSection === "rigs" &&
      currentRigPath &&
      path.resolve(currentRigPath) === resolvedStart &&
      currentRigDefaultCity
    ) {
      const resolved = path.resolve(currentRigDefaultCity);
      return isGcCityRoot(resolved) ? resolved : null;
    }
    return null;
  };

  const flushCity = (): string | null => {
    if (currentSection === "cities" && currentCityPath) {
      const resolved = path.resolve(currentCityPath);
      return isGcCityRoot(resolved) ? resolved : null;
    }
    return null;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed === "[[cities]]") {
      const rigMatch = flushRig();
      if (rigMatch) return rigMatch;
      currentSection = "cities";
      currentCityPath = null;
      currentRigPath = null;
      currentRigDefaultCity = null;
      continue;
    }
    if (trimmed === "[[rigs]]") {
      const rigMatch = flushRig();
      if (rigMatch) return rigMatch;
      currentSection = "rigs";
      currentCityPath = null;
      currentRigPath = null;
      currentRigDefaultCity = null;
      continue;
    }
    if (trimmed.startsWith("[") || trimmed.length === 0) {
      continue;
    }
    if (currentSection === "cities") {
      currentCityPath ??= parseQuotedTomlString(rawLine, "path");
      continue;
    }
    if (currentSection === "rigs") {
      currentRigPath ??= parseQuotedTomlString(rawLine, "path");
      currentRigDefaultCity ??= parseQuotedTomlString(rawLine, "default_city");
    }
  }

  return flushRig() ?? flushCity();
}

function discoverGcCityRoot(startCwd: string): string | null {
  const envCityPath = process.env.GC_CITY_PATH ?? process.env.GC_CITY;
  if (envCityPath) {
    const resolved = path.resolve(envCityPath);
    if (isGcCityRoot(resolved)) {
      return resolved;
    }
  }

  return (
    findGcCityRootUpward(startCwd) ??
    findSiblingGcCityRoot(startCwd) ??
    findRegisteredGcCityRoot(startCwd)
  );
}

function readGcCityTomlValue(
  cityPath: string,
  section: "api",
  key: "bind" | "host" | "port",
): string | null {
  const cityTomlPath = path.join(cityPath, "city.toml");
  if (!existsSync(cityTomlPath)) return null;

  const content = readFileSync(cityTomlPath, "utf8");
  let inSection = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === `[${section}]`) {
      inSection = true;
      continue;
    }
    if (inSection && trimmed.startsWith("[")) break;
    if (!inSection || !trimmed.startsWith(`${key} =`)) continue;
    const [, rawValue = ""] = trimmed.split("=", 2);
    const normalized = rawValue.trim().replace(/^"(.*)"$/, "$1");
    return normalized.length > 0 ? normalized : null;
  }
  return null;
}

function parseQuotedTomlString(line: string, key: string): string | null {
  const match = line.trim().match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"\\s*$`));
  return match?.[1] ?? null;
}

function replaceOrInsertSuspendedLine(
  lines: string[],
  start: number,
  end: number,
  suspended: boolean,
): void {
  const suspendedLine = `suspended = ${suspended ? "true" : "false"}`;
  for (let index = start; index < end; index += 1) {
    if (lines[index]?.trim().startsWith("suspended =")) {
      lines[index] = suspendedLine;
      return;
    }
  }
  lines.splice(end, 0, suspendedLine);
}

function updateRigOverrideSuspended(
  cityTomlContent: string,
  rigName: string,
  agentName: string,
  suspended: boolean,
): string {
  const lines = cityTomlContent.split("\n");
  let rigStart = -1;
  let rigEnd = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== "[[rigs]]") continue;
    let blockEnd = index + 1;
    let foundRigName: string | null = null;
    while (blockEnd < lines.length) {
      const trimmed = lines[blockEnd]?.trim() ?? "";
      if (trimmed === "[[rigs]]") break;
      if (trimmed.startsWith("[") && trimmed !== "[[rigs.overrides]]") break;
      foundRigName ??= parseQuotedTomlString(lines[blockEnd] ?? "", "name");
      blockEnd += 1;
    }
    if (foundRigName === rigName) {
      rigStart = index;
      rigEnd = blockEnd;
      break;
    }
    index = blockEnd - 1;
  }

  if (rigStart < 0 || rigEnd < 0) {
    throw new Error(`GC rig "${rigName}" not found in city.toml`);
  }

  for (let index = rigStart + 1; index < rigEnd; index += 1) {
    if (lines[index]?.trim() !== "[[rigs.overrides]]") continue;
    let overrideEnd = index + 1;
    let foundAgentName: string | null = null;
    while (overrideEnd < rigEnd) {
      const trimmed = lines[overrideEnd]?.trim() ?? "";
      if (trimmed === "[[rigs.overrides]]") break;
      foundAgentName ??= parseQuotedTomlString(lines[overrideEnd] ?? "", "agent");
      overrideEnd += 1;
    }
    if (foundAgentName === agentName) {
      replaceOrInsertSuspendedLine(lines, index + 1, overrideEnd, suspended);
      return lines.join("\n");
    }
    index = overrideEnd - 1;
  }

  const insertionIndex = rigEnd;
  const blockLines = [
    "",
    "[[rigs.overrides]]",
    `agent = "${agentName}"`,
    `suspended = ${suspended ? "true" : "false"}`,
  ];
  lines.splice(insertionIndex, 0, ...blockLines);
  return lines.join("\n");
}

function writeRigAgentSuspendedToCityToml(
  cityPath: string,
  qualifiedAgentName: string,
  suspended: boolean,
): void {
  const separatorIndex = qualifiedAgentName.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === qualifiedAgentName.length - 1) {
    throw new Error(`Expected qualified GC agent name, received "${qualifiedAgentName}"`);
  }
  const rigName = qualifiedAgentName.slice(0, separatorIndex);
  const agentName = qualifiedAgentName.slice(separatorIndex + 1);
  const cityTomlPath = path.join(cityPath, "city.toml");
  const nextContent = updateRigOverrideSuspended(
    readFileSync(cityTomlPath, "utf8"),
    rigName,
    agentName,
    suspended,
  );
  writeFileSync(cityTomlPath, nextContent, "utf8");
}

function replaceOrInsertNamedSessionModeLine(
  lines: string[],
  start: number,
  end: number,
  mode: "always" | "on_demand",
): void {
  const modeLine = `mode = "${mode}"`;
  for (let index = start; index < end; index += 1) {
    if (lines[index]?.trim().startsWith("mode =")) {
      lines[index] = modeLine;
      return;
    }
  }
  lines.splice(end, 0, modeLine);
}

function updateNamedSessionModePatchInCityToml(
  cityTomlContent: string,
  identity: { readonly dir: string; readonly template: string },
  mode: "always" | "on_demand",
): string {
  const dir = identity.dir;
  const template = identity.template;
  const lines = cityTomlContent.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== "[[patches.named_session]]") continue;
    let blockEnd = index + 1;
    let foundDir: string | null = null;
    let foundTemplate: string | null = null;
    while (blockEnd < lines.length) {
      const trimmed = lines[blockEnd]?.trim() ?? "";
      if (trimmed === "[[patches.named_session]]") break;
      if (trimmed.startsWith("[") && trimmed !== "[patches]") break;
      foundDir ??= parseQuotedTomlString(lines[blockEnd] ?? "", "dir");
      foundTemplate ??= parseQuotedTomlString(lines[blockEnd] ?? "", "template");
      blockEnd += 1;
    }
    if ((foundDir ?? "") === dir && foundTemplate === template) {
      replaceOrInsertNamedSessionModeLine(lines, index + 1, blockEnd, mode);
      return lines.join("\n");
    }
    index = blockEnd - 1;
  }

  const hasPatchesSection = lines.some((line) => line.trim() === "[patches]");
  const blockLines = [
    ...(hasPatchesSection ? [""] : ["", "[patches]", ""]),
    "[[patches.named_session]]",
    ...(dir ? [`dir = "${dir}"`] : []),
    `template = "${template}"`,
    `mode = "${mode}"`,
  ];
  lines.push(...blockLines);
  return lines.join("\n");
}

function writeAgentSessionModeToCityToml(
  cityPath: string,
  identity: { readonly dir: string; readonly template: string },
  mode: "always" | "on_demand",
): void {
  const cityTomlPath = path.join(cityPath, "city.toml");
  const nextContent = updateNamedSessionModePatchInCityToml(
    readFileSync(cityTomlPath, "utf8"),
    identity,
    mode,
  );
  writeFileSync(cityTomlPath, nextContent, "utf8");
}

function replaceOrInsertNumberLine(
  lines: string[],
  start: number,
  end: number,
  key: "max_active_sessions" | "min_active_sessions",
  value: number,
): void {
  const nextLine = `${key} = ${value}`;
  for (let index = start; index < end; index += 1) {
    if (lines[index]?.trim().startsWith(`${key} =`)) {
      lines[index] = nextLine;
      return;
    }
  }
  lines.splice(end, 0, nextLine);
}

function updateAgentPatchInCityToml(
  cityTomlContent: string,
  identity: { readonly dir: string; readonly template: string },
  patch: {
    readonly maxActiveSessions?: number;
    readonly minActiveSessions?: number;
    readonly wakeMode?: "resume" | "fresh";
  },
): string {
  const lines = cityTomlContent.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== "[[patches.agent]]") continue;
    let blockEnd = index + 1;
    let foundDir: string | null = null;
    let foundName: string | null = null;
    while (blockEnd < lines.length) {
      const trimmed = lines[blockEnd]?.trim() ?? "";
      if (trimmed === "[[patches.agent]]") break;
      if (trimmed.startsWith("[") && trimmed !== "[patches]") break;
      foundDir ??= parseQuotedTomlString(lines[blockEnd] ?? "", "dir");
      foundName ??= parseQuotedTomlString(lines[blockEnd] ?? "", "name");
      blockEnd += 1;
    }
    if ((foundDir ?? "") === identity.dir && foundName === identity.template) {
      if (patch.maxActiveSessions !== undefined) {
        replaceOrInsertNumberLine(
          lines,
          index + 1,
          blockEnd,
          "max_active_sessions",
          patch.maxActiveSessions,
        );
      }
      if (patch.minActiveSessions !== undefined) {
        replaceOrInsertNumberLine(
          lines,
          index + 1,
          blockEnd,
          "min_active_sessions",
          patch.minActiveSessions,
        );
      }
      if (patch.wakeMode !== undefined) {
        replaceOrInsertQuotedLine(lines, index + 1, blockEnd, "wake_mode", patch.wakeMode);
      }
      return lines.join("\n");
    }
    index = blockEnd - 1;
  }

  const hasPatchesSection = lines.some((line) => line.trim() === "[patches]");
  const blockLines = [
    ...(hasPatchesSection ? [""] : ["", "[patches]", ""]),
    "[[patches.agent]]",
    ...(identity.dir ? [`dir = "${identity.dir}"`] : []),
    `name = "${identity.template}"`,
    ...(patch.maxActiveSessions !== undefined
      ? [`max_active_sessions = ${patch.maxActiveSessions}`]
      : []),
    ...(patch.minActiveSessions !== undefined
      ? [`min_active_sessions = ${patch.minActiveSessions}`]
      : []),
    ...(patch.wakeMode !== undefined ? [`wake_mode = "${patch.wakeMode}"`] : []),
  ];
  lines.push(...blockLines);
  return lines.join("\n");
}

function replaceOrInsertQuotedLine(
  lines: string[],
  start: number,
  end: number,
  key: "wake_mode",
  value: string,
): void {
  const nextLine = `${key} = "${value}"`;
  for (let index = start; index < end; index += 1) {
    if (lines[index]?.trim().startsWith(`${key} =`)) {
      lines[index] = nextLine;
      return;
    }
  }
  lines.splice(end, 0, nextLine);
}

function writeAgentMaxActiveSessionsToCityToml(
  cityPath: string,
  identity: { readonly dir: string; readonly template: string },
  maxActiveSessions: number,
): void {
  const cityTomlPath = path.join(cityPath, "city.toml");
  const nextContent = updateAgentPatchInCityToml(readFileSync(cityTomlPath, "utf8"), identity, {
    maxActiveSessions,
  });
  writeFileSync(cityTomlPath, nextContent, "utf8");
}

function writeAgentMinActiveSessionsToCityToml(
  cityPath: string,
  identity: { readonly dir: string; readonly template: string },
  minActiveSessions: number,
): void {
  const cityTomlPath = path.join(cityPath, "city.toml");
  const nextContent = updateAgentPatchInCityToml(readFileSync(cityTomlPath, "utf8"), identity, {
    minActiveSessions,
  });
  writeFileSync(cityTomlPath, nextContent, "utf8");
}

function writeAgentWakeModeToCityToml(
  cityPath: string,
  identity: { readonly dir: string; readonly template: string },
  wakeMode: "resume" | "fresh",
): void {
  const cityTomlPath = path.join(cityPath, "city.toml");
  const nextContent = updateAgentPatchInCityToml(readFileSync(cityTomlPath, "utf8"), identity, {
    wakeMode,
  });
  writeFileSync(cityTomlPath, nextContent, "utf8");
}

function mergeCliExpandedConfig(
  primary: GcConfigResult,
  expanded: GcConfigResult | null,
): GcConfigResult {
  if (!expanded) {
    return primary;
  }
  const expandedByQualifiedName = new Map(
    expanded.agents.map((agent) => [resolveAgentConfigKey(agent), agent] as const),
  );
  return {
    ...primary,
    agents: primary.agents.map((agent) => {
      const expandedAgent = expandedByQualifiedName.get(resolveAgentConfigKey(agent));
      if (!expandedAgent) {
        return agent;
      }
      return {
        ...agent,
        ...(typeof expandedAgent.min_active_sessions === "number"
          ? { min_active_sessions: expandedAgent.min_active_sessions }
          : {}),
        ...(typeof expandedAgent.session_template === "string"
          ? { session_template: expandedAgent.session_template }
          : {}),
        ...(typeof expandedAgent.max_active_sessions === "number"
          ? { max_active_sessions: expandedAgent.max_active_sessions }
          : {}),
        ...(expandedAgent.wake_mode ? { wake_mode: expandedAgent.wake_mode } : {}),
      };
    }),
  };
}

function discoverGcApiBaseUrl(startCwd: string): string | null {
  const cityPath = discoverGcCityRoot(startCwd);
  if (!cityPath) {
    return null;
  }

  const port = readGcCityTomlValue(cityPath, "api", "port");
  if (!port) {
    return null;
  }

  const host =
    readGcCityTomlValue(cityPath, "api", "bind") ??
    readGcCityTomlValue(cityPath, "api", "host") ??
    "127.0.0.1";

  return `http://${host}:${port}`;
}

function resolveGcCliBinary(): string {
  return process.env.GC_BIN?.trim() || "/home/ubuntu/go/bin/gc";
}

function runGcCli(
  cityPath: string,
  args: string[],
): { readonly stdout: string; readonly stderr: string; readonly exitCode: number } {
  const result = spawnSync(resolveGcCliBinary(), ["--city", cityPath, ...args], {
    encoding: "utf8",
    timeout: GC_CLI_REQUEST_TIMEOUT_MS,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

const makeGcApiClient = Effect.gen(function* () {
  const configuredBaseUrl = yield* Config.string("GC_API_URL").pipe(Config.option);
  const configuredCityName = yield* Config.string("GC_CITY_NAME").pipe(Config.option);
  const cityPath = discoverGcCityRoot(process.cwd());
  const baseUrl =
    Option.getOrUndefined(configuredBaseUrl) ??
    discoverGcApiBaseUrl(process.cwd()) ??
    GC_API_DEFAULT_URL;
  let cachedCityName = Option.getOrUndefined(configuredCityName)?.trim() || null;
  const useCityScopedRoutes =
    Option.isSome(configuredCityName) || (cityPath !== null && cityPath.trim().length > 0);

  const eventPubSub = yield* PubSub.unbounded<GcEvent>();
  const beadCache = createResourceCache<string, GcBead | null>({
    ttlMs: BEAD_CACHE_TTL_MS,
    maxEntries: CACHE_MAX_ENTRIES,
  });
  const convoyCache = createResourceCache<string, GcConvoy | null>({
    ttlMs: CONVOY_CACHE_TTL_MS,
    maxEntries: CACHE_MAX_ENTRIES,
  });
  const formulaCache = createResourceCache<string, GcFormula | null>({
    ttlMs: FORMULA_CACHE_TTL_MS,
    maxEntries: Math.max(64, CACHE_MAX_ENTRIES / 4),
  });
  let lastKnownConfig: GcConfigResult | null = null;

  const connectSse = Effect.callback<void, never, never>((resume, signal) => {
    let aborted = false;
    let controller: AbortController | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
    };

    const scheduleReconnect = (delayMs: number) => {
      clearRetry();
      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        connect();
      }, delayMs);
    };

    const publishEvent = (data: string) => {
      const event = parseJsonSafe<GcEvent>(data);
      if (event) {
        Effect.runFork(PubSub.publish(eventPubSub, event));
      }
    };

    const connect = () => {
      if (aborted) return;
      const currentController = new AbortController();
      controller = currentController;
      resolveGcCityName()
        .then((cityName) =>
          fetch(
            `${baseUrl}${buildScopedOrLegacyPath(cityName, "/events/stream", "/v0/events/stream")}`,
            { signal: currentController.signal },
          ),
        )
        .then(async (response) => {
          if (!response.ok || !response.body) {
            if (!aborted) scheduleReconnect(5000);
            return;
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            if (aborted) break;
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const payload = line.slice(6).trim();
                if (payload) {
                  publishEvent(payload);
                }
              }
            }
          }
          if (!aborted) scheduleReconnect(2000);
        })
        .catch(() => {
          if (!aborted) scheduleReconnect(5000);
        });
    };

    const stop = () => {
      if (aborted) return;
      aborted = true;
      clearRetry();
      controller?.abort();
      resume(Effect.void);
    };

    signal.addEventListener("abort", stop);
    connect();

    return Effect.sync(() => {
      signal.removeEventListener("abort", stop);
      stop();
    });
  });

  yield* Effect.forkScoped(connectSse);

  const fetchJson = async <T>(path: string): Promise<T | null> => {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(GC_API_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        logGcWarning("request failed", {
          method: "GET",
          baseUrl,
          path,
          status: response.status,
        });
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      logGcError("request threw", {
        method: "GET",
        baseUrl,
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  const resolveGcCityName = async (): Promise<string | null> => {
    if (cachedCityName) {
      return cachedCityName;
    }

    const workspaceName = lastKnownConfig?.workspace.name?.trim();
    if (workspaceName) {
      cachedCityName = workspaceName;
      return cachedCityName;
    }

    const cityPathName = cityPath ? path.basename(cityPath).trim() : "";
    if (cityPathName) {
      cachedCityName = cityPathName;
      return cachedCityName;
    }

    const cities = await fetchJson<unknown>("/v0/cities");
    cachedCityName = resolveGcCityNameFromSupervisorCities({
      raw: cities,
      cityPath,
      preferredName: workspaceName ?? null,
    });
    return cachedCityName;
  };

  const requireGcCityName = async (): Promise<string> => {
    const cityName = await resolveGcCityName();
    if (!cityName) {
      throw new Error("GC city name unavailable");
    }
    return cityName;
  };

  const buildScopedOrLegacyPath = (
    cityName: string | null,
    cityScopedPath: string,
    legacyPath: string,
  ): string =>
    cityName && useCityScopedRoutes ? buildGcCityPath(cityName, cityScopedPath) : legacyPath;

  const postJson = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GC-Request": "t3code",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(GC_API_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      let text: string | null = null;
      try {
        text = await response.text();
      } catch {
        // Ignore malformed or empty error bodies and fall back to the status code.
      }
      throw new Error(extractGcProblemMessage(response.status, text));
    }
    return (await response.json()) as T;
  };

  const postMutation = async (path: string): Promise<void> => {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "X-GC-Request": "t3code",
        },
        signal: AbortSignal.timeout(GC_API_REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        return;
      }

      let body: string | null = null;
      try {
        body = await response.text();
      } catch {
        // Ignore malformed or empty error bodies and fall back to the status code.
      }
      const message = extractGcProblemMessage(response.status, body);

      logGcError("mutation failed", {
        method: "POST",
        baseUrl,
        path,
        status: response.status,
        body,
      });
      throw new Error(message);
    } catch (error) {
      if (error instanceof Error) {
        logGcError("mutation threw", {
          method: "POST",
          baseUrl,
          path,
          error: error.message,
        });
        throw error;
      }
      logGcError("mutation threw non-error", {
        method: "POST",
        baseUrl,
        path,
        error: String(error),
      });
      throw new Error("GC mutation failed", { cause: error });
    }
  };

  const patchJson = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-GC-Request": "t3code",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GC_API_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      let text: string | null = null;
      try {
        text = await response.text();
      } catch {
        // Ignore malformed or empty error bodies and fall back to the status code.
      }
      throw new Error(extractGcProblemMessage(response.status, text));
    }
    return (await response.json()) as T;
  };

  const getBead: GcApiClientShape["getBead"] = (id) => {
    const beadId = sanitizeKey(id);
    if (!beadId) return Effect.succeed(null);
    return Effect.tryPromise({
      try: async () =>
        beadCache.get(beadId, async () => {
          const cityName = await resolveGcCityName();
          const raw = await fetchJson<RawApiBead>(
            buildScopedOrLegacyPath(
              cityName,
              `/bead/${encodeURIComponent(beadId)}`,
              `/v0/bead/${beadId}`,
            ),
          );
          return raw ? normalizeBeadResponse(raw) : null;
        }),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));
  };

  const getConvoy: GcApiClientShape["getConvoy"] = (id) => {
    const convoyId = sanitizeKey(id);
    if (!convoyId) return Effect.succeed(null);
    return Effect.tryPromise({
      try: async () =>
        convoyCache.get(convoyId, async () => {
          const cityName = await resolveGcCityName();
          const raw = await fetchJson<RawApiConvoy>(
            buildScopedOrLegacyPath(
              cityName,
              `/convoy/${encodeURIComponent(convoyId)}`,
              `/v0/convoy/${convoyId}`,
            ),
          );
          return raw?.convoy ? normalizeConvoyResponse(raw) : null;
        }),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));
  };

  const getFormula: GcApiClientShape["getFormula"] = (name) => {
    const formulaName = sanitizeKey(name);
    if (!formulaName) return Effect.succeed(null);
    return Effect.tryPromise({
      try: async () =>
        formulaCache.get(formulaName, async () => {
          const cityName = await resolveGcCityName();
          return fetchJson<GcFormula>(
            buildScopedOrLegacyPath(
              cityName,
              `/formula/${encodeURIComponent(formulaName)}`,
              `/v0/formulas/${formulaName}`,
            ),
          );
        }),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));
  };

  const getConfig: GcApiClientShape["getConfig"] = () =>
    Effect.tryPromise({
      try: async () => {
        const loadExpandedCliConfig = (): GcConfigResult | null => {
          if (!cityPath) {
            return null;
          }
          if (typeof Bun === "undefined") {
            return null;
          }
          const cli = runGcCli(cityPath, ["config", "show"]);
          if (cli.exitCode !== 0) {
            logGcWarning("gc config show fallback failed", {
              cityPath,
              exitCode: cli.exitCode,
              stderr: cli.stderr,
            });
            return null;
          }
          return normalizeGcConfig(Bun.TOML.parse(cli.stdout), cityPath);
        };

        const cityName = await resolveGcCityName();
        const remote = await fetchJson<GcConfigResult>(
          buildScopedOrLegacyPath(cityName, "/config", "/v0/config"),
        );
        if (remote) {
          const normalizedRemote =
            cityPath && cityPath.trim().length > 0 ? normalizeGcConfig(remote, cityPath) : null;
          lastKnownConfig =
            normalizedRemote && cityPath
              ? mergeCliExpandedConfig(normalizedRemote, loadExpandedCliConfig())
              : (normalizedRemote ?? remote);
          cachedCityName = lastKnownConfig.workspace.name?.trim() || cachedCityName;
          return lastKnownConfig;
        }
        if (cityPath) {
          const parsed = loadExpandedCliConfig();
          if (parsed) {
            lastKnownConfig = parsed;
            return parsed;
          }
        }
        return lastKnownConfig;
      },
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));

  const submitSession: GcApiClientShape["submitSession"] = (sessionName, message) =>
    Effect.promise(async () => {
      const normalizedSessionName = sanitizeKey(sessionName);
      if (useCityScopedRoutes) {
        const cityName = await requireGcCityName();
        return postJson<GcSubmitSessionResult>(
          buildGcCityPath(cityName, `/session/${encodeURIComponent(normalizedSessionName)}/submit`),
          { message },
        );
      }
      return postJson<GcSubmitSessionResult>(
        `/v0/session/${escapePathSegments(normalizedSessionName)}/submit`,
        { message },
      );
    });

  const stopSession: GcApiClientShape["stopSession"] = (sessionName) =>
    Effect.promise(async () => {
      const normalizedSessionName = sanitizeKey(sessionName);
      if (useCityScopedRoutes) {
        const cityName = await requireGcCityName();
        return postJson<GcSessionActionResult>(
          buildGcCityPath(cityName, `/session/${encodeURIComponent(normalizedSessionName)}/stop`),
        );
      }
      return postJson<GcSessionActionResult>(
        `/v0/session/${escapePathSegments(normalizedSessionName)}/stop`,
      );
    });

  const respondToPending: GcApiClientShape["respondToPending"] = (sessionName, response) =>
    Effect.promise(async () => {
      const normalizedSessionName = sanitizeKey(sessionName);
      const body = {
        action: response.action,
        ...(response.requestId ? { request_id: response.requestId } : {}),
        ...(response.text ? { text: response.text } : {}),
        ...(response.metadata ? { metadata: response.metadata } : {}),
      };
      if (useCityScopedRoutes) {
        const cityName = await requireGcCityName();
        return postJson<GcSessionActionResult>(
          buildGcCityPath(
            cityName,
            `/session/${encodeURIComponent(normalizedSessionName)}/respond`,
          ),
          body,
        );
      }
      return postJson<GcSessionActionResult>(
        `/v0/session/${escapePathSegments(normalizedSessionName)}/respond`,
        body,
      );
    });

  const setAgentSuspended: GcApiClientShape["setAgentSuspended"] = (name, suspended) =>
    Effect.promise(async () =>
      runLoggedGcMutation("agent-suspended", sanitizeKey(name), { suspended }, async () => {
        const normalizedName = sanitizeKey(name);
        const action = suspended ? "suspend" : "resume";
        const cityName = await resolveGcCityName();
        try {
          await postMutation(
            buildScopedOrLegacyPath(
              cityName,
              `/${buildGcAgentActionPath(cityName ?? "city", normalizedName, action)
                .split("/")
                .slice(4)
                .join("/")}`,
              `/v0/agent/${escapePathSegments(normalizedName)}/${action}`,
            ),
          );
          lastKnownConfig = updateCachedAgentSuspended(lastKnownConfig, normalizedName, suspended);
          return { result: undefined, path: "gc-api" };
        } catch (error) {
          if (normalizedName.includes("/")) {
            if (!cityPath) {
              throw error;
            }
            logGcWarning("routing rig-scoped agent mutation via city.toml", {
              baseUrl,
              cityPath,
              agent: normalizedName,
              suspended,
            });
            writeRigAgentSuspendedToCityToml(cityPath, normalizedName, suspended);
            lastKnownConfig = updateCachedAgentSuspended(
              lastKnownConfig,
              normalizedName,
              suspended,
            );
            return { result: undefined, path: "city.toml" };
          }
          if (!cityPath) {
            throw error;
          }
          const cli = runGcCli(cityPath, ["agent", action, normalizedName]);
          if (cli.exitCode === 0) {
            lastKnownConfig = updateCachedAgentSuspended(
              lastKnownConfig,
              normalizedName,
              suspended,
            );
            return { result: undefined, path: "gc-cli" };
          }
          throw new Error(cli.stderr.trim() || cli.stdout.trim() || String(error), {
            cause: error,
          });
        }
      }),
    );

  const setAgentMaxActiveSessions: GcApiClientShape["setAgentMaxActiveSessions"] = (
    name,
    maxActiveSessions,
  ) =>
    Effect.promise(async () =>
      runLoggedGcMutation(
        "agent-max-active-sessions",
        sanitizeKey(name),
        { maxActiveSessions },
        async () => {
          const normalizedName = sanitizeKey(name);
          if (!Number.isInteger(maxActiveSessions)) {
            throw new Error("GC pool size must be an integer");
          }
          if (maxActiveSessions < 0) {
            throw new Error("GC pool size must be greater than or equal to 0");
          }
          if (!isPoolAgent(lastKnownConfig, normalizedName)) {
            throw new Error(
              `pool-size control for non-pool agent ${normalizedName} is not supported`,
            );
          }
          if (!cityPath) {
            throw new Error("GC city path unavailable for pool-size mutation");
          }
          const identity = findConfiguredAgentIdentity(lastKnownConfig, normalizedName);
          if (!identity) {
            throw new Error(`GC agent identity "${normalizedName}" not found in current config`);
          }
          logGcWarning("routing pool-size mutation via city.toml", {
            baseUrl,
            cityPath,
            agent: normalizedName,
            maxActiveSessions,
          });
          writeAgentMaxActiveSessionsToCityToml(cityPath, identity, maxActiveSessions);
          lastKnownConfig = updateCachedAgentMaxActiveSessions(
            lastKnownConfig,
            normalizedName,
            maxActiveSessions,
          );
          return { result: undefined, path: "city.toml" };
        },
      ),
    );

  const setAgentMinActiveSessions: GcApiClientShape["setAgentMinActiveSessions"] = (
    name,
    minActiveSessions,
  ) =>
    Effect.promise(async () =>
      runLoggedGcMutation(
        "agent-min-active-sessions",
        sanitizeKey(name),
        { minActiveSessions },
        async () => {
          const normalizedName = sanitizeKey(name);
          if (!Number.isInteger(minActiveSessions)) {
            throw new Error("GC minimum active sessions must be an integer");
          }
          if (minActiveSessions < 0) {
            throw new Error("GC minimum active sessions must be greater than or equal to 0");
          }
          if (!isPoolAgent(lastKnownConfig, normalizedName)) {
            throw new Error(
              `min-active control for non-pool agent ${normalizedName} is not supported`,
            );
          }
          if (!cityPath) {
            throw new Error("GC city path unavailable for min-active mutation");
          }
          const identity = findConfiguredAgentIdentity(lastKnownConfig, normalizedName);
          if (!identity) {
            throw new Error(`GC agent identity "${normalizedName}" not found in current config`);
          }
          logGcWarning("routing min-active mutation via city.toml", {
            baseUrl,
            cityPath,
            agent: normalizedName,
            minActiveSessions,
          });
          writeAgentMinActiveSessionsToCityToml(cityPath, identity, minActiveSessions);
          lastKnownConfig = updateCachedAgentMinActiveSessions(
            lastKnownConfig,
            normalizedName,
            minActiveSessions,
          );
          return { result: undefined, path: "city.toml" };
        },
      ),
    );

  const setAgentWakeMode: GcApiClientShape["setAgentWakeMode"] = (name, wakeMode) =>
    Effect.promise(async () =>
      runLoggedGcMutation("agent-wake-mode", sanitizeKey(name), { wakeMode }, async () => {
        const normalizedName = sanitizeKey(name);
        if (!cityPath) {
          throw new Error("GC city path unavailable for wake-mode mutation");
        }
        const identity = findConfiguredAgentIdentity(lastKnownConfig, normalizedName);
        if (!identity) {
          throw new Error(`GC agent identity "${normalizedName}" not found in current config`);
        }
        logGcWarning("routing wake-mode mutation via city.toml", {
          baseUrl,
          cityPath,
          agent: normalizedName,
          wakeMode,
        });
        writeAgentWakeModeToCityToml(cityPath, identity, wakeMode);
        lastKnownConfig = updateCachedAgentWakeMode(lastKnownConfig, normalizedName, wakeMode);
        return { result: undefined, path: "city.toml" };
      }),
    );

  const setAgentSessionMode: GcApiClientShape["setAgentSessionMode"] = (name, mode) =>
    Effect.promise(async () =>
      runLoggedGcMutation("agent-session-mode", sanitizeKey(name), { mode }, async () => {
        const normalizedName = sanitizeKey(name);
        if (!cityPath) {
          throw new Error("GC city path unavailable for named-session mode mutation");
        }
        if (isPoolAgent(lastKnownConfig, normalizedName)) {
          throw new Error(
            `session-mode toggle for pool agent ${normalizedName} is not supported yet`,
          );
        }
        logGcWarning("routing named-session mode mutation via city.toml", {
          baseUrl,
          cityPath,
          agent: normalizedName,
          mode,
        });
        const identity = findConfiguredAgentIdentity(lastKnownConfig, normalizedName);
        if (!identity) {
          throw new Error(`GC agent identity "${normalizedName}" not found in current config`);
        }
        writeAgentSessionModeToCityToml(cityPath, identity, mode);
        lastKnownConfig = updateCachedAgentSessionMode(lastKnownConfig, normalizedName, mode);
        return { result: undefined, path: "city.toml" };
      }),
    );

  const setCitySuspended: GcApiClientShape["setCitySuspended"] = (suspended) =>
    Effect.promise(async () =>
      runLoggedGcMutation("city-suspended", "workspace", { suspended }, async () => {
        const cityName = await requireGcCityName();
        try {
          await patchJson<{ status: string }>(`/v0/city/${encodeURIComponent(cityName)}`, {
            suspended,
          });
          if (lastKnownConfig) {
            lastKnownConfig = {
              ...lastKnownConfig,
              workspace: {
                ...lastKnownConfig.workspace,
                suspended,
              },
            };
          }
          return { result: undefined, path: "gc-api" };
        } catch (error) {
          if (!cityPath) {
            throw error;
          }
          const cli = runGcCli(cityPath, [suspended ? "suspend" : "resume"]);
          if (cli.exitCode === 0) {
            if (lastKnownConfig) {
              lastKnownConfig = {
                ...lastKnownConfig,
                workspace: {
                  ...lastKnownConfig.workspace,
                  suspended,
                },
              };
            }
            return { result: undefined, path: "gc-cli" };
          }
          throw new Error(cli.stderr.trim() || cli.stdout.trim() || String(error), {
            cause: error,
          });
        }
      }),
    );

  const setRigSuspended: GcApiClientShape["setRigSuspended"] = (name, suspended) =>
    Effect.promise(async () =>
      runLoggedGcMutation("rig-suspended", sanitizeKey(name), { suspended }, async () => {
        const normalizedName = sanitizeKey(name);
        const action = suspended ? "suspend" : "resume";
        const cityName = await resolveGcCityName();
        try {
          await postMutation(
            buildScopedOrLegacyPath(
              cityName,
              `/${buildGcRigActionPath(cityName ?? "city", normalizedName, action)
                .split("/")
                .slice(4)
                .join("/")}`,
              `/v0/rig/${escapePathSegments(normalizedName)}/${action}`,
            ),
          );
          lastKnownConfig = updateCachedRigSuspended(lastKnownConfig, normalizedName, suspended);
          return { result: undefined, path: "gc-api" };
        } catch (error) {
          if (!cityPath) {
            throw error;
          }
          const cli = runGcCli(cityPath, ["rig", action, normalizedName]);
          if (cli.exitCode === 0) {
            lastKnownConfig = updateCachedRigSuspended(lastKnownConfig, normalizedName, suspended);
            return { result: undefined, path: "gc-cli" };
          }
          throw new Error(cli.stderr.trim() || cli.stdout.trim() || String(error), {
            cause: error,
          });
        }
      }),
    );

  const isAvailable: GcApiClientShape["isAvailable"] = Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(GC_API_REQUEST_TIMEOUT_MS),
      });
      return response.ok;
    },
    catch: () => false,
  }).pipe(Effect.orElseSucceed(() => false));

  return {
    getBead,
    getConvoy,
    getFormula,
    getConfig,
    submitSession,
    stopSession,
    respondToPending,
    setAgentSuspended,
    setAgentMaxActiveSessions,
    setAgentMinActiveSessions,
    setAgentWakeMode,
    setAgentSessionMode,
    setCitySuspended,
    setRigSuspended,
    streamEvents: Stream.fromPubSub(eventPubSub),
    isAvailable,
  } satisfies GcApiClientShape;
});

export const GcApiClientLive = Layer.effect(GcApiClient)(makeGcApiClient);
