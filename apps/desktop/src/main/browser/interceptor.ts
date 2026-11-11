import net from 'node:net';
import type { BrowserContext, Page, Route, Request } from 'playwright-core';
import { isIpAllowedForScan } from '@auditor/shared';
import type { BrowserProxyTestHooks, BrowserScopePolicy } from './types.js';

export interface InterceptionStats {
  requestsEvaluated: number;
  requestsAllowed: number;
  requestsBlocked: number;
  blockedReasons: Record<string, number>;
}

export class BrowserScopeInterceptor {
  private readonly policy: BrowserScopePolicy;
  private readonly testHooks?: BrowserProxyTestHooks;
  private readonly authHostname: string;

  private requestsEvaluated = 0;
  private requestsAllowed = 0;
  private requestsBlocked = 0;
  private readonly blockedReasons: Record<string, number> = {};

  constructor(policy: BrowserScopePolicy, testHooks?: BrowserProxyTestHooks) {
    this.policy = policy;
    this.testHooks = testHooks;

    try {
      this.authHostname = new URL(policy.authorizedOrigin).hostname.toLowerCase();
    } catch {
      this.authHostname = policy.authorizedOrigin.toLowerCase();
    }
  }

  public getStats(): InterceptionStats {
    return {
      requestsEvaluated: this.requestsEvaluated,
      requestsAllowed: this.requestsAllowed,
      requestsBlocked: this.requestsBlocked,
      blockedReasons: { ...this.blockedReasons },
    };
  }

  /**
   * Attaches route interception to a Playwright page or browser context.
   * Attaching at the BrowserContext level centrally protects all pages, popups, and frames.
   */
  public async attach(target: Page | BrowserContext): Promise<void> {
    await target.route('**/*', (route, request) => this.handleRoute(route, request));
  }

  private async handleRoute(route: Route, request: Request): Promise<void> {
    this.requestsEvaluated++;
    const rawUrl = request.url();

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      this.block(route, 'ERR_MALFORMED_URL');
      return;
    }

    const scheme = parsedUrl.protocol.replace(':', '').toLowerCase();

    // 1. Data URLs handling
    if (scheme === 'data') {
      const allowData = this.policy.allowDataUrls !== false;
      const resourceType = request.resourceType();
      if (allowData && (resourceType === 'image' || resourceType === 'font')) {
        this.allow(route);
        return;
      }
      this.block(route, 'ERR_DISALLOWED_DATA_URL');
      return;
    }

    // 2. Blob URLs handling
    if (scheme === 'blob') {
      if (this.policy.allowBlobUrls === true) {
        this.allow(route);
        return;
      }
      this.block(route, 'ERR_DISALLOWED_BLOB_URL');
      return;
    }

    // 3. Scheme check (only http and https permitted)
    if (scheme !== 'http' && scheme !== 'https') {
      this.block(route, `ERR_DISALLOWED_SCHEME_${scheme.toUpperCase()}`);
      return;
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // 4. WebSocket check
    if (request.resourceType() === 'websocket') {
      if (!this.policy.allowWebSockets) {
        this.block(route, 'ERR_DISALLOWED_WEBSOCKET');
        return;
      }
    }

    // 5. SSRF / Localhost / Prohibited IP ranges check
    if (!this.testHooks?.allowLoopbackInTests) {
      if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        this.block(route, 'ERR_SSRF_LOCALHOST_BLOCKED');
        return;
      }

      const isIpLiteral = net.isIP(hostname) !== 0;
      if (isIpLiteral) {
        const ipCheck = isIpAllowedForScan(hostname);
        if (!ipCheck.allowed) {
          this.block(route, 'ERR_SSRF_PROHIBITED_IP');
          return;
        }
      }
    }

    // 6. Top-level Document Navigation MUST match authorized origin
    let isMainFrameNavigation: boolean;
    try {
      const frame = request.frame();
      isMainFrameNavigation =
        request.isNavigationRequest() && (frame ? frame.parentFrame() === null : true);
    } catch {
      isMainFrameNavigation = request.isNavigationRequest();
    }

    const isAuthorizedHost =
      hostname === this.authHostname || hostname.endsWith(`.${this.authHostname}`);

    if (isMainFrameNavigation && !isAuthorizedHost) {
      this.block(route, 'ERR_UNAUTHORIZED_NAVIGATION_ORIGIN');
      return;
    }

    // 7. Subresource evaluation
    if (isAuthorizedHost) {
      this.allow(route);
      return;
    }

    // Check explicit additional allowed domains
    if (this.policy.allowedAdditionalDomains) {
      for (const domain of this.policy.allowedAdditionalDomains) {
        const cleanDomain = domain.trim().toLowerCase();
        if (hostname === cleanDomain || hostname.endsWith(`.${cleanDomain}`)) {
          this.allow(route);
          return;
        }
      }
    }

    // Third-party subresource policy
    const thirdPartyPolicy = this.policy.thirdPartyPolicy ?? 'ALLOW_PUBLIC_SUBRESOURCES';
    if (thirdPartyPolicy === 'SAME_ORIGIN_ONLY') {
      this.block(route, 'ERR_THIRD_PARTY_BLOCKED_SAME_ORIGIN_ONLY');
      return;
    }

    if (thirdPartyPolicy === 'ALLOW_CUSTOM_LIST') {
      this.block(route, 'ERR_THIRD_PARTY_NOT_IN_ALLOWLIST');
      return;
    }

    // ALLOW_PUBLIC_SUBRESOURCES: Allowed because public IP validity is verified at the proxy layer
    this.allow(route);
  }

  private allow(route: Route): void {
    this.requestsAllowed++;
    route.continue().catch(() => {
      // Ignore errors if route was already handled
    });
  }

  private block(route: Route, reason: string): void {
    this.requestsBlocked++;
    this.blockedReasons[reason] = (this.blockedReasons[reason] || 0) + 1;
    route.abort('blockedbyclient').catch(() => {
      // Ignore errors if route was already handled
    });
  }
}

/**
 * Attaches scope interception to a page or browser context with given policy and test hooks.
 */
export async function setupBrowserScopeInterception(
  target: Page | BrowserContext,
  policy: BrowserScopePolicy,
  testHooks?: BrowserProxyTestHooks,
): Promise<BrowserScopeInterceptor> {
  const interceptor = new BrowserScopeInterceptor(policy, testHooks);
  await interceptor.attach(target);
  return interceptor;
}
