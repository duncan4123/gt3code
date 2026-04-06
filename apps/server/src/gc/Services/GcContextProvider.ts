/**
 * GcContextProvider — Service that provides GC workspace context for threads.
 *
 * Enriches GC-managed threads with live bead data, formula steps,
 * and convoy status from the GC API.
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { GcBead, GcConvoy, GcFormula } from "./GcApiClient.ts";

export interface GcThreadContext {
  readonly bead: GcBead | null;
  readonly convoy: GcConvoy | null;
  readonly formula: GcFormula | null;
}

export interface GcContextProviderShape {
  readonly getThreadContext: (metadata: Record<string, string>) => Effect.Effect<GcThreadContext>;
  readonly isAvailable: Effect.Effect<boolean>;
}

export class GcContextProvider extends ServiceMap.Service<
  GcContextProvider,
  GcContextProviderShape
>()("t3/gc/Services/GcContextProvider") {}
