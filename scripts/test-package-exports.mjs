import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { spawnSync, execSync } from 'node:child_process';

const rootDir = process.cwd();
const sharedDistDir = path.join(rootDir, 'packages', 'shared', 'dist');

console.log('[test:package-exports] Step 1: Cleaning packages/shared/dist ...');
const cleanStartTime = Date.now();
if (fs.existsSync(sharedDistDir)) {
  fs.rmSync(sharedDistDir, { recursive: true, force: true });
}
if (fs.existsSync(sharedDistDir)) {
  console.error('[test:package-exports] ERROR: Failed to remove dist directory.');
  process.exit(1);
}
console.log('  Clean confirmed: packages/shared/dist removed.');

console.log('[test:package-exports] Step 2: Clean build of @auditor/shared ...');
try {
  execSync('pnpm --filter @auditor/shared build', {
    cwd: rootDir,
    stdio: 'inherit',
  });
} catch (err) {
  console.error('[test:package-exports] ERROR: Build step failed.', err);
  process.exit(1);
}

const builtIndexJs = path.join(sharedDistDir, 'index.js');
const builtIndexDts = path.join(sharedDistDir, 'index.d.ts');

if (!fs.existsSync(builtIndexJs) || !fs.existsSync(builtIndexDts)) {
  console.error('[test:package-exports] ERROR: Missing dist artifacts after build.');
  process.exit(1);
}

const jsStat = fs.statSync(builtIndexJs);
if (jsStat.mtimeMs < cleanStartTime) {
  console.error(
    '[test:package-exports] ERROR: Stale artifact detected! Timestamp is older than clean start.',
  );
  process.exit(1);
}
console.log(
  `  Fresh build confirmed: dist/index.js generated at ${new Date(jsStat.mtimeMs).toISOString()}`,
);

console.log(
  '[test:package-exports] Step 3: Executing independent Node ESM subprocess using bare specifier "@auditor/shared" ...',
);

