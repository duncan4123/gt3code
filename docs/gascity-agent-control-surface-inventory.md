# Gas City Agent Control Surface Inventory

Bead: `t3-0ymnxug8.1`

Purpose: inventory operator-facing Gas City controls relevant to agents, classify their side effects and durability, and judge whether each belongs in the T3 sidebar.

## Summary

Gas City exposes three distinct control planes:

1. Session/runtime controls for a single live agent session.
2. Durable orchestration controls that mutate agent, rig, city, mail, or convoy state.
3. T3-read-model surfaces that already expose GC metadata or copyable GC command snippets, but do not yet provide typed GC actions.

Main design conclusion: the sidebar should prioritize a small set of high-frequency controls with clear guardrails:

- Safe direct actions: `session nudge`, `session submit`, `session wake`, `runtime drain`, `runtime undrain`, read-only status/peek.
- Confirmed actions: `session suspend`, `session reset`, `session kill`, `session close`, `agent suspend/resume`, `rig suspend/resume`, `city suspend/resume`.
- Drawer/detail-only actions: mail thread actions, convoy controls, `gc sling`, diagnostics.
- Keep out of sidebar primary chrome: formula/control-dispatch admin flows and destructive bulk workflow commands.

## Control Matrix

| Surface | Primary commands / API | Scope | Side effect | Durability | Safety / constraints | Sidebar suitability |
|---|---|---|---|---|---|---|
| Session lifecycle | `gc session new`, `attach`, `list`, `peek`, `close` | One session | Create, resume, inspect, or close a conversation bead | Mixed: bead durable, attach/peek transient | `close` ends conversation; `attach` can resume or restart provider state if runtime died | `list`/status/peek fit well; `new` and `close` belong in secondary menus |
| Session input | `gc session nudge`, `gc session submit` | One running session | Deliver operator text to agent input | `nudge` transient runtime input; `submit` semantic delivery via runtime policy | Best operator messaging surface; `submit --intent interrupt_now` is stronger than plain nudge | Strong fit for per-thread/session action menu |
| Session runtime interruption | `thread.turn.interrupt` in T3 orchestration, `gc session kill`, `gc session reset` | One session or one active turn | Interrupt turn, kill runtime, or restart fresh provider state | Interrupt event durable in orchestration log; kill transient; reset preserves session bead | `kill` restarts by reconciler; `reset` discards provider conversation state but keeps session identity | Expose only with confirmation and clear copy |
| Session sleep/wake | `gc session suspend`, `gc session wake`, `gc session pin`, `gc session unpin` | One session | Stop runtime, wake runtime, or override awake policy | Durable session metadata / bead state | `pin` does not clear hard blockers; `wake` only starts if wake reasons exist | Good detail-panel controls; pin/unpin likely secondary |
| Runtime drain protocol | `gc runtime drain`, `undrain`, `drain-check`, `drain-ack`, `request-restart` | Running session | Ask session to wind down, cancel drain, self-check, self-ack, or self-restart | Durable session metadata flags | `drain-check`, `drain-ack`, `request-restart` are primarily in-session mechanics, not general operator buttons | `drain` and `undrain` fit sidebar; keep `drain-check`/`ack` internal |
| Agent config suspend | `gc agent suspend`, `gc agent resume` | One configured agent template | Skip or restore reconciler spawning for that agent | Durable config mutation | Existing live session may continue after suspend; only restart is blocked | Good admin control in rig/agent details, not thread row |
| Rig lifecycle | `gc rig status`, `gc rig suspend`, `gc rig resume`, `gc rig restart` | One rig | Inspect or change reconciler behavior for all rig agents | Durable config for suspend/resume; restart operational | `gc hook` returns empty while rig suspended; beads DB still accessible | Good project-level sidebar section with confirmation on mutating actions |
| City lifecycle | `gc status`, `gc suspend`, `gc resume`, `gc doctor` | Whole city/workspace | Inspect global state, suspend all agents, resume all agents, run health checks | `suspend`/`resume` durable config; `doctor` diagnostic | City suspend disables spawn and makes `gc hook`/`prime` return empty | Good only in elevated admin UI, not default project sidebar |
| Work polling | `gc hook` | Agent template / pool | Read work-query output, optionally inject hook reminder | Read-only by itself | Requires configured agent (`$GC_AGENT` or explicit arg); suspended city/rig returns empty | Not a click action; useful as debug/readout only |
| Work routing | `gc sling` | Cross-session / cross-rig dispatch | Routes existing bead, creates bead from text, or instantiates formula/wisp | Durable bead and convoy mutations | Powerful dispatch surface; cross-rig routing and formula launch need guardrails | Keep in advanced admin UI, not sidebar primary actions |
| Mail | `gc mail inbox`, `check`, `peek`, `read`, `reply`, `send`, `archive` | Agent/human inbox | Durable message bead workflow | Durable bead creation/state change | Mail is persistent; nudges are preferred for routine transient comms | Good in drawer or inspector; do not overload row actions |
| Convoy workflow | `gc convoy list`, `status`, `target`, `control`, `land`, `delete` | Multi-bead workflow | Inspect or mutate dependency graph / orchestration control beads | Durable workflow graph state | Some commands are workflow-admin and potentially destructive | Good as read-only summary in sidebar; mutations belong in convoy detail pages |
| GC read API | `GcApiClient.getBead/getConvoy/getFormula/streamEvents/isAvailable` | Server internal | Read GC REST/SSE state | Read-only | No web-facing RPC yet; server-internal only | Strong backend foundation for sidebar reads |
| GC thread metadata | `gc.*` `customMetadata`, `GcThreadContext` schema | One T3 thread | Read-only projection of GC bead/convoy/formula context | Durable insofar as orchestration projection persists it | Can be stale relative to live runtime/config state | Good for badges and lightweight labels, insufficient for authoritative controls |
| Existing T3 UI entrypoints | Project script presets, interrupt command, sidebar metadata parsing | Thread/project UI | Copy commands or dispatch orchestration interrupt | Mixed | Current T3 UI is mostly read-only or shell-snippet based for GC | Replace ad hoc snippets with typed controls over time |

