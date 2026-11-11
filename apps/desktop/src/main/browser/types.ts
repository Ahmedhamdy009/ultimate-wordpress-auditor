import type { BrowserContext, Page } from 'playwright-core';

export const BROWSER_ERROR_CODES = {
  ERR_NO_SUPPORTED_BROWSER_FOUND: 'ERR_NO_SUPPORTED_BROWSER_FOUND',
  ERR_BROWSER_LAUNCH_FAILED: 'ERR_BROWSER_LAUNCH_FAILED',
  ERR_BROWSER_CRASHED: 'ERR_BROWSER_CRASHED',
  ERR_BROWSER_CLOSED: 'ERR_BROWSER_CLOSED',
  ERR_PAGE_LIMIT_REACHED: 'ERR_PAGE_LIMIT_REACHED',
  ERR_PAGE_ACQUIRE_TIMEOUT: 'ERR_PAGE_ACQUIRE_TIMEOUT',
  ERR_PROXY_START_FAILED: 'ERR_PROXY_START_FAILED',
  ERR_PROXY_REQUEST_BLOCKED: 'ERR_PROXY_REQUEST_BLOCKED',
  ERR_SSRF_PROHIBITED_DESTINATION: 'ERR_SSRF_PROHIBITED_DESTINATION',
  ERR_BROWSER_DISPOSED: 'ERR_BROWSER_DISPOSED',
  ERR_OPERATION_ABORTED: 'ERR_OPERATION_ABORTED',
  ERR_INVALID_CONFIGURATION: 'ERR_INVALID_CONFIGURATION',
} as const;

export type BrowserErrorCode = (typeof BROWSER_ERROR_CODES)[keyof typeof BROWSER_ERROR_CODES];

export type BrowserType = 'msedge' | 'chrome' | 'custom' | 'auto';

export type BrowserLifecycleState =
  'uninitialized' | 'initializing' | 'ready' | 'closing' | 'closed' | 'crashed';

export interface DiscoveredBrowserInfo {
  readonly type: BrowserType;
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly executablePath: string;
  readonly channel?: string;
}

export interface BrowserCandidate {
  readonly type: BrowserType;
  readonly name: string;
  readonly displayName: string;
  readonly executablePath?: string;
  readonly channel?: string;
}

export interface BrowserDiscoveryOptions {
  /**
   * Preferred browser discovery priority.
   * Default: ['msedge', 'chrome']
   */
  readonly preferredOrder?: readonly BrowserType[];

  /**
   * Optional custom executable path to override automatic discovery.
   */
  readonly customExecutablePath?: string;

  /**
   * Custom list of candidate browsers for testing.
   */
  readonly customCandidates?: readonly BrowserCandidate[];

  /**
   * Timeout in milliseconds for launch verification during discovery.
   * Default: 5000 ms.
   */
  readonly timeoutMs?: number;

  /**
   * Whether to bypass the in-memory discovery cache.
   * Default: false.
   */
  readonly bypassCache?: boolean;
}

export type ThirdPartyResourcePolicy =
  'SAME_ORIGIN_ONLY' | 'ALLOW_PUBLIC_SUBRESOURCES' | 'ALLOW_CUSTOM_LIST';

export interface BrowserScopePolicy {
  /**
   * Base authorized origin (e.g. 'https://example.com' or 'http://example.com:8080').
   * All top-level navigations must strictly belong to this origin.
   */
  readonly authorizedOrigin: string;

  /**
   * Additional allowed origins/domains for subresource requests (e.g. CDN origins).
   */
  readonly allowedAdditionalDomains?: readonly string[];

  /**
   * Policy governing external third-party subresources (styles, images, scripts, fonts).
   * Default: 'ALLOW_PUBLIC_SUBRESOURCES'.
   */
  readonly thirdPartyPolicy?: ThirdPartyResourcePolicy;

  /**
   * Whether to allow inline data: URLs (e.g. data:image/png).
   * Default: true (for images/fonts only).
   */
  readonly allowDataUrls?: boolean;

  /**
   * Whether to allow blob: URLs.
   * Default: false.
   */
  readonly allowBlobUrls?: boolean;

  /**
   * Whether to allow WebSocket connections (ws:// and wss://).
   * Default: false (fail-closed).
   */
  readonly allowWebSockets?: boolean;
}

