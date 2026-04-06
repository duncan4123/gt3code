# Gas City Domain Summaries for t3code Integration

Generated from `/data/projects/gascity` on `main` branch.
Purpose: Knowledge graph source for understanding how t3code (web UI for coding agents) would integrate with Gas City (multi-agent orchestration platform).

---

## === cmd/gc/ — Session Lifecycle ===

**What it does:** The reconciler is the core control loop that decides which agent sessions should be awake or asleep, then drives lifecycle transitions (start/stop/drain). It uses a bead-driven model where every session has a corresponding bead in the store, and a pure-function `ComputeAwakeSet` determines desired state from config + demand signals (work beads, scale checks, named sessions, dependencies, idle timeouts).

**Key types/functions:**
- `TemplateParams` — resolved per-agent config (command, env, workdir, prompt, hints); the unit of desired state
- `DesiredStateResult` — bundles desired session map + scale check counts + assigned work beads
- `AwakeInput` / `AwakeDecision` — pure input/output for the wake/sleep decision engine
- `AwakeAgent`, `AwakeNamedSession`, `AwakeSessionBead`, `AwakeWorkBead` — pre-computed state fed to ComputeAwakeSet
- `ComputeAwakeSet(input AwakeInput) map[string]AwakeDecision` — pure function, the single source of truth for all wake/drain decisions
- `buildDesiredState()` — collects config, runs scale_check commands, produces `DesiredStateResult`
- `allDependenciesAliveForTemplate()` — checks template dependency DAG for liveness
- `wakeTarget` — session + resolved template params + alive status
- `buildDepsMap(cfg)` — extracts agent dependency edges for topo ordering
- `sessionReconcilerTraceCycle` — structured tracing for reconciler operations

**Integration surface with t3code:**
- t3code would observe session state via the API (see `internal/api`), not by calling the reconciler directly
- Understanding `TemplateParams` and `DesiredStateResult` shapes is essential for displaying session config in the UI
- The reconciler's wake reasons (pool demand, work beads, named sessions, dependencies, manual hold) map to UI status indicators
- `ComputeAwakeSet` is the authority — t3code status displays should reflect its output

---

## === cmd/gc/ — Bead Operations ===

**What it does:** Manages the bead store lifecycle (start/init/hooks/stop), session-to-bead mapping, and cross-rig bead routing. `beads_provider_lifecycle.go` handles Dolt-backed store startup with per-city config isolation. `session_beads.go` maps session beads (label "gc:session", type "session") to running sessions. `rig_beads.go` generates cross-rig route tables so beads can reference each other across directory boundaries.

**Key types/functions:**
- `startBeadsLifecycle(cityPath, _, cfg, stderr)` — full startup: start provider, init+hooks per rig, regenerate routes
- `loadSessionBeads(store) ([]Bead, error)` — lists all open session beads
- `sessionBeadLabel` / `sessionBeadType` — constants "gc:session" / "session"
- `rigRoute` / `routeEntry` — bead prefix-to-directory mapping for cross-rig routing
- `collectRigRoutes(cityPath, cfg)` — builds HQ + rig route list
- `writeAllRoutes(rigs)` — writes routes.jsonl to each rig's .beads/ directory
- `cityDoltConfigs` — sync.Map for per-city Dolt config (multi-tenancy safe)
- `isNamedSessionBead(b)` / `namedSessionIdentity(b)` — named session bead helpers

**Integration surface with t3code:**
- t3code reads beads via the HTTP API (`/v0/beads`, `/v0/bead/{id}`) — never touches bead files directly
- Session beads are the canonical source of session existence and metadata
- Bead metadata keys (`session_name`, `template`, `alias`, `held_until`, `quarantined_until`, `idle_since`, `wait_hold`) are the session state t3code would display
- Bead status progression: "creating" -> "active" -> "asleep" / "drained" -> "closed"

---

## === cmd/gc/ — Dispatch Runtime ===

**What it does:** Bridges formula/workflow execution with the runtime provider layer. Routes graph steps to the correct rig/agent based on config, manages convoy control dispatch serving, and implements workflow-serve mode where an agent continuously picks up and processes work beads from a query.

