import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { VisualAuditor } from '../../src/main/browser/visual-auditor.js';
import { ScreenshotManager } from '../../src/main/browser/screenshot-manager.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';

describe('Visual Auditor Security Invariants & SSRF Regression Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;
  let testStorageDir: string;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const desktop = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'desktop')!;

  beforeAll(async () => {
    testStorageDir = path.resolve('D:\\ahmed\\.tmp\\test-sec-' + crypto.randomUUID());
    fs.mkdirSync(testStorageDir, { recursive: true });

    fixtureServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Visual Security Target</h1>
          </body>
        </html>
      `);
    });

    await new Promise<void>(resolve => {
      fixtureServer.listen(0, '127.0.0.1', () => {
        fixturePort = (fixtureServer.address() as net.AddressInfo).port;
        resolve();
      });
    });

    manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
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
    if (manager) {
      await manager.close();
    }
    if (fixtureServer) {
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

  it('1. routes all visual auditor requests strictly through the controlled proxy', async () => {
    const proxyServer = manager.getProxyServer();
    expect(proxyServer).not.toBeNull();

    const statsBefore = proxyServer!.getStats();

    const auditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: true,
      screenshotOptions: { storageDir: testStorageDir },
      layoutShiftOptions: { layoutShiftTimeoutMs: 100 },
    });

    const targetUrl = `http://audit-target.test:${fixturePort}/page.html`;
    await auditor.auditUrl(targetUrl);

    const statsAfter = proxyServer!.getStats();
    // Verifies network activity traversed the controlled proxy
    expect(statsAfter.requestsTotal).toBeGreaterThan(statsBefore.requestsTotal);
    expect(statsAfter.requestsAllowed).toBeGreaterThan(statsBefore.requestsAllowed);
  });

  it('2. blocks SSRF navigation to prohibited loopback destination during visual audits', async () => {
    const auditor = new VisualAuditor(manager, {
      profiles: [desktop],
      captureScreenshots: false,
    });

    // Attempting navigation directly to 127.0.0.1
    const prohibitedUrl = `http://127.0.0.1:${fixturePort}/secret.html`;
    const report = await auditor.auditUrl(prohibitedUrl);

    // Profile result captures error from SSRF interceptor / proxy block
    expect(report.viewportResults.length).toBe(1);
    expect(report.viewportResults[0].error).toBeDefined();
    expect(report.viewportResults[0].error).toMatch(
      /(ERR_UNAUTHORIZED_NAVIGATION_ORIGIN|net::ERR_FAILED|BLOCKED)/,
    );
  });

  it('3. preserves immutable Chromium launch arguments and Site Isolation invariants', () => {
    const args = BrowserManager.getHardenedChromiumArgs();

    // Verifies WebRTC and direct UDP restrictions
    expect(args).toContain('--disable-webrtc');
    expect(args).toContain('--disable-quic');
    expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');

    // Verifies Site Isolation is NOT disabled
    expect(args.some(a => a.includes('IsolateOrigins'))).toBe(false);
    expect(args.some(a => a.includes('site-per-process'))).toBe(false);

    // Verifies IPC flooding protection is NOT disabled
    expect(args.some(a => a.includes('disable-ipc-flooding-protection'))).toBe(false);

    // Verifies speculative prefetching is disabled
    expect(args).toContain('--dns-prefetch-disable');
    expect(args).toContain('--disable-preconnect');
  });

  it('4. confirms WebRTC is neutralized inside pages during visual audits', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const targetUrl = `http://audit-target.test:${fixturePort}/page.html`;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      const webrtcStatus = await page.evaluate(() => ({
        hasRTCPeerConnection: typeof window.RTCPeerConnection !== 'undefined',
        hasWebkitRTCPeerConnection:
          typeof (window as unknown as { webkitRTCPeerConnection?: unknown })
            .webkitRTCPeerConnection !== 'undefined',
      }));

      expect(webrtcStatus.hasRTCPeerConnection).toBe(false);
      expect(webrtcStatus.hasWebkitRTCPeerConnection).toBe(false);
    } finally {
      await managedPage.release();
    }
  });

  it('5. strictly prevents path traversal in screenshot storage operations', () => {
    const sm = new ScreenshotManager({ storageDir: testStorageDir });

    const maliciousRelative = '../../Windows/System32/evil.png';
    const fakeMetadata = {
      id: 'traversal-test',
      targetUrl: 'http://audit-target.test',
      viewport: desktop,
      captureType: 'viewport' as const,
      format: 'png' as const,
      filePath: path.resolve(testStorageDir, maliciousRelative),
      relativePath: maliciousRelative,
      width: 100,
      height: 100,
      fileSizeBytes: 100,
      sha256: 'deadbeef',
      capturedAt: new Date().toISOString(),
    };

    expect(() => sm.deleteScreenshot(fakeMetadata)).toThrow(/Path traversal detected/);
  });
});
