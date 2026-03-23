/**
 * GcApiClientLive — Effect layer implementing the GcApiClient service.
 *
 * Connects to the Gas City REST API at the configured URL and provides
 * typed access to beads, convoys, formulas, and the SSE event stream.
 *
 * @module GcApiClientLive
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

const GC_API_DEFAULT_URL = "http://localhost:8372";

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const makeGcApiClient = Effect.gen(function* () {
  const baseUrl = yield* Config.string("GC_API_URL").pipe(
    Config.option,
    Config.map(Option.getOrElse(() => GC_API_DEFAULT_URL)),
  );

  const eventPubSub = yield* PubSub.unbounded<GcEvent>();

  // SSE connection to /v0/events/stream — reconnects on failure.
  const connectSse = Effect.async<never, never, never>((emit) => {
    let aborted = false;
    const connect = () => {
      if (aborted) return;
      const controller = new AbortController();
      fetch(`${baseUrl}/v0/events/stream`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok || !response.body) {
            // Retry after delay
            setTimeout(connect, 5000);
            return;
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data) {
                  const event = parseJsonSafe<GcEvent>(data);
                  if (event) {
                    Effect.runFork(PubSub.publish(eventPubSub, event));
                  }
                }
              }
            }
          }
          // Connection closed — reconnect
          if (!aborted) setTimeout(connect, 2000);
        })
        .catch(() => {
          // Connection failed — retry
          if (!aborted) setTimeout(connect, 5000);
        });
      return controller;
    };
    const ctrl = connect();
    return Effect.sync(() => {
      aborted = true;
      ctrl?.abort();
    });
  });

  // Start SSE in a background fiber
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

  interface RawApiBead {
    id: string;
    title: string;
    description: string;
    status: string;
    type: string;
    priority?: number;
    assignee?: string;
    labels?: string[];
    ephemeral?: boolean;
    created_at: string;
    updated_at?: string;
  }

  function normalizeBeadResponse(raw: RawApiBead): GcBead {
    return {
      id: raw.id,
      title: raw.title,
      description: raw.description,
      status: raw.status,
      priority: raw.priority ?? 0,
      issueType: raw.type,
      assignee: raw.assignee,
      labels: raw.labels,
      ephemeral: raw.ephemeral,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at ?? raw.created_at,
    };
  }

  interface RawApiConvoy {
    convoy: { id: string; title: string; status: string };
    children: Array<{ id: string; title: string; status: string }>;
    progress: { closed: number; total: number };
  }

  function normalizeConvoyResponse(raw: RawApiConvoy): GcConvoy {
    return {
      id: raw.convoy.id,
      title: raw.convoy.title,
      status: raw.convoy.status,
      children: raw.children.map((c) => ({ id: c.id, title: c.title, status: c.status })),
      closedCount: raw.progress.closed,
      totalCount: raw.progress.total,
    };
  }

  const getBead: GcApiClientShape["getBead"] = (id) =>
    Effect.tryPromise({
      try: async () => {
        const raw = await fetchJson<RawApiBead>(`/v0/bead/${id}`);
        return raw ? normalizeBeadResponse(raw) : null;
      },
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));

  const getConvoy: GcApiClientShape["getConvoy"] = (id) =>
    Effect.tryPromise({
      try: async () => {
        const raw = await fetchJson<RawApiConvoy>(`/v0/convoy/${id}`);
        return raw?.convoy ? normalizeConvoyResponse(raw) : null;
      },
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));

  const getFormula: GcApiClientShape["getFormula"] = (name) =>
    Effect.tryPromise({
      try: async () => {
        // The GC API doesn't have a formula endpoint yet.
        // Fall back to running bd formula show if available.
        const { execSync } = await import("child_process");
        try {
          const output = execSync(
            `BEADS_DOLT_PORT=${process.env.GC_DOLT_PORT ?? ""} bd formula show ${name} --json`,
            { timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
          );
          return parseJsonSafe<GcFormula>(output);
        } catch {
          return null;
        }
      },
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));

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

export const GcApiClientLive = Layer.scoped(GcApiClient, makeGcApiClient);