**Key types/functions:**
- `controlDispatcherBinding(store, cityName, cfg, rigContext) (graphRouteBinding, error)` — resolves where control dispatchers run
- `applyGraphRouting(recipe, agent, routedTo, vars, ...)` — assigns rig routes to recipe steps
- `runConvoyControlServe(args, stdout, stderr)` — entry point for `gc convoy control --serve`
- `runWorkflowServe(agentName, follow, _, stderr)` — workflow serve loop for work_query agents
- `drainWorkflowServeWork(agentCfg, workDir, stderr)` — processes pending work beads
- `hookBead` / `hookBeadMetadata` — simplified bead for hook/dispatch context
- `workflowEventRelevant(evt)` — filters events for workflow wake
- `nextWorkflowServeBeads(workQuery, dir)` — fetches next work items

**Integration surface with t3code:**
- t3code dispatches work via `/v0/sling` API endpoint (which delegates to dispatch)
- Convoy creation/management via `/v0/convoys` endpoints
- Workflow execution status visible through convoy bead graphs (`/v0/beads/graph/{rootID}`)

---

## === cmd/gc/ — Prompt System ===

**What it does:** Renders Go text/template prompts for agent sessions. Prompts are composed from city-level templates, shared template partials, pack fragments, and per-agent injection fragments. Built-in prompts are embedded in the binary and materialized to the city's `prompts/` directory.

**Key types/functions:**
- `PromptContext` — template data: CityName, AgentName, Dir, Workdir, Provider, BeaconTime, BeadPrefix, etc.
- `renderPrompt(fs, cityPath, cityName, templatePath, ctx, sessionTemplate, stderr, packDirs, injectFragments, store)` — main render pipeline
- `buildTemplateData(ctx) map[string]string` — flattens PromptContext to template variables
- `promptFuncMap(cityName, sessionTemplate, store)` — custom template functions (e.g., bead lookups)
- `mergeFragmentLists(global, perAgent)` — combines fragment sources
- `materializeBuiltinPrompts(cityPath)` — writes embedded prompts to disk
- `loadSharedTemplates(fs, tmpl, dir, stderr)` — loads shared partials from prompts/shared/

**Integration surface with t3code:**
- t3code can read prompt templates via config API but rendering is server-side only
- The prompt context fields map to what t3code displays for session creation/configuration
- Pack fragments and global fragments are visible through config introspection

---

## === cmd/gc/ — Template Resolution ===

**What it does:** Resolves agent config entries into `TemplateParams` — the complete startup specification for a session. Combines agent config, provider config, prompt rendering, environment variable merging, work directory resolution, and Dolt environment injection into a single deployable unit.

**Key types/functions:**
- `TemplateParams` struct — Command, Env, WorkDir, PromptSuffix, PromptFlag, Hints (StartupHints), DisplayName, Provider, SessionName, etc.
- `resolveTemplate(params, cfgAgent, qualifiedName, fpExtra) (TemplateParams, error)` — main resolution pipeline
- `templateParamsToConfig(tp) runtime.Config` — converts TemplateParams to runtime.Config for provider.Start()
- `sessionDoltEnv(cityPath, rigRoot, rigs) map[string]string` — builds Dolt environment variables
- `agentBuildParams` struct — per-city shared parameters for all agent resolution in a single cycle
- `newAgentBuildParams(cityName, cityPath, cfg, sp, beaconTime, store, stderr)` — constructor
- `effectiveOverlayDirs(cityDirs, rigDirs, rigName)` — merges overlay directory layers
- `templateNameFor(cfgAgent, qualifiedName)` — resolves pool vs. regular template name

**Integration surface with t3code:**
- TemplateParams shape is what the session creation API returns/uses internally
- t3code session create flow needs: template name, optional prompt, optional env overrides
- The resolution pipeline is opaque to t3code — it calls `POST /v0/sessions` and the server resolves

---

## === cmd/gc/ — API/Dashboard ===

**What it does:** `apiroute.go` provides a thin client wrapper to route CLI writes through the API when a controller is running. The `dashboard/` package implements a full server-rendered web dashboard with its own API proxy layer, command execution, mail UI, issue management, crew (agent status) view, and SSE streaming.

