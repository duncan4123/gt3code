import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";

import { ServerConfig } from "./config.ts";
import {
  attachmentsRouteLayer,
  browserApiCorsLayer,
  otlpTracesProxyRouteLayer,
  projectFaviconRouteLayer,
  serverEnvironmentRouteLayer,
  staticAndDevRouteLayer,
} from "./http.ts";
import {
  authBearerBootstrapRouteLayer,
  authBootstrapRouteLayer,
  authBridgeWebSocketTokenRouteLayer,
  authClientsRevokeOthersRouteLayer,
  authClientsRevokeRouteLayer,
  authClientsRouteLayer,
  authPairingCredentialRouteLayer,
  authPairingLinksRevokeRouteLayer,
  authPairingLinksRouteLayer,
  authSessionRouteLayer,
  authWebSocketTokenRouteLayer,
} from "./auth/http.ts";
import {
  orchestrationDispatchRouteLayer,
  orchestrationSnapshotRouteLayer,
} from "./orchestration/http.ts";
import { fixPath } from "./os-jank.ts";
import { websocketRpcRouteLayer } from "./ws.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite.ts";
import { ServerLifecycleEventsLive } from "./serverLifecycleEvents.ts";
import { AnalyticsServiceLayerLive } from "./telemetry/Layers/AnalyticsService.ts";
import { ProviderSessionDirectoryLive } from "./provider/Layers/ProviderSessionDirectory.ts";
import { ProviderSessionRuntimeRepositoryLive } from "./persistence/Layers/ProviderSessionRuntime.ts";
import { ProviderAdapterRegistryLive } from "./provider/Layers/ProviderAdapterRegistry.ts";
import { ProviderEventLoggersLive } from "./provider/Layers/ProviderEventLoggers.ts";
import { ProviderInstanceRegistryHydrationLive } from "./provider/Layers/ProviderInstanceRegistryHydration.ts";
import { ProviderServiceLive } from "./provider/Layers/ProviderService.ts";
import { ProviderSessionReaperLive } from "./provider/Layers/ProviderSessionReaper.ts";
import { OpenCodeRuntimeLive } from "./provider/opencodeRuntime.ts";
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "./persistence/Layers/OrchestrationCommandReceipts.ts";
import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery.ts";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore.ts";
import { GitCoreLive } from "./vcs/GitVcsDriverCore.ts";
import { layer as GitHubCliLive } from "./sourceControl/GitHubCli.ts";
import { layer as RoutingTextGenerationLive } from "./textGeneration/TextGeneration.ts";
import { TerminalManagerLive } from "./terminal/Layers/Manager.ts";
import { GitManagerLive } from "./git/GitManager.ts";
import { JjCoreLive } from "./jj/Layers/JjCore.ts";
import { JjManagerLive } from "./jj/Layers/JjManager.ts";
import { KeybindingsLive } from "./keybindings.ts";
import { ServerRuntimeStartup, ServerRuntimeStartupLive } from "./serverRuntimeStartup.ts";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor.ts";
import { RuntimeReceiptBusLive } from "./orchestration/Layers/RuntimeReceiptBus.ts";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion.ts";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor.ts";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor.ts";
import { ThreadDeletionReactorLive } from "./orchestration/Layers/ThreadDeletionReactor.ts";
import { ProviderRegistryLive } from "./provider/Layers/ProviderRegistry.ts";
import { ServerSettingsLive } from "./serverSettings.ts";
import { GcApiClientLive } from "./gc/Layers/GcApiClient.ts";
import { GcContextProviderLive } from "./gc/Layers/GcContextProvider.ts";
import { ProjectFaviconResolverLive } from "./project/Layers/ProjectFaviconResolver.ts";
import { RepositoryIdentityResolverLive } from "./project/Layers/RepositoryIdentityResolver.ts";
import { layer as ProviderMaintenanceRunnerLive } from "./provider/providerMaintenanceRunner.ts";
import { layer as AzureDevOpsCliLive } from "./sourceControl/AzureDevOpsCli.ts";
import { layer as BitbucketApiLive } from "./sourceControl/BitbucketApi.ts";
import { layer as GitLabCliLive } from "./sourceControl/GitLabCli.ts";
import { layer as SourceControlDiscoveryLive } from "./sourceControl/SourceControlDiscovery.ts";
import { layer as SourceControlProviderRegistryLive } from "./sourceControl/SourceControlProviderRegistry.ts";
import { layer as SourceControlRepositoryServiceLive } from "./sourceControl/SourceControlRepositoryService.ts";
import { WorkspaceEntriesLive } from "./workspace/Layers/WorkspaceEntries.ts";
import { WorkspaceFileSystemLive } from "./workspace/Layers/WorkspaceFileSystem.ts";
import { WorkspacePathsLive } from "./workspace/Layers/WorkspacePaths.ts";
import { ProjectSetupScriptRunnerLive } from "./project/Layers/ProjectSetupScriptRunner.ts";
import { ObservabilityLive } from "./observability/Layers/Observability.ts";
import { VcsCoreLive } from "./vcs/Layers/VcsCore.ts";
import { VcsManagerLive } from "./vcs/Layers/VcsManager.ts";
import { layer as GitVcsDriverLive } from "./vcs/GitVcsDriver.ts";
import { layer as VcsProcessLive } from "./vcs/VcsProcess.ts";
import { layer as VcsDriverRegistryLive } from "./vcs/VcsDriverRegistry.ts";
import { layer as VcsProvisioningLive } from "./vcs/VcsProvisioningService.ts";
import { ServerEnvironmentLive } from "./environment/Layers/ServerEnvironment.ts";
import { ServerAuthLive } from "./auth/Layers/ServerAuth.ts";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore.ts";

const PtyAdapterLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const BunPTY = yield* Effect.promise(() => import("./terminal/Layers/BunPTY.ts"));
      return BunPTY.layer;
    } else {
      const NodePTY = yield* Effect.promise(() => import("./terminal/Layers/NodePTY.ts"));
      return NodePTY.layer;
    }
  }),
);

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (typeof Bun !== "undefined") {
      const BunHttpServer = yield* Effect.promise(
        () => import("@effect/platform-bun/BunHttpServer"),
      );
      return BunHttpServer.layer({
        port: config.port,
        ...(config.host ? { hostname: config.host } : {}),
      });
    } else {
      const [NodeHttpServer, NodeHttp] = yield* Effect.all([
        Effect.promise(() => import("@effect/platform-node/NodeHttpServer")),
        Effect.promise(() => import("node:http")),
      ]);
      return NodeHttpServer.layer(NodeHttp.createServer, {
        host: config.host,
        port: config.port,
      });
    }
  }),
);

const PlatformServicesLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const { layer } = yield* Effect.promise(() => import("@effect/platform-bun/BunServices"));
      return layer;
    } else {
      const { layer } = yield* Effect.promise(() => import("@effect/platform-node/NodeServices"));
      return layer;
    }
  }),
);

const ReactorLayerLive = Layer.empty.pipe(
  Layer.provideMerge(OrchestrationReactorLive),
  Layer.provideMerge(ProviderRuntimeIngestionLive),
  Layer.provideMerge(ProviderCommandReactorLive),
  Layer.provideMerge(CheckpointReactorLive),
  Layer.provideMerge(ThreadDeletionReactorLive),
  Layer.provideMerge(RuntimeReceiptBusLive),
);

const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStoreLive,
  OrchestrationCommandReceiptRepositoryLive,
);

const OrchestrationProjectionPipelineLayerLive = OrchestrationProjectionPipelineLive.pipe(
  Layer.provide(OrchestrationEventStoreLive),
);

const OrchestrationInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationProjectionSnapshotQueryLive,
  OrchestrationEventInfrastructureLayerLive,
  OrchestrationProjectionPipelineLayerLive,
);

const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineLive.pipe(Layer.provide(OrchestrationInfrastructureLayerLive)),
);

const CheckpointingLayerLive = Layer.empty.pipe(
  Layer.provideMerge(CheckpointDiffQueryLive),
  Layer.provideMerge(CheckpointStoreLive),
);

const ProviderSessionDirectoryLayerLive = ProviderSessionDirectoryLive.pipe(
  Layer.provide(ProviderSessionRuntimeRepositoryLive),
);

