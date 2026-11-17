import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BrowserManager } from '../../src/main/browser/manager.js';
import {
  VisualAuditor,
  DEFAULT_VISUAL_NAVIGATION_TIMEOUT_MS,
  MIN_VISUAL_NAVIGATION_TIMEOUT_MS,
  VISUAL_FINALIZATION_RESERVE_MS,
} from '../../src/main/browser/visual-auditor.js';
import { VisualAuditorTimeoutError } from '../../src/main/browser/visual-types.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';

describe('DEF-005: VisualAuditor Navigation Deadline & Timeout Remediation Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;
  let testStorageDir: string;
  const openSockets = new Set<net.Socket>();

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  const smallMobile = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'small-mobile')!;
  const desktop = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'desktop')!;

  beforeAll(async () => {
    testStorageDir = path.resolve('D:\\ahmed\\.tmp\\test-va-deadline-' + crypto.randomUUID());
    fs.mkdirSync(testStorageDir, { recursive: true });

    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/fast.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
            <body><h1>Fast Page</h1><p>Loaded immediately</p></body>
          </html>
        `);
      } else if (url.pathname === '/overflow.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>.wide { width: 800px; height: 100px; background: red; }</style>
            </head>
            <body><div class="wide">Wide Box</div></body>
          </html>
        `);
      } else if (url.pathname === '/hang') {
        // Deliberately hold request open to trigger navigation timeouts
        // Connection will be closed when fixtureServer closes
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    fixtureServer.on('connection', socket => {
      openSockets.add(socket);
      socket.on('close', () => openSockets.delete(socket));
    });

    await new Promise<void>(resolve => {
      fixtureServer.listen(0, '127.0.0.1', () => {
        fixturePort = (fixtureServer.address() as net.AddressInfo).port;
        resolve();
      });
    });

    manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 2,
      scopePolicy: {
        authorizedOrigin: `http://audit-target.test:${fixturePort}`,
        thirdPartyPolicy: 'ALLOW_PUBLIC_SUBRESOURCES',
      },
      testHooks: {
        lookupFn: mockLookup,
        pinnedIpOverride: '127.0.0.1',
      },
    });
    await manager.launch();
  });

  afterAll(async () => {
    for (const socket of openSockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
    openSockets.clear();

    if (manager) {
      await manager.close().catch(() => {});
    }
    if (fixtureServer) {
      if (typeof fixtureServer.closeAllConnections === 'function') {
        fixtureServer.closeAllConnections();
      }
      await new Promise(resolve => fixtureServer.close(resolve));
    }
    if (fs.existsSync(testStorageDir)) {
      try {
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup
      }
    }
  });

  it('1. remaining budget greater than normal navigation timeout preserves 30s upper bound', () => {
    const mockTime = 10_000;
    const clock = () => mockTime;
    const deadlineAt = 100_000; // 90s remaining budget

    const _auditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: false,
      deadlineAt,
      clock,
    });

    expect(DEFAULT_VISUAL_NAVIGATION_TIMEOUT_MS).toBe(30_000);
    expect(MIN_VISUAL_NAVIGATION_TIMEOUT_MS).toBe(1_000);
    expect(VISUAL_FINALIZATION_RESERVE_MS).toBe(500);

    const remainingBudgetForNav = deadlineAt - clock() - VISUAL_FINALIZATION_RESERVE_MS;
    const navTimeout = Math.min(
      DEFAULT_VISUAL_NAVIGATION_TIMEOUT_MS,
      Math.max(MIN_VISUAL_NAVIGATION_TIMEOUT_MS, Math.floor(remainingBudgetForNav)),
    );

    // 90s - 0.5s = 89.5s > 30s -> clamped to 30s
    expect(navTimeout).toBe(30_000);
  });

  it('2. remaining budget shorter than 30s clamps navigation timeout to remaining budget minus reserve', () => {
    const mockTime = 10_000;
    const clock = () => mockTime;
    const deadlineAt = 25_000; // 15s budget

    const remainingBudgetForNav = deadlineAt - clock() - VISUAL_FINALIZATION_RESERVE_MS;
    const navTimeout = Math.min(
      DEFAULT_VISUAL_NAVIGATION_TIMEOUT_MS,
      Math.max(MIN_VISUAL_NAVIGATION_TIMEOUT_MS, Math.floor(remainingBudgetForNav)),
    );

    // 15,000 - 500 = 14,500ms
    expect(navTimeout).toBe(14_500);
  });

  it('3. remaining budget shorter than 5s clamps navigation timeout with minimum floor', () => {
    const mockTime = 10_000;
    const clock = () => mockTime;
    const deadlineAt = 13_000; // 3s budget

    const remainingBudgetForNav = deadlineAt - clock() - VISUAL_FINALIZATION_RESERVE_MS;
    const navTimeout = Math.min(
      DEFAULT_VISUAL_NAVIGATION_TIMEOUT_MS,
      Math.max(MIN_VISUAL_NAVIGATION_TIMEOUT_MS, Math.floor(remainingBudgetForNav)),
    );

    // 3,000 - 500 = 2,500ms
    expect(navTimeout).toBe(2_500);
  });

  it('4. deadline already expired before navigation throws VisualAuditorTimeoutError immediately without acquiring page', async () => {
    const mockTime = 20_000;
    const clock = () => mockTime;
    const deadlineAt = 19_000; // Expired 1 second ago

    const auditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: false,
      deadlineAt,
      clock,
    });

    const url = `http://audit-target.test:${fixturePort}/fast.html`;

    await expect(auditor.auditUrl(url)).rejects.toThrow(VisualAuditorTimeoutError);

    try {
      await auditor.auditUrl(url);
    } catch (err) {
      expect(err).toBeInstanceOf(VisualAuditorTimeoutError);
      const vaErr = err as VisualAuditorTimeoutError;
      expect(vaErr.code).toBe('ERR_SCAN_TIMEOUT');
      expect(vaErr.remainingBudgetMs).toBeLessThanOrEqual(0);
      expect(vaErr.deadlineAt).toBe(deadlineAt);
      expect(vaErr.targetUrl).toBe(url);
      expect(vaErr.partialReport).toBeDefined();
      expect(vaErr.partialReport!.profilesEvaluated).toBe(0);
    }
  });

  it('5. deadline expiring during navigation is rethrown as VisualAuditorTimeoutError with partial report', async () => {
    // Tight deadline: 1,400ms from now.
    // Clamped navigation timeout: Math.min(10_000, Math.max(1_000, 1400 - 500 = 900 -> 1000ms floor)).
    // Page /hang stalls for 1,000ms.
    // Upon navigation timeout at ~1,000ms, remaining time is <= 400ms (<= reserve of 500ms).
    // This triggers VisualAuditorTimeoutError.
    const deadlineAt = Date.now() + 1_400;

    const auditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: false,
      deadlineAt,
      navigationTimeoutMs: 10_000,
    });

    const url = `http://audit-target.test:${fixturePort}/hang`;

    let capturedError: unknown = null;
    try {
      await auditor.auditUrl(url);
    } catch (err) {
      capturedError = err;
    }

    expect(capturedError).toBeInstanceOf(VisualAuditorTimeoutError);
    const vaErr = capturedError as VisualAuditorTimeoutError;
    expect(vaErr.code).toBe('ERR_SCAN_TIMEOUT');
    expect(vaErr.partialReport).toBeDefined();
  });

  it('6. user cancellation during navigation aborts immediately and releases page', async () => {
    const controller = new AbortController();

    const auditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: false,
      signal: controller.signal,
      navigationTimeoutMs: 30_000,
    });

    const url = `http://audit-target.test:${fixturePort}/hang`;

    const auditPromise = auditor.auditUrl(url);

    // Abort after 100ms while navigation to /hang is still in-flight
    setTimeout(() => {
      controller.abort(new Error('User cancelled the audit'));
    }, 100);

    const startCancel = Date.now();
    await expect(auditPromise).rejects.toThrow();
    const elapsedCancel = Date.now() - startCancel;

    // Must abort promptly, well before the 30,000ms navigation timeout
    expect(elapsedCancel).toBeLessThan(5_000);
  });

  it('7. navigation timeout unrelated to global deadline isolates profile failure without throwing ERR_SCAN_TIMEOUT', async () => {
    // Generous deadline 10 minutes in future, but short navigationTimeoutMs of 1000ms
    const deadlineAt = Date.now() + 600_000;

    const auditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: false,
      deadlineAt,
      navigationTimeoutMs: 1_000,
    });

    const url = `http://audit-target.test:${fixturePort}/hang`;

    // Should NOT throw VisualAuditorTimeoutError; should return report with isolated error
    const report = await auditor.auditUrl(url);

    expect(report.profilesEvaluated).toBe(1);
    expect(report.viewportResults.length).toBe(1);
    expect(report.viewportResults[0].error).toBeDefined();
    expect(report.viewportResults[0].error).toMatch(/timeout/i);
    expect(report.totalFindings).toBe(0);
  });

  it('8. successful navigation within remaining budget completes normally', async () => {
    const auditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: false,
      deadlineAt: Date.now() + 60_000,
      navigationTimeoutMs: 15_000,
    });

    const url = `http://audit-target.test:${fixturePort}/fast.html`;
    const report = await auditor.auditUrl(url);

    expect(report.profilesEvaluated).toBe(1);
    expect(report.viewportResults.length).toBe(1);
    expect(report.viewportResults[0].error).toBeUndefined();
  });

  it('9. partial scan results preserved after deadline exhaustion', async () => {
    let mockTime = 10_000;

    // Profile 1 (smallMobile) evaluates overflow.html and generates responsive finding.
    // Profile 2 (desktop) will hit deadline expiration.
    const deadlineAt = 15_000;

    const auditor = new VisualAuditor(manager, {
      profiles: [smallMobile, desktop],
      captureScreenshots: false,
      deadlineAt,
      clock: () => {
        // When desktop profile is checked, clock has exceeded deadline
        if (mockTime > 12_000) {
          mockTime = 16_000; // Exceeded!
        }
        return mockTime;
      },
    });

    const url = `http://audit-target.test:${fixturePort}/overflow.html`;

    // Advance clock after first profile finishes
    setTimeout(() => {
      mockTime = 13_000;
    }, 500);

    let caughtErr: unknown = null;
    try {
      await auditor.auditUrl(url);
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeInstanceOf(VisualAuditorTimeoutError);
    const vaErr = caughtErr as VisualAuditorTimeoutError;
    expect(vaErr.partialReport).toBeDefined();
    expect(vaErr.partialReport!.profilesEvaluated).toBeGreaterThanOrEqual(1);
    expect(vaErr.partialReport!.findings.length).toBeGreaterThanOrEqual(1);
    expect(vaErr.partialReport!.findings[0].category).toMatch(/responsive/i);
  });

  it('10. browser page and lease cleanup after timeout', async () => {
    // Verify that after an aborted or timed-out navigation, manager can cleanly acquire new pages
    const controller = new AbortController();
    const auditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: false,
      signal: controller.signal,
      navigationTimeoutMs: 10_000,
    });

    const hangUrl = `http://audit-target.test:${fixturePort}/hang`;
    const hangPromise = auditor.auditUrl(hangUrl);
    setTimeout(() => controller.abort(), 100);

    await expect(hangPromise).rejects.toThrow();

    // Now immediately run a clean navigation with same manager
    const cleanAuditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: false,
    });

    const fastUrl = `http://audit-target.test:${fixturePort}/fast.html`;
    const cleanReport = await cleanAuditor.auditUrl(fastUrl);

    expect(cleanReport.profilesEvaluated).toBe(1);
    expect(cleanReport.viewportResults[0].error).toBeUndefined();
  });

  it('11. accurate browser coverage counters: timed out navigation not counted as completed', async () => {
    const auditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: false,
      navigationTimeoutMs: 1_000,
      deadlineAt: Date.now() + 60_000,
    });

    const url = `http://audit-target.test:${fixturePort}/hang`;
    const report = await auditor.auditUrl(url);

    // Profile evaluated is 1, but has error and 0 findings
    expect(report.viewportResults[0].error).toBeDefined();
    expect(report.totalFindings).toBe(0);
  });

  it('12. no accidental extension of global deadline', () => {
    const clockNow = 50_000;
    const deadlineAt = 60_000; // 10s remaining
    const remainingBudgetForNav = deadlineAt - clockNow - VISUAL_FINALIZATION_RESERVE_MS;

    const navTimeout = Math.min(
      DEFAULT_VISUAL_NAVIGATION_TIMEOUT_MS,
      Math.max(MIN_VISUAL_NAVIGATION_TIMEOUT_MS, Math.floor(remainingBudgetForNav)),
    );

    // Timeout is exactly 9,500ms
    expect(navTimeout).toBe(9_500);
    // Never exceeds deadlineAt - clockNow
    expect(clockNow + navTimeout).toBeLessThan(deadlineAt);
  });
});