**Key types/functions:**
- `apiClient(cityPath) *api.Client` — returns API client if controller is running (nil otherwise)
- `resolveAgentForAPI(cityPath, name)` — resolves bare agent name to qualified form
- `APIHandler` struct — dashboard HTTP handler with command execution, CSRF, scope filtering
- `handleRun()` — executes gc CLI commands from dashboard
- `handleMailInbox/Send/Read/Threads()` — mail UI endpoints
- `handleIssueShow/Create/Close/Update()` — issue (bead) management
- `handleCrew()` — agent status view (sessions + pending interactions)
- `handleReady()` — ready items view
- `handleSessionPreview()` — session peek/preview
- `handleAgentOutput/OutputStream()` — live agent output streaming
- `handleSSE/SSEProxy()` — server-sent events for real-time updates
- `CommandRequest/Response` — command execution protocol

**Integration surface with t3code:**
- The dashboard is a *reference implementation* for t3code — it shows what UI surfaces exist
- t3code should use the `internal/api` REST endpoints directly, not the dashboard proxy
- SSE streaming pattern (`/v0/events/stream`, `/v0/session/{id}/stream`) is how t3code gets real-time updates
- The crew view, ready items, and session preview map directly to t3code UI panels

---

## === cmd/gc/ — Commands ===

**What it does:** Cobra CLI commands that expose all gc functionality. Each `cmd_*.go` file implements a command tree. These are the user-facing operations that t3code would replicate through the HTTP API.

**Key commands:**
- `gc session new/list/attach/suspend/close/rename/prune/peek/kill/nudge` — full session lifecycle
- `gc convoy create/list/status/target/add/close/check/stranded/land/autoclose` — convoy (batch work) management
- `gc beads health` — bead store health check
- `gc status` (cmd_status.go) — `StatusJSON` with agents, rigs, pools, controller info
- `gc citystatus` (cmd_citystatus.go) — `StatusJSON`, `StatusAgentJSON`, `PoolJSON`, `StatusRigJSON`, `ControllerJSON`, `StatusSummaryJSON` — structured city-wide status

**Integration surface with t3code:**
- Every CLI command has an API equivalent — t3code uses the API, not CLI
- `StatusJSON` shape is what `/v0/status` returns — primary data for t3code's main view
- Session commands map 1:1 to `/v0/session/*` endpoints
- Convoy commands map to `/v0/convoy/*` endpoints

---

## === internal/runtime/ — Provider Implementations ===

**What it does:** Defines the `Provider` interface for managing agent sessions across different execution backends (tmux, subprocess, ACP protocol, Kubernetes pods, hybrid, auto-detection, exec scripts). Each provider implements the same lifecycle contract: Start/Stop/Interrupt/Attach/Nudge/Peek/IsRunning.

**Key types/functions:**
- `Provider` interface — 20 methods: Start, Stop, Interrupt, IsRunning, IsAttached, Attach, ProcessAlive, Nudge, SetMeta, GetMeta, RemoveMeta, Peek, ListRunning, GetLastActivity, ClearScrollback, CopyTo, SendKeys, RunLive, Capabilities
- `Config` struct — WorkDir, Command, Env, ReadyPromptPrefix, ReadyDelayMs, ProcessNames, EmitsPermissionWarning, Nudge, PreStart, SessionSetup, SessionSetupScript, SessionLive, PackOverlayDirs, OverlayDir, CopyFiles, FingerprintExtra, PromptSuffix, PromptFlag
- `ContentBlock` — structured nudge content (type + text)
- `PendingInteraction` / `InteractionResponse` — approval dialog protocol
- `InteractionProvider` interface — Pending(name) + Respond(name, response) for providers with approval flows
- `IdleWaitProvider` — WaitForIdle(name, timeout) for idle detection
- `ImmediateNudgeProvider` — ImmediateNudge(name, content) for synchronous nudge
- `CopyEntry` — {Src, RelDst} for file staging
- `SyncWorkDirEnv(cfg) Config` — syncs GC_DIR env var
- Implementations: `auto/` (auto-detect), `acp/` (Agent Control Protocol), `tmux/`, `k8s/`, `hybrid/`, `subprocess/`, `exec/`