const ProviderLayerLive = ProviderServiceLive.pipe(
  Layer.provide(ProviderAdapterRegistryLive),
  Layer.provideMerge(ProviderSessionDirectoryLayerLive),
);

const ProviderRegistryLayerLive = ProviderRegistryLive.pipe(
  Layer.provideMerge(ProviderInstanceRegistryHydrationLive),
  Layer.provideMerge(ProviderEventLoggersLive),
  Layer.provideMerge(OpenCodeRuntimeLive),
);

const ProviderRuntimeLayerLive = ProviderSessionReaperLive.pipe(
  Layer.provideMerge(ProviderLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
);

const PersistenceLayerLive = Layer.empty.pipe(Layer.provideMerge(SqlitePersistenceLayerLive));

const AuthLayerLive = ServerAuthLive.pipe(
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provide(ServerSecretStoreLive),
);

const GitBackendLayerLive = Layer.empty.pipe(
  Layer.provideMerge(
    GitManagerLive.pipe(
      Layer.provideMerge(ProjectSetupScriptRunnerLive),
      Layer.provideMerge(GitCoreLive),
      Layer.provideMerge(GitHubCliLive),
      Layer.provideMerge(RoutingTextGenerationLive),
    ),
  ),
  Layer.provideMerge(GitCoreLive),
);

const JjBackendLayerLive = Layer.empty.pipe(
  Layer.provideMerge(
    JjManagerLive.pipe(
      Layer.provideMerge(ProjectSetupScriptRunnerLive),
      Layer.provideMerge(JjCoreLive.pipe(Layer.provideMerge(GitCoreLive))),
      Layer.provideMerge(GitHubCliLive),
      Layer.provideMerge(RoutingTextGenerationLive),
    ),
  ),
  Layer.provideMerge(JjCoreLive.pipe(Layer.provideMerge(GitCoreLive))),
);

const VcsLayerLive = Layer.empty.pipe(
  Layer.provideMerge(VcsDriverRegistryLive),
  Layer.provideMerge(VcsProvisioningLive),
  Layer.provideMerge(
    VcsCoreLive.pipe(
      Layer.provideMerge(JjBackendLayerLive),
      Layer.provideMerge(GitBackendLayerLive),
    ),
  ),
  Layer.provideMerge(
    VcsManagerLive.pipe(
      Layer.provideMerge(JjBackendLayerLive),
      Layer.provideMerge(GitBackendLayerLive),
    ),
  ),
);

const BitbucketApiLayerLive = BitbucketApiLive.pipe(
  Layer.provideMerge(GitVcsDriverLive),
  Layer.provideMerge(VcsDriverRegistryLive),
);

const SourceControlProviderRegistryLayerLive = SourceControlProviderRegistryLive.pipe(
  Layer.provideMerge(GitHubCliLive),
  Layer.provideMerge(GitLabCliLive),
  Layer.provideMerge(AzureDevOpsCliLive),
  Layer.provideMerge(BitbucketApiLayerLive),
  Layer.provideMerge(VcsDriverRegistryLive),
  Layer.provideMerge(VcsProcessLive),
);

const SourceControlLayerLive = Layer.empty.pipe(
  Layer.provideMerge(GitVcsDriverLive),
  Layer.provideMerge(GitHubCliLive),
  Layer.provideMerge(GitLabCliLive),
  Layer.provideMerge(AzureDevOpsCliLive),
  Layer.provideMerge(BitbucketApiLayerLive),
  Layer.provideMerge(VcsDriverRegistryLive),
  Layer.provideMerge(SourceControlProviderRegistryLayerLive),
  Layer.provideMerge(
    SourceControlDiscoveryLive.pipe(Layer.provideMerge(SourceControlProviderRegistryLayerLive)),
  ),
  Layer.provideMerge(
    SourceControlRepositoryServiceLive.pipe(
      Layer.provideMerge(GitVcsDriverLive),
      Layer.provideMerge(SourceControlProviderRegistryLayerLive),
    ),
  ),
);

const TerminalLayerLive = TerminalManagerLive.pipe(Layer.provide(PtyAdapterLive));

const WorkspaceLayerLive = Layer.mergeAll(
  WorkspacePathsLive,
  WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)),
  WorkspaceFileSystemLive.pipe(
    Layer.provide(WorkspacePathsLive),
    Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
  ),
);

