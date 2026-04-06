# T3 Code Domain Summaries for Gascity Integration

Generated from the `verbatim` branch. Each domain summary focuses on what the domain does, its key types/functions, and how it maps to gascity (beads, convoys, formulas).

---

## apps/server/src/ (Node.js Server)

### === WebSocket/RPC (ws.ts, rpc.ts) ===

The WebSocket RPC layer exposes a single `/ws` endpoint that serves all client-server communication using Effect RPC over WebSocket. It resolves all service dependencies (orchestration engine, git, terminal, provider registry, workspace, settings) and routes incoming RPC calls to the appropriate service, with auth-token gating and OpenTelemetry instrumentation.

**Key types/functions:**
- `WsRpcGroup` -- the unified RPC group containing all method definitions
- `WS_METHODS` -- constant map of ~30 method names across 7 domains (orchestration, terminal, git, server, projects, shell, subscriptions)
- `ORCHESTRATION_WS_METHODS` -- orchestration-specific: `getSnapshot`, `dispatchCommand`, `getTurnDiff`, `getFullThreadDiff`, `replayEvents`
- `WsRpcLayer` -- Effect Layer wiring all service dependencies to RPC handlers
- `websocketRpcRouteLayer` -- HTTP route layer mounting the `/ws` endpoint
- `dispatchBootstrapTurnStart()` -- atomic bootstrap: create thread + prepare worktree + run setup script + start turn
- `dispatchNormalizedCommand()` -- normalize then dispatch any orchestration command through the startup queue
- `subscribeOrchestrationDomainEvents` -- streaming subscription with sequence-ordered delivery and gap buffering
- `subscribeServerConfig` -- streams keybinding, provider status, and settings updates
- `subscribeServerLifecycle` -- streams welcome and ready lifecycle events
- `subscribeTerminalEvents` -- streams terminal output/state events

**Gascity integration surface:**
- The RPC group is the primary integration point. Gascity formulas could call `dispatchCommand` to orchestrate threads (create, start turns, interrupt, archive). The `subscribeOrchestrationDomainEvents` stream maps directly to a gascity convoy event feed -- each event carries a monotonic `sequence` and `correlationId` that align with bead tracking. The bootstrap envelope pattern (create thread + worktree + turn atomically) maps to a gascity formula that spins up a new bead. Server config subscriptions could feed gascity's provider health monitoring.

---

### === Orchestration (orchestration/) ===

The orchestration domain implements an event-sourced CQRS engine for managing projects, threads, turns, messages, approvals, checkpoints, and sessions. Commands are validated by a `decider`, persisted as events through an `OrchestrationEventStore`, and projected into a read model by a `projector`. Reactors subscribe to events to trigger side effects (provider commands, checkpoint creation, runtime ingestion).

**Key types/functions:**
- `OrchestrationEngineService` -- service interface: `dispatch(command)`, `getReadModel()`, `readEvents(fromSeq)`, `streamDomainEvents`
- `OrchestrationEngineLive` -- Effect Layer implementing the engine with serialized dispatch queue and command deduplication
- `decider.ts` -- pure decision function: `(readModel, command) => events[]`, validates invariants (thread exists, turn not running, etc.)
- `projector.ts` -- pure fold: `(readModel, event) => readModel`, applies 22 event types to update projects/threads/sessions/messages/checkpoints/activities
- `commandInvariants.ts` -- validation rules applied before decision
- `Normalizer.ts` -- normalizes client commands (e.g., upload attachments, resolve model slugs)
- **Services:**
  - `ProjectionSnapshotQuery` -- reads the current read model snapshot, serves `getSnapshot` RPC
  - `ProjectionPipeline` -- subscribes to event store and applies projector to SQLite-backed projection tables
  - `CheckpointReactor` -- reacts to turn completion events to create git checkpoints
  - `ProviderCommandReactor` -- reacts to `thread.turn-start-requested` / `thread.turn-interrupt-requested` / `thread.approval-response-requested` / `thread.session-stop-requested` to drive the provider service
  - `ProviderRuntimeIngestion` -- ingests `ProviderRuntimeEvent` streams from adapters, maps them to orchestration commands (session.set, message.assistant.delta, activity.append, turn.diff.complete, etc.)
  - `RuntimeReceiptBus` -- in-memory pub/sub for provider dispatch receipts
  - `OrchestrationReactor` -- umbrella that starts all reactors as fibers

**Gascity integration surface:**
- The event-sourced architecture is a natural fit for gascity beads. Each `OrchestrationEvent` (22 types) maps to a bead state transition. The `decider` is a pure formula -- gascity could wrap it to validate bead commands externally. The `ProviderCommandReactor` maps to a gascity convoy reactor pattern: events trigger downstream work. `ProviderRuntimeIngestion` is the ingest pipeline that translates provider-native events into domain events -- gascity could add parallel ingest pipelines for additional providers. Checkpoints (git-based) map to bead snapshots.

---

### === Provider (provider/) ===

The provider domain manages coding-agent backend sessions (Codex and Claude). It routes session lifecycle (start, send turn, interrupt, stop) through a `ProviderService` facade that resolves the correct adapter via `ProviderAdapterRegistry`. Each adapter (CodexAdapter, ClaudeAdapter) owns the provider-specific protocol: Codex uses JSON-RPC over stdio to `codex app-server`, Claude uses the Claude Agent SDK. Adapters emit a canonical `ProviderRuntimeEvent` stream consumed by the orchestration ingestion pipeline.

