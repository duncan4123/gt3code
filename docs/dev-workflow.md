# Dev Workflow

## Starting Development

Always start server and web together:

```sh
bun dev
```

This runs contracts, server, and web through a single turbo invocation. Ports are
coordinated automatically (server: 3773, web: 5733, offset together if busy).

## What NOT To Do

**Don't run server and web separately:**

```sh
# BAD - ports will mismatch
bun dev:server  # picks port 3774
bun dev:web     # points at port 3773 (wrong!)
```

Each command resolves its own port offset independently. The web app gets
`VITE_WS_URL=ws://localhost:<wrong-port>` and can't reach the server.

**Don't start one while the other is already running:**

Both depend on `@t3tools/contracts:build` which uses `--clean`. Starting the
server rebuilds contracts, wiping the output the running web app depends on.
Vite sees its dependencies vanish and crashes.

## Running Only Server or Only Web

If you genuinely need just one:

```sh
# Server only (e.g., testing API with curl)
bun dev:server

# Web only (e.g., UI work with a separately managed server)
bun dev:web --dev-url http://localhost:<your-server-port>
```

But for normal development, use `bun dev`.

## Ports

| Service | Base Port | Notes                    |
| ------- | --------- | ------------------------ |
| Server  | 3773      | WebSocket + HTTP         |
| Web     | 5733      | Vite dev server with HMR |

If ports are busy, the dev-runner auto-increments both by the same offset.
You can force an offset with `T3CODE_PORT_OFFSET=N` or name instances with
`T3CODE_DEV_INSTANCE=myname` (hashed to an offset).

## Authentication

The Claude provider authenticates via the Claude CLI, not an API key:

```sh
claude auth status   # check
claude auth login    # if needed
```

Dev mode runs with `authEnabled: false` so no T3 Code auth token is needed.
