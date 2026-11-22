/**
 * Scan Comparison & Differential Analysis Engine.
 * Evaluates multi-dimensional comparability, performs symmetric 5-part verification,
 * overlays OCC triage state without mutating raw findings, and maintains an in-memory LRU cache.
 */

import {
  type ScanRunDTO,
  type ProjectedFindingDTO,
  type ScanComparisonDTO,
  type ComparisonFindingItemDTO,
  type ComparisonScorecardDTO,
  type ScanComparabilityStatus,
  type ScanComparabilityDimensionsResult,
  type SeverityDriftDirection,
  type NewFindingSubtype,
  type FindingSeverity,
  type FindingTriageDTO,
  type IdentityTier,
  type ResolutionVerificationContext,
  type SymmetricBaselineContext,
  evaluateResolutionPredicate,
  evaluateSymmetricBaseline,
  evaluateTier3GroupComparison,
  computeFindingFingerprint,
  TIER3_AGGREGATE_RULE_IDS,
  SITE_LEVEL_RULE_IDS,
  PAGE_SINGLETON_RULE_IDS,
} from '@auditor/shared';
import type { DatabaseConnection } from '../db/connection.js';
import type { ScanRunRepository } from '../db/repositories/scan-run.repository.js';
import type { FindingRepository } from '../db/repositories/finding.repository.js';
import type { FindingTriageService } from './finding-triage.service.js';

export const SCAN_COMPARISON_ERROR_CODES = {
  ERR_COMPARISON_NOT_FOUND: 'ERR_COMPARISON_NOT_FOUND',
  ERR_CROSS_SITE_MISMATCH: 'ERR_CROSS_SITE_MISMATCH',
  ERR_NON_TERMINAL_SCAN: 'ERR_NON_TERMINAL_SCAN',
  ERR_COMPARISON_INVALID_REQUEST: 'ERR_COMPARISON_INVALID_REQUEST',
} as const;

export class ScanComparisonError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ScanComparisonError';
    this.code = code;
    this.details = details;
  }
}

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  informational: 1,
};

const PROFILE_DEPTH_HIERARCHY: Record<string, number> = {
  quick: 1,
  security: 2,
  performance: 2,
  seo: 2,
  accessibility: 2,
  wordpress: 2,
  deep: 3,
  full: 3,
};

function calculateSeverityDrift(
  baselineSev: FindingSeverity,
  currentSev: FindingSeverity,
): SeverityDriftDirection {
  const wA = SEVERITY_WEIGHTS[baselineSev.toLowerCase()] ?? 1;
  const wB = SEVERITY_WEIGHTS[currentSev.toLowerCase()] ?? 1;
  if (wB > wA) return 'ESCALATED';
  if (wB < wA) return 'DE-ESCALATED';
  return 'UNCHANGED';
}

function isBrowserDependentRule(ruleId: string, category: string): boolean {
  const cat = category.toLowerCase();
  if (
    cat.includes('accessibility') ||
    cat.includes('responsivelayout') ||
    cat.includes('layoutstability') ||
    cat.includes('runtimeerrors')
  ) {
    return true;
  }
  if (
    ruleId.startsWith('A11Y_') ||
    ruleId.startsWith('VISUAL_') ||
    ruleId.startsWith('LAYOUT_') ||
    ruleId.startsWith('RUNTIME_') ||
    ruleId.startsWith('CLS_')
  ) {
    return true;
  }
  return false;
}

