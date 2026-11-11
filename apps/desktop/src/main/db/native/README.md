# Native SQLite Addon Architecture & Build Reproducibility

## 1. Native Runtime Matrix

| Runtime Environment | Node Version | Engine / ABI | Native Addon Binary Location |
| :--- | :--- | :--- | :--- |
| **Electron Runtime** | Node `24.22.2` | V8 `15.2.124.45-electron.0` / ABI `149` | `apps/desktop/src/main/db/native/electron-v149-win32-x64/better_sqlite3.node` |
| **Host Node Runtime** | Node `24.14.1` | V8 `13.4` / ABI `137` | `apps/desktop/src/main/db/native/node-v137-win32-x64/better_sqlite3.node` |

---

## 2. V8 15.2 / Pointer Sandboxing Patch Rationale

Electron 44.10.2 embeds Node.js 24.22.2 with Chromium 152.0.7977.169 and V8 15.2.
In this engine, V8 enforces External Pointer Sandboxing (`V8_EXTERNAL_POINTER_TAG_COUNT`) and has modernized/deprecated several internal V8 APIs:

1. **Pointer Sandboxing (`kExternalPointerTypeTagDefault`):**
   - Direct calls to `v8::External::New(isolate, ptr)` or `ext->Value()` fail compilation when pointer sandboxing is active.
   - Fixed via dual-mode wrappers `CreateExternal` and `GetExternalValue` that conditionally pass `v8::kExternalPointerTypeTagDefault`.
2. **`SetNativeDataProperty` Null Pointer Convention:**
   - Literal `0` passed as setter argument results in ambiguous overload resolution (`C2668`). Replaced with `nullptr`.
3. **`PropertyCallbackInfo` Modernization:**
   - `info.This()` was removed in V8 15.2 for property callback getters. Replaced with `info.Holder()`.

---

## 3. Patch and Build Reproducibility Pipeline

The C++ source patch is permanently tracked in:
- `patches/better-sqlite3+11.8.1.patch` (standard unified diff)
- `scripts/patch-better-sqlite3.mjs` (automated idempotent patch script)

### Documented Build Command
To rebuild both native addons deterministically from source:

```powershell
. D:\ahmed\scripts\env.project.ps1
powershell -ExecutionPolicy Bypass -File D:\ahmed\scripts\rebuild-native-sqlite.ps1
```

### Compiler Requirements
- Python 3.10+
- Microsoft Visual Studio 2022 C++ Build Tools (or MSBuild)
- `node-gyp` (invoked via `npx node-gyp`)
- Cached headers stored on Drive D: (`D:\ahmed\.cache\node-gyp`)

---

## 4. Runtime Resolution & Safety Gate

At application runtime, [`DatabaseConnection.resolveNativeBindingPath()`](file:///D:/ahmed/apps/desktop/src/main/db/connection.ts#L40):
1. Detects runtime context via `process.versions.electron`.
2. Identifies architecture (`process.arch`), platform (`process.platform`), and module ABI (`process.versions.modules`).
3. Evaluates target directory `electron-v${ABI}-${platform}-${arch}` or `node-v${ABI}-${platform}-${arch}`.
4. **Safety Gate:** If running in Electron and no compatible binary exists, it immediately throws `ERR_NATIVE_SQLITE_BINDING_MISSING` with descriptive diagnostic details, refusing to fall back to an incompatible host Node binary.
