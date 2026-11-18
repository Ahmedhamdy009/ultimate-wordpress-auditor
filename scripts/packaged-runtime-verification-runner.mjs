/* eslint-disable */
/**
 * Post-Hardening Packaged Runtime Verification Suite.
 *
 * Phase 1: Launches the unmodified packaged production executable
 *          (apps/desktop/dist/win-unpacked/Ultimate WordPress & Website Auditor.exe)
 *          with an isolated temporary userData directory under D:\ahmed\.tmp.
 *          Verifies startup, navigation, Electron security settings, absence of removed
 *          globals/testHooks, better-sqlite3 native ABI loading, SQLite WAL/migrations/integrity,
 *          Project CRUD, adversarial IPC schema rejection, synchronous & unresolvable SSRF
 *          rejections, and restart persistence.
 *
 * Phase 2: Launches an isolated test-only composition root under D:\ahmed\.tmp that extracts
 *          the verified /out bundle from app.asar and installs external fixture network routing
 *          ONLY for synthetic test hostnames before importing ./out/main/index.js.
 *          Verifies Site CRUD, consistent SSRF rejections across audit:validate-target,
 *          site:create, and scan:create (including DNS rebinding, mixed public/private DNS,
 *          and TOCTOU DNS failures), full unified scan lifecycle with Playwright & axe-core,
 *          findings & coverage persistence, screenshot storage & IPC retrieval, HTML/JSON/CSV
 *          report generation, cancellation, interrupted-scan crash recovery, and restart
 *          persistence.
 */

import { _electron } from 'playwright-core';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import {
  PACKAGED_EXE_PATH,
  TMP_ROOT,
  createIsolatedRunSuffix,
  createIsolatedUserDataDir,
  inspectSqliteOnDisk,
  openIsolatedSqlite,
  prepareIsolatedCompositionRoot,
  resolveElectronExecutablePath,
  verifyFreshPackagedBuildProvenance,
} from './isolated-runtime-harness.mjs';

const SYNC_SSRF_VECTORS = [
  { label: 'loopback_ipv4', url: 'http://127.0.0.1/', expectedCode: 'ERR_SSRF_PROHIBITED_TARGET' },
  {
    label: 'loopback_ipv4_port',
    url: 'http://127.0.0.1:8080/',
    expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
  },
  { label: 'localhost', url: 'http://localhost/', expectedCode: 'ERR_SSRF_PROHIBITED_TARGET' },
  {
    label: 'subdomain_localhost',
    url: 'http://sub.localhost/',
    expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
  },
  { label: 'loopback_ipv6', url: 'http://[::1]/', expectedCode: 'ERR_SSRF_PROHIBITED_TARGET' },
  { label: 'unspecified_ipv4', url: 'http://0.0.0.0/', expectedCode: 'ERR_SSRF_PROHIBITED_TARGET' },
  { label: 'rfc1918_10', url: 'http://10.0.0.1/', expectedCode: 'ERR_SSRF_PROHIBITED_TARGET' },
  { label: 'rfc1918_172', url: 'http://172.16.0.1/', expectedCode: 'ERR_SSRF_PROHIBITED_TARGET' },
  { label: 'rfc1918_192', url: 'http://192.168.1.1/', expectedCode: 'ERR_SSRF_PROHIBITED_TARGET' },
  {
    label: 'cloud_metadata',
    url: 'http://169.254.169.254/latest/meta-data/',
    expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
  },
  {
    label: 'link_local_ipv4',
    url: 'http://169.254.1.1/',
    expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
  },
  {
    label: 'link_local_ipv6',
    url: 'http://[fe80::1]/',
    expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
  },
  {
    label: 'alt_ipv4_decimal',
    url: 'http://2130706433/',
    expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
  },
  { label: 'alt_ipv4_hex', url: 'http://0x7f000001/', expectedCode: 'ERR_SSRF_PROHIBITED_TARGET' },
  {
    label: 'alt_ipv4_octal',
    url: 'http://0177.0.0.1/',
    expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
  },
  {
    label: 'ipv4_mapped_ipv6_loopback',
    url: 'http://[::ffff:127.0.0.1]/',
    expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
  },
  {
    label: 'ipv4_mapped_ipv6_metadata',
    url: 'http://[::ffff:169.254.169.254]/',
    expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
  },
  {
    label: 'ipv4_mapped_ipv6_hex',
    url: 'http://[::ffff:7f00:1]/',
    expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
  },
];

const TEST_RESULTS = {
  timestamp: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    hostAbi: process.versions.modules,
    executablePath: PACKAGED_EXE_PATH,
  },
  provenance: null,
  scopes: {},
  summary: {
    totalTests: 0,
    passed: 0,
    failed: 0,
  },
};

function recordTest(scope, testName, status, details = {}) {
  if (!TEST_RESULTS.scopes[scope]) {
    TEST_RESULTS.scopes[scope] = [];
  }
  TEST_RESULTS.summary.totalTests++;
  if (status === 'PASS') {
    TEST_RESULTS.summary.passed++;
  } else {
    TEST_RESULTS.summary.failed++;
  }
  const entry = { testName, status, details, timestamp: new Date().toISOString() };
  TEST_RESULTS.scopes[scope].push(entry);
  console.log(`[${status}] [${scope}] ${testName}`, details ? JSON.stringify(details) : '');
}