**Integration surface with t3code:**
- t3code never calls Provider directly — it goes through the API
- The `Config` struct fields determine what session creation parameters exist
- `PendingInteraction` is the approval flow t3code must handle (`/v0/session/{id}/pending` + `/v0/session/{id}/respond`)
- Provider capabilities affect what UI actions are available (e.g., attach, peek, nudge)

---

## === internal/beads/ — Work Unit Persistence ===

**What it does:** The universal persistence layer for all Gas City work units. Every entity is a `Bead` with ID, Title, Status, Type, Labels, Metadata, Dependencies, and parent-child relationships. Multiple store backends: `BdStore` (Dolt/bd CLI), `FileStore` (JSON files), `MemStore` (in-process), `CachingStore` (read-through cache over any Store). The `exec/` subpackage supports user-supplied scripts as custom store backends.

**Key types/functions:**
- `Bead` struct — ID, Title, Status ("open"/"in_progress"/"closed"), Type ("task"/"session"/"convoy"/"molecule"/"wisp"), Priority, CreatedAt, Assignee, From, ParentID, Ref, Needs, Description, Labels, Metadata, Dependencies
- `Store` interface — Create, Get, Update, Close, CloseAll, List, ListOpen, Ready, Children, ListByLabel, ListByAssignee, ListByMetadata, SetMetadata, SetMetadataBatch, Delete, Ping, DepAdd, DepRemove, DepList
- `UpdateOpts` — partial update: Title, Status, Type, Priority, Description, ParentID, Assignee, Labels, RemoveLabels, Metadata
- `ListQuery` — structured query with Label, Type, Status, Assignee, Metadata filters
- `Dep` struct — IssueID, DependsOnID, Type ("blocks"/"tracks"/"relates-to")
- `BdStore` — Dolt-backed implementation using bd CLI commands
- `CachingStore` — read-through cache with TTL and invalidation
- `IsContainerType(t)` — true for "convoy"
- `IsMoleculeType(t)` — true for "molecule"/"wisp"

**Integration surface with t3code:**
- All bead operations go through `/v0/beads/*` and `/v0/bead/{id}/*` API endpoints
- Bead types t3code cares about: "session" (agent sessions), "task" (work items), "convoy" (batch containers), "molecule"/"wisp" (workflow steps)
- Metadata is the extensible key-value store for all domain-specific state
- Dependencies are the DAG edges that formula/dispatch uses for ordering

---

## === internal/session/ — Session Resolution ===

**What it does:** Provides session identity resolution (ID/alias/name lookup), session naming/reservation with file-level locking, the chat session Manager for interactive send/receive/pending/respond flows, and durable wait management for sessions blocked on external signals.

**Key types/functions:**
- `Manager` struct — wraps beads.Store + runtime.Provider; methods: Send, StopTurn, Pending, Respond, TranscriptPath, ensureRunning
- `Info` struct (from resolve.go) — resolved session info with bead + runtime state
- `ResolveSessionID(store, identifier) (string, error)` — resolves alias/name/ID to bead ID
- `ResolveSessionIDAllowClosed(store, identifier)` — same but includes closed sessions
- `ValidateExplicitName(name)` / `ValidateAlias(alias)` — session name validation
- `EnsureAliasAvailable(store, alias, selfID)` — alias uniqueness check
- `WithCitySessionNameLock(cityPath, name, fn)` — file-level lock for session name reservation
- `SessionNameFor(cityName, agentName, sessionTemplate)` — (in agent pkg) session naming
- `WakeSession(store, sessionBead, now)` — triggers durable wait wake
- `CancelWaits(store, sessionID, now)` — cancels pending waits
- `WaitNudgeIDs(store, sessionID)` — finds nudge beads for wait-blocked sessions
- `IsWaitTerminalState(state)` — checks "completed"/"cancelled"/"expired"
- `chat.go` — handles stripResumeFlag, withSessionMutationLock, session bead loading, interactive message flow

