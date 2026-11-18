/**
 * Build Provenance Manifest Generator & Verifier.
 * Produces deterministic SHA-256 source fingerprints, output bundle digests,
 * and Git revision metadata so stale dist/, out/, or app.asar artifacts are
 * never accepted merely because files exist on disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

export const PROVENANCE_SCHEMA_VERSION = 1;
export const PROVENANCE_FILENAME = 'build-provenance.json';

export const PROVENANCE_ERROR_CODES = Object.freeze({
  MISSING: 'PROVENANCE_MISSING',
  INVALID_MANIFEST: 'PROVENANCE_INVALID_MANIFEST',
  VERSION_MISMATCH: 'PROVENANCE_VERSION_MISMATCH',
  SOURCE_MISMATCH: 'PROVENANCE_SOURCE_MISMATCH',
  BUNDLE_MISMATCH: 'PROVENANCE_BUNDLE_MISMATCH',
  COMMIT_MISMATCH: 'PROVENANCE_COMMIT_MISMATCH',
  DIRTY_TREE: 'PROVENANCE_DIRTY_TREE',
});

const SOURCE_INPUT_FILES = [
  'package.json',
  'electron-builder.yml',
  'tsconfig.base.json',
  'tsconfig.build.json',
  'packages/shared/package.json',
  'packages/shared/tsconfig.json',
  'apps/desktop/package.json',
  'apps/desktop/electron-vite.config.ts',
  'apps/desktop/tsconfig.json',
  'apps/desktop/tsconfig.node.json',
  'scripts/copy-build-assets.mjs',
  'scripts/build-provenance.mjs',
];

const SOURCE_INPUT_DIRS = ['packages/shared/src', 'apps/desktop/src', 'apps/desktop/resources'];

const REQUIRED_OUT_ENTRYPOINTS = ['main/index.js', 'preload/index.cjs', 'renderer/index.html'];

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.tmp', '.cache', 'dist', 'out']);

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function compareCodePoint(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walkFilesRecursively(dirPath, rootDir, results, excludePredicate) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.sort((a, b) => compareCodePoint(a.name, b.name));

  for (const entry of entries) {
    if (entry.name === 'Thumbs.db' || entry.name === '.DS_Store') continue;
    const fullPath = path.join(dirPath, entry.name);
    const relPosix = toPosix(path.relative(rootDir, fullPath));

    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      if (excludePredicate && excludePredicate(relPosix, true)) continue;
      walkFilesRecursively(fullPath, rootDir, results, excludePredicate);
    } else if (entry.isFile()) {
      if (excludePredicate && excludePredicate(relPosix, false)) continue;
      results.push(relPosix);
    }
  }
}

/**
 * Computes a deterministic SHA-256 fingerprint over all relevant application
 * source files, configuration files, and build scripts under projectRoot.
 */
export function computeSourceFingerprint(projectRoot = DEFAULT_PROJECT_ROOT) {
  const fileSet = new Set();

  for (const relFile of SOURCE_INPUT_FILES) {
    const absPath = path.join(projectRoot, relFile);
    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
      fileSet.add(toPosix(relFile));
    }
  }

  for (const relDir of SOURCE_INPUT_DIRS) {
    const absDir = path.join(projectRoot, relDir);
    const collected = [];
    walkFilesRecursively(absDir, projectRoot, collected);
    for (const rel of collected) {
      fileSet.add(rel);
    }
  }

  const sortedFiles = Array.from(fileSet).sort(compareCodePoint);
  const hash = crypto.createHash('sha256');

  for (const relPath of sortedFiles) {
    const absPath = path.join(projectRoot, relPath);
    const fileDigest = sha256Buffer(fs.readFileSync(absPath));
    hash.update(`${relPath}\0${fileDigest}\n`);
  }

  return {
    sourceFingerprint: hash.digest('hex'),
    inputFileCount: sortedFiles.length,
  };
}

/**
 * Computes a deterministic SHA-256 digest of the compiled Electron output
 * bundles under outDir (excluding build-provenance.json and unpacked native binaries).
 */
