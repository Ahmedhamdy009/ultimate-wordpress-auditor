/**
 * Production Asset Pipeline Copy Script.
 * Deterministically copies precompiled native addons (better-sqlite3) and application
 * branding resources into the output directory (apps/desktop/out/main/).
 *
 * Requirements:
 * - Preserves Electron ABI 149 and Host Node ABI 137 binaries.
 * - Ensures destination directories exist.
 * - Overwrites existing destination files cleanly without creating stale duplicates.
 * - Idempotent and cross-platform.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

const SRC_NATIVE_DIR = path.join(PROJECT_ROOT, 'apps', 'desktop', 'src', 'main', 'db', 'native');
const SRC_RESOURCES_DIR = path.join(PROJECT_ROOT, 'apps', 'desktop', 'resources');

const OUT_MAIN_DIR = path.join(PROJECT_ROOT, 'apps', 'desktop', 'out', 'main');
const OUT_NATIVE_DIR = path.join(OUT_MAIN_DIR, 'native');
const OUT_RESOURCES_DIR = path.join(OUT_MAIN_DIR, 'resources');

export function copyBuildAssets(options = {}) {
  const silent = options.silent === true;
  if (!silent) {
    console.log('[copy-assets] Starting production build asset copy ...');
  }

  // 1. Ensure out/main exists
  if (!fs.existsSync(OUT_MAIN_DIR)) {
    fs.mkdirSync(OUT_MAIN_DIR, { recursive: true });
  }

  // 2. Copy Native Addons
  if (fs.existsSync(SRC_NATIVE_DIR)) {
    if (!silent) {
      console.log(
        `[copy-assets] Copying native addons from ${SRC_NATIVE_DIR} -> ${OUT_NATIVE_DIR} ...`,
      );
    }
    fs.mkdirSync(OUT_NATIVE_DIR, { recursive: true });
    fs.cpSync(SRC_NATIVE_DIR, OUT_NATIVE_DIR, {
      recursive: true,
      force: true,
      filter: source => {
        // Exclude temporary or git files
        const basename = path.basename(source);
        return !basename.startsWith('.') && basename !== 'Thumbs.db';
      },
    });
  } else {
    console.warn(`[copy-assets] WARNING: Source native directory not found at ${SRC_NATIVE_DIR}`);
  }

  // 3. Copy Application Branding Resources
  if (fs.existsSync(SRC_RESOURCES_DIR)) {
    if (!silent) {
      console.log(
        `[copy-assets] Copying resources from ${SRC_RESOURCES_DIR} -> ${OUT_RESOURCES_DIR} ...`,
      );
    }
    fs.mkdirSync(OUT_RESOURCES_DIR, { recursive: true });
    fs.cpSync(SRC_RESOURCES_DIR, OUT_RESOURCES_DIR, {
      recursive: true,
      force: true,
      filter: source => {
        const basename = path.basename(source);
        return !basename.startsWith('.') && basename !== 'Thumbs.db';
      },
    });

    // Also mirror to apps/desktop/out/resources for electron packaging conventions
    const outDesktopResources = path.join(PROJECT_ROOT, 'apps', 'desktop', 'out', 'resources');
    fs.mkdirSync(outDesktopResources, { recursive: true });
    fs.cpSync(SRC_RESOURCES_DIR, outDesktopResources, { recursive: true, force: true });
  }

  // 4. Verification Checkpoints
  const electron149Binary = path.join(
    OUT_NATIVE_DIR,
    'electron-v149-win32-x64',
    'better_sqlite3.node',
  );
  const icoFile = path.join(OUT_RESOURCES_DIR, 'icon.ico');

  const electronBinaryExists = fs.existsSync(electron149Binary);
  const icoExists = fs.existsSync(icoFile);

  if (!electronBinaryExists) {
    throw new Error(
      `[copy-assets] Verification failed: Electron ABI 149 binary missing at ${electron149Binary}`,
    );
  }
  if (!icoExists) {
    throw new Error(`[copy-assets] Verification failed: Application icon missing at ${icoFile}`);
  }

  if (!silent) {
    console.log(`[copy-assets] SUCCESS: Assets copied and verified.`);
    console.log(
      `  - Native SQLite (Electron ABI 149): ${electron149Binary} (${fs.statSync(electron149Binary).size} bytes)`,
    );
    console.log(`  - Windows Icon: ${icoFile} (${fs.statSync(icoFile).size} bytes)`);
  }

  return {
    success: true,
    nativeCopied: true,
    resourcesCopied: true,
    electron149Binary,
    icoFile,
  };
}

// Execute when invoked directly
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    copyBuildAssets();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