**Integration surface with t3code:**
- t3code's chat UI calls `POST /v0/session/{id}/messages` which routes to Manager.Send
- Pending interactions (`GET /v0/session/{id}/pending`) and responses (`POST /v0/session/{id}/respond`) are the approval flow
- Session resolution (alias/name/ID) means t3code can reference sessions flexibly
- Transcript streaming via `GET /v0/session/{id}/stream` for real-time chat display

---

## === internal/config/ — Configuration ===

**What it does:** Defines and parses the `city.toml` configuration file that specifies the entire Gas City deployment: workspace metadata, agents, rigs, providers, sessions, beads, mail, events, orders, formulas, convergence, daemon, API, and chat settings. The `City` struct is the root of all configuration.

**Key types/functions:**
- `City` struct — root config: Workspace, Agents []Agent, Rigs []Rig, Providers map[string]ProviderSpec, Beads BeadsConfig, Session SessionConfig, Mail MailConfig, Events EventsConfig, Dolt DoltConfig, Formulas FormulasConfig, Orders OrdersConfig, API APIConfig, ChatSessions ChatSessionsConfig, Convergence ConvergenceConfig, Daemon DaemonConfig, NamedSessions []NamedSession, AgentDefaults, PackDirs, PackOverlayDirs, RigOverlayDirs, FormulaLayers, ScriptLayers
- `Agent` struct — Name, Dir, Command, Provider, Prompt, WorkDir, Env, DependsOn, Suspended, WakeMode, WorkQuery, SlingQuery, ScaleCheck, Pool, IdleTimeout, DrainTimeout, SessionSetup, SessionLive, OverlayDir, Attach, OnDeath, OnBoot, MaxActiveSessions, MinActiveSessions, CopyFiles, InjectFragments, and many more
- `Rig` struct — Name, Path, Prefix, Suspended, AgentOverrides []AgentOverride
- `NamedSession` — Name, Dir, Template, Mode ("always"/"on_demand")
- `SessionConfig` — SetupTimeout, NudgeReadyTimeout, NudgeRetryInterval, NudgeLockTimeout, StartupTimeout, DebounceMs, DisplayMs
- `BeadsConfig` — Provider, Prefix
- `APIConfig` — Port, Bind, AllowMutations, CORS; DefaultAPIPort = 9443
- `Workspace` — Name, SessionTemplate, GlobalFragments, Provider (default)
- `DaemonConfig` — PatrolInterval, MaxRestarts, RestartWindow, ShutdownTimeout, DriftDrainTimeout, WispGCInterval, WispTTL
- `Load(fs, path) (*City, error)` — loads and parses city.toml
- `Parse(data) (*City, error)` — parses TOML bytes
- `InjectImplicitAgents(cfg)` — adds control dispatchers and other implicit agents
- `ValidateAgents()` / `ValidateNamedSessions()` / `ValidateRigs()` — validation

**Integration surface with t3code:**
- t3code reads config via `GET /v0/config` and can validate via `GET /v0/config/validate`
- Agent CRUD via `POST/PATCH/DELETE /v0/agents` and `/v0/agent/{name}`
- The `Agent` struct fields map to session creation parameters
- `APIConfig` determines how t3code connects (port, bind, CORS)
- Named sessions and agent defaults affect what t3code shows in its session creation UI

---

## === internal/formula/ — Workflow Engine ===

**What it does:** Defines, parses, compiles, and expands multi-step workflow formulas. Formulas are TOML-defined DAGs of steps with dependencies, conditions, control flow (retry, loop, ralph/approval, fan-out), variables, gates, bond points, and hooks/advice. The compiler turns a Formula into a Recipe (flattened execution plan), and the expand phase materializes recipe steps into beads.

