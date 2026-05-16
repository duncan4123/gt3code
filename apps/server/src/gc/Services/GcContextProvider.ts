import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

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

export class GcContextProvider extends Context.Service<GcContextProvider, GcContextProviderShape>()(
  "t3/gc/Services/GcContextProvider",
) {}
