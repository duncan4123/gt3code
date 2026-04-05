# Inline Expandable Tool Call Detail

Each tool call row in the chat timeline becomes clickable. Clicking it expands an inline collapsible panel below the compact row, showing the full tool call input, output, and changed files in a formatted view. Collapsing hides it again. Multiple entries can be expanded simultaneously.

## Data Plumbing

The raw `activity.payload` is currently discarded during the `deriveWorkLogEntries()` transformation in `session-logic.ts`. Rather than changing that pipeline, a separate lookup map is built alongside it.

**In `ChatView.tsx`** (~line 1030), where `threadActivities` is already available:

```ts
const activityPayloadById = useMemo(
  () => new Map(threadActivities.map((a) => [a.id, a.payload])),
  [threadActivities],
);
```

This map is threaded through `MessagesTimelineProps` into the render context. `WorkLogEntry.id` matches `activity.id`, so lookup is trivial.

**No changes to:** `WorkLogEntry`, `session-logic.ts`, `DerivedWorkLogEntry`, or `packages/contracts`.

## Expansion State

In `MessagesTimeline.tsx`, alongside the existing `allDirectoriesExpandedByTurnId` pattern:

```ts
const [expandedToolEntryIds, setExpandedToolEntryIds] = useState<Record<string, boolean>>({});

const onToggleToolEntry = useCallback((entryId: string) => {
  setExpandedToolEntryIds((current) => ({
    ...current,
    [entryId]: !current[entryId],
  }));
}, []);
```

Multiple entries can be expanded at the same time. No "only one open" restriction.

`expandedToolEntryIds` is also passed to `estimateMessagesTimelineRowHeight()` for virtualizer accuracy.

## SimpleWorkEntryRow Changes

The existing `SimpleWorkEntryRow` component in `MessagesTimeline.tsx` (lines 835-891) receives two new props:

- `isExpanded: boolean`
- `onToggle: () => void`

And a new optional prop for the detail content:

- `payload: unknown` (from the `activityPayloadById` lookup)

### Structure

The row wraps in the existing `Collapsible` primitive from `components/ui/collapsible.tsx`:

- **Trigger:** The existing compact row content (icon + heading + preview). The entire row is the click target.
- **Chevron:** A `ChevronRight` icon on the right side of the row. Rotates 90deg when expanded. Styled `text-muted-foreground/40`, `size-3`.
- **Panel:** The `ToolCallDetail` component, rendered inside `CollapsiblePanel`.

The row gains `cursor-pointer` and a subtle hover state (`hover:bg-muted/30`).

## ToolCallDetail Component

**New file:** `apps/web/src/components/chat/ToolCallDetail.tsx`

**Props:**

```ts
interface ToolCallDetailProps {
  workEntry: WorkLogEntry;
  payload: unknown;
}
```

### Layout

The detail panel is left-indented `pl-7` to align past the row icon. It renders inside a subtle card (`bg-muted/30 border-border/30 rounded-lg`) with three conditional sections:

### Input Section

Extracted from `payload.data.item.input` or `payload.data.item.command` using the same safe traversal pattern as `extractToolCommand()` in `session-logic.ts`.

Displayed as key-value pairs in monospace font (`font-mono text-[11px]`). Keys are `text-muted-foreground`, values are `text-foreground`. String values that look like file paths or code are shown verbatim. Objects are rendered as formatted key-value rows (one level deep, no recursive nesting).

### Output Section

Source: `payload.detail` (the full string, not the truncated `workEntry.detail`) or `payload.data.item.result.content`.

Rendered in a `<pre>` block inside a scrollable container:

- `max-h-[300px]` with `overflow-y-auto`
- `font-mono text-xs`
- `bg-background/50 rounded-md p-2`
- Preserves whitespace and line breaks

If the output contains an exit code suffix (e.g., `<exited with exit code 0>`), strip it using the existing `stripTrailingExitCode()` helper from `session-logic.ts` (export it if not already exported).

### Changed Files Section

From `workEntry.changedFiles`. Shows the full list (no 4-file truncation like the compact row). Rendered using the same badge styling as the existing compact row: `rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px]`.

### Empty State

If the payload is null/undefined or contains no extractable input or output, show a single muted line: "No details available".

## Virtualizer Integration

### Height Estimation

`estimateWorkRowHeight()` in `MessagesTimeline.logic.ts` accepts `expandedToolEntryIds` in its input parameter. For each visible entry whose id is in the expanded set, add 320px (300px content cap + 20px padding) to the row height estimate.

```ts
function estimateWorkRowHeight(
  row: Extract<MessagesTimelineRow, { kind: "work" }>,
  input: {
    expandedWorkGroups?: Readonly<Record<string, boolean>>;
    expandedToolEntryIds?: Readonly<Record<string, boolean>>;
  },
): number {
  // ... existing logic for visible entries ...

  // Add height for expanded tool entries
  let expandedHeight = 0;
  for (const entry of visibleEntries) {
    if (input.expandedToolEntryIds?.[entry.id]) {
      expandedHeight += 320;
    }
  }

  return baseHeight + expandedHeight;
}
```

Where `visibleEntries` refers to the entries resolved from the existing overflow/expansion logic, not `row.groupedEntries` directly.

### Re-measurement

The virtualizer already re-measures via `measureVirtualElement` on DOM changes. The `Collapsible` component animates height via CSS transitions. No manual invalidation is needed -- the existing `data-index` measurement refs handle this.

## Files Changed

| File                                                     | Change                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/web/src/components/ChatView.tsx`                   | Add `activityPayloadById` memo, pass to `MessagesTimeline`                    |
| `apps/web/src/components/chat/MessagesTimeline.tsx`      | Add expansion state, pass props to `SimpleWorkEntryRow`, import `Collapsible` |
| `apps/web/src/components/chat/MessagesTimeline.logic.ts` | Extend `estimateWorkRowHeight` to account for expanded entries                |
| `apps/web/src/components/chat/ToolCallDetail.tsx`        | **New file** -- formatted tool call detail panel                              |
| `apps/web/src/session-logic.ts`                          | Export `stripTrailingExitCode` if not already exported                        |

## Not In Scope

- Raw JSON toggle view
- Side sheet or modal presentation
- Tool call timing/duration display
- Syntax highlighting for output content (can be added later)
- Keyboard navigation between expanded entries
