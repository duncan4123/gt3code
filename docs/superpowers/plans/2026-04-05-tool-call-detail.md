# Tool Call Detail Inline Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each tool call row in the chat timeline clickable, expanding an inline collapsible panel that shows the full tool input, output, and changed files.

**Architecture:** A separate payload lookup map (`Map<activityId, payload>`) is built in `ChatView.tsx` and threaded to the timeline. `SimpleWorkEntryRow` wraps in a `Collapsible` primitive. A new `ToolCallDetail` component renders the formatted detail panel. Expansion state lives in `MessagesTimeline` as `Record<string, boolean>`, following existing patterns.

**Tech Stack:** React 19, Tailwind CSS v4, @base-ui/react Collapsible primitive, lucide-react icons, Vitest

**Spec:** `docs/superpowers/specs/2026-04-05-tool-call-detail-drawer-design.md`

---

### Task 1: Export `stripTrailingExitCode` from session-logic

**Files:**

- Modify: `apps/web/src/session-logic.ts:681`

This function is currently private. The `ToolCallDetail` component will need it to clean exit code suffixes from output strings.

- [ ] **Step 1: Change function visibility**

In `apps/web/src/session-logic.ts`, at line 681, the function is declared as:

```ts
function stripTrailingExitCode(value: string): {
```

Change it to:

```ts
export function stripTrailingExitCode(value: string): {
```

- [ ] **Step 2: Add to test imports to verify export works**

In `apps/web/src/session-logic.test.ts`, add `stripTrailingExitCode` to the import block (line 10-24):

```ts
import {
  deriveCompletionDividerBeforeEntryId,
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  PROVIDER_OPTIONS,
  derivePendingApprovals,
  derivePendingUserInputs,
  deriveTimelineEntries,
  deriveWorkLogEntries,
  findLatestProposedPlan,
  findSidebarProposedPlan,
  hasActionableProposedPlan,
  hasToolActivityForTurn,
  isLatestTurnSettled,
  stripTrailingExitCode,
} from "./session-logic";
```

- [ ] **Step 3: Run typecheck to verify**

Run: `cd /data/projects/t3code && bun typecheck`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/session-logic.ts apps/web/src/session-logic.test.ts
git commit -m "feat: export stripTrailingExitCode for reuse in ToolCallDetail"
```

---

### Task 2: Create the `ToolCallDetail` component

**Files:**

- Create: `apps/web/src/components/chat/ToolCallDetail.tsx`

This is the formatted detail panel that renders inside the collapsible. It extracts input and output from the raw activity payload and displays them in a readable format.

- [ ] **Step 1: Create the component file**

Create `apps/web/src/components/chat/ToolCallDetail.tsx`:

```tsx
import { memo } from "react";
import { type WorkLogEntry, stripTrailingExitCode } from "../../session-logic";
import { cn } from "~/lib/utils";

interface ToolCallDetailProps {
  workEntry: WorkLogEntry;
  payload: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractToolInput(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  const data = asRecord(record?.data);
  const item = asRecord(data?.item);
  const input = asRecord(item?.input);
  if (input && Object.keys(input).length > 0) {
    return input;
  }
  // Fallback: if there's a command at item level, surface it
  const command = item?.command;
  if (typeof command === "string" && command.length > 0) {
    return { command };
  }
  return null;
}

function extractToolOutput(payload: unknown): string | null {
  const record = asRecord(payload);
  // Primary: payload.detail (full output string)
  if (typeof record?.detail === "string" && record.detail.length > 0) {
    const { output } = stripTrailingExitCode(record.detail);
    return output;
  }
  // Fallback: payload.data.item.result.content or payload.data.item.result as string
  const data = asRecord(record?.data);
  const item = asRecord(data?.item);
  const result = item?.result;
  if (typeof result === "string" && result.length > 0) {
    return result;
  }
  const resultRecord = asRecord(result);
  if (typeof resultRecord?.content === "string" && resultRecord.content.length > 0) {
    return resultRecord.content;
  }
  return null;
}

function formatInputValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "null";
  return JSON.stringify(value, null, 2);
}