**Key types/functions:**
- `ProviderService` -- facade: `startSession()`, `sendTurn()`, `interruptTurn()`, `respondToRequest()`, `respondToUserInput()`, `stopSession()`, `listSessions()`, `getCapabilities()`, `rollbackConversation()`, `streamEvents`
- `ProviderAdapterShape<TError>` -- adapter contract: `startSession`, `sendTurn`, `interruptTurn`, `respondToRequest`, `respondToUserInput`, `stopSession`, `listSessions`, `hasSession`, `readThread`, `rollbackThread`, `stopAll`, `streamEvents`
- `ProviderAdapterRegistry` -- resolves adapter by `ProviderKind` ("codex" | "claudeAgent")
- `ProviderSessionDirectory` -- tracks active sessions per thread, backed by SQLite
- `ProviderRegistry` -- discovers installed providers, checks auth status, enumerates models
- `CodexAdapter` / `CodexProvider` -- wraps `codex app-server` (JSON-RPC stdio), manages process lifecycle
- `ClaudeAdapter` / `ClaudeProvider` -- wraps Claude Agent SDK, manages session lifecycle
- `EventNdjsonLogger` -- persists native and canonical provider events to NDJSON log files
- `makeManagedServerProvider()` -- health-check + version-check utility for provider binaries
- `ProviderSession` -- schema: provider, status (connecting/ready/running/error/closed), threadId, runtimeMode, model, resumeCursor, activeTurnId
- `ProviderEvent` -- schema: id, kind (session/notification/request/error), provider, threadId, method, textDelta, payload
- `ProviderRuntimeEvent` -- 30+ canonical event types: `session.state`, `turn.started`, `turn.completed`, `content.stream`, `item.status`, `plan.step`, `approval.requested`, `user-input.requested`, `error`, `session.exit`, etc.

**Gascity integration surface:**
- Each provider adapter is a gascity formula executor -- it runs a coding agent and streams structured events. The `ProviderAdapterShape` interface is the contract a new gascity-native adapter would implement. `ProviderSessionDirectory` maps to gascity's bead-to-executor assignment. The `ProviderRuntimeEvent` stream (30+ types) is the raw event feed that gascity could consume for observability, replay, or multi-agent coordination. Adding a new provider (e.g., a gascity-orchestrated agent pool) means implementing `ProviderAdapterShape` and registering it in `ProviderAdapterRegistry`.

---

### === Persistence (persistence/) ===

The persistence domain owns all SQLite-backed storage: the event store, projection tables, and provider session runtime state. It uses Effect's `SqliteClient` with a migration framework. Projection tables are populated by `ProjectionPipeline` from the orchestration event stream and serve the read model for snapshot queries.

**Key types/functions:**
- `OrchestrationEventStore` -- service: `append(event)`, `readFromSequence(seq, limit)`, `readAll()`
- `OrchestrationCommandReceipts` -- service: `find(commandId)`, `insert(receipt)` -- deduplication
- `ProjectionState` -- stores the last-applied sequence for projection recovery
- `ProjectionThreads` -- thread CRUD projection table
- `ProjectionThreadMessages` -- message upsert/streaming projection
- `ProjectionThreadSessions` -- session state projection
- `ProjectionThreadActivities` -- activity log projection
- `ProjectionThreadProposedPlans` -- plan proposal projection
- `ProjectionTurns` -- turn lifecycle projection with status tracking
- `ProjectionCheckpoints` -- checkpoint metadata projection
- `ProjectionPendingApprovals` -- pending approval request projection
- `ProjectionProjects` -- project CRUD projection
- `ProviderSessionRuntime` -- tracks provider process runtime state per session
- `NodeSqliteClient` -- custom better-sqlite3 wrapper for Effect SqlClient
- `Migrations.ts` -- migration runner with versioned SQL migrations
- `DoltLifecycle.ts` -- optional Dolt version-control lifecycle for the SQLite database
- `Sqlite.ts` (Layer) -- configures SQLite client with WAL mode and runs migrations

**Gascity integration surface:**
- The event store is the system of record. Gascity could read `OrchestrationEventStore.readFromSequence()` to replay history into its own projections. The projection table structure maps to gascity bead state tables. `DoltLifecycle` enables Dolt-based version control of the SQLite state, which maps to gascity's convoy branching model. The migration framework could be extended for gascity-specific projection tables.

---

### === Config (config.ts) ===

Defines all process-level server configuration: paths, ports, runtime mode, observability settings. `ServerConfig` is an Effect service providing the shape consumed by all other layers. It derives paths from a base directory and ensures directory structure on startup.

**Key types/functions:**
- `ServerConfig` -- Effect service tag for `ServerConfigShape`
- `ServerConfigShape` -- interface: `logLevel`, `mode` ("web" | "desktop"), `port`, `host`, `cwd`, `baseDir`, `staticDir`, `devUrl`, `authToken`, `autoBootstrapProjectFromCwd`, `dbPath`, `worktreesDir`, `logsDir`, `settingsPath`, etc.
- `ServerDerivedPaths` -- derived: `stateDir`, `dbPath`, `keybindingsConfigPath`, `settingsPath`, `worktreesDir`, `attachmentsDir`, `logsDir`, `providerLogsDir`, `terminalLogsDir`, `anonymousIdPath`
- `deriveServerPaths()` -- pure function deriving all paths from baseDir + devUrl
- `ensureServerDirectories()` -- creates all required directories
- `resolveStaticDir()` -- locates bundled client assets
- `RuntimeMode` -- "web" | "desktop"
- `DEFAULT_PORT` -- 3773

