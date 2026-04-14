/**
 * GcApiClientLive — Effect layer implementing the GcApiClient service.
 *
 * Connects to the Gas City REST API (default port 9443) and provides
 * typed access to beads, convoys, formulas, and the SSE event stream.
 *
 * Source of truth: gascity/internal/api/ handlers
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Effect, Layer, Stream, PubSub, Config, Option } from "effect";
import type { GcConfigResult } from "@t3tools/contracts";
import {
  GcApiClient,
  type GcApiClientShape,
  type GcBead,
  type GcConvoy,
  type GcFormula,
  type GcEvent,
} from "../Services/GcApiClient.ts";
import { createResourceCache } from "../resourceCache.ts";

const GC_API_DEFAULT_URL = "http://localhost:9443";
const GC_API_REQUEST_TIMEOUT_MS = 8_000;

function logGcWarning(message: string, context: Record<string, unknown>): void {
  console.warn("[gc-api]", message, context);
}

function logGcError(message: string, context: Record<string, unknown>): void {
  console.error("[gc-api]", message, context);
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
  const parentDir = path.dirname(path.resolve(startCwd));
  const preferred = path.join(parentDir, "gc");
  if (isGcCityRoot(preferred)) {
    return preferred;
  }

  try {
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(parentDir, entry.name);
      if (!isGcCityRoot(candidate)) continue;
      if (cityTomlMentionsRigPath(candidate, path.resolve(startCwd))) {
        return candidate;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function discoverGcCityRoot(startCwd: string): string | null {
  const envCityPath = process.env.GC_CITY_PATH ?? process.env.GC_CITY;
  if (envCityPath) {
    const resolved = path.resolve(envCityPath);
    if (isGcCityRoot(resolved)) {
      return resolved;
    }
  }

  return findGcCityRootUpward(startCwd) ?? findSiblingGcCityRoot(startCwd);
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

const makeGcApiClient = Effect.gen(function* () {
  const configuredBaseUrl = yield* Config.string("GC_API_URL").pipe(Config.option);
  const cityPath = discoverGcCityRoot(process.cwd());
  const baseUrl =
    Option.getOrUndefined(configuredBaseUrl) ??
    discoverGcApiBaseUrl(process.cwd()) ??
    GC_API_DEFAULT_URL;

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
      controller = new AbortController();
      fetch(`${baseUrl}/v0/events/stream`, { signal: controller.signal })
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

      let message = `GC API returned ${response.status}`;
      let body: string | null = null;
      try {
        const text = await response.text();
        body = text;
        const payload = parseJsonSafe<{ message?: string; error?: string }>(text);
        message = payload?.message ?? payload?.error ?? message;
      } catch {
        // Ignore malformed or empty error bodies and fall back to the status code.
      }

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

  const getBead: GcApiClientShape["getBead"] = (id) => {
    const beadId = sanitizeKey(id);
    if (!beadId) return Effect.succeed(null);
    return Effect.tryPromise({
      try: () =>
        beadCache.get(beadId, async () => {
          const raw = await fetchJson<RawApiBead>(`/v0/bead/${beadId}`);
          return raw ? normalizeBeadResponse(raw) : null;
        }),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));
  };

  const getConvoy: GcApiClientShape["getConvoy"] = (id) => {
    const convoyId = sanitizeKey(id);
    if (!convoyId) return Effect.succeed(null);
    return Effect.tryPromise({
      try: () =>
        convoyCache.get(convoyId, async () => {
          const raw = await fetchJson<RawApiConvoy>(`/v0/convoy/${convoyId}`);
          return raw?.convoy ? normalizeConvoyResponse(raw) : null;
        }),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));
  };

  const getFormula: GcApiClientShape["getFormula"] = (name) => {
    const formulaName = sanitizeKey(name);
    if (!formulaName) return Effect.succeed(null);
    return Effect.tryPromise({
      try: () =>
        formulaCache.get(formulaName, async () =>
          fetchJson<GcFormula>(`/v0/formulas/${formulaName}`),
        ),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));
  };

  const getConfig: GcApiClientShape["getConfig"] = () =>
    Effect.tryPromise({
      try: () => fetchJson<GcConfigResult>("/v0/config"),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));

  const setAgentSuspended: GcApiClientShape["setAgentSuspended"] = (name, suspended) =>
    Effect.promise(async () => {
      const normalizedName = sanitizeKey(name);
      if (normalizedName.includes("/")) {
        if (!cityPath) {
          throw new Error("GC city path unavailable for rig-scoped agent mutation");
        }
        logGcWarning("routing rig-scoped agent mutation via city.toml", {
          baseUrl,
          cityPath,
          agent: normalizedName,
          suspended,
        });
        writeRigAgentSuspendedToCityToml(cityPath, normalizedName, suspended);
        return;
      }

      const escapedAgentName = escapePathSegments(normalizedName);
      const action = suspended ? "suspend" : "resume";
      await postMutation(`/v0/agent/${escapedAgentName}/${action}`);
    });

  const setRigSuspended: GcApiClientShape["setRigSuspended"] = (name, suspended) =>
    Effect.promise(async () => {
      const normalizedName = sanitizeKey(name);
      const escapedRigName = escapePathSegments(normalizedName);
      const action = suspended ? "suspend" : "resume";
      await postMutation(`/v0/rig/${escapedRigName}/${action}`);
    });

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
    setAgentSuspended,
    setRigSuspended,
    streamEvents: Stream.fromPubSub(eventPubSub),
    isAvailable,
  } satisfies GcApiClientShape;
});

export const GcApiClientLive = Layer.effect(GcApiClient)(makeGcApiClient);