**Key types/functions:**
- `Formula` struct — Name, Description, Type, Steps []*Step, Variables []VarDef, Hooks []Hook, ComposeRules, AdviceRules []AdviceRule
- `Step` struct — ID, Name, Agent, Prompt, Command, DependsOn, Gate, Ralph *RalphSpec, Retry *RetrySpec, Loop *LoopSpec, OnComplete *OnCompleteSpec, Children, Condition, ForEach, MapRule, ExpandRule, BondPoints
- `Recipe` struct — Steps []RecipeStep, Variables, FormulaName, FormulaType, Source
- `RecipeStep` struct — ID, StepRef, Agent, Prompt, Command, DependsOn, Gate, Labels, Metadata, Route, ScopeRef, ScopeKind
- `RecipeDep` struct — StepRef, Type
- `VarDef` — Name, Default, Required, Description
- `RalphSpec` — approval/check specification (human-in-the-loop)
- `RetrySpec` — MaxAttempts, BackoffMs, OnExhausted
- `LoopSpec` — loop control with condition/max iterations
- `Gate` / `GateRule` / `BranchRule` — conditional step execution
- `FragmentRecipe` — reusable recipe fragments for fan-out
- `Validate()` — comprehensive formula validation
- `parse/compile/expand` pipeline in parser.go, compile.go, expand.go

**Integration surface with t3code:**
- Formulas are visible via `GET /v0/formulas` and `GET /v0/formulas/{name}`
- Formula runs visible via `GET /v0/formulas/{name}/runs`
- t3code could show formula DAG visualization using Recipe.Steps + dependencies
- Variable definitions drive the formula execution UI (required inputs)
- Ralph (approval) steps create PendingInteractions that t3code must handle

---

## === internal/dispatch/ — Convoy Dispatch ===

**What it does:** Orchestrates convoy execution by processing control beads (retry, ralph/approval, fan-out, scope management) and routing work to agents. The control loop reads beads, evaluates their state against formula rules, spawns child beads for next steps, and manages terminal state propagation. Includes retry logic with backoff, fan-out over collections, and scope-based member lifecycle.

**Key types/functions:**
- `ProcessControl(store, bead, opts) (ControlResult, error)` — main dispatch entry point; routes by bead type
- `ControlResult` struct — Done bool, WakeSessionIDs []string, SkippedStepIDs []string
- `ProcessOptions` struct — CityPath, CityName, Config, Store, EventRecorder, FormulaEngine, etc.
- `processRetryControl()` — retry logic with attempt spawning and exhaustion handling
- `processRalphControl()` — approval/check flow
- `processFanout()` — expands forEach items into parallel child beads
- `processScopeCheck()` — validates scope member completion
- `processWorkflowFinalize()` — propagates terminal outcomes up the tree
- `reconcileTerminalScopedMember()` — handles completed/failed scope members
- `spawnNextAttempt()` — creates retry attempt beads
- `resolveFanoutItems()` — parses forEach source into expansion items
- `setOutcomeAndClose()` — terminal state helper
- `fanout.go` — fragment instance resolution, external dep tracking, partial discard

**Integration surface with t3code:**
- t3code triggers dispatch via `POST /v0/sling` (sling endpoint)
- Convoy dispatch via `POST /v0/convoy/{id}/dispatch` (handler_convoy_dispatch.go)
- Dispatch status is observable through convoy bead tree (`GET /v0/convoy/{id}`)
- Ralph (approval) beads create pending interactions visible in the UI
- Fan-out progress trackable through parent-child bead relationships

---

## === internal/events/ — Event System ===

**What it does:** Tier-0 observability system recording infrastructure events (session lifecycle, bead operations, controller state, mail, convoy, orders) as JSON lines. Supports recording, listing, filtering, watching (real-time streaming), and pluggable backends (file recorder, exec provider).

**Key types/functions:**
- `Event` struct — Seq, Type, Ts, Actor, Subject, Message, Payload
- `Recorder` interface — Record(Event) — write-only, best-effort
- `Provider` interface — extends Recorder with List(filter), LatestSeq(), Watch(ctx, afterSeq), Close()
- `Watcher` interface — Next() (Event, error), Close() — blocking event stream
- `Filter` — query parameters for List
- `Discard` — no-op recorder
- Event type constants: SessionWoke, SessionStopped, SessionCrashed, BeadCreated, BeadClosed, BeadUpdated, MailSent, MailRead, SessionDraining, SessionQuarantined, ConvoyCreated, ConvoyClosed, ControllerStarted, ControllerStopped, OrderFired, OrderCompleted, ProviderSwapped, ExtMsgBound, etc.

