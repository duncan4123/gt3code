# Manual Port Analysis: 945da87d "Add FTS-backed sidebar thread search"

## CRITICAL PREREQUISITE: Contracts Changes Needed

The commit imports `OrchestrationSearchThreadMessagesResult` from `@t3tools/contracts` and
references `ORCHESTRATION_WS_METHODS.searchThreadMessages`, but **neither exists in contracts
on either branch**. These must be added first.

### File: `packages/contracts/src/orchestration.ts`

**Add to `ORCHESTRATION_WS_METHODS` (line 23, before the closing `} as const`):**

```ts
  searchThreadMessages: "orchestration.searchThreadMessages",
```

After line 23 (`replayEvents: "orchestration.replayEvents",`), before `} as const;`.

**Add the result type (anywhere after the METHODS block, e.g., after line 28):**

```ts
export interface OrchestrationSearchThreadMessagesResult {
  results: ReadonlyArray<{
    threadId: string;
    snippet: string;
  }>;
}
```

### File: `packages/contracts/src/ipc.ts`

**Add `searchThreadMessages` to the NativeApi `orchestration` block (line 200, before `onDomainEvent`):**

```ts
    searchThreadMessages: (input: {
      query: string;
      limit: number;
    }) => Promise<OrchestrationSearchThreadMessagesResult>;
```

**Add `OrchestrationSearchThreadMessagesResult` to the imports from `./orchestration`** (find the
existing orchestration imports and add it).

### File: `packages/contracts/src/ws.ts`

**Add the request body tag for the new method (line 129, after the `replayEvents` tag):**

```ts
  tagRequestBody(ORCHESTRATION_WS_METHODS.searchThreadMessages, Schema.Struct({
    query: Schema.String,
    limit: Schema.Number,
  })),
```

**Add `OrchestrationSearchThreadMessagesResult` to the imports if needed for response typing.**

---

## FILE 1: `apps/web/src/components/Sidebar.logic.test.ts`

### Imports (line 3-23)

**Add two imports to the existing import block from `./Sidebar.logic`:**

After line 13 (`hasUnseenCompletion,`), add:
```ts
  normalizeThreadSearchQuery,
```

After line 15 (`resolveSidebarNewThreadEnvMode,`), add:
```ts
  resolveSidebarThreadSearch,
```

(These go alphabetically in the existing named import list.)

### New test blocks (after line 167, after `resolveSidebarNewThreadEnvMode` describe block)

Insert between the `resolveSidebarNewThreadEnvMode` block (ends line 167) and the
`resolveAdjacentThreadId` block (starts line 169):

```ts
describe("normalizeThreadSearchQuery", () => {
  it("returns null for blank input", () => {
    expect(normalizeThreadSearchQuery("   ")).toBeNull();
  });

  it("quotes each term so plain text is safe for FTS MATCH", () => {
    expect(normalizeThreadSearchQuery('alpha beta "gamma"')).toBe('"alpha" "beta" "gamma"');
  });
});

describe("resolveSidebarThreadSearch", () => {
  it("combines title matches with FTS message hits", () => {
    const result = resolveSidebarThreadSearch({
      query: "release",
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-title"),
          projectId: ProjectId.makeUnsafe("project-a"),
          title: "Release checklist",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-fts"),
          projectId: ProjectId.makeUnsafe("project-b"),
          title: "Bug bash",
        }),
      ],
      ftsHits: [
        {
          threadId: ThreadId.makeUnsafe("thread-fts"),
          snippet: "ship the release build tonight",
        },
      ],
    });

    expect(result.isFiltering).toBe(true);
    expect([...result.matchingThreadIds]).toEqual(["thread-fts", "thread-title"]);
    expect(result.snippetByThreadId.get("thread-fts")).toBe("ship the release build tonight");
    expect([...result.matchingProjectIds]).toEqual(["project-b", "project-a"]);
  });

  it("returns an inert state when no query is present", () => {
    const result = resolveSidebarThreadSearch({
      query: " ",
      threads: [makeThread()],
      ftsHits: [],
    });

    expect(result.isFiltering).toBe(false);
    expect(result.matchingThreadIds.size).toBe(0);
    expect(result.matchingProjectIds.size).toBe(0);
  });
});
```

