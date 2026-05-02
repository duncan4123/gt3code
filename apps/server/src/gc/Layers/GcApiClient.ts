/**
 * GcApiClientLive — Effect layer implementing the GcApiClient service.
 *
 * Connects to the Gas City REST API (default port 9443) and provides
 * typed access to beads, convoys, formulas, and the SSE event stream.
 *
 * Source of truth: gascity/internal/api/ handlers
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir as osHomedir } from "node:os";
import path from "node:path";
import { findBuiltBdBinaryPath, findBuiltDoltliteLibraryPath } from "@t3tools/beads-doltlite";
import { findBuiltGcBinaryPath } from "@t3tools/gascity";
import { getBundledGascityConfigLayout } from "@t3tools/gascity-config";
import { Effect, Layer, Stream, PubSub, Config, Option } from "effect";
import type {
  GcConfigAgent,
  GcConfigResult,
  GcLifecycleStatus,
  GcSessionActionResult,
  GcSubmitSessionResult,
} from "@t3tools/contracts";
import {
  DEFAULT_GC_API_URL,
  DEFAULT_GC_BINARY_PATH,
  DEFAULT_GC_CITY_PATH,
} from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
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
import { ServerSettingsService } from "../../serverSettings.ts";

const GC_API_DEFAULT_URL = "http://localhost:9443";
const GC_API_REQUEST_TIMEOUT_MS = 30_000;
const GC_CLI_REQUEST_TIMEOUT_MS = 8_000;
const GC_START_TIMEOUT_MS = 180_000;
const DEFAULT_GC_RIG_BINDINGS = [
  {
    name: "gascity",
    path: path.resolve(getBundledGascityConfigLayout().rootDir, "..", "..", "gascity"),
  },
  {
    name: "beads-doltlite",
    path: path.resolve(getBundledGascityConfigLayout().rootDir, "..", "..", "beads-doltlite"),
  },
  {
    name: "context-mode",
    path: path.resolve(getBundledGascityConfigLayout().rootDir, "..", "..", "context-mode"),
  },
] as const;

class GcApiClientStartError extends Error {
  override readonly name = "GcApiClientStartError";
}

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

function parseGcTomlValue(rawValue: string): unknown {
  const value = rawValue.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(parseGcTomlValue);
  }
  return value;
}

function parseGcConfigShowToml(content: string): unknown {
  if (typeof Bun !== "undefined") {
    return Bun.TOML.parse(content);
  }

  const root: {
    workspace?: Record<string, unknown>;
    providers?: Record<string, Record<string, unknown>>;
    agent?: Record<string, unknown>[];
    rig?: Record<string, unknown>[];
    named_session?: Record<string, unknown>[];
  } = {};
  let target: Record<string, unknown> | null = null;
  let currentAgent: Record<string, unknown> | null = null;
  let currentProvider: Record<string, unknown> | null = null;

  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed === "[workspace]") {
      root.workspace ??= {};
      target = root.workspace;
      continue;
    }
    if (trimmed === "[providers]") {
      root.providers ??= {};
      target = null;
      continue;
    }
    const providerMatch = trimmed.match(/^\[providers\.([^\].]+)\]$/);
    if (providerMatch) {
      root.providers ??= {};
      currentProvider = {};
      root.providers[providerMatch[1]!] = currentProvider;
      target = currentProvider;
      continue;
    }
    const providerEnvMatch = trimmed.match(/^\[providers\.([^\].]+)\.env\]$/);
    if (providerEnvMatch) {
      root.providers ??= {};
      currentProvider = root.providers[providerEnvMatch[1]!] ?? {};
      root.providers[providerEnvMatch[1]!] = currentProvider;
      const env: Record<string, unknown> = {};
      currentProvider.env = env;
      target = env;
      continue;
    }
    if (trimmed === "[[agent]]") {
      root.agent ??= [];
      currentAgent = {};
      root.agent.push(currentAgent);
      target = currentAgent;
      continue;
    }
    if (trimmed === "[[named_session]]") {
      root.named_session ??= [];
      const namedSession: Record<string, unknown> = {};
      root.named_session.push(namedSession);
      target = namedSession;
      continue;
    }
    if (trimmed === "[agent.env]") {
      if (currentAgent) {
        const env: Record<string, unknown> = {};
        currentAgent.env = env;
        target = env;
      }
      continue;
    }
    if (trimmed === "[[rigs]]") {
      root.rig ??= [];
      const rig: Record<string, unknown> = {};
      root.rig.push(rig);
      target = rig;
      continue;
    }
    if (trimmed.startsWith("[")) {
      target = null;
      continue;
    }
    if (!target) {
      continue;
    }
    const assignment = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }
    target[assignment[1]!] = parseGcTomlValue(assignment[2]!);
  }

  return root;
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
    const minActiveSessions =
      typeof agent.min_active_sessions === "number" ? agent.min_active_sessions : undefined;
    const hasMinActiveSessions = minActiveSessions !== undefined;
    const isPool = typeof agent.is_pool === "boolean" ? agent.is_pool : hasMinActiveSessions;
    const effectiveNamedSessionMode = isPool
      ? undefined
      : (namedSessionMode ?? derivedNamedSessionMode ?? "always");
    const wakeMode: "resume" | "fresh" | undefined =
      agent.wake_mode === "resume" || agent.wake_mode === "fresh" ? agent.wake_mode : undefined;
    return [
      {
        name: agent.name,
        ...(typeof agent.description === "string" ? { description: agent.description } : {}),
        ...(typeof agent.dir === "string" ? { dir: agent.dir } : {}),
        ...(typeof agent.provider === "string" ? { provider: agent.provider } : {}),
        ...(typeof agent.session_template === "string"
          ? { session_template: agent.session_template }
          : {}),
        ...(typeof agent.work_dir === "string" ? { work_dir: agent.work_dir } : {}),
        ...(typeof agent.prompt_template === "string"
          ? { prompt_template: agent.prompt_template }
          : {}),
        ...(typeof agent.start_command === "string" ? { start_command: agent.start_command } : {}),
        ...(typeof agent.default_sling_formula === "string"
          ? { default_sling_formula: agent.default_sling_formula }
          : {}),
        ...(isPool ? { is_pool: true } : {}),
        ...(hasMinActiveSessions ? { min_active_sessions: minActiveSessions } : {}),
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
      resolveAgentConfigKey(agent) === name
        ? {
            ...agent,
            wake_mode: wakeMode,
          }
        : agent,
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
  if (agent.name.includes(".")) {
    return agent.name.slice(agent.name.lastIndexOf(".") + 1);
  }
  return agent.name;
}

function gcConfigAgentMergeKeys(agent: Pick<GcConfigAgent, "dir" | "name">): readonly string[] {
  const keys = new Set<string>([resolveAgentConfigKey(agent)]);
  if (agent.name.includes(".")) {
    const shortName = agent.name.slice(agent.name.lastIndexOf(".") + 1);
    keys.add(resolveAgentConfigKey({ ...agent, name: shortName }));
  }
  return [...keys];
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
    existsSync(path.join(candidatePath, "city.toml")) &&
    existsSync(path.join(candidatePath, "pack.toml"))
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

function findT3CodePackagedGcCityRoot(): string | null {
  const cityPath = getBundledGascityConfigLayout().rootDir;
  return isGcCityRoot(cityPath) ? cityPath : null;
}

function isBundledGcCityRoot(cityPath: string): boolean {
  return path.resolve(cityPath) === path.resolve(getBundledGascityConfigLayout().rootDir);
}

function ensureDefaultGcSiteToml(cityPath: string): void {
  const gcDir = path.join(cityPath, ".gc");
  const siteTomlPath = path.join(gcDir, "site.toml");
  mkdirSync(gcDir, { recursive: true });
  let content = existsSync(siteTomlPath)
    ? readFileSync(siteTomlPath, "utf8")
    : "# T3Code packaged city keeps machine-local rig path bindings here.\n";
  for (const binding of DEFAULT_GC_RIG_BINDINGS) {
    if (!existsSync(binding.path)) {
      continue;
    }
    content = replaceOrAppendGcRigBinding(content, binding);
  }
  writeFileSync(siteTomlPath, content);
}

function replaceOrAppendGcRigBinding(
  content: string,
  binding: { readonly name: string; readonly path: string },
): string {
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== "[[rig]]") continue;
    let blockEnd = index + 1;
    let foundName = false;
    let pathLineIndex = -1;
    while (blockEnd < lines.length && lines[blockEnd]?.trim() !== "[[rig]]") {
      const trimmed = lines[blockEnd]?.trim() ?? "";
      if (trimmed === `name = "${binding.name}"`) {
        foundName = true;
      }
      if (trimmed.startsWith("path =")) {
        pathLineIndex = blockEnd;
      }
      blockEnd += 1;
    }
    if (!foundName) {
      index = blockEnd - 1;
      continue;
    }
    const pathLine = `path = "${binding.path}"`;
    if (pathLineIndex >= 0) {
      lines[pathLineIndex] = pathLine;
    } else {
      lines.splice(blockEnd, 0, pathLine);
    }
    return lines.join("\n");
  }
  return `${content.replace(/\s*$/, "")}\n\n[[rig]]\nname = "${binding.name}"\npath = "${binding.path}"\n`;
}

function gcBeadsPrefixForRig(name: string): string {
  switch (name) {
    case "gascity":
      return "ga";
    case "beads-doltlite":
      return "bd";
    case "context-mode":
      return "ccm";
    default:
      return "gc";
  }
}

function ensureDefaultGcBeadsConfig(
  cityPath: string,
  issuePrefix: string,
  doltDatabase: string,
): void {
  const beadsDir = path.join(cityPath, ".beads");
  mkdirSync(beadsDir, { recursive: true });
  const configPath = path.join(beadsDir, "config.yaml");
  const configContent = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  writeFileSync(
    configPath,
    ensureYamlScalarLines(configContent, {
      issue_prefix: issuePrefix,
      "issue-prefix": issuePrefix,
      "dolt.auto-start": "false",
      "export.auto": "false",
      "types.custom": '"session,wait,convoy,molecule,formula"',
    }),
  );
  const metadataPath = path.join(beadsDir, "metadata.json");
  if (!existsSync(metadataPath)) {
    writeFileSync(
      metadataPath,
      `${JSON.stringify(
        {
          backend: "doltlite",
          database: "doltlite",
          dolt_database: doltDatabase,
          dolt_mode: "embedded",
        },
        null,
        2,
      )}\n`,
    );
  }
}

function ensureYamlScalarLines(content: string, values: Record<string, string>): string {
  const lines = content
    .split("\n")
    .filter((line, index, all) => index < all.length - 1 || line !== "");
  for (const [key, value] of Object.entries(values)) {
    const nextLine = `${key}: ${value}`;
    const index = lines.findIndex((line) => line.trimStart().startsWith(`${key}:`));
    if (index >= 0) {
      lines[index] = nextLine;
    } else {
      lines.push(nextLine);
    }
  }
  return `${lines.join("\n").replace(/\s*$/, "")}\n`;
}

function copyBundledRuntimeBinary(
  binaryPath: string,
  sourceBinaryPath: string | undefined,
  label: string,
): void {
  if (!sourceBinaryPath) {
    throw new Error(`No bundled ${label} binary is available for this platform.`);
  }
  mkdirSync(path.dirname(binaryPath), { recursive: true });
  const tempBinaryPath = `${binaryPath}.${process.pid}.tmp`;
  try {
    copyFileSync(sourceBinaryPath, tempBinaryPath);
    if (process.platform !== "win32") {
      chmodSync(tempBinaryPath, 0o755);
    }
    renameSync(tempBinaryPath, binaryPath);
  } catch (error) {
    rmSync(tempBinaryPath, { force: true });
    throw error;
  }
}

function ensurePackagedGcRuntime(input: {
  readonly runtimeHome: string;
  readonly cityPath: string | null;
  readonly binaryPath: string;
}): {
  readonly cityPath: string;
  readonly binaryPath: string;
  readonly bdBinaryPath: string;
  readonly doltliteLibraryPath: string;
} {
  const defaultCityPath = getBundledGascityConfigLayout().rootDir;
  const cityPath = input.cityPath ?? defaultCityPath;
  const bdBinaryPath = path.join(
    input.runtimeHome,
    "bin",
    process.platform === "win32" ? "bd.exe" : "bd",
  );
  const doltliteLibraryPath = path.join(
    input.runtimeHome,
    "bin",
    process.platform === "darwin"
      ? "libdoltlite.dylib"
      : process.platform === "win32"
        ? "doltlite.dll"
        : "libdoltlite.so",
  );
  if (!isGcCityRoot(cityPath)) {
    if (path.resolve(cityPath) !== path.resolve(defaultCityPath)) {
      throw new Error(`Gas City city is not installed at ${cityPath}.`);
    }
    throw new Error(`Bundled Gas City city is missing required config at ${defaultCityPath}.`);
  }
  if (isBundledGcCityRoot(cityPath)) {
    ensureDefaultGcSiteToml(cityPath);
    ensureDefaultGcBeadsConfig(cityPath, "t3", "hq");
    for (const binding of DEFAULT_GC_RIG_BINDINGS) {
      if (existsSync(binding.path)) {
        const issuePrefix = gcBeadsPrefixForRig(binding.name);
        ensureDefaultGcBeadsConfig(binding.path, issuePrefix, issuePrefix);
      }
    }
  }
  if (!existsSync(input.binaryPath) || !statSync(input.binaryPath).isFile()) {
    copyBundledRuntimeBinary(input.binaryPath, findBuiltGcBinaryPath(), "Gas City");
  }
  if (!existsSync(bdBinaryPath) || !statSync(bdBinaryPath).isFile()) {
    copyBundledRuntimeBinary(bdBinaryPath, findBuiltBdBinaryPath(), "beads");
  }
  if (
    process.platform !== "win32" &&
    (!existsSync(doltliteLibraryPath) || !statSync(doltliteLibraryPath).isFile())
  ) {
    copyBundledRuntimeBinary(doltliteLibraryPath, findBuiltDoltliteLibraryPath(), "Doltlite");
  }
  return { cityPath, binaryPath: input.binaryPath, bdBinaryPath, doltliteLibraryPath };
}

function findRegisteredGcCityRoot(startCwd: string): string | null {
  const registryPath = path.join(osHomedir(), ".gc", "cities.toml");
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
    findRegisteredGcCityRoot(startCwd) ??
    findSiblingGcCityRoot(startCwd) ??
    findT3CodePackagedGcCityRoot()
  );
}

function expandHomePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") {
    return process.env.HOME ?? trimmed;
  }
  if (trimmed.startsWith("~/")) {
    return path.join(process.env.HOME ?? "~", trimmed.slice(2));
  }
  return trimmed;
}

function resolveConfiguredGcCityPath(value: string): string | null {
  const effectiveValue =
    value.trim() === DEFAULT_GC_CITY_PATH ? getBundledGascityConfigLayout().rootDir : value;
  const expanded = expandHomePath(effectiveValue);
  if (!expanded) {
    return null;
  }
  return path.resolve(expanded);
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

function parseQuotedTomlArray(line: string, key: string): readonly string[] {
  const match = line.trim().match(new RegExp(`^${key}\\s*=\\s*\\[(.*)\\]\\s*$`));
  if (!match) {
    return [];
  }
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!).filter(Boolean);
}

function findRigIncludesInCityToml(cityTomlContent: string, rigName: string): readonly string[] {
  const lines = cityTomlContent.split("\n");
  const isRigChildSection = (trimmed: string): boolean =>
    trimmed === "[[rigs.overrides]]" || trimmed.startsWith("[rigs.");

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== "[[rigs]]") continue;
    let blockEnd = index + 1;
    let foundRigName: string | null = null;
    let includes: readonly string[] = [];
    while (blockEnd < lines.length) {
      const line = lines[blockEnd] ?? "";
      const trimmed = line.trim();
      if (trimmed === "[[rigs]]") break;
      if (trimmed.startsWith("[") && !isRigChildSection(trimmed)) break;
      foundRigName ??= parseQuotedTomlString(line, "name");
      const parsedIncludes = parseQuotedTomlArray(line, "includes");
      if (parsedIncludes.length > 0) {
        includes = parsedIncludes;
      }
      blockEnd += 1;
    }
    if (foundRigName === rigName) {
      return includes;
    }
    index = blockEnd - 1;
  }
  return [];
}

function readPackAgentNames(cityPath: string, includePath: string): Set<string> {
  const packPath = path.isAbsolute(includePath) ? includePath : path.join(cityPath, includePath);
  const agentsPath = path.join(packPath, "agents");
  if (!existsSync(agentsPath)) {
    return new Set();
  }
  return new Set(
    readdirSync(agentsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(path.join(agentsPath, name, "agent.toml"))),
  );
}

function readRigIncludedAgentNames(cityPath: string, rigName: string): Set<string> {
  const cityTomlPath = path.join(cityPath, "city.toml");
  const includes = findRigIncludesInCityToml(readFileSync(cityTomlPath, "utf8"), rigName);
  const agents = new Set<string>();
  for (const includePath of includes) {
    for (const agentName of readPackAgentNames(cityPath, includePath)) {
      agents.add(agentName);
    }
  }
  return agents;
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
  const isRigChildSection = (trimmed: string): boolean =>
    trimmed === "[[rigs.overrides]]" || trimmed.startsWith("[rigs.");

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== "[[rigs]]") continue;
    let blockEnd = index + 1;
    let foundRigName: string | null = null;
    while (blockEnd < lines.length) {
      const trimmed = lines[blockEnd]?.trim() ?? "";
      if (trimmed === "[[rigs]]") break;
      if (trimmed.startsWith("[") && !isRigChildSection(trimmed)) break;
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
      if (trimmed.startsWith("[") && !isRigChildSection(trimmed)) break;
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

function seedRigAgentSuspendedOverrides(
  binaryPath: string,
  cityPath: string,
  rigName: string,
  suspended: boolean,
): void {
  const config = loadExpandedGcConfig(binaryPath, cityPath);
  const includedAgentNames = readRigIncludedAgentNames(cityPath, rigName);
  if (includedAgentNames.size === 0) {
    throw new Error(`GC rig "${rigName}" has no readable included pack agents`);
  }
  for (const agent of config.agents) {
    if (agent.dir !== rigName) continue;
    if (!includedAgentNames.has(agent.name)) continue;
    writeRigAgentSuspendedToCityToml(cityPath, `${rigName}/${agent.name}`, suspended);
  }
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
    readonly suspended?: boolean;
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
      if (typeof patch.maxActiveSessions === "number") {
        replaceOrInsertNumberLine(
          lines,
          index + 1,
          blockEnd,
          "max_active_sessions",
          patch.maxActiveSessions,
        );
      }
      if (typeof patch.minActiveSessions === "number") {
        replaceOrInsertNumberLine(
          lines,
          index + 1,
          blockEnd,
          "min_active_sessions",
          patch.minActiveSessions,
        );
      }
      if (typeof patch.suspended === "boolean") {
        replaceOrInsertBooleanLine(lines, index + 1, blockEnd, "suspended", patch.suspended);
      }
      if (patch.wakeMode) {
        replaceOrInsertStringLine(lines, index + 1, blockEnd, "wake_mode", patch.wakeMode);
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
    ...(typeof patch.maxActiveSessions === "number"
      ? [`max_active_sessions = ${patch.maxActiveSessions}`]
      : []),
    ...(typeof patch.minActiveSessions === "number"
      ? [`min_active_sessions = ${patch.minActiveSessions}`]
      : []),
    ...(typeof patch.suspended === "boolean" ? [`suspended = ${patch.suspended}`] : []),
    ...(patch.wakeMode ? [`wake_mode = "${patch.wakeMode}"`] : []),
  ];
  lines.push(...blockLines);
  return lines.join("\n");
}

function replaceOrInsertBooleanLine(
  lines: string[],
  start: number,
  end: number,
  key: "suspended",
  value: boolean,
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

function writeAgentSuspendedToCityToml(
  cityPath: string,
  identity: { readonly dir: string; readonly template: string },
  suspended: boolean,
): void {
  const cityTomlPath = path.join(cityPath, "city.toml");
  const nextContent = updateAgentPatchInCityToml(readFileSync(cityTomlPath, "utf8"), identity, {
    suspended,
  });
  writeFileSync(cityTomlPath, nextContent, "utf8");
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

function replaceOrInsertStringLine(
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
    expanded.agents.flatMap((agent) =>
      gcConfigAgentMergeKeys(agent).map((key) => [key, agent] as const),
    ),
  );
  const primaryAgentKeys = new Set(
    primary.agents.flatMap((agent) => gcConfigAgentMergeKeys(agent)),
  );
  const primaryRigNames = new Set(primary.rigs.map((rig) => rig.name));
  return {
    ...primary,
    rigs: [...primary.rigs, ...expanded.rigs.filter((rig) => !primaryRigNames.has(rig.name))],
    agents: [
      ...primary.agents.map((agent) => {
        const expandedAgent = gcConfigAgentMergeKeys(agent)
          .map((key) => expandedByQualifiedName.get(key))
          .find((value): value is GcConfigAgent => Boolean(value));
        if (!expandedAgent) {
          return agent;
        }
        return {
          ...agent,
          ...(typeof expandedAgent.description === "string"
            ? { description: expandedAgent.description }
            : {}),
          ...(typeof expandedAgent.work_dir === "string"
            ? { work_dir: expandedAgent.work_dir }
            : {}),
          ...(typeof expandedAgent.prompt_template === "string"
            ? { prompt_template: expandedAgent.prompt_template }
            : {}),
          ...(typeof expandedAgent.start_command === "string"
            ? { start_command: expandedAgent.start_command }
            : {}),
          ...(typeof expandedAgent.default_sling_formula === "string"
            ? { default_sling_formula: expandedAgent.default_sling_formula }
            : {}),
          ...(expandedAgent.is_pool === true ? { is_pool: true } : {}),
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
          ...(!agent.named_session_mode && expandedAgent.named_session_mode
            ? { named_session_mode: expandedAgent.named_session_mode }
            : {}),
        };
      }),
      ...expanded.agents.filter((agent) =>
        gcConfigAgentMergeKeys(agent).every((key) => !primaryAgentKeys.has(key)),
      ),
    ],
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

function discoverGcSupervisorApiBaseUrl(runtimeHome: string): string | null {
  const supervisorTomlPath = path.join(runtimeHome, "supervisor.toml");
  if (!existsSync(supervisorTomlPath)) {
    return null;
  }
  let content: string;
  try {
    content = readFileSync(supervisorTomlPath, "utf8");
  } catch {
    return null;
  }
  const portMatch = content.match(/^\s*port\s*=\s*"?([0-9]+)"?\s*$/m);
  const normalizedPort = portMatch?.[1]?.trim() ?? "";
  return normalizedPort ? `http://127.0.0.1:${normalizedPort}` : null;
}

function gcSupervisorLifecycleFields(baseUrl: string | null): Partial<GcLifecycleStatus> {
  if (!baseUrl) {
    return {};
  }
  try {
    const url = new URL(baseUrl);
    const port = Number.parseInt(url.port, 10);
    return {
      supervisorUrl: url.toString().replace(/\/+$/, ""),
      ...(Number.isFinite(port) ? { supervisorPort: port } : {}),
    };
  } catch {
    return {};
  }
}

function normalizeGcApiBaseUrl(value: string | undefined): {
  readonly baseUrl: string | null;
  readonly cityName: string | null;
} {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return { baseUrl: null, cityName: null };
  }
  const cityMatch = trimmed.match(/^(.*)\/v0\/city\/([^/]+)$/);
  if (!cityMatch) {
    return { baseUrl: trimmed, cityName: null };
  }
  const baseUrl = cityMatch[1]?.replace(/\/+$/, "") ?? "";
  return {
    baseUrl: baseUrl.length > 0 ? baseUrl : null,
    cityName: decodeURIComponent(cityMatch[2] ?? "").trim() || null,
  };
}

function isDefaultGcApiUrl(value: string): boolean {
  const normalized = value.trim().replace(/\/+$/, "");
  return normalized === DEFAULT_GC_API_URL || normalized === "http://127.0.0.1:8372";
}

function resolveGcCliBinary(value: string, runtimeHome: string): string {
  const effectiveValue =
    value.trim() === DEFAULT_GC_BINARY_PATH
      ? path.join(runtimeHome, "bin", process.platform === "win32" ? "gc.exe" : "gc")
      : value;
  return expandHomePath(effectiveValue) || process.env.GC_BIN?.trim() || "gc";
}

function runGcCli(
  binaryPath: string,
  cityPath: string,
  args: string[],
  options?: { readonly timeoutMs?: number },
): { readonly stdout: string; readonly stderr: string; readonly exitCode: number } {
  const binDir = path.dirname(binaryPath);
  const result = spawnSync(binaryPath, ["--city", cityPath, ...args], {
    encoding: "utf8",
    env: withPackagedGcRuntimeEnv(
      {
        ...process.env,
        GC_CITY_PATH: cityPath,
        GC_BEADS_BACKEND: "doltlite",
        GC_BIN: binaryPath,
        BD_BIN: path.join(binDir, process.platform === "win32" ? "bd.exe" : "bd"),
      },
      binDir,
    ),
    timeout: options?.timeoutMs ?? GC_CLI_REQUEST_TIMEOUT_MS,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function withPackagedGcRuntimeEnv(env: NodeJS.ProcessEnv, binDir: string): NodeJS.ProcessEnv {
  const next = { ...env };
  clearDoltServerEnv(next);
  prependPathEnv(next, "PATH", binDir);
  if (process.platform === "linux") {
    prependPathEnv(next, "LD_LIBRARY_PATH", binDir);
  } else if (process.platform === "darwin") {
    prependPathEnv(next, "DYLD_LIBRARY_PATH", binDir);
  }
  return next;
}

function prependPathEnv(env: NodeJS.ProcessEnv, key: string, value: string): void {
  const actualKey =
    key === "PATH" && process.platform === "win32"
      ? (Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "Path")
      : key;
  const separator = process.platform === "win32" ? ";" : ":";
  env[actualKey] = [value, env[actualKey]].filter(Boolean).join(separator);
}

function clearDoltServerEnv(env: NodeJS.ProcessEnv): void {
  for (const key of [
    "BEADS_DOLT_AUTO_START",
    "BEADS_DOLT_DATABASE",
    "BEADS_DOLT_PORT",
    "BEADS_DOLT_SERVER_DATABASE",
    "BEADS_DOLT_SERVER_HOST",
    "BEADS_DOLT_SERVER_MODE",
    "BEADS_DOLT_SERVER_PORT",
    "GC_DOLT_DATABASE",
    "GC_DOLT_HOST",
    "GC_DOLT_PASSWORD",
    "GC_DOLT_PORT",
    "GC_DOLT_USER",
  ]) {
    delete env[key];
  }
}

function loadExpandedGcConfig(binaryPath: string, cityPath: string): GcConfigResult {
  const cli = runGcCli(binaryPath, cityPath, ["config", "show"]);
  if (cli.exitCode !== 0) {
    throw new Error(
      cli.stderr.trim() || cli.stdout.trim() || "Failed to expand GC config for city.toml patches",
    );
  }
  const config = normalizeGcConfig(parseGcConfigShowToml(cli.stdout), cityPath);
  if (!config) {
    throw new Error("Failed to parse expanded GC config for city.toml patches");
  }
  return config;
}

function isProcessMatching(pattern: string): boolean {
  if (process.platform === "win32") {
    return false;
  }
  const result = spawnSync("pgrep", ["-f", pattern], {
    encoding: "utf8",
    timeout: 2_000,
  });
  return (result.status ?? 1) === 0 && (result.stdout ?? "").trim().length > 0;
}

function readGcLifecycleStatus(input: {
  readonly binaryPath: string;
  readonly cityPath: string | null;
  readonly supervisorBaseUrl?: string | null;
}): GcLifecycleStatus {
  const supervisorRunning = isProcessMatching(`${input.binaryPath} supervisor run`);
  const supervisorFields = supervisorRunning
    ? gcSupervisorLifecycleFields(input.supervisorBaseUrl ?? null)
    : {};
  if (!input.cityPath) {
    return { supervisorRunning, controllerRunning: false, ...supervisorFields };
  }

  const status = runGcCli(input.binaryPath, input.cityPath, ["status"], { timeoutMs: 1_500 });
  const statusText = `${status.stdout}\n${status.stderr}`;
  const controllerMatch = statusText.match(/^\s*Controller:\s*(.+)$/m);
  const controllerState = controllerMatch?.[1]?.trim().toLowerCase() ?? "";
  const controllerRunning =
    status.exitCode === 0 &&
    controllerState.length > 0 &&
    !controllerState.includes("stopped") &&
    !controllerState.includes("not running") &&
    !controllerState.includes("none");
  return { supervisorRunning, controllerRunning, ...supervisorFields };
}

async function readGcLifecycleStatusFromSupervisorApi(input: {
  readonly baseUrl: string;
  readonly cityName: string | null;
  readonly cityPath: string | null;
}): Promise<GcLifecycleStatus | null> {
  try {
    const response = await fetch(`${input.baseUrl}/v0/cities`, {
      headers: { "X-GC-Request": "t3code" },
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as unknown;
    const items =
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Array.isArray((body as { items?: unknown }).items)
        ? (body as { items: unknown[] }).items
        : [];
    const city =
      items.find((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return false;
        }
        const record = item as Record<string, unknown>;
        return (
          (input.cityName && record.name === input.cityName) ||
          (input.cityPath && record.path === input.cityPath)
        );
      }) ?? (items.length === 1 ? items[0] : null);
    const controllerRunning =
      city && typeof city === "object" && !Array.isArray(city)
        ? Boolean((city as Record<string, unknown>).running)
        : false;
    return {
      supervisorRunning: true,
      controllerRunning,
      ...gcSupervisorLifecycleFields(input.baseUrl),
    };
  } catch {
    return null;
  }
}

function withLifecycleStatus(config: GcConfigResult, lifecycle: GcLifecycleStatus): GcConfigResult {
  return {
    ...config,
    lifecycle,
  };
}

const makeGcApiClient = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const serverConfig = yield* ServerConfig;
  process.env.T3CODE_WORKTREES_DIR ??= serverConfig.worktreesDir;
  process.env.GC_WORKTREES_DIR ??= serverConfig.worktreesDir;
  const runtimeContext = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(runtimeContext);
  const settings = yield* serverSettings.getSettings;
  const gcSettings = settings.providers.gc;
  const configuredBaseUrl = yield* Config.string("GC_API_URL").pipe(Config.option);
  const configuredCityName = yield* Config.string("GC_CITY_NAME").pipe(Config.option);
  const runtimeHome = expandHomePath(gcSettings.runtimeHome);
  const cityPath =
    resolveConfiguredGcCityPath(gcSettings.cityPath) ?? discoverGcCityRoot(process.cwd());
  const configuredSettingsApiUrl =
    gcSettings.apiUrl.trim() && !isDefaultGcApiUrl(gcSettings.apiUrl)
      ? gcSettings.apiUrl
      : undefined;
  const normalizedConfiguredBaseUrl = normalizeGcApiBaseUrl(
    configuredSettingsApiUrl || Option.getOrUndefined(configuredBaseUrl),
  );
  const baseUrl =
    normalizedConfiguredBaseUrl.baseUrl ??
    discoverGcSupervisorApiBaseUrl(runtimeHome) ??
    discoverGcApiBaseUrl(process.cwd()) ??
    GC_API_DEFAULT_URL;
  let cachedCityName =
    gcSettings.cityName.trim() ||
    Option.getOrUndefined(configuredCityName)?.trim() ||
    normalizedConfiguredBaseUrl.cityName ||
    null;
  const gcCliBinary = resolveGcCliBinary(gcSettings.binaryPath, runtimeHome);
  const useCityScopedRoutes =
    Option.isSome(configuredCityName) || (cityPath !== null && cityPath.trim().length > 0);
  const routeMode = useCityScopedRoutes ? "city-scoped" : "legacy";

  yield* Effect.logInfo("gc api client configured", {
    baseUrl,
    cityPath,
    gcCliBinary,
    cityName: cachedCityName,
    cwd: process.cwd(),
    routeMode,
    hasConfiguredBaseUrl: Option.isSome(configuredBaseUrl),
    hasConfiguredCityName: Option.isSome(configuredCityName),
  });
  if (!cityPath && !Option.isSome(configuredBaseUrl)) {
    yield* Effect.logWarning(
      "gc api client using default URL because no GC city root or GC_API_URL was found",
      {
        baseUrl,
        cwd: process.cwd(),
        routeMode,
      },
    );
  }

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
        runFork(PubSub.publish(eventPubSub, event));
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
          cityPath,
          routeMode,
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
        cityPath,
        routeMode,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  const resolveGcCityName = async (): Promise<string | null> => {
    if (cachedCityName) {
      return cachedCityName;
    }

    const cities = await fetchJson<unknown>("/v0/cities");
    cachedCityName = resolveGcCityNameFromSupervisorCities({
      raw: cities,
      cityPath,
      preferredName: lastKnownConfig?.workspace.name?.trim() ?? null,
    });
    if (cachedCityName) {
      return cachedCityName;
    }

    const cityPathName = cityPath ? path.basename(cityPath).trim() : "";
    cachedCityName = cityPathName || null;
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
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "X-GC-Request": "t3code",
        },
        signal: AbortSignal.timeout(GC_API_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error) {
        logGcError("mutation threw", {
          method: "POST",
          baseUrl,
          path,
          cityPath,
          routeMode,
          error: error.message,
        });
        throw error;
      }
      logGcError("mutation threw non-error", {
        method: "POST",
        baseUrl,
        path,
        cityPath,
        routeMode,
        error: String(error),
      });
      throw new Error("GC mutation failed", { cause: error });
    }

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
      cityPath,
      routeMode,
      status: response.status,
      body,
    });
    throw new Error(message);
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
        let expandedCliConfig: GcConfigResult | null | undefined;
        const loadExpandedCliConfig = (): GcConfigResult | null => {
          if (expandedCliConfig !== undefined) {
            return expandedCliConfig;
          }
          if (!cityPath) {
            expandedCliConfig = null;
            return null;
          }
          const cli = runGcCli(gcCliBinary, cityPath, ["config", "show"]);
          if (cli.exitCode !== 0) {
            logGcWarning("gc config show fallback failed", {
              cityPath,
              exitCode: cli.exitCode,
              stderr: cli.stderr,
            });
            expandedCliConfig = null;
            return null;
          }
          expandedCliConfig = normalizeGcConfig(parseGcConfigShowToml(cli.stdout), cityPath);
          return expandedCliConfig;
        };

        const cliConfig = loadExpandedCliConfig();
        if (!cachedCityName && cliConfig?.workspace.name?.trim()) {
          cachedCityName = cliConfig.workspace.name.trim();
        }
        const cityName = await resolveGcCityName();
        const remote = await fetchJson<GcConfigResult>(
          buildScopedOrLegacyPath(cityName, "/config", "/v0/config"),
        ).catch((error: unknown) => {
          logGcWarning("gc config api fetch failed; using cli fallback", {
            baseUrl,
            cityName,
            cityPath,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
        const lifecycle =
          (await readGcLifecycleStatusFromSupervisorApi({ baseUrl, cityName, cityPath })) ??
          readGcLifecycleStatus({ binaryPath: gcCliBinary, cityPath, supervisorBaseUrl: baseUrl });
        if (remote) {
          const normalizedRemote =
            cityPath && cityPath.trim().length > 0 ? normalizeGcConfig(remote, cityPath) : null;
          lastKnownConfig =
            normalizedRemote && cityPath
              ? withLifecycleStatus(mergeCliExpandedConfig(normalizedRemote, cliConfig), lifecycle)
              : withLifecycleStatus(normalizedRemote ?? remote, lifecycle);
          cachedCityName = lastKnownConfig.workspace.name?.trim() || cachedCityName;
          return lastKnownConfig;
        }
        if (cliConfig) {
          lastKnownConfig = withLifecycleStatus(cliConfig, lifecycle);
          cachedCityName = lastKnownConfig.workspace.name?.trim() || cachedCityName;
          return lastKnownConfig;
        }
        return lastKnownConfig ? withLifecycleStatus(lastKnownConfig, lifecycle) : null;
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

  const start: GcApiClientShape["start"] = Effect.try({
    try: () => {
      const runtime = ensurePackagedGcRuntime({
        runtimeHome,
        cityPath,
        binaryPath: gcCliBinary,
      });
      const result = spawnSync(runtime.binaryPath, ["--city", runtime.cityPath, "start"], {
        cwd: path.dirname(runtime.cityPath),
        env: withPackagedGcRuntimeEnv(
          {
            ...process.env,
            GC_HOME: runtimeHome,
            T3CODE_GASCITY_HOME: runtimeHome,
            T3CODE_WORKTREES_DIR: serverConfig.worktreesDir,
            GC_WORKTREES_DIR: serverConfig.worktreesDir,
            GC_CITY_PATH: runtime.cityPath,
            GC_BEADS_BACKEND: "doltlite",
            GC_BIN: runtime.binaryPath,
            BD_BIN: runtime.bdBinaryPath,
            GC_API_URL: baseUrl,
          },
          path.dirname(runtime.binaryPath),
        ),
        encoding: "utf8",
        timeout: GC_START_TIMEOUT_MS,
      });
      if (result.error) {
        throw result.error;
      }
      if ((result.status ?? 0) !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || "Gas City start failed.");
      }
      lastKnownConfig = null;
      cachedCityName = null;
    },
    catch: (error) =>
      new GcApiClientStartError(error instanceof Error ? error.message : String(error)),
  });

  const runPackagedGcLifecycleCommandInBackground = (args: string[]): void => {
    const runtime = ensurePackagedGcRuntime({
      runtimeHome,
      cityPath,
      binaryPath: gcCliBinary,
    });
    const child = spawn(runtime.binaryPath, ["--city", runtime.cityPath, ...args], {
      cwd: path.dirname(runtime.cityPath),
      env: withPackagedGcRuntimeEnv(
        {
          ...process.env,
          GC_HOME: runtimeHome,
          T3CODE_GASCITY_HOME: runtimeHome,
          T3CODE_WORKTREES_DIR: serverConfig.worktreesDir,
          GC_WORKTREES_DIR: serverConfig.worktreesDir,
          GC_CITY_PATH: runtime.cityPath,
          GC_BEADS_BACKEND: "doltlite",
          GC_BIN: runtime.binaryPath,
          BD_BIN: runtime.bdBinaryPath,
          GC_API_URL: baseUrl,
        },
        path.dirname(runtime.binaryPath),
      ),
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    lastKnownConfig = null;
    cachedCityName = null;
  };

  const getLifecycleStatus: GcApiClientShape["getLifecycleStatus"] = () =>
    Effect.tryPromise({
      try: async () => {
        const cityName = await resolveGcCityName();
        return (
          (await readGcLifecycleStatusFromSupervisorApi({ baseUrl, cityName, cityPath })) ??
          readGcLifecycleStatus({ binaryPath: gcCliBinary, cityPath, supervisorBaseUrl: baseUrl })
        );
      },
      catch: (error) =>
        new GcApiClientStartError(error instanceof Error ? error.message : String(error)),
    });

  const setSupervisorRunning: GcApiClientShape["setSupervisorRunning"] = (running) =>
    Effect.try({
      try: () => {
        runPackagedGcLifecycleCommandInBackground(["supervisor", running ? "start" : "stop"]);
      },
      catch: (error) =>
        new GcApiClientStartError(error instanceof Error ? error.message : String(error)),
    });

  const setControllerRunning: GcApiClientShape["setControllerRunning"] = (running) =>
    Effect.try({
      try: () => {
        runPackagedGcLifecycleCommandInBackground([running ? "start" : "stop"]);
      },
      catch: (error) =>
        new GcApiClientStartError(error instanceof Error ? error.message : String(error)),
    });

  const getConfigForAgentMutation = (): GcConfigResult | null => {
    if (lastKnownConfig) {
      return lastKnownConfig;
    }
    if (!cityPath) {
      return null;
    }
    lastKnownConfig = loadExpandedGcConfig(gcCliBinary, cityPath);
    return lastKnownConfig;
  };

  const resolveAgentIdentityForMutation = (
    normalizedName: string,
  ): { readonly dir: string; readonly template: string } | null => {
    const cached = findConfiguredAgentIdentity(lastKnownConfig, normalizedName);
    if (cached) {
      return cached;
    }
    const config = getConfigForAgentMutation();
    return findConfiguredAgentIdentity(config, normalizedName);
  };

  const isRigPackAgentForMutation = (identity: {
    readonly dir: string;
    readonly template: string;
  }): boolean => {
    if (!cityPath || !identity.dir) {
      return false;
    }
    return readRigIncludedAgentNames(cityPath, identity.dir).has(identity.template);
  };

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
          if (!cityPath) {
            throw error;
          }
          const identity =
            resolveAgentIdentityForMutation(normalizedName) ??
            (normalizedName.includes("/")
              ? {
                  dir: normalizedName.slice(0, normalizedName.indexOf("/")),
                  template: normalizedName.slice(normalizedName.indexOf("/") + 1),
                }
              : { dir: "", template: normalizedName });
          if (isRigPackAgentForMutation(identity)) {
            writeRigAgentSuspendedToCityToml(cityPath, normalizedName, suspended);
          } else {
            writeAgentSuspendedToCityToml(cityPath, identity, suspended);
          }
          lastKnownConfig = updateCachedAgentSuspended(lastKnownConfig, normalizedName, suspended);
          return { result: undefined, path: "city.toml" };
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
          const config = getConfigForAgentMutation();
          const currentAgent =
            config?.agents.find((agent) => resolveAgentConfigKey(agent) === normalizedName) ?? null;
          if (typeof currentAgent?.min_active_sessions === "number") {
            if (maxActiveSessions < currentAgent.min_active_sessions) {
              throw new Error(
                `GC pool max ${maxActiveSessions} cannot be lower than min ${currentAgent.min_active_sessions}`,
              );
            }
          }
          if (!cityPath) {
            throw new Error("GC city path unavailable for pool-size mutation");
          }
          const identity = resolveAgentIdentityForMutation(normalizedName);
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
            throw new Error("GC pool minimum must be an integer");
          }
          if (minActiveSessions < 0) {
            throw new Error("GC pool minimum must be greater than or equal to 0");
          }
          const config = getConfigForAgentMutation();
          const currentAgent =
            config?.agents.find((agent) => resolveAgentConfigKey(agent) === normalizedName) ?? null;
          if (typeof currentAgent?.max_active_sessions === "number") {
            if (minActiveSessions > currentAgent.max_active_sessions) {
              throw new Error(
                `GC pool minimum ${minActiveSessions} cannot exceed max ${currentAgent.max_active_sessions}`,
              );
            }
          }
          if (!isPoolAgent(config, normalizedName)) {
            throw new Error(
              `min-session control for non-pool agent ${normalizedName} is not supported`,
            );
          }
          if (!cityPath) {
            throw new Error("GC city path unavailable for min-session mutation");
          }
          const identity = resolveAgentIdentityForMutation(normalizedName);
          if (!identity) {
            throw new Error(`GC agent identity "${normalizedName}" not found in current config`);
          }
          logGcWarning("routing min-session mutation via city.toml", {
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
        if (wakeMode !== "resume" && wakeMode !== "fresh") {
          throw new Error("GC wake mode must be resume or fresh");
        }
        if (!cityPath) {
          throw new Error("GC city path unavailable for wake-mode mutation");
        }
        const identity = resolveAgentIdentityForMutation(normalizedName);
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
        const config = getConfigForAgentMutation();
        if (isPoolAgent(config, normalizedName)) {
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
        const identity = resolveAgentIdentityForMutation(normalizedName);
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
          const cli = runGcCli(gcCliBinary, cityPath, [suspended ? "suspend" : "resume"]);
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
          if (cityPath) {
            seedRigAgentSuspendedOverrides(gcCliBinary, cityPath, normalizedName, suspended);
          }
          lastKnownConfig = updateCachedRigSuspended(lastKnownConfig, normalizedName, suspended);
          return { result: undefined, path: "gc-api" };
        } catch (error) {
          if (!cityPath) {
            throw error;
          }
          const cli = runGcCli(gcCliBinary, cityPath, ["rig", action, normalizedName]);
          if (cli.exitCode === 0) {
            seedRigAgentSuspendedOverrides(gcCliBinary, cityPath, normalizedName, suspended);
            lastKnownConfig = updateCachedRigSuspended(lastKnownConfig, normalizedName, suspended);
            return { result: undefined, path: "gc-cli" };
          }
          throw new Error(cli.stderr.trim() || cli.stdout.trim() || String(error), {
            cause: error,
          });
        }
      }),
    );

  const addRig: GcApiClientShape["addRig"] = (input) =>
    Effect.promise(async () =>
      runLoggedGcMutation("rig-add", input.name ?? input.path, input, async () => {
        if (!cityPath) {
          throw new Error("GC city path unavailable for rig add");
        }
        const rigPath = input.path.trim();
        if (!rigPath) {
          throw new Error("Rig path is required");
        }
        const args = ["rig", "add", rigPath];
        const name = input.name?.trim();
        const rigName = sanitizeKey(name || path.basename(rigPath));
        if (name) {
          args.push("--name", rigName);
        }
        if (input.includeGastown ?? true) {
          args.push("--include", "packs/gastown");
        }
        if (input.startSuspended ?? true) {
          args.push("--start-suspended");
        }
        const cli = runGcCli(gcCliBinary, cityPath, args);
        if (cli.exitCode !== 0) {
          throw new Error(cli.stderr.trim() || cli.stdout.trim() || "Failed to add GC rig");
        }
        if (input.startSuspended ?? true) {
          seedRigAgentSuspendedOverrides(gcCliBinary, cityPath, rigName, true);
        }
        lastKnownConfig = null;
        return { result: undefined, path: "gc-cli" };
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
    getLifecycleStatus,
    start,
    setSupervisorRunning,
    setControllerRunning,
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
    addRig,
    streamEvents: Stream.fromPubSub(eventPubSub),
    isAvailable,
  } satisfies GcApiClientShape;
});

export const GcApiClientLive = Layer.effect(GcApiClient)(makeGcApiClient);

export const __gcCityTomlPatchForTests = {
  discoverGcCityRoot,
  ensurePackagedGcRuntime,
  findRigIncludesInCityToml,
  updateAgentPatchInCityToml,
  updateRigOverrideSuspended,
};