export function computeOutBundleDigest(outDir) {
  if (!fs.existsSync(outDir)) {
    return {
      valid: false,
      missingEntrypoints: [...REQUIRED_OUT_ENTRYPOINTS],
      bundleDigest: null,
      fileCount: 0,
    };
  }

  const missingEntrypoints = REQUIRED_OUT_ENTRYPOINTS.filter(
    rel => !fs.existsSync(path.join(outDir, rel)),
  );
  if (missingEntrypoints.length > 0) {
    return {
      valid: false,
      missingEntrypoints,
      bundleDigest: null,
      fileCount: 0,
    };
  }

  const targetSubdirs = ['main', 'preload', 'renderer', 'resources'];
  const collected = [];
  for (const sub of targetSubdirs) {
    const subPath = path.join(outDir, sub);
    walkFilesRecursively(subPath, outDir, collected, relPosix => {
      if (relPosix === PROVENANCE_FILENAME) return true;
      if (relPosix === 'main/native' || relPosix.startsWith('main/native/')) return true;
      return false;
    });
  }

  const sortedFiles = Array.from(new Set(collected)).sort(compareCodePoint);
  const hash = crypto.createHash('sha256');
  for (const relPath of sortedFiles) {
    const fileDigest = sha256Buffer(fs.readFileSync(path.join(outDir, relPath)));
    hash.update(`${relPath}\0${fileDigest}\n`);
  }

  return {
    valid: true,
    missingEntrypoints: [],
    bundleDigest: hash.digest('hex'),
    fileCount: sortedFiles.length,
  };
}