**CONCERN**: The `makeThread` helper is defined at line 661 in the current file. The new tests
use it with `title` and `projectId` overrides, which is already supported by the helper. No issue.

**CONCERN**: The `ftsHits` uses `ThreadId.makeUnsafe("thread-fts")` as `threadId` but
`SidebarThreadSearchHit.threadId` is typed as `string`. Since `ThreadId.makeUnsafe` returns a
branded string, this should be compatible (branded strings are assignable to `string`).

---

## FILE 2: `apps/web/src/components/Sidebar.logic.ts`

### New type alias (after line 20)

After line 20 (`type SidebarThreadSortInput = Pick<Thread, "createdAt" | "updatedAt" | "messages">;`),
add:

```ts
type SidebarThreadSearchInput = Pick<Thread, "id" | "projectId" | "title">;
```

### New interfaces (after line 49, after `ThreadStatusPill` interface closing brace)

After the `ThreadStatusPill` interface (closes at line 49 with `}`), add:

```ts
export interface SidebarThreadSearchHit {
  threadId: string;
  snippet: string;
}

export interface SidebarThreadSearchState {
  isFiltering: boolean;
  matchingThreadIds: ReadonlySet<string>;
  snippetByThreadId: ReadonlyMap<string, string>;
  matchingProjectIds: ReadonlySet<string>;
}
```

### New functions (after line 290, after `resolveSidebarNewThreadEnvMode`)

After the `resolveSidebarNewThreadEnvMode` function (ends at line 290 with `}`), add:

```ts
export function normalizeThreadSearchQuery(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const terms = trimmed
    .split(/\s+/)
    .map((term) => term.replaceAll('"', "").trim())
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return null;
  }

  return terms.map((term) => `"${term}"`).join(" ");
}

export function resolveSidebarThreadSearch(input: {
  query: string;
  threads: readonly SidebarThreadSearchInput[];
  ftsHits: readonly SidebarThreadSearchHit[];
}): SidebarThreadSearchState {
  const trimmedQuery = input.query.trim();
  if (trimmedQuery.length === 0) {
    return {
      isFiltering: false,
      matchingThreadIds: new Set(),
      snippetByThreadId: new Map(),
      matchingProjectIds: new Set(),
    };
  }

  const loweredQuery = trimmedQuery.toLowerCase();
  const matchingThreadIds = new Set<string>();
  const snippetByThreadId = new Map<string, string>();
  const matchingProjectIds = new Set<string>();

  for (const hit of input.ftsHits) {
    matchingThreadIds.add(hit.threadId);
    matchingProjectIds.add(
      input.threads.find((thread) => thread.id === hit.threadId)?.projectId ?? "",
    );
    if (!snippetByThreadId.has(hit.threadId)) {
      snippetByThreadId.set(hit.threadId, hit.snippet);
    }
  }

  for (const thread of input.threads) {
    if (!thread.title.toLowerCase().includes(loweredQuery)) {
      continue;
    }
    matchingThreadIds.add(thread.id);
    matchingProjectIds.add(thread.projectId);
  }

  matchingProjectIds.delete("");

  return {
    isFiltering: true,
    matchingThreadIds,
    snippetByThreadId,
    matchingProjectIds,
  };
}
```

---

## FILE 3: `apps/web/src/components/Sidebar.tsx`

This file has the MOST changes. The current branch has a significantly different structure
(uses `renderedProjects` memo vs `renderProjectItem` function). This is the main conflict area.

### Import changes

**1. Add `useDeferredValue` to React imports (line 16):**

Current line 16: `useCallback,`
Add `useDeferredValue,` after `useCallback,` (line 17 area).

