/**
 * GcApiClient — Service interface for Gas City REST API integration.
 *
 * Provides typed access to the GC API for beads, convoys, events,
 * and formula data. Used by the orchestration layer to enrich
 * GC-managed threads with live workspace context.
 *
 * @module GcApiClient
 */
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

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
  readonly actor?: string;
  readonly subject?: string;
  readonly message?: string;
  readonly payload: Record<string, unknown>;
}

export interface GcApiClientShape {
  /** Fetch a single bead by ID. */
  readonly getBead: (id: string) => Effect.Effect<GcBead | null>;

  /** Fetch a convoy by ID. */
  readonly getConvoy: (id: string) => Effect.Effect<GcConvoy | null>;

  /** Fetch formula steps by formula name. Returns null if not found. */
  readonly getFormula: (name: string) => Effect.Effect<GcFormula | null>;

  /** Stream GC events via SSE. */
  readonly streamEvents: Stream.Stream<GcEvent>;

  /** Whether the GC API is reachable. */
  readonly isAvailable: Effect.Effect<boolean>;
}

export class GcApiClient extends ServiceMap.Service<GcApiClient, GcApiClientShape>()(
  "t3/gc/Services/GcApiClient",
) {}
