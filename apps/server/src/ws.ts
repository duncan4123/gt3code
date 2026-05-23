import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Cause, Effect, Layer, Option, Queue, Schema, Stream } from "effect";
import {
  CommandId,
  EventId,
  FilesystemBrowseError,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  OrchestrationSearchThreadMessagesError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  ServerProviderUpdateError,
  SourceControlRepositoryError,
  ThreadId,
  GitManagerServiceError,
  type TerminalEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { clamp } from "effect/Number";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery.ts";
import { ServerConfig } from "./config.ts";
import { Keybindings } from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import { normalizeDispatchCommand } from "./orchestration/Normalizer.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation.ts";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
import { ProviderMaintenanceRunner } from "./provider/providerMaintenanceRunner.ts";
import { GcApiClient } from "./gc/Services/GcApiClient.ts";
import { GcContextProvider } from "./gc/Services/GcContextProvider.ts";
import { makeGcRpcHandlers } from "./gc/rpcHandlers.ts";
import { ServerLifecycleEvents } from "./serverLifecycleEvents.ts";
import { ServerRuntimeStartup } from "./serverRuntimeStartup.ts";
import {
  redactServerSettingsForClient,
  ServerSettingsService,
} from "./serverSettings.ts";
import { SourceControlDiscovery } from "./sourceControl/SourceControlDiscovery.ts";
import { SourceControlRepositoryService } from "./sourceControl/SourceControlRepositoryService.ts";
import { TerminalManager } from "./terminal/Services/Manager.ts";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem.ts";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths.ts";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner.ts";
import { VcsCore } from "./vcs/Services/VcsCore.ts";
import { VcsManager } from "./vcs/Services/VcsManager.ts";
import { VcsProvisioningService } from "./vcs/VcsProvisioningService.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { TraceDiagnostics } from "./diagnostics/TraceDiagnostics.ts";
import { ProcessDiagnostics } from "./diagnostics/ProcessDiagnostics.ts";
import { ProcessResourceMonitor } from "./diagnostics/ProcessResourceMonitor.ts";

function readSupervisorPort(supervisorTomlPath: string): number | null {
  if (!existsSync(supervisorTomlPath)) {
    return null;
  }
  try {
    const port = readFileSync(supervisorTomlPath, "utf8").match(
      /^\s*port\s*=\s*"?([0-9]+)"?\s*$/m,
    )?.[1];
    return port ? Number(port) : null;
  } catch {
    return null;
  }
}

function normalizeWsUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.endsWith("/ws") ? trimmed : `${trimmed.replace(/\/$/, "")}/ws`;
}

function readT3BridgeWsUrlHint(t3Home: string | undefined): string | undefined {
  if (!t3Home) {
    return undefined;
  }
  const hintPath = path.join(t3Home, "ws-url");
  if (!existsSync(hintPath)) {
    return undefined;
  }
  try {
    return normalizeWsUrl(readFileSync(hintPath, "utf8"));
  } catch {
    return undefined;
  }
}

function wsUrlPort(wsUrl: string | undefined): number | undefined {
  if (!wsUrl) {
    return undefined;
  }
  try {
    const parsed = new URL(wsUrl);
    const port = Number(parsed.port);
    return Number.isFinite(port) ? port : undefined;
  } catch {
    return undefined;
  }
}

function wsUrlHost(wsUrl: string | undefined): string | undefined {
  if (!wsUrl) {
    return undefined;
  }
  try {
    return new URL(wsUrl).hostname || undefined;
  } catch {
    return undefined;
  }
}

function isLoopbackHost(host: string | undefined): boolean | undefined {
  if (!host) {
    return undefined;
  }
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function looksLikeTailscaleHost(host: string | undefined): boolean | undefined {
  if (!host) {
    return undefined;
  }
  const lower = host.toLowerCase();
  if (lower.endsWith(".ts.net")) {
    return true;
  }
  const match = lower.match(/^100\.(\d{1,3})\./u);
  if (!match) {
    return false;
  }
  const secondOctet = Number(match[1]);
  return secondOctet >= 64 && secondOctet <= 127;
}

function checkTcpListening(port: number | undefined): {
  readonly reachable?: boolean;
  readonly error?: string;
} {
  if (typeof port !== "number") {
    return {};
  }
  const result = spawnSync("bash", ["-lc", `</dev/tcp/127.0.0.1/${port}`], {
    encoding: "utf8",
    timeout: 1_000,
  });
  if (result.status === 0) {
    return { reachable: true };
  }
  const error = [result.stderr.trim(), result.stdout.trim()]
    .filter(Boolean)
    .join("\n");
  return {
    reachable: false,
    error: error || `127.0.0.1:${port} is not reachable`,
  };
}

function currentGitBranch(cwd: string): string | undefined {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf8",
    timeout: 1_000,
  });
  const branch = result.status === 0 ? result.stdout.trim() : "";
  return branch || undefined;
}