async function verifyUiNavigation(window) {
  const views = [
    'projects',
    'scans',
    'reports',
    'target-validator',
    'system-diagnostics',
    'overview',
  ];
  const visited = [];
  for (const viewId of views) {
    const clicked = await window.evaluate(id => {
      const btn = document.getElementById(`nav-item-${id}`);
      if (!btn) return false;
      btn.click();
      return true;
    }, viewId);
    if (!clicked) {
      return { ok: false, failedView: viewId, visited };
    }
    await new Promise(r => setTimeout(r, 120));
    const activeState = await window.evaluate(id => {
      const btn = document.getElementById(`nav-item-${id}`);
      const hasErrorBoundary = Boolean(document.querySelector('[data-testid="error-boundary"]'));
      return {
        isCurrent: btn?.getAttribute('aria-current') === 'page',
        hasErrorBoundary,
      };
    }, viewId);
    if (!activeState.isCurrent || activeState.hasErrorBoundary) {
      return { ok: false, failedView: viewId, activeState, visited };
    }
    visited.push(viewId);
  }
  return { ok: true, visited };
}

function createFixtureHttpServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Powered-By': 'PHP/8.2.0',
        Server: 'Apache/2.4.52 (Ubuntu)',
      });
      res.end(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Packaged Production Audit Test Site</title>
          <meta name="generator" content="WordPress 6.4.2">
          <link rel="https://api.w.org/" href="/wp-json/">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            .low-contrast-text { color: #888888; background-color: #999999; }
            .oversized-box { width: 1400px; height: 120px; background: royalblue; }
          </style>
        </head>
        <body>
          <h1>Packaged Audit Production Target</h1>
          <p><a href="/page-sub.html">Sub Page Link</a></p>
          <p><a href="/non-existent-link.html">Broken Page Link</a></p>

          <img src="/broken-sample-image.png">
          <button id="admin-action-btn" class="secret-token-btn"></button>
          <p class="low-contrast-text">Unreadable contrast text sample</p>
          <div class="oversized-box">Overflow container for mobile viewports</div>

          <script src="/missing-script.js"></script>
          <script>
            setTimeout(() => {
              throw new Error("Packaged audit deliberate runtime exception");
            }, 60);
          </script>
        </body>
        </html>
      `);
    } else if (url.pathname === '/page-sub.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <title>Sub Page</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
          <h2>Subpage Content</h2>
          <a href="/">Back Home</a>
          <input id="patient-ssn" class="patient-identifier" />
        </body>
        </html>
      `);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });
}

