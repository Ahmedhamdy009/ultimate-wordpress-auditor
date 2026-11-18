import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  PROVENANCE_ERROR_CODES,
  PROVENANCE_FILENAME,
  computeSourceFingerprint,
  writeBuildProvenance,
  verifyOutProvenance,
  verifyAsarProvenance,
  type GitIdentity,
} from '../../../../scripts/build-provenance.mjs';

const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../../');
const ASAR_LIB_PATH = path.resolve(
  PROJECT_ROOT,
  'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar',
);
const asar = require(ASAR_LIB_PATH) as {
  createPackage: (src: string, dest: string) => Promise<void>;
  listPackage: (archive: string) => string[];
};

function createIsolatedFixtureWorkspace(baseDir: string): {
  readonly fixtureRoot: string;
  readonly outDir: string;
  readonly appDir: string;
  readonly asarPath: string;
  readonly commitA: GitIdentity;
  readonly commitB: GitIdentity;
  readonly rebuildOut: (gitId?: GitIdentity) => void;
} {
  const fixtureRoot = baseDir;
  const appDir = path.join(fixtureRoot, 'apps', 'desktop');
  const outDir = path.join(appDir, 'out');
  const asarPath = path.join(appDir, 'dist', 'win-unpacked', 'resources', 'app.asar');

  // Create relevant source files matching project layout
  const filesToWrite: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture-root', version: '0.1.7' }),
    'electron-builder.yml': 'appId: com.auditor.desktop\nasar: true\n',
    'tsconfig.base.json': '{}',
    'tsconfig.build.json': '{}',
    'packages/shared/package.json': JSON.stringify({ name: '@auditor/shared', version: '0.1.7' }),
    'packages/shared/tsconfig.json': '{}',
    'packages/shared/src/index.ts': 'export const SHARED_VERSION = "0.1.7";\n',
    'apps/desktop/package.json': JSON.stringify({
      name: '@auditor/desktop',
      version: '0.1.7',
      main: './out/main/index.js',
    }),
    'apps/desktop/electron-vite.config.ts': 'export default {};\n',
    'apps/desktop/tsconfig.json': '{}',
    'apps/desktop/tsconfig.node.json': '{}',
    'apps/desktop/src/main/index.ts': 'console.log("main v1");\n',
    'apps/desktop/src/preload/index.ts': 'console.log("preload v1");\n',
    'apps/desktop/src/renderer/index.html':
      '<!DOCTYPE html><html><body>Renderer v1</body></html>\n',
    'apps/desktop/resources/icon.ico': 'ICON-FIXTURE-BYTES',
    'scripts/copy-build-assets.mjs': '// copy-assets fixture\n',
    'scripts/build-provenance.mjs': '// provenance fixture\n',
  };

  for (const [rel, content] of Object.entries(filesToWrite)) {
    const abs = path.join(fixtureRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }

  const commitA: GitIdentity = {
    available: true,
    commitSha: '1111111111111111111111111111111111111111',
    branch: 'main',
    isDirty: false,
  };
  const commitB: GitIdentity = {
    available: true,
    commitSha: '2222222222222222222222222222222222222222',
    branch: 'main',
    isDirty: false,
  };

  const rebuildOut = (gitId: GitIdentity = commitA) => {
    const sharedSrc = fs.readFileSync(
      path.join(fixtureRoot, 'packages/shared/src/index.ts'),
      'utf8',
    );
    const mainSrc = fs.readFileSync(
      path.join(fixtureRoot, 'apps/desktop/src/main/index.ts'),
      'utf8',
    );
    const preloadSrc = fs.readFileSync(
      path.join(fixtureRoot, 'apps/desktop/src/preload/index.ts'),
      'utf8',
    );
    const rendererSrc = fs.readFileSync(
      path.join(fixtureRoot, 'apps/desktop/src/renderer/index.html'),
      'utf8',
    );

    fs.mkdirSync(path.join(outDir, 'main'), { recursive: true });
    fs.mkdirSync(path.join(outDir, 'preload'), { recursive: true });
    fs.mkdirSync(path.join(outDir, 'renderer'), { recursive: true });
    fs.mkdirSync(path.join(outDir, 'resources'), { recursive: true });

    fs.writeFileSync(
      path.join(outDir, 'main/index.js'),
      `// built\n${sharedSrc}${mainSrc}`,
      'utf8',
    );
    fs.writeFileSync(path.join(outDir, 'preload/index.cjs'), `// built\n${preloadSrc}`, 'utf8');
    fs.writeFileSync(path.join(outDir, 'renderer/index.html'), rendererSrc, 'utf8');
    fs.copyFileSync(
      path.join(fixtureRoot, 'apps/desktop/resources/icon.ico'),
      path.join(outDir, 'resources/icon.ico'),
    );

    writeBuildProvenance({
      projectRoot: fixtureRoot,
      outDir,
      gitIdentity: gitId,
      silent: true,
    });
  };

  return { fixtureRoot, outDir, appDir, asarPath, commitA, commitB, rebuildOut };
}