function readBeadStoreDiagnostics(label: string, rootDir: string) {
  const beadsPath = path.join(rootDir, ".beads");
  const metadataPath = path.join(beadsPath, "metadata.json");
  const result: {
    label: string;
    path: string;
    metadataPath: string;
    exists: boolean;
    backend?: string;
    mode?: string;
    database?: string;
    doltDatabase?: string;
    error?: string;
  } = {
    label,
    path: beadsPath,
    metadataPath,
    exists: existsSync(beadsPath),
  };
  if (!existsSync(metadataPath)) {
    return result;
  }
  try {
    const raw = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<
      string,
      unknown
    >;
    const stringValue = (key: string) =>
      typeof raw[key] === "string" ? raw[key] : undefined;
    const backend = stringValue("backend");
    const mode = stringValue("dolt_mode");
    const database = stringValue("database");
    const doltDatabase = stringValue("dolt_database");
    if (backend) result.backend = backend;
    if (mode) result.mode = mode;
    if (database) result.database = database;
    if (doltDatabase) result.doltDatabase = doltDatabase;
  } catch (error) {
    result.error =
      error instanceof Error ? error.message : "Failed to read metadata.json";
  }
  return result;
}

function discoverGascityProcesses(input: {
  readonly runtimeHome: string;
  readonly gcBin: string;
  readonly bdBin: string;
  readonly brBin: string;
}): {
  readonly processes: Array<{
    readonly pid: number;
    readonly ppid: number;
    readonly pgid: Option.Option<number>;
    readonly status: string;
    readonly cpuPercent: number;
    readonly rssBytes: number;
    readonly elapsed: string;
    readonly command: string;
    readonly depth: number;
    readonly childPids: number[];
  }>;
  readonly error?: string;
} {
  const result = spawnSync(
    "ps",
    ["-eo", "pid=,ppid=,pgid=,stat=,pcpu=,rss=,etime=,args="],
    {
      encoding: "utf8",
      timeout: 2_000,
    },
  );
  if (result.status !== 0) {
    return {
      processes: [],
      error:
        result.stderr.trim() ||
        result.stdout.trim() ||
        "Failed to scan system processes.",
    };
  }

  const markers = [
    input.runtimeHome,
    input.gcBin,
    input.bdBin,
    input.brBin,
    " supervisor run",
    "/gc supervisor run",
    "/bd ",
    "/br ",
    " dolt ",
    "/dolt",
    " doltlite",
    "/doltlite",
    "/dlite",
  ].filter(Boolean);

  const rows = result.stdout
    .split("\n")
    .flatMap((line) => {
      const match = line.match(
        /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+([0-9.]+)\s+(\d+)\s+(\S+)\s+(.+)$/u,
      );
      if (!match) return [];
      const [
        ,
        pidText,
        ppidText,
        pgidText,
        status,
        cpuText,
        rssText,
        elapsed,
        command,
      ] = match;
      if (!command || !markers.some((marker) => command.includes(marker))) {
        return [];
      }
      if (
        command.includes("ps -eo ") ||
        command.includes("systemctl --user status")
      ) {
        return [];
      }
      return [
        {
          pid: Number(pidText),
          ppid: Number(ppidText),
          pgid:
            Number(pgidText) >= 0
              ? Option.some(Number(pgidText))
              : Option.none(),
          status: status!,
          cpuPercent: Number(cpuText),
          rssBytes: Number(rssText) * 1024,
          elapsed: elapsed!,
          command,
          depth: 0,
          childPids: [],
        },
      ];
    })
    .filter((process) => Number.isInteger(process.pid) && process.pid > 0)
    .toSorted((left, right) => left.pid - right.pid);

  const selectedPids = new Set(rows.map((row) => row.pid));
  return {
    processes: rows.map((row) => ({
      ...row,
      childPids: rows
        .filter(
          (candidate) =>
            candidate.ppid === row.pid && selectedPids.has(candidate.pid),
        )
        .map((candidate) => candidate.pid),
      depth: selectedPids.has(row.ppid) ? 1 : 0,
    })),
  };
}

