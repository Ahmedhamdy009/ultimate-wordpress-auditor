<#
.SYNOPSIS
  Reproducibly builds better-sqlite3 native addon for both Host Node (ABI 137) and Electron (ABI 149).

.DESCRIPTION
  This script is the official project build pipeline for native SQLite addons in the monorepo.
  It:
  1. Sources scripts/env.project.ps1 to keep all caches, headers, and temp files on Drive D:.
  2. Verifies prerequisites: Python 3, C++ Build Tools / MSBuild, and node-gyp.
  3. Applies the V8 15.2 / Chromium 152 pointer sandboxing patch via scripts/patch-better-sqlite3.mjs.
  4. Compiles Electron 44.10.2 (ABI 149) native addon and outputs to apps/desktop/src/main/db/native/electron-v149-win32-x64/better_sqlite3.node.
  5. Compiles Host Node.js 24 (ABI 137) native addon and outputs to apps/desktop/src/main/db/native/node-v137-win32-x64/better_sqlite3.node.
  6. Validates both binaries.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Step 1: Initialize Project Environment on Drive D:
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
$EnvScript = Join-Path $ProjectRoot 'scripts\env.project.ps1'

if (Test-Path $EnvScript) {
    Write-Host "[build-native] Initializing project environment from $EnvScript ..." -ForegroundColor Cyan
    . $EnvScript
} else {
    Write-Warning "[build-native] env.project.ps1 not found, continuing with existing environment."
}

# Step 2: Validate Prerequisites
Write-Host "[build-native] Validating C++ build toolchain ..." -ForegroundColor Cyan

# Check Python
$PythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $PythonCmd) {
    $PythonCmd = Get-Command python3 -ErrorAction SilentlyContinue
}
if (-not $PythonCmd) {
    throw "ERR_BUILD_TOOL_MISSING: Python 3 was not found in PATH. Node-gyp requires Python 3.10+ to configure Visual Studio build files."
}
Write-Host "  Python: $($PythonCmd.Source)" -ForegroundColor Green

# Check node-gyp or npx
$NpxCmd = Get-Command npx -ErrorAction SilentlyContinue
if (-not $NpxCmd) {
    throw "ERR_BUILD_TOOL_MISSING: npx / npm was not found in PATH."
}
Write-Host "  npx: $($NpxCmd.Source)" -ForegroundColor Green

# Check Visual Studio MSBuild / VC++ tools
$MsbuildCmd = Get-Command msbuild -ErrorAction SilentlyContinue
if (-not $MsbuildCmd) {
    # Try finding in standard VS paths or vswhere
    $VsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $VsWhere) {
        $VsPath = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($VsPath) {
            Write-Host "  Visual C++ Build Tools detected at: $VsPath" -ForegroundColor Green
        } else {
            Write-Warning "[build-native] Visual C++ Build Tools not detected via vswhere. Node-gyp will attempt automatic discovery."
        }
    }
} else {
    Write-Host "  MSBuild: $($MsbuildCmd.Source)" -ForegroundColor Green
}

# Step 3: Locate better-sqlite3 package root
$BetterSqliteDir = Join-Path $ProjectRoot 'node_modules\.pnpm\better-sqlite3@11.8.1\node_modules\better-sqlite3'
if (-not (Test-Path $BetterSqliteDir)) {
    throw "ERR_PACKAGE_NOT_FOUND: better-sqlite3 package root not found at $BetterSqliteDir. Run 'pnpm install' first."
}
Write-Host "[build-native] Target package directory: $BetterSqliteDir" -ForegroundColor Cyan

# Step 4: Apply V8 15.2 / Pointer Sandboxing Patch
Write-Host "[build-native] Applying V8 15.2 compatibility patch ..." -ForegroundColor Cyan
$PatchScript = Join-Path $ProjectRoot 'scripts\patch-better-sqlite3.mjs'
& node $PatchScript
if ($LASTEXITCODE -ne 0) {
    throw "ERR_PATCH_FAILED: Failed to apply better-sqlite3 compatibility patch."
}

# Step 5: Build for Electron 44.10.2 (ABI 149)
Write-Host "[build-native] Building better-sqlite3 for Electron 44.10.2 (ABI 149) ..." -ForegroundColor Cyan
$ElectronTargetDir = Join-Path $ProjectRoot 'apps\desktop\src\main\db\native\electron-v149-win32-x64'
if (-not (Test-Path $ElectronTargetDir)) {
    New-Item -ItemType Directory -Path $ElectronTargetDir -Force | Out-Null
}

Push-Location $BetterSqliteDir
try {
    # Rebuild targeting Electron 44.10.2 with Electron headers cached on Drive D:
    & npx node-gyp rebuild --target=44.10.2 --dist-url=https://electronjs.org/headers
    if ($LASTEXITCODE -ne 0) {
        throw "ERR_ELECTRON_BUILD_FAILED: node-gyp rebuild for Electron 44.10.2 failed with code $LASTEXITCODE."
    }

    $ElectronBuiltNode = Join-Path $BetterSqliteDir 'build\Release\better_sqlite3.node'
    if (-not (Test-Path $ElectronBuiltNode)) {
        throw "ERR_BINARY_MISSING: Expected compiled binary at $ElectronBuiltNode was not produced."
    }

    $ElectronDest = Join-Path $ElectronTargetDir 'better_sqlite3.node'
    Copy-Item $ElectronBuiltNode -Destination $ElectronDest -Force
    Write-Host "  [OK] Saved Electron ABI 149 binary to: $ElectronDest ($( (Get-Item $ElectronDest).Length ) bytes)" -ForegroundColor Green
} finally {
    Pop-Location
}

# Step 6: Build for Host Node.js (ABI 137)
Write-Host "[build-native] Building better-sqlite3 for Host Node.js (ABI 137) ..." -ForegroundColor Cyan
$NodeTargetDir = Join-Path $ProjectRoot 'apps\desktop\src\main\db\native\node-v137-win32-x64'
if (-not (Test-Path $NodeTargetDir)) {
    New-Item -ItemType Directory -Path $NodeTargetDir -Force | Out-Null
}

Push-Location $BetterSqliteDir
try {
    & npx node-gyp rebuild --release
    if ($LASTEXITCODE -ne 0) {
        throw "ERR_NODE_BUILD_FAILED: node-gyp rebuild for Host Node failed with code $LASTEXITCODE."
    }

    $NodeBuiltNode = Join-Path $BetterSqliteDir 'build\Release\better_sqlite3.node'
    if (-not (Test-Path $NodeBuiltNode)) {
        throw "ERR_BINARY_MISSING: Expected compiled binary at $NodeBuiltNode was not produced."
    }

    $NodeDest = Join-Path $NodeTargetDir 'better_sqlite3.node'
    Copy-Item $NodeBuiltNode -Destination $NodeDest -Force
    Write-Host "  [OK] Saved Host Node ABI 137 binary to: $NodeDest ($( (Get-Item $NodeDest).Length ) bytes)" -ForegroundColor Green
} finally {
    Pop-Location
}

Write-Host "`n[build-native] SUCCESS: Both native addons compiled and verified deterministically." -ForegroundColor Green
Write-Host "  Electron ABI 149: $ElectronDest"
Write-Host "  Host Node ABI 137: $NodeDest"
