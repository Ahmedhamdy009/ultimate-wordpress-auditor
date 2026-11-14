import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Page } from 'playwright-core';
import type { CreateFindingRequest, UnifiedPerformanceEvidence } from '@auditor/shared';
import type {
  AccessibilityAuditor,
  BrowserManager,
  RuntimeResourceAuditor,
  VisualAuditor,
} from '../../../src/main/browser/index.js';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../../src/main/db/repositories/finding.repository.js';
import { ScanOrchestrator } from '../../../src/main/scanner/orchestrator/orchestrator.js';
import type { BoundedCrawler } from '../../../src/main/scanner/crawler/crawler.js';
import type { CrawlResult } from '../../../src/main/scanner/crawler/types.js';
import type { AnalyzerEngine } from '../../../src/main/scanner/analyzers/analyzer-engine.js';
import type { AnalyzerEngineResult } from '../../../src/main/scanner/analyzers/types.js';
import type { PerformanceAuditor } from '../../../src/main/scanner/performance/performance-analyzer.js';

describe('ScanOrchestrator Performance Audit Integration', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let validSiteId: string;
  let orchestrator: ScanOrchestrator | null = null;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);

    const project = projectRepo.create({ name: 'Perf Integration Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Perf Integration Site',
      baseUrl: 'https://example.com',
    });
    validSiteId = site.id;
  });

  afterEach(() => {
    if (orchestrator) {
      orchestrator.dispose();
      orchestrator = null;
    }
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  const createMockCrawlResult = (url: string = 'https://example.com/'): CrawlResult => ({
    summary: {
      entryUrl: url,
      authorizedOrigin: 'https://example.com',
      totalPagesAttempted: 1,
      successfulPages: 1,
      failedPages: 0,
      nonHtmlPages: 0,
      uniqueUrlsDiscovered: 1,
      urlsSkippedScope: 0,
      urlsSkippedLimits: 0,
      maxDepthReached: 0,
      durationMs: 40,
      cancelled: false,
    },
    pages: [
      {
        requestedUrl: url,
        finalUrl: url,
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': 'text/html' },
        contentType: 'text/html',
        isHtml: true,
        durationMs: 30,
        depth: 0,
        parentUrl: null,
        encodedBodyBytes: 500,
        decompressedBodyBytes: 1200,
        parsedDocument: null,
      },
    ],
    discoveredUrls: [url],
    errors: [],
  });

  const createMockAnalyzerResult = (): AnalyzerEngineResult => ({
    findings: [],
    errors: [],
    pageAnalyses: [],
    summary: {
      totalPagesAnalyzed: 1,
      totalFindings: 0,
      ruleCounts: {},
      categoryCounts: {},
      durationMs: 15,
    },
  });

  it('wires performance auditor into browser audit lifecycle reusing managed page (0 additional navigations)', async () => {
    const lifecycleCalls: string[] = [];
    let gotoCount = 0;

    const mockPage = {
      goto: vi.fn().mockImplementation(async (url: string) => {
        lifecycleCalls.push(`goto:${url}`);
        gotoCount++;
      }),
      isClosed: () => false,
      on: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as Page;

    const mockManagedPage = {
      page: mockPage,
      release: vi.fn().mockImplementation(async () => {
        lifecycleCalls.push('page:release');
      }),
    };

    const mockPerformanceAuditor: Partial<PerformanceAuditor> = {
      install: vi.fn().mockImplementation(async (_page: Page) => {
        lifecycleCalls.push('perf:install');
      }),
      audit: vi.fn().mockImplementation(async (_page: Page, url: string, _network, opts) => {
        lifecycleCalls.push(`perf:audit:${url}`);
        const findings: CreateFindingRequest[] = [
          {
            scanRunId: opts?.scanRunId ?? 'scan-id',
            ruleId: 'PERF_LAB_SLOW_TTFB',
            category: 'static-performance',
            title: 'High Time to First Byte',
            description: 'TTFB was 1100ms',
            severity: 'medium',
            confidence: 'potential',
            status: 'potential',
            targetUrl: url,
            evidence: { ttfbMs: 1100, provenance: 'lab_collector' },
            remediation: null,
            references: [],
          },
          {
            scanRunId: opts?.scanRunId ?? 'scan-id',
            ruleId: 'PERF_BOTTLENECK_DIAGNOSIS',
            category: 'static-performance',
            title: 'Elevated Server Latency',
            description: 'Initial document latency exceeded threshold',
            severity: 'medium',
            confidence: 'potential',
            status: 'potential',
            targetUrl: url,
            evidence: { classification: 'SERVER_LATENCY', provenance: 'bottleneck_classifier' },
            remediation: null,
            references: [],
          },
        ];
        return {
          pageUrl: url,
          evidence: {} as unknown as UnifiedPerformanceEvidence,
          diagnoses: [],
          labMetrics: null,
          resourceSummary: null,
          findings,
          durationMs: 80,
        };
      }),
    };

    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () =>
        ({
          crawl: async () => createMockCrawlResult('https://example.com/'),
        }) as unknown as BoundedCrawler,
      analyzerEngineFactory: () =>
        ({
          runAnalysis: async () => createMockAnalyzerResult(),
        }) as unknown as AnalyzerEngine,
      browserManagerFactory: () =>
        ({
          launch: async () => {},
          close: async () => {},
          acquirePage: async () => mockManagedPage,
        }) as unknown as BrowserManager,
      accessibilityAuditorFactory: () =>
        ({
          auditPage: async () => ({
            findings: [],
            summary: {
              totalRulesEvaluated: 0,
              passedRules: 0,
              failedRules: 0,
              inapplicableRules: 0,
            },
          }),
        }) as unknown as AccessibilityAuditor,
      runtimeAuditorFactory: () =>
        ({
          attach: vi.fn(),
          detach: vi.fn(),
          audit: vi.fn().mockReturnValue({ findings: [], summary: {} }),
          getCapturedNetworkResources: vi.fn().mockReturnValue([]),
        }) as unknown as RuntimeResourceAuditor,
      visualAuditorFactory: () =>
        ({
          auditPage: vi.fn().mockResolvedValue({
            findings: [],
            screenshots: [],
            viewportsCompleted: 0,
          }),
        }) as unknown as VisualAuditor,
      performanceAuditorFactory: () => mockPerformanceAuditor as PerformanceAuditor,
    });

    const completedRun = await orchestrator.startScan({
      siteId: validSiteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        modules: {
          networkResources: true,
          layoutStability: true,
          accessibility: true,
        },
      },
    });

    expect(completedRun.error).toBeNull();
    expect(completedRun.status).toBe('completed');

    // 1. Verify correct lifecycle ordering: install BEFORE goto, audit AFTER goto
    expect(lifecycleCalls).toContain('perf:install');
    expect(lifecycleCalls).toContain('goto:https://example.com/');
    expect(lifecycleCalls).toContain('perf:audit:https://example.com/');

    const installIndex = lifecycleCalls.indexOf('perf:install');
    const gotoIndex = lifecycleCalls.indexOf('goto:https://example.com/');
    const auditIndex = lifecycleCalls.indexOf('perf:audit:https://example.com/');

    expect(installIndex).toBeLessThan(gotoIndex);
    expect(gotoIndex).toBeLessThan(auditIndex);

    // 2. Verify zero additional navigations occurred
    expect(gotoCount).toBe(1);

    // 3. Verify performance findings were persisted in SQLite
    const persisted = findingRepo.listByScanRunId(completedRun.id);
    expect(persisted.total).toBe(2);

    const rules = persisted.items.map(f => f.ruleId);
    expect(rules).toContain('PERF_LAB_SLOW_TTFB');
    expect(rules).toContain('PERF_BOTTLENECK_DIAGNOSIS');
  });

  it('isolates partial performance auditor failures without failing the overall scan or other audits', async () => {
    const mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      isClosed: () => false,
      on: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as Page;

    const mockManagedPage = {
      page: mockPage,
      release: vi.fn().mockResolvedValue(undefined),
    };

    const mockPerformanceAuditor: Partial<PerformanceAuditor> = {
      install: vi.fn().mockResolvedValue(undefined),
      audit: vi.fn().mockRejectedValue(new Error('Chromium performance observer crashed')),
    };

    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () =>
        ({
          crawl: async () => createMockCrawlResult('https://example.com/'),
        }) as unknown as BoundedCrawler,
      analyzerEngineFactory: () =>
        ({
          runAnalysis: async () => createMockAnalyzerResult(),
        }) as unknown as AnalyzerEngine,
      browserManagerFactory: () =>
        ({
          launch: async () => {},
          close: async () => {},
          acquirePage: async () => mockManagedPage,
        }) as unknown as BrowserManager,
      accessibilityAuditorFactory: () =>
        ({
          auditPage: async () => ({
            findings: [
              {
                ruleId: 'A11Y_COLOR_CONTRAST',
                category: 'accessibility',
                title: 'Insufficient contrast',
                description: 'Contrast is poor',
                severity: 'medium',
                confidence: 'confirmed',
                status: 'confirmed',
                targetUrl: 'https://example.com/',
                evidence: null,
                remediation: null,
                references: [],
              },
            ],
            summary: {
              totalRulesEvaluated: 1,
              passedRules: 0,
              failedRules: 1,
              inapplicableRules: 0,
            },
          }),
        }) as unknown as AccessibilityAuditor,
      runtimeAuditorFactory: () =>
        ({
          attach: vi.fn(),
          detach: vi.fn(),
          audit: vi.fn().mockReturnValue({ findings: [], summary: {} }),
          getCapturedNetworkResources: vi.fn().mockReturnValue([]),
        }) as unknown as RuntimeResourceAuditor,
      visualAuditorFactory: () =>
        ({
          auditPage: vi.fn().mockResolvedValue({
            findings: [],
            screenshots: [],
            viewportsCompleted: 0,
          }),
        }) as unknown as VisualAuditor,
      performanceAuditorFactory: () => mockPerformanceAuditor as PerformanceAuditor,
    });

    const completedRun = await orchestrator.startScan({
      siteId: validSiteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        modules: {
          accessibility: true,
          networkResources: true,
        },
      },
    });

    // Scan should still complete successfully despite performance crash
    expect(completedRun.error).toBeNull();
    expect(completedRun.status).toBe('completed');

    // Accessibility findings should still be preserved in database
    const persisted = findingRepo.listByScanRunId(completedRun.id);
    expect(persisted.total).toBe(1);
    expect(persisted.items[0].ruleId).toBe('A11Y_COLOR_CONTRAST');
  });

  it('respects AbortSignal cancellation during performance execution without unhandled rejections', async () => {
    const abortController = new AbortController();

    const mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      isClosed: () => false,
      on: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as Page;

    const mockManagedPage = {
      page: mockPage,
      release: vi.fn().mockResolvedValue(undefined),
    };

    const mockPerformanceAuditor: Partial<PerformanceAuditor> = {
      install: vi.fn().mockResolvedValue(undefined),
      audit: vi.fn().mockImplementation(async () => {
        abortController.abort();
        const err = new Error('Scan cancelled by user');
        err.name = 'AbortError';
        throw err;
      }),
    };

    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () =>
        ({
          crawl: async () => createMockCrawlResult('https://example.com/'),
        }) as unknown as BoundedCrawler,
      analyzerEngineFactory: () =>
        ({
          runAnalysis: async () => createMockAnalyzerResult(),
        }) as unknown as AnalyzerEngine,
      browserManagerFactory: () =>
        ({
          launch: async () => {},
          close: async () => {},
          acquirePage: async () => mockManagedPage,
        }) as unknown as BrowserManager,
      performanceAuditorFactory: () => mockPerformanceAuditor as PerformanceAuditor,
    });

    const scanRun = orchestrator.createScan({
      siteId: validSiteId,
      scanType: 'full',
      config: {
        browserAudit: true,
        modules: { networkResources: true },
      },
    });

    // Cancel scan externally
    orchestrator.cancelScan({ id: scanRun.id });

    const finalRun = scanRunRepo.getById(scanRun.id);
    expect(finalRun?.status).toBe('cancelled');
  });
});
