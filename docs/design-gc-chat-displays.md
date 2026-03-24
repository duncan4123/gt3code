# T3 Chat UI — Gas City Message And Display Inventory

## Goal

List the GC-originated data that reaches T3 today, identify what is only
implicit/plain-text right now, and define the dedicated UI displays we should
add in chat.

This is scoped to:

- GC-managed T3 threads
- chat-thread rendering
- top-bar / thread-context affordances when the thread is GC-owned

It is not a transport redesign. It is a rendering and message-shape plan.

## 1. GC Data That Already Reaches T3

### A. Project creation

Source:

- `gc-session-t3`
- T3 command: `project.create`

Fields:

- `projectId`
- `title`
- `workspaceRoot`
- `defaultModel`

Current UI:

- sidebar project folder

Needed display:

- no special chat card needed
- use this only for thread context and project badges

### B. Thread creation

Source:

- `gc-session-t3`
- T3 command: `thread.create`

Fields:

- `threadId`
- `projectId`
- `title`
- `model`
- `provider`
- `runtimeMode`
- `interactionMode`

Current UI:

- normal thread row in sidebar
- standard chat thread once opened

Needed display:

- thread header should expose GC-specific context from this creation step:
  - GC agent
  - runtime provider
  - rig
  - linked bead if present

### C. Initial prompt / start nudge

Source:

- `gc-session-t3`
- T3 command: `thread.turn.start`

Fields:

- `threadId`
- `message.role = "user"`
- `message.text`
- `provider`
- `model`
- `runtimeMode`
- `interactionMode`

Current UI:

- plain user chat message

Problem:

- this is often not a human chat message
- it may be a GC bootstrap prompt, work assignment, or system nudge

Needed display:

- `GcNudgeCard`
- if the turn came from GC startup or GC nudge, render it as a GC-originated
  control message, not a normal human bubble

### D. Runtime nudges after start

Source:

- `gc session nudge`
- `gc-session-t3 nudge`
- T3 command: `thread.turn.start`

Fields:

- message text only today
- provider/model currently inferred from thread mapping

Current UI:

- plain user chat message

Needed display:

- `GcNudgeCard`
- variants:
  - `info`
  - `status-check`
  - `redirect`
  - `drain-request`
  - `follow-up`

### E. GC custom metadata on thread

Source:

- `gc-session-t3`
- T3 command: `thread.meta.update`

Fields sent today:

- `gc.agent`
- `gc.rig`
- `gc.city`
- `gc.bead`
- `gc.beadTitle`
- `gc.provider`
- `gc.runtimeProvider`
- `gc.state`

Current UI:

- sidebar GC badge / state pill support
- not deeply surfaced in chat

Needed display:

- `GcThreadHeader`
- `GcAssignmentBanner`
- state badges in header and activity timeline

### F. Session lifecycle transitions

Source:

- `gc-session-t3`
- T3 command: `thread.meta.update`

States sent today:

- `active`
- `stopped`
- `drained`
- `archived`

Current UI:

- sidebar pills only

Needed display:

- `GcSessionStateCard`
- generated when state changes
- useful transitions:
  - worker started
  - worker interrupted
  - worker drained
  - worker archived

### G. Interrupt

Source:

- `gc-session-t3 interrupt`
- T3 command: `thread.turn.interrupt`

Current UI:

- no dedicated visible GC display

Needed display:

- `GcInterruptCard`
- show:
  - who interrupted
  - timestamp
  - whether turn was in progress

### H. Work assignment references

Source today:

- mostly indirect through metadata/env:
  - `GC_BEAD`
  - `GC_BEAD_TITLE`
  - `GC_AGENT`
  - `GC_TEMPLATE`
- bead routing happens in GC/beads, not directly as a rich T3 event

Current UI:

- thread title may include bead title or bead id
- sidebar metadata can show bead context

Problem:

- work assignment is the most important GC concept, but it is not represented
  as a first-class typed chat artifact yet

Needed display:

- `GcWorkAssignmentCard`
- fields:
  - bead id
  - bead title
  - rig
  - agent
  - convoy id
  - molecule id
  - formula name
  - source session or source bead
  - assignment timestamp

### I. GC runtime environment injected into provider process

Source:

- GC config -> `gc-session-t3` -> per-thread env file -> T3 provider adapter

Fields sent today:

- `GC_AGENT`
- `GC_PROVIDER`
- `GC_CITY`
- `GC_CITY_PATH`
- `GC_RIG`
- `GC_DIR`
- `GC_TEMPLATE`
- `GC_BEAD`
- `GC_BEAD_TITLE`
- `GC_SESSION_NAME`
- `GC_SESSION_ID`
- `GC_DOLT_PORT`