**Gascity integration surface:**
- `ServerConfig` is the entry point for gascity to configure T3 Code as a managed service. `autoBootstrapProjectFromCwd` could be set by gascity when spawning T3 instances per workspace. The derived paths structure maps to gascity's per-instance isolation model. The `authToken` enables gascity to secure WebSocket connections.

---

### === Server Startup (server.ts) ===

Composes the entire server runtime as a layered Effect dependency graph. It merges all service layers (orchestration, provider, persistence, git, terminal, workspace, keybindings, settings, observability, analytics) into a single `makeServerLayer`, then adds HTTP routing and the WebSocket RPC endpoint.

**Key types/functions:**
- `makeServerLayer` -- the complete server Layer, requires only `ServerConfig`
- `runServer` -- launches the server layer (Effect.launch)
- `makeRoutesLayer` -- merges: `attachmentsRouteLayer`, `otlpTracesProxyRouteLayer`, `projectFaviconRouteLayer`, `staticAndDevRouteLayer`, `websocketRpcRouteLayer`
- `ReactorLayerLive` -- composes all event reactors: `OrchestrationReactorLive`, `ProviderRuntimeIngestionLive`, `ProviderCommandReactorLive`, `CheckpointReactorLive`, `RuntimeReceiptBusLive`
- `OrchestrationLayerLive` -- event store + engine + projection pipeline + snapshot query
- `ProviderLayerLive` -- adapter registry + session directory + event loggers
- `PersistenceLayerLive` -- SQLite client + migrations
- `GitLayerLive` -- git core + GitHub CLI + text generation + git manager + setup script runner
- `TerminalLayerLive` -- PTY adapter (Bun or Node) + terminal manager
- `WorkspaceLayerLive` -- path resolution + file search + file write
- `PtyAdapterLive` -- runtime-detected PTY (BunPTY or NodePTY)
- `HttpServerLive` -- runtime-detected HTTP server (Bun or Node)
- `PlatformServicesLive` -- runtime-detected platform services

**Gascity integration surface:**
- The layer composition pattern is a gascity formula graph. Each service layer is an independently testable unit that gascity could compose selectively. `ReactorLayerLive` is the event-driven automation layer -- gascity convoys could add custom reactors. The platform detection (Bun vs Node) maps to gascity's runtime environment management. `runServer` is what gascity would call to spawn a T3 Code instance.

---

### === Bootstrap (bootstrap.ts) ===

Reads a JSON envelope from a file descriptor at server startup. This enables the desktop app (or any parent process) to pass initial configuration (e.g., project path, auth token) to the server through an fd-pipe rather than CLI arguments or environment variables.

**Key types/functions:**
- `readBootstrapEnvelope(schema, fd, options?)` -- reads one JSON line from fd, decodes with Effect Schema, returns `Option<A>`
- `BootstrapError` -- tagged error for fd-read/decode failures
- `resolveFdPath(fd, platform)` -- resolves `/proc/self/fd/N` or `/dev/fd/N` by platform
- `isFdReady(fd)` -- checks fd availability via `fstatSync`
- `makeBootstrapInputStream(fd)` -- creates readable stream from fd with fallback strategies

**Gascity integration surface:**
- The bootstrap envelope pattern maps to gascity's bead initialization protocol. When gascity spawns a T3 Code process as a bead executor, it can pass a bootstrap envelope containing the bead ID, convoy context, and formula parameters through the fd pipe. This avoids environment variable leakage and enables structured initialization.

---

### === Desktop (apps/desktop/src/main.ts) ===

Electron desktop shell that spawns the Node.js server as a child process, creates a BrowserWindow pointed at the server's WebSocket URL, and bridges native OS features (file picker, context menus, theme, auto-update) to the web UI via IPC channels.

**Key types/functions:**
- `DesktopBridge` -- IPC interface exposed to renderer: `getWsUrl`, `pickFolder`, `confirm`, `setTheme`, `showContextMenu`, `openExternal`, `onMenuAction`, `getUpdateState`, `checkForUpdate`, `downloadUpdate`, `installUpdate`, `onUpdateState`
- `DesktopUpdateState` -- auto-updater state machine: status (idle/checking/available/downloading/downloaded/error), versions, progress
- `DesktopRuntimeInfo` -- host/app architecture detection (arm64 translation awareness)
- IPC channels: `desktop:pick-folder`, `desktop:confirm`, `desktop:set-theme`, `desktop:context-menu`, `desktop:open-external`, `desktop:menu-action`, `desktop:update-*`, `desktop:get-ws-url`
- Server spawn: child process with `--mode desktop`, auth token, port allocation
- Protocol handler: `t3://` custom protocol for deep linking

**Gascity integration surface:**
- The desktop app is a distribution shell. Gascity could replace or extend it to embed T3 Code as a panel in a gascity desktop client. The `DesktopBridge` IPC interface maps to gascity's host-to-bead communication channel. The auto-updater state machine maps to a gascity formula for managed deployments. The `t3://` protocol handler enables gascity deep links to specific threads/projects.

