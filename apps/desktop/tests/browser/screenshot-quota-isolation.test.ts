import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { ScreenshotManager } from '../../src/main/browser/screenshot-manager.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';

describe('Screenshot Per-Audit Quota Isolation & Concurrency Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;
  let testStorageDir: string;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const desktop = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'desktop')!;

  beforeAll(async () => {
    testStorageDir = path.resolve('D:\\ahmed\\.tmp\\test-quota-iso-' + crypto.randomUUID());
    fs.mkdirSync(testStorageDir, { recursive: true });

    fixtureServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><style>body { margin: 0; background: #34495e; color: white; height: 800px; padding: 20px; }</style></head>
          <body>
            <h1>Quota Isolation Target Page</h1>
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
        // Ignore
      }
    }
  });

  beforeEach(() => {
    if (fs.existsSync(testStorageDir)) {
      const files = fs.readdirSync(testStorageDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(testStorageDir, file));
        } catch {
          // Ignore
        }
      }
    }
  });

  it('1. independently enforces storage and count quotas per audit (Audit A usage does NOT affect Audit B)', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/page.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Max 3 screenshots per audit
      const sm = new ScreenshotManager({
        storageDir: testStorageDir,
        maxScreenshotsPerAudit: 3,
      });

      // Audit A takes 3 screenshots, exhausting its quota
      await sm.capture({ page, viewport: desktop, captureType: 'viewport', scanRunId: 'audit-a' });
      await sm.capture({ page, viewport: desktop, captureType: 'viewport', scanRunId: 'audit-a' });
      await sm.capture({ page, viewport: desktop, captureType: 'viewport', scanRunId: 'audit-a' });

      expect(sm.getScreenshotsCount('audit-a')).toBe(3);

      // Audit A 4th attempt is rejected because its quota is full
      await expect(
        sm.capture({ page, viewport: desktop, captureType: 'viewport', scanRunId: 'audit-a' }),
      ).rejects.toThrow(/Screenshot quota exceeded/);

      // Audit B starts a separate audit on the same ScreenshotManager instance
      // Expected: Audit B must NOT be rejected because Audit A used its quota!
      const metaB = await sm.capture({
        page,
        viewport: desktop,
        captureType: 'viewport',
        scanRunId: 'audit-b',
      });

      expect(metaB.scanRunId).toBe('audit-b');
      expect(sm.getScreenshotsCount('audit-b')).toBe(1);
      // Audit A count remains isolated at 3
      expect(sm.getScreenshotsCount('audit-a')).toBe(3);
    } finally {
      await managedPage.release();
    }
  }, 20000);

  it('2. prevents concurrent captures from bypassing audit storage quota (concurrency safety)', async () => {
    const pageA = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });
    const pageB = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const url = `http://audit-target.test:${fixturePort}/page.html`;
      await Promise.all([
        pageA.page.goto(url, { waitUntil: 'domcontentloaded' }),
        pageB.page.goto(url, { waitUntil: 'domcontentloaded' }),
      ]);

      // Set maxScreenshotsPerAudit: 1 for audit-concurrent
      const sm = new ScreenshotManager({
        storageDir: testStorageDir,
        maxScreenshotsPerAudit: 1,
      });

      // Fire two captures concurrently for the same audit run
      const capturePromises = [
        sm.capture({
          page: pageA.page,
          viewport: desktop,
          captureType: 'viewport',
          scanRunId: 'audit-concurrent',
        }),
        sm.capture({
          page: pageB.page,
          viewport: desktop,
          captureType: 'viewport',
          scanRunId: 'audit-concurrent',
        }),
      ];

      const results = await Promise.allSettled(capturePromises);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      // Exactly 1 capture must succeed and exactly 1 must be rejected by quota lock
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(
        /Screenshot quota exceeded/,
      );
      expect(sm.getScreenshotsCount('audit-concurrent')).toBe(1);
    } finally {
      await pageA.release();
      await pageB.release();
    }
  }, 20000);

  it('3. cleans up abandoned temporary files safely with cleanupAbandonedTempFiles()', () => {
    const sm = new ScreenshotManager({ storageDir: testStorageDir });

    // Simulate lingering temporary files left from an interrupted process
    const lingeringTemp1 = path.join(testStorageDir, 'abandoned-1.tmp.12345');
    const lingeringTemp2 = path.join(testStorageDir, 'abandoned-2.tmp.67890');
    const validPng = path.join(testStorageDir, 'valid-evidence.png');

    fs.writeFileSync(lingeringTemp1, 'temporary incomplete data 1');
    fs.writeFileSync(lingeringTemp2, 'temporary incomplete data 2');
    fs.writeFileSync(validPng, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    expect(fs.existsSync(lingeringTemp1)).toBe(true);
    expect(fs.existsSync(lingeringTemp2)).toBe(true);
    expect(fs.existsSync(validPng)).toBe(true);

    const cleanedCount = sm.cleanupAbandonedTempFiles();

    expect(cleanedCount).toBe(2);
    expect(fs.existsSync(lingeringTemp1)).toBe(false);
    expect(fs.existsSync(lingeringTemp2)).toBe(false);
    // Valid PNG remains untouched!
    expect(fs.existsSync(validPng)).toBe(true);
  });

  it('4. updates audit quota accurately upon deleteScreenshot()', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/page.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const sm = new ScreenshotManager({ storageDir: testStorageDir });
      const meta = await sm.capture({
        page,
        viewport: desktop,
        captureType: 'viewport',
        scanRunId: 'audit-del',
      });

      expect(sm.getScreenshotsCount('audit-del')).toBe(1);
      const bytesBefore = sm.getTotalStoredBytes('audit-del');
      expect(bytesBefore).toBeGreaterThan(0);

      // Delete screenshot
      sm.deleteScreenshot(meta);

      expect(sm.getScreenshotsCount('audit-del')).toBe(0);
      expect(sm.getTotalStoredBytes('audit-del')).toBe(0);
      expect(fs.existsSync(meta.filePath)).toBe(false);
    } finally {
      await managedPage.release();
    }
  }, 20000);
});