function makeGascityDiagnostics(config: {
  readonly cwd: string;
  readonly stateDir: string;
  readonly tailscaleServeEnabled: boolean;
  readonly tailscaleServePort: number;
}) {
  const cwd = config.cwd;
  const runtimeHome =
    process.env.T3CODE_GASCITY_HOME?.trim() ||
    process.env.GC_HOME?.trim() ||
    path.join(cwd, ".t3-dev", "gascity");
  const supervisorTomlPath = path.join(runtimeHome, "supervisor.toml");
  const supervisorPort = readSupervisorPort(supervisorTomlPath);
  const configuredApiUrl = process.env.GC_API_URL?.trim() || undefined;
  const resolvedApiUrl = supervisorPort
    ? `http://127.0.0.1:${supervisorPort}`
    : (configuredApiUrl ?? "http://127.0.0.1:8372");
  const appBranch = currentGitBranch(cwd);
  const apiUrlSource: "supervisor.toml" | "GC_API_URL" | "default" =
    supervisorPort
      ? "supervisor.toml"
      : configuredApiUrl
        ? "GC_API_URL"
        : "default";
  const cityPath =
    process.env.GC_CITY_PATH?.trim() ||
    process.env.GC_CITY?.trim() ||
    undefined;
  const cityName = process.env.GC_CITY_NAME?.trim() || undefined;
  const t3Home = process.env.T3_HOME?.trim() || undefined;
  const envT3WsUrl = normalizeWsUrl(process.env.T3_WS_URL);
  const hintT3WsUrl = readT3BridgeWsUrlHint(t3Home);
  const t3WsUrl = envT3WsUrl ?? hintT3WsUrl;
  const t3WsUrlSource = envT3WsUrl
    ? "T3_WS_URL"
    : hintT3WsUrl
      ? "ws-url"
      : undefined;
  const t3WsHost = wsUrlHost(t3WsUrl);
  const t3WsIsLoopback = isLoopbackHost(t3WsHost);
  const t3WsLooksLikeTailscale = looksLikeTailscaleHost(t3WsHost);
  const t3ServerPort = wsUrlPort(t3WsUrl);
  const t3WsReachability = checkTcpListening(t3ServerPort);
  const worktreesDir =
    process.env.T3CODE_WORKTREES_DIR?.trim() ||
    process.env.GC_WORKTREES_DIR?.trim() ||
    undefined;
  const gcBin =
    process.env.GC_BIN?.trim() || path.join(runtimeHome, "bin", "gc");
  const bdBin =
    process.env.BD_BIN?.trim() || path.join(runtimeHome, "bin", "bd");
  const brBin =
    process.env.BR_BIN?.trim() || path.join(runtimeHome, "bin", "br");
  const projectionDbPath = path.join(config.stateDir, "state-proj.sqlite");
  const nativeDoltliteBeads = process.env.GC_NATIVE_DOLTLITE_BEADS?.trim();
  const beadsBackend =
    process.env.GC_BEADS_BACKEND?.trim() || process.env.BEADS_BACKEND?.trim();
  const doltliteLibrary = process.env.DOLTLITE_LIBRARY?.trim();
  const ldLibraryPath = process.env.LD_LIBRARY_PATH?.trim();
  const beadStoreRoots = [
    ["app", cwd],
    ...(cityPath && cityPath !== cwd ? ([["city", cityPath]] as const) : []),
    ["packaged beads-doltlite", path.join(cwd, "packages", "beads-doltlite")],
    ["packaged gascity", path.join(cwd, "packages", "gascity")],
    ["gascity source", path.resolve(cwd, "..", "gascity")],
  ] as const;
  const processScan = discoverGascityProcesses({
    runtimeHome,
    gcBin,
    bdBin,
    brBin,
  });

  return {
    cwd,
    ...(appBranch ? { appBranch } : {}),
    runtimeHome,
    supervisorTomlPath,
    supervisorTomlExists: existsSync(supervisorTomlPath),
    ...(supervisorPort ? { supervisorPort } : {}),
    resolvedApiUrl,
    ...(configuredApiUrl ? { configuredApiUrl } : {}),
    apiUrlSource,
    ...(cityPath ? { cityPath } : {}),
    ...(cityName ? { cityName } : {}),
    gcBin,
    bdBin,
    brBin,
    ...(t3Home ? { t3Home } : {}),
    ...(t3WsUrl ? { t3WsUrl } : {}),
    ...(t3WsUrlSource ? { t3WsUrlSource } : {}),
    ...(t3WsHost ? { t3WsHost } : {}),
    ...(typeof t3WsIsLoopback === "boolean"
      ? { t3WsIsLoopback }
      : {}),
    ...(typeof t3WsLooksLikeTailscale === "boolean"
      ? { t3WsLooksLikeTailscale }
      : {}),
    ...(typeof t3ServerPort === "number" ? { t3ServerPort } : {}),
    ...(typeof t3WsReachability.reachable === "boolean"
      ? {
          t3WsReachable: t3WsReachability.reachable,
          t3ServerPortListening: t3WsReachability.reachable,
        }
      : {}),
    ...(t3WsReachability.error
      ? { t3WsReachabilityError: t3WsReachability.error }
      : {}),
    tailscaleServeEnabled: config.tailscaleServeEnabled,
    tailscaleServePort: config.tailscaleServePort,
    ...(worktreesDir ? { worktreesDir } : {}),
    projectionDbPath,
    projectionDbExists: existsSync(projectionDbPath),
    ...(nativeDoltliteBeads ? { nativeDoltliteBeads } : {}),
    ...(beadsBackend ? { beadsBackend } : {}),
    ...(doltliteLibrary ? { doltliteLibrary } : {}),
    ...(ldLibraryPath ? { ldLibraryPath } : {}),
    beadStores: beadStoreRoots.map(([label, root]) =>
      readBeadStoreDiagnostics(label, root),
    ),
    processes: processScan.processes,
    ...(processScan.error ? { processScanError: processScan.error } : {}),
  } as const;
}