Current UI:

- none directly

Needed display:

- no raw env dump in chat
- selectively expose in a `GC Context` inspector panel:
  - agent
  - rig
  - template
  - bead
  - city path
  - provider/runtime provider

## 2. GC Concepts Not Yet Sent As First-Class T3 Artifacts

These are the ones worth adding if we want the chat UI to feel native.

### A. Convoy

Desired fields:

- convoy id
- convoy title
- convoy role
- sibling workers

Display:

- `GcConvoyCard`
- or a compact convoy section in thread header

### B. Molecule / formula step

Desired fields:

- molecule id
- formula name
- current step
- total steps
- step kind

Display:

- `GcFormulaProgressCard`
- or compact stepper above composer

### C. Queue / deferred nudge state

GC already has:

- queued nudges
- in-flight nudges
- dead-letter nudges

Display:

- `GcQueuedNudgeCard`
- `GcDeadLetterCard`

### D. Outcome / closure report

Desired fields:

- bead outcome
- summary
- pass/fail/block reason
- links to changed files or diff turn

Display:

- `GcOutcomeCard`

### E. Mail / coordination events

Desired fields:

- mail sender
- mail subject
- linked bead or convoy

Display:

- `GcMailCard`

## 3. Proposed Display Components

### 1. `GcThreadHeader`

Shown for any thread with `gc.agent`.

Content:

- agent badge
- rig
- runtime provider
- bead id/title if present
- session state badge

Actions:

- view bead
- open convoy
- nudge
- interrupt
- drain

### 2. `GcAssignmentBanner`

Shown near the top of the chat when the thread is bead-backed.

Content:

- bead title
- bead id
- formula / molecule if known
- assigned agent

### 3. `GcNudgeCard`

Used for GC-originated `thread.turn.start` messages that are not ordinary human
chat.

Content:

- label: `GC Nudge`
- message body
- subtype
- source
- timestamp

### 4. `GcWorkAssignmentCard`

Represents a routed bead assignment.

Content:

- bead id/title
- convoy
- molecule/formula
- assignment source
- assignment time

### 5. `GcSessionStateCard`

Represents lifecycle transitions.

Content:

- state transition
- thread/session identity
- timestamp
- optional reason

### 6. `GcFormulaProgressCard`

Represents the current molecule/formula step.

Content:

- formula name
- step index / total
- current step title
- blocked/running/completed status

### 7. `GcOutcomeCard`

Represents final work completion.

Content:

- pass/fail
- summary
- linked bead
- changed files / diff shortcut

### 8. `GcContextInspector`

Collapsible diagnostic panel.

Content:

- GC agent
- rig
- city
- template
- runtime provider
- bead
- session name/id

## 4. Recommended Rendering Rules

### Rule 1: Do not render GC control traffic as ordinary user chat

If the source is GC automation, it should not look like a human typed it into
the composer.

### Rule 2: Use thread metadata for persistent context

Persistent thread identity belongs in:

- header
- sidebar
- inspector

Not in repeated chat bubbles.

### Rule 3: Use typed activity cards for operational events

Operational events:

- assignment
- nudge
- interrupt
- drained
- archived
- outcome

These should be timeline items, not free-form text.

### Rule 4: Keep human conversation visually distinct from orchestration

Human messages, agent messages, and orchestration cards should have visibly
different treatments.

## 5. Minimum Viable UI Plan

### Phase 1: No protocol changes

Use existing data only:

- `gc.*` thread metadata
- `thread.turn.start` messages already sent by GC
- lifecycle state from `gc.state`

Build:

- `GcThreadHeader`
- `GcAssignmentBanner`
- `GcNudgeCard` heuristic for GC-originated startup/nudge turns
- `GcSessionStateCard` from metadata transitions

### Phase 2: Add richer GC payloads

Add explicit payloads for:

- work assignment
- convoy/molecule/formula
- outcome
- mail
- queued nudges

Build:

- `GcWorkAssignmentCard`
- `GcFormulaProgressCard`
- `GcOutcomeCard`
- `GcMailCard`

## 6. Best Next Step

Implement Phase 1 first.

It uses data we already have and will immediately make GC-managed threads feel
native in T3:

- better header
- better lifecycle visibility
- GC nudges rendered as control cards instead of plain user text

Then add a dedicated GC event/message schema for assignment, convoy, and
outcome flows.
