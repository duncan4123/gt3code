# Gas City Sidebar Rules

This file documents the rules for the fork-owned Gas City sidebar integration.
Keep these rules true when changing `apps/web/src/gc/*` or the small integration
points in `apps/web/src/components/Sidebar.tsx`.

## Required Sidebar Model

The sidebar must show every configured Gas City city, repository-backed rig,
and agent.

- Every configured city must be visible in the Gas City section.
- Every configured rig repository must be represented as a normal T3 Code project folder.
- Every configured agent must be visible under its owning city or rig context.
- Suspended cities, rigs, and agents still show; suspension changes state, not existence.
- Stopped supervisors, stopped controllers, suspended configs, and missing
  sessions must not hide configured items.

## Control Model

Users must be able to start the app and control Gas City from the sidebar.

- The sidebar is the human control surface for configured cities, rigs, and agents.
- Users must be able to edit effective `city.toml` state from the sidebar,
  including city, rig, and agent suspend/resume state.
- Users must be able to control runtime lifecycle from the sidebar, including
  supervisor start/stop and city/controller start/stop.
- Runtime state decorates the configured model; runtime state does not define
  which cities, rigs, or agents exist.
- If a supervisor or controller is not running, the sidebar must still show the
  configured city and provide the controls needed to start it.
- The app must not require users to start GC outside the sidebar just to make
  configured entities appear.

## Rig Repositories

Rigs are repositories, and in the T3 Code sidebar each rig repository is a
normal project folder.

- A package directory inside another repository is not a rig.
- A configured path only counts as a rig project folder when that path is a
  repository root.
- Do not render rigs as a separate virtual folder system.
- Do not duplicate rigs as both a Gas City virtual folder and a project folder.
- Do not fork or rewrite upstream project-folder behavior for rigs.
- Rig repositories must use the existing upstream project folder UI and behavior exactly.
- The normal upstream "new thread" affordance must work for every rig repository.
- If a configured rig path does not exist, the project creation path must create it.
- T3 bridge sessions must attach threads to repository-backed project roots.
  They must not create project rows for city roots, `.gc` runtime directories,
  agent workdirs, generated worktrees, package folders inside another repo, or
  any other non-repository path.
- City/workspace agent threads may be grouped virtually under a city's
  `workspace` folder, but their backing T3 project must still be an ordinary
  repository project row.

## Gas City Section

The Gas City section is for city-level and control-plane visibility.

- It may show city state and city-scoped agents.
- It must show lifecycle controls for cities, rigs, agents, supervisors, and
  controllers when those controls are supported.
- It must not replace normal project folders for rigs.
- It must not create a second copy of project-folder hierarchy.

## Project Rows

GC integration may add missing rig repositories as projects only to preserve the
rules above.

- Project rows remain ordinary T3 Code project rows.
- Each configured rig repository must have its own project row.
- Active project rows must be unique by canonical workspace root. Duplicate rig
  project folders are a data invariant violation, not a sidebar rendering case.
- Duplicate active project rows for the same canonical workspace root must be
  rejected at write time, not cleaned up by sidebar filtering.
- Package folders that are not repositories must not be promoted into project
  rows as rigs.
- Non-GC project grouping must continue to behave like upstream.
- Changes should stay in fork-owned GC modules where possible.

## Thread Visibility

Threads are user data and must not be hidden by GC-specific sidebar filtering.
This is the first rule of the sidebar: if a thread exists in the T3 projection,
there must be a visible sidebar path to it.

- Every non-deleted thread returned by the main orchestration shell snapshot must
  remain reachable from the normal sidebar.
- GC may decorate, group, or label threads, but it must not use city, rig,
  agent, session, provider, runtime, archive, or config state to make a thread
  unreachable.
- GC-owned project folders must not be removed from the normal Projects list
  when they contain any threads.
- Active, sleeping, stopped, suspended, or degraded GC runtime state must not
  hide a thread.
- Foreign-city or stale GC metadata may disable unsafe GC actions, but it must
  not hide the thread row.
- Do not use Archived-page data, GC runtime state, project ownership, city
  ownership, missing config, or missing API reachability as a reason to filter a
  thread out of the main sidebar.

## Data Source

Sidebar presence comes from configured Gas City config, not only running sessions
or the currently reachable GC API.

- Cities, rigs, and agents come from `city.toml` and the effective expanded
  Gas City config.
- Machine-local rig paths come from `.gc/site.toml` bindings.
- Code must not infer rig paths from package names, repo names, or directory
  layout guesses.
- Agents do not need to be running to appear.
- Rigs defined in config do not need active threads to appear.
- Cities do not need active agents to appear.
- Cities do not need running controllers to appear.
- The supervisor does not need to be running for configured cities to appear.
- The sidebar should tolerate a temporarily unavailable supervisor by using bundled
  city config when available.
- All configured cities should be loaded for sidebar visibility. There is no
  sidebar "default city"; `GC_CITY_PATH` may provide command context, but it must
  not limit which configured cities appear in the sidebar.
