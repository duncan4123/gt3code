/**
 * GitCore - Effect service contract for low-level Git operations.
 *
 * Wraps core repository primitives used by higher-level orchestration
 * services and WebSocket routes.
 *
 * @module GitCore
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";
import type {
  VcsRef,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsCreateRefResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  VcsSwitchRefResult,
  VcsStatusInput,
  VcsStatusResult,
} from "@t3tools/contracts";

import type { GitCommandError } from "@t3tools/contracts";

export type GitCheckoutInput = {
  readonly cwd: string;
  readonly branch: string;
};
export type GitSwitchRefInput = {
  readonly cwd: string;
  readonly refName: string;
};
export type GitCreateBranchInput = {
  readonly cwd: string;
  readonly branch: string;
  readonly startPoint?: string;
  readonly checkout?: boolean;
};
export type GitCreateRefInput = {
  readonly cwd: string;
  readonly refName: string;
  readonly switchRef?: boolean;
};
export type GitCreateWorktreeInput = {
  readonly cwd: string;
  readonly refName?: string;
  readonly branch?: string;
  readonly newBranch?: string | undefined;
  readonly newRefName?: string | undefined;
  readonly path: string | null;
};
export type GitCreateWorktreeResult = VcsCreateWorktreeResult & {
  readonly worktree: VcsCreateWorktreeResult["worktree"] & {
    readonly branch: string;
  };
};
export type GitInitInput = VcsInitInput;
export type GitListBranchesInput = VcsListRefsInput;
export type GitListBranchesResult = {
  readonly branches: ReadonlyArray<VcsRef>;
  readonly refs: ReadonlyArray<VcsRef>;
  readonly isRepo: boolean;
  readonly hasOriginRemote: boolean;
  readonly hasPrimaryRemote: boolean;
  readonly nextCursor: number | null;
  readonly totalCount: number;
};
export type GitPullResult = {
  readonly status: VcsPullResult["status"];
  readonly refName?: string;
  readonly branch: string;
  readonly upstreamRef?: string | null;
  readonly upstreamBranch?: string | null;
};
export type GitRemoveWorktreeInput = VcsRemoveWorktreeInput;
export type GitStatusInput = VcsStatusInput;
export type GitStatusResult = VcsStatusResult;

export interface ExecuteGitInput {
  readonly operation: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly stdin?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowNonZeroExit?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly truncateOutputAtMaxBytes?: boolean;
  readonly progress?: ExecuteGitProgress;
}

export interface ExecuteGitResult {
  readonly code: number;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface GitStatusDetails {
  readonly kind?: GitStatusResult["kind"];
  readonly sourceControlProvider?: GitStatusResult["sourceControlProvider"];
  readonly hasPrimaryRemote?: boolean;
  readonly isDefaultRef?: boolean;
  readonly refName?: string | null;
  readonly hasOriginRemote: boolean;
  readonly isDefaultBranch: boolean;
  readonly branch: string | null;
  readonly upstreamRef: string | null;
  readonly isRepo: boolean;
  readonly hasWorkingTreeChanges: boolean;
  readonly workingTree: GitStatusResult["workingTree"];
  readonly hasUpstream: boolean;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly aheadOfDefaultCount?: number;
}

export interface GitPreparedCommitContext {
  stagedSummary: string;
  stagedPatch: string;
}

export interface ExecuteGitProgress {
  readonly onStdoutLine?: (line: string) => Effect.Effect<void, never>;
  readonly onStderrLine?: (line: string) => Effect.Effect<void, never>;
  readonly onHookStarted?: (hookName: string) => Effect.Effect<void, never>;
  readonly onHookFinished?: (input: {
    hookName: string;
    exitCode: number | null;
    durationMs: number | null;
  }) => Effect.Effect<void, never>;
}

export interface GitCommitProgress {
  readonly onOutputLine?: (input: {
    stream: "stdout" | "stderr";
    text: string;
  }) => Effect.Effect<void, never>;
  readonly onHookStarted?: (hookName: string) => Effect.Effect<void, never>;
  readonly onHookFinished?: (input: {
    hookName: string;
    exitCode: number | null;
    durationMs: number | null;
  }) => Effect.Effect<void, never>;
}

export interface GitCommitOptions {
  readonly timeoutMs?: number;
  readonly progress?: GitCommitProgress;
}

export interface GitPushResult {
  status: "pushed" | "skipped_up_to_date";
  branch: string;
  upstreamBranch?: string | undefined;
  setUpstream?: boolean | undefined;
}

export interface GitRangeContext {
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}

export interface GitListWorkspaceFilesResult {
  readonly paths: ReadonlyArray<string>;
  readonly truncated: boolean;
}

export interface GitRenameBranchInput {
  cwd: string;
  oldBranch: string;
  newBranch: string;
}

export interface GitRenameBranchResult {
  branch: string;
}

export interface GitFetchPullRequestBranchInput {
  cwd: string;
  prNumber: number;
  branch: string;
  remoteName?: string;
  remoteBranch?: string;
}

export interface GitEnsureRemoteInput {
  cwd: string;
  preferredName: string;
  url: string;
}

export interface GitFetchRemoteBranchInput {
  cwd: string;
  remoteName: string;
  remoteBranch: string;
  localBranch: string;
}

export interface GitFetchRemoteTrackingBranchInput {
  cwd: string;
  remoteName: string;
  remoteBranch: string;
}

export interface GitSetBranchUpstreamInput {
  cwd: string;
  branch: string;
  remoteName: string;
  remoteBranch: string;
}

/**
 * GitCoreShape - Service API for low-level Git repository interactions.
 */