async function runVerification() {
  console.log('======================================================================');
  console.log(' POST-HARDENING PACKAGED RUNTIME VERIFICATION SUITE');
  console.log(' Target Executable:', PACKAGED_EXE_PATH);
  console.log('======================================================================\n');

  const provenance = verifyFreshPackagedBuildProvenance();
  TEST_RESULTS.provenance = {
    outValid: provenance.outProvenance.valid,
    asarValid: provenance.asarProvenance.valid,
    appVersion: provenance.asarProvenance.manifest?.appVersion,
    gitCommitSha: provenance.asarProvenance.manifest?.gitCommitSha,
    sourceFingerprint: provenance.asarProvenance.manifest?.sourceFingerprint,
    outBundleDigest: provenance.asarProvenance.manifest?.outBundleDigest,
  };

  const runSuffix = createIsolatedRunSuffix();
  const prodUserDataDir = createIsolatedUserDataDir('packaged-prod-userdata', runSuffix);
  const harnessAppDir = path.join(TMP_ROOT, `packaged-harness-app-${runSuffix}`);
  const harnessUserDataDir = createIsolatedUserDataDir('packaged-harness-userdata', runSuffix);

  const fixtureServer = createFixtureHttpServer();
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const fixturePort = fixtureServer.address().port;
  console.log(`[Fixture] Local HTTP test fixture listening on http://127.0.0.1:${fixturePort}\n`);

  let prodProjectId = null;

  try {
    // ========================================================================
    // PHASE 1: UNMODIFIED PACKAGED EXECUTABLE WITH ISOLATED USERDATA
    // ========================================================================
    console.log('--- PHASE 1: UNMODIFIED PACKAGED EXECUTABLE (ISOLATED USERDATA) ---');
    const launchStartTime = Date.now();
    const prodApp = await _electron.launch({
      executablePath: PACKAGED_EXE_PATH,
      args: [`--user-data-dir=${prodUserDataDir}`],
      env: {
        ...process.env,
        AUDITOR_USER_DATA_DIR: prodUserDataDir,
      },
      timeout: 30000,
    });
    const startupDurationMs = Date.now() - launchStartTime;

    recordTest('PHASE1_STARTUP', 'Unmodified Packaged Executable Launches Cleanly', 'PASS', {
      startupDurationMs,
      executablePath: PACKAGED_EXE_PATH,
    });

    try {
      const window = await prodApp.firstWindow({ timeout: 15000 });
      await window.waitForSelector('#nav-item-overview', { timeout: 15000 });
      const windowTitle = await window.title();
      const hasRootElement = await window.evaluate(() => Boolean(document.getElementById('root')));
      const hasNavbar = await window.evaluate(() =>
        Boolean(document.querySelector('header, nav, [class*="navbar"], [class*="sidebar"]')),
      );
      const hasErrorBoundary = await window.evaluate(() =>
        Boolean(document.querySelector('[data-testid="error-boundary"]')),
      );

      recordTest(
        'PHASE1_STARTUP',
        'Renderer Window and React UI Rendered',
        hasRootElement && hasNavbar && !hasErrorBoundary ? 'PASS' : 'FAIL',
        { windowTitle, hasRootElement, hasNavbar, hasErrorBoundary },
      );

      const navResult = await verifyUiNavigation(window);
      recordTest(
        'PHASE1_STARTUP',
        'Interactive Navigation Across All 6 Views Verified',
        navResult.ok ? 'PASS' : 'FAIL',
        navResult,
      );

      const startupErrorLog = path.join(prodUserDataDir, 'logs', 'startup-error.log');
      const hasStartupErrorLog = fs.existsSync(startupErrorLog);
      recordTest(
        'PHASE1_STARTUP',
        'Zero Startup Dialogs and Clean Isolated Logs',
        !hasStartupErrorLog ? 'PASS' : 'FAIL',
        { startupErrorLog, hasStartupErrorLog },
      );

      // Verify isolated userData path
      const pathInfo = await prodApp.evaluate(async ({ app }) => ({
        userData: app.getPath('userData'),
        appName: app.getName ? app.getName() : app.name,
        isPackaged: app.isPackaged,
      }));
      const matchesIsolatedUserData =
        path.resolve(pathInfo.userData).toLowerCase() ===
        path.resolve(prodUserDataDir).toLowerCase();

      recordTest(
        'PHASE1_ISOLATION',
        'Packaged Executable Honors Isolated userData Under D:\\ahmed\\.tmp',
        matchesIsolatedUserData && pathInfo.isPackaged ? 'PASS' : 'FAIL',
        {
          actualUserData: pathInfo.userData,
          expectedUserData: prodUserDataDir,
          matchesIsolatedUserData,
          isPackaged: pathInfo.isPackaged,
          appName: pathInfo.appName,
        },
      );

      // Verify removed globals and security settings
      const mainHardeningCheck = await prodApp.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const prefs = win.webContents.getLastWebPreferences
          ? win.webContents.getLastWebPreferences()
          : null;
        const willNavigateListeners = win.webContents.rawListeners('will-navigate').length;
        return {
          hasActiveOrchestratorGlobal: '__activeOrchestrator' in globalThis,
          hasActiveDbGlobal: '__activeDatabaseConnection' in globalThis,
          contextIsolation: prefs?.contextIsolation ?? null,
          nodeIntegration: prefs?.nodeIntegration ?? null,
          sandbox: prefs?.sandbox ?? null,
          willNavigateListeners,
        };
      });

      const rendererSecurity = await window.evaluate(() => ({
        hasRequire: typeof window.require !== 'undefined',
        hasProcess: typeof window.process !== 'undefined',
        hasElectronAPI: typeof window.electronAPI === 'object' && window.electronAPI !== null,
        isApiFrozen: Object.isFrozen(window.electronAPI),
      }));

      const securityOk =
        !mainHardeningCheck.hasActiveOrchestratorGlobal &&
        !mainHardeningCheck.hasActiveDbGlobal &&
        mainHardeningCheck.contextIsolation === true &&
        mainHardeningCheck.nodeIntegration === false &&
        mainHardeningCheck.sandbox === true &&
        mainHardeningCheck.willNavigateListeners > 0 &&
        !rendererSecurity.hasRequire &&
        !rendererSecurity.hasProcess &&
        rendererSecurity.hasElectronAPI &&
        rendererSecurity.isApiFrozen;

      recordTest(
        'PHASE1_SECURITY',
        'Electron Security Flags, Preload Isolation, and Zero Global Test Handles',
        securityOk ? 'PASS' : 'FAIL',
        { mainHardeningCheck, rendererSecurity },
      );

      // Windows Browser Discovery
      const browserDiscovery = await prodApp.evaluate(async () => {
        const nodeFs = process.getBuiltinModule('node:fs');
        const nodePath = process.getBuiltinModule('node:path');
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        const edge = [
          nodePath.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          nodePath.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ].find(p => nodeFs.existsSync(p));
        const chrome = [
          nodePath.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          nodePath.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ].find(p => nodeFs.existsSync(p));
        return { edge, chrome };
      });
      recordTest(
        'PHASE1_BROWSER',
        'Discovered Windows System Browsers',
        browserDiscovery.edge || browserDiscovery.chrome ? 'PASS' : 'FAIL',
        browserDiscovery,
      );

      // Project CRUD via production IPC (proves better-sqlite3 Electron ABI 149 loaded)
      const projCreate = await window.evaluate(async sfx => {
        return await window.electronAPI.createProject({
          name: `Prod Binary Project ${sfx}`,
          description: 'Verified against unmodified packaged executable',
        });
      }, runSuffix);
      prodProjectId = projCreate.data?.id ?? null;

      const projCrud = await window.evaluate(async pId => {
        const fetched = await window.electronAPI.getProject({ id: pId });
        const listed = await window.electronAPI.listProjects();
        const updated = await window.electronAPI.updateProject({
          id: pId,
          name: `${fetched.data?.name} Updated`,
        });
        const archived = await window.electronAPI.archiveProject({ id: pId });
        const restored = await window.electronAPI.restoreProject({ id: pId });
        return {
          fetchedOk: fetched.success && fetched.data?.id === pId,
          listedOk: listed.success && (listed.data?.items || []).some(p => p.id === pId),
          updatedOk: updated.success && updated.data?.name?.endsWith('Updated'),
          archivedOk: archived.success && archived.data?.archivedProjectId === pId,
          restoredOk: restored.success && restored.data?.isArchived === false,
        };
      }, prodProjectId);

      recordTest(
        'PHASE1_CRUD',
        'Project CRUD via Production IPC (Electron ABI 149 SQLite)',
        projCreate.success &&
          projCrud.fetchedOk &&
          projCrud.listedOk &&
          projCrud.updatedOk &&
          projCrud.archivedOk &&
          projCrud.restoredOk
          ? 'PASS'
          : 'FAIL',
        { projectId: prodProjectId, ...projCrud },
      );

      // Adversarial test-hook rejection over production IPC
      const adversarialRes = await window.evaluate(async () => {
        const scanInjectRes = await window.electronAPI.createScanRun({
          siteId: '00000000-0000-4000-8000-000000000001',
          targetUrl: 'http://127.0.0.1:9898/',
          scanType: 'quick',
          config: {
            maxPages: 1,
            testHooks: { allowLoopbackInTests: true, pinnedIpOverride: '127.0.0.1' },
            pinnedIpOverride: '127.0.0.1',
            allowLoopbackInTests: true,
          },
        });
        return { scanInjectRes };
      });
      recordTest(
        'PHASE1_SECURITY',
        'Adversarial testHooks/SSRF Override Injection Rejected by Production IPC',
        adversarialRes.scanInjectRes?.success === false ? 'PASS' : 'FAIL',
        adversarialRes,
      );

      // Production SSRF Regression on unmodified packaged binary (validateTarget + site:create)
      const prodSsrfResults = [];
      for (const vec of [
        ...SYNC_SSRF_VECTORS,
        {
          label: 'unresolvable_dns',
          url: 'http://nonexistent-domain-ssrf-check.invalid/',
          expectedCode: 'ERR_DNS_RESOLUTION_FAILED',
        },
      ]) {
        await new Promise(r => setTimeout(r, 125));
        const res = await window.evaluate(
          async ({ pId, targetUrl }) => {
            const valRes = await window.electronAPI.validateTarget({
              targetUrl,
              options: { allowAnyPort: true },
            });
            const siteRes = await window.electronAPI.createSite({
              projectId: pId,
              name: 'SSRF Regression Check',
              baseUrl: targetUrl,
            });
            return { valRes, siteRes };
          },
          { pId: prodProjectId, targetUrl: vec.url },
        );

        const valRejected =
          res.valRes?.success === true &&
          res.valRes?.data?.valid === false &&
          res.valRes?.data?.errorCode === vec.expectedCode;
        const siteRejected =
          res.siteRes?.success === false && res.siteRes?.error?.code === vec.expectedCode;

        prodSsrfResults.push({
          label: vec.label,
          url: vec.url,
          expectedCode: vec.expectedCode,
          valCode: res.valRes?.data?.errorCode,
          valStatus: res.valRes?.data?.status,
          siteCode: res.siteRes?.error?.code,
          passed: valRejected && siteRejected,
        });
      }

      const prodSsrfAllPassed = prodSsrfResults.every(r => r.passed);
      recordTest(
        'PHASE1_SSRF',
        'Unmodified Production IPC Rejects All Sync & Unresolvable SSRF Vectors Consistently',
        prodSsrfAllPassed ? 'PASS' : 'FAIL',
        {
          totalVectors: prodSsrfResults.length,
          passedVectors: prodSsrfResults.filter(r => r.passed).length,
          failures: prodSsrfResults.filter(r => !r.passed),
        },
      );
    } finally {
      await prodApp.close();
    }

    // Verify SQLite WAL, migrations, and integrity directly on disk after shutdown
    const prodDbInspection = inspectSqliteOnDisk(prodUserDataDir);
    recordTest(
      'PHASE1_SQLITE',
      'Packaged SQLite WAL Mode, Migrations, and Integrity Verified on Disk',
      prodDbInspection.journalMode === 'wal' &&
        prodDbInspection.quickCheckOk &&
        prodDbInspection.integrityCheckOk &&
        prodDbInspection.migrationsCount > 0
        ? 'PASS'
        : 'FAIL',
      {
        dbPath: prodDbInspection.dbPath,
        journalMode: prodDbInspection.journalMode,
        quickCheckOk: prodDbInspection.quickCheckOk,
        integrityCheckOk: prodDbInspection.integrityCheckOk,
        migrationsCount: prodDbInspection.migrationsCount,
      },
    );

    // Restart unmodified packaged exe to verify Project persistence
    const prodRestartApp = await _electron.launch({
      executablePath: PACKAGED_EXE_PATH,
      args: [`--user-data-dir=${prodUserDataDir}`],
      env: {
        ...process.env,
        AUDITOR_USER_DATA_DIR: prodUserDataDir,
      },
      timeout: 30000,
    });
    try {
      const win2 = await prodRestartApp.firstWindow({ timeout: 15000 });
      const restartProjects = await win2.evaluate(async () => {
        return await window.electronAPI.listProjects();
      });
      const persisted = (restartProjects.data?.items || []).some(p => p.id === prodProjectId);
      recordTest(
        'PHASE1_PERSISTENCE',
        'Unmodified Packaged Executable Restart Persistence Verified',
        persisted ? 'PASS' : 'FAIL',
        { projectId: prodProjectId, persisted },
      );
    } finally {
      await prodRestartApp.close();
    }

    // ========================================================================
    // PHASE 2: ISOLATED TEST-ONLY COMPOSITION ROOT (FIXTURE SCAN & DNS REGRESSION)
    // ========================================================================
    console.log('\n--- PHASE 2: ISOLATED TEST-ONLY COMPOSITION ROOT ---');
    prepareIsolatedCompositionRoot({
      targetDir: harnessAppDir,
      fixtureHost: 'mock-audit-target.com',
      fixturePort,
      syntheticPublicIp: '93.184.216.34',
      enableDnsRegressionHosts: true,
    });

    const electronExe = resolveElectronExecutablePath();
    const harnessApp = await _electron.launch({
      executablePath: electronExe,
      args: [harnessAppDir],
      env: {
        ...process.env,
        AUDITOR_USER_DATA_DIR: harnessUserDataDir,
      },
      timeout: 30000,
    });

    let testProjectId = null;
    let testSiteId = null;
    let testScanRunId = null;
    let testReportIdHtml = null;
    let testReportIdJson = null;
    let testReportIdCsv = null;
    let interruptedScanId = null;

    try {
      const window = await harnessApp.firstWindow({ timeout: 15000 });
      await window.waitForSelector('#nav-item-overview', { timeout: 15000 });

      // 1. Project & Site CRUD via production IPC
      const projRes = await window.evaluate(async sfx => {
        return await window.electronAPI.createProject({
          name: `Harness Project ${sfx}`,
          description: 'Isolated test-only composition root project',
        });
      }, runSuffix);
      testProjectId = projRes.data?.id;

      const siteRes = await window.evaluate(
        async ({ pId, port, sfx }) => {
          return await window.electronAPI.createSite({
            projectId: pId,
            name: `Harness Fixture Site ${sfx}`,
            baseUrl: `http://mock-audit-target.com:${port}/`,
          });
        },
        { pId: testProjectId, port: fixturePort, sfx: runSuffix },
      );
      testSiteId = siteRes.data?.id;

      const siteCrud = await window.evaluate(
        async ({ pId, sId }) => {
          const fetched = await window.electronAPI.getSite({ id: sId });
          const listed = await window.electronAPI.listSites({ projectId: pId });
          const updated = await window.electronAPI.updateSite({
            id: sId,
            name: `${fetched.data?.name} Updated`,
          });
          const archived = await window.electronAPI.archiveSite({ id: sId });
          const restored = await window.electronAPI.restoreSite({ id: sId });
          return {
            fetchedOk: fetched.success && fetched.data?.id === sId,
            listedOk: listed.success && (listed.data?.items || []).some(s => s.id === sId),
            updatedOk: updated.success && updated.data?.name?.endsWith('Updated'),
            archivedOk: archived.success && archived.data?.isArchived === true,
            restoredOk: restored.success && restored.data?.isArchived === false,
          };
        },
        { pId: testProjectId, sId: testSiteId },
      );

      recordTest(
        'PHASE2_CRUD',
        'Site CRUD via Production IPC Verified',
        projRes.success &&
          siteRes.success &&
          siteCrud.fetchedOk &&
          siteCrud.listedOk &&
          siteCrud.updatedOk &&
          siteCrud.archivedOk &&
          siteCrud.restoredOk
          ? 'PASS'
          : 'FAIL',
        { projectId: testProjectId, siteId: testSiteId, ...siteCrud },
      );

      // 2. Full 3-handler SSRF Consistency (audit:validate-target, site:create, scan:create)
      //    including DNS rebinding, mixed public/private DNS, and TOCTOU failures
      const ssrf3WayResults = [];

      // 2a. Sync SSRF vectors across all 3 handlers
      for (const vec of SYNC_SSRF_VECTORS) {
        await new Promise(r => setTimeout(r, 125));
        const res = await window.evaluate(
          async ({ pId, sId, targetUrl }) => {
            const valRes = await window.electronAPI.validateTarget({
              targetUrl,
              options: { allowAnyPort: true },
            });
            const createSiteRes = await window.electronAPI.createSite({
              projectId: pId,
              name: 'SSRF Sync Check',
              baseUrl: targetUrl,
            });
            const createScanRes = await window.electronAPI.createScanRun({
              siteId: sId,
              targetUrl,
              scanType: 'quick',
            });
            return { valRes, createSiteRes, createScanRes };
          },
          { pId: testProjectId, sId: testSiteId, targetUrl: vec.url },
        );

        const ok =
          res.valRes?.data?.valid === false &&
          res.valRes?.data?.errorCode === vec.expectedCode &&
          res.createSiteRes?.success === false &&
          res.createSiteRes?.error?.code === vec.expectedCode &&
          res.createScanRes?.success === false &&
          res.createScanRes?.error?.code === vec.expectedCode;

        ssrf3WayResults.push({
          label: vec.label,
          expectedCode: vec.expectedCode,
          valCode: res.valRes?.data?.errorCode,
          siteCode: res.createSiteRes?.error?.code,
          scanCode: res.createScanRes?.error?.code,
          passed: ok,
        });
      }

      // 2b. DNS rebinding, mixed public/private DNS, unresolvable DNS across validateTarget & site:create
      const dnsCases = [
        {
          label: 'dns_rebinding',
          url: 'http://rebind-local.test/',
          toctouUrl: 'http://toctou-rebind.test/',
          expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
        },
        {
          label: 'mixed_public_private_dns',
          url: 'http://mixed-dns.test/',
          toctouUrl: 'http://toctou-mixed.test/',
          expectedCode: 'ERR_SSRF_PROHIBITED_TARGET',
        },
        {
          label: 'unresolvable_dns',
          url: 'http://unresolvable-dns-test.invalid/',
          toctouUrl: 'http://toctou-unresolvable.test/',
          expectedCode: 'ERR_DNS_RESOLUTION_FAILED',
        },
      ];

      for (const dc of dnsCases) {
        await new Promise(r => setTimeout(r, 250));
        const res = await window.evaluate(
          async ({ pId, targetUrl, toctouUrl }) => {
            const valRes = await window.electronAPI.validateTarget({
              targetUrl,
              options: { allowAnyPort: true },
            });
            const createSiteRes = await window.electronAPI.createSite({
              projectId: pId,
              name: `DNS Check ${targetUrl}`,
              baseUrl: targetUrl,
            });
            // TOCTOU: site:create succeeds on lookup #1 (public IP), then scan:create rejects on lookup #2
            const toctouSite = await window.electronAPI.createSite({
              projectId: pId,
              name: `TOCTOU Site ${toctouUrl}`,
              baseUrl: toctouUrl,
            });
            const createScanRes = toctouSite.success
              ? await window.electronAPI.createScanRun({
                  siteId: toctouSite.data.id,
                  targetUrl: toctouUrl,
                  scanType: 'quick',
                })
              : { success: false, error: { code: 'TOCTOU_SITE_SETUP_FAILED' } };

            return { valRes, createSiteRes, toctouSiteOk: toctouSite.success, createScanRes };
          },
          { pId: testProjectId, targetUrl: dc.url, toctouUrl: dc.toctouUrl },
        );

        const ok =
          res.valRes?.data?.valid === false &&
          res.valRes?.data?.errorCode === dc.expectedCode &&
          res.createSiteRes?.success === false &&
          res.createSiteRes?.error?.code === dc.expectedCode &&
          res.toctouSiteOk === true &&
          res.createScanRes?.success === false &&
          res.createScanRes?.error?.code === dc.expectedCode;

        ssrf3WayResults.push({
          label: dc.label,
          expectedCode: dc.expectedCode,
          valCode: res.valRes?.data?.errorCode,
          siteCode: res.createSiteRes?.error?.code,
          scanCode: res.createScanRes?.error?.code,
          passed: ok,
        });
      }

      recordTest(
        'PHASE2_SSRF',
        'Consistent SSRF & DNS Policy Across validate-target, site:create, and scan:create',
        ssrf3WayResults.every(r => r.passed) ? 'PASS' : 'FAIL',
        {
          totalVectors: ssrf3WayResults.length,
          passedVectors: ssrf3WayResults.filter(r => r.passed).length,
          failures: ssrf3WayResults.filter(r => !r.passed),
        },
      );

      // Reset rate-limit window before initiating real fixture scan
      await new Promise(r => setTimeout(r, 1100));

      // Adversarial testHooks / SSRF override rejection on a real existing siteId
      const adversarialExistingSiteRes = await window.evaluate(async sId => {
        return await window.electronAPI.createScanRun({
          siteId: sId,
          targetUrl: 'http://127.0.0.1:9898/',
          scanType: 'quick',
          config: {
            maxPages: 1,
            testHooks: { allowLoopbackInTests: true, pinnedIpOverride: '127.0.0.1' },
            pinnedIpOverride: '127.0.0.1',
            allowLoopbackInTests: true,
          },
        });
      }, testSiteId);
      recordTest(
        'PHASE2_SECURITY',
        'Adversarial testHooks/SSRF Override Rejected Even With Valid Site ID',
        adversarialExistingSiteRes?.success === false &&
          (adversarialExistingSiteRes?.error?.code === 'ERR_PAYLOAD_VALIDATION_FAILED' ||
            adversarialExistingSiteRes?.error?.code === 'ERR_SSRF_PROHIBITED_TARGET')
          ? 'PASS'
          : 'FAIL',
        adversarialExistingSiteRes,
      );

      await new Promise(r => setTimeout(r, 200));

      // 3. Full Unified Scan Lifecycle via production IPC
      const scanCreateRes = await window.evaluate(
        async ({ sId, port }) => {
          return await window.electronAPI.createScanRun({
            siteId: sId,
            targetUrl: `http://mock-audit-target.com:${port}/`,
            scanType: 'full',
            config: {
              maxPages: 3,
              maxDepth: 2,
              maxConcurrency: 1,
              requestTimeoutMs: 15000,
              maxDurationMs: 45000,
              enableBrowserAudit: true,
              maxBrowserPages: 3,
              captureScreenshots: true,
            },
          });
        },
        { sId: testSiteId, port: fixturePort },
      );
      testScanRunId = scanCreateRes.data?.id;

      recordTest(
        'PHASE2_AUDIT',
        'Scan Initiated via Production IPC with Browser & Screenshots Enabled',
        scanCreateRes.success ? 'PASS' : 'FAIL',
        {
          scanRunId: testScanRunId,
          status: scanCreateRes.data?.status,
          error: scanCreateRes.error,
        },
      );

      let terminalScan = null;
      for (let i = 0; i < 45; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const pollRes = await window.evaluate(async id => {
          return await window.electronAPI.getScanRun({ id });
        }, testScanRunId);
        const status = pollRes.data?.status;
        process.stdout.write('.');
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          terminalScan = pollRes.data;
          console.log(`\n[Audit] Scan reached terminal state: ${status}`);
          break;
        }
      }

      const coverageOk =
        terminalScan?.status === 'completed' &&
        (terminalScan?.summary?.pagesScanned ?? 0) >= 2 &&
        (terminalScan?.summary?.browserPagesAudited ?? 0) >= 1 &&
        (terminalScan?.summary?.screenshotsCaptured ?? 0) >= 16;

      recordTest(
        'PHASE2_AUDIT',
        'Unified Scan Completed with Coverage Accounting',
        coverageOk ? 'PASS' : 'FAIL',
        {
          scanRunId: testScanRunId,
          status: terminalScan?.status,
          durationMs: terminalScan?.durationMs,
          summary: terminalScan?.summary,
          error: terminalScan?.error,
        },
      );

      // 4. Findings persistence
      const findingsRes = await window.evaluate(async scanId => {
        return await window.electronAPI.listFindings({ scanRunId: scanId, limit: 100 });
      }, testScanRunId);
      const findings = findingsRes.data?.items || [];
      const categoriesFound = Array.from(new Set(findings.map(f => f.category)));

      recordTest(
        'PHASE2_AUDIT',
        'Findings Generated and Persisted across Categories',
        findings.length > 0 && categoriesFound.length >= 2 ? 'PASS' : 'FAIL',
        {
          totalFindings: findings.length,
          categories: categoriesFound,
          sampleRuleIds: findings.slice(0, 5).map(f => f.ruleId),
        },
      );

      // 5. Screenshot Storage on Disk + IPC Visual Evidence Retrieval
      const screenshotsDir = path.join(harnessUserDataDir, 'reports', 'screenshots');
      const screenshotFiles = fs.existsSync(screenshotsDir)
        ? fs.readdirSync(screenshotsDir).filter(f => f.endsWith('.png'))
        : [];
      let validPngHeader = false;
      let firstPngSize = 0;
      if (screenshotFiles.length > 0) {
        const firstPngPath = path.join(screenshotsDir, screenshotFiles[0]);
        const stat = fs.statSync(firstPngPath);
        firstPngSize = stat.size;
        const buf = Buffer.alloc(4);
        const fd = fs.openSync(firstPngPath, 'r');
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        validPngHeader =
          buf[0] === 0x89 &&
          buf[1] === 0x50 &&
          buf[2] === 0x4e &&
          buf[3] === 0x47 &&
          stat.size > 1000;
      }

      const visualEvidenceRes = await window.evaluate(async scanId => {
        return await window.electronAPI.getScanVisualEvidence({ scanRunId: scanId });
      }, testScanRunId);

      const visualEvidenceEntries = Object.values(visualEvidenceRes.data?.entries ?? {});
      const visualEvidenceCount = visualEvidenceEntries.filter(entry => entry.embedded).length;

      recordTest(
        'PHASE2_SCREENSHOTS',
        'Screenshots Captured, Stored in Isolated userData, and Retrieved via IPC',
        validPngHeader &&
          screenshotFiles.length >= 16 &&
          visualEvidenceRes.success &&
          visualEvidenceCount >= 16
          ? 'PASS'
          : 'FAIL',
        {
          screenshotsDir,
          diskScreenshotCount: screenshotFiles.length,
          firstPngSize,
          validPngHeader,
          ipcVisualEvidenceSuccess: visualEvidenceRes.success,
          ipcVisualEvidenceCount: visualEvidenceCount,
        },
      );

      // 6. Report Generation (HTML, JSON, CSV) & Retrieval via IPC
      const htmlReportRes = await window.evaluate(async scanId => {
        return await window.electronAPI.createReport({
          scanRunId: scanId,
          format: 'html',
          title: 'Packaged Verification HTML Report',
        });
      }, testScanRunId);
      testReportIdHtml = htmlReportRes.data?.id;
      const htmlPath = htmlReportRes.data?.storagePath;
      const htmlContent =
        htmlPath && fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
      const htmlValid =
        htmlReportRes.success &&
        htmlContent.includes('<!DOCTYPE html>') &&
        htmlContent.includes('Packaged Verification HTML Report');

      const jsonReportRes = await window.evaluate(async scanId => {
        return await window.electronAPI.createReport({
          scanRunId: scanId,
          format: 'json',
          title: 'Packaged Verification JSON Report',
        });
      }, testScanRunId);
      testReportIdJson = jsonReportRes.data?.id;
      const jsonPath = jsonReportRes.data?.storagePath;
      let jsonValid = false;
      if (jsonReportRes.success && jsonPath && fs.existsSync(jsonPath)) {
        const parsedJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        jsonValid = parsedJson.scanRun?.id === testScanRunId && Array.isArray(parsedJson.findings);
      }

      const csvReportRes = await window.evaluate(async scanId => {
        return await window.electronAPI.createReport({
          scanRunId: scanId,
          format: 'csv',
          title: 'Packaged Verification CSV Report',
        });
      }, testScanRunId);
      testReportIdCsv = csvReportRes.data?.id;
      const csvPath = csvReportRes.data?.storagePath;
      const csvContent = csvPath && fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : '';
      const csvLines = csvContent.trim().split(/\r?\n/);
      const csvValid = csvReportRes.success && csvLines.length >= 2 && csvLines[0].includes(',');

      const reportIpcRetrieval = await window.evaluate(async reportId => {
        const meta = await window.electronAPI.getReport({ id: reportId });
        const content = await window.electronAPI.getReportContent({ id: reportId });
        return {
          metaSuccess: meta.success,
          contentSuccess: content.success,
          contentLength: content.data?.content?.length ?? 0,
        };
      }, testReportIdHtml);

      recordTest(
        'PHASE2_REPORTS',
        'HTML, JSON, and CSV Reports Generated and Retrieved via IPC',
        htmlValid &&
          jsonValid &&
          csvValid &&
          reportIpcRetrieval.metaSuccess &&
          reportIpcRetrieval.contentSuccess &&
          reportIpcRetrieval.contentLength > 0
          ? 'PASS'
          : 'FAIL',
        {
          htmlValid,
          jsonValid,
          csvValid,
          csvLineCount: csvLines.length,
          reportIpcRetrieval,
        },
      );

      // 7. Quick Cancellation Check via Production IPC
      const cancelFlow = await window.evaluate(
        async ({ sId, port }) => {
          const run = await window.electronAPI.createScanRun({
            siteId: sId,
            targetUrl: `http://mock-audit-target.com:${port}/`,
            scanType: 'full',
            config: { maxPages: 10, maxDurationMs: 60000 },
          });
          if (!run?.success || !run?.data?.id) {
            return { runCreated: false, error: run?.error };
          }
          const cancelRes = await window.electronAPI.cancelScanRun({ id: run.data.id });
          return { runCreated: true, cancelRes };
        },
        { sId: testSiteId, port: fixturePort },
      );

      recordTest(
        'PHASE2_RECOVERY',
        'Scan Cancellation via Production IPC Handled Cleanly',
        Boolean(cancelFlow.cancelRes?.success) ? 'PASS' : 'FAIL',
        cancelFlow,
      );
    } finally {
      await harnessApp.close();
    }

    // 8. Seed a synthetic interrupted 'running' scan in isolated DB before restart
    interruptedScanId = crypto.randomUUID();
    {
      const { db } = openIsolatedSqlite(harnessUserDataDir, { readonly: false });
      try {
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO scan_runs (
            id, site_id, scan_type, status, target_url, config_json, started_at, created_at, updated_at
          ) VALUES (?, ?, 'full', 'running', ?, '{}', ?, ?, ?)`,
        ).run(
          interruptedScanId,
          testSiteId,
          `http://mock-audit-target.com:${fixturePort}/`,
          now,
          now,
          now,
        );
      } finally {
        db.close();
      }
    }

    // 9. Relaunch Isolated Composition Root to verify Restart Persistence & Crash Recovery
    const relaunchApp = await _electron.launch({
      executablePath: electronExe,
      args: [harnessAppDir],
      env: {
        ...process.env,
        AUDITOR_USER_DATA_DIR: harnessUserDataDir,
      },
      timeout: 30000,
    });

    try {
      const win2 = await relaunchApp.firstWindow({ timeout: 15000 });
      const persistenceCheck = await win2.evaluate(
        async ({ pId, sId, scanId, rHtml, rJson, rCsv, intId }) => {
          const projects = await window.electronAPI.listProjects();
          const sites = await window.electronAPI.listSites({ projectId: pId });
          const scan = await window.electronAPI.getScanRun({ id: scanId });
          const findings = await window.electronAPI.listFindings({ scanRunId: scanId, limit: 100 });
          const reports = await window.electronAPI.listReports();
          const recovered = await window.electronAPI.getScanRun({ id: intId });

          const reportIds = new Set((reports.data?.items || []).map(r => r.id));
          return {
            foundProject: (projects.data?.items || []).some(p => p.id === pId),
            foundSite: (sites.data?.items || []).some(s => s.id === sId),
            foundScan: scan.success && scan.data?.id === scanId,
            scanStatus: scan.data?.status,
            findingsCount: (findings.data?.items || []).length,
            foundReports: reportIds.has(rHtml) && reportIds.has(rJson) && reportIds.has(rCsv),
            recoveredStatus: recovered.data?.status,
            recoveredErrorCode: recovered.data?.error?.code,
          };
        },
        {
          pId: testProjectId,
          sId: testSiteId,
          scanId: testScanRunId,
          rHtml: testReportIdHtml,
          rJson: testReportIdJson,
          rCsv: testReportIdCsv,
          intId: interruptedScanId,
        },
      );

      recordTest(
        'PHASE2_RECOVERY',
        'Interrupted-Scan Recovery Transitioned Orphaned Scan to Failed on Startup',
        persistenceCheck.recoveredStatus === 'failed' &&
          persistenceCheck.recoveredErrorCode === 'ERR_SCAN_INTERRUPTED_BY_SHUTDOWN'
          ? 'PASS'
          : 'FAIL',
        {
          interruptedScanId,
          recoveredStatus: persistenceCheck.recoveredStatus,
          recoveredErrorCode: persistenceCheck.recoveredErrorCode,
        },
      );

      const allPersisted =
        persistenceCheck.foundProject &&
        persistenceCheck.foundSite &&
        persistenceCheck.foundScan &&
        persistenceCheck.findingsCount > 0 &&
        persistenceCheck.foundReports;

      recordTest(
        'PHASE2_PERSISTENCE',
        'Restart Persistence Verified for Projects, Sites, Scans, Findings, and Reports',
        allPersisted ? 'PASS' : 'FAIL',
        persistenceCheck,
      );
    } finally {
      await relaunchApp.close();
    }

    const finalDbCheck = inspectSqliteOnDisk(harnessUserDataDir);
    recordTest(
      'PHASE2_PERSISTENCE',
      'Final Isolated SQLite Integrity Verified After Restart',
      finalDbCheck.journalMode === 'wal' &&
        finalDbCheck.quickCheckOk &&
        finalDbCheck.integrityCheckOk
        ? 'PASS'
        : 'FAIL',
      {
        journalMode: finalDbCheck.journalMode,
        quickCheckOk: finalDbCheck.quickCheckOk,
        integrityCheckOk: finalDbCheck.integrityCheckOk,
      },
    );
  } finally {
    await new Promise(resolve => fixtureServer.close(() => resolve()));
    fs.rmSync(harnessAppDir, { recursive: true, force: true });
    console.log('[Fixture] Local HTTP test fixture server stopped and harness dir cleaned.');
  }

  const resultsPath = path.resolve(TMP_ROOT, 'packaged-runtime-verification-results.json');
  fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
  fs.writeFileSync(resultsPath, JSON.stringify(TEST_RESULTS, null, 2), 'utf8');

  console.log(`\n======================================================================`);
  console.log(` POST-HARDENING VERIFICATION COMPLETE`);
  console.log(
    ` Total Checks: ${TEST_RESULTS.summary.totalTests} | Passed: ${TEST_RESULTS.summary.passed} | Failed: ${TEST_RESULTS.summary.failed}`,
  );
  console.log(` Results JSON written to: ${resultsPath}`);
  console.log(`======================================================================\n`);

  if (TEST_RESULTS.summary.failed > 0) {
    process.exit(1);
  }
  return TEST_RESULTS;
}

runVerification().catch(err => {
  console.error('Packaged runtime verification runner failed:', err);
  process.exit(1);
});
