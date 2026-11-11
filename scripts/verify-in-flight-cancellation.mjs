/* eslint-disable */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { _electron } from 'playwright-core';

async function runInFlightCancellationTest() {
  const exePath = path.resolve(
    'apps/desktop/dist/win-unpacked/Ultimate WordPress & Website Auditor.exe',
  );
  console.log('======================================================================');
  console.log(' IN-FLIGHT CANCELLATION FORENSIC VERIFICATION');
  console.log(' Target Executable:', exePath);
  console.log('======================================================================\n');

  if (!fs.existsSync(exePath)) {
    throw new Error(`Executable not found at ${exePath}`);
  }

  // 1. Start controllable slow fixture server
  const fixturePort = 9899;
  let requestsReceived = [];
  const fixtureServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${fixturePort}`);
    requestsReceived.push({ url: url.pathname, time: Date.now() });
    console.log(`[Fixture Server] Incoming request: ${url.pathname}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      // Entry page with links to slow pages
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
      // Delay 1200ms before responding
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
      // Delay 2000ms before responding
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
      // Delay 2000ms
      setTimeout(() => {
        if (res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><body><h2>Slow Page 3</h2></body></html>`);
      }, 2000);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  await new Promise(resolve => fixtureServer.listen(fixturePort, '127.0.0.1', resolve));
  console.log(
    `[Fixture] Controlled delayed HTTP server listening on http://127.0.0.1:${fixturePort}\n`,
  );

  const app = await _electron.launch({
    executablePath: exePath,
    timeout: 30000,
  });

  const testReport = {
    testName: 'True In-Flight Cancellation Under Active Work',
    observations: {},
    invariants: {},
    verdict: 'PENDING',
  };

  try {
    const window = await app.firstWindow({ timeout: 15000 });

    // Configure testHooks in main process for loopback fixture
    await app.evaluate(async port => {
      const orchestrator = globalThis.__activeOrchestrator;
      if (orchestrator) {
        orchestrator.options.testHooks = {
          lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
          pinnedIpOverride: '127.0.0.1',
          allowLoopbackInTests: true,
        };
      }
    }, fixturePort);

    // 1. Create project & site via Renderer IPC
    const suffix = Date.now().toString(36);
    const projectRes = await window.evaluate(async sfx => {
      return await window.electronAPI.createProject({
        name: `In-Flight Cancel Project ${sfx}`,
        description: 'Testing in-flight cancellation while actively processing pages',
      });
    }, suffix);

    const siteRes = await window.evaluate(
      async ({ pId, port, sfx }) => {
        return await window.electronAPI.createSite({
          projectId: pId,
          name: `In-Flight Cancel Site ${sfx}`,
          baseUrl: `http://mock-audit-target.com:${port}/`,
        });
      },
      { pId: projectRes.data.id, port: fixturePort, sfx: suffix },
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

    const scanRunId = scanCreateRes.data.id;
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
        // Check for demonstrable active work: crawling started, pages attempted, or active requests
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
    let terminalScan = null;
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

    const noFurtherRequestsProcessed = postWaitRequests <= totalRequestsAtCancel + 1; // max 1 in-flight abort
    testReport.invariants.noFurtherPagesProcessed = noFurtherRequestsProcessed;
    testReport.invariants.postQuietScanStatus = postWaitScan.data?.status === 'cancelled';

    // 7. Verify main process resource cleanup and page leases
    const resourceCleanup = await app.evaluate(async () => {
      const orchestrator = globalThis.__activeOrchestrator;
      const db = globalThis.__activeDatabaseConnection;
      return {
        activeScansCount: orchestrator ? orchestrator.getActiveScans().length : -1,
        quickCheckOk: db ? db.quickCheck().ok : false,
      };
    });

    console.log('[Test] Main process resource cleanup check:', JSON.stringify(resourceCleanup));
    testReport.invariants.activeScansCountZero = resourceCleanup.activeScansCount === 0;
    testReport.invariants.sqliteIntegrityOk = resourceCleanup.quickCheckOk;

    // 8. Verify persisted findings integrity: findings recorded before cancellation remain intact
    const findingsList = await window.evaluate(async id => {
      return await window.electronAPI.listFindings({ scanRunId: id, limit: 100 });
    }, scanRunId);

    console.log(
      `[Test] Findings persisted prior to cancellation: ${findingsList.data?.items?.length || 0}`,
    );
    testReport.invariants.findingsIntact = findingsList.success;
    testReport.invariants.findingsCount = findingsList.data?.items?.length || 0;

    // Determine final verdict
    const allPassed =
      testReport.observations.activeWorkObserved &&
      terminalScan?.status === 'cancelled' &&
      Boolean(terminalScan?.cancelledAt) &&
      testReport.invariants.noFurtherPagesProcessed &&
      testReport.invariants.activeScansCountZero &&
      testReport.invariants.sqliteIntegrityOk &&
      testReport.invariants.findingsIntact;

    testReport.verdict = allPassed ? 'PASSED' : 'FAILED';
    console.log('\n======================================================================');
    console.log(` IN-FLIGHT CANCELLATION VERDICT: ${testReport.verdict}`);
    console.log('======================================================================\n');
  } finally {
    await app.close();
    fixtureServer.close();
    console.log('[Test] Packaged application and fixture server closed cleanly.');
  }

  const outPath = path.resolve('D:/ahmed/.tmp/in-flight-cancellation-results.json');
  fs.writeFileSync(outPath, JSON.stringify(testReport, null, 2));
  console.log('Results written to:', outPath);
  return testReport;
}

runInFlightCancellationTest().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