function loadAsarModule(projectRoot = DEFAULT_PROJECT_ROOT) {
  const candidates = [
    path.join(projectRoot, 'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar'),
    path.join(
      DEFAULT_PROJECT_ROOT,
      'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar',
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  return require('@electron/asar');
}

/**
 * Computes the bundle digest and extracts build-provenance.json directly from an app.asar archive.
 */
export function inspectAsarBundle(asarPath, options = {}) {
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
  if (!fs.existsSync(asarPath)) {
    return {
      exists: false,
      manifest: null,
      manifestParseError: 'ASAR archive does not exist',
      bundleDigest: null,
      missingEntrypoints: [...REQUIRED_OUT_ENTRYPOINTS],
      fileCount: 0,
    };
  }

  const asar = options.asarModule ?? loadAsarModule(projectRoot);
  const rawList = asar.listPackage(asarPath);
  const normalizedSet = new Set(rawList.map(entry => toPosix(entry)));

  let manifest = null;
  let manifestParseError = null;
  const manifestArchiveKey = `out/${PROVENANCE_FILENAME}`;
  const manifestPlatformKey = manifestArchiveKey.split('/').join(path.sep);
  if (normalizedSet.has(`/${manifestArchiveKey}`)) {
    try {
      const buf = asar.extractFile(asarPath, manifestPlatformKey);
      manifest = JSON.parse(buf.toString('utf8'));
    } catch (err) {
      manifestParseError = err instanceof Error ? err.message : String(err);
    }
  } else {
    manifestParseError = `Missing /${manifestArchiveKey} inside app.asar`;
  }

  const missingEntrypoints = REQUIRED_OUT_ENTRYPOINTS.filter(
    rel => !normalizedSet.has(`/out/${rel}`),
  );
  if (missingEntrypoints.length > 0) {
    return {
      exists: true,
      manifest,
      manifestParseError,
      bundleDigest: null,
      missingEntrypoints,
      fileCount: 0,
    };
  }

  const targetPrefixes = ['/out/main/', '/out/preload/', '/out/renderer/', '/out/resources/'];
  const bundleFiles = [];
  for (const entry of normalizedSet) {
    if (entry === `/${manifestArchiveKey}`) continue;
    if (entry === '/out/main/native' || entry.startsWith('/out/main/native/')) continue;
    if (!targetPrefixes.some(prefix => entry.startsWith(prefix))) continue;

    const relInsideArchive = entry.slice(1); // strip leading '/'
    const platformArchivePath = relInsideArchive.split('/').join(path.sep);
    // Skip directory entries by checking stat
    const stat = asar.statFile(asarPath, platformArchivePath);
    if (stat && stat.files) continue;
    bundleFiles.push({
      relOutPath: entry.slice('/out/'.length),
      archivePath: platformArchivePath,
    });
  }

  bundleFiles.sort((a, b) => compareCodePoint(a.relOutPath, b.relOutPath));
  const hash = crypto.createHash('sha256');
  for (const item of bundleFiles) {
    const fileBuf = asar.extractFile(asarPath, item.archivePath);
    const fileDigest = sha256Buffer(fileBuf);
    hash.update(`${item.relOutPath}\0${fileDigest}\n`);
  }

  return {
    exists: true,
    manifest,
    manifestParseError,
    bundleDigest: hash.digest('hex'),
    missingEntrypoints: [],
    fileCount: bundleFiles.length,
  };
}

/**
 * Reads Git HEAD commit SHA, branch, and dirty flag safely.
 */
export function readGitIdentity(projectRoot = DEFAULT_PROJECT_ROOT) {
  try {
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const statusOut = execFileSync('git', ['status', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return {
      available: true,
      commitSha: commitSha || null,
      branch: branch || null,
      isDirty: statusOut.length > 0,
    };
  } catch {
    return {
      available: false,
      commitSha: null,
      branch: null,
      isDirty: false,
    };
  }
}

function readDesktopAppVersion(projectRoot) {
  const pkgPath = path.join(projectRoot, 'apps', 'desktop', 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing desktop package.json at ${pkgPath}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return String(pkg.version);
}

/**
 * Generates and writes apps/desktop/out/build-provenance.json from current sources and built bundles.
 */
export function writeBuildProvenance(options = {}) {
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const outDir = options.outDir ?? path.join(projectRoot, 'apps', 'desktop', 'out');
  const silent = options.silent === true;

  const appVersion = readDesktopAppVersion(projectRoot);
  const { sourceFingerprint, inputFileCount } = computeSourceFingerprint(projectRoot);
  const bundle = computeOutBundleDigest(outDir);

  if (!bundle.valid || !bundle.bundleDigest) {
    throw new Error(
      `[provenance] Cannot write build provenance: missing required bundle entrypoints (${bundle.missingEntrypoints.join(', ')}) in ${outDir}`,
    );
  }

  const gitIdentity = options.gitIdentity ?? readGitIdentity(projectRoot);
  const manifest = {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    appVersion,
    sourceFingerprint,
    inputFileCount,
    outBundleDigest: bundle.bundleDigest,
    outFileCount: bundle.fileCount,
    gitCommitSha: gitIdentity.commitSha ?? null,
    gitBranch: gitIdentity.branch ?? null,
    gitDirty: Boolean(gitIdentity.isDirty),
    generatedAt: new Date().toISOString(),
  };

  const manifestPath = path.join(outDir, PROVENANCE_FILENAME);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  if (!silent) {
    console.log(`[provenance] Wrote ${manifestPath}`);
    console.log(
      `  - Version: ${appVersion} | Commit: ${manifest.gitCommitSha ?? 'none'} | Source SHA-256: ${sourceFingerprint.slice(0, 16)}... | Bundle SHA-256: ${bundle.bundleDigest.slice(0, 16)}...`,
    );
  }

  return {
    manifestPath,
    manifest,
  };
}

function validateManifestAgainstProject({
  manifest,
  manifestParseError,
  actualBundleDigest,
  missingEntrypoints,
  projectRoot,
  options,
}) {
  const reasons = [];

  if (!manifest) {
    reasons.push(
      manifestParseError && !manifestParseError.startsWith('Missing')
        ? PROVENANCE_ERROR_CODES.INVALID_MANIFEST
        : PROVENANCE_ERROR_CODES.MISSING,
    );
    return {
      valid: false,
      reasons,
      manifest: null,
      expected: null,
      details: manifestParseError ?? 'Provenance manifest is missing',
    };
  }

  if (
    typeof manifest !== 'object' ||
    manifest.schemaVersion !== PROVENANCE_SCHEMA_VERSION ||
    typeof manifest.sourceFingerprint !== 'string' ||
    typeof manifest.outBundleDigest !== 'string' ||
    typeof manifest.appVersion !== 'string'
  ) {
    reasons.push(PROVENANCE_ERROR_CODES.INVALID_MANIFEST);
    return {
      valid: false,
      reasons,
      manifest,
      expected: null,
      details: 'Provenance manifest failed schema validation',
    };
  }

  const expectedVersion = readDesktopAppVersion(projectRoot);
  const { sourceFingerprint: expectedSourceFingerprint } = computeSourceFingerprint(projectRoot);
  const gitIdentity = options.gitIdentity ?? readGitIdentity(projectRoot);
  const requireCommitMatch = options.requireCommitMatch ?? true;
  const requireCleanTree = options.requireCleanTree ?? false;

  if (manifest.appVersion !== expectedVersion) {
    reasons.push(PROVENANCE_ERROR_CODES.VERSION_MISMATCH);
  }

  if (manifest.sourceFingerprint !== expectedSourceFingerprint) {
    reasons.push(PROVENANCE_ERROR_CODES.SOURCE_MISMATCH);
  }

  if (
    missingEntrypoints.length > 0 ||
    !actualBundleDigest ||
    manifest.outBundleDigest !== actualBundleDigest
  ) {
    reasons.push(PROVENANCE_ERROR_CODES.BUNDLE_MISMATCH);
  }

  if (requireCommitMatch && gitIdentity.commitSha) {
    if (!manifest.gitCommitSha || manifest.gitCommitSha !== gitIdentity.commitSha) {
      reasons.push(PROVENANCE_ERROR_CODES.COMMIT_MISMATCH);
    }
  }

  if (requireCleanTree && manifest.gitDirty) {
    reasons.push(PROVENANCE_ERROR_CODES.DIRTY_TREE);
  }

  return {
    valid: reasons.length === 0,
    reasons,
    manifest,
    expected: {
      appVersion: expectedVersion,
      sourceFingerprint: expectedSourceFingerprint,
      actualBundleDigest,
      gitCommitSha: gitIdentity.commitSha ?? null,
    },
    details:
      reasons.length === 0
        ? 'Build provenance matches current source fingerprint, output bundle digest, and commit identity.'
        : `Build provenance mismatch: ${reasons.join(', ')}`,
  };
}

/**
 * Verifies apps/desktop/out/build-provenance.json against current source inputs and compiled output bundles.
 */
export function verifyOutProvenance(options = {}) {
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const outDir = options.outDir ?? path.join(projectRoot, 'apps', 'desktop', 'out');
  const manifestPath = path.join(outDir, PROVENANCE_FILENAME);

  let manifest = null;
  let manifestParseError = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      manifestParseError = err instanceof Error ? err.message : String(err);
    }
  } else {
    manifestParseError = `Missing ${manifestPath}`;
  }

  const bundle = computeOutBundleDigest(outDir);
  return validateManifestAgainstProject({
    manifest,
    manifestParseError,
    actualBundleDigest: bundle.bundleDigest,
    missingEntrypoints: bundle.missingEntrypoints,
    projectRoot,
    options,
  });
}

/**
 * Verifies /out/build-provenance.json embedded inside an Electron app.asar archive.
 */
export function verifyAsarProvenance(asarPath, options = {}) {
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const inspection = inspectAsarBundle(asarPath, {
    projectRoot,
    asarModule: options.asarModule,
  });

  return validateManifestAgainstProject({
    manifest: inspection.manifest,
    manifestParseError: inspection.manifestParseError,
    actualBundleDigest: inspection.bundleDigest,
    missingEntrypoints: inspection.missingEntrypoints,
    projectRoot,
    options,
  });
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  const args = process.argv.slice(2);
  if (args.includes('--write')) {
    writeBuildProvenance({ silent: false });
  } else if (args.includes('--verify-asar')) {
    const idx = args.indexOf('--verify-asar');
    const asarTarget =
      args[idx + 1] ??
      path.join(
        DEFAULT_PROJECT_ROOT,
        'apps',
        'desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app.asar',
      );
    const result = verifyAsarProvenance(asarTarget);
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exit(1);
  } else {
    const result = verifyOutProvenance();
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exit(1);
  }
}
