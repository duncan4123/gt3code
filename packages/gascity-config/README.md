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

## Bundled binary layout

T3Code can also ship platform-specific GC binaries next to this config package:

```text
binaries/linux-x64/gc
binaries/darwin-arm64/gc
binaries/win32-x64/gc.exe
```

At runtime, copy the binary into a writable state directory:

```ts
import { materializeGascityRuntime } from "@t3tools/gascity-config";

const runtime = materializeGascityRuntime({ targetDir: "/path/to/writable/runtime" });
```

If the app supplies the binary from elsewhere, pass `gcBinaryPath`.

`materializeGascityRuntime` also seeds `city/.beads/config.yaml` with the local
beads issue prefix. It does not set Dolt lifecycle or port options; GC owns
those runtime details.
Pass `seedLocalBeadsConfig: false` only when the launcher owns that setup.