**2. Add `cn` to utils import (line 56):**

Current: `import { isLinuxPlatform, isMacPlatform, newCommandId, newProjectId } from "../lib/utils";`
Change to: `import { cn, isLinuxPlatform, isMacPlatform, newCommandId, newProjectId } from "../lib/utils";`

**3. Add `orchestrationReactQuery` import (after line 67):**

After: `import { gitStatusQueryOptions } from "../lib/gitReactQuery";`
Add: `import { orchestrationSearchThreadMessagesQueryOptions } from "../lib/orchestrationReactQuery";`

**4. Add `Input` component import (after line 90, in the UI imports area):**

After the `Menu` import line (line 90), add:
```ts
import { Input } from "./ui/input";
```

**5. Add `normalizeThreadSearchQuery` and `resolveSidebarThreadSearch` to Sidebar.logic imports:**

In the import block starting at line 109, add:
- `normalizeThreadSearchQuery,` (alphabetically, after `isThreadArchived,`)
- `resolveSidebarThreadSearch,` (alphabetically, after `resolveProjectStatusIndicator,`)

### State and hooks

**After the `routeThreadId` block (line 391) and before the keybindings query (line 392):**

Add:
```ts
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const deferredThreadSearchQuery = useDeferredValue(threadSearchQuery);
  const normalizedThreadSearchQuery = useMemo(
    () => normalizeThreadSearchQuery(deferredThreadSearchQuery),
    [deferredThreadSearchQuery],
  );
```

**After the keybindings query (line 395) and before `const [addingProject` (line 396):**

Add:
```ts
  const { data: threadSearchResult, isFetching: isThreadSearchFetching } = useQuery(
    orchestrationSearchThreadMessagesQueryOptions({
      query: normalizedThreadSearchQuery,
      enabled: normalizedThreadSearchQuery !== null,
    }),
  );
```

### MAJOR STRUCTURAL DIFFERENCE: `renderedProjects` memo

The current gc-reintegration-v1 branch uses a `renderedProjects` useMemo (lines 1064-1139)
that pre-computes all project rendering data. The doctor-dolittle branch's commit uses a
`renderProjectItem` function instead.

**Approach: Add search filtering AROUND the existing `renderedProjects` memo rather than
restructuring.**

**After `sortedProjects` (line 1062) and before `isManualProjectSorting` (line 1063), add:**

```ts
  const threadSearchState = useMemo(
    () =>
      resolveSidebarThreadSearch({
        query: deferredThreadSearchQuery,
        threads: visibleThreads,
        ftsHits: threadSearchResult?.results ?? [],
      }),
    [deferredThreadSearchQuery, threadSearchResult?.results, visibleThreads],
  );
  const isThreadSearchActive = threadSearchState.isFiltering;
  const visibleProjects = useMemo(() => {
    if (!isThreadSearchActive) {
      return sortedProjects;
    }
    return sortedProjects.filter((project) => threadSearchState.matchingProjectIds.has(project.id));
  }, [isThreadSearchActive, sortedProjects, threadSearchState.matchingProjectIds]);
  const matchingThreadCount = threadSearchState.matchingThreadIds.size;
```

**In `renderedProjects` memo (line 1066), change `sortedProjects` to `visibleProjects`:**

Line 1066: `sortedProjects.map((project) => {` -> `visibleProjects.map((project) => {`

**In the dependency array (line 1134), change `sortedProjects` to `visibleProjects`:**

The deps currently include `sortedProjects`. Change to `visibleProjects`.

**Inside `renderedProjects` map function, modify for search filtering:**

