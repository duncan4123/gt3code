# Gas City binaries

Place platform-specific `gc` executables under:

```text
binaries/<platform>-<arch>/gc
binaries/win32-<arch>/gc.exe
```

Examples:

```text
binaries/linux-x64/gc
binaries/darwin-arm64/gc
binaries/win32-x64/gc.exe
```

The package does not currently commit binary payloads. Runtime code can still
use `materializeGascityRuntime({ gcBinaryPath })` with an externally supplied
binary path.
