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
  GcLifecycleStatus,
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

function parseTomlScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((entry) => parseTomlScalar(entry))
      .filter((entry): entry is string => typeof entry === "string");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  const numberValue = Number(trimmed);
  return Number.isFinite(numberValue) ? numberValue : trimmed;
}

function parseGcTomlConfig(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;

  const tableFor = (parts: readonly string[]): Record<string, unknown> | null => {
    let table = root;
    for (const part of parts) {
      const existing = table[part];
      if (Array.isArray(existing)) {
        return null;
      }
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        table = existing as Record<string, unknown>;
        continue;
      }
      const next: Record<string, unknown> = {};
      table[part] = next;
      table = next;
    }
    return table;
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;

    const arrayMatch = line.match(/^\[\[([^\]]+)]]$/);
    if (arrayMatch) {
      const parts = arrayMatch[1]!.split(".").map((part) => part.trim());
      if (parts.length > 1) {
        current = {};
        continue;
      }
      const parent = tableFor(parts.slice(0, -1));
      if (!parent) {
        current = {};
        continue;
      }
      const key = parts.at(-1)!;
      const items = Array.isArray(parent[key]) ? (parent[key] as Record<string, unknown>[]) : [];
      const item: Record<string, unknown> = {};
      items.push(item);
      parent[key] = items;
      current = item;
      continue;
    }

    const tableMatch = line.match(/^\[([^\]]+)]$/);
    if (tableMatch) {
      current = tableFor(tableMatch[1]!.split(".").map((part) => part.trim())) ?? {};
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    current[key] = parseTomlScalar(value);
  }

  return root;
}

