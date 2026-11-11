import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BoundedCrawler } from '../../../src/main/scanner/crawler/crawler.js';
import { SCANNER_CRAWLER_ERROR_CODES } from '../../../src/main/scanner/crawler/errors.js';
import type { SafeHttpClientTestHooks } from '../../../src/main/scanner/client/types.js';

describe('BoundedCrawler Engine End-to-End Integration', () => {
  let server: http.Server;
  let serverPort: number;
  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Home Page</title></head>
          <body>
            <h1>Home</h1>
            <a href="/about">About Us</a>
            <a href="/contact">Contact</a>
            <a href="/blog">Blog</a>
            <a href="https://external-partner.com/docs">External Docs</a>
            <a href="#section">Hash Section</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/about') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>About Us</title></head>
          <body>
            <h1>About</h1>
            <a href="/team">Our Team</a>
            <a href="/">Back to Home (cycle)</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/contact') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Contact</title></head>
          <body>
            <h1>Contact Us</h1>
            <a href="/contact-form">Contact Form</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/blog') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Blog</title></head>
          <body>
            <h1>Blog Archive</h1>
            <a href="/blog/post-1">Post 1</a>
            <a href="/blog/post-2">Post 2</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/team') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Team</title></head>
          <body>
            <h1>Team</h1>
            <a href="/team/member-1">Member 1</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/team/member-1') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Member 1</title></head>
          <body>
            <h1>Member 1</h1>
            <a href="/team/member-1/details">Deep Details</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/team/member-1/details') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><h1>Level 4 Depth Details</h1></body></html>');
      } else if (url.pathname === '/contact-form') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <form action="/submit-contact" method="POST">
              <input type="text" name="name" required>
              <button type="submit">Send</button>
            </form>
          </body>
          </html>
        `);
      } else if (url.pathname === '/non-html-asset') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', message: 'api endpoint' }));
      } else if (url.pathname === '/error-hub') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html><html><body>
            <a href="/error-404">Not Found</a>
            <a href="/error-500">Server Error</a>
            <a href="/about">Healthy About</a>
          </body></html>
        `);
      } else if (url.pathname === '/error-500') {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>Server Error</body></html>');
      } else if (url.pathname === '/error-404') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>Not Found</body></html>');
      } else if (url.pathname === '/slow-page') {
        // Delay response to test timeout/abort
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<!DOCTYPE html><html><body>Slow Content</body></html>');
          }
        }, 1000);
      } else if (url.pathname === '/link-bomb') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        let links = '';
        for (let i = 0; i < 50; i++) {
          links += `<a href="/bomb-${i}">Bomb Link ${i}</a> `;
        }
        res.end(`<!DOCTYPE html><html><body>${links}</body></html>`);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><body>Dynamic page: ${url.pathname}</body></html>`);
      }
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        serverPort = address.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  const getTestHooks = (): SafeHttpClientTestHooks => ({
    lookupFn: mockPublicLookup,
    pinnedIpOverride: '127.0.0.1',
  });

  it('performs breadth-first crawl traversal and deduplicates cycle links', async () => {
    const crawler = new BoundedCrawler();
    const entryUrl = `http://audit-target.com:${serverPort}/`;

    const result = await crawler.crawl({
      entryUrl,
      maxPages: 10,
      maxDepth: 2,
      maxConcurrency: 2,
      testHooks: getTestHooks(),
    });

    expect(result.summary.totalPagesAttempted).toBeGreaterThanOrEqual(4);
    expect(result.summary.successfulPages).toBeGreaterThanOrEqual(4);
    expect(result.summary.failedPages).toBe(0);
    expect(result.summary.cancelled).toBe(false);

    // Verify deduplication: entry URL was only crawled once despite /about linking back to /
    const rootPageCrawls = result.pages.filter(
      p => p.requestedUrl === entryUrl || p.finalUrl === entryUrl,
    );
    expect(rootPageCrawls).toHaveLength(1);

    // Verify external links were skipped from scope crawling
    expect(result.summary.urlsSkippedScope).toBeGreaterThan(0);
    expect(result.discoveredUrls.some(u => u.includes('external-partner.com'))).toBe(false);
  });

  it('strictly bounds crawling to maxPages', async () => {
    const crawler = new BoundedCrawler();
    const entryUrl = `http://audit-target.com:${serverPort}/`;

    const result = await crawler.crawl({
      entryUrl,
      maxPages: 3,
      maxDepth: 3,
      maxConcurrency: 1,
      testHooks: getTestHooks(),
    });

    expect(result.summary.totalPagesAttempted).toBe(3);
    expect(result.pages).toHaveLength(3);
  });

  it('strictly bounds crawling to maxDepth', async () => {
    const crawler = new BoundedCrawler();
    const entryUrl = `http://audit-target.com:${serverPort}/about`;

    // Depth 0: /about -> links to /team (depth 1) -> links to /team/member-1 (depth 2) -> links to details (depth 3)
    const result = await crawler.crawl({
      entryUrl,
      maxPages: 20,
      maxDepth: 1,
      maxConcurrency: 2,
      testHooks: getTestHooks(),
    });

    // With maxDepth = 1, /about (depth 0) and /team (depth 1) are crawled, but /team/member-1 is NOT crawled
    expect(result.summary.maxDepthReached).toBeLessThanOrEqual(1);
    const depth2Crawls = result.pages.filter(p => p.depth > 1);
    expect(depth2Crawls).toHaveLength(0);
  });

  it('bounds per-page enqueued links via maxDiscoveredLinksPerPage', async () => {
    const crawler = new BoundedCrawler();
    const entryUrl = `http://audit-target.com:${serverPort}/link-bomb`;

    const result = await crawler.crawl({
      entryUrl,
      maxPages: 20,
      maxDepth: 1,
      maxConcurrency: 1,
      maxDiscoveredLinksPerPage: 3,
      testHooks: getTestHooks(),
    });

    // 1 (entry) + 3 (discovered) = 4 total pages attempted
    expect(result.summary.totalPagesAttempted).toBe(4);
    expect(result.summary.urlsSkippedLimits).toBe(47); // 50 total links - 3 enqueued = 47 skipped
  });

  it('handles non-HTML responses safely without crashing or HTML parsing', async () => {
    const crawler = new BoundedCrawler();
    const entryUrl = `http://audit-target.com:${serverPort}/non-html-asset`;

    const result = await crawler.crawl({
      entryUrl,
      maxPages: 5,
      testHooks: getTestHooks(),
    });

    expect(result.summary.totalPagesAttempted).toBe(1);
    expect(result.summary.nonHtmlPages).toBe(1);
    expect(result.pages[0].isHtml).toBe(false);
    expect(result.pages[0].parsedDocument).toBeNull();
    expect(result.pages[0].contentType).toContain('application/json');
  });

  it('isolates single-page HTTP errors and continues crawl execution', async () => {
    const crawler = new BoundedCrawler();
    const errorHubUrl = `http://audit-target.com:${serverPort}/error-hub`;

    const result = await crawler.crawl({
      entryUrl: errorHubUrl,
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1,
      testHooks: getTestHooks(),
    });

    expect(result.summary.totalPagesAttempted).toBe(4);
    // /error-hub (200), /about (200), /error-404 (404), /error-500 (500)
    expect(result.summary.successfulPages).toBeGreaterThanOrEqual(2);
    expect(result.pages).toHaveLength(4);
  });

  it('aborts cleanly when external AbortSignal is triggered', async () => {
    const crawler = new BoundedCrawler();
    const entryUrl = `http://audit-target.com:${serverPort}/slow-page`;
    const controller = new AbortController();

    // Trigger abort after 50ms
    setTimeout(() => {
      controller.abort();
    }, 50);

    const result = await crawler.crawl({
      entryUrl,
      maxPages: 10,
      signal: controller.signal,
      testHooks: getTestHooks(),
    });

    expect(result.summary.cancelled).toBe(true);
    expect(result.summary.cancellationReason).toBe('USER_ABORT');
  });

  it('stops cleanly when overall crawl maxDurationMs is exceeded', async () => {
    const crawler = new BoundedCrawler();
    const entryUrl = `http://audit-target.com:${serverPort}/slow-page`;

    const result = await crawler.crawl({
      entryUrl,
      maxPages: 10,
      maxDurationMs: 100, // 100ms overall timeout
      testHooks: getTestHooks(),
    });

    expect(result.summary.cancelled).toBe(true);
    expect(result.summary.cancellationReason).toBe('TIMEOUT_REACHED');
  });

  it('rejects invalid or prohibited entry URL before making network calls', async () => {
    const crawler = new BoundedCrawler();

    await expect(
      crawler.crawl({
        entryUrl: 'javascript:alert(1)',
        testHooks: getTestHooks(),
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CRAWLER_ERROR_CODES.ERR_CRAWL_INVALID_ENTRY_URL,
      }),
    );
  });

  it('rejects entry URL whose origin does not match authorizedOrigin', async () => {
    const crawler = new BoundedCrawler();

    await expect(
      crawler.crawl({
        entryUrl: `http://audit-target.com:${serverPort}/`,
        authorizedOrigin: 'https://different-authorized-domain.com',
        testHooks: getTestHooks(),
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CRAWLER_ERROR_CODES.ERR_CRAWL_OUT_OF_SCOPE,
      }),
    );
  });

  it('emits progress updates during crawl execution', async () => {
    const crawler = new BoundedCrawler();
    const entryUrl = `http://audit-target.com:${serverPort}/`;
    const progressUpdates: number[] = [];

    await crawler.crawl(
      {
        entryUrl,
        maxPages: 3,
        maxConcurrency: 1,
        testHooks: getTestHooks(),
      },
      p => {
        progressUpdates.push(p.pagesCrawled);
      },
    );

    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
    expect(progressUpdates[0]).toBe(1);
  });
});
