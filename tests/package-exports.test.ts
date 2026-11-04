import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

describe('Package Exports & Workspace Resolution Tests', () => {
  const rootDir = process.cwd();
  const sharedPkgJsonPath = path.join(rootDir, 'packages', 'shared', 'package.json');
  const sharedDistIndexJs = path.join(rootDir, 'packages', 'shared', 'dist', 'index.js');
  const sharedDistIndexDts = path.join(rootDir, 'packages', 'shared', 'dist', 'index.d.ts');
  const sharedGuardJs = path.join(rootDir, 'packages', 'shared', 'dist', 'scope', 'guard.js');
  const sharedGuardDts = path.join(rootDir, 'packages', 'shared', 'dist', 'scope', 'guard.d.ts');

  it('verifies packages/shared/package.json exports configuration', () => {
    expect(fs.existsSync(sharedPkgJsonPath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(sharedPkgJsonPath, 'utf8'));

    expect(pkg.name).toBe('@auditor/shared');
    expect(pkg.type).toBe('module');
    expect(pkg.main).toBe('./dist/index.js');
    expect(pkg.types).toBe('./dist/index.d.ts');

    // Verify subpath exports
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports['.']).toBeDefined();
    expect(pkg.exports['.'].types).toBe('./dist/index.d.ts');
    expect(pkg.exports['.'].import).toBe('./dist/index.js');
    expect(pkg.exports['.'].default).toBe('./dist/index.js');
  });

  it('verifies that built artifacts exist and are not empty', () => {
    expect(fs.existsSync(sharedDistIndexJs), 'dist/index.js must exist').toBe(true);
    expect(fs.existsSync(sharedDistIndexDts), 'dist/index.d.ts must exist').toBe(true);
    expect(fs.existsSync(sharedGuardJs), 'dist/scope/guard.js must exist').toBe(true);
    expect(fs.existsSync(sharedGuardDts), 'dist/scope/guard.d.ts must exist').toBe(true);

    const jsContent = fs.readFileSync(sharedDistIndexJs, 'utf8');
    const dtsContent = fs.readFileSync(sharedDistIndexDts, 'utf8');
    const guardDtsContent = fs.readFileSync(sharedGuardDts, 'utf8');
    expect(jsContent.length).toBeGreaterThan(0);
    expect(dtsContent.length).toBeGreaterThan(0);
    expect(dtsContent).toContain("export * from './scope/index.js'");
    expect(guardDtsContent).toContain('normalizeHost');
    expect(guardDtsContent).toContain('validateScanTarget');
    expect(guardDtsContent).toContain('isUrlInScope');
  });

  it('verifies package resolution resolves to dist/index.js via Node module resolution', () => {
    const require = createRequire(path.join(rootDir, 'dummy.cjs'));
    const resolvedPath = require.resolve('@auditor/shared');
    const normalizedResolved = path.normalize(resolvedPath).toLowerCase();
    const normalizedExpected = path.normalize(sharedDistIndexJs).toLowerCase();

    expect(normalizedResolved).toBe(normalizedExpected);
  });

  it('dynamically imports the compiled dist/index.js directly, bypassing vitest aliases', async () => {
    // Direct file URL import bypasses any vitest alias for '@auditor/shared'
    const distModuleUrl = new URL(`file:///${sharedDistIndexJs.replace(/\\/g, '/')}`).href;
    const compiledModule = await import(distModuleUrl);

    expect(typeof compiledModule.normalizeHost).toBe('function');
    expect(typeof compiledModule.parseHostAndPort).toBe('function');
    expect(typeof compiledModule.getEffectivePort).toBe('function');
    expect(typeof compiledModule.validateScanTarget).toBe('function');
    expect(typeof compiledModule.isUrlInScope).toBe('function');
    expect(typeof compiledModule.isValidIPv4).toBe('function');
    expect(typeof compiledModule.isValidIPv6).toBe('function');
    expect(typeof compiledModule.canonicalizeIPv6).toBe('function');

    // Verify zero Node.js built-ins in packages/shared source files
    const guardSrc = fs.readFileSync(
      path.join(rootDir, 'packages', 'shared', 'src', 'scope', 'guard.ts'),
      'utf8',
    );
    expect(guardSrc).not.toContain("from 'node:");
    expect(guardSrc).not.toContain('from "node:');

    // Functional verification on compiled artifacts:
    // 1. IPv6 canonical normalization
    const canonicalLoopback = '[0000:0000:0000:0000:0000:0000:0000:0001]';
    const canonicalGlobal = '[2001:0db8:0000:0000:0000:0000:0000:0001]';
    expect(compiledModule.normalizeHost('::1')).toBe(canonicalLoopback);
    expect(compiledModule.normalizeHost('[::1]')).toBe(canonicalLoopback);
    expect(compiledModule.normalizeHost('0:0:0:0:0:0:0:1')).toBe(canonicalLoopback);
    expect(compiledModule.normalizeHost('2001:db8::1')).toBe(canonicalGlobal);
    expect(compiledModule.normalizeHost('::1')).toBe(
      compiledModule.normalizeHost('0:0:0:0:0:0:0:1'),
    );

    // 2. Strict error on malformed host
    expect(() => compiledModule.normalizeHost('example.com:invalid')).toThrow();

    // 3. Credential rejection
    const credCheck = compiledModule.validateScanTarget('https://admin:pass@example.com/wp');
    expect(credCheck.valid).toBe(false);
    expect(credCheck.reason).toContain('embedded credentials');

    // 4. Strict port scope
    const allowed = ['example.com'];
    expect(compiledModule.isUrlInScope('https://example.com:8443', allowed)).toBe(false);
    expect(
      compiledModule.isUrlInScope('https://example.com:8443', allowed, { allowAnyPort: true }),
    ).toBe(true);
    expect(compiledModule.isUrlInScope('https://example.com', allowed)).toBe(true);
  });
});
