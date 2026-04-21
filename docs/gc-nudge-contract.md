# GC Nudge Contract

Date: 2026-04-20

## Operator Surface

- `gc nudge` is not the operator entrypoint for sending a message to a managed T3 session.
- `gc nudge` only inspects deferred nudges (`gc nudge status`).
- `gc session nudge <id-or-alias> <message...>` is the direct transport command.
- `gc session submit <id-or-alias> <message...>` is the semantic wrapper when GC should decide whether to wake, queue, or interrupt.

Implication: any T3 or GC docs that say "use `gc nudge` to message the agent" are wrong for current CLI behavior.

## Intended T3 Contract

For GC-managed T3 sessions, the intended nudge path is:

1. Operator runs `gc session nudge ...` or `gc session submit ...`.
2. Gas City runtime provider resolves the target managed session.
3. For T3-backed sessions, the provider sends a T3 WebSocket RPC command equivalent to `thread.turn.start`.
4. T3 orchestration decider converts `thread.turn.start` into:
   - `thread.message-sent` for the user message
   - `thread.turn-start-requested` referencing that `messageId`
5. `ProviderCommandReactor` consumes `thread.turn-start-requested`, looks up the user message, and calls the provider runtime with the message text.
6. Provider runtime events are projected back into thread activities and session state.

The T3 side already codifies the `thread.turn.start` contract:

- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`

## Concrete Findings

### 1. CLI surface mismatch

GC CLI help shows:

- `gc nudge`: inspect queued/dead-letter nudges only
- `gc session nudge`: send text input to a running session
- `gc session submit`: semantic message delivery

This is the first ambiguity boundary. The old shorthand "`gc nudge` sends a message" is stale.

### 2. T3 server has no GC-specific nudge RPC

T3 currently exposes GC RPC methods for:

- `gc.getConfig`
- `gc.findThreadBinding`
- `gc.getThreadContext`
- `gc.setAgentSuspended`
- `gc.setAgentSessionMode`
- `gc.setRigSuspended`

There is no shipped `gc.sessionAction` or `gc.nudge` WS RPC in T3. For nudges, GC must use the generic orchestration command path, not a GC-specific server method.

### 3. `thread.turn.start` path is valid if caller sends the full command

`decider.ts` proves `thread.turn.start` is not a thin signal. It creates the user message event and then emits `thread.turn-start-requested` with the same `messageId`.

`ProviderCommandReactor.ts` then requires that user message to exist before sending provider input. If the message is absent, T3 records:

`Provider turn start failed`

with detail:

`User message '<id>' was not found for turn start request.`

Implication: any GC bridge that bypasses the full `thread.turn.start` command shape, or injects only a downstream event / partial action, will fail inside T3 at the provider-command-reactor boundary.

### 4. `gc.nudge.sent` is observational, not transport

`packages/contracts/src/gc.ts` defines `gc.nudge.sent`, but T3 does not originate nudge delivery through that activity kind. It is an activity/metadata contract for provider-originated GC events, not the input transport itself.

## Repro / Validation

1. In GC, inspect command surfaces:
   - `gc nudge --help`
   - `gc session nudge --help`
   - `gc session submit --help`
2. In T3, inspect shipped GC RPC methods:
   - `packages/contracts/src/rpc.ts`
   - `apps/server/src/ws.ts`
3. Inspect turn-start lifecycle:
   - `apps/server/src/orchestration/decider.ts`
   - `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
4. Observe that no T3 GC-specific nudge RPC exists, and that a missing user message causes turn-start failure.

## Breakage Boundary

Most likely breakage boundary: upstream GC bridge / runtime transport, not T3 provider runtime ingestion.

Reason:

- T3 already accepts generic `thread.turn.start`.
- T3 already materializes the user message when the full command is dispatched.
- T3 already forwards the resolved user text to the provider runtime.
- T3 does not expose a separate GC nudge RPC, so any integration expecting one will stall at the RPC/orchestration boundary.

More precise failure modes to check downstream:

- GC bridge still calling an older/planned `gc.sessionAction` path instead of `orchestration.dispatchCommand`
- GC bridge dispatching an incomplete turn-start payload
- GC bridge treating `gc.nudge.sent` as an input action instead of a projected activity

## Proposed Fix Boundary

Downstream fix should start in the GC bridge layer that talks to T3.

Required contract:

- Resolve session -> thread binding
- Dispatch full `thread.turn.start` command through T3 orchestration RPC
- Include the full `message` object expected by the T3 command schema
- Do not invent a GC-specific nudge RPC unless T3 intentionally adds one

If T3 needs any follow-up, it is documentation-only:

- clarify that managed-session nudges use generic orchestration dispatch
- remove any stale references to `gc.sessionAction` / `gc nudge` as the send path
