# T3 Sidebar Folder Behavior

This document captures the sidebar folder model that is currently working after the latest merge.

## High-Level Model

The sidebar now has two separate trees:

1. **Global GC control tree**
   Built directly from Gas City config, then enriched with runtime thread state.
2. **Project thread lists**
   Logical sidebar projects still render plain thread rows under each project.

Those two trees are independent and both matter.

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

## 2. Global GC Tree

GC grouping happens in:

- [packages/contracts/src/gc.ts](/data/projects/t3code/packages/contracts/src/gc.ts)
- [Sidebar.logic.ts](/data/projects/t3code/apps/web/src/components/Sidebar.logic.ts)
- [Sidebar.tsx](/data/projects/t3code/apps/web/src/components/Sidebar.tsx)

The important split is:

- `gcConfig` defines which workspace / rig / agent folders exist
- live threads only enrich runtime state for those configured nodes

The global GC section is built from:

- `rigGroups`

using:

1. `groupThreadsByRigAndAgent(...)`
   Builds the canonical config-first workspace / rig / agent tree.
2. `resolveGcAgentRuntimeState(...)`
   Attaches runtime labels like `Running`, `Ready`, `Suspended`, `No session`.

## 3. What Renders As A Folder

Folders in the GC section come from config, not from project cwd matching and not from “whatever threads exist”.

Rendering flow in [Sidebar.tsx](/data/projects/t3code/apps/web/src/components/Sidebar.tsx):

- fetch `gcConfig`
- build one top-level `SidebarGlobalGcSection`
- render `SidebarGcFolders` from the global `rigGroups`

Important consequence:

- a configured agent shows up even with no running thread
- a suspended rig or agent still shows up
- project rows do not control GC folder existence anymore

Plain threads still render under projects as normal thread rows.

## 4. Collapsed Project Pinning

When a project is collapsed, the active thread should not disappear.

That behavior is implemented in [Sidebar.tsx](/data/projects/t3code/apps/web/src/components/Sidebar.tsx) via `pinnedCollapsedThread`.

Meaning:

- if project expanded: no pin
- if project collapsed and the active route thread belongs to that project:
  - that thread is kept visible

Project rows still do this:

- optionally pin the active thread when collapsed
- preview / show-more trimming
- plain thread row rendering

But they no longer own the GC folder tree.

## 5. Why `folderThreads` And `renderedThreads` Are Different

`renderedThreads` under a project are now just the visible plain thread rows for that project.

The GC control tree is separate and config-driven.

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
  Main rendering, global GC section, and per-project thread state.
- [Sidebar.logic.ts](/data/projects/t3code/apps/web/src/components/Sidebar.logic.ts)
  Project thread partitioning and visibility rules.
- [gc.ts](/data/projects/t3code/packages/contracts/src/gc.ts)
  Canonical GC config/tree grouping.
- [sidebarProjectGrouping.ts](/data/projects/t3code/apps/web/src/sidebarProjectGrouping.ts)
  Logical project snapshot construction.
- [logicalProject.ts](/data/projects/t3code/apps/web/src/logicalProject.ts)
  Physical vs logical project keys and grouping-mode resolution.
- [Sidebar.logic.test.ts](/data/projects/t3code/apps/web/src/components/Sidebar.logic.test.ts)
  Regression tests for sidebar grouping / partition behavior.

## 8. In Practice

The working mental model is:

- first build the GC control tree from config
- then overlay runtime state and thread bindings onto that tree
- separately decide what a "project" means in the sidebar
- then render plain project thread rows with their own visibility rules

If a future change breaks folders again, start debugging in exactly that order.
