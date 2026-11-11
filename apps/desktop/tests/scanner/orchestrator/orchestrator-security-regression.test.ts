import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../../src/main/db/repositories/finding.repository.js';
import { ScanOrchestrator } from '../../../src/main/scanner/orchestrator/orchestrator.js';
import { SCAN_ORCHESTRATOR_ERROR_CODES } from '../../../src/main/scanner/orchestrator/errors.js';
import type { BoundedCrawler } from '../../../src/main/scanner/crawler/crawler.js';
import type { AnalyzerEngine } from '../../../src/main/scanner/analyzers/analyzer-engine.js';
import type { AnalyzerFinding } from '../../../src/main/scanner/analyzers/types.js';

describe('ScanOrchestrator Security & Regression Boundaries', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let siteId: string;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);

    const project = projectRepo.create({ name: 'Security Test Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Security Test Site',
      baseUrl: 'https://security.example.com',
    });
    siteId = site.id;
  });

  afterEach(() => {
    if (connection.isOpen()) {
      connection.close();
    }
  });

  it('strictly redacts credentials, session cookies, and auth tokens before persisting into SQLite', async () => {
    const mockFindings: AnalyzerFinding[] = [
      {
        ruleId: 'SEC_COOKIE_LEAK',
        category: 'security',
        title: 'Sensitive Cookie Observed in Response',
        description: 'Session cookie detected in debug response',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://security.example.com/api',
        evidence: {
          cookie: 'session_id=s3cr3t_sess_12345; Secure; HttpOnly',
          setCookie: 'jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz',
          authorization: 'Bearer super-secret-admin-token-value',
          password: 'plain_text_password_123',
          apiKey: 'AIzaSyD-1234567890abcdef',
          safeMetadata: {
            server: 'nginx/1.24.0',
            publicHeader: 'text/html',
          },
        },
      },
    ];

    const mockCrawler: Partial<BoundedCrawler> = {
      crawl: async () => ({
        summary: {
          entryUrl: 'https://security.example.com/',
          authorizedOrigin: 'https://security.example.com',
          totalPagesAttempted: 1,
          successfulPages: 1,
          failedPages: 0,
          nonHtmlPages: 0,
          uniqueUrlsDiscovered: 1,
          urlsSkippedScope: 0,
          urlsSkippedLimits: 0,
          maxDepthReached: 0,
          durationMs: 20,
          cancelled: false,
        },
        pages: [],
        discoveredUrls: ['https://security.example.com/'],
        errors: [],
      }),
    };

    const mockAnalyzerEngine: Partial<AnalyzerEngine> = {
      runAnalysis: async () => ({
        findings: mockFindings,
        stats: {
          totalFindings: 1,
          bySeverity: { high: 1 },
          byCategory: { security: 1 },
          byConfidence: { confirmed: 1 },
          byRule: { SEC_COOKIE_LEAK: 1 },
          pagesAnalyzed: 1,
          durationMs: 10,
          findingsTruncatedCount: 0,
          evidenceTruncatedCount: 0,
          duplicatesFilteredCount: 0,
        },
      }),
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzerEngine as AnalyzerEngine,
    });

    const completedRun = await orchestrator.startScan({
      siteId,
      scanType: 'security',
    });

    expect(completedRun.status).toBe('completed');
    expect(completedRun.summary?.totalFindings).toBe(1);

    // Read directly from SQLite database raw row to verify persistence level
    const persistedList = findingRepo.listByScanRunId(completedRun.id);
    expect(persistedList.total).toBe(1);

    const persisted = persistedList.items[0];
    const evidence = persisted.evidence as Record<string, unknown>;

    // Sensitive keys must be completely sanitized
    expect(evidence.cookie).toBe('[REDACTED]');
    expect(evidence.setCookie).toBe('[REDACTED]');
    expect(evidence.authorization).toBe('[REDACTED]');
    expect(evidence.password).toBe('[REDACTED]');
    expect(evidence.apiKey).toBe('[REDACTED]');

    // Safe metadata must remain intact
    expect((evidence.safeMetadata as Record<string, unknown>).server).toBe('nginx/1.24.0');

    // Verify raw JSON in database contains zero plaintext secret strings
    const rawDb = connection.getRawDb();
    const rawRow = rawDb
      .prepare('SELECT evidence_json FROM findings WHERE id = ?')
      .get(persisted.id) as { evidence_json: string };

    expect(rawRow.evidence_json).not.toContain('s3cr3t_sess_12345');
    expect(rawRow.evidence_json).not.toContain('super-secret-admin-token-value');
    expect(rawRow.evidence_json).not.toContain('plain_text_password_123');
    expect(rawRow.evidence_json).not.toContain('AIzaSyD-1234567890abcdef');

    orchestrator.dispose();
  });

  it('rejects targets resolving to private or prohibited IP ranges', () => {
    // Target URL on private IP
    expect(() => {
      new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo).createScan({
        siteId,
        targetUrl: 'http://169.254.169.254/latest/meta-data/',
      });
    }).toThrowError(new RegExp(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INVALID_ENTRY_URL));
  });

  it('strictly strips and ignores any caller-supplied pinnedIpOverride or testHooks in createScan config', () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);

    // Adversarial attempt to inject testHooks and pinnedIpOverride via request payload
    const maliciousRequest = {
      siteId,
      scanType: 'full' as const,
      config: {
        maxPages: 5,
        // Hostile injected fields that must never be recognized by ScanConfigSchema
        pinnedIpOverride: '169.254.169.254',
        testHooks: {
          pinnedIpOverride: '127.0.0.1',
          allowLoopbackInTests: true,
          lookupFn: () => [{ address: '127.0.0.1', family: 4 }],
        },
      },
    };

    const created = orchestrator.createScan(
      maliciousRequest as unknown as Parameters<typeof orchestrator.createScan>[0],
    );
    expect(created.status).toBe('pending');

    // Verify persisted config in database strictly does NOT contain testHooks or pinnedIpOverride
    const retrieved = scanRunRepo.getById(created.id);
    expect(retrieved).not.toBeNull();
    const persistedConfig = retrieved!.config as Record<string, unknown>;
    expect(persistedConfig).not.toHaveProperty('pinnedIpOverride');
    expect(persistedConfig).not.toHaveProperty('testHooks');

    // Verify orchestrator internal options have testHooks strictly undefined
    const internalOptions = (orchestrator as unknown as { options: { testHooks?: unknown } })
      .options;
    expect(internalOptions.testHooks).toBeUndefined();

    orchestrator.dispose();
  });

  it('verifies default production ScanOrchestrator has options.testHooks strictly undefined', () => {
    const defaultOrchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);
    const internalOptions = (
      defaultOrchestrator as unknown as {
        options: { testHooks?: unknown; clientOptions?: unknown };
      }
    ).options;
    expect(internalOptions.testHooks).toBeUndefined();
    expect(internalOptions.clientOptions).toEqual({});
    defaultOrchestrator.dispose();
  });
});