describe('DEF-007-C: Packaging Verification Build Provenance & Stale Artifact Rejection', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = path.resolve(PROJECT_ROOT, '.tmp', `test-def007c-provenance-${crypto.randomUUID()}`);
    fs.mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('1. passes verification for a current build output and packaged app.asar with matching provenance', async () => {
    const fx = createIsolatedFixtureWorkspace(tempRoot);
    fx.rebuildOut(fx.commitA);

    const outRes = verifyOutProvenance({
      projectRoot: fx.fixtureRoot,
      outDir: fx.outDir,
      gitIdentity: fx.commitA,
      requireCommitMatch: true,
    });
    expect(outRes.valid).toBe(true);
    expect(outRes.reasons).toEqual([]);
    expect(outRes.manifest?.gitCommitSha).toBe(fx.commitA.commitSha);

    // Pack into app.asar and verify embedded provenance
    fs.mkdirSync(path.dirname(fx.asarPath), { recursive: true });
    await asar.createPackage(fx.appDir, fx.asarPath);

    const asarRes = verifyAsarProvenance(fx.asarPath, {
      projectRoot: fx.fixtureRoot,
      gitIdentity: fx.commitA,
      requireCommitMatch: true,
      asarModule: asar,
    });
    expect(asarRes.valid).toBe(true);
    expect(asarRes.reasons).toEqual([]);
  });

  it('2. fails verification when artifact has a stale source fingerprint from a previous build', () => {
    const fx = createIsolatedFixtureWorkspace(tempRoot);
    fx.rebuildOut(fx.commitA);

    // Tamper manifest with an older sourceFingerprint (same timestamp/size bundles!)
    const manifestPath = path.join(fx.outDir, PROVENANCE_FILENAME);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.sourceFingerprint = '0'.repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = verifyOutProvenance({
      projectRoot: fx.fixtureRoot,
      outDir: fx.outDir,
      gitIdentity: fx.commitA,
      requireCommitMatch: true,
    });
    expect(res.valid).toBe(false);
    expect(res.reasons).toContain(PROVENANCE_ERROR_CODES.SOURCE_MISMATCH);
  });

  it('3. rejects a stale app.asar artifact after source inputs change', async () => {
    const fx = createIsolatedFixtureWorkspace(tempRoot);
    fx.rebuildOut(fx.commitA);

    fs.mkdirSync(path.dirname(fx.asarPath), { recursive: true });
    await asar.createPackage(fx.appDir, fx.asarPath);

    // Now modify application source WITHOUT rebuilding or repackaging ASAR
    fs.writeFileSync(
      path.join(fx.fixtureRoot, 'apps/desktop/src/main/index.ts'),
      'console.log("main v2 security fix");\n',
      'utf8',
    );

    const staleAsarRes = verifyAsarProvenance(fx.asarPath, {
      projectRoot: fx.fixtureRoot,
      gitIdentity: fx.commitA,
      requireCommitMatch: true,
      asarModule: asar,
    });
    expect(staleAsarRes.valid).toBe(false);
    expect(staleAsarRes.reasons).toContain(PROVENANCE_ERROR_CODES.SOURCE_MISMATCH);
  });

  it('4. fails verification when provenance metadata is missing from out/ or app.asar', async () => {
    const fx = createIsolatedFixtureWorkspace(tempRoot);
    fx.rebuildOut(fx.commitA);

    // Remove build-provenance.json
    const manifestPath = path.join(fx.outDir, PROVENANCE_FILENAME);
    fs.unlinkSync(manifestPath);

    const outRes = verifyOutProvenance({
      projectRoot: fx.fixtureRoot,
      outDir: fx.outDir,
      gitIdentity: fx.commitA,
    });
    expect(outRes.valid).toBe(false);
    expect(outRes.reasons).toContain(PROVENANCE_ERROR_CODES.MISSING);

    // Pack ASAR without build-provenance.json
    fs.mkdirSync(path.dirname(fx.asarPath), { recursive: true });
    await asar.createPackage(fx.appDir, fx.asarPath);

    const asarRes = verifyAsarProvenance(fx.asarPath, {
      projectRoot: fx.fixtureRoot,
      gitIdentity: fx.commitA,
      asarModule: asar,
    });
    expect(asarRes.valid).toBe(false);
    expect(asarRes.reasons).toContain(PROVENANCE_ERROR_CODES.MISSING);
  });

  it('5. detects modifications to shared source, desktop source, or electron-builder.yml and invalidates previous artifact', () => {
    const fx = createIsolatedFixtureWorkspace(tempRoot);
    fx.rebuildOut(fx.commitA);

    // Subcase A: Modify shared package source
    const fpBefore = computeSourceFingerprint(fx.fixtureRoot).sourceFingerprint;
    fs.writeFileSync(
      path.join(fx.fixtureRoot, 'packages/shared/src/index.ts'),
      'export const SHARED_VERSION = "0.1.7-patched";\n',
      'utf8',
    );
    expect(computeSourceFingerprint(fx.fixtureRoot).sourceFingerprint).not.toBe(fpBefore);

    const resShared = verifyOutProvenance({
      projectRoot: fx.fixtureRoot,
      outDir: fx.outDir,
      gitIdentity: fx.commitA,
    });
    expect(resShared.valid).toBe(false);
    expect(resShared.reasons).toContain(PROVENANCE_ERROR_CODES.SOURCE_MISMATCH);

    // Rebuild and verify again, then modify electron-builder.yml
    fx.rebuildOut(fx.commitA);
    expect(
      verifyOutProvenance({
        projectRoot: fx.fixtureRoot,
        outDir: fx.outDir,
        gitIdentity: fx.commitA,
      }).valid,
    ).toBe(true);

    fs.appendFileSync(path.join(fx.fixtureRoot, 'electron-builder.yml'), '# modified\n', 'utf8');
    const resConfig = verifyOutProvenance({
      projectRoot: fx.fixtureRoot,
      outDir: fx.outDir,
      gitIdentity: fx.commitA,
    });
    expect(resConfig.valid).toBe(false);
    expect(resConfig.reasons).toContain(PROVENANCE_ERROR_CODES.SOURCE_MISMATCH);
  });

  it('6. rejects an artifact built from a different commit SHA even if source files happen to match', async () => {
    const fx = createIsolatedFixtureWorkspace(tempRoot);
    fx.rebuildOut(fx.commitA);
    fs.mkdirSync(path.dirname(fx.asarPath), { recursive: true });
    await asar.createPackage(fx.appDir, fx.asarPath);

    // Now verify against commitB (simulating commit history advancing without packaging rebuild)
    const outRes = verifyOutProvenance({
      projectRoot: fx.fixtureRoot,
      outDir: fx.outDir,
      gitIdentity: fx.commitB,
      requireCommitMatch: true,
    });
    expect(outRes.valid).toBe(false);
    expect(outRes.reasons).toContain(PROVENANCE_ERROR_CODES.COMMIT_MISMATCH);

    const asarRes = verifyAsarProvenance(fx.asarPath, {
      projectRoot: fx.fixtureRoot,
      gitIdentity: fx.commitB,
      requireCommitMatch: true,
      asarModule: asar,
    });
    expect(asarRes.valid).toBe(false);
    expect(asarRes.reasons).toContain(PROVENANCE_ERROR_CODES.COMMIT_MISMATCH);
  });

  it('7. rebuilding regenerates valid provenance and restores passing verification for both out/ and repackaged app.asar', async () => {
    const fx = createIsolatedFixtureWorkspace(tempRoot);
    fx.rebuildOut(fx.commitA);

    // Modify source & advance commit -> old artifact invalidated
    fs.writeFileSync(
      path.join(fx.fixtureRoot, 'apps/desktop/src/main/index.ts'),
      'console.log("main v2");\n',
      'utf8',
    );
    expect(
      verifyOutProvenance({
        projectRoot: fx.fixtureRoot,
        outDir: fx.outDir,
        gitIdentity: fx.commitB,
        requireCommitMatch: true,
      }).valid,
    ).toBe(false);

    // Rebuild and repackage ASAR against commitB
    fx.rebuildOut(fx.commitB);
    fs.mkdirSync(path.dirname(fx.asarPath), { recursive: true });
    await asar.createPackage(fx.appDir, fx.asarPath);

    const outRebuilt = verifyOutProvenance({
      projectRoot: fx.fixtureRoot,
      outDir: fx.outDir,
      gitIdentity: fx.commitB,
      requireCommitMatch: true,
    });
    expect(outRebuilt.valid).toBe(true);
    expect(outRebuilt.reasons).toEqual([]);

    const asarRebuilt = verifyAsarProvenance(fx.asarPath, {
      projectRoot: fx.fixtureRoot,
      gitIdentity: fx.commitB,
      requireCommitMatch: true,
      asarModule: asar,
    });
    expect(asarRebuilt.valid).toBe(true);
    expect(asarRebuilt.reasons).toEqual([]);
  });

  it('8. rejects stale bundle tampering even when provenance manifest claims current sourceFingerprint', () => {
    const fx = createIsolatedFixtureWorkspace(tempRoot);
    fx.rebuildOut(fx.commitA);

    // Overwrite compiled main/index.js with stale bundle bytes after provenance was written
    fs.writeFileSync(
      path.join(fx.outDir, 'main/index.js'),
      '// stale overwritten bundle\n',
      'utf8',
    );

    const res = verifyOutProvenance({
      projectRoot: fx.fixtureRoot,
      outDir: fx.outDir,
      gitIdentity: fx.commitA,
      requireCommitMatch: true,
    });
    expect(res.valid).toBe(false);
    expect(res.reasons).toContain(PROVENANCE_ERROR_CODES.BUNDLE_MISMATCH);
  });
});
