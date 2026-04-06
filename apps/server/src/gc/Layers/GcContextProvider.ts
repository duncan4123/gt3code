/**
 * GcContextProviderLive — Resolves full GC context for threads.
 *
 * Reads gc.bead, gc.convoy, gc.formula from thread customMetadata
 * and fetches live data from the GC API in parallel.
 */
import { Effect, Layer } from "effect";
import { GcApiClient } from "../Services/GcApiClient.ts";
import {
  GcContextProvider,
  type GcContextProviderShape,
  type GcThreadContext,
} from "../Services/GcContextProvider.ts";

const makeGcContextProvider = Effect.gen(function* () {
  const gcApi = yield* GcApiClient;

  const getThreadContext: GcContextProviderShape["getThreadContext"] = (metadata) =>
    Effect.gen(function* () {
      const beadId = metadata["gc.bead"];
      const convoyId = metadata["gc.convoy"];
      const formulaName = metadata["gc.formula"];

      const [bead, convoy, formula] = yield* Effect.all(
        [
          beadId ? gcApi.getBead(beadId) : Effect.succeed(null),
          convoyId ? gcApi.getConvoy(convoyId) : Effect.succeed(null),
          formulaName ? gcApi.getFormula(formulaName) : Effect.succeed(null),
        ],
        { concurrency: 3 },
      );

      return { bead, convoy, formula } satisfies GcThreadContext;
    });

  const isAvailable = gcApi.isAvailable;

  return {
    getThreadContext,
    isAvailable,
  } satisfies GcContextProviderShape;
});

export const GcContextProviderLive = Layer.effect(GcContextProvider, makeGcContextProvider);
