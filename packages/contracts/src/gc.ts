/**
 * Gas City integration contracts.
 *
 * These schemas define the wire format for gc.* customMetadata keys on
 * OrchestrationThread, and the activity kinds dispatched by the t3bridge
 * provider via thread.activity.append.
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Activity kinds
// ---------------------------------------------------------------------------

/** Activity kinds the GC t3bridge provider dispatches. */
export const GcActivityKind = Schema.Literals([
  "gc.bead.claimed",
  "gc.bead.closed",
  "gc.session.started",
  "gc.session.reused",
  "gc.merge.completed",
]);
export type GcActivityKind = typeof GcActivityKind.Type;

// ---------------------------------------------------------------------------
// Thread context schemas
// ---------------------------------------------------------------------------

/** Summary of a GC bead (issue/task) linked to an OrchestrationThread. */
export const GcBeadSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  type: Schema.String,
  assignee: Schema.optional(Schema.String),
});
export type GcBeadSummary = typeof GcBeadSummary.Type;

/** Status of the convoy this thread belongs to. */
export const GcConvoyStatus = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  closedCount: Schema.Number,
  totalCount: Schema.Number,
});
export type GcConvoyStatus = typeof GcConvoyStatus.Type;

/** Full GC context for an OrchestrationThread, parsed from gc.* customMetadata. */
export const GcThreadContext = Schema.Struct({
  bead: Schema.NullOr(GcBeadSummary),
  convoy: Schema.NullOr(GcConvoyStatus),
  formula: Schema.NullOr(Schema.String),
});
export type GcThreadContext = typeof GcThreadContext.Type;
