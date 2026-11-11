import { describe, it, expect } from 'vitest';
import {
  CreateScanRunRequestSchema,
  GetScanRunRequestSchema,
  ListScanRunsRequestSchema,
  ScanRunDTOSchema,
  isValidScanRunTransition,
  isTerminalScanRunStatus,
  FindingDTOSchema,
  CreateFindingRequestSchema,
  ListFindingsRequestSchema,
  normalizeFindingLifecycleStatus,
  classifyFindingConfidenceBucket,
  normalizeFindingCategoryId,
  getFindingCategoryLabel,
  FINDING_CATEGORIES,
  FINDING_CATEGORY_FILTER_ORDER,
  ReportDTOSchema,
  CreateReportRequestSchema,
  ListReportsRequestSchema,
} from '../../src/index.js';

describe('ScanRun, Finding, and Report Schemas & State Machine', () => {
  describe('Scan Run Lifecycle Transitions', () => {
    it('validates legal transitions', () => {
      expect(isValidScanRunTransition('pending', 'running')).toBe(true);
      expect(isValidScanRunTransition('pending', 'cancelled')).toBe(true);
      expect(isValidScanRunTransition('running', 'completed')).toBe(true);
      expect(isValidScanRunTransition('running', 'failed')).toBe(true);
      expect(isValidScanRunTransition('running', 'cancelled')).toBe(true);
    });

    it('rejects illegal transitions', () => {
      expect(isValidScanRunTransition('pending', 'completed')).toBe(false);
      expect(isValidScanRunTransition('completed', 'running')).toBe(false);
      expect(isValidScanRunTransition('failed', 'running')).toBe(false);
      expect(isValidScanRunTransition('cancelled', 'running')).toBe(false);
      expect(isValidScanRunTransition('completed', 'cancelled')).toBe(false);
    });

    it('identifies terminal states correctly', () => {
      expect(isTerminalScanRunStatus('pending')).toBe(false);
      expect(isTerminalScanRunStatus('running')).toBe(false);
      expect(isTerminalScanRunStatus('completed')).toBe(true);
      expect(isTerminalScanRunStatus('failed')).toBe(true);
      expect(isTerminalScanRunStatus('cancelled')).toBe(true);
    });
  });

  describe('Scan Run Schemas', () => {
    it('validates CreateScanRunRequestSchema with defaults', () => {
      const parsed = CreateScanRunRequestSchema.parse({
        siteId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(parsed.siteId).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(parsed.scanType).toBe('full');
      expect(parsed.config).toEqual({});

      const getReq = GetScanRunRequestSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(getReq.id).toBe('123e4567-e89b-12d3-a456-426614174000');

      const listReq = ListScanRunsRequestSchema.parse({
        siteId: '123e4567-e89b-12d3-a456-426614174000',
        limit: 25,
      });
      expect(listReq.limit).toBe(25);
    });

    it('validates ScanRunDTOSchema', () => {
      const run = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        siteId: '123e4567-e89b-12d3-a456-426614174001',
        scanType: 'security' as const,
        status: 'running' as const,
        targetUrl: 'https://example.com',
        startedAt: new Date().toISOString(),
        completedAt: null,
        cancelledAt: null,
        durationMs: null,
        config: { maxDepth: 3 },
        summary: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(() => ScanRunDTOSchema.parse(run)).not.toThrow();
    });
  });

  describe('Finding Schemas', () => {
    it('validates CreateFindingRequestSchema', () => {
      const parsed = CreateFindingRequestSchema.parse({
        scanRunId: '123e4567-e89b-12d3-a456-426614174000',
        ruleId: 'wp-debug-enabled',
        category: 'security',
        title: 'WP_DEBUG is True',
        description: 'Debug flag is active in production configuration',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com/wp-config.php',
        evidence: { line: 42, match: 'define("WP_DEBUG", true);' },
        remediation: 'Disable debug mode in wp-config.php',
        references: ['https://wordpress.org/support/article/debugging-in-wordpress/'],
      });
      expect(parsed.title).toBe('WP_DEBUG is True');
      expect(parsed.status).toBe('potential');
    });

    it('normalizes finding lifecycle statuses and keeps firm distinct from confirmed', () => {
      expect(normalizeFindingLifecycleStatus(undefined, 'confirmed')).toBe('confirmed');
      expect(normalizeFindingLifecycleStatus('active', 'confirmed')).toBe('confirmed');
      expect(normalizeFindingLifecycleStatus('active', 'potential')).toBe('potential');
      expect(normalizeFindingLifecycleStatus('active', 'firm')).toBe('potential');
      expect(normalizeFindingLifecycleStatus('potential', 'firm')).toBe('potential');
      expect(normalizeFindingLifecycleStatus('confirmed', 'firm')).toBe('confirmed');
      expect(normalizeFindingLifecycleStatus('needs_manual_review', 'potential')).toBe(
        'needs_manual_review',
      );

      expect(classifyFindingConfidenceBucket('confirmed')).toBe('confirmed');
      expect(classifyFindingConfidenceBucket('high')).toBe('confirmed');
      expect(classifyFindingConfidenceBucket('firm')).toBe('firm');
      expect(classifyFindingConfidenceBucket('medium')).toBe('firm');
      expect(classifyFindingConfidenceBucket('potential')).toBe('potential');
      expect(classifyFindingConfidenceBucket('tentative')).toBe('potential');
      expect(classifyFindingConfidenceBucket('low')).toBe('potential');
    });

    it('normalizes legacy and canonical finding categories 1:1 without overlap', () => {
      expect(FINDING_CATEGORY_FILTER_ORDER.map(c => c.id)).toEqual([...FINDING_CATEGORIES]);
      expect(
        normalizeFindingCategoryId({
          ruleId: 'WP_VERSION_DISCLOSED',
          category: 'Information Disclosure',
        }),
      ).toBe('wordpress');
      expect(
        normalizeFindingCategoryId({
          ruleId: 'SEC_HEADER_CSP_MISSING',
          category: 'Content Security',
        }),
      ).toBe('security');
      expect(
        normalizeFindingCategoryId({
          ruleId: 'SEC_HEADER_REFERRER_POLICY_MISSING',
          category: 'Information Disclosure',
        }),
      ).toBe('security');
      expect(
        normalizeFindingCategoryId({ ruleId: 'CONTENT_THIN_TEXT', category: 'Content Quality' }),
      ).toBe('content-quality');
      expect(
        normalizeFindingCategoryId({ ruleId: 'CONTENT_DOM_BLOAT', category: 'DOM Quality' }),
      ).toBe('dom-quality');
      expect(
        normalizeFindingCategoryId({
          ruleId: 'CONTENT_HIGH_LINK_DENSITY',
          category: 'Content Structure',
        }),
      ).toBe('content-structure');
      expect(
        normalizeFindingCategoryId({
          ruleId: 'PERF_SLOW_SERVER_RESPONSE',
          category: 'Static Performance',
        }),
      ).toBe('static-performance');
      expect(
        normalizeFindingCategoryId({
          ruleId: 'SEO_LANG_MISSING',
          category: 'Technical SEO & Accessibility',
        }),
      ).toBe('technical-seo');
      expect(
        normalizeFindingCategoryId({
          ruleId: 'CONTENT_EMPTY_LINK',
          category: 'Accessibility & Quality',
        }),
      ).toBe('accessibility');
      expect(getFindingCategoryLabel('static-performance')).toBe('Static Performance');
      expect(
        getFindingCategoryLabel({ ruleId: 'WP_DETECTED', category: 'Technology Detection' }),
      ).toBe('WordPress');
    });

    it('validates FindingDTOSchema', () => {
      const finding = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        scanRunId: '123e4567-e89b-12d3-a456-426614174001',
        ruleId: 'tls-expired',
        category: 'security',
        title: 'TLS Certificate Expired',
        description: 'The SSL/TLS certificate has expired.',
        severity: 'critical' as const,
        confidence: 'confirmed' as const,
        status: 'confirmed' as const,
        targetUrl: 'https://example.com',
        evidence: null,
        remediation: null,
        references: null,
        createdAt: new Date().toISOString(),
      };
      expect(() => FindingDTOSchema.parse(finding)).not.toThrow();

      const listReq = ListFindingsRequestSchema.parse({
        scanRunId: '123e4567-e89b-12d3-a456-426614174000',
        severity: 'critical',
      });
      expect(listReq.severity).toBe('critical');
      expect(listReq.limit).toBe(50);

      // Regression test: ensure requested limits up to 1000 (such as default 500 from useScans) succeed
      const listReq500 = ListFindingsRequestSchema.parse({
        scanRunId: '123e4567-e89b-12d3-a456-426614174000',
        limit: 500,
      });
      expect(listReq500.limit).toBe(500);

      const listReq1000 = ListFindingsRequestSchema.parse({
        scanRunId: '123e4567-e89b-12d3-a456-426614174000',
        limit: 1000,
      });
      expect(listReq1000.limit).toBe(1000);

      // Verify limits over 1000 or under 1 are rejected
      expect(() =>
        ListFindingsRequestSchema.parse({
          scanRunId: '123e4567-e89b-12d3-a456-426614174000',
          limit: 1001,
        }),
      ).toThrow();

      expect(() =>
        ListFindingsRequestSchema.parse({
          scanRunId: '123e4567-e89b-12d3-a456-426614174000',
          limit: 0,
        }),
      ).toThrow();
    });
  });

  describe('Report Schemas', () => {
    it('validates CreateReportRequestSchema and ReportDTOSchema', () => {
      const parsed = CreateReportRequestSchema.parse({
        scanRunId: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Executive Audit Summary',
        format: 'json',
        summary: { totalFindings: 1 },
      });
      expect(parsed.title).toBe('Executive Audit Summary');

      const listReq = ListReportsRequestSchema.parse({
        scanRunId: '123e4567-e89b-12d3-a456-426614174000',
        status: 'generated',
      });
      expect(listReq.status).toBe('generated');

      const report = {
        id: '123e4567-e89b-12d3-a456-426614174002',
        scanRunId: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Executive Audit Summary',
        format: 'json' as const,
        status: 'generated' as const,
        summary: { totalFindings: 1 },
        storagePath: 'D:\\ahmed\\reports\\rep-001.json',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(() => ReportDTOSchema.parse(report)).not.toThrow();
    });
  });
});