const RuntimeCoreDependenciesBaseLive = ReactorLayerLive.pipe(
  // Core Services
  Layer.provideMerge(CheckpointingLayerLive),
  Layer.provideMerge(GitBackendLayerLive),
  Layer.provideMerge(JjBackendLayerLive),
  Layer.provideMerge(VcsLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(ProviderRuntimeLayerLive),
  Layer.provideMerge(TerminalLayerLive),
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provideMerge(KeybindingsLive),
  Layer.provideMerge(ProviderRegistryLayerLive),
  Layer.provideMerge(ProviderInstanceRegistryHydrationLive),
  Layer.provideMerge(ProviderEventLoggersLive),
  Layer.provideMerge(OpenCodeRuntimeLive),
  Layer.provideMerge(ServerSettingsLive),
);

const RuntimeCoreDependenciesLive = RuntimeCoreDependenciesBaseLive.pipe(
  Layer.provideMerge(
    ProviderMaintenanceRunnerLive.pipe(Layer.provideMerge(ProviderRegistryLayerLive)),
  ),
  Layer.provideMerge(SourceControlLayerLive),
  Layer.provideMerge(
    GcContextProviderLive.pipe(
      Layer.provideMerge(GcApiClientLive.pipe(Layer.provideMerge(ServerSettingsLive))),
    ),
  ),
  Layer.provideMerge(WorkspaceLayerLive),
  Layer.provideMerge(ProjectFaviconResolverLive),
  Layer.provideMerge(RepositoryIdentityResolverLive),
  Layer.provideMerge(AuthLayerLive),
);

const RuntimeDependenciesLive = RuntimeCoreDependenciesLive.pipe(
  // Misc.
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(PlatformServicesLive),
  Layer.provideMerge(AnalyticsServiceLayerLive),
  Layer.provideMerge(ExternalLauncher.layer),
  Layer.provideMerge(ServerLifecycleEventsLive),
  Layer.provideMerge(VcsProcessLive),
  Layer.provideMerge(ServerEnvironmentLive),
);

const RuntimeServicesLive = Layer.merge(
  RuntimeDependenciesLive,
  ServerRuntimeStartupLive.pipe(Layer.provideMerge(RuntimeDependenciesLive)),
);

export const makeRoutesLayer = Layer.mergeAll(
  authBearerBootstrapRouteLayer,
  authBootstrapRouteLayer,
  authBridgeWebSocketTokenRouteLayer,
  authClientsRevokeOthersRouteLayer,
  authClientsRevokeRouteLayer,
  authClientsRouteLayer,
  authPairingCredentialRouteLayer,
  authPairingLinksRevokeRouteLayer,
  authPairingLinksRouteLayer,
  authSessionRouteLayer,
  authWebSocketTokenRouteLayer,
  attachmentsRouteLayer,
  orchestrationDispatchRouteLayer,
  orchestrationSnapshotRouteLayer,
  otlpTracesProxyRouteLayer,
  projectFaviconRouteLayer,
  serverEnvironmentRouteLayer,
  staticAndDevRouteLayer,
  websocketRpcRouteLayer.pipe(Layer.provide(RuntimeServicesLive)),
).pipe(Layer.provide(browserApiCorsLayer));

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    fixPath();

    const httpListeningLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* HttpServer.HttpServer;
        const startup = yield* ServerRuntimeStartup;
        yield* startup.markHttpListening;
      }),
    );

    const serverApplicationLayer = Layer.mergeAll(
      HttpRouter.serve(makeRoutesLayer, {
        disableLogger: !config.logWebSocketEvents,
      }),
      httpListeningLayer,
    );

    return serverApplicationLayer.pipe(
      Layer.provide(RuntimeServicesLive),
      Layer.provideMerge(HttpServerLive),
      Layer.provide(ObservabilityLive),
      Layer.provideMerge(FetchHttpClient.layer),
    );
  }),
);

// Important: Only `ServerConfig` should be provided by the CLI layer!!! Don't let other requirements leak into the launch layer.
const runServerLayer = Layer.launch(makeServerLayer);
export const runServer = runServerLayer as Effect.Effect<never, any, ServerConfig>;