---

## apps/web/src/ (React/Vite UI)

### === Store (store.ts) ===

Zustand store that holds the entire client-side application state: projects, threads, sidebar summaries, and per-project thread indices. It consumes `OrchestrationEvent` from the server via a pure `applyOrchestrationEvent()` reducer and maps server schemas to client-side types. The store is the single source of truth for the UI.

**Key types/functions:**
- `AppState` -- shape: `projects: Project[]`, `threads: Thread[]`, `sidebarThreadsById: Record<string, SidebarThreadSummary>`, `threadIdsByProjectId: Record<string, ThreadId[]>`, `bootstrapComplete: boolean`
- `useStore` -- Zustand hook
- `applyOrchestrationEvent(state, event)` -- pure reducer handling all 22 event types
- `applyOrchestrationSnapshot(readModel)` -- bulk initializes state from server snapshot
- `mapThread(OrchestrationThread)` -- maps server thread to client `Thread`
- `mapProject(OrchestrationProject)` -- maps server project to client `Project`
- `mapSession(OrchestrationSession)` -- maps to client `ThreadSession`
- `mapMessage(OrchestrationMessage)` -- maps to client `ChatMessage`
- `buildSidebarThreadSummary(thread)` -- derives sidebar-optimized summaries with pending approvals/plans
- `updateThread(threads, threadId, updater)` -- immutable thread update helper
- Limits: `MAX_THREAD_MESSAGES=2000`, `MAX_THREAD_CHECKPOINTS=500`, `MAX_THREAD_ACTIVITIES=500`

**Gascity integration surface:**
- The store's event-sourced reducer (`applyOrchestrationEvent`) could be reused by gascity to maintain a synchronized read model in a different UI context. `SidebarThreadSummary` provides the minimal projection gascity needs for a dashboard bead list. The `customMetadata` field on `Thread` (opaque key-value, `gc.*` keys) is the designated extension point for gascity-specific metadata on threads.

---

### === Types (types.ts) ===

Client-side type definitions for the UI layer, mapping from server contracts to UI-friendly shapes.

**Key types/functions:**
- `Thread` -- id, projectId, title, modelSelection, runtimeMode, interactionMode, session, messages, proposedPlans, error, latestTurn, branch, worktreePath, turnDiffSummaries, activities, customMetadata
- `ChatMessage` -- id, role (user/assistant/system), text, attachments, turnId, createdAt, streaming, completedAt
- `Project` -- id, name, cwd, defaultModelSelection, scripts
- `ThreadSession` -- provider, status (SessionPhase | error | closed), orchestrationStatus, activeTurnId, lastError
- `SidebarThreadSummary` -- lightweight thread info for sidebar: hasPendingApprovals, hasPendingUserInput, hasActionableProposedPlan
- `SessionPhase` -- "disconnected" | "connecting" | "ready" | "running"
- `ProposedPlan` -- id, turnId, planMarkdown, implementedAt, implementationThreadId
- `TurnDiffSummary` -- turnId, completedAt, status, files, checkpointRef, checkpointTurnCount
- `TurnDiffFileChange` -- path, kind, additions, deletions
- `ChatImageAttachment` -- id, name, mimeType, sizeBytes, previewUrl
- `ProjectScript` -- re-export of contract type

**Gascity integration surface:**
- `Thread.customMetadata` is the primary extension point for gascity bead metadata (e.g., `gc.beadId`, `gc.convoyId`, `gc.formulaRef`). `SidebarThreadSummary` is the minimal data shape gascity needs for convoy dashboards. The `ProposedPlan` type maps to gascity formula proposals (plan-then-execute pattern). `TurnDiffSummary` maps to bead checkpoint diffs.

---

### === Session Logic (session-logic.ts) ===

Pure functions for deriving UI state from thread activities: pending approvals, pending user inputs, work log entries, active plans, proposed plan state, and timeline entries. This is the business logic layer between the store and components.

**Key types/functions:**
- `derivePendingApprovals(activities)` -- extracts open approval requests from activities
- `derivePendingUserInputs(activities)` -- extracts open user-input requests
- `deriveWorkLog(activities, latestTurn)` -- builds `WorkLogEntry[]` from activities, collapsing tool lifecycles
- `deriveActivePlan(activities, latestTurn)` -- extracts active plan steps and statuses
- `findLatestProposedPlan(proposedPlans, turnId)` -- finds the most recent proposed plan
- `hasActionableProposedPlan(plan)` -- checks if a plan can be implemented
- `deriveTimelineEntries(messages, proposedPlans, workLog)` -- interleaves messages, plans, and work into a unified timeline
- `isLatestTurnSettled(latestTurn, session)` -- checks if the current turn has completed
- `deriveActiveWorkStartedAt(latestTurn, session, sendStartedAt)` -- derives when active work began
- `WorkLogEntry` -- id, label, detail, command, changedFiles, tone (thinking/tool/info/error), toolTitle, itemType, requestKind
- `PendingApproval` -- requestId, requestKind (command/file-read/file-change), createdAt, detail
- `PendingUserInput` -- requestId, questions
- `ActivePlanState` -- steps with pending/inProgress/completed statuses
- `TimelineEntry` -- discriminated union: message | proposed-plan | work

