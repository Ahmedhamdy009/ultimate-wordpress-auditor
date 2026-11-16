import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ScanRunService } from '../../src/main/services/scan-run.service.js';
import { generateHtmlReport } from '../../src/main/reports/html-generator.js';
import { generateJsonReport } from '../../src/main/reports/json-generator.js';
import { generateCsvReport } from '../../src/main/reports/csv-generator.js';
import { redactUrl, isSensitiveQueryKey, redactUrlFallback } from '../../src/main/browser/redactor.js';
import { redactSensitiveData } from '../../src/main/reports/security.js';
import type { ReportModel } from '../../src/main/reports/types.js';

describe('DEF-002 Sensitive Data Redaction Regression Suite', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let scanRunService: ScanRunService;
  let testSiteId: string;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);
    scanRunService = new ScanRunService(scanRunRepo, siteRepo);

    const project = projectRepo.create({ name: 'Security Audit Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Audit Target Site',
      baseUrl: 'https://example.com',
    });
    testSiteId = site.id;
  });

  afterEach(() => {
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  describe('1. Scan Creation & Database Persistence', () => {
    it('redacts token and access_token in targetUrl before persisting into SQLite', () => {
      const rawTargetUrl =
        'https://example.com/app?token=secret_tok_112233&access_token=secret_acc_445566&page=1&sort=desc';

      const scanRun = scanRunService.createScanRun({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: rawTargetUrl,
      });

      // 1. Verify returned DTO does not leak secrets
      expect(scanRun.targetUrl).not.toContain('secret_tok_112233');
      expect(scanRun.targetUrl).not.toContain('secret_acc_445566');
      expect(scanRun.targetUrl).toContain('page=1');
      expect(scanRun.targetUrl).toContain('sort=desc');

      // 2. Inspect raw SQLite table directly
      const rawDb = connection.getRawDb();
      const row = rawDb
        .prepare('SELECT target_url FROM scan_runs WHERE id = ?')
        .get(scanRun.id) as { target_url: string };

      expect(row).toBeDefined();
      expect(row.target_url).not.toContain('secret_tok_112233');
      expect(row.target_url).not.toContain('secret_acc_445566');
      expect(row.target_url).toMatch(/(?:\[REDACTED\]|%5BREDACTED%5D)/);
      expect(row.target_url).toContain('page=1');
      expect(row.target_url).toContain('sort=desc');
    });

    it('redacts refresh_token, client_secret, api_key, and session_id before SQLite persistence', () => {
      const sensitiveUrl =
        'https://example.com/oauth?refresh_token=rt_secret_99&client_secret=cs_secret_88&api_key=ak_secret_77&session_id=sess_secret_66&lang=en';

      const scanRun = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: sensitiveUrl,
      });

      const rawDb = connection.getRawDb();
      const row = rawDb
        .prepare('SELECT target_url FROM scan_runs WHERE id = ?')
        .get(scanRun.id) as { target_url: string };

      expect(row.target_url).not.toContain('rt_secret_99');
      expect(row.target_url).not.toContain('cs_secret_88');
      expect(row.target_url).not.toContain('ak_secret_77');
      expect(row.target_url).not.toContain('sess_secret_66');
      expect(row.target_url).toContain('lang=en');
    });
  });

  describe('2. Report Generation (HTML, JSON, CSV)', () => {
    it('ensures HTML, JSON, and CSV reports contain zero raw secrets from target URLs, configs, or evidence', () => {
      const sensitiveSecret = 'super_secret_token_abcdef123456';
      const sensitiveAccessToken = 'bearer_access_secret_789012';
      const rawTargetUrl = `https://example.com/api?token=${sensitiveSecret}&access_token=${sensitiveAccessToken}&view=dashboard`;

      const scanRun = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: rawTargetUrl,
      });

      const model: ReportModel = {
        reportId: 'rep-test-def002',
        title: 'DEF-002 Secret Redaction Verification',
        site: {
          id: testSiteId,
          projectId: 'p1',
          name: 'Audit Site',
          baseUrl: 'https://example.com',
          platformType: 'wordpress',
          environmentType: 'production',
        },
        scanRun: {
          id: scanRun.id,
          siteId: testSiteId,
          scanType: 'full',
          status: 'completed',
          targetUrl: rawTargetUrl, // Pass raw to verify report-level defensive redactor
          startedAt: '2026-11-16T12:00:00Z',
          completedAt: '2026-11-16T12:01:00Z',
          cancelledAt: null,
          durationMs: 60000,
          config: {
            authHeader: `Bearer ${sensitiveAccessToken}`,
            secretParam: sensitiveSecret,
          },
          pagesScanned: 1,
          pagesFailed: 0,
        },
        findings: [
          {
            id: 'f-sec-1',
            scanRunId: scanRun.id,
            ruleId: 'SEC-TOKEN-EXPOSURE',
            category: 'security',
            title: 'URL Token Leakage Finding',
            description: `A URL with https://example.com/api?access_token=${sensitiveAccessToken} was discovered.`,
            severity: 'high',
            confidence: 'confirmed',
            status: 'active',
            targetUrl: rawTargetUrl,
            evidence: {
              requestUrl: rawTargetUrl,
              apiKey: sensitiveSecret,
            },
            remediation: 'Do not expose secrets in query parameters.',
            references: ['https://cwe.mitre.org/data/definitions/598.html'],
            createdAt: '2026-11-16T12:00:30Z',
          },
        ],
        summary: {
          totalFindings: 1,
          bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
          byCategory: { security: 1 },
          confirmedCount: 1,
          potentialCount: 0,
          pagesScanned: 1,
          pagesFailed: 0,
          scanDurationMs: 60000,
          scanStatus: 'completed',
        },
      };

      // 1. HTML Report Verification
      const htmlReport = generateHtmlReport(model);
      expect(htmlReport).not.toContain(sensitiveSecret);
      expect(htmlReport).not.toContain(sensitiveAccessToken);
      expect(htmlReport).toContain('view=dashboard');

      // 2. JSON Report Verification
      const jsonReport = generateJsonReport(model);
      expect(jsonReport).not.toContain(sensitiveSecret);
      expect(jsonReport).not.toContain(sensitiveAccessToken);
      expect(jsonReport).toContain('view=dashboard');
      const parsedJson = JSON.parse(jsonReport);
      expect(parsedJson.scanRun.targetUrl).toMatch(/(?:\[REDACTED\]|%5BREDACTED%5D)/);

      // 3. CSV Report Verification
      const csvReport = generateCsvReport(model);
      expect(csvReport).not.toContain(sensitiveSecret);
      expect(csvReport).not.toContain(sensitiveAccessToken);
      expect(csvReport).toContain('view=dashboard');
    });
  });

  describe('3. Historical Records Confinement (Non-Destructive Read-Time Redaction)', () => {
    it('safely redacts historical unredacted records on read without destructive database rewrites', () => {
      const historicalId = crypto.randomUUID();
      const rawHistoricalUrl =
        'https://example.com/legacy?token=hist_secret_123&access_token=hist_acc_456&page=3';
      const now = new Date().toISOString();

      // Simulate a pre-remediation row directly in SQLite
      const rawDb = connection.getRawDb();
      rawDb
        .prepare(
          `INSERT INTO scan_runs (
            id, site_id, scan_type, status, target_url,
            started_at, completed_at, cancelled_at, duration_ms,
            config_json, summary_json, error_json,
            created_at, updated_at
          ) VALUES (?, ?, 'full', 'completed', ?, ?, ?, NULL, 5000, '{}', '{}', NULL, ?, ?)`,
        )
        .run(historicalId, testSiteId, rawHistoricalUrl, now, now, now, now);

      // Verify row in SQLite still has raw string (preserving existing user databases)
      const stored = rawDb
        .prepare('SELECT target_url FROM scan_runs WHERE id = ?')
        .get(historicalId) as { target_url: string };
      expect(stored.target_url).toBe(rawHistoricalUrl);

      // Verify read-time DTO mapper safely confines and redacts the secrets
      const runDTO = scanRunRepo.getById(historicalId);
      expect(runDTO).not.toBeNull();
      expect(runDTO!.targetUrl).not.toContain('hist_secret_123');
      expect(runDTO!.targetUrl).not.toContain('hist_acc_456');
      expect(runDTO!.targetUrl).toContain('page=3');
      expect(runDTO!.targetUrl).toMatch(/(?:\[REDACTED\]|%5BREDACTED%5D)/);

      // Verify listScanRuns also redacts historical records
      const listRes = scanRunService.listScanRuns({ siteId: testSiteId });
      const found = listRes.items.find(r => r.id === historicalId);
      expect(found).toBeDefined();
      expect(found!.targetUrl).not.toContain('hist_secret_123');
      expect(found!.targetUrl).not.toContain('hist_acc_456');
    });
  });

  describe('4. Fragments, Nested URLs, Encoded Keys & Benign Parameters', () => {
    it('redacts tokens inside URL fragments (OAuth / SPA)', () => {
      const fragmentUrl =
        'https://example.com/callback#access_token=frag_token_secret&token_type=bearer&state=safe_state_val';
      const redacted = redactUrl(fragmentUrl);

      expect(redacted).not.toContain('frag_token_secret');
      expect(redacted).toContain('state=safe_state_val');
      expect(redacted).toContain('#access_token=[REDACTED]');
    });

    it('redacts nested URLs inside query parameters', () => {
      const nestedUrl =
        'https://example.com/login?redirect=https%3A%2F%2Fother.com%2Fcallback%3Faccess_token%3Dnested_tok_999&remember=true';
      const redacted = redactUrl(nestedUrl);

      expect(redacted).not.toContain('nested_tok_999');
      expect(redacted).toContain('remember=true');
      expect(redacted).toMatch(/(?:\[REDACTED\]|%5BREDACTED%5D)/);
    });

    it('redacts URL-encoded parameter names', () => {
      // %61%63%63%65%73%73%5F%74%6F%6B%65%6E = access_token
      const encodedParamUrl =
        'https://example.com/?%61%63%63%65%73%73%5F%74%6F%6B%65%6E=encoded_secret_val&category=tech';
      const redacted = redactUrl(encodedParamUrl);

      expect(redacted).not.toContain('encoded_secret_val');
      expect(redacted).toContain('category=tech');
      expect(redacted).toMatch(/(?:\[REDACTED\]|%5BREDACTED%5D)/);
    });

    it('safely handles malformed URLs without throwing exceptions', () => {
      const malformed1 = 'not-a-url?access_token=bad_url_secret&sort=asc';
      const redacted1 = redactUrl(malformed1);
      expect(redacted1).not.toContain('bad_url_secret');
      expect(redacted1).toContain('sort=asc');

      const malformed2 = 'http://[invalid-host/?token=bracket_secret&filter=open';
      const redacted2 = redactUrl(malformed2);
      expect(redacted2).not.toContain('bracket_secret');
      expect(redacted2).toContain('filter=open');
    });

    it('strictly preserves benign query parameters intact', () => {
      const benign =
        'https://example.com/blog?page=2&sort=desc&category=news&author=john&id=123&utm_source=google&ref=home';
      expect(redactUrl(benign)).toBe(benign);
    });
  });
});