**Integration surface with t3code:**
- `GET /v0/events` — list events with filtering
- `GET /v0/events/stream` — SSE real-time event stream (primary mechanism for t3code reactivity)
- `POST /v0/events` — emit custom events
- Event types map to UI notifications and state transitions
- The Watcher interface is what powers the SSE endpoints t3code consumes

---

## === internal/api/ — HTTP API ===

**What it does:** The REST API server that t3code connects to. Exposes comprehensive CRUD and action endpoints for all Gas City entities. Built on Go's net/http with chi-style routing. Supports read-only mode for remote-bound instances and full mutation mode for localhost.

**Key types/functions:**
- `Server` struct — HTTP server with mux, State interface, read-only flag
- `State` interface — 30+ methods the server calls: Config, Store, Provider, EventRecorder, SessionManager, Agents, Sessions, Beads, Mail, Convoys, etc.
- `StateMutator` interface — write methods: UpdateAgent, UpdateRig, UpdateProvider, ReloadConfig
- `New(state) *Server` / `NewReadOnly(state) *Server` — constructors
- `Client` struct — Go HTTP client for the API (used by CLI for API routing)

**API endpoints (full list):**
- Status: `GET /v0/status`, `GET /health`
- City: `GET/PATCH /v0/city`, `POST /v0/city`, `GET /v0/provider-readiness`, `GET /v0/readiness`
- Agents: `GET /v0/agents`, `GET/POST/PATCH/DELETE /v0/agent/{name}`, `POST /v0/agent/{name}` (actions: suspend/resume/restart/drain)
- Config: `GET /v0/config`, `GET /v0/config/explain`, `GET /v0/config/validate`
- Patches: `GET/PUT/DELETE /v0/patches/{agents,rigs,providers}/*`
- Providers: `GET/POST/PATCH/DELETE /v0/provider/{name}`
- Rigs: `GET/POST/PATCH/DELETE /v0/rig/{name}`, `POST /v0/rig/{name}/{action}`
- Beads: `GET /v0/beads`, `POST /v0/beads`, `GET /v0/bead/{id}`, `GET /v0/bead/{id}/deps`, `POST /v0/bead/{id}/{close,reopen,update,assign}`, `PATCH /v0/bead/{id}`, `DELETE /v0/bead/{id}`, `GET /v0/beads/graph/{rootID}`, `GET /v0/beads/ready`
- Mail: `GET/POST /v0/mail`, `GET /v0/mail/count`, `GET /v0/mail/thread/{id}`, `GET /v0/mail/{id}`, `POST /v0/mail/{id}/{read,mark-unread,archive,reply}`, `DELETE /v0/mail/{id}`
- Convoys: `GET/POST /v0/convoys`, `GET /v0/convoy/{id}`, `POST /v0/convoy/{id}/{add,remove,close}`, `GET /v0/convoy/{id}/check`, `DELETE /v0/convoy/{id}`
- Events: `GET /v0/events`, `GET /v0/events/stream` (SSE), `POST /v0/events`
- Orders: `GET /v0/orders`, `GET /v0/orders/{feed,check,history}`, `GET /v0/order/{name}`, `POST /v0/order/{name}/{enable,disable}`
- Formulas: `GET /v0/formulas`, `GET /v0/formulas/{name}`, `GET /v0/formulas/{name}/runs`
- Sessions: `POST /v0/sessions`, `GET /v0/sessions`, `GET /v0/session/{id}`, `GET /v0/session/{id}/{transcript,pending,stream}`, `PATCH /v0/session/{id}`, `POST /v0/session/{id}/{messages,stop,kill,respond,suspend,close,wake,rename}`, `GET /v0/session/{id}/agents`
- Packs: `GET /v0/packs`
- Sling: `POST /v0/sling`
- Services: `GET /v0/services`, `GET /v0/service/{name}`, `POST /v0/service/{name}/restart`, proxy: `/svc/`
- ExtMsg: `POST /v0/extmsg/{inbound,outbound}`

