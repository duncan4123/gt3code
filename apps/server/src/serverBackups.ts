import {
  type ServerBackupRemote,
  type ServerPushBackupInput,
  type ServerPushBackupResult,
  type ServerUpsertBackupRemoteInput,
} from "@t3tools/contracts";
import { Effect, Layer, Schema, ServiceMap } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "./config.ts";

export class ServerBackupError extends Schema.TaggedErrorClass<ServerBackupError>()(
  "ServerBackupError",
  {
    message: Schema.String,
  },
) {}

export interface ServerBackupsShape {
  readonly listBackupRemotes: () => Effect.Effect<
    ReadonlyArray<ServerBackupRemote>,
    ServerBackupError
  >;
  readonly upsertBackupRemote: (
    input: ServerUpsertBackupRemoteInput,
  ) => Effect.Effect<ServerBackupRemote, ServerBackupError>;
  readonly removeBackupRemote: (name: string) => Effect.Effect<void, ServerBackupError>;
  readonly pushBackup: (
    input: ServerPushBackupInput,
  ) => Effect.Effect<ServerPushBackupResult, ServerBackupError>;
}

export class ServerBackupsService extends ServiceMap.Service<
  ServerBackupsService,
  ServerBackupsShape
>()("t3/serverBackups/ServerBackupsService") {}

const makeServerBackups = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const { dbPath } = yield* ServerConfig;

  const readHeadCommitHash: Effect.Effect<string, ServerBackupError> = sql<{ commit_hash: string }>`
    SELECT commit_hash
    FROM dolt_log
    LIMIT 1
  `.pipe(
    Effect.map((rows) => rows[0]?.commit_hash),
    Effect.flatMap((commitHash) =>
      commitHash
        ? Effect.succeed(commitHash)
        : Effect.fail(
            new ServerBackupError({
              message: `No Doltlite commit history found for ${dbPath}.`,
            }),
          ),
    ),
    Effect.mapError(
      () =>
        new ServerBackupError({
          message: `Failed to read the current Doltlite commit from ${dbPath}.`,
        }),
    ),
  );

  const readActiveBranch: Effect.Effect<string, ServerBackupError> = sql<{ active_branch: string }>`
    SELECT active_branch() AS active_branch
  `.pipe(
    Effect.map((rows) => rows[0]?.active_branch),
    Effect.flatMap((branch) =>
      branch
        ? Effect.succeed(branch)
        : Effect.fail(
            new ServerBackupError({
              message: `Could not determine the active Doltlite branch for ${dbPath}.`,
            }),
          ),
    ),
    Effect.mapError(
      () =>
        new ServerBackupError({
          message: `Failed to read the active Doltlite branch from ${dbPath}.`,
        }),
    ),
  );

  const listBackupRemotes = (): Effect.Effect<
    ReadonlyArray<ServerBackupRemote>,
    ServerBackupError
  > =>
    sql<{ name: string; url: string }>`
      SELECT name, url
      FROM dolt_remotes
      ORDER BY name ASC
    `.pipe(
      Effect.mapError(
        () =>
          new ServerBackupError({
            message: `Failed to list Doltlite remotes for ${dbPath}.`,
          }),
      ),
    );

  const upsertBackupRemote = (
    input: ServerUpsertBackupRemoteInput,
  ): Effect.Effect<ServerBackupRemote, ServerBackupError> =>
    Effect.gen(function* () {
      const existing = yield* sql<{ count: number }>`
        SELECT count(*) AS count
        FROM dolt_remotes
        WHERE name = ${input.name}
      `.pipe(
        Effect.mapError(
          () =>
            new ServerBackupError({
              message: `Failed to inspect existing Doltlite remotes for ${dbPath}.`,
            }),
        ),
      );

      if ((existing[0]?.count ?? 0) > 0) {
        yield* sql`SELECT dolt_remote('remove', ${input.name})`.pipe(
          Effect.mapError(
            () =>
              new ServerBackupError({
                message: `Failed to replace Doltlite remote '${input.name}'.`,
              }),
          ),
        );
      }

      yield* sql`SELECT dolt_remote('add', ${input.name}, ${input.url})`.pipe(
        Effect.mapError(
          () =>
            new ServerBackupError({
              message: `Failed to add Doltlite remote '${input.name}'.`,
            }),
        ),
      );

      return input;
    });

  const removeBackupRemote = (name: string): Effect.Effect<void, ServerBackupError> =>
    sql`SELECT dolt_remote('remove', ${name})`.pipe(
      Effect.asVoid,
      Effect.mapError(
        () =>
          new ServerBackupError({
            message: `Failed to remove Doltlite remote '${name}'.`,
          }),
      ),
    );

  const pushBackup = (
    input: ServerPushBackupInput,
  ): Effect.Effect<ServerPushBackupResult, ServerBackupError> =>
    Effect.gen(function* () {
      const branch = input.branch ?? (yield* readActiveBranch);
      const commitMessage = `backup push @ ${new Date().toISOString()} -> ${input.remoteName}/${branch}`;

      const commitHash = yield* sql<{ commit_hash: string }>`
        SELECT dolt_commit('-A', '-m', ${commitMessage}) AS commit_hash
      `.pipe(
        Effect.map((rows) => rows[0]?.commit_hash),
        Effect.flatMap((nextCommitHash) =>
          nextCommitHash ? Effect.succeed(nextCommitHash) : readHeadCommitHash,
        ),
        Effect.mapError(
          () =>
            new ServerBackupError({
              message: `Failed to capture a Doltlite backup commit before pushing to '${input.remoteName}'.`,
            }),
        ),
        Effect.catch((cause) =>
          cause.message.toLowerCase().includes("nothing to commit")
            ? readHeadCommitHash
            : Effect.fail(cause),
        ),
      );

      yield* sql`SELECT dolt_push(${input.remoteName}, ${branch})`.pipe(
        Effect.mapError(
          () =>
            new ServerBackupError({
              message: `Failed to push Doltlite backup to remote '${input.remoteName}'.`,
            }),
        ),
      );

      return {
        remoteName: input.remoteName,
        branch,
        commitHash,
        pushedAt: new Date().toISOString(),
      };
    });

  return {
    listBackupRemotes,
    upsertBackupRemote,
    removeBackupRemote,
    pushBackup,
  } satisfies ServerBackupsShape;
});

export const ServerBackupsLive = Layer.effect(ServerBackupsService, makeServerBackups);
