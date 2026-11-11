import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BoundedCrawler } from '../../../src/main/scanner/crawler/crawler.js';
import { SCANNER_CLIENT_ERROR_CODES } from '../../../src/main/scanner/client/types.js';

describe('BoundedCrawler Security & Regression Verification Suite', () => {
  let server: http.Server;
  let serverPort: number;
  const requestsMade: string[] = [];

  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requestsMade.push(req.url ?? '/');
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <h1>Scope Confinement Audit</h1>
            <!-- Internal in-scope links -->
            <a href="/internal-safe">Internal Safe Page</a>

            <!-- External cross-origin links -->
            <a href="https://external-bank.com/transfer">External Bank</a>
            <a href="https://evil-attacker.org/steal">Attacker</a>

            <!-- SSRF destinations -->
            <a href="http://169.254.169.254/latest/meta-data">AWS Metadata</a>
            <a href="http://127.0.0.1:8080/admin">Localhost Admin</a>
            <a href="http://10.0.0.1/router">Internal Router</a>

            <!-- Prohibited URI schemes -->
            <a href="javascript:alert(document.cookie)">JS Execution</a>
            <a href="data:text/html,evil">Data URI</a>
            <a href="file:///etc/passwd">File URI</a>
            <a href="vbscript:msgbox">VBScript</a>

            <!-- Form -->
            <form action="/delete-account" method="POST">
              <input type="hidden" name="id" value="12345">
              <button type="submit">Delete</button>
            </form>
          </body>
          </html>
        `);
      } else if (url.pathname === '/internal-safe') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><h1>Safe Leaf Page</h1></body></html>');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>OK</body></html>');
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

  it('guarantees ZERO requests outside authorized scope, zero form submissions, and zero script executions', async () => {
    requestsMade.length = 0;
    const crawler = new BoundedCrawler();
    const entryUrl = `http://audit-target.com:${serverPort}/`;

    const result = await crawler.crawl({
      entryUrl,
      maxPages: 20,
      maxDepth: 3,
      maxConcurrency: 1,
      testHooks: {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1',
      },
    });

    // Verify only the entry URL and the internal safe link were requested
    expect(requestsMade).toEqual(['/', '/internal-safe']);

    // Check summary statistics
    expect(result.summary.totalPagesAttempted).toBe(2);
    expect(result.summary.successfulPages).toBe(2);
    expect(result.summary.failedPages).toBe(0);

    // Verify external links were properly skipped from crawling
    expect(result.summary.urlsSkippedScope).toBeGreaterThanOrEqual(5);

    // Verify discovered links on the entry page
    const entryPage = result.pages.find(p => p.requestedUrl === entryUrl);
    expect(entryPage).toBeDefined();
    expect(entryPage?.isHtml).toBe(true);

    const links = entryPage?.parsedDocument?.links ?? [];

    // External bank link
    const bankLink = links.find(l => l.originalValue.includes('external-bank.com'));
    expect(bankLink).toBeDefined();
    expect(bankLink?.isInternal).toBe(false);
    expect(bankLink?.isEligibleForCrawl).toBe(false);
    expect(bankLink?.rejectionReason).toBe('EXTERNAL_ORIGIN');

    // JS pseudo-protocol link
    const jsLink = links.find(l => l.originalValue.startsWith('javascript:'));
    expect(jsLink).toBeDefined();
    expect(jsLink?.isEligibleForCrawl).toBe(false);
    expect(jsLink?.rejectionReason).toBe('INVALID_OR_DISALLOWED_PROTOCOL');

    // File URI link
    const fileLink = links.find(l => l.originalValue.startsWith('file:'));
    expect(fileLink).toBeDefined();
    expect(fileLink?.isEligibleForCrawl).toBe(false);

    // Data URI link
    const dataLink = links.find(l => l.originalValue.startsWith('data:'));
    expect(dataLink).toBeDefined();
    expect(dataLink?.isEligibleForCrawl).toBe(false);

    // Form extraction verification: extracted without triggering submission
    const forms = entryPage?.parsedDocument?.forms ?? [];
    expect(forms).toHaveLength(1);
    expect(forms[0].action).toBe(`http://audit-target.com:${serverPort}/delete-account`);
    expect(forms[0].method).toBe('post');

    // Verify /delete-account was NEVER requested or submitted
    expect(requestsMade).not.toContain('/delete-account');
  });

  it('blocks SSRF destinations fail-closed during crawling', async () => {
    const crawler = new BoundedCrawler();
    const ssrfMetadataUrl = 'http://metadata.aws/latest/meta-data';

    const mockMetadataLookup = async () => [{ address: '169.254.169.254', family: 4 }];

    const result = await crawler.crawl({
      entryUrl: ssrfMetadataUrl,
      testHooks: {
        lookupFn: mockMetadataLookup,
      },
    });

    expect(result.summary.totalPagesAttempted).toBe(1);
    expect(result.summary.failedPages).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe(SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP);
  });
});
