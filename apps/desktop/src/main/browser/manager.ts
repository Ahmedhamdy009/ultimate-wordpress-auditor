import crypto from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import {
  BROWSER_ERROR_CODES,
  type AcquirePageOptions,
  type BrowserLifecycleState,
  type BrowserManagerOptions,
  type BrowserScopePolicy,
  type DiscoveredBrowserInfo,
  type ManagedPage,
} from './types.js';
import { BrowserError } from './errors.js';
import { discoverBrowser } from './discovery.js';
import { BrowserProxyServer } from './proxy-server.js';
import { setupBrowserScopeInterception } from './interceptor.js';

interface QueuedAcquisition {
  readonly id: string;
  readonly options?: AcquirePageOptions;
  readonly resolve: (page: ManagedPage) => void;
  readonly reject: (err: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class BrowserManager {
  private readonly options: Required<
    Omit<
      BrowserManagerOptions,
      'executablePath' | 'scopePolicy' | 'proxyOptions' | 'testHooks' | 'browserType'
    >
  > & {
    readonly browserType?: BrowserManagerOptions['browserType'];
    readonly executablePath?: string;
    readonly scopePolicy?: BrowserScopePolicy;
    readonly proxyOptions?: BrowserManagerOptions['proxyOptions'];
    readonly testHooks?: BrowserManagerOptions['testHooks'];
  };

  private state: BrowserLifecycleState = 'uninitialized';
  private browser: Browser | null = null;
  private proxyServer: BrowserProxyServer | null = null;
  private proxyUrl: string | null = null;
  private browserInfo: DiscoveredBrowserInfo | null = null;

  private activePages = 0;
  private readonly activePageHandles = new Map<string, ManagedPage>();
  private readonly acquireQueue: QueuedAcquisition[] = [];

  constructor(options: BrowserManagerOptions = {}) {
    this.options = {
      browserType: options.browserType,
      executablePath: options.executablePath,
      headless: options.headless ?? true,
      maxConcurrentPages: Math.max(1, options.maxConcurrentPages ?? 1),
      acquireTimeoutMs: Math.max(500, options.acquireTimeoutMs ?? 10_000),
      navigationTimeoutMs: Math.max(1000, options.navigationTimeoutMs ?? 30_000),
      defaultViewport: options.defaultViewport ?? { width: 1440, height: 900 },
      scopePolicy: options.scopePolicy,
      proxyOptions: options.proxyOptions,
      testHooks: options.testHooks,
    };
  }

  public getState(): BrowserLifecycleState {
    return this.state;
  }

  public getBrowserInfo(): DiscoveredBrowserInfo | null {
    return this.browserInfo;
  }

  public getProxyServer(): BrowserProxyServer | null {
    return this.proxyServer;
  }

  public getActivePageCount(): number {
    return this.activePages;
  }

  public getQueueLength(): number {
    return this.acquireQueue.length;
  }

  /**
   * Returns the exact, immutable list of hardened Chromium arguments used when launching.
   * Disallows arbitrary caller CLI argument injection to guarantee security boundaries.
   */
  public static getHardenedChromiumArgs(): readonly string[] {
    return [
      '--disable-dev-shm-usage',
      '--disable-quic', // Block UDP QUIC bypass
      '--disable-webrtc', // Restrict WebRTC bypass
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', // Force proxy-only for WebRTC
      '--proxy-bypass-list=<-loopback>', // Force loopback requests through proxy
      '--dns-prefetch-disable', // Disable speculative DNS prefetching
      '--disable-preconnect', // Disable speculative preconnections
      '--disable-speculative-service-worker', // Block speculative service workers
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-features=NetworkPrediction,SpeculativeResourcePrefetching', // Restrict speculative connections only
      '--disable-renderer-backgrounding',
    ];
  }

  /**
   * Initializes proxy server and launches the underlying browser process.
   */
  public async launch(): Promise<void> {
    if (this.state === 'ready') {
      return;
    }
    if (this.state === 'initializing') {
      throw new BrowserError(
        BROWSER_ERROR_CODES.ERR_INVALID_CONFIGURATION,
        'BrowserManager is already in the process of launching.',
      );
    }
    if (this.state === 'closing') {
      throw new BrowserError(
        BROWSER_ERROR_CODES.ERR_BROWSER_CLOSED,
        'Cannot launch BrowserManager while it is closing.',
      );
    }

    this.state = 'initializing';

    try {
      // 1. Discover browser candidate
      const discoveryOptions = {
        customExecutablePath: this.options.executablePath,
        preferredOrder:
          this.options.browserType && this.options.browserType !== 'auto'
            ? [this.options.browserType]
            : undefined,
      };
      this.browserInfo = await discoverBrowser(discoveryOptions);

      // 2. Start controlled local proxy server
      this.proxyServer = new BrowserProxyServer({
        ...this.options.proxyOptions,
        scopePolicy: this.options.scopePolicy,
        testHooks: this.options.testHooks,
      });
      this.proxyUrl = await this.proxyServer.start();

      // 3. Assemble hardened Chromium launch options
      // Site Isolation, OS sandboxing, and IPC flooding protection are strictly preserved.
      // Arbitrary extraArgs overrides are not permitted to ensure security boundaries cannot be weakened.
      const chromiumArgs = [...BrowserManager.getHardenedChromiumArgs()];

      const launchConfig: Parameters<typeof chromium.launch>[0] = {
        headless: this.options.headless,
        args: chromiumArgs,
        proxy: {
          server: this.proxyUrl,
          bypass: '<-loopback>',
        },
      };

      if (this.browserInfo.executablePath && this.browserInfo.type === 'custom') {
        launchConfig.executablePath = this.browserInfo.executablePath;
      } else if (this.browserInfo.channel) {
        launchConfig.channel = this.browserInfo.channel;
      } else if (this.browserInfo.executablePath) {
        launchConfig.executablePath = this.browserInfo.executablePath;
      }

      this.browser = await chromium.launch(launchConfig);

      // 4. Attach crash / unexpected disconnect listener
      this.browser.on('disconnected', () => this.handleBrowserCrash());

      this.state = 'ready';
    } catch (err) {
      this.state = 'closed';
      await this.cleanupInternal();
      throw new BrowserError(
        BROWSER_ERROR_CODES.ERR_BROWSER_LAUNCH_FAILED,
        `BrowserManager launch failed: ${err instanceof Error ? err.message : String(err)}`,
        { originalError: String(err) },
      );
    }
  }

  /**
   * Acquires a managed page from the pool, enforcing concurrency limits.
   */
  public async acquirePage(options: AcquirePageOptions = {}): Promise<ManagedPage> {
    if (this.state === 'closing' || this.state === 'closed') {
      throw new BrowserError(
        BROWSER_ERROR_CODES.ERR_BROWSER_DISPOSED,
        'Cannot acquire page: BrowserManager has been closed.',
      );
    }
    if (this.state === 'crashed') {
      throw new BrowserError(
        BROWSER_ERROR_CODES.ERR_BROWSER_CRASHED,
        'Cannot acquire page: Browser process has crashed.',
      );
    }

    // Auto-launch if uninitialized
    if (this.state === 'uninitialized') {
      await this.launch();
    }

    if (options.signal?.aborted) {
      throw new BrowserError(
        BROWSER_ERROR_CODES.ERR_OPERATION_ABORTED,
        'Page acquisition was aborted by caller signal.',
      );
    }

    // If concurrency limit is reached, enqueue with timeout
    if (this.activePages >= this.options.maxConcurrentPages) {
      return new Promise<ManagedPage>((resolve, reject) => {
        const id = crypto.randomUUID();
        let onAbort: (() => void) | null = null;

        const timer = setTimeout(() => {
          this.removeQueuedAcquisition(id);
          if (onAbort && options.signal) {
            options.signal.removeEventListener('abort', onAbort);
          }
          reject(
            new BrowserError(
              BROWSER_ERROR_CODES.ERR_PAGE_ACQUIRE_TIMEOUT,
              `Timed out after ${this.options.acquireTimeoutMs}ms waiting to acquire page slot (active: ${this.activePages}/${this.options.maxConcurrentPages}).`,
            ),
          );
        }, this.options.acquireTimeoutMs);

        if (options.signal) {
          onAbort = () => {
            clearTimeout(timer);
            this.removeQueuedAcquisition(id);
            reject(
              new BrowserError(
                BROWSER_ERROR_CODES.ERR_OPERATION_ABORTED,
                'Page acquisition aborted by caller signal while waiting in queue.',
              ),
            );
          };
          options.signal.addEventListener('abort', onAbort, { once: true });
        }

        this.acquireQueue.push({
          id,
          options,
          resolve: page => {
            clearTimeout(timer);
            if (onAbort && options.signal) {
              options.signal.removeEventListener('abort', onAbort);
            }
            resolve(page);
          },
          reject: err => {
            clearTimeout(timer);
            if (onAbort && options.signal) {
              options.signal.removeEventListener('abort', onAbort);
            }
            reject(err);
          },
          timer,
        });
      });
    }

    return this.createManagedPage(options);
  }

  /**
   * Internal factory to build a ManagedPage, its BrowserContext, and attach interceptors.
   */
  private async createManagedPage(options: AcquirePageOptions): Promise<ManagedPage> {
    if (!this.browser || !this.proxyUrl) {
      throw new BrowserError(
        BROWSER_ERROR_CODES.ERR_BROWSER_CLOSED,
        'Browser instance or proxy server is unavailable.',
      );
    }

    this.activePages++;
    const pageId = crypto.randomUUID();

    const effectivePolicy: BrowserScopePolicy = options.scopePolicy ??
      this.options.scopePolicy ?? {
        authorizedOrigin: 'http://localhost',
        thirdPartyPolicy: 'SAME_ORIGIN_ONLY',
      };

    // Update proxy scope policy if specified
    if (this.proxyServer && options.scopePolicy) {
      this.proxyServer.updateScopePolicy(options.scopePolicy);
    }

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      context = await this.browser.newContext({
        serviceWorkers: 'block', // Strictly block service workers
        permissions: [], // Strictly deny device/media/notification permissions
        ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? false,
        viewport: options.viewport
          ? { width: options.viewport.width, height: options.viewport.height }
          : this.options.defaultViewport,
        deviceScaleFactor: options.deviceScaleFactor ?? options.viewport?.deviceScaleFactor,
        isMobile: options.isMobile ?? options.viewport?.isMobile,
        hasTouch: options.hasTouch ?? options.viewport?.hasTouch,
        userAgent: options.userAgent,
        extraHTTPHeaders: options.extraHttpHeaders,
      });

      context.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);

      // Defense-in-depth: Neutralize WebRTC APIs at context level across all frames and pages
      await context.addInitScript(`
        try {
          Object.defineProperty(window, 'RTCPeerConnection', {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: false,
          });
          Object.defineProperty(window, 'webkitRTCPeerConnection', {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: false,
          });
          if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
            Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
              value: () => Promise.reject(new Error('WebRTC/MediaDevices disabled by audit policy')),
              writable: false,
              configurable: false,
            });
          }
        } catch {
          // Ignore definition collisions
        }
      `);

      // Attach scope interceptor to the BrowserContext to enforce SSRF and policy on all pages/popups
      await setupBrowserScopeInterception(context, effectivePolicy, this.options.testHooks);

      page = await context.newPage();

      let isReleased = false;

      const release = async (): Promise<void> => {
        if (isReleased) {
          return;
        }
        isReleased = true;
        this.activePageHandles.delete(pageId);

        try {
          if (context) {
            await context.close().catch(() => {});
          }
        } finally {
          this.activePages = Math.max(0, this.activePages - 1);
          this.processNextInQueue();
        }
      };

      const managedPage: ManagedPage = {
        id: pageId,
        page,
        context,
        createdAt: Date.now(),
        release,
      };

      this.activePageHandles.set(pageId, managedPage);
      return managedPage;
    } catch (err) {
      this.activePages = Math.max(0, this.activePages - 1);
      if (page) {
        await page.close().catch(() => {});
      }
      if (context) {
        await context.close().catch(() => {});
      }
      this.processNextInQueue();

      throw new BrowserError(
        BROWSER_ERROR_CODES.ERR_BROWSER_LAUNCH_FAILED,
        `Failed to create browser page: ${err instanceof Error ? err.message : String(err)}`,
        { originalError: String(err) },
      );
    }
  }

