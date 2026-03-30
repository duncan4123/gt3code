import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";

import { makeBranchConnectionClient } from "../src/persistence/BranchConnection.ts";
import {
  makeDoltliteClientWithDatabase,
  openDoltliteDatabase,
  type DoltliteClientConfig,
} from "../src/persistence/DoltliteClient.ts";

const tempDir = mkdtempSync(join(tmpdir(), "t3-doltlite-branch-"));
const dbPath = join(tempDir, "branch-spike.sqlite");

const baseConfig: DoltliteClientConfig = { filename: dbPath, wal: true };

const runWithClient = <A, E, R>(
  client: Client.SqlClient,
  effect: Effect.Effect<A, E, R | Client.SqlClient>,
): Effect.Effect<A, E, Exclude<R, Client.SqlClient>> =>
  effect.pipe(Effect.provideService(Client.SqlClient, client));

const program = Effect.gen(function* () {
  const mainClient = yield* makeDoltliteClientWithDatabase(baseConfig, () =>
    openDoltliteDatabase(baseConfig.filename, baseConfig),
  );

  yield* runWithClient(
    mainClient,
    Effect.gen(function* () {
      const sql = yield* Client.SqlClient;
      yield* sql`PRAGMA foreign_keys = ON;`;
      yield* sql`
        CREATE TABLE branch_probe_threads (
          thread_id TEXT PRIMARY KEY,
          title TEXT NOT NULL
        )
      `;
      yield* sql`
        INSERT INTO branch_probe_threads (thread_id, title)
        VALUES ('thread-main', 'Parent on main')
      `;
      yield* sql`SELECT dolt_commit('-A', '-m', 'init branch probe');`;
      yield* sql`SELECT dolt_checkout('main');`;
    }),
  );

  const branchClient = yield* makeBranchConnectionClient({
    ...baseConfig,
    branchName: "thread-branch-probe",
  });

  const mainBefore = yield* runWithClient(
    mainClient,
    Effect.gen(function* () {
      const sql = yield* Client.SqlClient;
      const activeBranch = yield* sql<{
        active_branch: string;
      }>`SELECT active_branch() AS active_branch`;
      const rows = yield* sql<{ thread_id: string; title: string }>`
        SELECT thread_id, title
        FROM branch_probe_threads
        ORDER BY thread_id
      `;
      return { activeBranch, rows };
    }),
  );

  const branchResult = yield* runWithClient(
    branchClient,
    Effect.gen(function* () {
      const sql = yield* Client.SqlClient;
      const activeBefore = yield* sql<{
        active_branch: string;
      }>`SELECT active_branch() AS active_branch`;
      yield* sql`
        INSERT INTO branch_probe_threads (thread_id, title)
        VALUES ('thread-branch', 'Only on branch')
      `;
      yield* sql`SELECT dolt_commit('-A', '-m', 'add branch-only thread');`;
      const branchRows = yield* sql<{ thread_id: string; title: string }>`
        SELECT thread_id, title
        FROM branch_probe_threads
        ORDER BY thread_id
      `;
      return {
        activeBefore,
        branchRows,
      };
    }),
  );

  const mainAfter = yield* runWithClient(
    mainClient,
    Effect.gen(function* () {
      const sql = yield* Client.SqlClient;
      const activeBranch = yield* sql<{
        active_branch: string;
      }>`SELECT active_branch() AS active_branch`;
      const rows = yield* sql<{ thread_id: string; title: string }>`
        SELECT thread_id, title
        FROM branch_probe_threads
        ORDER BY thread_id
      `;
      return { activeBranch, rows };
    }),
  );

  const historicalBranchRows = yield* runWithClient(
    mainClient,
    Effect.gen(function* () {
      const sql = yield* Client.SqlClient;
      return yield* sql<{ thread_id: string; title: string }>`
        SELECT thread_id, title
        FROM dolt_at_branch_probe_threads('thread-branch-probe')
        ORDER BY thread_id
      `;
    }),
  );

  return {
    dbPath,
    mainBefore,
    branchResult,
    mainAfter,
    historicalBranchRows,
  };
}).pipe(
  Effect.scoped,
  Effect.provide(Reactivity.layer),
  Effect.ensuring(
    Effect.sync(() => {
      rmSync(tempDir, { recursive: true, force: true });
    }),
  ),
);

const result = await Effect.runPromise(program);

console.log(JSON.stringify(result, null, 2));