const childScript = `
import {
  normalizeHost,
  parseHostAndPort,
  validateScanTarget,
  isUrlInScope,
  isValidIPv4,
  isValidIPv6,
  canonicalizeIPv6,
  IPC_CHANNELS,
  PAYLOAD_BOUNDS_POLICY,
  validateIPCRequest,
} from '@auditor/shared';
import * as sharedNamespace from '@auditor/shared';
import assert from 'node:assert';

console.log('  [subprocess] Successfully imported from "@auditor/shared".');

// 1. Verify function exports
assert.strictEqual(typeof normalizeHost, 'function', 'normalizeHost must be exported');
assert.strictEqual(typeof parseHostAndPort, 'function', 'parseHostAndPort must be exported');
assert.strictEqual(typeof validateScanTarget, 'function', 'validateScanTarget must be exported');
assert.strictEqual(typeof isUrlInScope, 'function', 'isUrlInScope must be exported');
assert.strictEqual(typeof isValidIPv4, 'function', 'isValidIPv4 must be exported');
assert.strictEqual(typeof isValidIPv6, 'function', 'isValidIPv6 must be exported');
assert.strictEqual(typeof canonicalizeIPv6, 'function', 'canonicalizeIPv6 must be exported');

// 2. Functional tests on pure IPv6 validator & canonicalizer (Zero Node.js built-ins)
assert.strictEqual(isValidIPv6('::1'), true, '::1 must be valid');
assert.strictEqual(isValidIPv6('2001:db8::1'), true, 'compressed IPv6 must be valid');
assert.strictEqual(isValidIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), true, 'full IPv6 must be valid');
assert.strictEqual(isValidIPv6('::ffff:192.168.1.1'), true, 'IPv4-mapped IPv6 must be valid');
assert.strictEqual(isValidIPv6('1::2::3'), false, 'multiple :: must be rejected');
assert.strictEqual(isValidIPv6(':::'), false, 'triple colons must be rejected');
assert.strictEqual(isValidIPv6('2001:xyz::1'), false, 'invalid chars must be rejected');

// IPv6 Canonicalization checks
const canonicalLoopback = '[0000:0000:0000:0000:0000:0000:0000:0001]';
const canonicalGlobal = '[2001:0db8:0000:0000:0000:0000:0000:0001]';

assert.strictEqual(canonicalizeIPv6('::1'), '0000:0000:0000:0000:0000:0000:0000:0001');
assert.strictEqual(canonicalizeIPv6('0:0:0:0:0:0:0:1'), '0000:0000:0000:0000:0000:0000:0000:0001');
assert.strictEqual(canonicalizeIPv6('::1'), canonicalizeIPv6('0:0:0:0:0:0:0:1'));
assert.strictEqual(canonicalizeIPv6('2001:db8::1'), canonicalizeIPv6('2001:0db8:0:0:0:0:0:1'));

// 3. Normalization tests
assert.strictEqual(normalizeHost('::1'), canonicalLoopback, 'bare ::1 canonicalizes');
assert.strictEqual(normalizeHost('[::1]'), canonicalLoopback, 'bracketed [::1] canonicalizes');
assert.strictEqual(normalizeHost('0:0:0:0:0:0:0:1'), canonicalLoopback, 'full 0:0:0:0:0:0:0:1 canonicalizes');
assert.strictEqual(normalizeHost('https://example.com/test'), 'example.com', 'url normalizes to lowercase hostname');
assert.strictEqual(normalizeHost('[2001:db8::1]:8443'), canonicalGlobal, 'bracketed with port canonicalizes correctly');

// 4. Strict host & port error handling (no silent fallbacks)
assert.throws(() => normalizeHost('example.com:invalid'), /Invalid non-numeric port/);
assert.throws(() => normalizeHost('example.com:99999'), /Port number out of range/);
assert.throws(() => normalizeHost('[invalid-ipv6]'), /Invalid IPv6 address/);

// 5. Credential rejection
assert.strictEqual(validateScanTarget('https://admin:pass@example.com/wp').valid, false, 'credentials rejected');
assert.strictEqual(validateScanTarget('https://token@example.com').valid, false, 'user-only credential rejected');
assert.strictEqual(validateScanTarget('https://example.com/safe').valid, true, 'safe url accepted');

// 6. Port Scope Precedence
const allowed = ['api.example.com:8443', 'web.example.com'];
const policy = { allowedPorts: [8080] };

// Rule 1: allowAnyPort
assert.strictEqual(isUrlInScope('https://api.example.com:9999', allowed, { allowAnyPort: true }), true);

// Rule 2: Explicit port on entry takes precedence and is NOT cancelled by allowedPorts
assert.strictEqual(isUrlInScope('https://api.example.com:8443', allowed, policy), true);
assert.strictEqual(isUrlInScope('https://api.example.com:8080', allowed, policy), false, '8080 rejected on api.example.com which locked to 8443');

// Rule 3: allowedPorts applies to hosts without explicit port
assert.strictEqual(isUrlInScope('http://web.example.com:8080', allowed, policy), true, '8080 allowed on web host');
assert.strictEqual(isUrlInScope('http://web.example.com:9000', allowed, policy), false, '9000 rejected on web host');

// Rule 4: Protocol standard port applies when no explicit port or allowedPorts
assert.strictEqual(isUrlInScope('https://web.example.com', allowed), true, 'https:443 allowed by default');
assert.strictEqual(isUrlInScope('http://web.example.com:443', allowed), false, 'http:443 rejected due to protocol mismatch');
assert.strictEqual(isUrlInScope('https://web.example.com:80', allowed), false, 'https:80 rejected due to protocol mismatch');

// 7. Verify IPC exports and validation
assert.strictEqual(IPC_CHANNELS.APP_PING, 'app:ping', 'IPC channel app:ping must match');
assert.strictEqual(
  sharedNamespace.PROJECT_ROOT,
  undefined,
  'Machine-specific PROJECT_ROOT must NOT be exported from @auditor/shared',
);
assert.strictEqual(PAYLOAD_BOUNDS_POLICY.maxTotalBytes, 1024 * 1024, 'maxTotalBytes must be 1MB');
const parsedPing = validateIPCRequest(IPC_CHANNELS.APP_PING, { timestamp: 12345 });
assert.strictEqual(parsedPing.timestamp, 12345, 'validateIPCRequest must validate and return payload');

// 8. Verify resolved module path is dist/index.js (NOT src/index.ts)
const resolvedUrl = import.meta.resolve('@auditor/shared');
assert(
  resolvedUrl.includes('packages/shared/dist/index.js'),
  'Resolution must point to dist/index.js, but got: ' + resolvedUrl
);
console.log('  [subprocess] import.meta.resolve("@auditor/shared") -> ' + resolvedUrl);
console.log('  [subprocess] All assertions passed successfully.');
`;

const childResult = spawnSync('node', ['--input-type=module', '-e', childScript], {
  cwd: rootDir,
  encoding: 'utf8',
});

if (childResult.status !== 0) {
  console.error('[test:package-exports] ERROR in child subprocess:');
  console.error(childResult.stderr || childResult.stdout);
  process.exit(childResult.status || 1);
}

console.log(childResult.stdout);
console.log('[test:package-exports] Step 4: Verification completed with 0 errors.');
