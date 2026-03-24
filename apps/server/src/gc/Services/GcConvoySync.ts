/**
 * GcConvoySync — Service that watches GC events and reconciles
 * bead + convoy metadata on T3 threads.
 *
 * Keeps thread metadata in sync with the GC API regardless of
 * whether the originating GC session's bash watcher is alive.
 *
 * @module GcConvoySync
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface GcConvoySyncShape {
  /** Whether the sync fiber is running. */
  readonly isRunning: Effect.Effect<boolean>;
}

export class GcConvoySync extends ServiceMap.Service<GcConvoySync, GcConvoySyncShape>()(
  "t3/gc/Services/GcConvoySync",
) {}