function determineIdentityTier(ruleId: string, selector: string | null): IdentityTier {
  if (SITE_LEVEL_RULE_IDS.has(ruleId) || PAGE_SINGLETON_RULE_IDS.has(ruleId)) {
    return 'tier1_semantic';
  }
  if (TIER3_AGGREGATE_RULE_IDS.has(ruleId) || !selector) {
    return 'tier3_aggregate';
  }
  if (
    /#([a-zA-Z0-9_-]+)/.test(selector) ||
    /\[data-(?:testid|qa|cy)=/.test(selector) ||
    /\[name=/.test(selector)
  ) {
    return 'tier1_semantic';
  }
  return 'tier2_positional';
}

interface CacheEntry {
  comparison: ScanComparisonDTO;
  triageKey: string;
  timestamp: number;
}

export class ScanComparisonService {
  private readonly connection: DatabaseConnection;
  private readonly scanRunRepo: ScanRunRepository;
  private readonly findingRepo: FindingRepository;
  private readonly triageService: FindingTriageService;
  private readonly cacheCapacity: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    connection: DatabaseConnection,
    scanRunRepo: ScanRunRepository,
    findingRepo: FindingRepository,
    triageService: FindingTriageService,
    options?: { cacheCapacity?: number },
  ) {
    this.connection = connection;
    this.scanRunRepo = scanRunRepo;
    this.findingRepo = findingRepo;
    this.triageService = triageService;
    this.cacheCapacity = options?.cacheCapacity ?? 50;
  }

  /**
   * Compares two scans belonging to the same site and returns a complete differential analysis.
   * Results are deterministically derived from immutable scan evidence, cached in an in-memory LRU cache,
   * and invalidated automatically when user triage decisions update.
   */
  public async compareScans(
    baselineScanId: string,
    currentScanId: string,
  ): Promise<ScanComparisonDTO> {
    if (!baselineScanId || !currentScanId) {
      throw new ScanComparisonError(
        SCAN_COMPARISON_ERROR_CODES.ERR_COMPARISON_INVALID_REQUEST,
        'Both baselineScanId and currentScanId are required',
      );
    }

    const scanA = this.scanRunRepo.getById(baselineScanId);
    if (!scanA) {
      throw new ScanComparisonError(
        SCAN_COMPARISON_ERROR_CODES.ERR_COMPARISON_NOT_FOUND,
        `Baseline scan run '${baselineScanId}' not found`,
        { baselineScanId },
      );
    }

    const scanB = this.scanRunRepo.getById(currentScanId);
    if (!scanB) {
      throw new ScanComparisonError(
        SCAN_COMPARISON_ERROR_CODES.ERR_COMPARISON_NOT_FOUND,
        `Current scan run '${currentScanId}' not found`,
        { currentScanId },
      );
    }

    if (scanA.siteId !== scanB.siteId) {
      throw new ScanComparisonError(
        SCAN_COMPARISON_ERROR_CODES.ERR_CROSS_SITE_MISMATCH,
        `Cross-site comparison is strictly prohibited (Baseline Site: ${scanA.siteId}, Current Site: ${scanB.siteId})`,
        { siteIdA: scanA.siteId, siteIdB: scanB.siteId },
      );
    }

    if (scanA.status !== 'completed' || scanB.status !== 'completed') {
      throw new ScanComparisonError(
        SCAN_COMPARISON_ERROR_CODES.ERR_NON_TERMINAL_SCAN,
        `Both scans must have status 'completed' to perform comparison (Baseline: ${scanA.status}, Current: ${scanB.status})`,
        { statusA: scanA.status, statusB: scanB.status },
      );
    }

    // Read current triage metadata key to handle cache invalidation
    const siteId = scanA.siteId;
    const triageKey = this.getSiteTriageKey(siteId);
    const cacheKey = `${siteId}::${baselineScanId}::${currentScanId}`;

    const cached = this.cache.get(cacheKey);
    if (cached && cached.triageKey === triageKey) {
      // Refresh LRU position
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached.comparison;
    }

    // Evaluate 8-dimension comparability
    const comparability = this.evaluateScanComparability(scanA, scanB);

    // Retrieve projected findings
    const findingsA = this.findingRepo.listProjectedByScanRunId(baselineScanId);
    const findingsB = this.findingRepo.listProjectedByScanRunId(currentScanId);

    // Retrieve triage records for overlay
    const triageRecords = this.triageService.listTriageBySite(siteId);
    const triageMap = new Map<string, FindingTriageDTO>();
    for (const tr of triageRecords) {
      triageMap.set(tr.findingFingerprint, tr);
    }

    // Perform symmetric matching & classification
    const comparisonFindings = this.performFindingComparison(
      scanA,
      scanB,
      findingsA,
      findingsB,
      triageMap,
    );

    // Calculate scorecard
    const scorecard = this.calculateScorecard(comparisonFindings, findingsA.length, findingsB.length);

    const result: ScanComparisonDTO = {
      baselineScanId,
      currentScanId,
      siteId,
      comparabilityStatus: comparability.status,
      comparabilityDimensions: comparability.dimensions,
      comparabilityWarnings: comparability.warnings,
      scorecard,
      findings: comparisonFindings,
      comparedAt: new Date().toISOString(),
    };

    // Store in LRU cache
    if (this.cache.size >= this.cacheCapacity) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(cacheKey, {
      comparison: result,
      triageKey,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Clears the in-memory comparison cache.
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Retrieves the current cache entry count.
   */
  public getCacheSize(): number {
    return this.cache.size;
  }

  private getSiteTriageKey(siteId: string): string {
    const rawDb = this.connection.getRawDb();
    const row = rawDb
      .prepare(
        `SELECT MAX(revision) as max_rev, MAX(updated_at) as max_updated, COUNT(*) as total_count 
         FROM finding_triage 
         WHERE site_id = ?`,
      )
      .get(siteId) as { max_rev: number | null; max_updated: string | null; total_count: number } | undefined;

    return `${row?.max_rev ?? 0}:${row?.max_updated ?? ''}:${row?.total_count ?? 0}`;
  }

  /**
   * Evaluates the 8 operational comparability dimensions between two scans.
   */
  public evaluateScanComparability(
    scanA: ScanRunDTO,
    scanB: ScanRunDTO,
  ): {
    status: ScanComparabilityStatus;
    dimensions: ScanComparabilityDimensionsResult;
    warnings: string[];
  } {
    const warnings: string[] = [];

    // 1. URL Scope
    const urlsA = scanA.summary?.crawledUrls ?? [];
    const urlsB = scanB.summary?.crawledUrls ?? [];
    let urlScope: 'FULL' | 'PARTIAL' | 'DISJOINT';

    if (urlsA.length === 0 || urlsB.length === 0) {
      urlScope = 'DISJOINT';
      warnings.push('One or both scans lack persisted crawled URL telemetry.');
    } else {
      const setB = new Set(urlsB.map(u => u.toLowerCase()));
      const intersectionCount = urlsA.filter(u => setB.has(u.toLowerCase())).length;
      if (intersectionCount === urlsA.length) {
        urlScope = 'FULL';
      } else if (intersectionCount > 0) {
        urlScope = 'PARTIAL';
        warnings.push(
          `Follow-up scan has partial URL overlap with baseline scan (${intersectionCount}/${urlsA.length} URLs covered).`,
        );
      } else {
        urlScope = 'DISJOINT';
        warnings.push('Scans have disjoint crawled URL sets.');
      }
    }

    // 2. Browser Scope
    const browserUrlsA = scanA.summary?.browserAuditedUrls ?? [];
    const browserUrlsB = scanB.summary?.browserAuditedUrls ?? [];
    let browserScope: 'FULL' | 'PARTIAL' | 'NONE';

    if (browserUrlsA.length === 0 && browserUrlsB.length === 0) {
      browserScope = 'NONE';
    } else if (browserUrlsA.length === 0 || browserUrlsB.length === 0) {
      browserScope = 'NONE';
      warnings.push('Browser auditing was executed in one scan but omitted in the other.');
    } else {
      const setBrowserB = new Set(browserUrlsB.map(u => u.toLowerCase()));
      const browserIntersection = browserUrlsA.filter(u => setBrowserB.has(u.toLowerCase())).length;
      if (browserIntersection === browserUrlsA.length) {
        browserScope = 'FULL';
      } else if (browserIntersection > 0) {
        browserScope = 'PARTIAL';
        warnings.push(
          `Partial browser audit overlap between scans (${browserIntersection}/${browserUrlsA.length} pages).`,
        );
      } else {
        browserScope = 'NONE';
        warnings.push('Scans have disjoint browser-audited page sets.');
      }
    }

    // 3. Engine Execution
    const enginesA = new Set(scanA.summary?.completedEngines ?? []);
    const enginesB = new Set(scanB.summary?.completedEngines ?? []);
    const engineExecution: 'MATCH' | 'MISMATCH' =
      enginesA.has('analyzers') &&
      enginesB.has('analyzers') &&
      (enginesA.has('browser') === enginesB.has('browser'))
        ? 'MATCH'
        : 'MISMATCH';

    if (engineExecution === 'MISMATCH') {
      warnings.push('Mismatch in completed engine execution between scans.');
    }

    // 4. Module Configuration
    const modConfigA = (scanA.config?.auditModules ?? {}) as Record<string, boolean>;
    const modConfigB = (scanB.config?.auditModules ?? {}) as Record<string, boolean>;
    const activeKeysA = Object.keys(modConfigA).filter(k => modConfigA[k] !== false);

    let moduleConfiguration: 'MATCH' | 'SUBSET' | 'DISJOINT' = 'MATCH';
    if (activeKeysA.length > 0) {
      const missingInB = activeKeysA.filter(k => modConfigB[k] === false);
      if (missingInB.length === activeKeysA.length) {
        moduleConfiguration = 'DISJOINT';
        warnings.push('All audit modules active in baseline were disabled in follow-up scan.');
      } else if (missingInB.length > 0) {
        moduleConfiguration = 'SUBSET';
        warnings.push(
          `Some audit modules active in baseline were disabled in follow-up scan: ${missingInB.join(', ')}.`,
        );
      } else {
        moduleConfiguration = 'MATCH';
      }
    }

    // 5. Rule Availability
    const catalogA = scanA.summary?.ruleCatalog ?? [];
    const catalogB = scanB.summary?.ruleCatalog ?? [];
    let ruleAvailability: 'MATCH' | 'DRIFT' = 'MATCH';
    if (catalogA.length > 0 && catalogB.length > 0) {
      const setCatB = new Set(catalogB);
      const missingRules = catalogA.filter(r => !setCatB.has(r));
      if (missingRules.length > 0) {
        ruleAvailability = 'DRIFT';
        warnings.push(
          `${missingRules.length} rule(s) present in baseline catalog are unavailable in follow-up scan.`,
        );
      }
    }

    // 6. Rule Evaluation
    const failedPagesB =
      (scanB.summary?.pagesFailed ?? 0) +
      (scanB.summary?.crawlFailedPages ?? 0) +
      (scanB.summary?.browserFailedPages ?? 0);
    const ruleEvaluation: 'COMPLETE' | 'PARTIAL' = failedPagesB === 0 ? 'COMPLETE' : 'PARTIAL';
    if (ruleEvaluation === 'PARTIAL') {
      warnings.push(`Follow-up scan experienced ${failedPagesB} failed page audit(s).`);
    }

    // 7. Analyzer Version
    const verA = scanA.summary?.ruleCatalogMetadata?.registryVersion;
    const verB = scanB.summary?.ruleCatalogMetadata?.registryVersion;
    let analyzerVersion: 'MATCH' | 'DRIFT' = 'MATCH';
    if (verA && verB && verA !== verB) {
      analyzerVersion = 'DRIFT';
      warnings.push(`Analyzer registry version mismatch (Scan A: ${verA}, Scan B: ${verB}).`);
    }

    // 8. Scan Profile
    const depthA = PROFILE_DEPTH_HIERARCHY[scanA.scanType] ?? 2;
    const depthB = PROFILE_DEPTH_HIERARCHY[scanB.scanType] ?? 2;
    let scanProfile: 'MATCH' | 'DOWNGRADE' | 'UPGRADE' = 'MATCH';
    if (depthB < depthA) {
      scanProfile = 'DOWNGRADE';
      warnings.push(
        `Follow-up scan profile depth ('${scanB.scanType}') is lower than baseline ('${scanA.scanType}').`,
      );
    } else if (depthB > depthA) {
      scanProfile = 'UPGRADE';
    }

    // Overall Comparability Status
    let status: ScanComparabilityStatus;
    if (
      urlScope === 'DISJOINT' ||
      engineExecution === 'MISMATCH' ||
      urlsA.length === 0 ||
      urlsB.length === 0
    ) {
      status = 'INSUFFICIENTLY_COMPARABLE';
    } else if (
      urlScope === 'FULL' &&
      engineExecution === 'MATCH' &&
      moduleConfiguration === 'MATCH' &&
      ruleAvailability === 'MATCH' &&
      analyzerVersion === 'MATCH' &&
      scanProfile !== 'DOWNGRADE' &&
      ruleEvaluation === 'COMPLETE'
    ) {
      status = 'FULLY_COMPARABLE';
    } else {
      status = 'PARTIALLY_COMPARABLE';
    }

    return {
      status,
      dimensions: {
        urlScope,
        browserScope,
        engineExecution,
        moduleConfiguration,
        ruleAvailability,
        ruleEvaluation,
        analyzerVersion,
        scanProfile,
      },
      warnings,
    };
  }

  private performFindingComparison(
    scanA: ScanRunDTO,
    scanB: ScanRunDTO,
    findingsA: ProjectedFindingDTO[],
    findingsB: ProjectedFindingDTO[],
    triageMap: Map<string, FindingTriageDTO>,
  ): ComparisonFindingItemDTO[] {
    const results: ComparisonFindingItemDTO[] = [];

    // Separate Tier 3 findings from Tier 1 & Tier 2 findings
    const isTier3 = (f: ProjectedFindingDTO) =>
      TIER3_AGGREGATE_RULE_IDS.has(f.ruleId) || determineIdentityTier(f.ruleId, f.selector) === 'tier3_aggregate';

    const standardFindingsA = findingsA.filter(f => !isTier3(f));
    const standardFindingsB = findingsB.filter(f => !isTier3(f));

    const tier3FindingsA = findingsA.filter(f => isTier3(f));
    const tier3FindingsB = findingsB.filter(f => isTier3(f));

    // Group standard findings by fingerprint
    const mapA = new Map<string, ProjectedFindingDTO[]>();
    for (const f of standardFindingsA) {
      const fp = f.fingerprint ?? computeFindingFingerprint({
        ruleId: f.ruleId,
        category: f.category,
        targetUrl: f.targetUrl,
        evidence: f.selector ? { selector: f.selector } : null,
      });
      const list = mapA.get(fp) ?? [];
      list.push(f);
      mapA.set(fp, list);
    }

    const mapB = new Map<string, ProjectedFindingDTO[]>();
    for (const f of standardFindingsB) {
      const fp = f.fingerprint ?? computeFindingFingerprint({
        ruleId: f.ruleId,
        category: f.category,
        targetUrl: f.targetUrl,
        evidence: f.selector ? { selector: f.selector } : null,
      });
      const list = mapB.get(fp) ?? [];
      list.push(f);
      mapB.set(fp, list);
    }

    const processedFingerprints = new Set<string>();

    // 1. Process matching and baseline-only standard findings
    for (const [fp, itemsA] of mapA.entries()) {
      processedFingerprints.add(fp);
      const itemsB = mapB.get(fp) ?? [];

      const pairCount = Math.min(itemsA.length, itemsB.length);

      // Paired items -> PERSISTENT
      for (let i = 0; i < pairCount; i++) {
        const itemA = itemsA[i];
        const itemB = itemsB[i];
        const tier = determineIdentityTier(itemA.ruleId, itemA.selector);
        const matchConfidence = tier === 'tier1_semantic' ? 1.0 : 0.7;

        results.push(
          this.enrichTriage(
            {
              fingerprint: fp,
              ruleId: itemA.ruleId,
              category: itemA.category,
              targetUrl: itemA.targetUrl,
              classification: 'PERSISTENT',
              baselineFindingId: itemA.id,
              currentFindingId: itemB.id,
              baselineSeverity: itemA.severity,
              currentSeverity: itemB.severity,
              severityDrift: calculateSeverityDrift(itemA.severity, itemB.severity),
              evidenceDiff: {
                baselineSelector: itemA.selector,
                currentSelector: itemB.selector,
                isSelectorShifted: itemA.selector !== itemB.selector,
                baselineLineNumber: itemA.lineNumber,
                currentLineNumber: itemB.lineNumber,
                isLineShifted: itemA.lineNumber !== itemB.lineNumber,
              },
              identityTier: tier,
              matchConfidence,
            },
            triageMap,
          ),
        );
      }

      // Unmatched baseline items -> evaluateResolutionPredicate
      for (let i = pairCount; i < itemsA.length; i++) {
        const itemA = itemsA[i];
        const tier = determineIdentityTier(itemA.ruleId, itemA.selector);
        const isBrowser = isBrowserDependentRule(itemA.ruleId, itemA.category);

        const crawledUrlsB = scanB.summary?.crawledUrls;
        const browserAuditedUrlsB = scanB.summary?.browserAuditedUrls;
        const wasCrawled = crawledUrlsB?.some(u => u.toLowerCase() === itemA.targetUrl.toLowerCase());

        const resContext: ResolutionVerificationContext = {
          targetUrl: itemA.targetUrl,
          ruleId: itemA.ruleId,
          category: itemA.category,
          isBrowserDependent: isBrowser,
          scanB: {
            isTerminalSuccess: scanB.status === 'completed',
            crawledUrls: crawledUrlsB,
            browserAuditedUrls: browserAuditedUrlsB,
            completedEngines: scanB.summary?.completedEngines,
            activeModules: scanB.config?.auditModules as Record<string, boolean> | undefined,
            registryVersion: scanB.summary?.ruleCatalogMetadata?.registryVersion,
            ruleCatalog: scanB.summary?.ruleCatalog,
            omittedRuleIds: scanB.summary?.ruleCatalogMetadata?.omittedRuleIds,
            ruleOutcomeOnUrl: wasCrawled ? 'CLEAN' : undefined,
            profileDepth: scanB.scanType as
              | 'quick'
              | 'deep'
              | 'security'
              | 'performance'
              | 'seo'
              | 'full',
          },
          scanA: {
            profileDepth: scanA.scanType as
              | 'quick'
              | 'deep'
              | 'security'
              | 'performance'
              | 'seo'
              | 'full',
            registryVersion: scanA.summary?.ruleCatalogMetadata?.registryVersion,
          },
        };

        const resResult = evaluateResolutionPredicate(resContext);

        results.push(
          this.enrichTriage(
            {
              fingerprint: fp,
              ruleId: itemA.ruleId,
              category: itemA.category,
              targetUrl: itemA.targetUrl,
              classification: resResult.classification,
              uncheckedReason: resResult.uncheckedReason,
              diagnosticDetail: resResult.diagnosticDetail,
              baselineFindingId: itemA.id,
              baselineSeverity: itemA.severity,
              identityTier: tier,
              matchConfidence: tier === 'tier1_semantic' ? 1.0 : 0.7,
            },
            triageMap,
          ),
        );
      }
    }

    // 2. Process current-only standard findings -> evaluateSymmetricBaseline
    for (const [fp, itemsB] of mapB.entries()) {
      if (processedFingerprints.has(fp)) {
        // Handle any excess occurrences in B beyond itemsA.length
        const itemsA = mapA.get(fp) ?? [];
        if (itemsB.length > itemsA.length) {
          for (let i = itemsA.length; i < itemsB.length; i++) {
            const itemB = itemsB[i];
            results.push(this.classifyNewFinding(scanA, itemB, fp, triageMap));
          }
        }
        continue;
      }

      for (const itemB of itemsB) {
        results.push(this.classifyNewFinding(scanA, itemB, fp, triageMap));
      }
    }

    // 3. Process Tier 3 aggregate findings
    const tier3Results = this.processTier3Findings(scanA, scanB, tier3FindingsA, tier3FindingsB, triageMap);
    results.push(...tier3Results);

    return results;
  }

  private classifyNewFinding(
    scanA: ScanRunDTO,
    itemB: ProjectedFindingDTO,
    fp: string,
    triageMap: Map<string, FindingTriageDTO>,
  ): ComparisonFindingItemDTO {
    const tier = determineIdentityTier(itemB.ruleId, itemB.selector);
    const isBrowser = isBrowserDependentRule(itemB.ruleId, itemB.category);
    const hasTelemetry = Boolean(scanA.summary?.crawledUrls && scanA.summary.crawledUrls.length > 0);

    const crawledUrlsA = scanA.summary?.crawledUrls;
    const browserAuditedUrlsA = scanA.summary?.browserAuditedUrls;
    const wasCrawled = crawledUrlsA?.some(u => u.toLowerCase() === itemB.targetUrl.toLowerCase());

    const baselineContext: SymmetricBaselineContext = {
      targetUrl: itemB.targetUrl,
      ruleId: itemB.ruleId,
      category: itemB.category,
      isBrowserDependent: isBrowser,
      scanA: {
        hasTelemetry,
        isTerminalSuccess: scanA.status === 'completed',
        crawledUrls: crawledUrlsA,
        browserAuditedUrls: browserAuditedUrlsA,
        completedEngines: scanA.summary?.completedEngines,
        activeModules: scanA.config?.auditModules as Record<string, boolean> | undefined,
        registryVersion: scanA.summary?.ruleCatalogMetadata?.registryVersion,
        ruleCatalog: scanA.summary?.ruleCatalog,
        omittedRuleIds: scanA.summary?.ruleCatalogMetadata?.omittedRuleIds,
        ruleOutcomeOnUrl: hasTelemetry && wasCrawled ? 'CLEAN' : undefined,
      },
    };

    const symResult = evaluateSymmetricBaseline(baselineContext);

    return this.enrichTriage(
      {
        fingerprint: fp,
        ruleId: itemB.ruleId,
        category: itemB.category,
        targetUrl: itemB.targetUrl,
        classification: 'NEW',
        newSubtype: symResult.newSubtype,
        matchConfidence: symResult.confidence,
        diagnosticDetail: symResult.diagnosticDetail,
        currentFindingId: itemB.id,
        currentSeverity: itemB.severity,
        identityTier: tier,
      },
      triageMap,
    );
  }

  private processTier3Findings(
    scanA: ScanRunDTO,
    scanB: ScanRunDTO,
    findingsA: ProjectedFindingDTO[],
    findingsB: ProjectedFindingDTO[],
    triageMap: Map<string, FindingTriageDTO>,
  ): ComparisonFindingItemDTO[] {
    const results: ComparisonFindingItemDTO[] = [];

    // Group by `${normalizedUrl}::${ruleId}`
    const groupKeyOf = (f: ProjectedFindingDTO) => `${f.targetUrl.toLowerCase()}::${f.ruleId}`;

    const groupsA = new Map<string, ProjectedFindingDTO[]>();
    for (const f of findingsA) {
      const key = groupKeyOf(f);
      const list = groupsA.get(key) ?? [];
      list.push(f);
      groupsA.set(key, list);
    }

    const groupsB = new Map<string, ProjectedFindingDTO[]>();
    for (const f of findingsB) {
      const key = groupKeyOf(f);
      const list = groupsB.get(key) ?? [];
      list.push(f);
      groupsB.set(key, list);
    }

    const allKeys = new Set<string>([...groupsA.keys(), ...groupsB.keys()]);

    for (const key of allKeys) {
      const itemsA = groupsA.get(key) ?? [];
      const itemsB = groupsB.get(key) ?? [];
      const countA = itemsA.length;
      const countB = itemsB.length;

      const sample = itemsA[0] || itemsB[0];
      const targetUrl = sample.targetUrl;
      const ruleId = sample.ruleId;
      const category = sample.category;

      const scanBHasCoverage = Boolean(
        scanB.summary?.crawledUrls?.some(u => u.toLowerCase() === targetUrl.toLowerCase()),
      );
      const scanBClean = Boolean(scanB.status === 'completed' && scanBHasCoverage);
      const scanAClean = Boolean(
        scanA.status === 'completed' &&
          scanA.summary?.crawledUrls?.some(u => u.toLowerCase() === targetUrl.toLowerCase()),
      );

      const groupOutcome = evaluateTier3GroupComparison({
        countA,
        countB,
        scanAClean,
        scanBClean,
        scanBHasCoverage,
      });

      const fp =
        sample.fingerprint ??
        computeFindingFingerprint({
          ruleId,
          category,
          targetUrl,
        });

      if (groupOutcome.outcome === 'RESOLVED_GROUP') {
        for (const itemA of itemsA) {
          results.push(
            this.enrichTriage(
              {
                fingerprint: fp,
                ruleId,
                category,
                targetUrl,
                classification: 'RESOLVED',
                baselineFindingId: itemA.id,
                baselineSeverity: itemA.severity,
                identityTier: 'tier3_aggregate',
                matchConfidence: 0.5,
              },
              triageMap,
            ),
          );
        }
      } else if (groupOutcome.outcome === 'UNCHECKED_GROUP') {
        for (const itemA of itemsA) {
          results.push(
            this.enrichTriage(
              {
                fingerprint: fp,
                ruleId,
                category,
                targetUrl,
                classification: 'UNCHECKED',
                uncheckedReason: groupOutcome.uncheckedReason ?? 'PAGE_NOT_CRAWLED',
                baselineFindingId: itemA.id,
                baselineSeverity: itemA.severity,
                identityTier: 'tier3_aggregate',
                matchConfidence: 0.5,
              },
              triageMap,
            ),
          );
        }
      } else if (groupOutcome.outcome === 'CONFIRMED_REGRESSION_GROUP') {
        for (const itemB of itemsB) {
          results.push(
            this.enrichTriage(
              {
                fingerprint: fp,
                ruleId,
                category,
                targetUrl,
                classification: 'NEW',
                newSubtype: 'CONFIRMED_REGRESSION',
                currentFindingId: itemB.id,
                currentSeverity: itemB.severity,
                identityTier: 'tier3_aggregate',
                matchConfidence: 0.5,
              },
              triageMap,
            ),
          );
        }
      } else if (groupOutcome.outcome === 'PERSISTENT_GROUP') {
        const pairCount = Math.min(itemsA.length, itemsB.length);
        for (let i = 0; i < pairCount; i++) {
          const itemA = itemsA[i];
          const itemB = itemsB[i];
          results.push(
            this.enrichTriage(
              {
                fingerprint: fp,
                ruleId,
                category,
                targetUrl,
                classification: 'PERSISTENT',
                baselineFindingId: itemA.id,
                currentFindingId: itemB.id,
                baselineSeverity: itemA.severity,
                currentSeverity: itemB.severity,
                severityDrift: calculateSeverityDrift(itemA.severity, itemB.severity),
                identityTier: 'tier3_aggregate',
                matchConfidence: 0.5,
              },
              triageMap,
            ),
          );
        }
      } else if (groupOutcome.outcome === 'AGGREGATE_COUNT_REDUCED') {
        // Parity items are PERSISTENT
        for (let i = 0; i < countB; i++) {
          const itemA = itemsA[i];
          const itemB = itemsB[i];
          results.push(
            this.enrichTriage(
              {
                fingerprint: fp,
                ruleId,
                category,
                targetUrl,
                classification: 'PERSISTENT',
                baselineFindingId: itemA.id,
                currentFindingId: itemB.id,
                baselineSeverity: itemA.severity,
                currentSeverity: itemB.severity,
                severityDrift: calculateSeverityDrift(itemA.severity, itemB.severity),
                identityTier: 'tier3_aggregate',
                matchConfidence: 0.5,
              },
              triageMap,
            ),
          );
        }
        // Excess baseline items are tagged as RESOLVED
        for (let i = countB; i < countA; i++) {
          const itemA = itemsA[i];
          results.push(
            this.enrichTriage(
              {
                fingerprint: fp,
                ruleId,
                category,
                targetUrl,
                classification: 'RESOLVED',
                baselineFindingId: itemA.id,
                baselineSeverity: itemA.severity,
                identityTier: 'tier3_aggregate',
                matchConfidence: 0.5,
              },
              triageMap,
            ),
          );
        }
      } else if (groupOutcome.outcome === 'AGGREGATE_COUNT_INCREASED') {
        // Parity items are PERSISTENT
        for (let i = 0; i < countA; i++) {
          const itemA = itemsA[i];
          const itemB = itemsB[i];
          results.push(
            this.enrichTriage(
              {
                fingerprint: fp,
                ruleId,
                category,
                targetUrl,
                classification: 'PERSISTENT',
                baselineFindingId: itemA.id,
                currentFindingId: itemB.id,
                baselineSeverity: itemA.severity,
                currentSeverity: itemB.severity,
                severityDrift: calculateSeverityDrift(itemA.severity, itemB.severity),
                identityTier: 'tier3_aggregate',
                matchConfidence: 0.5,
              },
              triageMap,
            ),
          );
        }
        // Excess current items are NEW
        const newSubtype: NewFindingSubtype = scanAClean
          ? 'CONFIRMED_REGRESSION'
          : 'BASELINE_UNCOVERED';
        for (let i = countA; i < countB; i++) {
          const itemB = itemsB[i];
          results.push(
            this.enrichTriage(
              {
                fingerprint: fp,
                ruleId,
                category,
                targetUrl,
                classification: 'NEW',
                newSubtype,
                currentFindingId: itemB.id,
                currentSeverity: itemB.severity,
                identityTier: 'tier3_aggregate',
                matchConfidence: 0.5,
              },
              triageMap,
            ),
          );
        }
      }
    }

    return results;
  }

  private enrichTriage(
    item: ComparisonFindingItemDTO,
    triageMap: Map<string, FindingTriageDTO>,
  ): ComparisonFindingItemDTO {
    const triage = triageMap.get(item.fingerprint);
    if (!triage) {
      return item;
    }

    return {
      ...item,
      triageStatus: triage.status,
      triageRevision: triage.revision,
      triageReason: triage.reason,
      triageNotes: triage.notes,
      triageUpdatedAt: triage.updatedAt,
    };
  }

  private calculateScorecard(
    findings: readonly ComparisonFindingItemDTO[],
    totalBaselineFindings: number,
    totalCurrentFindings: number,
  ): ComparisonScorecardDTO {
    let resolvedCount = 0;
    let confirmedRegressionCount = 0;
    let persistentCount = 0;
    let uncheckedCount = 0;
    let baselineUncoveredCount = 0;
    let unverifiableBaselineCount = 0;
    let escalatedCount = 0;
    let deEscalatedCount = 0;

    for (const f of findings) {
      if (f.classification === 'RESOLVED') {
        resolvedCount++;
      } else if (f.classification === 'PERSISTENT') {
        persistentCount++;
        if (f.severityDrift === 'ESCALATED') {
          escalatedCount++;
        } else if (f.severityDrift === 'DE-ESCALATED') {
          deEscalatedCount++;
        }
      } else if (f.classification === 'UNCHECKED') {
        uncheckedCount++;
      } else if (f.classification === 'NEW') {
        if (f.newSubtype === 'CONFIRMED_REGRESSION') {
          confirmedRegressionCount++;
        } else if (f.newSubtype === 'BASELINE_UNCOVERED') {
          baselineUncoveredCount++;
        } else if (f.newSubtype === 'UNVERIFIABLE_BASELINE') {
          unverifiableBaselineCount++;
        }
      }
    }

    return {
      resolvedCount,
      confirmedRegressionCount,
      persistentCount,
      uncheckedCount,
      baselineUncoveredCount,
      unverifiableBaselineCount,
      escalatedCount,
      deEscalatedCount,
      totalBaselineFindings,
      totalCurrentFindings,
      netDelta: totalCurrentFindings - totalBaselineFindings,
    };
  }
}