**Gascity integration surface:**
- `derivePendingApprovals()` maps to gascity's bead approval queue -- gascity could auto-respond based on formula policies. `deriveActivePlan()` maps to formula step tracking. `deriveTimelineEntries()` provides the unified event feed gascity needs for bead activity dashboards. The `WorkLogEntry` type maps to gascity observability records.

---

### === Components ===

**Sidebar.tsx / Sidebar.logic.ts** -- Project/thread navigation sidebar. Shows projects with nested thread lists, sorted by configurable order. Supports archive/unarchive/delete, drag reordering, and new-thread creation. `Sidebar.logic.ts` contains pure sort/filter/group logic.

Key functions: `sortSidebarThreads()`, `filterThreadsBySearch()`, `groupThreadsByProject()`, `getFallbackThreadIdAfterDelete()`, `orderItemsByPreferredIds()`, `deriveSidebarProjectGroups()`

**ChatView.tsx / ChatView.logic.ts** -- Main conversation view. Renders message timeline, work log, proposed plans, approval prompts, user-input forms, and the composer. Manages scroll behavior, streaming message display, and turn lifecycle UI.

Key functions: `deriveChatViewState()`, `deriveScrollBehavior()`, `isComposerDisabled()`, `deriveVisibleProposedPlan()`

**AppSidebarLayout.tsx** -- Layout shell combining sidebar + main content area with responsive collapsing.

**PlanSidebar.tsx** -- Displays proposed plans from the assistant with "Implement" action to spawn implementation threads.

**ProjectScriptsControl.tsx** -- Manages per-project setup scripts that run on worktree creation.

**BranchToolbar.tsx** -- Git branch selector and worktree management toolbar.

**GitActionsControl.tsx** -- Git action runner for stacked operations (commit, push, PR).

**DiffPanel.tsx** -- Unified diff viewer for turn and thread diffs.

**ThreadTerminalDrawer.tsx** -- Embedded terminal panel per thread with multiple tabs.

**WebSocketConnectionSurface.tsx** -- WebSocket connection status indicator and reconnection coordinator.

**PullRequestThreadDialog.tsx** -- Dialog for creating threads from pull request URLs.

**Gascity integration surface:**
- `Sidebar.tsx` is the primary UI for gascity convoy visualization -- projects map to convoys, threads map to beads. The sort/filter/group logic in `Sidebar.logic.ts` could be extended for gascity-specific grouping (by convoy, formula, status). `PlanSidebar.tsx` maps to gascity formula proposals. `ChatView.tsx` is the bead detail view. Custom metadata (`gc.*`) could drive additional UI elements in these components. `GitActionsControl.tsx` maps to gascity's stacked action patterns.

---

### === Routes (routes/) ===

TanStack Router routes defining the page structure.

**Key routes:**
- `__root.tsx` -- Root route: bootstraps server state sync (orchestration events, server config, terminal events, lifecycle events), runs settings migration, manages WebSocket reconnection coordination, and renders the app shell
- `_chat.tsx` -- Chat layout: renders sidebar + content area
- `_chat.$threadId.tsx` -- Thread detail page: renders `ChatView` for a specific thread
- `_chat.index.tsx` -- Empty state when no thread is selected
- `settings.tsx` -- Settings layout
- `settings.general.tsx` -- General settings page
- `settings.archived.tsx` -- Archived threads page

Key functions in `__root.tsx`: `ServerStateBootstrap()` -- initializes orchestration event subscription, replays missed events, derives batch effects; `EventRouter()` -- routes orchestration events to store updates; `createOrchestrationRecoveryCoordinator()` -- handles sequence gaps with retry logic

**Gascity integration surface:**
- `__root.tsx` is the orchestration event subscription entry point -- gascity could replace or wrap `ServerStateBootstrap` to inject convoy-level event routing. The recovery coordinator maps to gascity's event replay resilience pattern. Routes could be extended with gascity-specific pages (convoy dashboard, formula editor, bead grid view).

---

### === Hooks ===

**useThreadActions** -- thread lifecycle: `archiveThread()`, `unarchiveThread()`, `deleteThread()`, `confirmAndDeleteThread()`. Handles worktree cleanup on delete.

**useHandleNewThread** -- new thread creation: manages draft thread state, project association, branch/worktree/envMode options, navigation. Uses `ComposerDraftStore` for unsent draft persistence.

**useSettings** -- unified settings hook merging server-authoritative settings (RPC-backed) with client-only settings (localStorage-backed). `useUpdateSettings()` routes patches to correct backing store.

**useTurnDiffSummaries** -- returns turn diff summaries for the active thread.

**useCopyToClipboard** -- clipboard utility.

**useLocalStorage** -- type-safe localStorage with Schema validation.

**useMediaQuery** -- CSS media query hook.

**useTheme** -- theme management (light/dark/system).

**Gascity integration surface:**
- `useThreadActions` maps to gascity bead lifecycle operations. `useHandleNewThread` maps to bead creation with formula parameters (branch, worktree, envMode). `useSettings` could be extended to include gascity-specific settings (convoy preferences, formula defaults). These hooks are the API surface gascity UI extensions would consume.

---

### === WS Transport (wsTransport.ts, wsNativeApi.ts, wsRpcClient.ts) ===

The WebSocket transport layer connects the web UI to the server. `WsTransport` manages the WebSocket connection lifecycle with auto-reconnect and streaming subscription support. `WsRpcClient` wraps the transport with typed RPC methods matching the server's `WsRpcGroup`. `wsNativeApi.ts` adapts the RPC client to the `NativeApi` interface, providing a unified API whether running in desktop (Electron IPC) or web (WebSocket) mode.

