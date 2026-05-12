# Jujutsu Pack

Adds `jj` / Jujutsu workflow guidance for Gas City agents working in colocated
Git/JJ repositories and jj-native forges such as Jorje.

## What It Provides

- **Skill**: `jj` — practical command guidance for status, stacks, bookmarks,
  Git interop, and Jorje pushes.
- **Prompt fragment**: `jj-workflow` — lightweight reminders to check both
  Git and JJ state before handoff.

## Prerequisites

Install `jj` and keep it on `PATH`.

## Usage

```toml
[imports.jj]
source = "../packs/flywheel/jj"
```

To append the prompt guidance to agents:

```toml
[agent_defaults]
append_fragments = ["jj-workflow"]
```

The Flywheel `all` pack imports this pack.
