/**
 * GcEventIngestion — Service that subscribes to the GC SSE event stream
 * and maps GC events to T3 orchestration thread activities.
 *
 * @module GcEventIngestion
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface GcEventIngestionShape {
  /** Whether the ingestion fiber is running. */
  readonly isRunning: Effect.Effect<boolean>;
}

export class GcEventIngestion extends ServiceMap.Service<GcEventIngestion, GcEventIngestionShape>()(
  "t3/gc/Services/GcEventIngestion",
) {}
