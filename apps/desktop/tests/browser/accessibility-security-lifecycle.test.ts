import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { AccessibilityAuditor } from '../../src/main/browser/accessibility-auditor.js';
import {
  sanitizeSnippet,
  boundEvidenceSize,
  sanitizeNodeResult,
  IdentifierAliaser,
} from '../../src/main/browser/accessibility-sanitizer.js';
import type { AccessibilityNodeEvidence } from '../../src/main/browser/accessibility-types.js';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { generateJsonReport } from '../../src/main/reports/json-generator.js';
import { generateHtmlReport } from '../../src/main/reports/html-generator.js';
import { AccessibilityAnalyzer } from '../../src/main/browser/accessibility-analyzer.js';
import type { ReportModel } from '../../src/main/reports/types.js';

describe('Accessibility Engine — Security, Privacy & Lifecycle Resilience Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;
  const interceptedRequests: string[] = [];

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      interceptedRequests.push(req.url ?? '/');
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/sensitive-form.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Sensitive Page</title></head>
            <body>
              <form action="/login?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sample&api_key=sk_live_1234567890abcdef">
                <input id="pwd-field" type="password" name="password" value="SuperSecretPassword999!">
                <input id="email-field" type="email" name="user_email" value="confidential@enterprise.com">
                <input id="phone-field" type="tel" name="phone" value="+1-555-867-5309">
                <input id="name-field" type="text" name="full_name" value="Alexander Hamilton">
                <input id="address-field" type="text" name="address" value="742 Evergreen Terrace">
                <input id="dob-field" type="date" name="dob" value="1980-05-20">
                <input id="card-field" name="cc_num" autocomplete="cc-number" value="4111-2222-3333-4444">
                <textarea id="notes-field" name="notes">Patient Alexander Hamilton living at 742 Evergreen Terrace, DOB 1980-05-20, user ssn is 123-45-6789, email is admin@secure.net, call 555-019-9832</textarea>
                <div id="editable-area" contenteditable="true" data-secret="token-xyz-12345" data-address="742 Evergreen Terrace">
                  Private information A
                  <div>
                    Private information B
                    <span>Nested sensitive memo</span>
                  </div>
                  Private information C
                  Editable secret notes for Alexander Hamilton with card 4111222233334444 and DOB 1980-05-20
                </div>
                <button type="submit" aria-label="Send to support@corp.com" title="Direct dial: 555-123-4567"></button>
              </form>
            </body>
          </html>
        `);
      } else if (url.pathname === '/target-size.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <title>Target Size Test</title>
              <style>
                .tiny-target {
                  display: inline-block;
                  width: 12px;
                  height: 12px;
                  margin: 0;
                  padding: 0;
                  font-size: 10px;
                  line-height: 12px;
                }
              </style>
            </head>
            <body>
              <main>
                <h1>Target Size Minimum</h1>
                <a href="#link-1" class="tiny-target" id="link-1">1</a>
                <a href="#link-2" class="tiny-target" id="link-2">2</a>
              </main>
            </body>
          </html>
        `);
      } else if (url.pathname === '/slow-page.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Slow Page</title></head>
            <body>
              <h1>Slow Page</h1>
              <!-- Create a massive DOM tree to simulate heavy evaluation -->
              <script>
                for (let i = 0; i < 5000; i++) {
                  const div = document.createElement('div');
                  div.innerHTML = '<span role="button">Item ' + i + '</span>';
                  document.body.appendChild(div);
                }
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/adversarial-pii.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Adversarial PII Audit Fixture</title></head>
            <body>
              <header>
                <h1>Adversarial Page</h1>
              </header>
              <main>
                <!-- 1. Personal name in a text node (violates color-contrast) -->
                <div id="pii-name-node" role="button" tabindex="0" style="color: #777; background: #888;">
                  Customer Account: Alexander Hamilton
                </div>

                <!-- 2. Home address in a text node and personal ID (violates color-contrast) -->
                <p id="customer-742-evergreen-terrace" style="color: #777; background: #888;">
                  Shipping Address: 742 Evergreen Terrace, Springfield, OR 97477
                </p>

                <!-- 3. Personal name in ID, aria-label, and multiple class tokens (violates color-contrast) -->
                <button id="alexander-hamilton-btn" class="user-alexander-hamilton patient-555-019-9832 btn" aria-label="View account of Alexander Hamilton" style="color: #777; background: #888;">
                  Action
                </button>

                <!-- 4. Repeated reference to alexander-hamilton-btn via aria-controls and customer-742-evergreen-terrace via aria-describedby -->
                <div id="controller-elem" aria-controls="alexander-hamilton-btn" aria-describedby="customer-742-evergreen-terrace" role="button" tabindex="0" style="color: #777; background: #888;">
                  Account Controller
                </div>

                <!-- 5. Address in alt text -->
                <img id="pii-alt-img" alt="Alexander Hamilton residence at 742 Evergreen Terrace" src="/missing-avatar.png" width="8" height="8">

                <!-- 6. Arbitrary user-entered text in textarea -->
                <textarea id="pii-user-text" name="notes">Patient health notes: Alexander Hamilton underwent surgery on 2024-05-12. Contact spouse at 555-019-9832.</textarea>

                <!-- 7. Sensitive content inside nested elements with nested IDs -->
                <section id="sec-alexander-hamilton">
                  <div id="nested-chart-alexander-hamilton" contenteditable="true" data-secret="raw-secret-token-777" data-customer-name="Alexander Hamilton">
                    Confidential medical chart for Alexander Hamilton
                    <section>
                      <div>
                        Billing location: 742 Evergreen Terrace
                        <span>Payment token: sk_live_adversarial_token_999 and SSN: 000-12-3456</span>
                      </div>
                      <p>Doctor remarks regarding Alexander Hamilton</p>
                    </section>
                    Closing clinical memo for Alexander Hamilton
                  </div>
                </section>

                <!-- 8. Input with runtime user value -->
                <input id="pii-input-val" type="text" name="user_query" value="Search query for Alexander Hamilton at 742 Evergreen Terrace">
              </main>
            </body>
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
    AccessibilityAuditor.clearLocks();
    if (manager) {
      await manager.close();
    }
    if (fixtureServer) {
      await new Promise(resolve => fixtureServer.close(resolve));
    }
  });

  it('1. strictly redacts emails, phones, payment cards, passwords, names, and tokens from HTML snippets', () => {
    const rawSnippet =
      '<form action="/auth?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret&api_key=sk_live_99999999999999999">' +
      '<input type="password" name="pwd" value="SuperSecretP@ssword123">' +
      '<input type="email" name="email_addr" value="ceo@acme-corp.com">' +
      '<input type="tel" name="phone" value="+1-555-888-9999">' +
      '<input type="text" name="full_name" value="Alexander Hamilton">' +
      '<input type="text" name="address" value="742 Evergreen Terrace">' +
      '<input type="date" name="dob" value="1980-05-20">' +
      '<input name="credit_card" autocomplete="cc-number" value="4111-2222-3333-4444">' +
      '<textarea name="details">Contact info: test@secure.com or 555-222-3333, patient Alexander Hamilton, 742 Evergreen Terrace, DOB 1980-05-20</textarea>' +
      '<div contenteditable="true" data-secret="priv-token-888" data-user="Alexander Hamilton">Private notes for Alexander Hamilton at 742 Evergreen Terrace</div>' +
      '<p class="card-display">Card on file: 4111-2222-3333-4444</p>' +
      '<span class="record-date">DOB: 1980-05-20</span>' +
      '<button aria-label="Mail info@domain.com" title="Call 555-999-0000"></button>' +
      '</form>';

    const sanitized = sanitizeSnippet(rawSnippet, 2000);

    // Assert sensitive items are removed
    expect(sanitized).not.toContain('SuperSecretP@ssword123');
    expect(sanitized).not.toContain('ceo@acme-corp.com');
    expect(sanitized).not.toContain('+1-555-888-9999');
    expect(sanitized).not.toContain('Alexander Hamilton');
    expect(sanitized).not.toContain('742 Evergreen Terrace');
    expect(sanitized).not.toContain('1980-05-20');
    expect(sanitized).not.toContain('4111-2222-3333-4444');
    expect(sanitized).not.toContain('test@secure.com');
    expect(sanitized).not.toContain('priv-token-888');
    expect(sanitized).not.toContain('info@domain.com');

    // Assert redaction tokens are in place
    expect(sanitized).toContain('[REDACTED]');
    expect(sanitized).toContain('[REDACTED_CONTENT]');
    expect(sanitized).toContain('[REDACTED_EMAIL]');
    expect(sanitized).toContain('[REDACTED_PHONE]');
    expect(sanitized).toContain('[REDACTED_CARD]');
    expect(sanitized).toContain('[REDACTED_DATE]');
  });

  it('1b. strictly redacts nested contenteditable structures with multiple inner divs, paragraphs, and spans without leaking intermediate text', () => {
    // User's exact adversarial example
    const userExample =
      '<div contenteditable="true">\n' +
      '  Private information A\n' +
      '  <div>\n' +
      '    Private information B\n' +
      '  </div>\n' +
      '  Private information C\n' +
      '</div>';

    const sanitizedUserExample = sanitizeSnippet(userExample, 1000);

    expect(sanitizedUserExample).not.toContain('Private information A');
    expect(sanitizedUserExample).not.toContain('Private information B');
    expect(sanitizedUserExample).not.toContain('Private information C');
    expect(sanitizedUserExample).toBe('<div contenteditable="true">[REDACTED_CONTENT]</div>');

    // Deeply nested contenteditable containing paragraphs, spans, and nested divisions inside a section
    const deepNestedSnippet =
      '<section class="patient-record" id="rec-42">\n' +
      '  <div contenteditable="true" aria-label="Clinical notes" data-secret="token-99" data-dob="1980-05-20">\n' +
      '    <p>Diagnosis: Secret condition for Alexander Hamilton</p>\n' +
      '    <div>\n' +
      '      <span>Sub-section: 742 Evergreen Terrace</span>\n' +
      '      <div>Deep note: Card 4111-2222-3333-4444</div>\n' +
      '    </div>\n' +
      '    Closing memo for Alexander Hamilton\n' +
      '  </div>\n' +
      '  <textarea name="summary">Prescription notes with SSN 123-45-6789</textarea>\n' +
      '  <input type="search" name="q" value="Alexander Hamilton Search">\n' +
      '</section>';

    const sanitizedDeep = sanitizeSnippet(deepNestedSnippet, 2000);

    // Verify safe diagnostics and structural elements are preserved
    expect(sanitizedDeep).toContain('<section class="cls-alias-1" id="rec-42">');
    expect(sanitizedDeep).not.toContain('patient-record');
    expect(sanitizedDeep).toContain(
      '<div contenteditable="true" aria-label="[REDACTED]" data-secret="[REDACTED]" data-dob="[REDACTED]">[REDACTED_CONTENT]</div>',
    );
    expect(sanitizedDeep).toContain('<textarea name="summary">[REDACTED_CONTENT]</textarea>');
    expect(sanitizedDeep).toContain('<input type="search" name="q" value="[REDACTED]">');

    // Verify zero occurrences of all private data
    expect(sanitizedDeep).not.toContain('Alexander Hamilton');
    expect(sanitizedDeep).not.toContain('742 Evergreen Terrace');
    expect(sanitizedDeep).not.toContain('4111-2222-3333-4444');
    expect(sanitizedDeep).not.toContain('1980-05-20');
    expect(sanitizedDeep).not.toContain('Secret condition');
    expect(sanitizedDeep).not.toContain('token-99');
    expect(sanitizedDeep).not.toContain('Prescription notes');
  });

  it('1c. robustly handles malformed HTML, unclosed tags, and broken attributes without bypassing redaction', () => {
    // 1. Unclosed nested tag inside contenteditable
    const unclosedContentEditable =
      '<div contenteditable="true">Unclosed <div class="bad">Secret nested <span>broken tags';
    const sanitizedUnclosed = sanitizeSnippet(unclosedContentEditable, 1000);
    expect(sanitizedUnclosed).toContain('<div contenteditable="true">[REDACTED_CONTENT]</div>');
    expect(sanitizedUnclosed).not.toContain('Secret nested');

    // 2. Unclosed quote in input value
    const malformedInput = '<input value="Unclosed secret quote id="bad">';
    const sanitizedInput = sanitizeSnippet(malformedInput, 1000);
    expect(sanitizedInput).toContain('value="[REDACTED]"');
    expect(sanitizedInput).not.toContain('Unclosed secret quote');

    // 3. Bare contenteditable with inner bold tags and text
    const bareEditable =
      '<div contenteditable>No attr value with <b>nested bold secret</b> and trailing notes</div>';
    const sanitizedBare = sanitizeSnippet(bareEditable, 1000);
    expect(sanitizedBare).toBe('<div contenteditable>[REDACTED_CONTENT]</div>');
    expect(sanitizedBare).not.toContain('nested bold secret');

    // 4. Stray angle brackets
    const strayBrackets =
      '<div><<<>>>random bad syntax <div contenteditable="true">Secret inside</div></div>';
    const sanitizedStray = sanitizeSnippet(strayBrackets, 1000);
    expect(sanitizedStray).toContain('<div contenteditable="true">[REDACTED_CONTENT]</div>');
    expect(sanitizedStray).not.toContain('Secret inside');
  });

  it('2. sanitizes node-level checks and failure summaries so sensitive text cannot enter evidence', () => {
    const rawNode = {
      html: '<input type="email" name="user_email" value="confidential@enterprise.com">',
      target: ['#email-field'],
      failureSummary:
        'Element has invalid email value confidential@enterprise.com and phone 555-123-4567',
      any: [
        {
          id: 'label',
          impact: 'critical',
          message:
            'Form field with value confidential@enterprise.com and card 4111-2222-3333-4444 is unlabeled',
        },
      ],
    };

    const sanitizedNode = sanitizeNodeResult(rawNode, 500);

    expect(sanitizedNode.html).not.toContain('confidential@enterprise.com');
    expect(sanitizedNode.html).toContain('[REDACTED]');

    expect(sanitizedNode.failureSummary).not.toContain('confidential@enterprise.com');
    expect(sanitizedNode.failureSummary).toContain('[REDACTED_EMAIL]');
    expect(sanitizedNode.failureSummary).toContain('[REDACTED_PHONE]');

    expect(sanitizedNode.any?.[0].message).not.toContain('confidential@enterprise.com');
    expect(sanitizedNode.any?.[0].message).not.toContain('4111-2222-3333-4444');
    expect(sanitizedNode.any?.[0].message).toContain('[REDACTED_EMAIL]');
    expect(sanitizedNode.any?.[0].message).toContain('[REDACTED_CARD]');
  });

  it('3. strictly bounds evidence byte size when payload exceeds maximum byte limits', () => {
    const largeObject: Record<string, unknown> = {
      ruleId: 'image-alt',
      nodes: Array.from({ length: 50 }, (_, i) => ({
        index: i,
        filler: 'A'.repeat(500),
      })),
    };

    const bounded = boundEvidenceSize(largeObject, 512);

    expect(bounded.truncated).toBe(true);
    expect(bounded.summary).toBeDefined();
  });

  it('4. handles page closure gracefully without crashing or uncaught rejections', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor();

    await managedPage.page.goto(`http://audit-target.test:${fixturePort}/sensitive-form.html`, {
      waitUntil: 'domcontentloaded',
    });

    // Intentionally close the page before audit starts
    await managedPage.page.close();

    const report = await auditor.auditPage(managedPage.page);

    expect(report.error).toBeDefined();
    expect(report.error).toContain('closed');
    expect(report.cancellationState).toBe('terminated_by_page_close');
    expect(report.violations.length).toBe(0);
    expect(report.findings.length).toBe(0);

    await managedPage.release();
  });

  it('5. distinguishes timeout response returned to caller from browser execution, and prevents overlapping audit on same page', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      timeoutMs: 1, // Extremely short timeout guarantees caller times out
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/slow-page.html`, {
        waitUntil: 'domcontentloaded',
      });

      // 1. Audit 1 times out immediately for caller
      const report1 = await auditor.auditPage(managedPage.page);

      expect(report1.limitsReached.timeout).toBe(true);
      expect(report1.error).toContain('timed out');
      expect(report1.cancellationState).toBe('caller_timeout_renderer_pending');

      // 2. Immediate second audit on the same page while the first is still processing is safely blocked
      const report2 = await auditor.auditPage(managedPage.page);
      expect(report2.cancellationState).toBe('overlapping_prevented');
      expect(report2.error).toContain(
        'Concurrent or overlapping accessibility audit on the same page is not permitted',
      );
    } finally {
      await managedPage.release();
    }
  });

  it('6. hard terminates browser execution upon cancellation when closePageOnCancel is configured and ownership is exclusive', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      timeoutMs: 1,
      pageOwnership: 'exclusive',
      closePageOnCancel: true,
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/slow-page.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      expect(report.limitsReached.timeout).toBe(true);
      expect(report.cancellationState).toBe('terminated_by_page_close');
      expect(managedPage.page.isClosed()).toBe(true);
    } finally {
      await managedPage.release();
    }
  });

  it('6b. preserves page open when pageOwnership is shared (default) even if closePageOnCancel is configured', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      timeoutMs: 1,
      pageOwnership: 'shared',
      closePageOnCancel: true,
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/slow-page.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      expect(report.limitsReached.timeout).toBe(true);
      expect(report.cancellationState).toBe('caller_timeout_renderer_pending');
      expect(managedPage.page.isClosed()).toBe(false);
    } finally {
      await managedPage.release();
    }
  });

  it('6c. guarantees isolation between concurrent pages in the same browser context when one page is cancelled', async () => {
    const managedPage1 = await manager.acquirePage();
    const managedPage2 = await manager.acquirePage();

    try {
      await Promise.all([
        managedPage1.page.goto(`http://audit-target.test:${fixturePort}/slow-page.html`, {
          waitUntil: 'domcontentloaded',
        }),
        managedPage2.page.goto(`http://audit-target.test:${fixturePort}/sensitive-form.html`, {
          waitUntil: 'domcontentloaded',
        }),
      ]);

      const auditor1 = new AccessibilityAuditor({
        timeoutMs: 1,
        pageOwnership: 'exclusive',
        closePageOnCancel: true,
      });

      const auditor2 = new AccessibilityAuditor({
        timeoutMs: 20000,
        tags: ['wcag2a'],
      });

      // Page 1 is cancelled/terminated
      const report1 = await auditor1.auditPage(managedPage1.page);
      expect(report1.limitsReached.timeout).toBe(true);
      expect(report1.cancellationState).toBe('terminated_by_page_close');
      expect(managedPage1.page.isClosed()).toBe(true);

      // Page 2 executes audit normally with zero cross-contamination
      const report2 = await auditor2.auditPage(managedPage2.page);
      expect(report2.cancellationState).toBe('completed');
      expect(report2.error).toBeUndefined();
      expect(report2.metrics.violationsCount).toBeGreaterThan(0);
      expect(managedPage2.page.isClosed()).toBe(false);
    } finally {
      await managedPage1.release();
      await managedPage2.release();
    }
  });

  it('7. respects cancellation signal cleanly and aborts audit immediately', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor();

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/sensitive-form.html`, {
        waitUntil: 'domcontentloaded',
      });

      const controller = new AbortController();
      controller.abort(); // already cancelled

      const report = await auditor.auditPage(managedPage.page, {
        signal: controller.signal,
      });

      expect(report.error).toContain('aborted by caller signal');
      expect(report.cancellationState).toBe('caller_aborted_renderer_pending');
      expect(report.violations.length).toBe(0);
    } finally {
      await managedPage.release();
    }
  });

  it('8. strictly prevents renderer filesystem and Node.js API access from page context', async () => {
    const managedPage = await manager.acquirePage();

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/sensitive-form.html`, {
        waitUntil: 'domcontentloaded',
      });

      const auditor = new AccessibilityAuditor();
      await auditor.auditPage(managedPage.page);

      // Verify page context has zero access to Node.js / Electron APIs
      const nodeApisCheck = await managedPage.page.evaluate(() => {
        return {
          hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
          hasProcess: typeof (window as unknown as { process?: unknown }).process !== 'undefined',
          hasBuffer: typeof (window as unknown as { Buffer?: unknown }).Buffer !== 'undefined',
          hasElectron:
            typeof (window as unknown as { electron?: unknown }).electron !== 'undefined',
        };
      });

      expect(nodeApisCheck.hasRequire).toBe(false);
      expect(nodeApisCheck.hasProcess).toBe(false);
      expect(nodeApisCheck.hasBuffer).toBe(false);
      expect(nodeApisCheck.hasElectron).toBe(false);
    } finally {
      await managedPage.release();
    }
  });

  it('9. verifies axe-core was injected locally via CDP without external network or CDN requests', async () => {
    const managedPage = await manager.acquirePage();

    try {
      interceptedRequests.length = 0; // reset tracker

      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/sensitive-form.html`, {
        waitUntil: 'domcontentloaded',
      });

      const auditor = new AccessibilityAuditor();
      await auditor.auditPage(managedPage.page);

      // Verify no request for axe.js, cdnjs, unpkg, or any axe script was made over HTTP
      const cdnRequests = interceptedRequests.filter(
        url => url.includes('axe') || url.includes('cdn') || url.includes('cdnjs'),
      );
      expect(cdnRequests.length).toBe(0);
    } finally {
      await managedPage.release();
    }
  });

  it('10. verifies serialized finding evidence and report output never contain unredacted secrets or personal data', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/sensitive-form.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      // Serialize entire findings array and report as it would be written to SQLite or JSON report
      const serializedReport = JSON.stringify(report);
      const serializedFindings = JSON.stringify(report.findings);

      expect(serializedReport).not.toContain('SuperSecretPassword999!');
      expect(serializedReport).not.toContain('confidential@enterprise.com');
      expect(serializedReport).not.toContain('+1-555-867-5309');
      expect(serializedReport).not.toContain('4111-2222-3333-4444');
      expect(serializedReport).not.toContain('admin@secure.net');
      expect(serializedReport).not.toContain('555-019-9832');
      expect(serializedReport).not.toContain('token-xyz-12345');
      expect(serializedReport).not.toContain('4111222233334444');
      expect(serializedReport).not.toContain('support@corp.com');
      expect(serializedReport).not.toContain('555-123-4567');
      expect(serializedReport).not.toContain('Alexander Hamilton');
      expect(serializedReport).not.toContain('742 Evergreen Terrace');
      expect(serializedReport).not.toContain('1980-05-20');
      expect(serializedReport).not.toContain('Private information A');
      expect(serializedReport).not.toContain('Private information B');
      expect(serializedReport).not.toContain('Private information C');
      expect(serializedReport).not.toContain('Nested sensitive memo');

      expect(serializedFindings).not.toContain('SuperSecretPassword999!');
      expect(serializedFindings).not.toContain('confidential@enterprise.com');
      expect(serializedFindings).not.toContain('4111-2222-3333-4444');
      expect(serializedFindings).not.toContain('Alexander Hamilton');
      expect(serializedFindings).not.toContain('742 Evergreen Terrace');
      expect(serializedFindings).not.toContain('1980-05-20');
      expect(serializedFindings).not.toContain('Private information A');
      expect(serializedFindings).not.toContain('Private information B');
      expect(serializedFindings).not.toContain('Private information C');
      expect(serializedFindings).not.toContain('Nested sensitive memo');
    } finally {
      await managedPage.release();
    }
  });

  it('11. verifies real Chromium evaluation of WCAG 2.2 target-size (wcag22aa / wcag258) touch target rule', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag22aa'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/target-size.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      // Verify wcag22aa standard tag was evaluated
      expect(report.wcagStandards).toContain('wcag22aa');
      expect(report.cancellationState).toBe('completed');
      expect(report.error).toBeUndefined();

      // axe-core runs target-size under wcag22aa
      const targetSizeResult =
        report.violations.find(v => v.id === 'target-size') ||
        report.incomplete.find(i => i.id === 'target-size');

      expect(targetSizeResult).toBeDefined();
      expect(targetSizeResult?.tags).toContain('wcag22aa');
      expect(targetSizeResult?.tags).toContain('wcag258');
      expect(targetSizeResult?.wcagCriteria).toContain(
        'WCAG 2.5.8 Target Size (Minimum) (Level AA)',
      );
    } finally {
      await managedPage.release();
    }
  });

  it('12. proves that raw unsanitized axe-core HTML evidence cannot bypass the sanitizer into CreateFindingRequest, SQLite persistence, or report outputs (Persistence Boundary Regression Suite)', async () => {
    const connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    try {
      const migrationRunner = new MigrationRunner(connection);
      await migrationRunner.migrate();

      const projectRepo = new ProjectRepository(connection);
      const siteRepo = new SiteRepository(connection);
      const scanRunRepo = new ScanRunRepository(connection);

      const project = projectRepo.create({ name: 'Persistence Test Project' });
      const site = siteRepo.create({
        projectId: project.id,
        name: 'Persistence Test Site',
        baseUrl: 'http://audit-target.test',
      });
      const scanRun = scanRunRepo.create({
        siteId: site.id,
        scanType: 'full',
        targetUrl: 'http://audit-target.test/sensitive',
      });

      // Raw unsanitized axe-core results with nested contenteditable, textarea, and sensitive values
      const rawAxeResults = {
        violations: [
          {
            id: 'nested-editor-issue',
            description: 'Form contains unlabeled rich-text editor and sensitive fields',
            help: 'Ensure form fields have accessible names',
            helpUrl: 'https://example.com/rules/nested-editor',
            impact: 'serious' as const,
            tags: ['wcag2a', 'wcag131'],
            nodes: [
              {
                html:
                  '<div contenteditable="true" data-secret="raw-secret-token-777">\n' +
                  '  Private information A\n' +
                  '  <div>Private information B <span>Nested sensitive memo</span></div>\n' +
                  '  Private information C\n' +
                  '</div>',
                target: ['#editable-area'],
                failureSummary: 'Fix any of the following: Element has no accessible name',
              },
              {
                html: '<textarea name="notes">Confidential clinical record for Alexander Hamilton at 742 Evergreen Terrace</textarea>',
                target: ['#notes-field'],
                failureSummary: 'Fix any of the following: Form element has no label',
              },
              {
                html: '<input type="password" name="pwd" value="SuperSecretPassword999!" data-token="sk_live_99999999999999999">',
                target: ['#pwd-field'],
                failureSummary:
                  'Fix any of the following: Password input is missing associated label',
              },
            ],
          },
        ],
        incomplete: [],
        passes: [],
        inapplicable: [],
      };

      // 1. Process via AccessibilityAnalyzer
      const analyzer = new AccessibilityAnalyzer({
        scanRunId: scanRun.id,
      });

      const analysis = analyzer.analyze({
        pageUrl: 'http://audit-target.test/sensitive',
        rawResults: rawAxeResults,
      });

      expect(analysis.findings.length).toBe(1);
      const findingRequest = analysis.findings[0];

      // 2. Verify serialized CreateFindingRequest contains zero sensitive text
      const serializedRequest = JSON.stringify(findingRequest);
      expect(serializedRequest).not.toContain('Private information A');
      expect(serializedRequest).not.toContain('Private information B');
      expect(serializedRequest).not.toContain('Private information C');
      expect(serializedRequest).not.toContain('Nested sensitive memo');
      expect(serializedRequest).not.toContain('raw-secret-token-777');
      expect(serializedRequest).not.toContain('Alexander Hamilton');
      expect(serializedRequest).not.toContain('742 Evergreen Terrace');
      expect(serializedRequest).not.toContain('SuperSecretPassword999!');
      expect(serializedRequest).not.toContain('sk_live_99999999999999999');

      // 3. Persist into SQLite via FindingRepository
      const findingRepo = new FindingRepository(connection);
      const persistedFinding = findingRepo.create({
        scanRunId: scanRun.id,
        ruleId: findingRequest.ruleId,
        category: findingRequest.category,
        title: findingRequest.title,
        description: findingRequest.description,
        severity: findingRequest.severity,
        confidence: findingRequest.confidence,
        status: findingRequest.status,
        targetUrl: findingRequest.targetUrl,
        evidence: findingRequest.evidence as Record<string, unknown>,
        remediation: findingRequest.remediation,
        references: findingRequest.references as string[],
      });

      // 4. Query from SQLite and verify evidence in database
      const fetchedFinding = findingRepo.getById(persistedFinding.id);
      expect(fetchedFinding).toBeDefined();

      const serializedSqliteEvidence = JSON.stringify(fetchedFinding?.evidence);
      expect(serializedSqliteEvidence).not.toContain('Private information A');
      expect(serializedSqliteEvidence).not.toContain('Private information B');
      expect(serializedSqliteEvidence).not.toContain('Private information C');
      expect(serializedSqliteEvidence).not.toContain('Nested sensitive memo');
      expect(serializedSqliteEvidence).not.toContain('raw-secret-token-777');
      expect(serializedSqliteEvidence).not.toContain('Alexander Hamilton');
      expect(serializedSqliteEvidence).not.toContain('742 Evergreen Terrace');
      expect(serializedSqliteEvidence).not.toContain('SuperSecretPassword999!');
      expect(serializedSqliteEvidence).not.toContain('sk_live_99999999999999999');

      // 5. Generate JSON and HTML reports from the persisted finding
      const reportModel: ReportModel = {
        reportId: 'rep-test-persistence',
        title: 'Accessibility Persistence Boundary Audit Report',
        site: {
          id: 'site-1',
          projectId: 'proj-1',
          name: 'Target Site',
          baseUrl: 'http://audit-target.test',
          platformType: 'wordpress',
          environmentType: 'production',
          description: null,
        },
        scanRun: {
          id: scanRun.id,
          siteId: 'site-1',
          scanType: 'full',
          status: 'completed',
          targetUrl: 'http://audit-target.test/sensitive',
          startedAt: '2026-11-08T10:00:00.000Z',
          completedAt: '2026-11-08T10:01:00.000Z',
          cancelledAt: null,
          durationMs: 60000,
          config: {},
          pagesScanned: 1,
          pagesFailed: 0,
        },
        findings: [fetchedFinding!],
        summary: {
          totalFindings: 1,
          bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
          byCategory: { accessibility: 1 },
          confirmedCount: 1,
          potentialCount: 0,
          pagesScanned: 1,
          pagesFailed: 0,
          scanDurationMs: 60000,
          scanStatus: 'completed',
        },
      };

      const jsonReport = generateJsonReport(reportModel);
      expect(jsonReport).not.toContain('Private information A');
      expect(jsonReport).not.toContain('Private information B');
      expect(jsonReport).not.toContain('Private information C');
      expect(jsonReport).not.toContain('Nested sensitive memo');
      expect(jsonReport).not.toContain('raw-secret-token-777');
      expect(jsonReport).not.toContain('Alexander Hamilton');
      expect(jsonReport).not.toContain('742 Evergreen Terrace');
      expect(jsonReport).not.toContain('SuperSecretPassword999!');
      expect(jsonReport).not.toContain('sk_live_99999999999999999');

      const htmlReport = generateHtmlReport(reportModel);
      expect(htmlReport).not.toContain('Private information A');
      expect(htmlReport).not.toContain('Private information B');
      expect(htmlReport).not.toContain('Private information C');
      expect(htmlReport).not.toContain('Nested sensitive memo');
      expect(htmlReport).not.toContain('raw-secret-token-777');
      expect(htmlReport).not.toContain('Alexander Hamilton');
      expect(htmlReport).not.toContain('742 Evergreen Terrace');
      expect(htmlReport).not.toContain('SuperSecretPassword999!');
      expect(htmlReport).not.toContain('sk_live_99999999999999999');
    } finally {
      connection.close();
    }
  });

  it('13. adversarial end-to-end PII test: verifies arbitrary personal names, addresses, and user-entered content never leak into finding evidence, SQLite, JSON report, or HTML report', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a', 'wcag2aa'],
    });

    const connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const migrationRunner = new MigrationRunner(connection);
    await migrationRunner.migrate();

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/adversarial-pii.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      // Verify we detected accessibility violations on the page
      expect(report.violations.length).toBeGreaterThan(0);
      expect(report.findings.length).toBeGreaterThan(0);

      const SENSITIVE_STRINGS = [
        'Alexander Hamilton',
        'alexander-hamilton-btn',
        'user-alexander-hamilton',
        'patient-555-019-9832',
        'customer-742-evergreen-terrace',
        'sec-alexander-hamilton',
        'nested-chart-alexander-hamilton',
        '742 Evergreen Terrace',
        'sk_live_adversarial_token_999',
        'raw-secret-token-777',
        'Patient health notes',
        'Confidential medical chart',
        'Doctor remarks',
        'Closing clinical memo',
        '555-019-9832',
        '000-12-3456',
      ];

      // 1. Verify CreateFindingRequest array from live audit
      for (const finding of report.findings) {
        const serializedFinding = JSON.stringify(finding);
        for (const secret of SENSITIVE_STRINGS) {
          expect(serializedFinding).not.toContain(secret);
        }
      }

      // 2. Set up DB records
      const projectRepo = new ProjectRepository(connection);
      const siteRepo = new SiteRepository(connection);
      const scanRunRepo = new ScanRunRepository(connection);
      const findingRepo = new FindingRepository(connection);

      const project = projectRepo.create({ name: 'PII Test Project' });
      const site = siteRepo.create({
        projectId: project.id,
        name: 'PII Test Site',
        baseUrl: 'http://audit-target.test',
      });
      const scanRun = scanRunRepo.create({
        siteId: site.id,
        scanType: 'full',
        targetUrl: `http://audit-target.test:${fixturePort}/adversarial-pii.html`,
      });

      // 3. Persist all findings into SQLite
      for (const finding of report.findings) {
        findingRepo.create({
          scanRunId: scanRun.id,
          ruleId: finding.ruleId,
          category: finding.category,
          title: finding.title,
          description: finding.description,
          severity: finding.severity,
          confidence: finding.confidence,
          status: finding.status,
          targetUrl: finding.targetUrl,
          evidence: finding.evidence as Record<string, unknown>,
          remediation: finding.remediation,
          references: finding.references as string[],
        });
      }

      // 4. Query from SQLite and verify persisted records
      const persistedList = findingRepo.listByScanRunId(scanRun.id, { limit: 100 });
      expect(persistedList.items.length).toBe(report.findings.length);

      const serializedSqlite = JSON.stringify(persistedList.items);
      for (const secret of SENSITIVE_STRINGS) {
        expect(serializedSqlite).not.toContain(secret);
      }

      // 5. Generate JSON and HTML reports from persisted findings
      const reportModel: ReportModel = {
        reportId: 'rep-pii-e2e',
        title: 'Adversarial PII Audit Report',
        site: {
          id: site.id,
          projectId: project.id,
          name: site.name,
          baseUrl: site.baseUrl,
          platformType: 'wordpress',
          environmentType: 'production',
          description: null,
        },
        scanRun: {
          id: scanRun.id,
          siteId: site.id,
          scanType: 'full',
          status: 'completed',
          targetUrl: `http://audit-target.test:${fixturePort}/adversarial-pii.html`,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          cancelledAt: null,
          durationMs: 1000,
          config: {},
          pagesScanned: 1,
          pagesFailed: 0,
        },
        findings: persistedList.items,
        summary: {
          totalFindings: persistedList.items.length,
          bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          byCategory: { accessibility: persistedList.items.length },
          confirmedCount: persistedList.items.length,
          potentialCount: 0,
          pagesScanned: 1,
          pagesFailed: 0,
          scanDurationMs: 1000,
          scanStatus: 'completed',
        },
      };

      const jsonReport = generateJsonReport(reportModel);
      for (const secret of SENSITIVE_STRINGS) {
        expect(jsonReport).not.toContain(secret);
      }

      const htmlReport = generateHtmlReport(reportModel);
      for (const secret of SENSITIVE_STRINGS) {
        expect(htmlReport).not.toContain(secret);
      }

      // 6. Verify that structural locators and selector notices are present on aliased nodes
      const allEvidenceNodes = report.findings.flatMap(
        f => (f.evidence as Record<string, unknown>).nodes as AccessibilityNodeEvidence[],
      );
      const aliasedNodes = allEvidenceNodes.filter(n => n.selectorNotice !== undefined);
      expect(aliasedNodes.length).toBeGreaterThan(0);
      for (const node of aliasedNodes) {
        expect(node.structuralLocator).toBeDefined();
        expect(node.selectorNotice).toContain('Sanitized structural locator');
      }

      // 7. Verify repeated reference correlation between controller-elem and alexander-hamilton-btn
      const buttonNode = allEvidenceNodes.find(
        n => n.html.includes('<button') && n.html.includes('class="cls-alias'),
      );
      expect(buttonNode).toBeDefined();
      const buttonIdMatch = buttonNode?.html.match(/id="(alias-id-\d+)"/);
      expect(buttonIdMatch).toBeDefined();
      const buttonAliasId = buttonIdMatch![1];

      const controllerNode = allEvidenceNodes.find(n => n.html.includes('aria-controls'));
      expect(controllerNode).toBeDefined();
      // Verify aria-controls on controllerNode has the exact same alias as the button's ID
      expect(controllerNode?.html).toContain(`aria-controls="${buttonAliasId}"`);
      expect(controllerNode?.html).not.toContain('controller-elem');
      expect(controllerNode?.html).not.toContain('alexander-hamilton-btn');
    } finally {
      connection.close();
      await managedPage.release();
    }
  });

  it('14. verifies IdentifierAliaser produces consistent 1:1 aliases, preserves safe framework classes, and sanitizes complex selectors', () => {
    const aliaser = new IdentifierAliaser();

    // 1. Alias ID
    const alias1 = aliaser.aliasId('alexander-hamilton-btn');
    expect(alias1).toBe('alias-id-1');

    // 2. Consistent repeated reference
    const alias1Repeat = aliaser.aliasId('alexander-hamilton-btn');
    expect(alias1Repeat).toBe('alias-id-1');

    const alias2 = aliaser.aliasId('customer-742-evergreen-terrace');
    expect(alias2).toBe('alias-id-2');

    // 3. Safe IDs preserved
    expect(aliaser.aliasId('bad-image')).toBe('bad-image');
    expect(aliaser.aliasId('low-contrast-p')).toBe('low-contrast-p');
    expect(aliaser.aliasId('main')).toBe('main');

    // 4. Multiple class tokens: sensitive aliased, safe framework preserved
    const aliasedClasses = aliaser.aliasClassString(
      'user-alexander-hamilton patient-555-019-9832 btn btn-primary',
    );
    expect(aliasedClasses).toBe('cls-alias-1 cls-alias-2 btn btn-primary');

    // 5. Repeated class token receives same alias
    const aliasedRepeat = aliaser.aliasClassToken('user-alexander-hamilton');
    expect(aliasedRepeat).toBe('cls-alias-1');

    // 6. Complex selector sanitization
    const rawSelector =
      'section#sec-alexander-hamilton > div.user-alexander-hamilton[id="customer-742-evergreen-terrace"] > button#alexander-hamilton-btn.btn';
    const sanitizedSelector = aliaser.aliasSelector(rawSelector);

    expect(sanitizedSelector).not.toContain('alexander-hamilton');
    expect(sanitizedSelector).not.toContain('742-evergreen-terrace');
    expect(sanitizedSelector).toBe(
      'section#alias-id-3 > div.cls-alias-1[id="alias-id-2"] > button#alias-id-1.btn',
    );
  });
});
