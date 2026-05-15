import { Context } from "effect";
import type { Effect } from "effect";
import type {
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  VcsStatusInput,
  VcsStatusResult,
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
} from "@t3tools/contracts";

export interface GitActionProgressReporter {
  readonly publish: (event: unknown) => Effect.Effect<void, never>;
}

export interface GitRunStackedActionOptions {
  readonly actionId?: string;
  readonly progressReporter?: GitActionProgressReporter;
}

export interface GitManagerShape {
  readonly status: (
    input: VcsStatusInput,
  ) => Effect.Effect<VcsStatusResult, GitManagerServiceError>;
  readonly localStatus?: (
    input: VcsStatusInput,
  ) => Effect.Effect<VcsStatusLocalResult, GitManagerServiceError>;
  readonly remoteStatus?: (
    input: VcsStatusInput,
  ) => Effect.Effect<VcsStatusRemoteResult | null, GitManagerServiceError>;
  readonly invalidateLocalStatus?: (cwd: string) => Effect.Effect<void, never>;
  readonly invalidateRemoteStatus?: (cwd: string) => Effect.Effect<void, never>;
  readonly invalidateStatus?: (cwd: string) => Effect.Effect<void, never>;
  readonly resolvePullRequest: (
    input: GitPullRequestRefInput,
  ) => Effect.Effect<GitResolvePullRequestResult, GitManagerServiceError>;
  readonly preparePullRequestThread: (
    input: GitPreparePullRequestThreadInput,
  ) => Effect.Effect<GitPreparePullRequestThreadResult, GitManagerServiceError>;
  readonly runStackedAction: (
    input: GitRunStackedActionInput,
    options?: GitRunStackedActionOptions,
  ) => Effect.Effect<GitRunStackedActionResult, GitManagerServiceError>;
}

export class GitManager extends Context.Service<GitManager, GitManagerShape>()(
  "t3/git/Services/GitManager",
) {}
