# @t3tools/gascity-config

Bundled Gas City configuration for T3Code.

This package ships immutable defaults: `city.toml`, root `pack.toml`, the
Gastown pack, and the maintenance pack it depends on. Runtime state is
intentionally not part of this package. Launchers should materialize the config
into a writable city directory and let `.gc` live wherever the launcher chooses.

```ts
import { materializeGascityConfig } from "@t3tools/gascity-config";

const city = materializeGascityConfig({
  targetDir: "/path/to/writable/city",
});
```

The materialized directory is suitable for passing to the `gc` binary.

## Bundled binary layout

T3Code can also ship platform-specific GC binaries next to this config package:

```text
binaries/linux-x64/gc
binaries/darwin-arm64/gc
binaries/win32-x64/gc.exe
```

At runtime, copy both config and binary into a writable state directory:

```ts
import { materializeGascityRuntime } from "@t3tools/gascity-config";

const runtime = materializeGascityRuntime({
  targetDir: "/path/to/writable/runtime",
});
```

If the app supplies the binary from elsewhere, pass `gcBinaryPath`.

`materializeGascityRuntime` also seeds `city/.beads/config.yaml` with the local
beads issue prefix. It does not set Dolt lifecycle or port options; GC owns
those runtime details.
Pass `seedLocalBeadsConfig: false` only when the launcher owns that setup.
