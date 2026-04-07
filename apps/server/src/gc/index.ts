/**
 * GC integration barrel — re-exports the GcApiClient service and live layer.
 *
 * Other tasks in the convoy will extend this index as they add
 * GcConvoySync, GcEventIngestion, and GcContextProvider.
 */
export { GcApiClient, type GcApiClientShape } from "./Services/GcApiClient.ts";
export type {
  GcBead,
  GcConvoy,
  GcFormula,
  GcFormulaStep,
  GcEvent,
} from "./Services/GcApiClient.ts";
export { GcApiClientLive } from "./Layers/GcApiClient.ts";