## Detailed Notes By Area

### 1. Session lifecycle and live operator actions

Highest-value operator controls are session-scoped:

- `gc session nudge <id-or-alias> <message...>` sends direct runtime input and supports `immediate`, `wait-idle`, or `queue` delivery.
- `gc session submit <id-or-alias> <message...> --intent ...` is a better typed primitive for UI actions because runtime decides wake vs queue vs interrupt semantics.
- `gc session peek <id-or-alias>` is useful for sidebar preview because it already abstracts provider differences, including `t3bridge`.
- `gc session suspend`, `wake`, `kill`, `reset`, `close` each have materially different semantics and should not be collapsed into a single generic “restart” control.

Sidebar recommendation:

- Primary actions: `submit`, `nudge`, `peek`, `drain`, `undrain`.
- Secondary confirmed actions: `suspend`, `wake`, `reset`, `kill`, `close`.
- Show session state before rendering destructive controls.

### 2. Runtime drain is special

`gc runtime drain` is the clean operator shutdown path. It sets a drain flag and expects the agent to finish current work and later call `gc runtime drain-ack`.

Important distinction:

- `drain` is an operator control.
- `drain-check`, `drain-ack`, and most `request-restart` usage are session-internal protocol steps.

Sidebar recommendation:

- Expose `drain` and `undrain`.
- Do not expose `drain-ack` as a clickable control.
- Show draining state as a badge/pill.

### 3. Durable hierarchy controls

Gas City has three suspension layers:

- City: `gc suspend` / `gc resume`
- Rig: `gc rig suspend` / `gc rig resume`
- Agent: `gc agent suspend` / `gc agent resume`

These are durable config mutations, not ephemeral runtime commands. Their effects inherit downward:

- Suspended city: all agents effectively suspended; `gc hook` and `gc prime` return empty.
- Suspended rig: rig agents skipped; beads DB still readable.
- Suspended agent: reconciler stops spawning/restarting that configured agent, but an already-running session can continue until it exits.

Sidebar recommendation:

- Project/rig settings panel only.
- Confirmation required for every mutating action.
- Render inheritance clearly so operators understand why a session is unavailable.

### 4. Workflow and dispatch controls

`gc sling` and convoy commands are powerful, but they are not lightweight thread-row actions.

