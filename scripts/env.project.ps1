# Session-only environment for D:\ahmed.
# Does not change User or Machine Windows environment variables.
# Safe to run more than once. Usage:
#   . D:\ahmed\scripts\env.project.ps1

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$DriveRoot = [System.IO.Path]::GetPathRoot($ProjectRoot)

if ($DriveRoot -notmatch '^[Dd]:\\$') {
    Write-Error "Project root is not on D:. Refusing to set cache paths. Root=$ProjectRoot"
    return
}

$CacheRoot = Join-Path $ProjectRoot '.cache'
$TmpDir = Join-Path $ProjectRoot '.tmp'
$ToolsDir = Join-Path $ProjectRoot '.tools'
$BrowsersDir = Join-Path $ProjectRoot '.browsers'

$Dirs = @(
    $CacheRoot,
    (Join-Path $CacheRoot 'npm'),
    (Join-Path $CacheRoot 'pnpm-store'),
    (Join-Path $CacheRoot 'pnpm-cache'),
    (Join-Path $CacheRoot 'corepack'),
    (Join-Path $CacheRoot 'electron'),
    (Join-Path $CacheRoot 'electron-builder'),
    (Join-Path $CacheRoot 'pip'),
    $TmpDir,
    $ToolsDir,
    $BrowsersDir
)

foreach ($Dir in $Dirs) {
    if (-not (Test-Path -LiteralPath $Dir)) {
        New-Item -ItemType Directory -Path $Dir | Out-Null
    }
}

# Process / current session scope only.
$env:TEMP = $TmpDir
$env:TMP = $TmpDir
$env:TMPDIR = $TmpDir
$env:npm_config_cache = Join-Path $CacheRoot 'npm'
$env:PNPM_STORE_DIR = Join-Path $CacheRoot 'pnpm-store'
$env:npm_config_store_dir = Join-Path $CacheRoot 'pnpm-store'
$env:npm_config_cache_dir = Join-Path $CacheRoot 'pnpm-cache'
$env:COREPACK_HOME = Join-Path $CacheRoot 'corepack'
$env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersDir
$env:ELECTRON_CACHE = Join-Path $CacheRoot 'electron'
$env:ELECTRON_BUILDER_CACHE = Join-Path $CacheRoot 'electron-builder'
$env:PIP_CACHE_DIR = Join-Path $CacheRoot 'pip'

# Prepend project tools to session PATH if not already present
if ($env:PATH -notlike "*$ToolsDir*") {
    $env:PATH = "$ToolsDir;$env:PATH"
}

Write-Output "Project root: $ProjectRoot"
Write-Output "TEMP/TMP: $env:TEMP"
Write-Output "npm cache: $env:npm_config_cache"
Write-Output "pnpm store: $env:PNPM_STORE_DIR"
Write-Output "pnpm cache: $env:npm_config_cache_dir"
Write-Output "Corepack home: $env:COREPACK_HOME"
Write-Output "Playwright browsers: $env:PLAYWRIGHT_BROWSERS_PATH"
Write-Output "Electron cache: $env:ELECTRON_CACHE"
Write-Output "electron-builder cache: $env:ELECTRON_BUILDER_CACHE"
Write-Output "pip cache: $env:PIP_CACHE_DIR"
Write-Output "Tools in PATH: $ToolsDir"
Write-Output "Scope: current PowerShell session only (not User/Machine)."