**Key types/functions:**
- `WsTransport` -- class: `request(execute)`, `requestStream(connect, listener)`, `subscribe(connect, listener, options)`, `reconnect()`, `dispose()`
- `WsRpcClient` -- typed interface with domains: `terminal`, `projects`, `shell`, `git`, `server`, `orchestration` -- each with typed method signatures
- `createWsNativeApi()` -- creates a `NativeApi` instance backed by the WsRpcClient, with desktop bridge fallbacks for dialogs/context menus
- `NativeApi` -- the universal client API: `dialogs`, `terminal`, `projects`, `shell`, `git`, `contextMenu`, `server`, `orchestration`
- `WsRpcProtocolClient` -- low-level Effect RPC client created from `WsRpcGroup`
- Subscription retry: auto-reconnect with configurable delay (default 250ms), sequence-aware resubscription

**Gascity integration surface:**
- `NativeApi` is the client-side integration contract. Gascity could provide an alternative `NativeApi` implementation that routes through gascity's own transport (e.g., gascity relay instead of direct WebSocket). The `WsTransport.subscribe()` pattern maps to gascity's event subscription model. The `orchestration` domain on `NativeApi` (`getSnapshot`, `dispatchCommand`, `onDomainEvent`) is the complete client-side bead control surface.

---

## packages/contracts/ (Shared Schemas)

### === Orchestration Types (orchestration.ts) ===

The canonical domain model for all orchestration state. Defines schemas for projects, threads, messages, turns, sessions, activities, checkpoints, proposed plans, commands, and events using Effect Schema. This is the single source of truth for the wire format between server and client.

**Key types:**
- `OrchestrationThread` -- id, projectId, title, modelSelection, runtimeMode, interactionMode, branch, worktreePath, latestTurn, messages, proposedPlans, activities, checkpoints, session, customMetadata, archivedAt, deletedAt
- `OrchestrationProject` -- id, title, workspaceRoot, defaultModelSelection, scripts
- `OrchestrationMessage` -- id, role (user/assistant/system), text, attachments, turnId, streaming
- `OrchestrationSession` -- threadId, status (idle/starting/running/ready/interrupted/stopped/error), providerName, runtimeMode, activeTurnId, lastError
- `OrchestrationLatestTurn` -- turnId, state (running/interrupted/completed/error), requestedAt, startedAt, completedAt, assistantMessageId, sourceProposedPlan
- `OrchestrationThreadActivity` -- id, tone (info/tool/approval/error), kind, summary, payload, turnId
- `OrchestrationCheckpointSummary` -- turnId, checkpointTurnCount, checkpointRef, status (ready/missing/error), files
- `OrchestrationProposedPlan` -- id, turnId, planMarkdown, implementedAt, implementationThreadId
- `CustomMetadata` -- `Record<string, string>` for external integrations (documented: `gc.*` keys from Gas City)
- **Commands (16 types):** `project.create`, `project.meta.update`, `project.delete`, `thread.create`, `thread.delete`, `thread.archive`, `thread.unarchive`, `thread.meta.update`, `thread.runtime-mode.set`, `thread.interaction-mode.set`, `thread.turn.start` (with bootstrap envelope), `thread.turn.interrupt`, `thread.approval.respond`, `thread.user-input.respond`, `thread.checkpoint.revert`, `thread.session.stop`
- **Internal commands (7):** `thread.session.set`, `thread.message.assistant.delta`, `thread.message.assistant.complete`, `thread.proposed-plan.upsert`, `thread.turn.diff.complete`, `thread.activity.append`, `thread.revert.complete`
- **Events (22 types):** `project.created/meta-updated/deleted`, `thread.created/deleted/archived/unarchived/meta-updated/runtime-mode-set/interaction-mode-set/message-sent/turn-start-requested/turn-interrupt-requested/approval-response-requested/user-input-response-requested/checkpoint-revert-requested/reverted/session-stop-requested/session-set/proposed-plan-upserted/turn-diff-completed/activity-appended`
- `OrchestrationReadModel` -- snapshotSequence, projects, threads, updatedAt
- `OrchestrationEvent` -- sequence, eventId, aggregateKind, aggregateId, occurredAt, commandId, causationEventId, correlationId, metadata, type, payload
- `ProviderKind` -- "codex" | "claudeAgent"
- `RuntimeMode` -- "approval-required" | "full-access"
- `ProviderInteractionMode` -- "default" | "plan"
- `ModelSelection` -- union of CodexModelSelection | ClaudeModelSelection
- `ChatAttachment` / `ChatImageAttachment` -- image attachments with size limits

**Gascity integration surface:**
- This is the core schema library gascity needs. `CustomMetadata` with `gc.*` keys is the designated gascity extension point on threads. Every command and event type is a gascity formula operation. The `OrchestrationReadModel` is the bead snapshot format. `ThreadTurnStartBootstrap` (atomic create+worktree+turn) maps to gascity bead initialization. `ProviderKind` could be extended with a `"gascity"` variant for gascity-native agents. `correlationId` on events maps directly to gascity bead correlation.

---

### === Provider Types (provider.ts) ===

Schemas for provider session management and provider-level events (as opposed to orchestration events).