export const ToolCallDetail = memo(function ToolCallDetail({
  workEntry,
  payload,
}: ToolCallDetailProps) {
  const input = extractToolInput(payload);
  const output = extractToolOutput(payload);
  const changedFiles = workEntry.changedFiles ?? [];
  const hasContent = input !== null || output !== null || changedFiles.length > 0;

  if (!hasContent) {
    return (
      <div className="pl-7 pt-1 pb-1">
        <p className="text-[11px] text-muted-foreground/50 italic">No details available</p>
      </div>
    );
  }

  return (
    <div className="pl-7 pt-1.5 pb-1">
      <div className="space-y-2 rounded-lg border border-border/30 bg-muted/30 p-2">
        {input !== null && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Input
            </p>
            <div className="rounded-md bg-background/50 p-2">
              <dl className="space-y-0.5">
                {Object.entries(input).map(([key, value]) => (
                  <div key={key} className="flex gap-2 font-mono text-[11px]">
                    <dt className="shrink-0 text-muted-foreground">{key}:</dt>
                    <dd
                      className={cn(
                        "min-w-0 break-all text-foreground/90",
                        typeof value === "string" && value.length > 120
                          ? "whitespace-pre-wrap"
                          : "truncate",
                      )}
                      title={formatInputValue(value)}
                    >
                      {formatInputValue(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}

        {output !== null && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Output
            </p>
            <div className="max-h-[300px] overflow-y-auto rounded-md bg-background/50 p-2">
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground/85">
                {output}
              </pre>
            </div>
          </div>
        )}

        {changedFiles.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Changed files
            </p>
            <div className="flex flex-wrap gap-1">
              {changedFiles.map((filePath) => (
                <span
                  key={filePath}
                  className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75"
                  title={filePath}
                >
                  {filePath}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
```

- [ ] **Step 2: Run typecheck**

Run: `cd /data/projects/t3code && bun typecheck`
Expected: PASS

- [ ] **Step 3: Run fmt and lint**

Run: `cd /data/projects/t3code && bun fmt && bun lint`
Expected: PASS (fmt may auto-fix formatting)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chat/ToolCallDetail.tsx
git commit -m "feat: add ToolCallDetail component for inline tool call expansion"
```

---

### Task 3: Add expansion state and wire `SimpleWorkEntryRow` to Collapsible

**Files:**

- Modify: `apps/web/src/components/chat/MessagesTimeline.tsx`

This task modifies `SimpleWorkEntryRow` to wrap in a `Collapsible`, adds expansion state to the timeline, passes the payload map, and adds the chevron indicator.

- [ ] **Step 1: Add imports**

In `apps/web/src/components/chat/MessagesTimeline.tsx`, add to the existing import block.

After the `ChevronRightIcon` or similar lucide import line (around line 28-35), ensure `ChevronRightIcon` is imported. The existing lucide imports are on lines 23-34. Add `ChevronRightIcon` to that import:

```ts
import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  type LucideIcon,
  SquarePenIcon,
  TerminalIcon,
  Undo2Icon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
```

Add the Collapsible import after the existing UI imports (around line 36):

```ts
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "../ui/collapsible";
```

Add the ToolCallDetail import:

```ts
import { ToolCallDetail } from "./ToolCallDetail";
```

- [ ] **Step 2: Add `activityPayloadById` to `MessagesTimelineProps`**

In `MessagesTimelineProps` (line 66-99), add a new prop after `workspaceRoot`:

```ts
  workspaceRoot: string | undefined;
  activityPayloadById: ReadonlyMap<string, unknown>;
  onVirtualizerSnapshot?: (snapshot: {
```

- [ ] **Step 3: Destructure the new prop**

In the `MessagesTimeline` component destructuring (lines 101-124), add `activityPayloadById`:

```ts
  workspaceRoot,
  activityPayloadById,
  onVirtualizerSnapshot,
}: MessagesTimelineProps) {
```

- [ ] **Step 4: Add expansion state**

After the `allDirectoriesExpandedByTurnId` state declaration (around line 296-304), add:

```ts
const [expandedToolEntryIds, setExpandedToolEntryIds] = useState<Record<string, boolean>>({});
const onToggleToolEntry = useCallback((entryId: string) => {
  setExpandedToolEntryIds((current) => ({
    ...current,
    [entryId]: !current[entryId],
  }));
}, []);
```

- [ ] **Step 5: Pass `expandedToolEntryIds` to the virtualizer's `estimateSize`**

In the `useVirtualizer` config (around line 218-226), update `estimateSize` to pass `expandedToolEntryIds`:

```ts
    estimateSize: (index: number) => {
      const row = rows[index];
      if (!row) return 96;
      return estimateMessagesTimelineRowHeight(row, {
        expandedWorkGroups,
        expandedToolEntryIds,
        timelineWidthPx,
        turnDiffSummaryByAssistantMessageId,
      });
    },
```

- [ ] **Step 6: Update work row rendering to pass new props to `SimpleWorkEntryRow`**

In the work row rendering section (around lines 347-349), update the `SimpleWorkEntryRow` usage:

Replace:

```tsx
<div className="space-y-0.5">
  {visibleEntries.map((workEntry) => (
    <SimpleWorkEntryRow key={`work-row:${workEntry.id}`} workEntry={workEntry} />
  ))}
</div>
```

With:

```tsx
<div className="space-y-0.5">
  {visibleEntries.map((workEntry) => (
    <SimpleWorkEntryRow
      key={`work-row:${workEntry.id}`}
      workEntry={workEntry}
      isExpanded={expandedToolEntryIds[workEntry.id] ?? false}
      onToggle={() => onToggleToolEntry(workEntry.id)}
      payload={activityPayloadById.get(workEntry.id)}
    />
  ))}
</div>
```

- [ ] **Step 7: Rewrite `SimpleWorkEntryRow` with Collapsible wrapping**

Replace the entire `SimpleWorkEntryRow` component (lines 835-891) with:

```tsx
const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  isExpanded: boolean;
  onToggle: () => void;
  payload?: unknown;
}) {
  const { workEntry, isExpanded, onToggle, payload } = props;
  const iconConfig = workToneIcon(workEntry.tone);
  const EntryIcon = workEntryIcon(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const preview = workEntryPreview(workEntry);
  const displayText = preview ? `${heading} - ${preview}` : heading;
  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const previewIsChangedFiles = hasChangedFiles && !workEntry.command && !workEntry.detail;

  return (
    <Collapsible open={isExpanded}>
      <CollapsibleTrigger
        onClick={onToggle}
        className="w-full cursor-pointer rounded-lg px-1 py-1 text-left transition-colors duration-100 hover:bg-muted/30"
      >
        <div className="flex items-center gap-2 transition-[opacity,translate] duration-200">
          <span
            className={cn("flex size-5 shrink-0 items-center justify-center", iconConfig.className)}
          >
            <EntryIcon className="size-3" />
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p
              className={cn(
                "truncate text-[11px] leading-5",
                workToneClass(workEntry.tone),
                preview ? "text-muted-foreground/70" : "",
              )}
              title={displayText}
            >
              <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                {heading}
              </span>
              {preview && <span className="text-muted-foreground/55"> - {preview}</span>}
            </p>
          </div>
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 text-muted-foreground/40 transition-transform duration-200",
              isExpanded && "rotate-90",
            )}
          />
        </div>
        {hasChangedFiles && !previewIsChangedFiles && !isExpanded && (
          <div className="mt-1 flex flex-wrap gap-1 pl-6">
            {workEntry.changedFiles?.slice(0, 4).map((filePath) => (
              <span
                key={`${workEntry.id}:${filePath}`}
                className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75"
                title={filePath}
              >
                {filePath}
              </span>
            ))}
            {(workEntry.changedFiles?.length ?? 0) > 4 && (
              <span className="px-1 text-[10px] text-muted-foreground/55">
                +{(workEntry.changedFiles?.length ?? 0) - 4}
              </span>
            )}
          </div>
        )}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ToolCallDetail workEntry={workEntry} payload={payload} />
      </CollapsiblePanel>
    </Collapsible>
  );
});
```

Key changes from original:

- Wrapped in `Collapsible` with controlled `open={isExpanded}`
- Existing content wrapped in `CollapsibleTrigger`
- Added `ChevronRightIcon` on the right that rotates when expanded
- Changed files in compact view hidden when expanded (the detail panel shows the full list)
- `CollapsiblePanel` renders `ToolCallDetail`
- Added hover state and cursor-pointer

- [ ] **Step 8: Run typecheck**

Run: `cd /data/projects/t3code && bun typecheck`
Expected: Will FAIL because `ChatView.tsx` doesn't pass `activityPayloadById` yet, and `estimateMessagesTimelineRowHeight` doesn't accept `expandedToolEntryIds` yet. That's expected — Tasks 4 and 5 fix this.

- [ ] **Step 9: Commit (WIP)**

```bash
git add apps/web/src/components/chat/MessagesTimeline.tsx
git commit -m "feat: wire SimpleWorkEntryRow to Collapsible with expansion state"
```

---

### Task 4: Update height estimation in MessagesTimeline.logic.ts

**Files:**

- Modify: `apps/web/src/components/chat/MessagesTimeline.logic.ts:132-175`

- [ ] **Step 1: Add `expandedToolEntryIds` to `estimateMessagesTimelineRowHeight` input type**

In `apps/web/src/components/chat/MessagesTimeline.logic.ts`, update the `input` parameter type at lines 134-138:

```ts
export function estimateMessagesTimelineRowHeight(
  row: MessagesTimelineRow,
  input: {
    timelineWidthPx: number | null;
    expandedWorkGroups?: Readonly<Record<string, boolean>>;
    expandedToolEntryIds?: Readonly<Record<string, boolean>>;
    turnDiffSummaryByAssistantMessageId?: ReadonlyMap<MessageId, TurnDiffSummary>;
  },
): number {
```

- [ ] **Step 2: Update `estimateWorkRowHeight` to accept and use `expandedToolEntryIds`**

Replace the `estimateWorkRowHeight` function (lines 160-175) with:

```ts
function estimateWorkRowHeight(
  row: Extract<MessagesTimelineRow, { kind: "work" }>,
  input: {
    expandedWorkGroups?: Readonly<Record<string, boolean>>;
    expandedToolEntryIds?: Readonly<Record<string, boolean>>;
  },
): number {
  const isExpanded = input.expandedWorkGroups?.[row.id] ?? false;
  const hasOverflow = row.groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
  const visibleCount =
    hasOverflow && !isExpanded ? MAX_VISIBLE_WORK_LOG_ENTRIES : row.groupedEntries.length;
  const onlyToolEntries = row.groupedEntries.every((entry) => entry.tone === "tool");
  const showHeader = hasOverflow || !onlyToolEntries;

  // Resolve actual visible entries for expanded tool height calculation
  const visibleEntries =
    hasOverflow && !isExpanded
      ? row.groupedEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
      : row.groupedEntries;

  let expandedToolHeight = 0;
  for (const entry of visibleEntries) {
    if (input.expandedToolEntryIds?.[entry.id]) {
      expandedToolHeight += 320;
    }
  }

  // Card chrome, optional header, and one compact work-entry row per visible entry.
  return 28 + (showHeader ? 26 : 0) + visibleCount * 32 + expandedToolHeight;
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /data/projects/t3code && bun typecheck`
Expected: Will still fail because `ChatView.tsx` doesn't pass `activityPayloadById` yet. That's Task 5.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chat/MessagesTimeline.logic.ts
git commit -m "feat: account for expanded tool entries in virtualizer height estimation"
```

---

### Task 5: Pass `activityPayloadById` from ChatView

**Files:**

- Modify: `apps/web/src/components/ChatView.tsx`

- [ ] **Step 1: Add the memoized payload map**

In `apps/web/src/components/ChatView.tsx`, after the `workLogEntries` memo (around line 1031-1034), add:

```ts
const activityPayloadById = useMemo(
  () => new Map(threadActivities.map((a) => [a.id, a.payload as unknown])),
  [threadActivities],
);
```

- [ ] **Step 2: Pass the prop to `MessagesTimeline`**

In the `<MessagesTimeline>` JSX (around line 3985-4008), add `activityPayloadById` prop after `workspaceRoot`:

```tsx
<MessagesTimeline
  key={activeThread.id}
  hasMessages={timelineEntries.length > 0}
  isWorking={isWorking}
  activeTurnInProgress={isWorking || !latestTurnSettled}
  activeTurnStartedAt={activeWorkStartedAt}
  scrollContainer={messagesScrollElement}
  timelineEntries={timelineEntries}
  completionDividerBeforeEntryId={completionDividerBeforeEntryId}
  completionSummary={completionSummary}
  turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
  nowIso={nowIso}
  expandedWorkGroups={expandedWorkGroups}
  onToggleWorkGroup={onToggleWorkGroup}
  onOpenTurnDiff={onOpenTurnDiff}
  revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
  onRevertUserMessage={onRevertUserMessage}
  isRevertingCheckpoint={isRevertingCheckpoint}
  onImageExpand={onExpandTimelineImage}
  markdownCwd={gitCwd ?? undefined}
  resolvedTheme={resolvedTheme}
  timestampFormat={timestampFormat}
  workspaceRoot={activeProject?.cwd ?? undefined}
  activityPayloadById={activityPayloadById}
/>
```

- [ ] **Step 3: Run typecheck**

Run: `cd /data/projects/t3code && bun typecheck`
Expected: PASS — all types should resolve now.

- [ ] **Step 4: Run full check suite**

Run: `cd /data/projects/t3code && bun fmt && bun lint && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ChatView.tsx
git commit -m "feat: build activityPayloadById map and pass to MessagesTimeline"
```

---

### Task 6: Update test files with new required prop

**Files:**

- Modify: `apps/web/src/components/chat/MessagesTimeline.test.tsx`
- Modify: `apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx`

Both test files render `<MessagesTimeline>` and need the new required `activityPayloadById` prop.

- [ ] **Step 1: Add `activityPayloadById` to `MessagesTimeline.test.tsx`**

In `apps/web/src/components/chat/MessagesTimeline.test.tsx`, there are two `<MessagesTimeline>` renders. In each one, add `activityPayloadById={new Map()}` after `workspaceRoot={undefined}`.

First render (around line 91-92):

```tsx
        workspaceRoot={undefined}
        activityPayloadById={new Map()}
      />,
```

Second render (around line 136-137):

```tsx
        workspaceRoot={undefined}
        activityPayloadById={new Map()}
      />,
```

- [ ] **Step 2: Add `activityPayloadById` to browser virtualization test defaults**

In `apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx`, the harness passes `{...props}` to `<MessagesTimeline>`, so the prop flows through automatically. The default props construction needs the new prop.

Find the line (around 161-162):

```ts
    expandedWorkGroups: input.expandedWorkGroups ?? {},
    onToggleWorkGroup: () => {},
```

Add after it:

```ts
    activityPayloadById: new Map<string, unknown>(),
```

- [ ] **Step 3: Run tests**

Run: `cd /data/projects/t3code && bun run test`
Expected: PASS

- [ ] **Step 4: Run full check suite**

Run: `cd /data/projects/t3code && bun fmt && bun lint && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/chat/MessagesTimeline.test.tsx apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx
git commit -m "test: pass activityPayloadById to all MessagesTimeline test renders"
```

---

### Task 7: Run full verification and manual test

**Files:** None (verification only)

- [ ] **Step 1: Run all checks**

Run: `cd /data/projects/t3code && bun fmt && bun lint && bun typecheck`
Expected: PASS

- [ ] **Step 2: Run all tests**

Run: `cd /data/projects/t3code && bun run test`
Expected: PASS

- [ ] **Step 3: Build the web app**

Run: `cd /data/projects/t3code && cd apps/web && bun run build`
Expected: PASS — no build errors.

- [ ] **Step 4: Start dev server and verify in browser**

Run: `cd /data/projects/t3code && bun dev`

Open the app in the browser. Send a message to trigger tool calls. Verify:

1. Each tool call row shows a small chevron on the right
2. Clicking a row expands the detail panel inline with smooth animation
3. Input section shows tool arguments as key-value pairs
4. Output section shows full output in a scrollable container capped at 300px
5. Changed files show the full list (no truncation)
6. Clicking again collapses the panel
7. Multiple rows can be expanded simultaneously
8. The "No details available" message shows for entries without payload data
9. Scrolling works correctly with expanded entries (virtualizer handles the height)

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```