const WsRpcLayer = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const keybindings = yield* Keybindings;
    const externalLauncher = yield* ExternalLauncher.ExternalLauncher;
    const vcsManager = yield* VcsManager;
    const vcs = yield* VcsCore;
    const vcsProvisioning = yield* VcsProvisioningService;
    const terminalManager = yield* TerminalManager;
    const providerRegistry = yield* ProviderRegistry;
    const config = yield* ServerConfig;
    const lifecycleEvents = yield* ServerLifecycleEvents;
    const serverSettings = yield* ServerSettingsService;
    const startup = yield* ServerRuntimeStartup;
    const workspaceEntries = yield* WorkspaceEntries;
    const workspaceFileSystem = yield* WorkspaceFileSystem;
    const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
    const serverEnvironment = yield* ServerEnvironment;
    const serverAuth = yield* ServerAuth;
    const traceDiagnostics = yield* TraceDiagnostics;
    const processDiagnostics = yield* ProcessDiagnostics;
    const processResourceMonitor = yield* ProcessResourceMonitor;
    const providerMaintenanceRunner = yield* ProviderMaintenanceRunner;
    const sourceControlDiscovery = yield* SourceControlDiscovery;
    const sourceControlRepositoryService =
      yield* SourceControlRepositoryService;
    const gcApiClient = yield* GcApiClient;
    const gcContextProvider = yield* GcContextProvider;

    const serverCommandId = (tag: string) =>
      CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

    const messageFromUnknown = (cause: unknown): string =>
      cause instanceof Error ? cause.message : String(cause);

    const appendSetupScriptActivity = (input: {
      readonly threadId: ThreadId;
      readonly kind:
        | "setup-script.requested"
        | "setup-script.started"
        | "setup-script.failed";
      readonly summary: string;
      readonly createdAt: string;
      readonly payload: Record<string, unknown>;
      readonly tone: "info" | "error";
    }) =>
      orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: serverCommandId("setup-script-activity"),
        threadId: input.threadId,
        activity: {
          id: EventId.make(crypto.randomUUID()),
          tone: input.tone,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: null,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      });

    const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
      Schema.is(OrchestrationDispatchCommandError)(cause)
        ? cause
        : new OrchestrationDispatchCommandError({
            message: cause instanceof Error ? cause.message : fallbackMessage,
            cause,
          });

    const toBootstrapDispatchCommandCauseError = (
      cause: Cause.Cause<unknown>,
    ) => {
      const error = Cause.squash(cause);
      return Schema.is(OrchestrationDispatchCommandError)(error)
        ? error
        : new OrchestrationDispatchCommandError({
            message:
              error instanceof Error
                ? error.message
                : "Failed to bootstrap thread turn start.",
            cause,
          });
    };

    const dispatchBootstrapTurnStart = (
      command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
    ): Effect.Effect<
      { readonly sequence: number },
      OrchestrationDispatchCommandError
    > =>
      Effect.gen(function* () {
        const bootstrap = command.bootstrap;
        const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
        let createdThread = false;
        let targetProjectId = bootstrap?.createThread?.projectId;
        let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
        let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

        const cleanupCreatedThread = () =>
          createdThread
            ? orchestrationEngine
                .dispatch({
                  type: "thread.delete",
                  commandId: serverCommandId("bootstrap-thread-delete"),
                  threadId: command.threadId,
                })
                .pipe(Effect.ignoreCause({ log: true }))
            : Effect.void;

        const recordSetupScriptLaunchFailure = (input: {
          readonly error: unknown;
          readonly requestedAt: string;
          readonly worktreePath: string;
        }) => {
          const detail =
            input.error instanceof Error
              ? input.error.message
              : "Unknown setup failure.";
          return appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.failed",
            summary: "Setup script failed to start",
            createdAt: input.requestedAt,
            payload: {
              detail,
              worktreePath: input.worktreePath,
            },
            tone: "error",
          }).pipe(
            Effect.ignoreCause({ log: false }),
            Effect.flatMap(() =>
              Effect.logWarning(
                "bootstrap turn start failed to launch setup script",
                {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                },
              ),
            ),
          );
        };

        const recordSetupScriptStarted = (input: {
          readonly requestedAt: string;
          readonly worktreePath: string;
          readonly scriptId: string;
          readonly scriptName: string;
          readonly terminalId: string;
        }) => {
          const payload = {
            scriptId: input.scriptId,
            scriptName: input.scriptName,
            terminalId: input.terminalId,
            worktreePath: input.worktreePath,
          };
          return Effect.all([
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.requested",
              summary: "Starting setup script",
              createdAt: input.requestedAt,
              payload,
              tone: "info",
            }),
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.started",
              summary: "Setup script started",
              createdAt: new Date().toISOString(),
              payload,
              tone: "info",
            }),
          ]).pipe(
            Effect.asVoid,
            Effect.catch((error) =>
              Effect.logWarning(
                "bootstrap turn start launched setup script but failed to record setup activity",
                {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  scriptId: input.scriptId,
                  terminalId: input.terminalId,
                  detail:
                    error instanceof Error
                      ? error.message
                      : "Unknown setup activity dispatch failure.",
                },
              ),
            ),
          );
        };

        const runSetupProgram = () =>
          bootstrap?.runSetupScript && targetWorktreePath
            ? (() => {
                const worktreePath = targetWorktreePath;
                const requestedAt = new Date().toISOString();
                return projectSetupScriptRunner
                  .runForThread({
                    threadId: command.threadId,
                    ...(targetProjectId ? { projectId: targetProjectId } : {}),
                    ...(targetProjectCwd
                      ? { projectCwd: targetProjectCwd }
                      : {}),
                    worktreePath,
                  })
                  .pipe(
                    Effect.matchEffect({
                      onFailure: (error) =>
                        recordSetupScriptLaunchFailure({
                          error,
                          requestedAt,
                          worktreePath,
                        }),
                      onSuccess: (setupResult) => {
                        if (setupResult.status !== "started") {
                          return Effect.void;
                        }
                        return recordSetupScriptStarted({
                          requestedAt,
                          worktreePath,
                          scriptId: setupResult.scriptId,
                          scriptName: setupResult.scriptName,
                          terminalId: setupResult.terminalId,
                        });
                      },
                    }),
                  );
              })()
            : Effect.void;

        const bootstrapProgram = Effect.gen(function* () {
          if (bootstrap?.createThread) {
            yield* orchestrationEngine.dispatch({
              type: "thread.create",
              commandId: serverCommandId("bootstrap-thread-create"),
              threadId: command.threadId,
              projectId: bootstrap.createThread.projectId,
              title: bootstrap.createThread.title,
              modelSelection: bootstrap.createThread.modelSelection,
              runtimeMode: bootstrap.createThread.runtimeMode,
              interactionMode: bootstrap.createThread.interactionMode,
              branch: bootstrap.createThread.branch,
              worktreePath: bootstrap.createThread.worktreePath,
              createdAt: bootstrap.createThread.createdAt,
            });
            createdThread = true;
          }

          if (bootstrap?.prepareWorktree) {
            const worktree = yield* vcs.createWorktree({
              cwd: bootstrap.prepareWorktree.projectCwd,
              branch: bootstrap.prepareWorktree.baseBranch,
              newBranch: bootstrap.prepareWorktree.branch,
              path: null,
            });
            targetWorktreePath = worktree.worktree.path;
            yield* orchestrationEngine.dispatch({
              type: "thread.meta.update",
              commandId: serverCommandId("bootstrap-thread-meta-update"),
              threadId: command.threadId,
              branch: worktree.worktree.branch,
              worktreePath: targetWorktreePath,
            });
          }

          yield* runSetupProgram();

          return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
        });

        return yield* bootstrapProgram.pipe(
          Effect.catchCause((cause) => {
            const dispatchError = toBootstrapDispatchCommandCauseError(cause);
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.fail(dispatchError);
            }
            return cleanupCreatedThread().pipe(
              Effect.flatMap(() => Effect.fail(dispatchError)),
            );
          }),
        );
      });

    const dispatchNormalizedCommand = (
      normalizedCommand: OrchestrationCommand,
    ): Effect.Effect<
      { readonly sequence: number },
      OrchestrationDispatchCommandError
    > => {
      const dispatchEffect =
        normalizedCommand.type === "thread.turn.start" &&
        normalizedCommand.bootstrap
          ? dispatchBootstrapTurnStart(normalizedCommand)
          : orchestrationEngine
              .dispatch(normalizedCommand)
              .pipe(
                Effect.mapError((cause) =>
                  toDispatchCommandError(
                    cause,
                    "Failed to dispatch orchestration command",
                  ),
                ),
              );

      return startup
        .enqueueCommand(dispatchEffect)
        .pipe(
          Effect.mapError((cause) =>
            toDispatchCommandError(
              cause,
              "Failed to dispatch orchestration command",
            ),
          ),
        );
    };

    const loadServerConfig = Effect.gen(function* () {
      const keybindingsConfig = yield* keybindings.loadConfigState;
      const providers = yield* providerRegistry.getProviders;
      const settings = redactServerSettingsForClient(
        yield* serverSettings.getSettings,
      );
      const environment = yield* serverEnvironment.getDescriptor;
      const auth = yield* serverAuth.getDescriptor();

      return {
        environment,
        auth,
        cwd: config.cwd,
        gascity: makeGascityDiagnostics(config),
        keybindingsConfigPath: config.keybindingsConfigPath,
        keybindings: keybindingsConfig.keybindings,
        issues: keybindingsConfig.issues,
        providers,
        availableEditors: ExternalLauncher.resolveAvailableEditors(),
        observability: {
          logsDirectoryPath: config.logsDir,
          localTracingEnabled: true,
          ...(config.otlpTracesUrl !== undefined
            ? { otlpTracesUrl: config.otlpTracesUrl }
            : {}),
          otlpTracesEnabled: config.otlpTracesUrl !== undefined,
          ...(config.otlpMetricsUrl !== undefined
            ? { otlpMetricsUrl: config.otlpMetricsUrl }
            : {}),
          otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
        },
        settings,
      };
    });

    return WsRpcGroup.of({
      [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.dispatchCommand,
          Effect.gen(function* () {
            const normalizedCommand = yield* normalizeDispatchCommand(command);
            const result = yield* dispatchNormalizedCommand(normalizedCommand);
            if (normalizedCommand.type === "thread.archive") {
              yield* terminalManager
                .close({ threadId: normalizedCommand.threadId })
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning(
                      "failed to close thread terminals after archive",
                      {
                        threadId: normalizedCommand.threadId,
                        error: error.message,
                      },
                    ),
                  ),
                );
            }
            return result;
          }).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationDispatchCommandError)(cause)
                ? cause
                : new OrchestrationDispatchCommandError({
                    message: "Failed to dispatch orchestration command",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getTurnDiff,
          checkpointDiffQuery.getTurnDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetTurnDiffError({
                  message: "Failed to load turn diff",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getFullThreadDiff,
          checkpointDiffQuery.getFullThreadDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetFullThreadDiffError({
                  message: "Failed to load full thread diff",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.replayEvents,
          Stream.runCollect(
            orchestrationEngine.readEvents(
              clamp(input.fromSequenceExclusive, {
                maximum: Number.MAX_SAFE_INTEGER,
                minimum: 0,
              }),
            ),
          ).pipe(
            Effect.map((events) => Array.from(events)),
            Effect.mapError(
              (cause) =>
                new OrchestrationReplayEventsError({
                  message: "Failed to replay orchestration events",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getSnapshot,
          projectionSnapshotQuery.getShellSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration shell snapshot",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: (_input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
          (
            projectionSnapshotQuery.getArchivedShellSnapshot ??
            projectionSnapshotQuery.getShellSnapshot
          )().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration shell snapshot",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.searchThreadMessages]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.searchThreadMessages,
          (projectionSnapshotQuery.searchThreadMessages
            ? projectionSnapshotQuery.searchThreadMessages(
                input.query,
                input.limit,
              )
            : Effect.succeed({ results: [] })
          ).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationSearchThreadMessagesError({
                  message: "Failed to search thread messages",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.subscribeShell]: (_input) =>
        observeRpcStreamEffect(
          ORCHESTRATION_WS_METHODS.subscribeShell,
          Effect.gen(function* () {
            const initialSnapshot = yield* projectionSnapshotQuery
              .getShellSnapshot()
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Failed to load orchestration shell snapshot",
                      cause,
                    }),
                ),
              );
            return Stream.concat(
              Stream.make({
                kind: "snapshot" as const,
                snapshot: initialSnapshot,
              }),
              orchestrationEngine.streamDomainEvents.pipe(
                Stream.mapEffect(() =>
                  projectionSnapshotQuery.getShellSnapshot().pipe(
                    Effect.map((snapshot) => ({
                      kind: "snapshot" as const,
                      snapshot,
                    })),
                    Effect.mapError(
                      (cause) =>
                        new OrchestrationGetSnapshotError({
                          message:
                            "Failed to load orchestration shell snapshot",
                          cause,
                        }),
                    ),
                  ),
                ),
              ),
            );
          }),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
        observeRpcStreamEffect(
          ORCHESTRATION_WS_METHODS.subscribeThread,
          Effect.gen(function* () {
            const [snapshot, snapshotSequence] = yield* Effect.all([
              projectionSnapshotQuery.getThreadDetailById(input.threadId).pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: `Failed to load thread ${input.threadId}`,
                      cause,
                    }),
                ),
              ),
              projectionSnapshotQuery.getSnapshotSequence().pipe(
                Effect.map(({ snapshotSequence }) => snapshotSequence),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Failed to load orchestration snapshot sequence",
                      cause,
                    }),
                ),
              ),
            ]);
            const initial = Option.match(snapshot, {
              onNone: () => Stream.empty,
              onSome: (threadSnapshot) =>
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot: {
                    snapshotSequence,
                    thread: threadSnapshot,
                  },
                }),
            });
            const live = orchestrationEngine.streamDomainEvents.pipe(
              Stream.filter((event) => {
                const payload = event.payload as {
                  readonly threadId?: unknown;
                };
                return payload.threadId === input.threadId;
              }),
              Stream.map((event) => ({ kind: "event" as const, event })),
            );
            return Stream.concat(initial, live);
          }),
          { "rpc.aggregate": "orchestration" },
        ),
      [WS_METHODS.serverGetConfig]: (_input) =>
        observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.serverRefreshProviders]: (_input) =>
        observeRpcEffect(
          WS_METHODS.serverRefreshProviders,
          providerRegistry
            .refresh()
            .pipe(Effect.map((providers) => ({ providers }))),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverUpdateProvider]: (input) =>
        observeRpcEffect(
          WS_METHODS.serverUpdateProvider,
          providerMaintenanceRunner.updateProvider(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(ServerProviderUpdateError)(cause)
                ? cause
                : new ServerProviderUpdateError({
                    provider: input.provider,
                    reason: messageFromUnknown(cause),
                  }),
            ),
          ),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverUpsertKeybinding]: (rule) =>
        observeRpcEffect(
          WS_METHODS.serverUpsertKeybinding,
          Effect.gen(function* () {
            const keybindingsConfig =
              yield* keybindings.upsertKeybindingRule(rule);
            return { keybindings: keybindingsConfig, issues: [] };
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverRemoveKeybinding]: (input) =>
        observeRpcEffect(
          WS_METHODS.serverRemoveKeybinding,
          Effect.gen(function* () {
            const keybindingsConfig =
              yield* keybindings.removeKeybindingRule(input);
            return { keybindings: keybindingsConfig, issues: [] };
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverGetSettings]: (_input) =>
        observeRpcEffect(
          WS_METHODS.serverGetSettings,
          serverSettings.getSettings,
          {
            "rpc.aggregate": "server",
          },
        ),
      [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
        observeRpcEffect(
          WS_METHODS.serverUpdateSettings,
          serverSettings.updateSettings(patch),
          {
            "rpc.aggregate": "server",
          },
        ),
      [WS_METHODS.serverGetTraceDiagnostics]: (_input) =>
        observeRpcEffect(
          WS_METHODS.serverGetTraceDiagnostics,
          traceDiagnostics.read({
            traceFilePath: config.serverTracePath,
            maxFiles: 5,
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverGetProcessDiagnostics]: (_input) =>
        observeRpcEffect(
          WS_METHODS.serverGetProcessDiagnostics,
          processDiagnostics.read,
          {
            "rpc.aggregate": "server",
          },
        ),
      [WS_METHODS.serverGetProcessResourceHistory]: (input) =>
        observeRpcEffect(
          WS_METHODS.serverGetProcessResourceHistory,
          processResourceMonitor.readHistory(input),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverSignalProcess]: (input) =>
        observeRpcEffect(
          WS_METHODS.serverSignalProcess,
          processDiagnostics.signal(input),
          {
            "rpc.aggregate": "server",
          },
        ),
      [WS_METHODS.serverDiscoverSourceControl]: (_input) =>
        observeRpcEffect(
          WS_METHODS.serverDiscoverSourceControl,
          sourceControlDiscovery.discover,
          {
            "rpc.aggregate": "server",
          },
        ),
      [WS_METHODS.projectsSearchEntries]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsSearchEntries,
          workspaceEntries.search(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectSearchEntriesError({
                  message: `Failed to search workspace entries: ${cause.detail}`,
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.projectsWriteFile]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsWriteFile,
          workspaceFileSystem.writeFile(input).pipe(
            Effect.mapError((cause) => {
              const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                ? "Workspace file path must stay within the project root."
                : "Failed to write workspace file";
              return new ProjectWriteFileError({
                message,
                cause,
              });
            }),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.filesystemBrowse]: (input) =>
        observeRpcEffect(
          WS_METHODS.filesystemBrowse,
          workspaceEntries.browse(input).pipe(
            Effect.mapError(
              (cause) =>
                new FilesystemBrowseError({
                  message: `Failed to browse filesystem: ${cause.detail}`,
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.shellOpenInEditor]: (input) =>
        observeRpcEffect(
          WS_METHODS.shellOpenInEditor,
          externalLauncher.launchEditor(input),
          {
            "rpc.aggregate": "workspace",
          },
        ),
      [WS_METHODS.sourceControlLookupRepository]: (input) =>
        observeRpcEffect(
          WS_METHODS.sourceControlLookupRepository,
          sourceControlRepositoryService.lookupRepository(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(SourceControlRepositoryError)(cause)
                ? cause
                : new SourceControlRepositoryError({
                    provider: input.provider,
                    operation: "lookupRepository",
                    detail: messageFromUnknown(cause),
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "sourceControl" },
        ),
      [WS_METHODS.sourceControlCloneRepository]: (input) =>
        observeRpcEffect(
          WS_METHODS.sourceControlCloneRepository,
          sourceControlRepositoryService.cloneRepository(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(SourceControlRepositoryError)(cause)
                ? cause
                : new SourceControlRepositoryError({
                    provider: input.provider ?? "unknown",
                    operation: "cloneRepository",
                    detail: messageFromUnknown(cause),
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "sourceControl" },
        ),
      [WS_METHODS.sourceControlPublishRepository]: (input) =>
        observeRpcEffect(
          WS_METHODS.sourceControlPublishRepository,
          sourceControlRepositoryService.publishRepository(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(SourceControlRepositoryError)(cause)
                ? cause
                : new SourceControlRepositoryError({
                    provider: input.provider,
                    operation: "publishRepository",
                    detail: messageFromUnknown(cause),
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "sourceControl" },
        ),
      [WS_METHODS.vcsRefreshStatus]: (input) =>
        observeRpcEffect(
          WS_METHODS.vcsRefreshStatus,
          vcsManager.status(input),
          {
            "rpc.aggregate": "git",
          },
        ),
      [WS_METHODS.subscribeVcsStatus]: (input) =>
        observeRpcStream(
          WS_METHODS.subscribeVcsStatus,
          Stream.fromEffect(vcsManager.status(input)).pipe(
            Stream.map((status) => ({
              _tag: "snapshot" as const,
              local: {
                kind: status.kind,
                isRepo: status.isRepo,
                hasPrimaryRemote: status.hasPrimaryRemote,
                isDefaultRef: status.isDefaultRef,
                refName: status.refName,
                hasWorkingTreeChanges: status.hasWorkingTreeChanges,
                workingTree: status.workingTree,
              },
              remote: {
                hasUpstream: status.hasUpstream,
                aheadCount: status.aheadCount,
                behindCount: status.behindCount,
                pr: status.pr,
                defaultRefName: status.refName,
                aheadOfDefaultCount: status.aheadOfDefaultCount,
              },
            })),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.vcsPull]: (input) =>
        observeRpcEffect(
          WS_METHODS.vcsPull,
          vcs.pullCurrentBranch(input.cwd).pipe(
            Effect.map((result) => ({
              status: result.status,
              refName: result.refName ?? result.branch,
              upstreamRef: result.upstreamRef ?? result.upstreamBranch ?? null,
            })),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitRunStackedAction]: (input) =>
        observeRpcStream(
          WS_METHODS.gitRunStackedAction,
          Stream.callback<GitActionProgressEvent, GitManagerServiceError>(
            (queue) =>
              vcsManager
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) =>
                      Queue.offer(queue, event as GitActionProgressEvent).pipe(
                        Effect.asVoid,
                      ),
                  },
                })
                .pipe(
                  Effect.matchCauseEffect({
                    onFailure: (cause) => Queue.failCause(queue, cause),
                    onSuccess: () => Queue.end(queue).pipe(Effect.asVoid),
                  }),
                ),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitResolvePullRequest]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitResolvePullRequest,
          vcsManager.resolvePullRequest(input),
          {
            "rpc.aggregate": "git",
          },
        ),
      [WS_METHODS.gitPreparePullRequestThread]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitPreparePullRequestThread,
          vcsManager.preparePullRequestThread(input),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.vcsListRefs]: (input) =>
        observeRpcEffect(
          WS_METHODS.vcsListRefs,
          vcs.listBranches(input).pipe(
            Effect.map((result) => ({
              refs: result.refs,
              isRepo: result.isRepo,
              hasPrimaryRemote: result.hasPrimaryRemote,
              nextCursor: result.nextCursor,
              totalCount: result.totalCount,
            })),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.vcsCreateWorktree]: (input) =>
        observeRpcEffect(
          WS_METHODS.vcsCreateWorktree,
          vcs.createWorktree(input),
          {
            "rpc.aggregate": "git",
          },
        ),
      [WS_METHODS.vcsRemoveWorktree]: (input) =>
        observeRpcEffect(
          WS_METHODS.vcsRemoveWorktree,
          vcs.removeWorktree(input),
          {
            "rpc.aggregate": "git",
          },
        ),
      [WS_METHODS.vcsCreateRef]: (input) =>
        observeRpcEffect(
          WS_METHODS.vcsCreateRef,
          vcs
            .createBranch({
              cwd: input.cwd,
              branch: input.refName,
            })
            .pipe(Effect.as({ refName: input.refName })),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.vcsSwitchRef]: (input) =>
        observeRpcEffect(
          WS_METHODS.vcsSwitchRef,
          Effect.scoped(
            vcs.checkoutBranch({
              cwd: input.cwd,
              branch: input.refName,
            }),
          ).pipe(Effect.as({ refName: input.refName })),
          {
            "rpc.aggregate": "git",
          },
        ),
      [WS_METHODS.vcsInit]: (input) =>
        observeRpcEffect(
          WS_METHODS.vcsInit,
          vcsProvisioning.initRepository(input),
          {
            "rpc.aggregate": "git",
          },
        ),
      ...makeGcRpcHandlers({
        gcApiClient,
        gcContextProvider,
        projectionSnapshotQuery,
      }),
      [WS_METHODS.terminalOpen]: (input) =>
        observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalWrite]: (input) =>
        observeRpcEffect(
          WS_METHODS.terminalWrite,
          terminalManager.write(input),
          {
            "rpc.aggregate": "terminal",
          },
        ),
      [WS_METHODS.terminalResize]: (input) =>
        observeRpcEffect(
          WS_METHODS.terminalResize,
          terminalManager.resize(input),
          {
            "rpc.aggregate": "terminal",
          },
        ),
      [WS_METHODS.terminalClear]: (input) =>
        observeRpcEffect(
          WS_METHODS.terminalClear,
          terminalManager.clear(input),
          {
            "rpc.aggregate": "terminal",
          },
        ),
      [WS_METHODS.terminalRestart]: (input) =>
        observeRpcEffect(
          WS_METHODS.terminalRestart,
          terminalManager.restart(input),
          {
            "rpc.aggregate": "terminal",
          },
        ),
      [WS_METHODS.terminalClose]: (input) =>
        observeRpcEffect(
          WS_METHODS.terminalClose,
          terminalManager.close(input),
          {
            "rpc.aggregate": "terminal",
          },
        ),
      [WS_METHODS.subscribeTerminalEvents]: (_input) =>
        observeRpcStream(
          WS_METHODS.subscribeTerminalEvents,
          Stream.callback<TerminalEvent>((queue) =>
            Effect.acquireRelease(
              terminalManager.subscribe((event) => Queue.offer(queue, event)),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          ),
          { "rpc.aggregate": "terminal" },
        ),
      [WS_METHODS.subscribeServerConfig]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeServerConfig,
          Effect.gen(function* () {
            const keybindingsUpdates = keybindings.streamChanges.pipe(
              Stream.map((event) => ({
                version: 1 as const,
                type: "keybindingsUpdated" as const,
                payload: {
                  keybindings: event.keybindings,
                  issues: event.issues,
                },
              })),
            );
            const providerStatuses = providerRegistry.streamChanges.pipe(
              Stream.map((providers) => ({
                version: 1 as const,
                type: "providerStatuses" as const,
                payload: { providers },
              })),
            );
            const settingsUpdates = serverSettings.streamChanges.pipe(
              Stream.map((settings) => redactServerSettingsForClient(settings)),
              Stream.map((settings) => ({
                version: 1 as const,
                type: "settingsUpdated" as const,
                payload: { settings },
              })),
            );

            return Stream.concat(
              Stream.make({
                version: 1 as const,
                type: "snapshot" as const,
                config: yield* loadServerConfig,
              }),
              Stream.merge(
                keybindingsUpdates,
                Stream.merge(providerStatuses, settingsUpdates),
              ),
            );
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.subscribeAuthAccess]: (_input) =>
        observeRpcStream(
          WS_METHODS.subscribeAuthAccess,
          Stream.make({
            version: 1 as const,
            revision: 0,
            type: "snapshot" as const,
            payload: {
              pairingLinks: [],
              clientSessions: [],
            },
          }),
          { "rpc.aggregate": "auth" },
        ),
      [WS_METHODS.subscribeServerLifecycle]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeServerLifecycle,
          Effect.gen(function* () {
            const snapshot = yield* lifecycleEvents.snapshot;
            const snapshotEvents = Array.from(snapshot.events).toSorted(
              (left, right) => left.sequence - right.sequence,
            );
            const liveEvents = lifecycleEvents.stream.pipe(
              Stream.filter((event) => event.sequence > snapshot.sequence),
            );
            return Stream.concat(
              Stream.fromIterable(snapshotEvents),
              liveEvents,
            );
          }),
          { "rpc.aggregate": "server" },
        ),
    });
  }),
);

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(
      WsRpcGroup,
      {
        spanPrefix: "ws.rpc",
        spanAttributes: {
          "rpc.transport": "websocket",
          "rpc.system": "effect-rpc",
        },
      },
    ).pipe(
      Effect.provide(Layer.mergeAll(WsRpcLayer, RpcSerialization.layerJson)),
    );
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const config = yield* ServerConfig;
        if (config.authToken) {
          const url = HttpServerRequest.toURL(request);
          if (Option.isNone(url)) {
            return HttpServerResponse.text("Invalid WebSocket URL", {
              status: 400,
            });
          }
          const token = url.value.searchParams.get("token");
          if (token !== config.authToken) {
            return HttpServerResponse.text(
              "Unauthorized WebSocket connection",
              { status: 401 },
            );
          }
        }
        return yield* rpcWebSocketHttpEffect;
      }),
    );
  }),
);