**Key types:**
- `ProviderSession` -- provider, status (connecting/ready/running/error/closed), runtimeMode, cwd, model, threadId, resumeCursor, activeTurnId
- `ProviderSessionStartInput` -- threadId, provider, cwd, modelSelection, resumeCursor, approvalPolicy, sandboxMode, runtimeMode
- `ProviderSendTurnInput` -- threadId, input, attachments, modelSelection, interactionMode
- `ProviderTurnStartResult` -- threadId, turnId, resumeCursor
- `ProviderInterruptTurnInput` -- threadId, turnId
- `ProviderStopSessionInput` -- threadId
- `ProviderRespondToRequestInput` -- threadId, requestId, decision (accept/acceptForSession/decline/cancel)
- `ProviderRespondToUserInputInput` -- threadId, requestId, answers
- `ProviderEvent` -- id, kind (session/notification/request/error), provider, threadId, method, message, turnId, itemId, requestId, textDelta, payload

**Gascity integration surface:**
- `ProviderSessionStartInput` carries all the parameters gascity needs to start a bead executor. `approvalPolicy` and `sandboxMode` map to gascity formula security settings. `resumeCursor` enables gascity bead resume after interruption.

---

### === Provider Runtime Types (providerRuntime.ts) ===

Detailed schemas for the canonical provider runtime event stream -- the normalized event format that both Codex and Claude adapters emit.

**Key types:**
- `ProviderRuntimeEvent` -- 30+ event variants covering the full provider lifecycle
- `RuntimeEventRawSource` -- "codex.app-server.notification", "codex.app-server.request", "codex.eventmsg", "claude.sdk.message", "claude.sdk.permission", "codex.sdk.thread-event"
- `RuntimeSessionState` -- starting/ready/running/waiting/stopped/error
- `RuntimeTurnState` -- completed/failed/interrupted/cancelled
- `RuntimeItemStatus` -- inProgress/completed/failed/declined
- `RuntimeContentStreamKind` -- assistant_text/reasoning_text/reasoning_summary_text/plan_text/command_output/file_change_output/unknown
- `RuntimePlanStepStatus` -- pending/inProgress/completed
- `ToolLifecycleItemType` -- tool execution types (command, file read, file change, etc.)
- `UserInputQuestion` -- structured user-input question schema

**Gascity integration surface:**
- The 30+ `ProviderRuntimeEvent` types are the granular observability feed gascity needs for bead monitoring. `RuntimeContentStreamKind` distinguishes reasoning from output -- gascity could use this for cost attribution. `RuntimePlanStepStatus` maps to formula step tracking. A gascity adapter would emit these same event types.

---

### === RPC (rpc.ts) ===

Defines all WebSocket RPC method schemas using Effect RPC. Groups ~35 methods into a single `WsRpcGroup` with typed payloads, success types, and error types.

**Key types:**
- `WsRpcGroup` -- the single RPC group containing all method definitions
- `WS_METHODS` -- 30 method constants across domains: projects (list/add/remove/searchEntries/writeFile), shell (openInEditor), git (pull/status/runStackedAction/listBranches/createWorktree/removeWorktree/createBranch/checkout/init/resolvePullRequest/preparePullRequestThread), terminal (open/write/resize/clear/restart/close), server (getConfig/refreshProviders/upsertKeybinding/getSettings/updateSettings), subscriptions (orchestrationDomainEvents/terminalEvents/serverConfig/serverLifecycle)
- `ORCHESTRATION_WS_METHODS` -- 5 orchestration methods: getSnapshot, dispatchCommand, getTurnDiff, getFullThreadDiff, replayEvents
- Each method defined as `Rpc.make(name, { payload, success, error, stream? })` -- fully typed request/response

**Gascity integration surface:**
- The RPC group is the complete API surface for gascity integration. Gascity could consume these as-is via WebSocket, or gascity could define additional RPC methods (e.g., `gascity.syncConvoyState`, `gascity.registerFormula`) by extending the group.

---

### === Model Types (model.ts) ===

Model selection, capabilities, and provider-specific option schemas.

**Key types:**
- `ModelSelection` -- union: CodexModelSelection | ClaudeModelSelection
- `CodexModelOptions` -- reasoningEffort (xhigh/high/medium/low), fastMode
- `ClaudeModelOptions` -- thinking, effort (low/medium/high/max/ultrathink), fastMode, contextWindow
- `ModelCapabilities` -- reasoningEffortLevels, supportsFastMode, supportsThinkingToggle, contextWindowOptions, promptInjectedEffortLevels
- `DEFAULT_MODEL_BY_PROVIDER` -- codex: "gpt-5.4", claudeAgent: "claude-sonnet-4-6"
- `MODEL_SLUG_ALIASES_BY_PROVIDER` -- alias resolution (e.g., "opus" -> "claude-opus-4-6")
- `PROVIDER_DISPLAY_NAMES` -- codex: "Codex", claudeAgent: "Claude"

**Gascity integration surface:**
- Model selection maps to gascity formula resource allocation. `ModelCapabilities` tells gascity what options are available per model. The alias system could be extended for gascity-specific model aliases.

---

### === Server Types (server.ts) ===

Server configuration, provider status, and lifecycle event schemas.

