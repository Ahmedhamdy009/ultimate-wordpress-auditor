import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderComponentToHtml, renderTestHook } from '../helpers/react-test-harness.js';
import {
  ScansView,
  getFindingConfidenceBadgeProps,
  getFindingStatusBadgeProps,
  isWordPressCategoryFinding,
} from '../../src/renderer/src/components/views/ScansView.js';
import { useScans } from '../../src/renderer/src/hooks/useScans.js';
import type { ScanRunDTO, ScanProgressDTO, FindingDTO, ProjectDTO, SiteDTO } from '@auditor/shared';

describe('Phase 3 — Batch 3.7: ScansView & useScans Suite', () => {
  const mockProject: ProjectDTO = {
    id: 'proj-1111-2222-3333-4444',
    name: 'Acme E-Commerce Inc',
    description: 'Main production e-commerce store',
    isArchived: false,
    createdAt: '2026-11-07T10:00:00.000Z',
    updatedAt: '2026-11-07T10:00:00.000Z',
  };

  const mockSite: SiteDTO = {
    id: 'site-1111-2222-3333-4444',
    projectId: mockProject.id,
    name: 'Production Storefront',
    baseUrl: 'https://example.com',
    platformType: 'wordpress',
    environmentType: 'production',
    description: 'Public storefront',
    isArchived: false,
    createdAt: '2026-11-07T10:00:00.000Z',
    updatedAt: '2026-11-07T10:00:00.000Z',
  };

  const mockScanRun: ScanRunDTO = {
    id: 'scan-1111-2222-3333-4444',
    siteId: mockSite.id,
    scanType: 'full',
    status: 'completed',
    targetUrl: 'https://example.com',
    startedAt: '2026-11-07T12:00:00.000Z',
    completedAt: '2026-11-07T12:00:15.000Z',
    cancelledAt: null,
    durationMs: 15000,
    config: { maxPages: 25, maxDepth: 3 },
    summary: {
      totalFindings: 3,
      criticalCount: 1,
      highCount: 1,
      mediumCount: 1,
      lowCount: 0,
      infoCount: 0,
    },
    error: null,
    createdAt: '2026-11-07T12:00:00.000Z',
    updatedAt: '2026-11-07T12:00:15.000Z',
  };

  const mockProgress: ScanProgressDTO = {
    scanId: mockScanRun.id,
    status: 'running',
    stage: 'crawling',
    pagesAttempted: 12,
    pagesSucceeded: 12,
    pagesFailed: 0,
    pagesPending: 8,
    uniqueUrlsDiscovered: 20,
    currentCrawlDepth: 2,
    findingsProduced: 3,
    findingsPersisted: 3,
    activeRequests: 2,
    elapsedMs: 8400,
    currentUrl: 'https://example.com/shop/checkout',
  };

  const mockFinding: FindingDTO = {
    id: 'find-1111-2222-3333-4444',
    scanRunId: mockScanRun.id,
    ruleId: 'SEC-HEADER-HSTS-MISSING',
    category: 'Security Headers',
    title: 'Missing HTTP Strict Transport Security (HSTS) Header',
    description:
      'The response does not include the Strict-Transport-Security header, leaving HTTPS sessions vulnerable to downgrade attacks.',
    severity: 'high',
    confidence: 'confirmed',
    status: 'active',
    targetUrl: 'https://example.com/shop/checkout',
    evidence: {
      headerChecked: 'Strict-Transport-Security',
      responseHeaders: { 'content-type': 'text/html; charset=utf-8' },
    },
    remediation:
      'Configure Strict-Transport-Security: max-age=31536000; includeSubDomains on all HTTPS responses.',
    references: ['https://tools.ietf.org/html/rfc6797'],
    createdAt: '2026-11-07T12:00:10.000Z',
  };

  let mockElectronAPI: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    mockElectronAPI = {
      listProjects: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [mockProject], total: 1, limit: 50, offset: 0 },
      }),
      listSites: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [mockSite], total: 1, limit: 50, offset: 0 },
      }),
      listScanRuns: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [mockScanRun], total: 1, limit: 50, offset: 0 },
      }),
      createScanRun: vi.fn().mockResolvedValue({
        success: true,
        data: mockScanRun,
      }),
      cancelScanRun: vi.fn().mockResolvedValue({
        success: true,
        data: { ...mockScanRun, status: 'cancelled', cancelledAt: '2026-11-07T12:00:08.000Z' },
      }),
      getScanProgress: vi.fn().mockResolvedValue({
        success: true,
        data: mockProgress,
      }),
      listFindings: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [mockFinding], total: 1, limit: 100, offset: 0 },
      }),
      createReport: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'rep-1111-2222-3333-4444',
          scanRunId: mockScanRun.id,
          title: 'Audit Report — example.com',
          format: 'html',
          status: 'generated',
          storagePath: 'D:\\ahmed\\reports\\audit.html',
          createdAt: '2026-11-07T12:00:20.000Z',
        },
      }),
    };

    const g = globalThis as Record<string, unknown>;
    g.electronAPI = mockElectronAPI;
    const win = (g.window || {}) as Record<string, unknown>;
    win.electronAPI = mockElectronAPI;
    g.window = win;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const g = globalThis as Record<string, unknown>;
    delete g.electronAPI;
  });

  describe('ScansView Component Rendering', () => {
    it('renders the header banner, metrics cards, launcher form, and history list', () => {
      const html = renderComponentToHtml(React.createElement(ScansView));

      expect(html).toContain('Audit &amp; Scans');
      expect(html).toContain('Scan Launcher');
      expect(html).toContain('Active Scan Monitor');
      expect(html).toContain('Scan Run History');
      expect(html).toContain('Total Scans');
      expect(html).toContain('Target Project');
      expect(html).toContain('Target Site');
      expect(html).toContain('Target Entry URL');
      expect(html).toContain('Quick (10 pages)');
      expect(html).toContain('Standard (25 pages)');
      expect(html).toContain('Deep (100 pages)');
      expect(html).toContain('Max Pages (1–100)');
      expect(html).toContain('Max Depth (1–5)');
      expect(html).toContain('Timeout (10–300s)');
      expect(html).toContain('Backend Concurrency Policy:');
    });

    it('renders empty monitor state when no scan is active', () => {
      const html = renderComponentToHtml(React.createElement(ScansView));
      expect(html).toContain('No active scan running');
      expect(html).toContain('IDLE');
    });
  });

  describe('useScans Hook Lifecycle & State Management', () => {
    it('initializes with default empty state and loads scans', async () => {
      const harness = await renderTestHook(() => useScans({ autoLoad: true }));
      await harness.mount();

      expect(mockElectronAPI.listScanRuns).toHaveBeenCalledTimes(1);
      expect(harness.result.current.loading).toBe(false);
      expect(harness.result.current.scans.length).toBe(1);
      expect(harness.result.current.scans[0].id).toBe(mockScanRun.id);
      expect(harness.result.current.activeScan).toBe(null);

      await harness.unmount();
    });

    it('creates a new scan run and sets it as activeScan', async () => {
      const harness = await renderTestHook(() => useScans({ autoLoad: false }));
      await harness.mount();

      let createdRun: ScanRunDTO | null = null;
      await harness.act(async () => {
        createdRun = await harness.result.current.createScan({
          siteId: mockSite.id,
          targetUrl: 'https://example.com',
          scanType: 'full',
          config: { maxPages: 25, maxDepth: 3 },
        });
      });

      expect(mockElectronAPI.createScanRun).toHaveBeenCalledWith({
        siteId: mockSite.id,
        targetUrl: 'https://example.com',
        scanType: 'full',
        config: { maxPages: 25, maxDepth: 3 },
      });
      expect(createdRun).not.toBeNull();
      expect(harness.result.current.activeScan?.id).toBe(mockScanRun.id);

      await harness.unmount();
    });

    it('handles scan creation failure safely without throwing', async () => {
      mockElectronAPI.createScanRun.mockResolvedValueOnce({
        success: false,
        error: {
          code: 'ERR_SCAN_RUN_ACTIVE',
          message: 'Maximum concurrent scan limit reached (2 scans max).',
        },
      });

      const harness = await renderTestHook(() => useScans({ autoLoad: false }));
      await harness.mount();

      let createdRun: ScanRunDTO | null = null;
      await harness.act(async () => {
        createdRun = await harness.result.current.createScan({
          siteId: mockSite.id,
          targetUrl: 'https://example.com',
        });
      });

      expect(createdRun).toBeNull();
      expect(harness.result.current.activeScan).toBeNull();
      expect(harness.result.current.error?.code).toBe('ERR_SCAN_RUN_ACTIVE');
      expect(harness.result.current.error?.message).toContain(
        'Maximum concurrent scan limit reached',
      );

      await harness.unmount();
    });

    it('cancels an active scan run and updates status', async () => {
      const harness = await renderTestHook(() => useScans({ autoLoad: false }));
      await harness.mount();

      // First create scan
      await harness.act(async () => {
        await harness.result.current.createScan({
          siteId: mockSite.id,
          targetUrl: 'https://example.com',
        });
      });

      let cancelSuccess = false;
      await harness.act(async () => {
        cancelSuccess = await harness.result.current.cancelScan(mockScanRun.id);
      });

      expect(cancelSuccess).toBe(true);
      expect(mockElectronAPI.cancelScanRun).toHaveBeenCalledWith({ id: mockScanRun.id });
      expect(harness.result.current.activeScan?.status).toBe('cancelled');

      await harness.unmount();
    });

    it('loads findings for a selected scan run', async () => {
      const harness = await renderTestHook(() => useScans({ autoLoad: false }));
      await harness.mount();

      expect(harness.result.current.findings.length).toBe(0);

      await harness.act(async () => {
        await harness.result.current.selectScan(mockScanRun.id);
      });

      expect(mockElectronAPI.listFindings).toHaveBeenCalledWith({
        scanRunId: mockScanRun.id,
        limit: 500,
        offset: 0,
        severity: undefined,
        category: undefined,
        status: undefined,
      });

      expect(harness.result.current.findings.length).toBe(1);
      expect(harness.result.current.totalFindings).toBe(1);
      expect(harness.result.current.findings[0].ruleId).toBe('SEC-HEADER-HSTS-MISSING');
      expect(harness.result.current.findings[0].confidence).toBe('confirmed');

      await harness.unmount();
    });

    it('exposes totalFindings count when scan has more findings than page limit', async () => {
      mockElectronAPI.listFindings.mockResolvedValueOnce({
        success: true,
        data: {
          items: [mockFinding],
          total: 133,
          limit: 100,
          offset: 0,
        },
      });

      const harness = await renderTestHook(() => useScans({ autoLoad: false }));
      await harness.mount();

      await harness.act(async () => {
        await harness.result.current.selectScan(mockScanRun.id);
      });

      expect(harness.result.current.findings.length).toBe(1);
      expect(harness.result.current.totalFindings).toBe(133);

      await harness.unmount();
    });

    it('clears active scan and findings cleanly on demand and unmount', async () => {
      const harness = await renderTestHook(() => useScans({ autoLoad: false }));
      await harness.mount();

      await harness.act(async () => {
        await harness.result.current.selectScan(mockScanRun.id);
      });
      expect(harness.result.current.findings.length).toBe(1);

      await harness.act(async () => {
        harness.result.current.clearFindings();
      });
      expect(harness.result.current.findings.length).toBe(0);
      expect(harness.result.current.selectedScanId).toBeNull();

      // Ensure clean unmount without throwing
      await harness.unmount();
    });

    it('isolates findings errors to findingsError without polluting global scan error state', async () => {
      mockElectronAPI.listFindings.mockResolvedValueOnce({
        success: false,
        error: {
          code: 'ERR_PAYLOAD_VALIDATION_FAILED',
          message: 'Payload validation failed',
        },
      });

      const harness = await renderTestHook(() => useScans({ autoLoad: false }));
      await harness.mount();

      await harness.act(async () => {
        await harness.result.current.selectScan(mockScanRun.id);
      });

      // Global scan error must remain null so successful scans never show a contradictory scan error
      expect(harness.result.current.error).toBeNull();
      // Findings error is cleanly isolated to findingsError
      expect(harness.result.current.findingsError).toEqual({
        code: 'ERR_PAYLOAD_VALIDATION_FAILED',
        message: 'Payload validation failed',
      });

      // Clearing findings also clears findingsError
      await harness.act(async () => {
        harness.result.current.clearFindings();
      });
      expect(harness.result.current.findingsError).toBeNull();

      await harness.unmount();
    });
  });

  describe('Truthful Coverage Badges & Monitor Presentation', () => {
    it('renders PARTIAL COVERAGE badge when completed scan skipped browser candidates', () => {
      const partialScan: ScanRunDTO = {
        ...mockScanRun,
        id: 'scan-partial-coverage',
        status: 'completed',
        summary: {
          ...mockScanRun.summary!,
          browserPagesAudited: 2,
          browserCandidatesTotal: 5,
          browserCandidatesSkipped: 3,
          coverageStatus: 'partial',
          isPartialCoverage: true,
        },
      };

      mockElectronAPI.listScanRuns.mockResolvedValueOnce({
        success: true,
        data: { items: [partialScan], total: 1, limit: 50, offset: 0 },
      });

      const html = renderComponentToHtml(
        React.createElement(ScansView, { initialScans: [partialScan] }),
      );
      expect(html).toContain('COMPLETED');
      expect(html).toContain('PARTIAL COVERAGE');
    });

    it('renders FULL COVERAGE badge when completed scan audited all browser candidates', () => {
      const fullScan: ScanRunDTO = {
        ...mockScanRun,
        id: 'scan-full-coverage',
        status: 'completed',
        summary: {
          ...mockScanRun.summary!,
          browserPagesAudited: 5,
          browserCandidatesTotal: 5,
          browserCandidatesSkipped: 0,
          coverageStatus: 'full',
          isPartialCoverage: false,
        },
      };

      mockElectronAPI.listScanRuns.mockResolvedValueOnce({
        success: true,
        data: { items: [fullScan], total: 1, limit: 50, offset: 0 },
      });

      const html = renderComponentToHtml(
        React.createElement(ScansView, { initialScans: [fullScan] }),
      );
      expect(html).toContain('COMPLETED');
      expect(html).toContain('FULL COVERAGE');
      expect(html).not.toContain('PARTIAL COVERAGE');
    });
  });

  describe('Findings Inspector Confidence & Category Filter Alignment', () => {
    it('maps confirmed and firm confidence distinct from potential to match report verification totals', () => {
      expect(getFindingConfidenceBadgeProps('confirmed')).toEqual({
        variant: 'success',
        label: 'Confirmed',
      });
      expect(getFindingConfidenceBadgeProps('firm')).toEqual({
        variant: 'info',
        label: 'Firm',
      });
      expect(getFindingConfidenceBadgeProps('potential')).toEqual({
        variant: 'neutral',
        label: 'Potential',
      });
    });

    it('classifies WP_* rules and Technology Detection/Observation findings under WordPress filter', () => {
      expect(
        isWordPressCategoryFinding({
          ruleId: 'WP_DETECTED',
          category: 'Technology Detection',
        }),
      ).toBe(true);
      expect(
        isWordPressCategoryFinding({
          ruleId: 'WP_REST_API_ADVERTISED',
          category: 'Technology Observation',
        }),
      ).toBe(true);
      expect(
        isWordPressCategoryFinding({
          ruleId: 'WP_XMLRPC_PINGBACK_ADVERTISED',
          category: 'Attack Surface',
        }),
      ).toBe(true);
      expect(
        isWordPressCategoryFinding({
          ruleId: 'SEC_HEADER_CSP_MISSING',
          category: 'Content Security',
        }),
      ).toBe(false);
    });

    it('normalizes legacy and omitted status into distinct status badge labels without emitting active', () => {
      expect(getFindingStatusBadgeProps('confirmed', 'confirmed')).toEqual({
        variant: 'success',
        label: 'Status: Confirmed',
      });
      expect(getFindingStatusBadgeProps('active', 'potential')).toEqual({
        variant: 'warning',
        label: 'Status: Potential',
      });
      expect(getFindingStatusBadgeProps('needs_manual_review', 'confirmed')).toEqual({
        variant: 'warning',
        label: 'Status: Needs Manual Review',
      });
    });
  });
});
