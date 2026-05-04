/**
 * GcContextProvider — Service that provides GC workspace context for threads.
 *
 * Enriches GC-managed threads with live bead data, formula steps,
 * and convoy status from the GC API.
 */
import { Context } from "effect";
import type { Effect } from "effect";
import type { GcBead, GcConvoy, GcFormula } from "./GcApiClient.ts";

export interface GcRuntimeMcpServer {
  readonly name: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly source: "projected" | "source";
  readonly path?: string;
}

export interface GcRuntimeSkill {
  readonly name: string;
  readonly path: string;
  readonly source: "materialized" | "source";
  readonly description?: string;
}

export interface GcRuntimeDetails {
  readonly workDir?: string;
  readonly mcpConfigPath?: string;
  readonly mcpServers: readonly GcRuntimeMcpServer[];
  readonly skills: readonly GcRuntimeSkill[];
}

export interface GcThreadContext {
  readonly bead: GcBead | null;
  readonly convoy: GcConvoy | null;
  readonly formula: GcFormula | null;
  readonly runtime?: GcRuntimeDetails;
}

export interface GcContextProviderShape {
  readonly getThreadContext: (metadata: Record<string, string>) => Effect.Effect<GcThreadContext>;
  readonly isAvailable: Effect.Effect<boolean>;
}

export class GcContextProvider extends Context.Service<GcContextProvider, GcContextProviderShape>()(
  "t3/gc/Services/GcContextProvider",
) {}
