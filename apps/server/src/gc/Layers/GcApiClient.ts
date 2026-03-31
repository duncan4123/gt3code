/**
 * GcApiClientLive — Lightweight GC API client for thread context lookups.
 *
 * The native GC t3bridge provider already streams GC activity into T3, so this
 * layer is intentionally limited to point lookups used by `gc.getThreadContext`.
 */
import { execFileSync } from "node:child_process";

import { Effect, Layer, Stream } from "effect";

import {
  GcApiClient,
  type GcApiClientShape,
  type GcBead,
  type GcConvoy,
  type GcFormula,
} from "../Services/GcApiClient.ts";

const GC_API_DEFAULT_URL = "http://localhost:9443";

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

async function fetchJson<T>(baseUrl: string, path: string): Promise<T | null> {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function readFormulaFromBd(name: string): GcFormula | null {
  try {
    const output = execFileSync("bd", ["formula", "show", name, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      env: process.env,
    });
    return parseJsonSafe<GcFormula>(output);
  } catch {
    return null;
  }
}

const baseUrl = process.env.GC_API_URL ?? GC_API_DEFAULT_URL;

const getBead: GcApiClientShape["getBead"] = (id) =>
  Effect.tryPromise({
    try: () => fetchJson<GcBead>(baseUrl, `/v0/bead/${id}`),
    catch: () => null,
  }).pipe(Effect.orElseSucceed(() => null));

const getConvoy: GcApiClientShape["getConvoy"] = (id) =>
  Effect.tryPromise({
    try: () => fetchJson<GcConvoy>(baseUrl, `/v0/convoy/${id}`),
    catch: () => null,
  }).pipe(Effect.orElseSucceed(() => null));

const getFormula: GcApiClientShape["getFormula"] = (name) =>
  Effect.sync(() => readFormulaFromBd(name));

const isAvailable: GcApiClientShape["isAvailable"] = Effect.tryPromise({
  try: async () => {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/health`);
    return response.ok;
  },
  catch: () => false,
}).pipe(Effect.orElseSucceed(() => false));

const makeGcApiClient = Effect.succeed({
  getBead,
  getConvoy,
  getFormula,
  streamEvents: Stream.empty,
  isAvailable,
} satisfies GcApiClientShape);

export const GcApiClientLive = Layer.effect(GcApiClient, makeGcApiClient);
