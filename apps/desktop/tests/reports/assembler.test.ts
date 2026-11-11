import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { assembleReportData } from '../../src/main/reports/assembler.js';
import type { FindingDTO, ScanRunDTO, SiteDTO } from '@auditor/shared';

describe('Report Data Assembler (assembleReportData)', () => {
  const mockSite: SiteDTO = {
    id: 'site-1111-1111-1111-111111111111',
    projectId: 'proj-1111-1111-1111-111111111111',
    name: 'Production WordPress Store',
    baseUrl: 'https://store.example.com',
    platformType: 'wordpress',
    environmentType: 'production',
    description: 'Main ecommerce site',
    isArchived: false,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };

  const mockScanRun: ScanRunDTO = {
    id: 'scan-2222-2222-2222-222222222222',
    siteId: mockSite.id,
    scanType: 'full',
    status: 'completed',
    targetUrl: 'https://store.example.com/',
    startedAt: '2026-11-07T12:00:00.000Z',
    completedAt: '2026-11-07T12:05:00.000Z',
    cancelledAt: null,
    durationMs: 300000,
    config: { maxPages: 25, crawlDepth: 3 },
    summary: {
      totalFindings: 3,
      pagesScanned: 25,
      pagesFailed: 0,
      bySeverity: { critical: 1, high: 1, medium: 1, low: 0, info: 0 },
    },
    error: null,
    createdAt: '2026-11-07T11:59:00.000Z',
    updatedAt: '2026-11-07T12:05:00.000Z',
  };

  const mockFindings: FindingDTO[] = [
    {
      id: 'f-1',
      scanRunId: mockScanRun.id,
      ruleId: 'SEC-HEADER-CSP-MISSING',
      category: 'security',
      title: 'Content-Security-Policy Missing',
      description: 'The response does not include a Content-Security-Policy header.',
      severity: 'high',
      confidence: 'confirmed',
      status: 'active',
      targetUrl: 'https://store.example.com/',
      evidence: { header: null },
      remediation: 'Configure a strict CSP.',
      references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP'],
      createdAt: '2026-11-07T12:01:00.000Z',
    },
    {
      id: 'f-2',
      scanRunId: mockScanRun.id,
      ruleId: 'WP-XMLRPC-EXPOSED',
      category: 'wordpress',
      title: 'WordPress XML-RPC Endpoint Exposed',
      description: 'The xmlrpc.php endpoint is accessible.',
      severity: 'medium',
      confidence: 'potential',
      status: 'active',
      targetUrl: 'https://store.example.com/xmlrpc.php',
      evidence: { status: 405 },
      remediation: 'Disable XML-RPC if not needed.',
      references: null,
      createdAt: '2026-11-07T12:02:00.000Z',
    },
    {
      id: 'f-3',
      scanRunId: mockScanRun.id,
      ruleId: 'SEC-TLS-WEAK-CIPHER',
      category: 'security',
      title: 'Weak TLS Configuration',
      description: 'TLS 1.0 or 1.1 protocol supported.',
      severity: 'critical',
      confidence: 'confirmed',
      status: 'active',
      targetUrl: 'https://store.example.com/',
      evidence: null,
      remediation: 'Upgrade to TLS 1.2+.',
      references: null,
      createdAt: '2026-11-07T12:03:00.000Z',
    },
  ];

  it('assembles a complete ReportModel from persisted records', () => {
    const deps = {
      siteRepo: { getById: vi.fn().mockReturnValue(mockSite) } as any,
      scanRunRepo: { getById: vi.fn().mockReturnValue(mockScanRun) } as any,
      findingRepo: { getAllByScanRunId: vi.fn().mockReturnValue(mockFindings) } as any,
    };

    const model = assembleReportData(mockScanRun.id, deps);

    expect(model.reportId).toBeDefined();
    expect(model.title).toContain(mockSite.name);
    expect(model.site.name).toBe(mockSite.name);
    expect(model.scanRun.id).toBe(mockScanRun.id);
    expect(model.findings).toHaveLength(3);

    // Summary calculations
    expect(model.summary.totalFindings).toBe(3);
    expect(model.summary.bySeverity.critical).toBe(1);
    expect(model.summary.bySeverity.high).toBe(1);
    expect(model.summary.bySeverity.medium).toBe(1);
    expect(model.summary.bySeverity.low).toBe(0);
    expect(model.summary.bySeverity.info).toBe(0);

    // Verification state
    expect(model.summary.confirmedCount).toBe(2);
    expect(model.summary.potentialCount).toBe(1);

    // Categories
    expect(model.summary.byCategory.security).toBe(2);
    expect(model.summary.byCategory.wordpress).toBe(1);

    // Pages & duration
    expect(model.summary.pagesScanned).toBe(25);
    expect(model.summary.pagesFailed).toBe(0);
    expect(model.summary.scanDurationMs).toBe(300000);
    expect(model.summary.scanStatus).toBe('completed');
  });

  it('preserves failed and cancelled scan terminal statuses without disguising them as completed', () => {
    const failedRun: ScanRunDTO = {
      ...mockScanRun,
      status: 'failed',
      completedAt: null,
      durationMs: 12000,
      summary: { pagesScanned: 2, pagesFailed: 1 },
    };

    const deps = {
      siteRepo: { getById: vi.fn().mockReturnValue(mockSite) } as any,
      scanRunRepo: { getById: vi.fn().mockReturnValue(failedRun) } as any,
      findingRepo: { getAllByScanRunId: vi.fn().mockReturnValue([mockFindings[0]]) } as any,
    };

    const model = assembleReportData(failedRun.id, deps);
    expect(model.summary.scanStatus).toBe('failed');
    expect(model.scanRun.status).toBe('failed');
    expect(model.summary.pagesScanned).toBe(2);
    expect(model.summary.pagesFailed).toBe(1);
  });

  it('throws IPCError when scan run does not exist', () => {
    const deps = {
      siteRepo: { getById: vi.fn() } as any,
      scanRunRepo: { getById: vi.fn().mockReturnValue(null) } as any,
      findingRepo: { getAllByScanRunId: vi.fn() } as any,
    };

    expect(() => assembleReportData('non-existent-scan', deps)).toThrow('not found');
  });

  it('throws IPCError when associated site does not exist', () => {
    const deps = {
      siteRepo: { getById: vi.fn().mockReturnValue(null) } as any,
      scanRunRepo: { getById: vi.fn().mockReturnValue(mockScanRun) } as any,
      findingRepo: { getAllByScanRunId: vi.fn() } as any,
    };

    expect(() => assembleReportData(mockScanRun.id, deps)).toThrow('Associated site');
  });

  it('keeps confirmed, firm, and potential confidence buckets strictly separated and disambiguates legacy categories 1:1', () => {
    const mixedFindings: FindingDTO[] = [
      {
        ...mockFindings[0],
        id: 'f-confirmed',
        ruleId: 'SEC_HEADER_HSTS_MISSING',
        category: 'Information Disclosure',
        confidence: 'confirmed',
        status: 'active',
      },
      {
        ...mockFindings[1],
        id: 'f-firm',
        ruleId: 'WP_VERSION_DISCLOSED',
        category: 'Information Disclosure',
        confidence: 'firm',
        status: 'potential',
      },
      {
        ...mockFindings[2],
        id: 'f-potential',
        ruleId: 'CONTENT_THIN_TEXT',
        category: 'Content Quality',
        confidence: 'potential',
        status: 'active',
      },
    ];

    const deps = {
      siteRepo: { getById: vi.fn().mockReturnValue(mockSite) } as any,
      scanRunRepo: { getById: vi.fn().mockReturnValue(mockScanRun) } as any,
      findingRepo: { getAllByScanRunId: vi.fn().mockReturnValue(mixedFindings) } as any,
    };

    const model = assembleReportData(mockScanRun.id, deps);
    expect(model.summary.confirmedCount).toBe(1);
    expect(model.summary.firmCount).toBe(1);
    expect(model.summary.potentialCount).toBe(1);
    expect(model.summary.byCategory).toEqual({
      security: 1,
      wordpress: 1,
      'content-quality': 1,
    });
    expect(model.findings.every(f => f.status !== 'active')).toBe(true);
    expect(model.summary.byStatus?.confirmed).toBe(1);
    expect(model.summary.byStatus?.potential).toBe(2);
  });

  it('embeds valid confined screenshots and records safe fallback reasons for missing/traversal paths', () => {
    const tmpScreenshotsDir = path.resolve(
      'D:/ahmed/.tmp/test-visual-evidence',
      `suite-${Date.now()}`,
    );
    fs.mkdirSync(tmpScreenshotsDir, { recursive: true });
    try {
      const pngBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      fs.writeFileSync(path.join(tmpScreenshotsDir, 'valid-evidence.png'), pngBytes);

      const findingsWithMedia: FindingDTO[] = [
        {
          ...mockFindings[0],
          id: 'f-img-ok',
          ruleId: 'RESPONSIVE_HORIZONTAL_OVERFLOW',
          category: 'responsive-design',
          evidence: {
            screenshot: {
              fileName: 'valid-evidence.png',
              viewportProfile: 'mobile-320',
              width: 320,
              height: 568,
              fileSizeBytes: pngBytes.length,
            },
          },
        },
        {
          ...mockFindings[1],
          id: 'f-img-missing',
          ruleId: 'RESPONSIVE_ELEMENT_CLIPPED',
          category: 'responsive-design',
          evidence: {
            screenshot: {
              fileName: 'missing-evidence.png',
              viewportProfile: 'mobile-320',
              width: 320,
              height: 568,
              fileSizeBytes: 512,
            },
          },
        },
        {
          ...mockFindings[2],
          id: 'f-img-traversal',
          ruleId: 'RESPONSIVE_MEDIA_OVERFLOW',
          category: 'responsive-design',
          evidence: {
            screenshot: {
              fileName: '../outside.png',
              viewportProfile: 'desktop-1440',
              width: 1440,
              height: 900,
              fileSizeBytes: 512,
            },
          },
        },
      ];

      const deps = {
        siteRepo: { getById: vi.fn().mockReturnValue(mockSite) } as any,
        scanRunRepo: { getById: vi.fn().mockReturnValue(mockScanRun) } as any,
        findingRepo: { getAllByScanRunId: vi.fn().mockReturnValue(findingsWithMedia) } as any,
      };

      const model = assembleReportData(mockScanRun.id, deps, {
        screenshotsDir: tmpScreenshotsDir,
      });

      expect(model.visualEvidence?.['valid-evidence.png']?.embedded).toBe(true);
      expect(model.visualEvidence?.['valid-evidence.png']?.dataUri).toContain(
        'data:image/png;base64,',
      );
      expect(model.visualEvidence?.['missing-evidence.png']?.embedded).toBe(false);
      expect(model.visualEvidence?.['missing-evidence.png']?.omittedReason).toContain('missing');
      expect(model.visualEvidence?.['../outside.png']?.embedded).toBe(false);
      expect(model.visualEvidence?.['../outside.png']?.omittedReason).toContain('invalid');
    } finally {
      fs.rmSync(tmpScreenshotsDir, { recursive: true, force: true });
    }
  });
});