function escapePathSegments(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function discoverRepoRootFromCityPath(cityPath: string): string | null {
  let current = path.resolve(cityPath);
  for (;;) {
    if (
      existsSync(path.join(current, "package.json")) &&
      existsSync(path.join(current, "packages"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function discoverBundledGcCityRoots(startCwd: string): readonly string[] {
  const repoRoot = discoverRepoRootFromCityPath(startCwd);
  if (!repoRoot) {
    return [];
  }

  const citiesDir = path.join(repoRoot, "packages", "gascity-config", "config", "cities");
  if (!existsSync(citiesDir)) {
    return [];
  }

  return readdirSync(citiesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(citiesDir, entry.name))
    .filter((candidate) => existsSync(path.join(candidate, "city.toml")))
    .toSorted((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

function isRepositoryRoot(candidatePath: string): boolean {
  if (!candidatePath) {
    return false;
  }
  return (
    existsSync(path.join(candidatePath, ".git")) || existsSync(path.join(candidatePath, ".jj"))
  );
}

function loadSiteRigPathBindings(cityPath: string): ReadonlyMap<string, string> {
  const sitePath = path.join(cityPath, ".gc", "site.toml");
  if (!existsSync(sitePath)) {
    return new Map();
  }

  const parsed = parseGcTomlConfig(readFileSync(sitePath, "utf8"));
  const rigValues = Array.isArray(parsed.rig)
    ? parsed.rig
    : Array.isArray(parsed.rigs)
      ? parsed.rigs
      : [];
  return new Map(
    rigValues.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }
      const rig = value as Record<string, unknown>;
      const name = typeof rig.name === "string" ? rig.name.trim() : "";
      const rigPath = typeof rig.path === "string" ? rig.path.trim() : "";
      if (!name || !rigPath) {
        return [];
      }
      return [[name, path.isAbsolute(rigPath) ? rigPath : path.resolve(cityPath, rigPath)]];
    }),
  );
}

function resolveConfiguredRigPath(rig: Record<string, unknown>, cityPath: string): string | null {
  const explicitPath = typeof rig.path === "string" ? rig.path.trim() : "";
  if (explicitPath) {
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(cityPath, explicitPath);
  }

  const name = typeof rig.name === "string" ? rig.name.trim() : "";
  if (!name) {
    return null;
  }

  return loadSiteRigPathBindings(cityPath).get(name) ?? null;
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
    if (typeof rig.name !== "string" || rig.name.trim().length === 0) {
      return [];
    }
    const rigPath = resolveConfiguredRigPath(rig, cityPath) ?? "";
    return [
      {
        name: rig.name.trim(),
        path: rigPath,
        ...(typeof rig.prefix === "string" ? { prefix: rig.prefix } : {}),
        suspended: Boolean(rig.suspended),
        isRepository: isRepositoryRoot(rigPath),
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
      path: cityPath,
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

interface GcSupervisorCity {
  readonly name: string;
  readonly path: string;
  readonly running: boolean;
}

function normalizeSupervisorCities(raw: unknown): readonly GcSupervisorCity[] {
  const candidate =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "body" in raw &&
    (raw as { body?: unknown }).body !== undefined
      ? (raw as { body: unknown }).body
      : raw &&
          typeof raw === "object" &&
          !Array.isArray(raw) &&
          "Body" in raw &&
          (raw as { Body?: unknown }).Body !== undefined
        ? (raw as { Body: unknown }).Body
        : raw;
  const items =
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    Array.isArray((candidate as { items?: unknown }).items)
      ? (candidate as { items: unknown[] }).items
      : [];

  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const cityPath = typeof record.path === "string" ? record.path.trim() : "";
    if (!name || !cityPath) {
      return [];
    }
    return [{ name, path: cityPath, running: Boolean(record.running) }];
  });
}

function prefixGcConfigForCity(config: GcConfigResult, city: GcSupervisorCity): GcConfigResult {
  const cityRigNames = new Set(config.rigs.map((rig) => rig.name));
  return {
    ...config,
    workspace: {
      ...config.workspace,
      name: city.name,
      path: city.path,
    },
    rigs: [
      {
        name: city.name,
        path: city.path,
        suspended: config.workspace.suspended,
        isRepository: isRepositoryRoot(city.path),
        ...(config.lifecycle ? { lifecycle: config.lifecycle } : {}),
      },
      ...config.rigs.map((rig) => ({
        ...rig,
        name: `${city.name}/${rig.name}`,
      })),
    ],
    agents: config.agents.map((agent) => {
      const dir =
        typeof agent.dir === "string" && agent.dir.trim().length > 0 ? agent.dir.trim() : "";
      const cityDir = dir ? `${city.name}/${dir}` : city.name;
      const name = agent.name.includes("/")
        ? (agent.name.split("/").at(-1) ?? agent.name)
        : agent.name;
      return {
        ...agent,
        name,
        dir: cityDir,
        scope: agent.scope ?? (cityRigNames.has(dir) ? "rig" : "city"),
      };
    }),
  };
}

function mergeMultiCityConfig(configs: readonly GcConfigResult[]): GcConfigResult | null {
  if (configs.length === 0) {
    return null;
  }
  const firstLifecycle = configs.find((config) => config.lifecycle)?.lifecycle;
  return {
    workspace: {
      name: "cities",
      path: path.dirname(configs[0]?.workspace.path ?? ""),
      suspended: configs.every((config) => config.workspace.suspended),
    },
    rigs: configs.flatMap((config) => config.rigs),
    agents: configs.flatMap((config) => config.agents),
    ...(configs[0]?.providers ? { providers: configs[0].providers } : {}),
    lifecycle: {
      supervisorRunning: configs.some((config) => config.lifecycle?.supervisorRunning),
      controllerRunning: configs.some((config) => config.lifecycle?.controllerRunning),
      ...(typeof firstLifecycle?.supervisorPort === "number"
        ? { supervisorPort: firstLifecycle.supervisorPort }
        : {}),
      ...(firstLifecycle?.supervisorUrl ? { supervisorUrl: firstLifecycle.supervisorUrl } : {}),
    },
  };
}

function withLifecycleStatus(config: GcConfigResult, lifecycle: GcLifecycleStatus): GcConfigResult {
  return {
    ...config,
    lifecycle,
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

function localizeAgentIdentityForCity(
  identity: { readonly dir: string; readonly template: string },
  cityName: string | null,
): { readonly dir: string; readonly template: string } {
  const normalizedCityName = cityName?.trim();
  if (!normalizedCityName) {
    return identity;
  }
  if (identity.dir === normalizedCityName) {
    return { ...identity, dir: "" };
  }
  const cityPrefix = `${normalizedCityName}/`;
  return identity.dir.startsWith(cityPrefix)
    ? { ...identity, dir: identity.dir.slice(cityPrefix.length) }
    : identity;
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
  const resolvedStart = path.resolve(startCwd);
  const registryPaths = gcRegistryPaths();

  for (const registryPath of registryPaths) {
    if (!existsSync(registryPath)) {
      continue;
    }
    const match = findRegisteredGcCityRootInRegistry(registryPath, resolvedStart);
    if (match) {
      return match;
    }
  }

  return null;
}

function gcRegistryPaths(): ReadonlyArray<string> {
  const configuredHome = process.env.GC_HOME?.trim() || process.env.T3CODE_GASCITY_HOME?.trim();
  if (configuredHome) {
    return [path.join(configuredHome, "cities.toml")];
  }
  return [];
}

function findRegisteredGcCityRootInRegistry(
  registryPath: string,
  resolvedStart: string,
): string | null {
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
    readonly suspended?: boolean;
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
      if (patch.suspended !== undefined) {
        replaceOrInsertSuspendedLine(lines, index + 1, blockEnd, patch.suspended);
      }
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
    ...(patch.suspended !== undefined ? [`suspended = ${patch.suspended ? "true" : "false"}`] : []),
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
  const expandedRigByName = new Map(expanded.rigs.map((rig) => [rig.name, rig] as const));
  return {
    ...primary,
    rigs: primary.rigs.map((rig) => {
      const expandedRig = expandedRigByName.get(rig.name);
      if (!expandedRig) {
        return rig;
      }
      return {
        ...rig,
        path: expandedRig.path,
        ...(expandedRig.prefix ? { prefix: expandedRig.prefix } : {}),
        suspended: expandedRig.suspended,
        ...(expandedRig.isRepository !== undefined
          ? { isRepository: expandedRig.isRepository }
          : {}),
      };
    }),
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
  const configured = process.env.GC_BIN?.trim();
  if (configured) {
    return configured;
  }

  const cwd = process.cwd();
  const bundledRuntime = path.join(cwd, ".t3-dev", "gascity", "bin", "gc");
  if (existsSync(bundledRuntime)) {
    return bundledRuntime;
  }

  const packageBinary = path.join(
    cwd,
    "packages",
    "gascity",
    "bin",
    `${process.platform}-${process.arch}`,
    "gc",
  );
  if (existsSync(packageBinary)) {
    return packageBinary;
  }

  return "gc";
}

function runGcCli(
  cityPath: string,
  args: string[],
): { readonly stdout: string; readonly stderr: string; readonly exitCode: number } {
  const cwd = process.cwd();
  const managedGcHome =
    process.env.T3CODE_GASCITY_HOME?.trim() || path.join(cwd, ".t3-dev", "gascity");
  const gcApiUrl = discoverGcApiBaseUrl(cwd) ?? process.env.GC_API_URL;
  const result = spawnSync(resolveGcCliBinary(), ["--city", cityPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GC_HOME: managedGcHome,
      T3CODE_GASCITY_HOME: managedGcHome,
      ...(gcApiUrl ? { GC_API_URL: gcApiUrl } : {}),
    },
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
    if (workspaceName && workspaceName !== "cities") {
      cachedCityName = workspaceName;
      return cachedCityName;
    }

    const cities = await fetchJson<unknown>("/v0/cities");
    cachedCityName = resolveGcCityNameFromSupervisorCities({
      raw: cities,
      cityPath,
      preferredName: workspaceName ?? null,
    });
    if (cachedCityName) {
      return cachedCityName;
    }

    const cityPathName = cityPath ? path.basename(cityPath).trim() : "";
    if (cityPathName) {
      cachedCityName = cityPathName;
      return cachedCityName;
    }

    return cachedCityName;
  };

  const resolveConfiguredCityRoot = (
    name: string,
  ): {
    readonly cityName: string;
    readonly cityPath: string | null;
  } | null => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return null;
    }

    const configuredCity = lastKnownConfig?.rigs.find(
      (rig) => rig.name === trimmedName && rig.path && isGcCityRoot(rig.path),
    );
    if (configuredCity) {
      return {
        cityName: trimmedName,
        cityPath: configuredCity.path,
      };
    }

    const bundledCityRoot = cityPath
      ? discoverBundledGcCityRoots(cityPath).find(
          (candidate) => path.basename(candidate) === trimmedName,
        )
      : null;
    return bundledCityRoot
      ? {
          cityName: trimmedName,
          cityPath: bundledCityRoot,
        }
      : null;
  };

  const resolveAgentMutationTarget = async (
    normalizedName: string,
  ): Promise<{
    readonly cityName: string | null;
    readonly cityPath: string | null;
    readonly localName: string;
  }> => {
    const [firstSegment, ...remainingSegments] = normalizedName.split("/");
    if (firstSegment && remainingSegments.length > 0) {
      const cities = await fetchSupervisorCities();
      const matchedCity = cities.find((city) => city.name === firstSegment);
      if (matchedCity) {
        return {
          cityName: matchedCity.name,
          cityPath: matchedCity.path,
          localName: remainingSegments.join("/"),
        };
      }
      const configuredCity = resolveConfiguredCityRoot(firstSegment);
      if (configuredCity) {
        return {
          cityName: configuredCity.cityName,
          cityPath: configuredCity.cityPath,
          localName: remainingSegments.join("/"),
        };
      }
    }

    return {
      cityName: await resolveGcCityName(),
      cityPath,
      localName: normalizedName,
    };
  };

  const resolveRigMutationTarget = async (
    normalizedName: string,
  ): Promise<{
    readonly cityName: string | null;
    readonly cityPath: string | null;
    readonly localName: string;
  }> => {
    const [firstSegment, ...remainingSegments] = normalizedName.split("/");
    if (firstSegment && remainingSegments.length > 0) {
      const cities = await fetchSupervisorCities();
      const matchedCity = cities.find((city) => city.name === firstSegment);
      if (matchedCity) {
        return {
          cityName: matchedCity.name,
          cityPath: matchedCity.path,
          localName: remainingSegments.join("/"),
        };
      }
      const configuredCity = resolveConfiguredCityRoot(firstSegment);
      if (configuredCity) {
        return {
          cityName: configuredCity.cityName,
          cityPath: configuredCity.cityPath,
          localName: remainingSegments.join("/"),
        };
      }
    }

    return {
      cityName: await resolveGcCityName(),
      cityPath,
      localName: normalizedName,
    };
  };

  const requireGcCityName = async (): Promise<string> => {
    const cityName = await resolveGcCityName();
    if (!cityName) {
      throw new Error("GC city name unavailable");
    }
    return cityName;
  };

  const resolveCityLifecycleTarget = async (
    requestedCityName: string | undefined,
  ): Promise<{
    readonly cityName: string;
    readonly cityPath: string;
  }> => {
    const normalizedCityName = requestedCityName?.trim();
    if (normalizedCityName) {
      const configuredCity = resolveConfiguredCityRoot(normalizedCityName);
      if (configuredCity?.cityPath) {
        return {
          cityName: configuredCity.cityName,
          cityPath: configuredCity.cityPath,
        };
      }

      const supervisorCity = (await fetchSupervisorCities()).find(
        (city) => city.name === normalizedCityName,
      );
      if (supervisorCity?.path) {
        return {
          cityName: supervisorCity.name,
          cityPath: supervisorCity.path,
        };
      }

      throw new Error(`GC city "${normalizedCityName}" not found in current config`);
    }

    const inferredCityName = await requireGcCityName();
    if (cityPath) {
      return {
        cityName: inferredCityName,
        cityPath,
      };
    }

    const configuredCity = resolveConfiguredCityRoot(inferredCityName);
    if (configuredCity?.cityPath) {
      return {
        cityName: configuredCity.cityName,
        cityPath: configuredCity.cityPath,
      };
    }

    throw new Error(`GC city path unavailable for "${inferredCityName}"`);
  };

  const resolveSessionMutationTarget = async (
    normalizedSessionName: string,
  ): Promise<{
    readonly cityName: string | null;
    readonly localName: string;
  }> => {
    const cities = await fetchSupervisorCities().catch(() => []);
    const cityNames = new Set(cities.map((city) => city.name));
    for (const rig of lastKnownConfig?.rigs ?? []) {
      if (rig.path && isGcCityRoot(rig.path)) {
        cityNames.add(rig.name);
      }
    }
    for (const cityName of cityNames) {
      const sessionPrefix = `${cityName}--`;
      if (normalizedSessionName.startsWith(sessionPrefix)) {
        return {
          cityName,
          localName: normalizedSessionName.slice(sessionPrefix.length),
        };
      }
    }
    const rigMatches: Array<{ readonly cityName: string; readonly localName: string }> = [];
    for (const rig of lastKnownConfig?.rigs ?? []) {
      const rigName = rig.name.trim();
      if (!rigName || (rig.path && isGcCityRoot(rig.path))) {
        continue;
      }
      const [citySegment, ...rigSegments] = rigName.split("/").filter(Boolean);
      const localRigName = rigSegments.length > 0 ? rigSegments.join("/") : rigName;
      if (!localRigName || !normalizedSessionName.startsWith(`${localRigName}--`)) {
        continue;
      }
      if (rigSegments.length > 0 && citySegment) {
        rigMatches.push({
          cityName: citySegment,
          localName: normalizedSessionName,
        });
      } else {
        rigMatches.push({
          cityName: await resolveGcCityName(),
          localName: normalizedSessionName,
        });
      }
    }
    if (rigMatches.length === 1) {
      return rigMatches[0];
    }
    return {
      cityName: await resolveGcCityName(),
      localName: normalizedSessionName,
    };
  };

  const buildScopedOrLegacyPath = (
    cityName: string | null,
    cityScopedPath: string,
    legacyPath: string,
  ): string =>
    cityName && useCityScopedRoutes ? buildGcCityPath(cityName, cityScopedPath) : legacyPath;

  const fetchSupervisorCities = async (): Promise<readonly GcSupervisorCity[]> => {
    const raw = await fetchJson<unknown>("/v0/cities");
    return normalizeSupervisorCities(raw);
  };

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
        const loadLocalCityTomlConfig = (targetCityPath: string): GcConfigResult | null => {
          const cityTomlPath = path.join(targetCityPath, "city.toml");
          if (!existsSync(cityTomlPath)) {
            return null;
          }
          return normalizeGcConfig(
            parseGcTomlConfig(readFileSync(cityTomlPath, "utf8")),
            targetCityPath,
          );
        };

        const loadExpandedCliConfig = (targetCityPath: string): GcConfigResult | null => {
          const cli = runGcCli(targetCityPath, ["config", "show"]);
          if (cli.exitCode !== 0) {
            logGcWarning("gc config show fallback failed", {
              cityPath: targetCityPath,
              exitCode: cli.exitCode,
              stderr: cli.stderr,
            });
            return null;
          }
          return normalizeGcConfig(parseGcTomlConfig(cli.stdout), targetCityPath);
        };

        const loadBundledCityConfigs = (
          supervisorCities: readonly GcSupervisorCity[],
        ): GcConfigResult[] => {
          const supervisorCityByPath = new Map(
            supervisorCities.map((city) => [path.resolve(city.path), city] as const),
          );
          const supervisorCityByName = new Map(
            supervisorCities.map((city) => [city.name, city] as const),
          );
          const cityRoots = discoverBundledGcCityRoots(process.cwd());
          return cityRoots.flatMap((targetCityPath) => {
            const expanded = loadExpandedCliConfig(targetCityPath);
            const local = expanded ?? loadLocalCityTomlConfig(targetCityPath);
            if (!local) {
              return [];
            }
            const fallbackCityName = path.basename(targetCityPath);
            const supervisorCity =
              supervisorCityByPath.get(path.resolve(targetCityPath)) ??
              supervisorCityByName.get(fallbackCityName);
            return [
              prefixGcConfigForCity(
                withLifecycleStatus(local, {
                  supervisorRunning: supervisorCities.length > 0,
                  controllerRunning: supervisorCity?.running ?? false,
                }),
                {
                  name: supervisorCity?.name ?? fallbackCityName,
                  path: targetCityPath,
                  running: supervisorCity?.running ?? false,
                },
              ),
            ];
          });
        };

        const supervisorCities = await fetchSupervisorCities().catch(() => []);
        const bundledMergedConfig = mergeMultiCityConfig(loadBundledCityConfigs(supervisorCities));
        if (bundledMergedConfig) {
          lastKnownConfig = bundledMergedConfig;
          cachedCityName = null;
          return bundledMergedConfig;
        }

        if (supervisorCities.length > 1) {
          const cityConfigs = await Promise.all(
            supervisorCities.map(async (city) => {
              const remote = await fetchJson<GcConfigResult>(
                buildGcCityPath(city.name, "/config"),
              ).catch((error: unknown) => {
                logGcWarning("gc city config api fetch failed", {
                  baseUrl,
                  cityName: city.name,
                  cityPath: city.path,
                  error: error instanceof Error ? error.message : String(error),
                });
                return null;
              });
              let normalizedConfig = remote ? normalizeGcConfig(remote, city.path) : null;
              if (!normalizedConfig) {
                const cli = runGcCli(city.path, ["config", "show"]);
                if (cli.exitCode === 0) {
                  normalizedConfig = normalizeGcConfig(parseGcTomlConfig(cli.stdout), city.path);
                } else {
                  logGcWarning("gc city config cli fallback failed", {
                    cityName: city.name,
                    cityPath: city.path,
                    exitCode: cli.exitCode,
                    stderr: cli.stderr,
                  });
                }
              }
              if (!normalizedConfig) {
                return null;
              }
              return prefixGcConfigForCity(
                withLifecycleStatus(normalizedConfig, {
                  supervisorRunning: true,
                  controllerRunning: city.running,
                }),
                city,
              );
            }),
          );
          const merged = mergeMultiCityConfig(
            cityConfigs.filter((config): config is GcConfigResult => Boolean(config)),
          );
          if (merged) {
            lastKnownConfig = merged;
            cachedCityName = null;
            return merged;
          }
        }

        const cityName = await resolveGcCityName();
        const remote = await fetchJson<GcConfigResult>(
          buildScopedOrLegacyPath(cityName, "/config", "/v0/config"),
        );
        if (remote) {
          const normalizedRemote =
            cityPath && cityPath.trim().length > 0 ? normalizeGcConfig(remote, cityPath) : null;
          lastKnownConfig =
            normalizedRemote && cityPath
              ? mergeCliExpandedConfig(normalizedRemote, loadExpandedCliConfig(cityPath))
              : (normalizedRemote ?? remote);
          const workspaceName = lastKnownConfig.workspace.name?.trim();
          if (workspaceName && workspaceName !== "cities") {
            cachedCityName = workspaceName;
          }
          return lastKnownConfig;
        }
        if (cityPath) {
          const parsed = loadExpandedCliConfig(cityPath);
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
      const target = await resolveSessionMutationTarget(normalizedSessionName);
      if (useCityScopedRoutes) {
        const cityName = target.cityName ?? (await requireGcCityName());
        return postJson<GcSubmitSessionResult>(
          buildGcCityPath(cityName, `/session/${encodeURIComponent(target.localName)}/submit`),
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
      const target = await resolveSessionMutationTarget(normalizedSessionName);
      if (useCityScopedRoutes) {
        const cityName = target.cityName ?? (await requireGcCityName());
        return postJson<GcSessionActionResult>(
          buildGcCityPath(cityName, `/session/${encodeURIComponent(target.localName)}/stop`),
        );
      }
      return postJson<GcSessionActionResult>(
        `/v0/session/${escapePathSegments(normalizedSessionName)}/stop`,
      );
    });

  const wakeSession: GcApiClientShape["wakeSession"] = (sessionName) =>
    Effect.promise(async () => {
      const normalizedSessionName = sanitizeKey(sessionName);
      const target = await resolveSessionMutationTarget(normalizedSessionName);
      if (useCityScopedRoutes) {
        const cityName = target.cityName ?? (await requireGcCityName());
        return postJson<GcSessionActionResult>(
          buildGcCityPath(cityName, `/session/${encodeURIComponent(target.localName)}/wake`),
        );
      }
      return postJson<GcSessionActionResult>(
        `/v0/session/${escapePathSegments(normalizedSessionName)}/wake`,
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
        const target = await resolveSessionMutationTarget(normalizedSessionName);
        const cityName = target.cityName ?? (await requireGcCityName());
        return postJson<GcSessionActionResult>(
          buildGcCityPath(cityName, `/session/${encodeURIComponent(target.localName)}/respond`),
          body,
        );
      }
      return postJson<GcSessionActionResult>(
        `/v0/session/${escapePathSegments(normalizedSessionName)}/respond`,
        body,
      );
    });

  const setSupervisorRunning: GcApiClientShape["setSupervisorRunning"] = (
    requestedCityName,
    running,
  ) =>
    Effect.promise(async () =>
      runLoggedGcMutation(
        "supervisor-running",
        requestedCityName?.trim() || "supervisor",
        { running },
        async () => {
          const target = await resolveCityLifecycleTarget(requestedCityName);
          const args = running ? ["supervisor", "start"] : ["supervisor", "stop", "--wait"];
          const cli = runGcCli(target.cityPath, args);
          const alreadyStopped =
            !running && cli.exitCode !== 0 && cli.stderr.includes("supervisor is not running");
          if (cli.exitCode !== 0 && !alreadyStopped) {
            throw new Error(
              cli.stderr.trim() || cli.stdout.trim() || "GC supervisor command failed",
            );
          }
          lastKnownConfig = null;
          return { result: undefined, path: "gc-cli" };
        },
      ),
    );

  const setControllerRunning: GcApiClientShape["setControllerRunning"] = (
    requestedCityName,
    running,
  ) =>
    Effect.promise(async () =>
      runLoggedGcMutation(
        "controller-running",
        requestedCityName?.trim() || "controller",
        { running },
        async () => {
          const target = await resolveCityLifecycleTarget(requestedCityName);
          const cli = runGcCli(target.cityPath, [running ? "start" : "stop"]);
          if (cli.exitCode !== 0) {
            throw new Error(
              cli.stderr.trim() || cli.stdout.trim() || "GC controller command failed",
            );
          }
          lastKnownConfig = null;
          return { result: undefined, path: "gc-cli" };
        },
      ),
    );

  const setAgentSuspended: GcApiClientShape["setAgentSuspended"] = (name, suspended) =>
    Effect.promise(async () =>
      runLoggedGcMutation("agent-suspended", sanitizeKey(name), { suspended }, async () => {
        const normalizedName = sanitizeKey(name);
        const action = suspended ? "suspend" : "resume";
        const target = await resolveAgentMutationTarget(normalizedName);
        try {
          await postMutation(
            target.cityName && useCityScopedRoutes
              ? buildGcAgentActionPath(target.cityName, target.localName, action)
              : `/v0/agent/${escapePathSegments(normalizedName)}/${action}`,
          );
          lastKnownConfig = updateCachedAgentSuspended(lastKnownConfig, normalizedName, suspended);
          return { result: undefined, path: "gc-api" };
        } catch (error) {
          throw error;
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
          const target = await resolveAgentMutationTarget(normalizedName);
          if (!target.cityPath) {
            throw new Error("GC city path unavailable for pool-size mutation");
          }
          const identity = findConfiguredAgentIdentity(lastKnownConfig, normalizedName);
          if (!identity) {
            throw new Error(`GC agent identity "${normalizedName}" not found in current config`);
          }
          logGcWarning("routing pool-size mutation via city.toml", {
            baseUrl,
            cityPath: target.cityPath,
            agent: normalizedName,
            maxActiveSessions,
          });
          writeAgentMaxActiveSessionsToCityToml(
            target.cityPath,
            localizeAgentIdentityForCity(identity, target.cityName),
            maxActiveSessions,
          );
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
          const target = await resolveAgentMutationTarget(normalizedName);
          if (!target.cityPath) {
            throw new Error("GC city path unavailable for min-active mutation");
          }
          const identity = findConfiguredAgentIdentity(lastKnownConfig, normalizedName);
          if (!identity) {
            throw new Error(`GC agent identity "${normalizedName}" not found in current config`);
          }
          logGcWarning("routing min-active mutation via city.toml", {
            baseUrl,
            cityPath: target.cityPath,
            agent: normalizedName,
            minActiveSessions,
          });
          writeAgentMinActiveSessionsToCityToml(
            target.cityPath,
            localizeAgentIdentityForCity(identity, target.cityName),
            minActiveSessions,
          );
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
        const target = await resolveAgentMutationTarget(normalizedName);
        if (!target.cityPath) {
          throw new Error("GC city path unavailable for wake-mode mutation");
        }
        const identity = findConfiguredAgentIdentity(lastKnownConfig, normalizedName);
        if (!identity) {
          throw new Error(`GC agent identity "${normalizedName}" not found in current config`);
        }
        logGcWarning("routing wake-mode mutation via city.toml", {
          baseUrl,
          cityPath: target.cityPath,
          agent: normalizedName,
          wakeMode,
        });
        writeAgentWakeModeToCityToml(
          target.cityPath,
          localizeAgentIdentityForCity(identity, target.cityName),
          wakeMode,
        );
        lastKnownConfig = updateCachedAgentWakeMode(lastKnownConfig, normalizedName, wakeMode);
        return { result: undefined, path: "city.toml" };
      }),
    );

  const setAgentSessionMode: GcApiClientShape["setAgentSessionMode"] = (name, mode) =>
    Effect.promise(async () =>
      runLoggedGcMutation("agent-session-mode", sanitizeKey(name), { mode }, async () => {
        const normalizedName = sanitizeKey(name);
        const target = await resolveAgentMutationTarget(normalizedName);
        if (!target.cityPath) {
          throw new Error("GC city path unavailable for named-session mode mutation");
        }
        if (isPoolAgent(lastKnownConfig, normalizedName)) {
          throw new Error(
            `session-mode toggle for pool agent ${normalizedName} is not supported yet`,
          );
        }
        logGcWarning("routing named-session mode mutation via city.toml", {
          baseUrl,
          cityPath: target.cityPath,
          agent: normalizedName,
          mode,
        });
        const identity = findConfiguredAgentIdentity(lastKnownConfig, normalizedName);
        if (!identity) {
          throw new Error(`GC agent identity "${normalizedName}" not found in current config`);
        }
        writeAgentSessionModeToCityToml(
          target.cityPath,
          localizeAgentIdentityForCity(identity, target.cityName),
          mode,
        );
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
        const target = await resolveRigMutationTarget(normalizedName);
        try {
          await postMutation(
            target.cityName && useCityScopedRoutes
              ? buildGcRigActionPath(target.cityName, target.localName, action)
              : `/v0/rig/${escapePathSegments(target.localName)}/${action}`,
          );
          lastKnownConfig = updateCachedRigSuspended(lastKnownConfig, normalizedName, suspended);
          return { result: undefined, path: "gc-api" };
        } catch (error) {
          if (!target.cityPath) {
            throw error;
          }
          const cli = runGcCli(target.cityPath, ["rig", action, target.localName]);
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
    wakeSession,
    respondToPending,
    setSupervisorRunning,
    setControllerRunning,
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
