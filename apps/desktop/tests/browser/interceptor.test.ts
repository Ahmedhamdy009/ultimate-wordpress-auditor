import { describe, it, expect, vi } from 'vitest';
import type { Route, Request } from 'playwright-core';
import { BrowserScopeInterceptor } from '../../src/main/browser/interceptor.js';

function createMockRoute(): { route: Route; continued: boolean; abortedReason?: string } {
  let continued = false;
  let abortedReason: string | undefined;

  const route = {
    continue: vi.fn(async () => {
      continued = true;
    }),
    abort: vi.fn(async (errorCode?: string) => {
      abortedReason = errorCode;
    }),
  } as unknown as Route;

  return {
    route,
    get continued() {
      return continued;
    },
    get abortedReason() {
      return abortedReason;
    },
  };
}

function createMockRequest(
  url: string,
  options: { isNavigation?: boolean; resourceType?: string } = {},
): Request {
  return {
    url: () => url,
    isNavigationRequest: () => options.isNavigation ?? false,
    resourceType: () => options.resourceType ?? 'document',
  } as unknown as Request;
}

describe('BrowserScopeInterceptor Unit Suite', () => {
  const defaultPolicy = {
    authorizedOrigin: 'https://mysite.example.com',
    thirdPartyPolicy: 'SAME_ORIGIN_ONLY' as const,
  };

  it('allows same-origin HTTP and HTTPS navigation requests', async () => {
    const interceptor = new BrowserScopeInterceptor(defaultPolicy);
    const mock = createMockRoute();
    const req = createMockRequest('https://mysite.example.com/about', { isNavigation: true });

    // Directly test route handler
    await (
      interceptor as unknown as { handleRoute: (r: Route, req: Request) => Promise<void> }
    ).handleRoute(mock.route, req);

    expect(mock.continued).toBe(true);
    expect(mock.abortedReason).toBeUndefined();
  });

  it('blocks unauthorized navigation requests targeting external origins', async () => {
    const interceptor = new BrowserScopeInterceptor(defaultPolicy);
    const mock = createMockRoute();
    const req = createMockRequest('https://external-phishing.com/login', { isNavigation: true });

    await (
      interceptor as unknown as { handleRoute: (r: Route, req: Request) => Promise<void> }
    ).handleRoute(mock.route, req);

    expect(mock.continued).toBe(false);
    expect(mock.abortedReason).toBe('blockedbyclient');
    expect(interceptor.getStats().blockedReasons['ERR_UNAUTHORIZED_NAVIGATION_ORIGIN']).toBe(1);
  });

  it('blocks non-HTTP/HTTPS schemes (file, ftp, javascript)', async () => {
    const interceptor = new BrowserScopeInterceptor(defaultPolicy);

    const testSchemes = [
      'file:///C:/Windows/win.ini',
      'ftp://ftp.evil.com/payload.exe',
      'javascript:void(0)',
    ];

    for (const url of testSchemes) {
      const mock = createMockRoute();
      const req = createMockRequest(url);

      await (
        interceptor as unknown as { handleRoute: (r: Route, req: Request) => Promise<void> }
      ).handleRoute(mock.route, req);

      expect(mock.continued).toBe(false);
      expect(mock.abortedReason).toBe('blockedbyclient');
    }
  });

  it('allows data: URLs for images by default but blocks for documents/scripts', async () => {
    const interceptor = new BrowserScopeInterceptor(defaultPolicy);

    // Image data URL -> Allowed
    const imageMock = createMockRoute();
    const imageReq = createMockRequest(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      {
        resourceType: 'image',
      },
    );
    await (
      interceptor as unknown as { handleRoute: (r: Route, req: Request) => Promise<void> }
    ).handleRoute(imageMock.route, imageReq);
    expect(imageMock.continued).toBe(true);

    // Script data URL -> Blocked
    const scriptMock = createMockRoute();
    const scriptReq = createMockRequest('data:text/javascript,alert(1)', {
      resourceType: 'script',
    });
    await (
      interceptor as unknown as { handleRoute: (r: Route, req: Request) => Promise<void> }
    ).handleRoute(scriptMock.route, scriptReq);
    expect(scriptMock.continued).toBe(false);
    expect(scriptMock.abortedReason).toBe('blockedbyclient');
  });

  it('blocks loopback (127.0.0.1, localhost) and cloud metadata (169.254.169.254)', async () => {
    const interceptor = new BrowserScopeInterceptor(defaultPolicy);

    const prohibitedUrls = [
      'http://127.0.0.1:8080/admin',
      'http://localhost:3000/api',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.1/router',
    ];

    for (const url of prohibitedUrls) {
      const mock = createMockRoute();
      const req = createMockRequest(url);

      await (
        interceptor as unknown as { handleRoute: (r: Route, req: Request) => Promise<void> }
      ).handleRoute(mock.route, req);

      expect(mock.continued).toBe(false);
      expect(mock.abortedReason).toBe('blockedbyclient');
    }
  });

  it('enforces thirdPartyPolicy SAME_ORIGIN_ONLY on external subresources', async () => {
    const interceptor = new BrowserScopeInterceptor({
      authorizedOrigin: 'https://mysite.example.com',
      thirdPartyPolicy: 'SAME_ORIGIN_ONLY',
    });

    const mock = createMockRoute();
    const req = createMockRequest('https://cdn.thirdparty.com/style.css', {
      resourceType: 'stylesheet',
    });

    await (
      interceptor as unknown as { handleRoute: (r: Route, req: Request) => Promise<void> }
    ).handleRoute(mock.route, req);

    expect(mock.continued).toBe(false);
    expect(mock.abortedReason).toBe('blockedbyclient');
  });

  it('enforces thirdPartyPolicy ALLOW_CUSTOM_LIST correctly', async () => {
    const interceptor = new BrowserScopeInterceptor({
      authorizedOrigin: 'https://mysite.example.com',
      thirdPartyPolicy: 'ALLOW_CUSTOM_LIST',
      allowedAdditionalDomains: ['fonts.googleapis.com'],
    });

    // Whitelisted CDN -> Allowed
    const allowedMock = createMockRoute();
    const allowedReq = createMockRequest('https://fonts.googleapis.com/css?family=Roboto', {
      resourceType: 'stylesheet',
    });
    await (
      interceptor as unknown as { handleRoute: (r: Route, req: Request) => Promise<void> }
    ).handleRoute(allowedMock.route, allowedReq);
    expect(allowedMock.continued).toBe(true);

    // Non-whitelisted CDN -> Blocked
    const blockedMock = createMockRoute();
    const blockedReq = createMockRequest('https://malicious-cdn.com/evil.js', {
      resourceType: 'script',
    });
    await (
      interceptor as unknown as { handleRoute: (r: Route, req: Request) => Promise<void> }
    ).handleRoute(blockedMock.route, blockedReq);
    expect(blockedMock.continued).toBe(false);
    expect(blockedMock.abortedReason).toBe('blockedbyclient');
  });

  it('blocks WebSockets when allowWebSockets is false', async () => {
    const interceptor = new BrowserScopeInterceptor({
      authorizedOrigin: 'https://mysite.example.com',
      allowWebSockets: false,
    });

    const mock = createMockRoute();
    const req = createMockRequest('wss://mysite.example.com/socket', {
      resourceType: 'websocket',
    });

    await (
      interceptor as unknown as { handleRoute: (r: Route, req: Request) => Promise<void> }
    ).handleRoute(mock.route, req);

    expect(mock.continued).toBe(false);
    expect(mock.abortedReason).toBe('blockedbyclient');
  });
});
