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

Desktop release builds require the binary for the target platform. For example,
Windows NSIS builds require `binaries/win32-x64/gc.exe` or
`binaries/win32-arm64/gc.exe`, depending on the selected architecture.

Runtime code can still use `materializeGascityRuntime({ gcBinaryPath })` with an
externally supplied binary path during development.