1. Line 1071-1076: The `activeProjectThreads` and `archivedThreads` computation needs search filtering.
   Change:
   ```ts
   const activeProjectThreads = projectThreads.filter(
     (thread) => !isThreadArchived(thread.customMetadata),
   );
   const archivedThreads = projectThreads.filter((thread) =>
     isThreadArchived(thread.customMetadata),
   );
   ```
   To:
   ```ts
   const searchFilteredThreads = isThreadSearchActive
     ? projectThreads.filter((thread) => threadSearchState.matchingThreadIds.has(thread.id))
     : projectThreads;
   const activeProjectThreads = searchFilteredThreads.filter(
     (thread) => !isThreadArchived(thread.customMetadata),
   );
   const archivedThreads = isThreadSearchActive
     ? []
     : searchFilteredThreads.filter((thread) => isThreadArchived(thread.customMetadata));
   ```

2. Line 1093-1094: `pinnedCollapsedThread` should be suppressed during search:
   Change:
   ```ts
   const pinnedCollapsedThread =
     !project.expanded && activeThreadId
   ```
   To:
   ```ts
   const pinnedCollapsedThread =
     !isThreadSearchActive && !project.expanded && activeThreadId
   ```

3. Line 1097: `shouldShowThreadPanel` should always show during search:
   Change:
   ```ts
   const shouldShowThreadPanel = project.expanded || pinnedCollapsedThread !== null;
   ```
   To:
   ```ts
   const shouldShowThreadPanel =
     isThreadSearchActive || project.expanded || pinnedCollapsedThread !== null;
   ```

4. Line 1105: `isThreadListExpanded` should be true during search:
   Change:
   ```ts
   isThreadListExpanded,
   ```
   To:
   ```ts
   isThreadListExpanded: isThreadSearchActive || isThreadListExpanded,
   ```

5. Add `isThreadSearchActive` and `threadSearchState` to the deps of `renderedProjects`
   (line 1132-1138).

### Search input JSX

**Before `{shouldShowProjectPathEntry && (` (line 2016), add:**

```tsx
          <div className="mb-2 px-1">
            <Input
              nativeInput
              type="search"
              size="sm"
              value={threadSearchQuery}
              placeholder="Search threads..."
              aria-label="Search threads"
              onChange={(event) => {
                setThreadSearchQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && threadSearchQuery.length > 0) {
                  event.preventDefault();
                  setThreadSearchQuery("");
                }
              }}
            />
            {isThreadSearchActive ? (
              <div className="mt-1 px-1 text-[10px] text-muted-foreground/60">
                {isThreadSearchFetching
                  ? "Searching thread messages..."
                  : matchingThreadCount === 0
                    ? "No matching threads"
                    : `${matchingThreadCount} matching thread${matchingThreadCount === 1 ? "" : "s"}`}
              </div>
            ) : null}
          </div>
```

### DndContext/SidebarMenu changes

**Line 2081: Disable DnD during search:**

Change: `{isManualProjectSorting ? (`
To: `{isManualProjectSorting && !isThreadSearchActive ? (`

**Lines 2092, 2095: Already using `renderedProjects` which is filtered. No change needed.**

### "No threads found" empty state

**After the SidebarMenu closing (line 2114), before the "No projects yet" block (line 2116), add:**

```tsx
          {isThreadSearchActive && renderedProjects.length === 0 && (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
              No threads found
            </div>
          )}
```

### Search snippet on thread rows

**This is the hardest part.** The current branch computes thread rows inside `renderedProjects`
memo, not a render function. The snippet display needs to be added where thread rows are
rendered in the JSX.

The `renderedProjects` return value would need to include snippet info. Add to the return:
```ts
searchSnippetByThreadId: isThreadSearchActive ? threadSearchState.snippetByThreadId : null,
```

Then in the JSX where threads are rendered, use the snippet for `title` attribute and `ring-1`
class. This requires finding the thread row rendering in the JSX (search for where `renderProjectItem`
or equivalent renders `SidebarMenuSubButton`).

---

## FILE 4: `apps/web/src/lib/orchestrationReactQuery.ts` (NEW FILE)

This is a brand new file. Create it at:
`/data/projects/t3code/apps/web/src/lib/orchestrationReactQuery.ts`