export interface BrowserProxyTestHooks {
  /**
   * Custom DNS lookup function for mocking or testing.
   */
  readonly lookupFn?: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<Array<{ address: string; family: number }>>;

  /**
   * IP override for pinned socket connection in tests (allows pointing test domain to test server).
   */
  readonly pinnedIpOverride?: string;

  /**
   * Explicit test-only flag to allow loopback addresses for local fixture servers.
   * MUST be false or undefined in production.
   */
  readonly allowLoopbackInTests?: boolean;
}

export interface BrowserProxyOptions {
  /**
   * Listen address for local proxy server.
   * Default: '127.0.0.1'.
   */
  readonly host?: string;

  /**
   * Listen port for local proxy server (0 for automatic dynamic assignment).
   * Default: 0.
   */
  readonly port?: number;

  /**
   * Active scope policy applied by proxy.
   */
  readonly scopePolicy?: BrowserScopePolicy;

  /**
   * TCP connection timeout in milliseconds.
   * Default: 5000 ms.
   */
  readonly connectTimeoutMs?: number;

  /**
   * Test-only hooks for dependency injection.
   */
  readonly testHooks?: BrowserProxyTestHooks;
}

export interface BrowserProxyStats {
  readonly requestsTotal: number;
  readonly requestsAllowed: number;
  readonly requestsBlocked: number;
  readonly connectTunnelsEstablished: number;
  readonly connectTunnelsBlocked: number;
  readonly activeSockets: number;
}

export interface ViewportDimensions {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor?: number;
  readonly isMobile?: boolean;
  readonly hasTouch?: boolean;
}

export interface BrowserManagerOptions {
  /**
   * Preferred browser type ('msedge' | 'chrome' | 'custom' | 'auto').
   * Default: 'auto' (discovers Edge then Chrome).
   */
  readonly browserType?: BrowserType;

  /**
   * Explicit executable path overriding auto-discovery.
   */
  readonly executablePath?: string;

  /**
   * Run in headless mode.
   * Default: true.
   */
  readonly headless?: boolean;

  /**
   * Maximum concurrent pages allowed open simultaneously.
   * Default: 1 (bounded browser concurrency).
   */
  readonly maxConcurrentPages?: number;

  /**
   * Timeout in milliseconds waiting to acquire a page from the concurrency pool.
   * Default: 10,000 ms.
   */
  readonly acquireTimeoutMs?: number;

  /**
   * Default navigation timeout in milliseconds.
   * Default: 30,000 ms.
   */
  readonly navigationTimeoutMs?: number;

  /**
   * Default viewport dimensions.
   * Default: { width: 1440, height: 900 }.
   */
  readonly defaultViewport?: ViewportDimensions;

  /**
   * Default scope policy applied to acquired pages and proxy.
   */
  readonly scopePolicy?: BrowserScopePolicy;

  /**
   * Proxy server options.
   */
  readonly proxyOptions?: BrowserProxyOptions;

  /**
   * Test hooks for proxy and network layers.
   */
  readonly testHooks?: BrowserProxyTestHooks;
}

export interface AcquirePageOptions {
  /**
   * Scope policy override for this specific page.
   */
  readonly scopePolicy?: BrowserScopePolicy;

  /**
   * Viewport override for this specific page.
   */
  readonly viewport?: ViewportDimensions;

  /**
   * Device scale factor override.
   */
  readonly deviceScaleFactor?: number;

  /**
   * Whether to emulate mobile device screen.
   */
  readonly isMobile?: boolean;

  /**
   * Whether touch events are enabled.
   */
  readonly hasTouch?: boolean;

  /**
   * Custom User-Agent header.
   */
  readonly userAgent?: string;

  /**
   * Cancellation signal.
   */
  readonly signal?: AbortSignal;

  /**
   * Additional HTTP headers for all requests from this page.
   */
  readonly extraHttpHeaders?: Record<string, string>;

  /**
   * Test-only flag to ignore HTTPS certificate errors (e.g. self-signed certs in tests).
   * Default: false.
   */
  readonly ignoreHTTPSErrors?: boolean;
}

export interface ManagedPage {
  readonly id: string;
  readonly page: Page;
  readonly context: BrowserContext;
  readonly createdAt: number;
  release(): Promise<void>;
}
