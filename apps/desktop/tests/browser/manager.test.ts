import { describe, it, expect, afterEach } from 'vitest';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { BROWSER_ERROR_CODES } from '../../src/main/browser/types.js';
import { BrowserError } from '../../src/main/browser/errors.js';

describe('BrowserManager Lifecycle & Concurrency Pool Suite', () => {
  let activeManager: BrowserManager | null = null;

  afterEach(async () => {
    if (activeManager) {
      await activeManager.close();
      activeManager = null;
    }
  });

  it('manages lifecycle state from uninitialized to ready to closed', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
    });
    activeManager = manager;

    expect(manager.getState()).toBe('uninitialized');
    expect(manager.getBrowserInfo()).toBeNull();
    expect(manager.getProxyServer()).toBeNull();

    await manager.launch();

    expect(manager.getState()).toBe('ready');
    expect(manager.getBrowserInfo()).toBeDefined();
    expect(manager.getBrowserInfo()?.version).toBeTruthy();
    expect(manager.getProxyServer()).toBeDefined();
    expect(manager.getProxyServer()?.getPort()).toBeGreaterThan(0);

    await manager.close();
    expect(manager.getState()).toBe('closed');
  }, 20000);

  it('acquires and releases managed pages while strictly tracking active count', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: 'http://audit-target.test',
      },
      testHooks: {
        allowLoopbackInTests: true,
      },
    });
    activeManager = manager;

    const managedPage = await manager.acquirePage();

    expect(managedPage).toBeDefined();
    expect(managedPage.id).toBeTruthy();
    expect(managedPage.page).toBeDefined();
    expect(manager.getActivePageCount()).toBe(1);

    await managedPage.release();

    expect(manager.getActivePageCount()).toBe(0);
  }, 20000);

  it('enforces bounded concurrency by queueing requests when limit is reached', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1, // Strict limit of 1
      acquireTimeoutMs: 5000,
      testHooks: {
        allowLoopbackInTests: true,
      },
    });
    activeManager = manager;

    const page1 = await manager.acquirePage();
    expect(manager.getActivePageCount()).toBe(1);
    expect(manager.getQueueLength()).toBe(0);

    // Second acquire should be queued waiting for slot
    let page2Acquired = false;
    const page2Promise = manager.acquirePage().then(p => {
      page2Acquired = true;
      return p;
    });

    // Give microtasks time to queue
    await new Promise(r => setTimeout(r, 50));
    expect(page2Acquired).toBe(false);
    expect(manager.getQueueLength()).toBe(1);

    // Release page 1, which should immediately resolve page 2
    await page1.release();

    const page2 = await page2Promise;
    expect(page2Acquired).toBe(true);
    expect(manager.getActivePageCount()).toBe(1);
    expect(manager.getQueueLength()).toBe(0);

    await page2.release();
    expect(manager.getActivePageCount()).toBe(0);
  }, 20000);

  it('times out when page acquisition cannot be satisfied within acquireTimeoutMs', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      acquireTimeoutMs: 300, // Short timeout for test
      testHooks: {
        allowLoopbackInTests: true,
      },
    });
    activeManager = manager;

    const page1 = await manager.acquirePage();

    await expect(manager.acquirePage()).rejects.toThrowError(BrowserError);

    try {
      await manager.acquirePage();
    } catch (err) {
      const bErr = err as BrowserError;
      expect(bErr.code).toBe(BROWSER_ERROR_CODES.ERR_PAGE_ACQUIRE_TIMEOUT);
    }

    await page1.release();
  }, 20000);

  it('aborts page acquisition cleanly if caller AbortSignal is cancelled', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      acquireTimeoutMs: 5000,
      testHooks: {
        allowLoopbackInTests: true,
      },
    });
    activeManager = manager;

    const page1 = await manager.acquirePage();

    const abortController = new AbortController();
    const acquirePromise = manager.acquirePage({ signal: abortController.signal });

    // Abort after 50ms while queued
    setTimeout(() => abortController.abort(), 50);

    await expect(acquirePromise).rejects.toThrowError(BrowserError);

    try {
      await acquirePromise;
    } catch (err) {
      const bErr = err as BrowserError;
      expect(bErr.code).toBe(BROWSER_ERROR_CODES.ERR_OPERATION_ABORTED);
    }

    expect(manager.getQueueLength()).toBe(0);
    await page1.release();
  }, 20000);

  it('detects unexpected browser crash and marks lifecycle as crashed', async () => {
    const manager = new BrowserManager({
      headless: true,
      testHooks: {
        allowLoopbackInTests: true,
      },
    });
    activeManager = manager;

    await manager.launch();
    expect(manager.getState()).toBe('ready');

    // Simulate browser process crash via internal crash handler
    (manager as unknown as { handleBrowserCrash: () => void }).handleBrowserCrash();

    expect(manager.getState()).toBe('crashed');

    // Subsequent acquisitions fail with ERR_BROWSER_CRASHED
    await expect(manager.acquirePage()).rejects.toThrowError(BrowserError);

    try {
      await manager.acquirePage();
    } catch (err) {
      const bErr = err as BrowserError;
      expect(bErr.code).toBe(BROWSER_ERROR_CODES.ERR_BROWSER_CRASHED);
    }
  }, 20000);

  it('rejects page acquisition when manager has already been closed', async () => {
    const manager = new BrowserManager();
    activeManager = manager;

    await manager.launch();
    await manager.close();

    expect(manager.getState()).toBe('closed');

    await expect(manager.acquirePage()).rejects.toThrowError(BrowserError);

    try {
      await manager.acquirePage();
    } catch (err) {
      const bErr = err as BrowserError;
      expect(bErr.code).toBe(BROWSER_ERROR_CODES.ERR_BROWSER_DISPOSED);
    }
  }, 20000);
});
