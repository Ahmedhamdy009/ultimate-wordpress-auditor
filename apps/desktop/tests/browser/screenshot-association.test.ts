import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { VisualAuditor } from '../../src/main/browser/visual-auditor.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';

describe('Screenshot Association & Metadata Integrity Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;
  let testStorageDir: string;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const smallMobile = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'small-mobile')!;

  beforeAll(async () => {
    testStorageDir = path.resolve('D:\\ahmed\\.tmp\\test-assoc-' + crypto.randomUUID());
    fs.mkdirSync(testStorageDir, { recursive: true });

    fixtureServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <style>
              .overflow-box { width: 500px; height: 100px; background: red; }
            </style>
          </head>
          <body>
            <div class="overflow-box">500px on 320px screen</div>
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
  }, 30000);

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
  }, 30000);

  it('attaches screenshot metadata to visual findings when screenshots are enabled', async () => {
    const auditor = new VisualAuditor(manager, {
      profiles: [smallMobile],
      captureScreenshots: true,
      captureFullPageScreenshots: false,
      screenshotOptions: { storageDir: testStorageDir },
      layoutShiftOptions: { layoutShiftTimeoutMs: 100 },
    });

    const targetUrl = `http://audit-target.test:${fixturePort}/`;
    const report = await auditor.auditUrl(targetUrl);

    expect(report.findings.length).toBeGreaterThan(0);
    const finding = report.findings[0];
    expect(finding.evidence).toBeDefined();

    const ev = finding.evidence as Record<string, unknown>;
    expect(ev.screenshot).toBeDefined();

    const sc = ev.screenshot as Record<string, unknown>;
    expect(typeof sc.id).toBe('string');
    expect(typeof sc.fileName).toBe('string');
    expect(sc.width).toBe(smallMobile.width);
    expect(sc.height).toBe(smallMobile.height);
    expect(sc.viewportProfile).toBe(smallMobile.name);
    expect(Number(sc.fileSizeBytes)).toBeGreaterThan(0);
    expect(sc.captureType).toBe('viewport');
  });

  it('does NOT attach screenshot metadata when captureScreenshots is false', async () => {
    const auditor = new VisualAuditor(manager, {
      profiles: [smallMobile],
      captureScreenshots: false,
      screenshotOptions: { storageDir: testStorageDir },
      layoutShiftOptions: { layoutShiftTimeoutMs: 100 },
    });

    const targetUrl = `http://audit-target.test:${fixturePort}/`;
    const report = await auditor.auditUrl(targetUrl);

    expect(report.findings.length).toBeGreaterThan(0);
    for (const f of report.findings) {
      const ev = (f.evidence as Record<string, unknown>) ?? {};
      expect(ev.screenshot).toBeUndefined();
    }
  });
});
