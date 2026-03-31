/**
 * GcEventIngestionLive — Placeholder service for future server-side GC event ingestion.
 *
 * The native GC t3bridge provider already appends GC activities into T3, so
 * enabling a second ingestion path here would be redundant and risks
 * double-reporting.
 */
import { Effect, Layer } from "effect";

import { GcEventIngestion, type GcEventIngestionShape } from "../Services/GcEventIngestion.ts";
const makeGcEventIngestion = Effect.succeed({
  isRunning: Effect.succeed(false),
} satisfies GcEventIngestionShape);

export const GcEventIngestionLive = Layer.effect(GcEventIngestion, makeGcEventIngestion);
