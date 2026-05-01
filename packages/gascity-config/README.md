# @t3tools/gascity-config

Bundled Gas City configuration for T3Code.

This package ships the active T3Code Gas City: `city.toml`, root `pack.toml`,
the Gastown pack, and the maintenance pack it depends on. In development,
launchers should pass this package's config directory directly to `gc --city`.
Runtime-local state may be created next to it, but is ignored by Git.

```ts
import { getBundledGascityConfigLayout } from "@t3tools/gascity-config";

const city = getBundledGascityConfigLayout();
```

`city.rootDir` is suitable for passing to the `gc` binary.

## Runtime layout

T3Code builds GC and beads binaries from the `@t3tools/gascity` and
`@t3tools/beads-doltlite` workspace packages. Runtime launchers copy those built
binaries into a writable state directory and pass this package's config directory
to `gc --city`.

`materializeGascityRuntime` also seeds `city/.beads/config.yaml` with the local
beads issue prefix. It does not set Dolt lifecycle or port options; GC owns
those runtime details.
Pass `seedLocalBeadsConfig: false` only when the launcher owns that setup.