**Key types:**
- `ServerConfig` -- cwd, keybindingsConfigPath, keybindings, issues, providers, availableEditors, observability, settings
- `ServerProvider` -- provider, enabled, installed, version, status (ready/warning/error/disabled), auth (authenticated/unauthenticated/unknown), models
- `ServerProviderModel` -- slug, name, isCustom, capabilities
- `ServerObservability` -- logsDirectoryPath, localTracingEnabled, otlpTracesUrl/Enabled, otlpMetricsUrl/Enabled
- `ServerConfigStreamEvent` -- snapshot | keybindingsUpdated | providerStatuses | settingsUpdated
- `ServerLifecycleStreamEvent` -- welcome (cwd, projectName, bootstrapProjectId, bootstrapThreadId) | ready (at)

**Gascity integration surface:**
- `ServerProvider` status feeds gascity health monitoring. `ServerLifecycleStreamEvent.welcome` provides the bootstrap context gascity needs to correlate a T3 instance with a convoy. OTLP endpoints enable gascity to aggregate traces/metrics.

---

### === Settings Types (settings.ts) ===

Unified settings schema split between server-authoritative and client-only settings.

**Key types:**
- `ServerSettings` -- enableAssistantStreaming, defaultThreadEnvMode (local/worktree), textGenerationModelSelection, providers (codex: CodexSettings, claudeAgent: ClaudeSettings), observability
- `ClientSettings` -- confirmThreadArchive, confirmThreadDelete, diffWordWrap, sidebarProjectSortOrder, sidebarThreadSortOrder, timestampFormat
- `UnifiedSettings` -- `ServerSettings & ClientSettings`
- `ServerSettingsPatch` -- deep-partial of ServerSettings for incremental updates
- `CodexSettings` -- enabled, binaryPath, homePath, customModels
- `ClaudeSettings` -- enabled, binaryPath, customModels
- `ThreadEnvMode` -- "local" | "worktree"

**Gascity integration surface:**
- `ServerSettings` is where gascity-specific defaults would live (e.g., default formula parameters, convoy-level model policies). `defaultThreadEnvMode` maps to gascity's bead isolation strategy. Provider settings enable gascity to configure agent binaries per deployment.

---

### === IPC Types (ipc.ts) ===

Desktop IPC bridge and the universal `NativeApi` interface that abstracts over desktop (Electron IPC) and web (WebSocket RPC) transports.

**Key types:**
- `NativeApi` -- universal interface: `dialogs` (pickFolder, confirm), `terminal` (open/write/resize/clear/restart/close/onEvent), `projects` (searchEntries, writeFile), `shell` (openInEditor, openExternal), `git` (full branch/worktree/PR API), `contextMenu` (show), `server` (getConfig/refreshProviders/upsertKeybinding/getSettings/updateSettings), `orchestration` (getSnapshot/dispatchCommand/getTurnDiff/getFullThreadDiff/replayEvents/onDomainEvent)
- `DesktopBridge` -- Electron-specific bridge: getWsUrl, pickFolder, confirm, setTheme, showContextMenu, openExternal, onMenuAction, update state machine
- `DesktopUpdateState` -- enabled, status, currentVersion, architecture info, versions, downloadPercent, errors
- `ContextMenuItem<T>` -- generic context menu item

**Gascity integration surface:**
- `NativeApi` is the complete client-side control surface. Gascity could implement a `GascityNativeApi` that wraps the WebSocket transport with convoy-level routing, or inject gascity-specific methods alongside the standard ones. The `orchestration` namespace on `NativeApi` is the bead command/query API.

---

## packages/shared/ (Shared Utilities)

Runtime utilities consumed by both server and web via explicit subpath exports. No barrel index -- each module is imported individually.

**Subpath exports:**
- `@t3tools/shared/model` -- `resolveModelSlugForProvider()`, `resolveModelCapabilities()`, `isKnownModel()`, model alias resolution, capability definitions
- `@t3tools/shared/git` -- git-related utilities (branch name validation, worktree path helpers, PR URL parsing)
- `@t3tools/shared/logging` -- `RotatingFileSink` -- rotating NDJSON file logger with size/count limits
- `@t3tools/shared/shell` -- shell command parsing and quoting utilities
- `@t3tools/shared/Net` -- `NetService` -- port allocation and network utilities (find free port, etc.)
- `@t3tools/shared/DrainableWorker` -- `DrainableWorker` -- async worker with drain semantics for graceful shutdown
- `@t3tools/shared/KeyedCoalescingWorker` -- `KeyedCoalescingWorker` -- deduplicating async worker that coalesces multiple requests per key
- `@t3tools/shared/schemaJson` -- `decodeJsonResult()`, `encodeJsonResult()` -- Effect Schema JSON encode/decode with Result
- `@t3tools/shared/Struct` -- `deepMerge()` -- deep merge utility for settings patches
- `@t3tools/shared/serverSettings` -- `parsePersistedServerObservabilitySettings()` -- parses server settings from disk for desktop bootstrap
- `@t3tools/shared/String` -- string utilities
- `@t3tools/shared/projectScripts` -- project setup script resolution

**Gascity integration surface:**
- `DrainableWorker` and `KeyedCoalescingWorker` are async coordination primitives gascity could reuse for bead process management. `RotatingFileSink` maps to gascity's log management. `schemaJson` provides the serialization layer for gascity's wire protocol. `deepMerge` enables gascity settings overlays. `Net` port allocation is useful for gascity-spawned T3 instances.