- `gc sling` can route existing work, create new task beads from text, or instantiate formulas.
- `gc convoy` commands manage workflow graphs, target branches, control-bead execution, and workflow cleanup.

Sidebar recommendation:

- Read-only convoy summary in sidebar is good.
- Mutating convoy actions belong in a dedicated convoy detail panel or command palette.
- `gc sling` should remain advanced dispatch UI with target selection and confirmation.

### 5. Communication surfaces

Gas City intentionally separates transient and durable communication:

- Transient: `gc session nudge`
- Durable: `gc mail send`, `reply`, `archive`, inbox actions

This matters for UI:

- Quick operator steering belongs on nudge/submit.
- Persistent escalation, handoff, or audit-trail communication belongs in mail.

Sidebar recommendation:

- Add “nudge” as first-class.
- Put mail in a session/bead drawer, not inline on every row.

## Current T3 Surfaces And Gaps

### Existing T3 surfaces

Current repo surfaces already expose partial GC awareness:

- `apps/web/src/components/ProjectScriptsControl.tsx`
  - ships copyable presets for `gc status`, `gc mail inbox`, `gc hook --inject`, `gc doctor`, `gc sling`, `gc session list`, and `gc convoy list`
  - this is command discovery, not a typed control surface
- `apps/web/src/components/Sidebar.logic.ts`
  - parses `gc.agent`, `gc.rig`, `gc.city`, `gc.bead`, `gc.beadTitle`, `gc.state`, `gc.provider`
  - also counts GC-managed threads per project
- `packages/contracts/src/gc.ts`
  - already defines `GcBeadSummary`, `GcConvoyStatus`, and `GcThreadContext`
- `apps/server/src/gc/Services/GcApiClient.ts`
  - already provides read-only bead, convoy, formula, SSE event, and availability access for server code
- `thread.turn.interrupt`
  - already exists in T3 orchestration as a thread-level interrupt action

### Current gaps

Missing pieces before sidebar controls can be reliable:

1. No web-facing `gc.*` RPC surface for typed reads or mutations.
2. No authoritative live GC state snapshot for session/rig/city status in the web client.
3. Sidebar GC parsing exists, but current rendering does not expose most GC metadata.
4. Existing project-script presets are shell snippets, not guarded UI actions.

## Recommended Sidebar Cut

### Phase 1: safe, high-value controls

- Session badge with agent, rig, bead, provider, state
- Read-only session preview via `peek`
- `submit` / `nudge`
- `drain` / `undrain`
- `wake`

### Phase 2: guarded operational controls

- `suspend`
- `reset`
- `kill`
- `close`
- rig `suspend` / `resume`
- agent `suspend` / `resume`

### Phase 3: advanced workflow / admin

- Mail drawer
- Convoy detail and progress
- `gc sling` dispatch UI
- city-wide suspend/resume/doctor/status

## Source References

CLI help:

- `gc session --help`
- `gc session attach --help`
- `gc session new --help`
- `gc session close --help`
- `gc session list --help`
- `gc session peek --help`
- `gc session nudge --help`
- `gc session submit --help`
- `gc session suspend --help`
- `gc session wake --help`
- `gc session kill --help`
- `gc session reset --help`
- `gc session pin --help`
- `gc session unpin --help`
- `gc runtime --help`
- `gc runtime drain --help`
- `gc runtime undrain --help`
- `gc runtime drain-check --help`
- `gc runtime drain-ack --help`
- `gc runtime request-restart --help`
- `gc rig --help`
- `gc rig suspend --help`
- `gc rig resume --help`
- `gc agent suspend --help`
- `gc agent resume --help`
- `gc suspend --help`
- `gc resume --help`
- `gc mail --help`
- `gc convoy --help`
- `gc hook --help`
- `gc status --help`
- `gc doctor --help`
- `gc sling --help`

Repo references:

- `apps/web/src/components/ProjectScriptsControl.tsx`
- `apps/web/src/components/Sidebar.logic.ts`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/chat/ChatHeader.tsx`
- `apps/server/src/gc/Services/GcApiClient.ts`
- `packages/contracts/src/gc.ts`
- `packages/contracts/src/orchestration.ts`
