# T3 Sidebar Folder Behavior

This document captures the sidebar folder model that is currently working after the latest merge.

## High-Level Model

The sidebar has two separate grouping stages:

1. **Project grouping**
   Projects are first grouped into logical sidebar projects.
2. **Thread grouping inside a project**
   Threads under one logical project are then split into:
   - GC-backed virtual rig / agent folders
   - standalone threads that still render as plain thread rows

Those two stages are independent and both matter.

## 1. Project Grouping

Project grouping happens in:

- [sidebarProjectGrouping.ts](/data/projects/t3code/apps/web/src/sidebarProjectGrouping.ts)
- [logicalProject.ts](/data/projects/t3code/apps/web/src/logicalProject.ts)

The sidebar does **not** always render one row per physical project.

Instead:

- each physical project gets a `physicalProjectKey`
- each project also gets a `logicalProjectKey`
- multiple physical projects can collapse into one logical sidebar project depending on grouping mode

Grouping mode comes from settings:

- global: `sidebarProjectGroupingMode`
- per-project override: `sidebarProjectGroupingOverrides`

Supported modes:

- `repository`
  Group all projects that share the same repository identity canonical key.
- `repository_path`
  Group by repository plus repository-relative path.
- `separate`
  Do not group; each physical project stays separate.

The sidebar snapshot builder then creates one `SidebarProjectSnapshot` per logical project, with:

- `projectKey`
- `displayName`
- `memberProjects`
- `groupedProjectCount`
- `environmentPresence`

That is why one visible sidebar project can represent multiple local/remote project entries.

## 2. Thread Grouping Within a Project

Thread partitioning happens in:

- [Sidebar.logic.ts](/data/projects/t3code/apps/web/src/components/Sidebar.logic.ts)
- function: `partitionProjectThreadsForSidebar(...)`

For a given logical project:

1. collect the project threads
2. optionally keep the active thread visible when the project is collapsed
3. pass those threads into `partitionProjectThreadsForSidebar`

`partitionProjectThreadsForSidebar` returns:

- `rigGroups`
- `visibleStandaloneThreads`
- `hiddenStandaloneThreads`
- `hasHiddenStandaloneThreads`

Internally it does two things:

1. `groupThreadsByRigAndAgent(...)`
   Detects which threads belong under GC virtual folders.
2. `getVisibleThreadsForProject(...)`
   Applies preview / show-more rules to only the standalone thread list.

Important consequence:

- GC folder contents are computed before standalone-thread preview trimming
- standalone thread preview rules do **not** decide what goes into rig folders

## 3. What Renders As A Folder

Folders only exist for GC-derived virtual groups.

Rendering flow in [Sidebar.tsx](/data/projects/t3code/apps/web/src/components/Sidebar.tsx):

- `rigGroups.length > 0` => render `SidebarGcFolders`
- each rig group contains `agentGroups`
- each agent group contains `threadIds`
- thread rows for those IDs are rendered by looking them up from `folderThreads`

Plain non-GC threads are rendered from `renderedThreads` as normal sidebar rows.

So the sidebar for one logical project can contain both:

- GC folders
- plain standalone thread rows

at the same time.

## 4. Collapsed Project Pinning

When a project is collapsed, the active thread should not disappear.

That behavior is implemented in [Sidebar.tsx](/data/projects/t3code/apps/web/src/components/Sidebar.tsx) via `pinnedCollapsedThread`.

Meaning:

- if project expanded: no pin
- if project collapsed and the active route thread belongs to that project:
  - that thread is kept visible

Then:

- `folderThreads` becomes either:
  - `[pinnedCollapsedThread]`, or
  - the full visible project thread list

This pinned thread must be available to both:

- folder lookup for GC thread IDs
- plain standalone row rendering

That is the main reason the `folderThreads` / `renderedThreads` split exists.

## 5. Why `folderThreads` And `renderedThreads` Are Different

They serve different purposes.

- `folderThreads`
  Source of truth for looking up threads referenced by GC rig / agent folders.
- `renderedThreads`
  Standalone rows that should render directly in the project list.

Do not collapse these into one array unless you re-check:

- collapsed active-thread pinning
- GC folder row lookup
- standalone preview / hidden-thread status

The previous breakages came from mixing those responsibilities.

## 6. Stability Rules

The sidebar is sensitive to selector identity and derived-state ownership.

Rules that matter:

- do not use object-literal selectors directly with `useSettings(...)`
  unless the result is memoized afterward
- keep project grouping settings referentially stable
- keep folder partitioning in derived memo state, not ad hoc in render branches
- treat project grouping and thread grouping as separate phases

## 7. Files That Define The Current Behavior

- [Sidebar.tsx](/data/projects/t3code/apps/web/src/components/Sidebar.tsx)
  Main rendering and per-project derived state.
- [Sidebar.logic.ts](/data/projects/t3code/apps/web/src/components/Sidebar.logic.ts)
  Thread partitioning and visibility rules.
- [sidebarProjectGrouping.ts](/data/projects/t3code/apps/web/src/sidebarProjectGrouping.ts)
  Logical project snapshot construction.
- [logicalProject.ts](/data/projects/t3code/apps/web/src/logicalProject.ts)
  Physical vs logical project keys and grouping-mode resolution.
- [Sidebar.logic.test.ts](/data/projects/t3code/apps/web/src/components/Sidebar.logic.test.ts)
  Regression tests for sidebar grouping / partition behavior.

## 8. In Practice

The working mental model is:

- first decide what a "project" means in the sidebar
- then decide which of that project's threads belong in GC folders
- then decide which standalone threads are visible vs hidden
- finally render GC folders and standalone rows side by side

If a future change breaks folders again, start debugging in exactly that order.
