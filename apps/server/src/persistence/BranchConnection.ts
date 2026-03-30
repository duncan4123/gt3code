import * as Effect from "effect/Effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";

import {
  type BetterDatabase,
  type DoltliteClientConfig,
  makeDoltliteClientWithDatabase,
  openDoltliteDatabase,
} from "./DoltliteClient.ts";

export interface BranchConnectionConfig extends DoltliteClientConfig {
  readonly branchName: string;
  readonly createIfMissing?: boolean | undefined;
}

const selectSingleString = (db: BetterDatabase, sql: string, ...params: ReadonlyArray<unknown>) => {
  const [row] = db.prepare(sql).all(...params) as ReadonlyArray<Record<string, unknown>>;
  if (!row) {
    return undefined;
  }
  const value = Object.values(row)[0];
  return typeof value === "string" ? value : undefined;
};

export const initializeBranchConnection = (
  db: BetterDatabase,
  {
    branchName,
    createIfMissing = true,
  }: Pick<BranchConnectionConfig, "branchName" | "createIfMissing">,
) =>
  Effect.sync(() => {
    const existingBranch = selectSingleString(
      db,
      "SELECT name FROM dolt_branches WHERE name = ? LIMIT 1",
      branchName,
    );
    if (!existingBranch) {
      if (!createIfMissing) {
        throw new Error(`Doltlite branch '${branchName}' does not exist`);
      }
      db.prepare("SELECT dolt_branch(?)").all(branchName);
    }

    db.prepare("SELECT dolt_checkout(?)").all(branchName);

    const activeBranch = selectSingleString(db, "SELECT active_branch()");
    if (activeBranch !== branchName) {
      throw new Error(
        `Doltlite branch checkout drifted: expected '${branchName}', got '${activeBranch ?? "unknown"}'`,
      );
    }
  });

export const makeBranchConnectionClient = (config: BranchConnectionConfig) =>
  makeDoltliteClientWithDatabase(config, () => {
    const db = openDoltliteDatabase(config.filename, config);
    Effect.runSync(initializeBranchConnection(db, config));
    return db;
  });

export const withBranchConnection = <A, E, R>(
  config: BranchConnectionConfig,
  effect: Effect.Effect<A, E, R | Client.SqlClient>,
): Effect.Effect<A, E, Exclude<R, Client.SqlClient>> =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* makeBranchConnectionClient(config);
      return yield* effect.pipe(Effect.provideService(Client.SqlClient, client));
    }),
  ).pipe(Effect.provide(Reactivity.layer));