export interface GitCoreShape {
  /**
   * Execute a raw Git command.
   */
  readonly execute: (input: ExecuteGitInput) => Effect.Effect<ExecuteGitResult, GitCommandError>;

  /**
   * Read Git status for a repository.
   */
  readonly status: (input: GitStatusInput) => Effect.Effect<GitStatusResult, GitCommandError>;

  /**
   * Read detailed working tree / branch status for a repository.
   */
  readonly statusDetails: (cwd: string) => Effect.Effect<GitStatusDetails, GitCommandError>;

  /**
   * Build staged change context for commit generation.
   */
  readonly prepareCommitContext: (
    cwd: string,
    filePaths?: readonly string[],
  ) => Effect.Effect<GitPreparedCommitContext | null, GitCommandError>;

  /**
   * Create a commit with provided subject/body.
   */
  readonly commit: (
    cwd: string,
    subject: string,
    body: string,
    options?: GitCommitOptions,
  ) => Effect.Effect<{ commitSha: string }, GitCommandError>;

  /**
   * Push current branch, setting upstream if needed.
   */
  readonly pushCurrentBranch: (
    cwd: string,
    fallbackBranch: string | null,
    options?: { readonly remoteName?: string | null },
  ) => Effect.Effect<GitPushResult, GitCommandError>;

  /**
   * Collect commit/diff context between base branch and current HEAD.
   */
  readonly readRangeContext: (
    cwd: string,
    baseBranch: string,
  ) => Effect.Effect<GitRangeContext, GitCommandError>;

  /**
   * Read a Git config value from the local repository.
   */
  readonly readConfigValue: (
    cwd: string,
    key: string,
  ) => Effect.Effect<string | null, GitCommandError>;

  /**
   * Determine whether the provided cwd is inside a git work tree.
   */
  readonly isInsideWorkTree: (cwd: string) => Effect.Effect<boolean, GitCommandError>;

  /**
   * List tracked and untracked workspace file paths relative to cwd.
   */
  readonly listWorkspaceFiles: (
    cwd: string,
  ) => Effect.Effect<GitListWorkspaceFilesResult, GitCommandError>;

  /**
   * Remove gitignored paths from a relative path list.
   */
  readonly filterIgnoredPaths: (
    cwd: string,
    relativePaths: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<string>, GitCommandError>;

  /**
   * List local + remote branches and branch metadata.
   */
  readonly listBranches: (
    input: GitListBranchesInput,
  ) => Effect.Effect<GitListBranchesResult, GitCommandError>;

  /**
   * Pull current branch from upstream using fast-forward only.
   */
  readonly pullCurrentBranch: (cwd: string) => Effect.Effect<GitPullResult, GitCommandError>;

  /**
   * Create a worktree and branch from a base branch.
   */
  readonly createWorktree: (
    input: GitCreateWorktreeInput,
  ) => Effect.Effect<GitCreateWorktreeResult, GitCommandError>;

  /**
   * Materialize a GitHub pull request head as a local branch without switching checkout.
   */
  readonly fetchPullRequestBranch: (
    input: GitFetchPullRequestBranchInput,
  ) => Effect.Effect<void, GitCommandError>;

  /**
   * Ensure a named remote exists for the provided URL, returning the reused or created remote name.
   */
  readonly ensureRemote: (input: GitEnsureRemoteInput) => Effect.Effect<string, GitCommandError>;

  /**
   * Resolve the primary remote name for provider operations.
   */
  readonly resolvePrimaryRemoteName: (cwd: string) => Effect.Effect<string, GitCommandError>;

  /**
   * Fetch a remote branch into a local branch without checkout.
   */
  readonly fetchRemoteBranch: (
    input: GitFetchRemoteBranchInput,
  ) => Effect.Effect<void, GitCommandError>;

  /**
   * Fetch a remote tracking branch without materializing a local branch.
   */
  readonly fetchRemoteTrackingBranch: (
    input: GitFetchRemoteTrackingBranchInput,
  ) => Effect.Effect<void, GitCommandError>;

  /**
   * Set the upstream tracking branch for a local branch.
   */
  readonly setBranchUpstream: (
    input: GitSetBranchUpstreamInput,
  ) => Effect.Effect<void, GitCommandError>;

  /**
   * Remove an existing worktree.
   */
  readonly removeWorktree: (input: GitRemoveWorktreeInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Rename an existing local branch.
   */
  readonly renameBranch: (
    input: GitRenameBranchInput,
  ) => Effect.Effect<GitRenameBranchResult, GitCommandError>;

  /**
   * Create a local branch.
   */
  readonly createBranch: (
    input: GitCreateBranchInput | GitCreateRefInput,
  ) => Effect.Effect<void | VcsCreateRefResult, GitCommandError>;

  /**
   * Checkout an existing branch and refresh its upstream metadata in background.
   */
  readonly checkoutBranch: (
    input: GitCheckoutInput | GitSwitchRefInput,
  ) => Effect.Effect<void | VcsSwitchRefResult, GitCommandError, Scope.Scope>;

  /**
   * Initialize a repository in the provided directory.
   */
  readonly initRepo: (input: GitInitInput) => Effect.Effect<void, GitCommandError>;

  /**
   * List local branch names (short format).
   */
  readonly listLocalBranchNames: (cwd: string) => Effect.Effect<string[], GitCommandError>;
}

/**
 * GitCore - Service tag for low-level Git repository operations.
 */
export class GitCore extends Context.Service<GitCore, GitCoreShape>()("t3/git/Services/GitCore") {}
