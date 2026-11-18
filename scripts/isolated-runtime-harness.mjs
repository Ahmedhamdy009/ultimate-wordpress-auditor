/**
 * Shared test-only composition root and isolated runtime verification helpers.
 *
 * Security invariants:
 * - Completely excluded from production builds (apps/desktop/out and app.asar).
 * - Never restores removed globalThis handles or production testHooks.
 * - Keeps all userData, SQLite databases, reports, and screenshots isolated under D:\ahmed\.tmp.
 * - Fixture network interception wraps only node:dns and node:net outside the production bundle
 *   for explicitly configured synthetic test hostnames; all loopback, private, link-local,
 *   metadata, and real host targets continue through unmodified production SSRF validation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { verifyAsarProvenance, verifyOutProvenance } from './build-provenance.mjs';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
export const TMP_ROOT = path.join(PROJECT_ROOT, '.tmp');

export const PACKAGED_EXE_PATH = path.join(
  PROJECT_ROOT,
  'apps',
  'desktop',
  'dist',
  'win-unpacked',
  'Ultimate WordPress & Website Auditor.exe',
);
export const PACKAGED_ASAR_PATH = path.join(
  PROJECT_ROOT,
  'apps',
  'desktop',
  'dist',
  'win-unpacked',
  'resources',
  'app.asar',
);
export const PACKAGED_UNPACKED_PATH = path.join(
  PROJECT_ROOT,
  'apps',
  'desktop',
  'dist',
  'win-unpacked',
  'resources',
  'app.asar.unpacked',
);

export function resolveElectronExecutablePath() {
  try {
    const resolved = require('electron');
    if (typeof resolved === 'string' && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // Fallback to pnpm store layout
  }
  const candidate = path.join(
    PROJECT_ROOT,
    'node_modules',
    '.pnpm',
    'electron@44.10.2',
    'node_modules',
    'electron',
    'dist',
    'electron.exe',
  );
  if (!fs.existsSync(candidate)) {
    throw new Error(`Electron executable not found at ${candidate}`);
  }
  return candidate;
}

export function createIsolatedRunSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createIsolatedUserDataDir(prefix, suffix = createIsolatedRunSuffix()) {
  const dir = path.join(TMP_ROOT, `${prefix}-${suffix}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function verifyFreshPackagedBuildProvenance() {
  if (!fs.existsSync(PACKAGED_EXE_PATH)) {
    throw new Error(`Packaged executable not found at ${PACKAGED_EXE_PATH}`);
  }
  if (!fs.existsSync(PACKAGED_ASAR_PATH)) {
    throw new Error(`Packaged app.asar not found at ${PACKAGED_ASAR_PATH}`);
  }

  const outProvenance = verifyOutProvenance({ projectRoot: PROJECT_ROOT });
  if (!outProvenance.valid) {
    throw new Error(`Out build provenance verification failed: ${outProvenance.details}`);
  }

  const asarProvenance = verifyAsarProvenance(PACKAGED_ASAR_PATH, { projectRoot: PROJECT_ROOT });
  if (!asarProvenance.valid) {
    throw new Error(`ASAR build provenance verification failed: ${asarProvenance.details}`);
  }

  return {
    outProvenance,
    asarProvenance,
  };
}

function loadAsarModule() {
  const pnpmCandidate = path.join(
    PROJECT_ROOT,
    'node_modules',
    '.pnpm',
    '@electron+asar@3.4.1',
    'node_modules',
    '@electron',
    'asar',
  );
  if (fs.existsSync(pnpmCandidate)) {
    return require(pnpmCandidate);
  }
  return require('@electron/asar');
}

/**
 * Prepares a separate test-only Electron composition root under D:\ahmed\.tmp.
 * Extracts the verified production /out and node_modules from app.asar (plus unpacked native
 * binaries from app.asar.unpacked) and writes a test-only entrypoint (test-main.mjs) that
 * installs external fixture network interception before importing ./out/main/index.js.
 */
