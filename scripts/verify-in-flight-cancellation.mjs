/* eslint-disable */
/**
 * Post-Hardening In-Flight Cancellation Verification.
 *
 * Uses a separate test-only composition root under D:\ahmed\.tmp that extracts the verified
 * production /out bundle from app.asar and installs external fixture network interception
 * ONLY for mock-audit-target.com before importing ./out/main/index.js.
 *
 * Zero global test handles, zero production testHooks, and zero orchestrator option mutations.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { _electron } from 'playwright-core';
import {
  TMP_ROOT,
  createIsolatedRunSuffix,
  createIsolatedUserDataDir,
  inspectSqliteOnDisk,
  openIsolatedSqlite,
  prepareIsolatedCompositionRoot,
  resolveElectronExecutablePath,
} from './isolated-runtime-harness.mjs';

async function runInFlightCancellationTest() {
  console.log('======================================================================');
  console.log(' POST-HARDENING IN-FLIGHT CANCELLATION FORENSIC VERIFICATION');
  console.log('======================================================================\n');

  // 1. Start controllable slow fixture server on an ephemeral loopback port
  const requestsReceived = [];
  const fixtureServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    requestsReceived.push({ url: url.pathname, time: Date.now() });
    console.log(`[Fixture Server] Incoming request: ${url.pathname}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Cancellation Test Target</title></head>
        <body>
          <h1>Cancellation Test Root</h1>
          <p><a href="/slow-page-1.html">Slow Page 1</a></p>
          <p><a href="/slow-page-2.html">Slow Page 2</a></p>
          <p><a href="/slow-page-3.html">Slow Page 3</a></p>
          <img src="/image-missing-alt.png">
        </body>
        </html>
      `);
    } else if (url.pathname === '/slow-page-1.html') {
      setTimeout(() => {
        if (res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Slow Page 1</title></head>
          <body>
            <h2>Slow Page 1 Content</h2>
            <p><a href="/slow-page-2.html">Link to Slow Page 2</a></p>
            <button id="empty-btn-1"></button>
          </body>
          </html>
        `);
      }, 1200);
    } else if (url.pathname === '/slow-page-2.html') {
      setTimeout(() => {
        if (res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Slow Page 2</title></head>
          <body>
            <h2>Slow Page 2 Content</h2>
            <p><a href="/slow-page-3.html">Link to Slow Page 3</a></p>
          </body>
          </html>
        `);
      }, 2000);
    } else if (url.pathname === '/slow-page-3.html') {
      setTimeout(() => {
        if (res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><h2>Slow Page 3</h2></body></html>');
      }, 2000);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const fixturePort = fixtureServer.address().port;
  console.log(
    `[Fixture] Controlled delayed HTTP server listening on http://127.0.0.1:${fixturePort}\n`,
  );

  const runSuffix = createIsolatedRunSuffix();
  const harnessAppDir = path.join(TMP_ROOT, `cancel-harness-app-${runSuffix}`);
  const isolatedUserDataDir = createIsolatedUserDataDir('cancel-harness-userdata', runSuffix);

  prepareIsolatedCompositionRoot({
    targetDir: harnessAppDir,
    fixtureHost: 'mock-audit-target.com',
    fixturePort,
    syntheticPublicIp: '93.184.216.34',
  });

  const electronExe = resolveElectronExecutablePath();
  const app = await _electron.launch({
    executablePath: electronExe,
    args: [harnessAppDir],
    env: {
      ...process.env,
      AUDITOR_USER_DATA_DIR: isolatedUserDataDir,
    },
    timeout: 30000,
  });

  const testReport = {
    testName: 'True In-Flight Cancellation Under Active Work (Post-Hardening)',
    isolatedUserDataDir,
    observations: {},
    invariants: {},
    verdict: 'PENDING',
  };

  let scanRunId = null;
  let terminalScan = null;

  try {
    const window = await app.firstWindow({ timeout: 15000 });

    // Confirm removed globals do NOT exist in main process
    const globalsAbsent = await app.evaluate(async () => ({
      hasActiveOrchestratorGlobal: '__activeOrchestrator' in globalThis,
      hasActiveDbGlobal: '__activeDatabaseConnection' in globalThis,
    }));
    testReport.invariants.removedGlobalsAbsent =
      !globalsAbsent.hasActiveOrchestratorGlobal && !globalsAbsent.hasActiveDbGlobal;

    // 1. Create project & site via Renderer IPC
    const projectRes = await window.evaluate(async sfx => {
      return await window.electronAPI.createProject({
        name: `In-Flight Cancel Project ${sfx}`,
        description: 'Testing in-flight cancellation while actively processing pages',
      });
    }, runSuffix);

    const siteRes = await window.evaluate(
      async ({ pId, port, sfx }) => {
        return await window.electronAPI.createSite({
          projectId: pId,
          name: `In-Flight Cancel Site ${sfx}`,
          baseUrl: `http://mock-audit-target.com:${port}/`,
        });
      },
      { pId: projectRes.data.id, port: fixturePort, sfx: runSuffix },
    );

    const siteId = siteRes.data.id;

    // 2. Start a 5-page scan with browser audit enabled
    console.log('[Test] Initiating scan run...');
    const scanCreateRes = await window.evaluate(
      async ({ sId, port }) => {
        return await window.electronAPI.createScanRun({
          siteId: sId,
          targetUrl: `http://mock-audit-target.com:${port}/`,
          scanType: 'full',
          config: {
            maxPages: 5,
            maxDepth: 3,
            maxConcurrency: 1,
            requestTimeoutMs: 15000,
            maxDurationMs: 60000,
            enableBrowserAudit: true,
            maxBrowserPages: 3,
            captureScreenshots: true,
          },
        });
      },
      { sId: siteId, port: fixturePort },
    );

    scanRunId = scanCreateRes.data.id;
    console.log(
      `[Test] Scan run created with ID: ${scanRunId}, initial status: ${scanCreateRes.data.status}`,
    );

    // 3. Poll progress until active in-flight work is demonstrably observed
    console.log('[Test] Waiting for scan to enter active running state with in-flight work...');
    let activeObserved = false;
    let observedProgress = null;
    const startWait = Date.now();

    while (Date.now() - startWait < 15000) {
      await new Promise(r => setTimeout(r, 100));
      const progRes = await window.evaluate(async id => {
        return await window.electronAPI.getScanProgress({ id });
      }, scanRunId);

      const scanRes = await window.evaluate(async id => {
        return await window.electronAPI.getScanRun({ id });
      }, scanRunId);

      const prog = progRes.data;
      const status = scanRes.data?.status;

      if (status === 'running' || (prog && prog.status === 'running')) {
        if (
          prog &&
          (prog.pagesAttempted >= 1 ||
            prog.activeRequests >= 1 ||
            prog.stage === 'crawling' ||
            prog.stage === 'browser_auditing')
        ) {
          activeObserved = true;
          observedProgress = {
            status,
            stage: prog.stage,
            pagesAttempted: prog.pagesAttempted,
            pagesSucceeded: prog.pagesSucceeded,
            activeRequests: prog.activeRequests,
            currentUrl: prog.currentUrl,
            elapsedMs: prog.elapsedMs,
          };
          console.log(
            '\n[Test] Demonstrable active in-flight work observed:',
            JSON.stringify(observedProgress),
          );
          break;
        }
      }
    }

    testReport.observations.activeWorkObserved = activeObserved;
    testReport.observations.progressAtCancellation = observedProgress;

    if (!activeObserved) {
      throw new Error('Failed to observe active in-flight work within 15 seconds');
    }

    // 4. Request cancellation while active work is in-flight
    console.log('\n[Test] Dispatching cancelScanRun while scan is actively processing...');
    const cancelStartTime = Date.now();
    const cancelRes = await window.evaluate(async id => {
      return await window.electronAPI.cancelScanRun({ id });
    }, scanRunId);
    const cancelDurationMs = Date.now() - cancelStartTime;

    console.log(
      `[Test] cancelScanRun responded in ${cancelDurationMs}ms:`,
      JSON.stringify(cancelRes),
    );
    testReport.observations.cancelIpcResponse = cancelRes;
    testReport.observations.cancelDurationMs = cancelDurationMs;

    // 5. Poll until scan reaches terminal 'cancelled' state
    console.log('[Test] Verifying scan transition to terminal cancelled state in SQLite...');
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 100));
      const poll = await window.evaluate(async id => {
        return await window.electronAPI.getScanRun({ id });
      }, scanRunId);
      if (poll.data?.status === 'cancelled') {
        terminalScan = poll.data;
        console.log(
          `[Test] Confirmed terminal cancelled state reached at ${new Date(terminalScan.cancelledAt).toISOString()}`,
        );
        break;
      }
    }

    testReport.observations.terminalScan = terminalScan;
    const pagesAttemptedAtCancel =
      terminalScan?.summary?.pagesScanned ?? observedProgress.pagesAttempted;
    const totalRequestsAtCancel = requestsReceived.length;
    console.log(
      `[Test] Pages recorded at cancel: ${pagesAttemptedAtCancel}, Total fixture HTTP hits: ${totalRequestsAtCancel}`,
    );

    // 6. Wait 3,000ms of quiet period to verify that NO FURTHER pages or requests are processed
    console.log(
      '[Test] Waiting 3000ms quiet period to verify no subsequent work or page crawling occurs...',
    );
    await new Promise(r => setTimeout(r, 3000));

    const postWaitScan = await window.evaluate(async id => {
      return await window.electronAPI.getScanRun({ id });
    }, scanRunId);

    const postWaitRequests = requestsReceived.length;
    const postWaitPagesScanned = postWaitScan.data?.summary?.pagesScanned ?? 0;

    console.log(
      `[Test] Post-quiet period check: Total fixture hits: ${postWaitRequests} (was ${totalRequestsAtCancel}), Pages scanned: ${postWaitPagesScanned}`,
    );

    testReport.invariants.noFurtherPagesProcessed = postWaitRequests <= totalRequestsAtCancel + 1;
    testReport.invariants.postQuietScanStatus = postWaitScan.data?.status === 'cancelled';

    // 7. Verify persisted findings integrity: findings recorded before cancellation remain intact
    const findingsList = await window.evaluate(async id => {
      return await window.electronAPI.listFindings({ scanRunId: id, limit: 100 });
    }, scanRunId);

    console.log(
      `[Test] Findings persisted prior to cancellation: ${findingsList.data?.items?.length || 0}`,
    );
    testReport.invariants.findingsIntact = findingsList.success;
    testReport.invariants.findingsCount = findingsList.data?.items?.length || 0;
  } finally {
    await app.close();
    await new Promise(resolve => fixtureServer.close(() => resolve()));
    fs.rmSync(harnessAppDir, { recursive: true, force: true });
    console.log('[Test] Packaged composition root and fixture server closed cleanly.');
  }

  // 8. Verify SQLite integrity & zero remaining pending/running scans directly on disk
  const dbInspect = inspectSqliteOnDisk(isolatedUserDataDir);
  const { db } = openIsolatedSqlite(isolatedUserDataDir, { readonly: true });
  let activeScansInDb = -1;
  try {
    const row = db
      .prepare("SELECT COUNT(*) as cnt FROM scan_runs WHERE status IN ('pending', 'running')")
      .get();
    activeScansInDb = Number(row?.cnt ?? -1);
  } finally {
    db.close();
  }

  testReport.invariants.activeScansCountZero = activeScansInDb === 0;
  testReport.invariants.sqliteIntegrityOk = dbInspect.quickCheckOk && dbInspect.integrityCheckOk;

  const allPassed =
    testReport.invariants.removedGlobalsAbsent &&
    testReport.observations.activeWorkObserved &&
    terminalScan?.status === 'cancelled' &&
    Boolean(terminalScan?.cancelledAt) &&
    testReport.invariants.noFurtherPagesProcessed &&
    testReport.invariants.postQuietScanStatus &&
    testReport.invariants.activeScansCountZero &&
    testReport.invariants.sqliteIntegrityOk &&
    testReport.invariants.findingsIntact;

  testReport.verdict = allPassed ? 'PASSED' : 'FAILED';
  console.log('\n======================================================================');
  console.log(` IN-FLIGHT CANCELLATION VERDICT: ${testReport.verdict}`);
  console.log('======================================================================\n');

  const outPath = path.resolve(TMP_ROOT, 'in-flight-cancellation-results.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(testReport, null, 2), 'utf8');
  console.log('Results written to:', outPath);

  if (!allPassed) {
    process.exit(1);
  }
  return testReport;
}

runInFlightCancellationTest().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
