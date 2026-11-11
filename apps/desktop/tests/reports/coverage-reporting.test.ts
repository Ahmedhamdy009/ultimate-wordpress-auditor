import { describe, it, expect, vi } from 'vitest';
import { assembleReportData } from '../../src/main/reports/assembler.js';
import { generateHtmlReport } from '../../src/main/reports/html-generator.js';
import { generateJsonReport } from '../../src/main/reports/json-generator.js';
import type { FindingDTO, ScanRunDTO, SiteDTO } from '@auditor/shared';
import type { ReportModel } from '../../src/main/reports/types.js';

describe('Coverage Reporting & Truthful Status Suite (Assembler, HTML, JSON)', () => {
  const mockSite: SiteDTO = {
    id: 'site-cov-1',
    projectId: 'proj-cov-1',
    name: 'Coverage Test Store',
    baseUrl: 'https://coverage.example.com',
    platformType: 'wordpress',
    environmentType: 'production',
    description: 'Test site',
    isArchived: false,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };

  const mockFinding: FindingDTO = {
    id: 'f-cov-1',
    scanRunId: 'scan-cov-1',
    ruleId: 'SEC-HEADER-CSP-MISSING',
    category: 'security',
    title: 'Content-Security-Policy Missing',
    description: 'The response does not include CSP.',
    severity: 'high',
    confidence: 'confirmed',
    status: 'active',
    targetUrl: 'https://coverage.example.com/',
    evidence: { header: null },
    remediation: 'Configure CSP.',
    references: [],
    createdAt: '2026-11-07T12:01:00.000Z',
  };

  describe('1. Assembler Coverage Distinction & Historical Compatibility', () => {
    it('assembles a Full Coverage report when all candidates are audited', () => {
      const fullRun: ScanRunDTO = {
        id: 'scan-full',
        siteId: mockSite.id,
        scanType: 'full',
        status: 'completed',
        targetUrl: 'https://coverage.example.com/',
        startedAt: '2026-11-07T12:00:00.000Z',
        completedAt: '2026-11-07T12:02:00.000Z',
        cancelledAt: null,
        durationMs: 120000,
        config: { maxPages: 10 },
        summary: {
          totalFindings: 1,
          pagesScanned: 10,
          pagesFailed: 0,
          browserPagesAudited: 5,
          browserCandidatesTotal: 5,
          browserCandidatesSkipped: 0,
          isPartialCoverage: false,
          coverageStatus: 'full',
        },
        error: null,
        createdAt: '2026-11-07T11:59:00.000Z',
        updatedAt: '2026-11-07T12:02:00.000Z',
      };

      const deps = {
        siteRepo: { getById: vi.fn().mockReturnValue(mockSite) } as any,
        scanRunRepo: { getById: vi.fn().mockReturnValue(fullRun) } as any,
        findingRepo: { getAllByScanRunId: vi.fn().mockReturnValue([mockFinding]) } as any,
      };

      const model = assembleReportData(fullRun.id, deps);
      expect(model.summary.coverageStatus).toBe('full');
      expect(model.summary.isPartialCoverage).toBe(false);
      expect(model.summary.isPartialAudit).toBe(false);
      expect(model.summary.browserCandidatesSkipped).toBe(0);
      expect(model.title).toContain('(Full Coverage)');
    });

    it('assembles a Partial Coverage report when candidates are skipped due to budget', () => {
      const partialRun: ScanRunDTO = {
        id: 'scan-partial',
        siteId: mockSite.id,
        scanType: 'full',
        status: 'completed',
        targetUrl: 'https://coverage.example.com/',
        startedAt: '2026-11-07T12:00:00.000Z',
        completedAt: '2026-11-07T12:01:00.000Z',
        cancelledAt: null,
        durationMs: 60000,
        config: { maxPages: 25 },
        summary: {
          totalFindings: 1,
          pagesScanned: 25,
          pagesFailed: 0,
          browserPagesAudited: 2,
          browserCandidatesTotal: 5,
          browserCandidatesSkipped: 3,
          isPartialCoverage: true,
          coverageStatus: 'partial',
          coverageWarning: '3 browser candidate page(s) were skipped due to remaining scan duration budget.',
        },
        error: null,
        createdAt: '2026-11-07T11:59:00.000Z',
        updatedAt: '2026-11-07T12:01:00.000Z',
      };

      const deps = {
        siteRepo: { getById: vi.fn().mockReturnValue(mockSite) } as any,
        scanRunRepo: { getById: vi.fn().mockReturnValue(partialRun) } as any,
        findingRepo: { getAllByScanRunId: vi.fn().mockReturnValue([mockFinding]) } as any,
      };

      const model = assembleReportData(partialRun.id, deps);
      expect(model.summary.coverageStatus).toBe('partial');
      expect(model.summary.isPartialCoverage).toBe(true);
      expect(model.summary.browserCandidatesSkipped).toBe(3);
      expect(model.title).toContain('(Partial Browser Coverage)');
    });

    it('preserves historical scan records where coverageStatus field is absent', () => {
      const legacyRun: ScanRunDTO = {
        id: 'scan-legacy',
        siteId: mockSite.id,
        scanType: 'full',
        status: 'completed',
        targetUrl: 'https://coverage.example.com/',
        startedAt: '2026-11-05T12:00:00.000Z',
        completedAt: '2026-11-05T12:02:00.000Z',
        cancelledAt: null,
        durationMs: 120000,
        config: { maxPages: 5 },
        summary: {
          totalFindings: 1,
          pagesScanned: 5,
          pagesFailed: 0,
          browserPagesAudited: 2,
          // Note: browserCandidatesTotal and coverageStatus absent
        },
        error: null,
        createdAt: '2026-11-05T11:59:00.000Z',
        updatedAt: '2026-11-05T12:02:00.000Z',
      };

      const deps = {
        siteRepo: { getById: vi.fn().mockReturnValue(mockSite) } as any,
        scanRunRepo: { getById: vi.fn().mockReturnValue(legacyRun) } as any,
        findingRepo: { getAllByScanRunId: vi.fn().mockReturnValue([mockFinding]) } as any,
      };

      const model = assembleReportData(legacyRun.id, deps);
      expect(model.summary.coverageStatus).toBeDefined();
      expect(model.reportId).toBeDefined();
    });

    it('assembles a Cancelled report with distinct title and isPartialAudit=true', () => {
      const cancelledRun: ScanRunDTO = {
        id: 'scan-cancelled',
        siteId: mockSite.id,
        scanType: 'full',
        status: 'cancelled',
        targetUrl: 'https://coverage.example.com/',
        startedAt: '2026-11-07T12:00:00.000Z',
        completedAt: null,
        cancelledAt: '2026-11-07T12:00:30.000Z',
        durationMs: 30000,
        config: { maxPages: 25 },
        summary: null,
        error: null,
        createdAt: '2026-11-07T11:59:00.000Z',
        updatedAt: '2026-11-07T12:00:30.000Z',
      };

      const deps = {
        siteRepo: { getById: vi.fn().mockReturnValue(mockSite) } as any,
        scanRunRepo: { getById: vi.fn().mockReturnValue(cancelledRun) } as any,
        findingRepo: { getAllByScanRunId: vi.fn().mockReturnValue([]) } as any,
      };

      const model = assembleReportData(cancelledRun.id, deps);
      expect(model.summary.scanStatus).toBe('cancelled');
      expect(model.summary.isPartialAudit).toBe(true);
      expect(model.title).toContain('Cancelled Security & Audit Report');
    });
  });

  describe('2. HTML Generator Truthful Coverage Presentation', () => {
    it('renders FULL COVERAGE badge and no partial coverage warning for complete scan', () => {
      const fullModel: ReportModel = {
        reportId: 'rep-full',
        title: 'Full Coverage Audit',
        site: mockSite,
        scanRun: {
          id: 'scan-full',
          siteId: mockSite.id,
          scanType: 'full',
          status: 'completed',
          targetUrl: 'https://coverage.example.com/',
          startedAt: '2026-11-07T12:00:00.000Z',
          completedAt: '2026-11-07T12:02:00.000Z',
          cancelledAt: null,
          durationMs: 120000,
          config: {},
          isPartialCoverage: false,
          coverageStatus: 'full',
        },
        findings: [mockFinding],
        summary: {
          totalFindings: 1,
          bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
          byCategory: { security: 1 },
          confirmedCount: 1,
          potentialCount: 0,
          pagesScanned: 10,
          pagesFailed: 0,
          browserPagesAudited: 5,
          browserCandidatesTotal: 5,
          browserCandidatesSkipped: 0,
          scanDurationMs: 120000,
          scanStatus: 'completed',
          isPartialAudit: false,
          isPartialCoverage: false,
          coverageStatus: 'full',
          generatedAt: '2026-11-07T12:05:00.000Z',
        },
        generatedAt: '2026-11-07T12:05:00.000Z',
        version: '1.0.0',
      };

      const html = generateHtmlReport(fullModel);
      expect(html).toContain('FULL COVERAGE');
      expect(html).not.toContain('PARTIAL BROWSER COVERAGE');
      expect(html).not.toContain('Notice: Audit Completed with Partial Browser Coverage');
      expect(html).toContain('COMPLETE AUDIT (FULL COVERAGE)');
    });

    it('renders PARTIAL BROWSER COVERAGE badge and prominent warning banner when candidates were skipped', () => {
      const partialModel: ReportModel = {
        reportId: 'rep-partial',
        title: 'Partial Coverage Audit',
        site: mockSite,
        scanRun: {
          id: 'scan-partial',
          siteId: mockSite.id,
          scanType: 'full',
          status: 'completed',
          targetUrl: 'https://coverage.example.com/',
          startedAt: '2026-11-07T12:00:00.000Z',
          completedAt: '2026-11-07T12:01:00.000Z',
          cancelledAt: null,
          durationMs: 60000,
          config: {},
          isPartialCoverage: true,
          coverageStatus: 'partial',
          browserCandidatesTotal: 5,
          browserCandidatesSkipped: 3,
        },
        findings: [mockFinding],
        summary: {
          totalFindings: 1,
          bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
          byCategory: { security: 1 },
          confirmedCount: 1,
          potentialCount: 0,
          pagesScanned: 25,
          pagesFailed: 0,
          browserPagesAudited: 2,
          browserCandidatesTotal: 5,
          browserCandidatesSkipped: 3,
          scanDurationMs: 60000,
          scanStatus: 'completed',
          isPartialAudit: false,
          isPartialCoverage: true,
          coverageStatus: 'partial',
          coverageWarning: '3 browser candidate page(s) were skipped due to remaining scan duration budget.',
          generatedAt: '2026-11-07T12:05:00.000Z',
        },
        generatedAt: '2026-11-07T12:05:00.000Z',
        version: '1.0.0',
      };

      const html = generateHtmlReport(partialModel);
      expect(html).toContain('PARTIAL BROWSER COVERAGE');
      expect(html).toContain('Notice: Audit Completed with Partial Browser Coverage');
      expect(html).toContain('3 skipped due to time budget');
      expect(html).toContain('COMPLETED (PARTIAL BROWSER COVERAGE)');
      expect(html).toContain('2 of 5 audited');
    });

    it('renders cancelled warning when scan is cancelled', () => {
      const cancelledModel: ReportModel = {
        reportId: 'rep-cancelled',
        title: 'Cancelled Audit',
        site: mockSite,
        scanRun: {
          id: 'scan-cancelled',
          siteId: mockSite.id,
          scanType: 'full',
          status: 'cancelled',
          targetUrl: 'https://coverage.example.com/',
          startedAt: '2026-11-07T12:00:00.000Z',
          completedAt: null,
          cancelledAt: '2026-11-07T12:00:30.000Z',
          durationMs: 30000,
          config: {},
          isPartialAudit: true,
        },
        findings: [],
        summary: {
          totalFindings: 0,
          bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          byCategory: {},
          confirmedCount: 0,
          potentialCount: 0,
          pagesScanned: 2,
          pagesFailed: 0,
          scanDurationMs: 30000,
          scanStatus: 'cancelled',
          isPartialAudit: true,
          generatedAt: '2026-11-07T12:05:00.000Z',
        },
        generatedAt: '2026-11-07T12:05:00.000Z',
        version: '1.0.0',
      };

      const html = generateHtmlReport(cancelledModel);
      expect(html).toContain('Warning: Incomplete / CANCELLED Scan Run');
      expect(html).toContain('PARTIAL AUDIT (INTERRUPTED)');
    });
  });

  describe('3. JSON Generator Coverage Fields', () => {
    it('exports all coverage metrics faithfully in JSON output', () => {
      const partialModel: ReportModel = {
        reportId: 'rep-json',
        title: 'JSON Coverage Test',
        site: mockSite,
        scanRun: {
          id: 'scan-json',
          siteId: mockSite.id,
          scanType: 'full',
          status: 'completed',
          targetUrl: 'https://coverage.example.com/',
          startedAt: '2026-11-07T12:00:00.000Z',
          completedAt: '2026-11-07T12:01:00.000Z',
          cancelledAt: null,
          durationMs: 60000,
          config: {},
          browserCandidatesTotal: 5,
          browserCandidatesSkipped: 3,
          isPartialCoverage: true,
          coverageStatus: 'partial',
          coverageWarning: '3 browser candidate page(s) were skipped due to remaining scan duration budget.',
        },
        findings: [mockFinding],
        summary: {
          totalFindings: 1,
          bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
          byCategory: { security: 1 },
          confirmedCount: 1,
          potentialCount: 0,
          pagesScanned: 25,
          pagesFailed: 0,
          browserPagesAudited: 2,
          browserCandidatesTotal: 5,
          browserCandidatesSkipped: 3,
          scanDurationMs: 60000,
          scanStatus: 'completed',
          isPartialAudit: false,
          isPartialCoverage: true,
          coverageStatus: 'partial',
          coverageWarning: '3 browser candidate page(s) were skipped due to remaining scan duration budget.',
          generatedAt: '2026-11-07T12:05:00.000Z',
        },
        generatedAt: '2026-11-07T12:05:00.000Z',
        version: '1.0.0',
      };

      const jsonStr = generateJsonReport(partialModel);
      const parsed = JSON.parse(jsonStr);

      expect(parsed.summary.coverageStatus).toBe('partial');
      expect(parsed.summary.isPartialCoverage).toBe(true);
      expect(parsed.summary.browserCandidatesTotal).toBe(5);
      expect(parsed.summary.browserCandidatesSkipped).toBe(3);
      expect(parsed.summary.coverageWarning).toBeDefined();

      expect(parsed.scanRun.coverageStatus).toBe('partial');
      expect(parsed.scanRun.isPartialCoverage).toBe(true);
      expect(parsed.scanRun.browserCandidatesTotal).toBe(5);
      expect(parsed.scanRun.browserCandidatesSkipped).toBe(3);
    });
  });
});
