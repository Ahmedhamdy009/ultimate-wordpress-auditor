import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SafeHttpClient } from '../../../src/main/scanner/client/http-client.js';
import { SCANNER_CLIENT_ERROR_CODES } from '../../../src/main/scanner/client/types.js';
import { RobotsEngine } from '../../../src/main/scanner/seo/robots-engine.js';
import { SitemapEngine } from '../../../src/main/scanner/seo/sitemap-engine.js';
import type { CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('DEF-008: RobotsEngine & SitemapEngine over real SafeHttpClient', () => {
  let server: http.Server;
  let port = 0;
  let origin = '';
  let serveMissing404 = false;

  const testHooks = {
    lookupFn: async (hostname: string) => {
      if (hostname === 'seo-fixture.test') {
        return [{ address: '93.184.216.34', family: 4 }];
      }
      throw new Error(`Unexpected hostname: ${hostname}`);
    },
    pinnedIpOverride: '127.0.0.1',
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://seo-fixture.test:${port}`);
      if (!serveMissing404 && url.pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`User-agent: *\nAllow: /\nDisallow: /private/\nSitemap: ${origin}/sitemap.xml\n`);
        return;
      }
      if (!serveMissing404 && url.pathname === '/sitemap.xml') {
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
            `  <url><loc>${origin}/</loc></url>\n` +
            `  <url><loc>${origin}/uncrawled-page</loc></url>\n` +
            `</urlset>\n`,
        );
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body>Not Found</body></html>');
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (typeof addr === 'object' && addr !== null) {
      port = addr.port;
      origin = `http://seo-fixture.test:${port}`;
    }
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('preserves fail-closed HTML-only default on SafeHttpClient without allowedMediaEssences', async () => {
    serveMissing404 = false;
    const client = new SafeHttpClient({}, testHooks);
    await expect(client.request({ url: `${origin}/robots.txt`, method: 'GET' })).rejects.toThrow(
      expect.objectContaining({ code: SCANNER_CLIENT_ERROR_CODES.ERR_NON_HTML_CONTENT_TYPE }),
    );
    await expect(client.request({ url: `${origin}/sitemap.xml`, method: 'GET' })).rejects.toThrow(
      expect.objectContaining({ code: SCANNER_CLIENT_ERROR_CODES.ERR_NON_HTML_CONTENT_TYPE }),
    );
  });

  it('fetches and parses real text/plain robots.txt and application/xml sitemap.xml without false missing findings', async () => {
    serveMissing404 = false;
    const client = new SafeHttpClient({}, testHooks);
    const robotsEngine = new RobotsEngine();
    const sitemapEngine = new SitemapEngine();

    const robotsRes = await robotsEngine.analyze({
      entryUrl: `${origin}/`,
      authorizedOrigin: origin,
      httpClient: client,
      crawledUrls: [`${origin}/`, `${origin}/private/secret`],
    });

    expect(robotsRes.exists).toBe(true);
    expect(robotsRes.coverage.status).toBe('full');
    expect(robotsRes.sitemapDirectives).toContain(`${origin}/sitemap.xml`);
    expect(robotsRes.findings.some(f => f.ruleId === 'SEO_ROBOTS_MISSING')).toBe(false);
    expect(robotsRes.findings.some(f => f.ruleId === 'SEO_ROBOTS_IMPORTANT_PAGE_BLOCKED')).toBe(
      true,
    );

    const crawledPage: CrawledPageResult = {
      requestedUrl: `${origin}/`,
      finalUrl: `${origin}/`,
      depth: 0,
      parentUrl: null,
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      contentType: 'text/html; charset=utf-8',
      isHtml: true,
      encodedBodyBytes: 100,
      decompressedBodyBytes: 100,
      responseTimeMs: 5,
      redirectHops: 0,
      redirectChain: [],
      discoveredLinks: [],
      error: null,
    };

    const sitemapRes = await sitemapEngine.analyze({
      authorizedOrigin: origin,
      entryUrl: `${origin}/`,
      httpClient: client,
      robotsSitemaps: robotsRes.sitemapDirectives,
      crawledPages: [crawledPage],
      isCrawlPartial: false,
    });

    expect(sitemapRes.discoveredSitemaps).toContain(`${origin}/sitemap.xml`);
    expect(sitemapRes.totalUrlsDiscovered).toBe(2);
    expect(sitemapRes.coverage.status).toBe('full');
    expect(sitemapRes.findings.some(f => f.ruleId === 'SEO_SITEMAP_MISSING')).toBe(false);
    expect(sitemapRes.findings.some(f => f.ruleId === 'SEO_SITEMAP_URL_NOT_CRAWLED')).toBe(true);
  });

  it('handles 404 text/html responses cleanly as missing robots.txt and sitemap.xml', async () => {
    serveMissing404 = true;
    const client = new SafeHttpClient({}, testHooks);
    const robotsEngine = new RobotsEngine();
    const sitemapEngine = new SitemapEngine();

    const robotsRes = await robotsEngine.analyze({
      entryUrl: `${origin}/`,
      authorizedOrigin: origin,
      httpClient: client,
      crawledUrls: [`${origin}/`],
    });
    expect(robotsRes.exists).toBe(false);
    expect(robotsRes.coverage.status).toBe('full');
    expect(robotsRes.findings.some(f => f.ruleId === 'SEO_ROBOTS_MISSING')).toBe(true);

    const sitemapRes = await sitemapEngine.analyze({
      authorizedOrigin: origin,
      entryUrl: `${origin}/`,
      httpClient: client,
      robotsSitemaps: [`${origin}/sitemap.xml`],
      crawledPages: [],
      isCrawlPartial: false,
    });
    expect(sitemapRes.discoveredSitemaps).toHaveLength(0);
    expect(sitemapRes.findings.some(f => f.ruleId === 'SEO_SITEMAP_MISSING')).toBe(true);
    expect(sitemapRes.findings.some(f => f.ruleId === 'SEO_SITEMAP_HTTP_ERROR')).toBe(true);
    expect(sitemapRes.findings.some(f => f.ruleId === 'SEO_SITEMAP_UNREACHABLE')).toBe(false);
  });
});
