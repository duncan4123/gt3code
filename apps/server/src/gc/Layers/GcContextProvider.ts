/**
 * GcContextProviderLive — Resolves full GC context for threads.
 *
 * @module GcContextProviderLive
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
      // Also try to derive formula from the bead title (e.g., "mol-deacon-patrol")
      const beadTitle = metadata["gc.beadTitle"];
      const effectiveFormulaName = formulaName ?? beadTitle;
      const agentName = metadata["gc.agent"];

      const [bead, convoy, formula, session] = yield* Effect.all(
        [
          beadId ? gcApi.getBead(beadId) : Effect.succeed(null),
          convoyId ? gcApi.getConvoy(convoyId) : Effect.succeed(null),
          effectiveFormulaName ? gcApi.getFormula(effectiveFormulaName) : Effect.succeed(null),
          agentName ? gcApi.getSession(agentName) : Effect.succeed(null),
        ],
        { concurrency: 4 },
      );

      return { bead, convoy, formula, session } satisfies GcThreadContext;
    });

  const isAvailable = gcApi.isAvailable;

  return {
    getThreadContext,
    isAvailable,
  } satisfies GcContextProviderShape;
});

export const GcContextProviderLive = Layer.effect(GcContextProvider, makeGcContextProvider);
