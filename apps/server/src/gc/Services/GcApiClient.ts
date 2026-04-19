/**
 * GcApiClient — Service interface for Gas City REST API integration.
 *
 * Provides typed access to the GC API for beads, convoys, events,
 * and formula data. Used by the orchestration layer to enrich
 * GC-managed threads with live workspace context.
 *
 * Source of truth for response shapes: gascity/internal/api/handler_convoys.go,
 * gascity/internal/beads/beads.go
 */
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";
import type {
  GcConfigResult,
  GcSessionActionResult,
  GcSubmitSessionResult,
} from "@t3tools/contracts";

export interface GcBead {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly priority: number;
  readonly issueType: string;
  readonly type?: string;
  readonly assignee?: string;
  readonly parentId?: string;
  readonly ref?: string;
  readonly labels?: ReadonlyArray<string>;
  readonly metadata?: Record<string, string>;
  readonly ephemeral?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GcConvoy {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly children: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly status: string;
  }>;
  readonly closedCount: number;
  readonly totalCount: number;
}

export interface GcFormulaStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly needs?: ReadonlyArray<string>;
}

export interface GcFormula {
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly steps: ReadonlyArray<GcFormulaStep>;
}

export interface GcEvent {
  readonly seq: number;
  readonly type: string;
  readonly ts: string;
  readonly actor: string;
  readonly subject: string;
  readonly message: string;
  readonly payload?: Record<string, unknown>;
}

export interface GcApiClientShape {
  readonly getBead: (id: string) => Effect.Effect<GcBead | null>;
  readonly getConvoy: (id: string) => Effect.Effect<GcConvoy | null>;
  readonly getFormula: (name: string) => Effect.Effect<GcFormula | null>;
  readonly getConfig: () => Effect.Effect<GcConfigResult | null>;
  readonly submitSession: (
    sessionName: string,
    message: string,
  ) => Effect.Effect<GcSubmitSessionResult, Error>;
  readonly stopSession: (sessionName: string) => Effect.Effect<GcSessionActionResult, Error>;
  readonly respondToPending: (
    sessionName: string,
    response: {
      readonly action: string;
      readonly requestId?: string;
      readonly text?: string;
      readonly metadata?: Record<string, string>;
    },
  ) => Effect.Effect<GcSessionActionResult, Error>;
  readonly setAgentSuspended: (name: string, suspended: boolean) => Effect.Effect<void, Error>;
  readonly setAgentSessionMode: (
    name: string,
    mode: "always" | "on_demand",
  ) => Effect.Effect<void, Error>;
  readonly setRigSuspended: (name: string, suspended: boolean) => Effect.Effect<void, Error>;
  readonly streamEvents: Stream.Stream<GcEvent>;
  readonly isAvailable: Effect.Effect<boolean>;
}

export class GcApiClient extends ServiceMap.Service<GcApiClient, GcApiClientShape>()(
  "t3/gc/Services/GcApiClient",
) {}
