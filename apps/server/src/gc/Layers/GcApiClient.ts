/**
 * GcApiClientLive — Effect layer implementing the GcApiClient service.
 *
 * Connects to the Gas City REST API (default port 9443) and provides
 * typed access to beads, convoys, formulas, and the SSE event stream.
 *
 * Source of truth: gascity/internal/api/ handlers
 */
import { Effect, Layer, Stream, PubSub, Config, Option } from "effect";
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

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
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

const makeGcApiClient = Effect.gen(function* () {
  const baseUrl = yield* Config.string("GC_API_URL").pipe(
    Config.option,
    Config.map(Option.getOrElse(() => GC_API_DEFAULT_URL)),
  );

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
      const response = await fetch(`${baseUrl}${path}`);
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
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

  const isAvailable: GcApiClientShape["isAvailable"] = Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${baseUrl}/health`);
      return response.ok;
    },
    catch: () => false,
  }).pipe(Effect.orElseSucceed(() => false));

  return {
    getBead,
    getConvoy,
    getFormula,
    streamEvents: Stream.fromPubSub(eventPubSub),
    isAvailable,
  } satisfies GcApiClientShape;
});

export const GcApiClientLive = Layer.effect(GcApiClient)(makeGcApiClient);