**Integration surface with t3code:**
- This IS the integration surface. Every t3code feature maps to one or more of these endpoints.
- `State` interface is what the controller implements — t3code reads through it
- SSE endpoints (`/v0/events/stream`, `/v0/session/{id}/stream`) for real-time UI updates
- Session chat: `POST /v0/sessions` (create), `POST /v0/session/{id}/messages` (send), `GET /v0/session/{id}/stream` (receive), `GET /v0/session/{id}/pending` + `POST /v0/session/{id}/respond` (approval flow)
- Default port: 9443

---

## === internal/mail/ — Messaging ===

**What it does:** Inter-agent and human-to-agent messaging system. Messages have from/to/subject/body/priority/threading. Backed by beads (beadmail implementation) or user-supplied exec scripts. Supports inbox, threading, read/unread tracking, archiving, reply chains, and CC.

**Key types/functions:**
- `Message` struct — ID, From, To, Subject, Body, CreatedAt, Read, ThreadID, ReplyTo, Priority, CC, Rig
- `Provider` interface — Send, Inbox, Get, Read, MarkRead, MarkUnread, Archive, Delete, Check, Reply, Thread, All, Count
- `ErrAlreadyArchived` / `ErrNotFound` — sentinel errors
- `beadmail/` — default implementation backed by beads.Store
- `exec/` — fork/exec script-based provider
- `resolve.go` — mail provider resolution from config

**Integration surface with t3code:**
- Mail endpoints: `GET/POST /v0/mail`, `GET /v0/mail/count`, `GET /v0/mail/thread/{id}`, etc.
- t3code could show a mail inbox panel for monitoring agent-to-agent communication
- Message priority and threading are displayable in the UI
- Mail events (`mail.sent`, `mail.read`) flow through the event stream

---

## === internal/supervisor/ — Process Management ===

**What it does:** Multi-city process supervisor that manages gc controller instances. The Registry tracks registered cities and rigs with file-level locking for concurrent access. The supervisor starts/stops/monitors controller processes for each registered city, handles rig-to-city mapping, and supports multi-tenancy.

**Key types/functions:**
- `Registry` struct — file-backed city/rig registry with advisory locking
- `CityEntry` struct — Path, Name
- `RigEntry` struct — Path, Name, DefaultCity
- `RigCityMapping` struct — RigPath, CityPath
- `Registry.List() ([]CityEntry, error)` — list registered cities
- `Registry.Register(cityPath, name)` / `Unregister(cityPath)` — city registration
- `Registry.ListRigs()` / `RegisterRig()` / `UnregisterRig()` / `LookupRigByPath()` / `LookupRigByName()` — rig management
- `Registry.ReconcileRigs(rigCityMap)` — bulk rig-city reconciliation
- `Registry.SetRigDefault(rigPath, defaultCity)` — set default city for a rig
- `config.go` — supervisor-level config (could not read, likely extends DaemonConfig)
- `publications.go` — supervisor publications/announcements

**Integration surface with t3code:**
- t3code doesn't interact with the supervisor directly — it connects to a running API
- Supervisor manages the lifecycle of the controller that serves the API
- Registry data might be useful for a "multi-city" view in t3code
- Supervisor status is part of the `/v0/status` response

---

## === internal/agent/ — Agent Identity ===

**What it does:** Defines agent-level types shared across subsystems: session naming conventions and startup hint configuration. The session naming function is the single source of truth for how agent qualified names map to tmux session names.

**Key types/functions:**
- `SessionNameFor(cityName, agentName, sessionTemplate) string` — canonical session naming (replaces "/" with "--" for tmux safety, supports Go text/template customization)
- `sessionData` struct — template variables: City, Agent (sanitized), Dir, Name
- `StartupHints` struct — ReadyPromptPrefix, ReadyDelayMs, ProcessNames, EmitsPermissionWarning, Nudge, PreStart, SessionSetup, SessionSetupScript, SessionLive, PackOverlayDirs, OverlayDir, CopyFiles
- `hints.go` — carries provider startup behavior from config resolution to runtime.Config

**Integration surface with t3code:**
- Session names determine what t3code displays as session identifiers
- StartupHints fields affect what t3code can show about session initialization progress
- The naming convention matters for t3code when correlating session beads with runtime state
