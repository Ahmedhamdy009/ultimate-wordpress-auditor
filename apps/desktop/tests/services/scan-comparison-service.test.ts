import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { FindingTriageService } from '../../src/main/services/finding-triage.service.js';
import {
  ScanComparisonService,
  ScanComparisonError,
  SCAN_COMPARISON_ERROR_CODES,
} from '../../src/main/services/scan-comparison.service.js';
import {
  type ScanRunSummaryDTO,
} from '@auditor/shared';

describe('ScanComparisonService & Differential Analysis Engine', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let triageService: FindingTriageService;
  let comparisonService: ScanComparisonService;

  let siteAId: string;
  let siteBId: string;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);
    triageService = new FindingTriageService(connection);
    comparisonService = new ScanComparisonService(
      connection,
      scanRunRepo,
      findingRepo,
      triageService,
      { cacheCapacity: 3 },
    );

    const project = projectRepo.create({ name: 'Security Audit Project' });
    const siteA = siteRepo.create({
      projectId: project.id,
      name: 'Primary Site',
      baseUrl: 'https://example.com',
    });
    siteAId = siteA.id;

    const siteB = siteRepo.create({
      projectId: project.id,
      name: 'Secondary Site',
      baseUrl: 'https://other-site.com',
    });
    siteBId = siteB.id;
  });

  afterEach(() => {
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  function createCompletedScan(
    siteId: string,
    options: {
      scanType?: 'full' | 'quick' | 'security';
      crawledUrls?: string[];
      browserAuditedUrls?: string[];
      completedEngines?: string[];
      auditModules?: Record<string, boolean>;
      registryVersion?: string;
      ruleCatalog?: string[];
      pagesFailed?: number;
    } = {},
  ) {
    const run = scanRunRepo.create({
      siteId,
      scanType: options.scanType ?? 'full',
      targetUrl: 'https://example.com',
      config: {
        auditModules: options.auditModules ?? {
          http: true,
          wordpress: true,
          securityHeaders: true,
          cookies: true,
          seo: true,
          accessibility: true,
        },
      },
    });

    scanRunRepo.updateStatus(run.id, {
      status: 'running',
      startedAt: new Date(Date.now() - 5000).toISOString(),
    });

    const summary: ScanRunSummaryDTO = {
      totalFindings: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      crawledUrls: options.crawledUrls ?? ['https://example.com', 'https://example.com/about'],
      browserAuditedUrls: options.browserAuditedUrls ?? ['https://example.com'],
      completedEngines: options.completedEngines ?? ['crawler', 'analyzers', 'browser'],
      ruleCatalog: options.ruleCatalog ?? ['SEC_HEADER_CSP_MISSING', 'A11Y_COLOR_CONTRAST', 'SEO_TITLE_MISSING'],
      ruleCatalogMetadata: {
        registryVersion: options.registryVersion ?? '2026.11-v1',
        admittedCount: 3,
        omittedCount: 0,
        unrecordedOmittedCount: 0,
        isCatalogTruncated: false,
        isOmissionIdentityTruncated: false,
        omittedRuleIds: [],
      },
      pagesFailed: options.pagesFailed ?? 0,
      crawlFailedPages: 0,
      browserFailedPages: 0,
    };

    return scanRunRepo.updateStatus(run.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      durationMs: 5000,
      summary,
    });
  }

  describe('1. Security Guards & Pre-flight Validation', () => {
    it('throws ERR_COMPARISON_INVALID_REQUEST when scan IDs are missing', async () => {
      await expect(comparisonService.compareScans('', 'scan-2')).rejects.toThrowError(
        ScanComparisonError,
      );
      await expect(comparisonService.compareScans('', 'scan-2')).rejects.toMatchObject({
        code: SCAN_COMPARISON_ERROR_CODES.ERR_COMPARISON_INVALID_REQUEST,
      });
    });

    it('throws ERR_COMPARISON_NOT_FOUND when either scan run does not exist', async () => {
      const scan1 = createCompletedScan(siteAId);
      const nonExistentId = crypto.randomUUID();

      await expect(
        comparisonService.compareScans(scan1.id, nonExistentId),
      ).rejects.toMatchObject({
        code: SCAN_COMPARISON_ERROR_CODES.ERR_COMPARISON_NOT_FOUND,
      });

      await expect(
        comparisonService.compareScans(nonExistentId, scan1.id),
      ).rejects.toMatchObject({
        code: SCAN_COMPARISON_ERROR_CODES.ERR_COMPARISON_NOT_FOUND,
      });
    });

    it('strictly rejects cross-site comparisons with ERR_CROSS_SITE_MISMATCH', async () => {
      const scanA = createCompletedScan(siteAId);
      const scanB = createCompletedScan(siteBId);

      await expect(comparisonService.compareScans(scanA.id, scanB.id)).rejects.toMatchObject({
        code: SCAN_COMPARISON_ERROR_CODES.ERR_CROSS_SITE_MISMATCH,
      });
    });

    it('rejects comparisons involving non-terminal or failed scans with ERR_NON_TERMINAL_SCAN', async () => {
      const completedScan = createCompletedScan(siteAId);

      const pendingRun = scanRunRepo.create({
        siteId: siteAId,
        scanType: 'full',
        targetUrl: 'https://example.com',
      });

      await expect(
        comparisonService.compareScans(completedScan.id, pendingRun.id),
      ).rejects.toMatchObject({
        code: SCAN_COMPARISON_ERROR_CODES.ERR_NON_TERMINAL_SCAN,
      });

      const failedRun = scanRunRepo.create({
        siteId: siteAId,
        scanType: 'full',
        targetUrl: 'https://example.com',
      });
      scanRunRepo.updateStatus(failedRun.id, {
        status: 'failed',
        error: { code: 'ERR_CRAWL_CRASH', message: 'Crawl crashed' },
      });

      await expect(
        comparisonService.compareScans(completedScan.id, failedRun.id),
      ).rejects.toMatchObject({
        code: SCAN_COMPARISON_ERROR_CODES.ERR_NON_TERMINAL_SCAN,
      });
    });
  });

  describe('2. 8-Dimension Comparability Evaluation', () => {
    it('evaluates FULLY_COMPARABLE for matching scopes, engines, and modules', async () => {
      const scanA = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com', 'https://example.com/about'],
      });
      const scanB = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com', 'https://example.com/about', 'https://example.com/contact'],
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.comparabilityStatus).toBe('FULLY_COMPARABLE');
      expect(result.comparabilityDimensions.urlScope).toBe('FULL');
      expect(result.comparabilityDimensions.engineExecution).toBe('MATCH');
      expect(result.comparabilityDimensions.moduleConfiguration).toBe('MATCH');
      expect(result.comparabilityDimensions.ruleEvaluation).toBe('COMPLETE');
      expect(result.comparabilityWarnings).toHaveLength(0);
    });

    it('evaluates PARTIALLY_COMPARABLE and surfaces warnings when URL overlap is partial', async () => {
      const scanA = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com', 'https://example.com/p1', 'https://example.com/p2'],
      });
      const scanB = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com', 'https://example.com/p1'], // missing p2
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.comparabilityStatus).toBe('PARTIALLY_COMPARABLE');
      expect(result.comparabilityDimensions.urlScope).toBe('PARTIAL');
      expect(result.comparabilityWarnings.some(w => w.includes('partial URL overlap'))).toBe(true);
    });

    it('evaluates INSUFFICIENTLY_COMPARABLE when scans have disjoint URLs or missing telemetry', async () => {
      const scanA = createCompletedScan(siteAId, {
        crawledUrls: [], // historical scan missing telemetry
      });
      const scanB = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com'],
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.comparabilityStatus).toBe('INSUFFICIENTLY_COMPARABLE');
      expect(result.comparabilityDimensions.urlScope).toBe('DISJOINT');
      expect(result.comparabilityWarnings.some(w => w.includes('lack persisted crawled URL'))).toBe(true);
    });

    it('detects profile downgrade (deep -> quick) and tags scanProfile as DOWNGRADE', async () => {
      const scanA = createCompletedScan(siteAId, { scanType: 'full' }); // depth 3
      const scanB = createCompletedScan(siteAId, { scanType: 'quick' }); // depth 1

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.comparabilityStatus).toBe('PARTIALLY_COMPARABLE');
      expect(result.comparabilityDimensions.scanProfile).toBe('DOWNGRADE');
      expect(result.comparabilityWarnings.some(w => w.includes('profile depth'))).toBe(true);
    });
  });

  describe('3. Finding Matching, Severity Drift & Structural Evidence Diff', () => {
    it('classifies matching findings as PERSISTENT, detects ESCALATED severity drift and line shifts', async () => {
      const scanA = createCompletedScan(siteAId);
      const scanB = createCompletedScan(siteAId);

      const fp = '1'.repeat(64);
      findingRepo.create({
        scanRunId: scanA.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Desc',
        severity: 'low',
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        evidence: { selector: 'meta#csp', lineNumber: 10 },
        fingerprint: fp,
      });

      findingRepo.create({
        scanRunId: scanB.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Desc',
        severity: 'high', // ESCALATED from low -> high
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        evidence: { selector: 'meta#csp', lineNumber: 25 }, // shifted line number
        fingerprint: fp,
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.persistentCount).toBe(1);
      expect(result.scorecard.escalatedCount).toBe(1);
      expect(result.scorecard.deEscalatedCount).toBe(0);

      const item = result.findings.find(f => f.fingerprint === fp);
      expect(item).toBeDefined();
      expect(item?.classification).toBe('PERSISTENT');
      expect(item?.baselineSeverity).toBe('low');
      expect(item?.currentSeverity).toBe('high');
      expect(item?.severityDrift).toBe('ESCALATED');
      expect(item?.evidenceDiff?.isLineShifted).toBe(true);
      expect(item?.evidenceDiff?.baselineLineNumber).toBe(10);
      expect(item?.evidenceDiff?.currentLineNumber).toBe(25);
      expect(item?.evidenceDiff?.isSelectorShifted).toBe(false);
    });

    it('detects DE-ESCALATED severity drift and selector shifts', async () => {
      const scanA = createCompletedScan(siteAId);
      const scanB = createCompletedScan(siteAId);

      const fp = '2'.repeat(64);
      findingRepo.create({
        scanRunId: scanA.id,
        ruleId: 'A11Y_COLOR_CONTRAST',
        category: 'accessibility',
        title: 'Color Contrast',
        description: 'Desc',
        severity: 'critical',
        confidence: 'confirmed',
        targetUrl: 'https://example.com/about',
        evidence: { selector: 'button.btn-primary' },
        fingerprint: fp,
      });

      findingRepo.create({
        scanRunId: scanB.id,
        ruleId: 'A11Y_COLOR_CONTRAST',
        category: 'accessibility',
        title: 'Color Contrast',
        description: 'Desc',
        severity: 'medium', // DE-ESCALATED
        confidence: 'confirmed',
        targetUrl: 'https://example.com/about',
        evidence: { selector: 'button.btn-alt' }, // shifted selector
        fingerprint: fp,
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.persistentCount).toBe(1);
      expect(result.scorecard.deEscalatedCount).toBe(1);

      const item = result.findings.find(f => f.fingerprint === fp);
      expect(item?.severityDrift).toBe('DE-ESCALATED');
      expect(item?.evidenceDiff?.isSelectorShifted).toBe(true);
      expect(item?.evidenceDiff?.baselineSelector).toBe('button.btn-primary');
      expect(item?.evidenceDiff?.currentSelector).toBe('button.btn-alt');
    });
  });

  describe('4. Symmetrical Baseline Verification for New Findings', () => {
    it('classifies new finding as CONFIRMED_REGRESSION when Scan A actively audited the page and rule cleanly', async () => {
      const scanA = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com/checkout'],
      });
      const scanB = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com/checkout'],
      });

      const fp = '3'.repeat(64);
      findingRepo.create({
        scanRunId: scanB.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing on Checkout',
        description: 'Desc',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com/checkout',
        fingerprint: fp,
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.confirmedRegressionCount).toBe(1);
      expect(result.scorecard.baselineUncoveredCount).toBe(0);

      const item = result.findings.find(f => f.fingerprint === fp);
      expect(item?.classification).toBe('NEW');
      expect(item?.newSubtype).toBe('CONFIRMED_REGRESSION');
    });

    it('classifies new finding as BASELINE_UNCOVERED when Scan A never crawled the URL', async () => {
      const scanA = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com'], // did NOT crawl /blog
      });
      const scanB = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com', 'https://example.com/blog'],
      });

      const fp = '4'.repeat(64);
      findingRepo.create({
        scanRunId: scanB.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing on Blog',
        description: 'Desc',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com/blog',
        fingerprint: fp,
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.confirmedRegressionCount).toBe(0);
      expect(result.scorecard.baselineUncoveredCount).toBe(1);

      const item = result.findings.find(f => f.fingerprint === fp);
      expect(item?.classification).toBe('NEW');
      expect(item?.newSubtype).toBe('BASELINE_UNCOVERED');
    });

    it('classifies new finding as UNVERIFIABLE_BASELINE when Scan A predated URL telemetry', async () => {
      const scanA = createCompletedScan(siteAId, {
        crawledUrls: [], // historical scan lacking telemetry
      });
      const scanB = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com'],
      });

      const fp = '5'.repeat(64);
      findingRepo.create({
        scanRunId: scanB.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Desc',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        fingerprint: fp,
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.unverifiableBaselineCount).toBe(1);

      const item = result.findings.find(f => f.fingerprint === fp);
      expect(item?.classification).toBe('NEW');
      expect(item?.newSubtype).toBe('UNVERIFIABLE_BASELINE');
    });
  });

  describe('5. 5-Part Resolution Verification for Absent Findings', () => {
    it('classifies absent finding as RESOLVED when Scan B crawled URL and evaluated cleanly', async () => {
      const scanA = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com'],
      });
      const scanB = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com'],
      });

      const fp = '6'.repeat(64);
      findingRepo.create({
        scanRunId: scanA.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Desc',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        fingerprint: fp,
      });
      // Not inserted in scanB -> absent

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.resolvedCount).toBe(1);
      expect(result.scorecard.uncheckedCount).toBe(0);

      const item = result.findings.find(f => f.fingerprint === fp);
      expect(item?.classification).toBe('RESOLVED');
    });

    it('classifies absent finding as UNCHECKED (PAGE_NOT_CRAWLED) when Scan B did not crawl the URL', async () => {
      const scanA = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com/deep-page'],
      });
      const scanB = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com'], // did NOT crawl deep-page
      });

      const fp = '7'.repeat(64);
      findingRepo.create({
        scanRunId: scanA.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Desc',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com/deep-page',
        fingerprint: fp,
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.resolvedCount).toBe(0);
      expect(result.scorecard.uncheckedCount).toBe(1);

      const item = result.findings.find(f => f.fingerprint === fp);
      expect(item?.classification).toBe('UNCHECKED');
      expect(item?.uncheckedReason).toBe('PAGE_NOT_CRAWLED');
    });

    it('classifies absent finding as UNCHECKED (MODULE_DISABLED_IN_CONFIG) when category was disabled in Scan B', async () => {
      const scanA = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com'],
        auditModules: { securityHeaders: true },
      });
      const scanB = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com'],
        auditModules: { securityHeaders: false }, // disabled in B
      });

      const fp = '8'.repeat(64);
      findingRepo.create({
        scanRunId: scanA.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Desc',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        fingerprint: fp,
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.resolvedCount).toBe(0);
      expect(result.scorecard.uncheckedCount).toBe(1);

      const item = result.findings.find(f => f.fingerprint === fp);
      expect(item?.classification).toBe('UNCHECKED');
      expect(item?.uncheckedReason).toBe('MODULE_DISABLED_IN_CONFIG');
    });

    it('classifies absent browser-dependent finding as UNCHECKED (BROWSER_AUDIT_SKIPPED) when Scan B skipped browser audit for URL', async () => {
      const scanA = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com/interactive'],
        browserAuditedUrls: ['https://example.com/interactive'],
      });
      const scanB = createCompletedScan(siteAId, {
        crawledUrls: ['https://example.com/interactive'],
        browserAuditedUrls: ['https://example.com'], // /interactive was NOT browser audited in B
      });

      const fp = 'b'.repeat(64);
      findingRepo.create({
        scanRunId: scanA.id,
        ruleId: 'A11Y_COLOR_CONTRAST',
        category: 'accessibility',
        title: 'Contrast Failure',
        description: 'Desc',
        severity: 'medium',
        confidence: 'confirmed',
        targetUrl: 'https://example.com/interactive',
        evidence: { selector: 'button#cta' },
        fingerprint: fp,
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.resolvedCount).toBe(0);
      expect(result.scorecard.uncheckedCount).toBe(1);

      const item = result.findings.find(f => f.fingerprint === fp);
      expect(item?.classification).toBe('UNCHECKED');
      expect(item?.uncheckedReason).toBe('BROWSER_AUDIT_SKIPPED');
    });

    it('handles identical scan self-comparison where all findings are PERSISTENT and net delta is 0', async () => {
      const scan = createCompletedScan(siteAId);
      const fp = 'c'.repeat(64);
      findingRepo.create({
        scanRunId: scan.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Desc',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        fingerprint: fp,
      });

      const result = await comparisonService.compareScans(scan.id, scan.id);
      expect(result.scorecard.totalBaselineFindings).toBe(1);
      expect(result.scorecard.totalCurrentFindings).toBe(1);
      expect(result.scorecard.netDelta).toBe(0);
      expect(result.scorecard.persistentCount).toBe(1);
      expect(result.scorecard.resolvedCount).toBe(0);
      expect(result.scorecard.confirmedRegressionCount).toBe(0);
      expect(result.scorecard.escalatedCount).toBe(0);
      expect(result.scorecard.deEscalatedCount).toBe(0);
    });
  });

  describe('6. Tier 3 Aggregate Group Semantics', () => {
    it('correctly classifies complete group eradication as RESOLVED_GROUP', async () => {
      const scanA = createCompletedScan(siteAId, { crawledUrls: ['https://example.com'] });
      const scanB = createCompletedScan(siteAId, { crawledUrls: ['https://example.com'] });

      // Create 2 aggregate image alt missing findings in Scan A
      findingRepo.create({
        scanRunId: scanA.id,
        ruleId: 'SEO_IMG_ALT_MISSING',
        category: 'seo',
        title: 'Image Alt Missing 1',
        description: 'Desc',
        severity: 'low',
        confidence: 'firm',
        targetUrl: 'https://example.com',
        evidence: { selector: 'img#hero' },
      });
      findingRepo.create({
        scanRunId: scanA.id,
        ruleId: 'SEO_IMG_ALT_MISSING',
        category: 'seo',
        title: 'Image Alt Missing 2',
        description: 'Desc',
        severity: 'low',
        confidence: 'firm',
        targetUrl: 'https://example.com',
        evidence: { selector: 'img#footer' },
      });
      // Scan B has 0 occurrences on https://example.com

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.resolvedCount).toBe(2);
      expect(result.scorecard.persistentCount).toBe(0);

      const resolvedItems = result.findings.filter(f => f.ruleId === 'SEO_IMG_ALT_MISSING');
      expect(resolvedItems).toHaveLength(2);
      for (const item of resolvedItems) {
        expect(item.classification).toBe('RESOLVED');
        expect(item.identityTier).toBe('tier3_aggregate');
        expect(item.matchConfidence).toBe(0.5);
      }
    });

    it('handles count reduction (AGGREGATE_COUNT_REDUCED) by pairing remaining as persistent and excess as resolved', async () => {
      const scanA = createCompletedScan(siteAId, { crawledUrls: ['https://example.com'] });
      const scanB = createCompletedScan(siteAId, { crawledUrls: ['https://example.com'] });

      // Scan A has 3 items
      for (let i = 1; i <= 3; i++) {
        findingRepo.create({
          scanRunId: scanA.id,
          ruleId: 'CONTENT_EMPTY_LINK',
          category: 'content',
          title: `Empty Link ${i}`,
          description: 'Desc',
          severity: 'low',
          confidence: 'firm',
          targetUrl: 'https://example.com',
        });
      }

      // Scan B has 1 item
      findingRepo.create({
        scanRunId: scanB.id,
        ruleId: 'CONTENT_EMPTY_LINK',
        category: 'content',
        title: 'Empty Link Remaining',
        description: 'Desc',
        severity: 'low',
        confidence: 'firm',
        targetUrl: 'https://example.com',
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(result.scorecard.persistentCount).toBe(1);
      expect(result.scorecard.resolvedCount).toBe(2);
    });
  });

  describe('7. User Triage Overlay & Immutability Verification', () => {
    it('overlays active triage state onto comparison findings without mutating raw findings table', async () => {
      const scanA = createCompletedScan(siteAId);
      const scanB = createCompletedScan(siteAId);

      const fp = '9'.repeat(64);
      const rawFindingA = findingRepo.create({
        scanRunId: scanA.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Original immutable description',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        fingerprint: fp,
      });

      findingRepo.create({
        scanRunId: scanB.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Original immutable description',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        fingerprint: fp,
      });

      // User triages this finding
      await triageService.updateTriage({
        siteId: siteAId,
        findingFingerprint: fp,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Risk accepted per architecture committee approval',
        notes: 'Ticket SEC-1049',
      });

      const result = await comparisonService.compareScans(scanA.id, scanB.id);
      const item = result.findings.find(f => f.fingerprint === fp);

      expect(item).toBeDefined();
      expect(item?.triageStatus).toBe('accepted_risk');
      expect(item?.triageRevision).toBe(1);
      expect(item?.triageReason).toBe('Risk accepted per architecture committee approval');
      expect(item?.triageNotes).toBe('Ticket SEC-1049');

      // Verify raw database finding row was NOT mutated
      const fetchedRaw = findingRepo.getById(rawFindingA.id);
      expect(fetchedRaw?.status).toBe('potential'); // Default status preserved untouched
    });
  });

  describe('8. LRU Cache & Invalidation Behavior', () => {
    it('caches comparison results and invalidates immediately when triage updates for that site', async () => {
      const scanA = createCompletedScan(siteAId);
      const scanB = createCompletedScan(siteAId);

      const fp = 'e'.repeat(64);
      findingRepo.create({
        scanRunId: scanA.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Desc',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        fingerprint: fp,
      });
      findingRepo.create({
        scanRunId: scanB.id,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'CSP Missing',
        description: 'Desc',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        fingerprint: fp,
      });

      // First run: cold cache
      const res1 = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(comparisonService.getCacheSize()).toBe(1);
      expect(res1.findings[0].triageStatus).toBeUndefined();

      // Second run: should return cached object
      const res2 = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(res2).toBe(res1); // exact same reference from cache

      // User updates triage -> site triage key changes
      await triageService.updateTriage({
        siteId: siteAId,
        findingFingerprint: fp,
        targetStatus: 'false_positive',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Verified dev artifact',
      });

      // Third run: cache must be invalidated and re-computed with new triage overlay
      const res3 = await comparisonService.compareScans(scanA.id, scanB.id);
      expect(res3).not.toBe(res1);
      expect(res3.findings[0].triageStatus).toBe('false_positive');
      expect(res3.findings[0].triageRevision).toBe(1);
    });

    it('enforces LRU eviction when cache capacity is exceeded', async () => {
      const scan1 = createCompletedScan(siteAId);
      const scan2 = createCompletedScan(siteAId);
      const scan3 = createCompletedScan(siteAId);
      const scan4 = createCompletedScan(siteAId);

      // Capacity is set to 3 in beforeEach
      await comparisonService.compareScans(scan1.id, scan2.id); // key 1
      await comparisonService.compareScans(scan2.id, scan3.id); // key 2
      await comparisonService.compareScans(scan3.id, scan4.id); // key 3
      expect(comparisonService.getCacheSize()).toBe(3);

      // Adding 4th item should evict key 1 (oldest)
      await comparisonService.compareScans(scan1.id, scan3.id);
      expect(comparisonService.getCacheSize()).toBe(3);
    });
  });
});
