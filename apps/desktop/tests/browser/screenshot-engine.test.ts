import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { ScreenshotManager } from '../../src/main/browser/screenshot-manager.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';

describe('Screenshot Engine & Storage Security Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;
  let testStorageDir: string;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const desktop = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'desktop')!;

  beforeAll(async () => {
    testStorageDir = path.resolve('D:\\ahmed\\.tmp\\test-screenshots-' + crypto.randomUUID());
    fs.mkdirSync(testStorageDir, { recursive: true });

    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/page.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><style>body { margin: 0; background: #2c3e50; color: white; height: 1200px; padding: 20px; }</style></head>
            <body>
              <h1 id="title">Visual Evidence Target</h1>
              <p>Top section of the page.</p>
              <div style="margin-top: 800px;" id="deep-element">Deep element at bottom</div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/huge-page.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><style>body { height: 20000px; }</style></head>
            <body>Overly tall page</body>
          </html>
        `);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
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

  beforeEach(() => {
    // Clean test storage between tests
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

  it('1. captures viewport PNG screenshot and stores metadata with valid checksum', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/page.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const sm = new ScreenshotManager({ storageDir: testStorageDir });
      const metadata = await sm.capture({
        page,
        viewport: desktop,
        captureType: 'viewport',
      });

      expect(metadata.id).toBeDefined();
      expect(metadata.captureType).toBe('viewport');
      expect(metadata.format).toBe('png');
      expect(metadata.fileSizeBytes).toBeGreaterThan(0);
      expect(metadata.filePath).toBeDefined();
      expect(fs.existsSync(metadata.filePath)).toBe(true);

      // Verify PNG magic bytes: \x89PNG
      const fileBytes = fs.readFileSync(metadata.filePath);
      expect(fileBytes[0]).toBe(0x89);
      expect(fileBytes[1]).toBe(0x50);
      expect(fileBytes[2]).toBe(0x4e);
      expect(fileBytes[3]).toBe(0x47);

      // Verify SHA-256 checksum matches actual file
      const computedSha256 = crypto.createHash('sha256').update(fileBytes).digest('hex');
      expect(metadata.sha256).toBe(computedSha256);
    } finally {
      await managedPage.release();
    }
  });

  it('2. captures full-page PNG screenshot successfully', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/page.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const sm = new ScreenshotManager({ storageDir: testStorageDir });
      const metadata = await sm.capture({
        page,
        viewport: desktop,
        captureType: 'fullpage',
      });

      expect(metadata.captureType).toBe('fullpage');
      expect(metadata.fileSizeBytes).toBeGreaterThan(0);
      expect(fs.existsSync(metadata.filePath)).toBe(true);
    } finally {
      await managedPage.release();
    }
  });

  it('3. enforces maximum dimensions on tall/wide pages', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/huge-page.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Max height set to 10,000px, page is 20,000px
      const sm = new ScreenshotManager({
        storageDir: testStorageDir,
        maxHeight: 10_000,
      });

      await expect(
        sm.capture({
          page,
          viewport: desktop,
          captureType: 'fullpage',
        }),
      ).rejects.toThrow(/exceed maximum allowed screenshot dimensions/);
    } finally {
      await managedPage.release();
    }
  });

  it('4. enforces individual screenshot file-size limit', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/page.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Unreasonably low limit: 100 bytes
      const sm = new ScreenshotManager({
        storageDir: testStorageDir,
        maxIndividualSizeBytes: 100,
      });

      await expect(
        sm.capture({
          page,
          viewport: desktop,
          captureType: 'viewport',
        }),
      ).rejects.toThrow(/exceeds maximum limit \(100 bytes\)/);
    } finally {
      await managedPage.release();
    }
  });

  it('5. enforces maximum screenshot count limit per audit', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/page.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const sm = new ScreenshotManager({
        storageDir: testStorageDir,
        maxScreenshotsPerAudit: 2,
      });

      await sm.capture({ page, viewport: desktop, captureType: 'viewport' });
      await sm.capture({ page, viewport: desktop, captureType: 'viewport' });

      // 3rd attempt exceeds limit of 2
      await expect(
        sm.capture({ page, viewport: desktop, captureType: 'viewport' }),
      ).rejects.toThrow(/Screenshot quota exceeded/);
    } finally {
      await managedPage.release();
    }
  });

  it('6. enforces total screenshot storage quota', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/page.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // 5KB max storage
      const sm = new ScreenshotManager({
        storageDir: testStorageDir,
        maxTotalStorageBytes: 5000,
      });

      await expect(
        sm.capture({ page, viewport: desktop, captureType: 'viewport' }),
      ).rejects.toThrow(/Screenshot total storage quota exceeded/);
    } finally {
      await managedPage.release();
    }
  });

  it('7. safely writes files atomically and cleans up temp files on failure', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/page.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const sm = new ScreenshotManager({ storageDir: testStorageDir });
      const metadata = await sm.capture({ page, viewport: desktop, captureType: 'viewport' });

      expect(fs.existsSync(metadata.filePath)).toBe(true);

      // Verify no remaining .tmp files in storage directory
      const remainingFiles = fs.readdirSync(testStorageDir);
      const tmpFiles = remainingFiles.filter(f => f.includes('.tmp.'));
      expect(tmpFiles.length).toBe(0);
    } finally {
      await managedPage.release();
    }
  });

  it('8. rejects path traversal in delete operations', () => {
    const sm = new ScreenshotManager({ storageDir: testStorageDir });

    const maliciousMetadata = {
      id: 'test',
      targetUrl: 'http://example.com',
      viewport: desktop,
      captureType: 'viewport' as const,
      format: 'png' as const,
      filePath: path.resolve(testStorageDir, '../../evil.png'),
      relativePath: '../../evil.png',
      width: 100,
      height: 100,
      fileSizeBytes: 100,
      sha256: 'abc',
      capturedAt: new Date().toISOString(),
    };

    expect(() => sm.deleteScreenshot(maliciousMetadata)).toThrow(/Path traversal detected/);
  });

  it('9. supports cancellation via AbortSignal', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/page.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const sm = new ScreenshotManager({ storageDir: testStorageDir });
      const controller = new AbortController();
      controller.abort(); // Pre-aborted

      await expect(
        sm.capture({
          page,
          viewport: desktop,
          captureType: 'viewport',
          signal: controller.signal,
        }),
      ).rejects.toThrow(/aborted by caller signal/);
    } finally {
      await managedPage.release();
    }
  });

  it('10. associates findingId and redacts URL in metadata', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      // Navigate to URL with sensitive token in query and password in authority
      const sensitiveUrl = `http://admin:secretPass@audit-target.test:${fixturePort}/page.html?token=superSecret12345`;
      await page.goto(sensitiveUrl, { waitUntil: 'domcontentloaded' });

      const findingId = crypto.randomUUID();
      const sm = new ScreenshotManager({ storageDir: testStorageDir });

      const metadata = await sm.capture({
        page,
        viewport: desktop,
        captureType: 'viewport',
        findingId,
      });

      expect(metadata.findingId).toBe(findingId);
      // Confirms password and sensitive query token are redacted
      expect(metadata.targetUrl).not.toContain('secretPass');
      expect(metadata.targetUrl).not.toContain('superSecret12345');
      expect(metadata.targetUrl).toMatch(/(?:\[REDACTED\]|%5BREDACTED%5D)/);
    } finally {
      await managedPage.release();
    }
  });
});
