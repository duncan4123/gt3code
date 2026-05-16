import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { GitManager } from "../../git/Services/GitManager.ts";
import { JjManager } from "../../jj/Services/JjManager.ts";
import { detectRepoKind } from "../Utils.ts";
import { VcsManager, type VcsManagerShape } from "../Services/VcsManager.ts";

export const VcsManagerLive = Layer.effect(
  VcsManager,
  Effect.gen(function* () {
    const gitManager = yield* GitManager;
    const jjManager = yield* JjManager;

    const selectManager = (cwd: string) => (detectRepoKind(cwd) === "jj" ? jjManager : gitManager);

    const manager = {
      status: (input) => selectManager(input.cwd).status(input),
      localStatus: (input) =>
        selectManager(input.cwd).localStatus?.(input) ?? gitManager.status(input),
      remoteStatus: (input) =>
        selectManager(input.cwd).remoteStatus?.(input) ?? Effect.succeed(null),
      invalidateLocalStatus: (cwd) =>
        selectManager(cwd).invalidateLocalStatus?.(cwd) ?? Effect.void,
      invalidateRemoteStatus: (cwd) =>
        selectManager(cwd).invalidateRemoteStatus?.(cwd) ?? Effect.void,
      invalidateStatus: (cwd) => selectManager(cwd).invalidateStatus?.(cwd) ?? Effect.void,
      resolvePullRequest: (input) => selectManager(input.cwd).resolvePullRequest(input),
      preparePullRequestThread: (input) => selectManager(input.cwd).preparePullRequestThread(input),
      runStackedAction: (input, options) =>
        selectManager(input.cwd).runStackedAction(input, options),
    } satisfies VcsManagerShape;

    return manager;
  }),
);