```ts
import type { OrchestrationSearchThreadMessagesResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "../nativeApi";

export const orchestrationQueryKeys = {
  all: ["orchestration"] as const,
  searchThreadMessages: (query: string, limit: number) =>
    ["orchestration", "search-thread-messages", query, limit] as const,
};

const DEFAULT_THREAD_SEARCH_LIMIT = 25;
const DEFAULT_THREAD_SEARCH_STALE_TIME = 15_000;
const EMPTY_THREAD_SEARCH_RESULT: OrchestrationSearchThreadMessagesResult = {
  results: [],
};

export function orchestrationSearchThreadMessagesQueryOptions(input: {
  query: string | null;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_THREAD_SEARCH_LIMIT;
  return queryOptions({
    queryKey: orchestrationQueryKeys.searchThreadMessages(input.query ?? "", limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.query) {
        throw new Error("Thread message search is unavailable.");
      }
      return api.orchestration.searchThreadMessages({
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.query !== null,
    staleTime: input.staleTime ?? DEFAULT_THREAD_SEARCH_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_THREAD_SEARCH_RESULT,
  });
}
```

---

## FILE 5: `apps/web/src/wsNativeApi.test.ts`

### New test (after line 448, after the `gc.getThreadContext` test)

Insert after the `gc.getThreadContext` test block (ends at line 448 with `});`) and before
the "forwards context menu metadata" test (line 450):

```ts
  it("forwards thread message search requests to the orchestration websocket method", async () => {
    requestMock.mockResolvedValue({ results: [] });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.orchestration.searchThreadMessages({
      query: "release plan",
      limit: 10,
    });

    expect(requestMock).toHaveBeenCalledWith(ORCHESTRATION_WS_METHODS.searchThreadMessages, {
      query: "release plan",
      limit: 10,
    });
  });
```

---

## FILE 6: `apps/web/src/wsNativeApi.ts`

### Add `searchThreadMessages` to the orchestration block (after line 244, after `replayEvents`)

After line 244:
```ts
      replayEvents: (fromSequenceExclusive) =>
        transport.request(ORCHESTRATION_WS_METHODS.replayEvents, { fromSequenceExclusive }),
```

Add:
```ts
      searchThreadMessages: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.searchThreadMessages, input),
```

Before line 245:
```ts
      onDomainEvent: (callback) =>
```

---

## COMPATIBILITY CONCERNS

1. **Contracts dependency**: `OrchestrationSearchThreadMessagesResult` and
   `ORCHESTRATION_WS_METHODS.searchThreadMessages` must be added to contracts first. This is
   NOT part of commit 945da87d but is a prerequisite.

2. **Sidebar.tsx structural mismatch**: The biggest conflict. The gc-reintegration-v1 branch
   refactored `renderProjectItem` into a `renderedProjects` useMemo. The search filtering
   needs to be adapted to work within that memo structure rather than the function structure
   used in doctor-dolittle. The guidance above addresses this.

3. **`cn` import**: Not currently imported in Sidebar.tsx. Must be added from `"../lib/utils"`.

4. **`useDeferredValue`**: Not currently imported from React. Must be added.

5. **`Input` component**: Exists in `./ui/input` with `nativeInput` prop support. Compatible.

6. **`useQueryClient`**: The original diff imports it but the actual code doesn't use it in
   the search feature additions. The current branch may or may not already have it -- it
   appears NOT to be imported currently. It is NOT needed for the search feature.

7. **Server-side handler**: The `wsServer.ts` needs a `searchThreadMessages` handler.
   Commit f887c1d6 added a stub. This will also need to be ported (not part of this commit).

8. **`gitRemoveWorktreeMutationOptions` import**: The original diff shows this import but
   it's unrelated to the search feature. The current branch imports `gitStatusQueryOptions`
   from `../lib/gitReactQuery` but not the mutation. This is a pre-existing difference, not
   related to the search port.