  private processNextInQueue(): void {
    if (this.activePages >= this.options.maxConcurrentPages || this.acquireQueue.length === 0) {
      return;
    }

    const next = this.acquireQueue.shift();
    if (!next) return;

    this.createManagedPage(next.options || {})
      .then(page => next.resolve(page))
      .catch(err => next.reject(err));
  }

  private removeQueuedAcquisition(id: string): void {
    const idx = this.acquireQueue.findIndex(q => q.id === id);
    if (idx !== -1) {
      this.acquireQueue.splice(idx, 1);
    }
  }

  private handleBrowserCrash(): void {
    if (this.state === 'closing' || this.state === 'closed') {
      return;
    }
    this.state = 'crashed';

    // Reject all pending queued acquisitions
    while (this.acquireQueue.length > 0) {
      const queued = this.acquireQueue.shift();
      if (queued) {
        clearTimeout(queued.timer);
        queued.reject(
          new BrowserError(
            BROWSER_ERROR_CODES.ERR_BROWSER_CRASHED,
            'Browser process terminated unexpectedly (crashed).',
          ),
        );
      }
    }

    this.activePageHandles.clear();
    this.activePages = 0;
  }

  /**
   * Graceful shutdown of the manager, active pages, browser instance, and proxy server.
   */
  public async close(): Promise<void> {
    if (this.state === 'closed') {
      return;
    }
    this.state = 'closing';

    // Clear and reject queue
    while (this.acquireQueue.length > 0) {
      const queued = this.acquireQueue.shift();
      if (queued) {
        clearTimeout(queued.timer);
        queued.reject(
          new BrowserError(
            BROWSER_ERROR_CODES.ERR_BROWSER_CLOSED,
            'BrowserManager is closing; queued page acquisition cancelled.',
          ),
        );
      }
    }

    // Close all open managed pages
    const releasePromises = Array.from(this.activePageHandles.values()).map(h =>
      h.release().catch(() => {}),
    );
    await Promise.all(releasePromises);
    this.activePageHandles.clear();
    this.activePages = 0;

    await this.cleanupInternal();
    this.state = 'closed';
  }

  private async cleanupInternal(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore close errors
      }
      this.browser = null;
    }

    if (this.proxyServer) {
      try {
        await this.proxyServer.stop();
      } catch {
        // Ignore stop errors
      }
      this.proxyServer = null;
    }
    this.proxyUrl = null;
  }
}
