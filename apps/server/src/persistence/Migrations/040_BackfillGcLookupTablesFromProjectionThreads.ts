import { parseGcMeta } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../Errors.ts";

function coerceCustomMetadata(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) =>
      typeof entryValue === "string" ? [[key, entryValue] as const] : [],
    ),
  );
}

export const backfillGcLookupTablesFromProjectionThreads = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly threadId: string;
    readonly customMetadata: string;
    readonly updatedAt: string;
  }>`
    SELECT
      thread_id AS "threadId",
      custom_metadata AS "customMetadata",
      updated_at AS "updatedAt"
    FROM projection_threads
    WHERE custom_metadata LIKE '%gc.agent%'
  `.pipe(Effect.mapError(toPersistenceSqlError("gcLookupBackfill.selectThreads")));

  for (const row of rows) {
    let customMetadata: Record<string, string>;
    try {
      customMetadata = coerceCustomMetadata(JSON.parse(row.customMetadata || "{}"));
    } catch {
      customMetadata = {};
    }

    const gcMeta = parseGcMeta(customMetadata);
    if (!gcMeta.isGcManaged || !gcMeta.agent) {
      continue;
    }

    if (gcMeta.bead) {
      const priority = Number.parseInt(gcMeta.beadPriority ?? "", 10);
      yield* sql`
        INSERT INTO gc_beads (
          id,
          title,
          status,
          priority,
          issue_type,
          assignee,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (
          ${gcMeta.bead},
          ${gcMeta.beadTitle ?? gcMeta.bead},
          ${gcMeta.beadStatus ?? "open"},
          ${Number.isFinite(priority) ? priority : 2},
          ${gcMeta.beadType ?? "task"},
          ${gcMeta.beadAssignee ?? null},
          ${JSON.stringify(customMetadata)},
          ${row.updatedAt},
          ${row.updatedAt}
        )
        ON CONFLICT (id)
        DO UPDATE SET
          title = excluded.title,
          status = excluded.status,
          priority = excluded.priority,
          issue_type = excluded.issue_type,
          assignee = excluded.assignee,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `.pipe(Effect.mapError(toPersistenceSqlError("gcLookupBackfill.upsertBead")));
    }

    if (gcMeta.convoy) {
      yield* sql`
        INSERT INTO gc_convoys (
          id,
          title,
          status,
          formula,
          closed_count,
          total_count,
          created_at,
          updated_at
        )
        VALUES (
          ${gcMeta.convoy},
          ${gcMeta.convoyTitle ?? gcMeta.convoy},
          ${gcMeta.convoyStatus ?? "open"},
          ${gcMeta.formula ?? null},
          ${Number.parseInt(gcMeta.convoyClosedCount ?? "0", 10) || 0},
          ${Number.parseInt(gcMeta.convoyTotalCount ?? "0", 10) || 0},
          ${row.updatedAt},
          ${row.updatedAt}
        )
        ON CONFLICT (id)
        DO UPDATE SET
          title = excluded.title,
          status = excluded.status,
          formula = excluded.formula,
          closed_count = excluded.closed_count,
          total_count = excluded.total_count,
          updated_at = excluded.updated_at
      `.pipe(Effect.mapError(toPersistenceSqlError("gcLookupBackfill.upsertConvoy")));

      if (gcMeta.bead) {
        yield* sql`
          INSERT INTO gc_convoy_members (
            convoy_id,
            issue_id,
            thread_id,
            agent,
            status
          )
          VALUES (
            ${gcMeta.convoy},
            ${gcMeta.bead},
            ${row.threadId},
            ${gcMeta.agent},
            ${gcMeta.beadStatus ?? gcMeta.state ?? "pending"}
          )
          ON CONFLICT (convoy_id, issue_id)
          DO UPDATE SET
            thread_id = excluded.thread_id,
            agent = excluded.agent,
            status = excluded.status
        `.pipe(Effect.mapError(toPersistenceSqlError("gcLookupBackfill.upsertConvoyMember")));
      }
    }

    yield* sql`
      INSERT INTO gc_agent_sessions (
        thread_id,
        agent,
        rig,
        city,
        bead_id,
        molecule,
        formula,
        state,
        updated_at
      )
      VALUES (
        ${row.threadId},
        ${gcMeta.agent},
        ${gcMeta.rig ?? null},
        ${gcMeta.city ?? null},
        ${gcMeta.bead ?? null},
        ${gcMeta.molecule ?? null},
        ${gcMeta.formula ?? null},
        ${gcMeta.state ?? "active"},
        ${row.updatedAt}
      )
      ON CONFLICT (thread_id)
      DO UPDATE SET
        agent = excluded.agent,
        rig = excluded.rig,
        city = excluded.city,
        bead_id = excluded.bead_id,
        molecule = excluded.molecule,
        formula = excluded.formula,
        state = excluded.state,
        updated_at = excluded.updated_at
    `.pipe(Effect.mapError(toPersistenceSqlError("gcLookupBackfill.upsertAgentSession")));
  }
});

export default backfillGcLookupTablesFromProjectionThreads;