export function prepareIsolatedCompositionRoot(options) {
  const {
    targetDir,
    fixtureHost = 'mock-audit-target.com',
    fixturePort,
    syntheticPublicIp = '93.184.216.34',
    enableDnsRegressionHosts = false,
  } = options;

  if (!Number.isInteger(fixturePort) || fixturePort <= 0) {
    throw new Error(`Invalid fixturePort: ${fixturePort}`);
  }

  verifyFreshPackagedBuildProvenance();

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const asar = loadAsarModule();
  asar.extractAll(PACKAGED_ASAR_PATH, targetDir);

  if (fs.existsSync(PACKAGED_UNPACKED_PATH)) {
    fs.cpSync(PACKAGED_UNPACKED_PATH, targetDir, { recursive: true, force: true });
  }

  const extractedPkgPath = path.join(targetDir, 'package.json');
  const extractedPkg = fs.existsSync(extractedPkgPath)
    ? JSON.parse(fs.readFileSync(extractedPkgPath, 'utf8'))
    : { version: '0.1.8' };

  fs.writeFileSync(
    extractedPkgPath,
    JSON.stringify(
      {
        name: 'ultimate-wordpress-and-website-auditor',
        version: extractedPkg.version ?? '0.1.8',
        type: 'module',
        main: 'test-main.mjs',
      },
      null,
      2,
    ),
    'utf8',
  );

  const testMainContent = `/**
 * Test-only composition root for isolated runtime verification.
 * Installs external fixture DNS and socket routing BEFORE importing the unmodified
 * production bundle (./out/main/index.js).
 */
import dns from 'node:dns';
import net from 'node:net';

const FIXTURE_HOST = ${JSON.stringify(fixtureHost.toLowerCase())};
const SYNTHETIC_PUBLIC_IP = ${JSON.stringify(syntheticPublicIp)};
const FIXTURE_PORT = ${Number(fixturePort)};
const ENABLE_DNS_REGRESSION_HOSTS = ${Boolean(enableDnsRegressionHosts)};

const originalLookup = dns.promises.lookup.bind(dns.promises);
const originalCreateConnection = net.createConnection;
const toctouCallCounts = new Map();

function nextToctouCount(host) {
  const count = (toctouCallCounts.get(host) ?? 0) + 1;
  toctouCallCounts.set(host, count);
  return count;
}

dns.promises.lookup = async (hostname, lookupOptions) => {
  const host = String(hostname).trim().toLowerCase();
  const isAll = Boolean(
    lookupOptions && typeof lookupOptions === 'object' && lookupOptions.all === true,
  );

  if (isAll && host === FIXTURE_HOST) {
    return [{ address: SYNTHETIC_PUBLIC_IP, family: 4 }];
  }

  if (ENABLE_DNS_REGRESSION_HOSTS && isAll) {
    if (host === 'rebind-local.test') {
      return [{ address: '127.0.0.1', family: 4 }];
    }
    if (host === 'mixed-dns.test') {
      return [
        { address: SYNTHETIC_PUBLIC_IP, family: 4 },
        { address: '127.0.0.1', family: 4 },
      ];
    }
    if (host === 'unresolvable-dns-test.invalid') {
      const err = new Error('getaddrinfo ENOTFOUND unresolvable-dns-test.invalid');
      err.code = 'ENOTFOUND';
      throw err;
    }
    if (host === 'toctou-rebind.test') {
      return nextToctouCount(host) === 1
        ? [{ address: SYNTHETIC_PUBLIC_IP, family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }];
    }
    if (host === 'toctou-mixed.test') {
      return nextToctouCount(host) === 1
        ? [{ address: SYNTHETIC_PUBLIC_IP, family: 4 }]
        : [
            { address: SYNTHETIC_PUBLIC_IP, family: 4 },
            { address: '127.0.0.1', family: 4 },
          ];
    }
    if (host === 'toctou-unresolvable.test') {
      if (nextToctouCount(host) === 1) {
        return [{ address: SYNTHETIC_PUBLIC_IP, family: 4 }];
      }
      const err = new Error('getaddrinfo ENOTFOUND toctou-unresolvable.test');
      err.code = 'ENOTFOUND';
      throw err;
    }
  }

  return originalLookup(hostname, lookupOptions);
};

net.createConnection = (...args) => {
  const firstArg = args[0];
  if (
    firstArg &&
    typeof firstArg === 'object' &&
    firstArg.host === SYNTHETIC_PUBLIC_IP &&
    Number(firstArg.port) === FIXTURE_PORT
  ) {
    return originalCreateConnection.call(
      net,
      { ...firstArg, host: '127.0.0.1' },
      ...args.slice(1),
    );
  }
  return originalCreateConnection.apply(net, args);
};

await import('./out/main/index.js');
`;

  const testMainPath = path.join(targetDir, 'test-main.mjs');
  fs.writeFileSync(testMainPath, testMainContent, 'utf8');

  return {
    appDir: targetDir,
    testMainPath,
    outDir: path.join(targetDir, 'out'),
  };
}

/**
 * Opens an isolated SQLite database file from Node.js (after Electron exits) using the
 * host Node ABI native binding for direct inspection of WAL mode, migrations, and integrity.
 */
export function openIsolatedSqlite(userDataDir, options = {}) {
  const dbPath = path.join(userDataDir, 'database', 'auditor.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Expected SQLite database file not found at ${dbPath}`);
  }

  const desktopBetterSqlitePath = path.join(
    PROJECT_ROOT,
    'apps',
    'desktop',
    'node_modules',
    'better-sqlite3',
  );
  const BetterSqlite3 = require(desktopBetterSqlitePath);

  const nodeBindingCandidate = path.join(
    PROJECT_ROOT,
    'apps',
    'desktop',
    'src',
    'main',
    'db',
    'native',
    `node-v${process.versions.modules}-${process.platform}-${process.arch}`,
    'better_sqlite3.node',
  );

  const dbOpts = {
    readonly: options.readonly ?? false,
    fileMustExist: true,
    ...(fs.existsSync(nodeBindingCandidate) ? { nativeBinding: nodeBindingCandidate } : {}),
  };

  return {
    dbPath,
    db: new BetterSqlite3(dbPath, dbOpts),
  };
}

export function inspectSqliteOnDisk(userDataDir) {
  const { dbPath, db } = openIsolatedSqlite(userDataDir, { readonly: true });
  try {
    const journalMode = db.pragma('journal_mode', { simple: true });
    const quickCheckRows = db.pragma('quick_check');
    const integrityCheckRows = db.pragma('integrity_check');
    const migrations = db
      .prepare('SELECT version, name, applied_at FROM _migrations ORDER BY version ASC')
      .all();

    const quickCheckOk =
      Array.isArray(quickCheckRows) &&
      quickCheckRows.length === 1 &&
      Object.values(quickCheckRows[0])[0] === 'ok';
    const integrityCheckOk =
      Array.isArray(integrityCheckRows) &&
      integrityCheckRows.length === 1 &&
      Object.values(integrityCheckRows[0])[0] === 'ok';

    return {
      dbPath,
      journalMode,
      quickCheckOk,
      integrityCheckOk,
      migrationsCount: migrations.length,
      migrations,
    };
  } finally {
    db.close();
  }
}
