/**
 * Main Analyzer Engine & Orchestrator.
 * Coordinates execution of page-level and site-level analyzers,
 * applies resource safety limits, truncates verbose evidence,
 * deduplicates findings, guarantees fair analyzer opportunity via round-robin,
 * and aggregates comprehensive audit stats with explicit truncation counters.
 */

import type { CrawlResult } from '../crawler/types.js';
import type {
  AnalyzerContext,
  AnalyzerEngineOptions,
  AnalyzerFinding,
  PageAnalyzer,
  SiteAnalyzer,
} from './types.js';
import { WordPressAnalyzer } from './wordpress-analyzer.js';
import { SecurityHeadersAnalyzer } from './security-headers-analyzer.js';
import { SeoPerformanceAnalyzer } from './seo-performance-analyzer.js';
import { QualityContentAnalyzer } from './quality-content-analyzer.js';
import { CrossPageAnalyzer } from './cross-page-analyzer.js';
import { StructuredDataAnalyzer } from './structured-data-analyzer.js';
import { AdvancedSeoSiteAnalyzer } from './advanced-seo-analyzer.js';

export interface AnalyzerEngineStats {
  readonly totalFindings: number;
  readonly bySeverity: Record<string, number>;
  readonly byCategory: Record<string, number>;
  readonly byConfidence: Record<string, number>;
  readonly byRule: Record<string, number>;
  readonly pagesAnalyzed: number;
  readonly durationMs: number;
  readonly findingsTruncatedCount: number;
  readonly evidenceTruncatedCount: number;
  readonly duplicatesFilteredCount: number;
}

export interface AnalyzerEngineResult {
  readonly findings: readonly AnalyzerFinding[];
  readonly stats: AnalyzerEngineStats;
}

export const SITE_LEVEL_RULE_IDS = new Set<string>([
  'WP_DETECTED',
  'WP_REST_API_ADVERTISED',
  'WP_XMLRPC_PINGBACK_ADVERTISED',
  'WP_VERSION_DISCLOSED',
  'SEC_HEADER_CSP_MISSING',
  'SEC_HEADER_HSTS_MISSING',
  'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE',
  'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED',
  'SEC_HEADER_PERMISSIONS_POLICY_MISSING',
  'SEC_HEADER_X_CONTENT_TYPE_OPTIONS_MISSING',
  // Advanced Technical SEO - Sitemaps
  'SEO_SITEMAP_MISSING',
  'SEO_SITEMAP_MALFORMED',
  'SEO_SITEMAP_HTTP_ERROR',
  'SEO_SITEMAP_UNREACHABLE',
  'SEO_SITEMAP_CROSS_ORIGIN_URL',
  'SEO_SITEMAP_DUPLICATE_URL',
  'SEO_SITEMAP_INVALID_DATE',
  'SEO_SITEMAP_PAGE_NOT_IN_SITEMAP',
  'SEO_SITEMAP_URL_NOT_CRAWLED',
  // Advanced Technical SEO - Robots.txt
  'SEO_ROBOTS_MISSING',
  'SEO_ROBOTS_DISALLOW_ALL',
  'SEO_ROBOTS_CONFLICTING_RULES',
  'SEO_ROBOTS_MALFORMED_SYNTAX',
  'SEO_ROBOTS_IMPORTANT_PAGE_BLOCKED',
  // Advanced Technical SEO - Redirects
  'SEO_REDIRECT_CHAIN',
  'SEO_REDIRECT_LOOP',
  'SEO_REDIRECT_EXCESSIVE_HOPS',
  'SEO_REDIRECT_TEMPORARY_FOR_PERMANENT',
  'SEO_REDIRECT_TRAILING_SLASH',
  'SEO_REDIRECT_HTTP_TO_HTTPS',
  'SEO_REDIRECT_BROKEN_DESTINATION',
  'SEO_REDIRECT_INTERNAL_LINK_TO_REDIRECT',
]);

export class AnalyzerEngine {
  private readonly pageAnalyzers: PageAnalyzer[];
  private readonly siteAnalyzers: SiteAnalyzer[];
  private readonly options: Required<AnalyzerEngineOptions>;

  constructor(
    options: AnalyzerEngineOptions = {},
    customPageAnalyzers?: PageAnalyzer[],
    customSiteAnalyzers?: SiteAnalyzer[],
  ) {
    this.options = {
      maxFindingsPerPage: options.maxFindingsPerPage ?? 50,
      maxEvidenceLength: options.maxEvidenceLength ?? 500,
      maxTotalFindings: options.maxTotalFindings ?? 1000,
    };

    this.pageAnalyzers = customPageAnalyzers ?? [
      new WordPressAnalyzer(),
      new SecurityHeadersAnalyzer(),
      new SeoPerformanceAnalyzer(),
      new QualityContentAnalyzer(),
      new StructuredDataAnalyzer(),
    ];

    this.siteAnalyzers = customSiteAnalyzers ?? [
      new CrossPageAnalyzer(),
      new AdvancedSeoSiteAnalyzer(),
    ];
  }

  /**
   * Run full analysis over a CrawlResult.
   */
  async runAnalysis(
    crawlResult: CrawlResult,
    context?: Partial<AnalyzerContext>,
  ): Promise<AnalyzerEngineResult> {
    const startTime = Date.now();

    const fullContext: AnalyzerContext = {
      authorizedOrigin: context?.authorizedOrigin ?? crawlResult.summary.authorizedOrigin,
      entryUrl: context?.entryUrl ?? crawlResult.summary.entryUrl,
      scanRunId: context?.scanRunId,
      httpClient: context?.httpClient,
      signal: context?.signal,
    };

    const aggregatedFindings: AnalyzerFinding[] = [];
    const seenFindingKeys = new Set<string>();
    const siteLevelFindingsMap = new Map<string, AnalyzerFinding>();

    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byConfidence: Record<string, number> = {};
    const byRule: Record<string, number> = {};

    let pagesAnalyzed = 0;
    let findingsTruncatedCount = 0;
    let evidenceTruncatedCount = 0;
    let duplicatesFilteredCount = 0;

    // Helper to safely add a finding
    const addFinding = (finding: AnalyzerFinding): 'ACCEPTED' | 'DUPLICATE' | 'LIMIT_REACHED' => {
      if (aggregatedFindings.length >= this.options.maxTotalFindings) {
        findingsTruncatedCount++;
        return 'LIMIT_REACHED';
      }

      const isSiteLevel = SITE_LEVEL_RULE_IDS.has(finding.ruleId);
      const siteKey = `${finding.ruleId}::${finding.title}`;

      if (isSiteLevel && siteLevelFindingsMap.has(siteKey)) {
        duplicatesFilteredCount++;
        const existing = siteLevelFindingsMap.get(siteKey)!;
        if (existing.evidence && typeof existing.evidence === 'object') {
          const ev = existing.evidence as Record<string, unknown>;
          ev.occurrenceCount = ((ev.occurrenceCount as number) || 1) + 1;
          const affected = (ev.affectedUrls as string[]) || [existing.targetUrl];
          if (!affected.includes(finding.targetUrl) && affected.length < 50) {
            affected.push(finding.targetUrl);
          }
          ev.affectedUrls = affected;
        }
        return 'DUPLICATE';
      }

      // Generate deduplication key
      const key = `${finding.ruleId}::${finding.targetUrl}::${finding.title}`;
      if (seenFindingKeys.has(key)) {
        duplicatesFilteredCount++;
        return 'DUPLICATE';
      }
      seenFindingKeys.add(key);

      // Sanitize and bound evidence
      const { bounded, wasTruncated } = this.boundEvidence(finding.evidence);
      if (wasTruncated) {
        evidenceTruncatedCount++;
      }

      let boundedEvidence = bounded;
      if (isSiteLevel) {
        if (boundedEvidence && typeof boundedEvidence === 'object') {
          boundedEvidence = {
            ...(boundedEvidence as Record<string, unknown>),
            occurrenceCount: 1,
            affectedUrls: [finding.targetUrl],
          };
        } else {
          boundedEvidence = {
            raw: boundedEvidence,
            occurrenceCount: 1,
            affectedUrls: [finding.targetUrl],
          };
        }
      }

      const sanitizedFinding: AnalyzerFinding = {
        ...finding,
        evidence: boundedEvidence,
      };

      aggregatedFindings.push(sanitizedFinding);
      if (isSiteLevel) {
        siteLevelFindingsMap.set(siteKey, sanitizedFinding);
      }

      // Update statistics ONLY for accepted, non-duplicate findings
      bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
      byCategory[finding.category] = (byCategory[finding.category] || 0) + 1;
      byConfidence[finding.confidence] = (byConfidence[finding.confidence] || 0) + 1;
      byRule[finding.ruleId] = (byRule[finding.ruleId] || 0) + 1;

      return 'ACCEPTED';
    };

    // 1. Run Page-Level Analyzers on Crawled Pages with Fair Round-Robin Interleaving
    for (const page of crawlResult.pages) {
      if (aggregatedFindings.length >= this.options.maxTotalFindings) {
        break;
      }

      // Skip pages that encountered unhandled fetch aborts before receiving headers
      if (!page.statusCode && !page.parsedDocument) {
        continue;
      }

      pagesAnalyzed++;

      // Collect candidate findings per analyzer for this page
      const candidateQueues: AnalyzerFinding[][] = [];
      for (const analyzer of this.pageAnalyzers) {
        try {
          const res = await Promise.resolve(analyzer.analyzePage(page, fullContext));
          candidateQueues.push([...res.findings]);
        } catch {
          candidateQueues.push([]);
        }
      }

      // Fair Round-Robin: Pull 1 finding from each analyzer alternately up to maxFindingsPerPage
      let pageFindingCount = 0;
      let hasMore = true;

      while (hasMore && pageFindingCount < this.options.maxFindingsPerPage) {
        hasMore = false;
        for (const queue of candidateQueues) {
          if (queue.length > 0 && pageFindingCount < this.options.maxFindingsPerPage) {
            const candidate = queue.shift()!;
            const result = addFinding(candidate);
            if (result === 'ACCEPTED') {
              pageFindingCount++;
            }
            if (queue.length > 0) {
              hasMore = true;
            }
          }
        }
      }

      // Record any unconsumed findings dropped due to per-page cap
      for (const queue of candidateQueues) {
        if (queue.length > 0) {
          findingsTruncatedCount += queue.length;
        }
      }
    }

    // 2. Run Site-Level Analyzers
    for (const siteAnalyzer of this.siteAnalyzers) {
      if (aggregatedFindings.length >= this.options.maxTotalFindings) {
        break;
      }

      try {
        const res = await Promise.resolve(siteAnalyzer.analyzeSite(crawlResult, fullContext));
        for (const f of res.findings) {
          const result = addFinding(f);
          if (result === 'LIMIT_REACHED') {
            break;
          }
        }
      } catch {
        // Individual site analyzer failure does not crash whole engine
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      findings: aggregatedFindings,
      stats: {
        totalFindings: aggregatedFindings.length,
        bySeverity,
        byCategory,
        byConfidence,
        byRule,
        pagesAnalyzed,
        durationMs,
        findingsTruncatedCount,
        evidenceTruncatedCount,
        duplicatesFilteredCount,
      },
    };
  }

  /**
   * Bounds evidence text, depth, and fields to prevent memory bloat and circular references.
   */
  private boundEvidence(evidence: Record<string, unknown> | string | null | undefined): {
    bounded: Record<string, unknown> | string | null | undefined;
    wasTruncated: boolean;
  } {
    if (evidence === null || evidence === undefined) {
      return { bounded: evidence, wasTruncated: false };
    }

    let wasTruncated = false;
    const seenObjects = new WeakSet<object>();

    if (typeof evidence === 'string') {
      if (evidence.length > this.options.maxEvidenceLength) {
        return {
          bounded: evidence.slice(0, this.options.maxEvidenceLength) + '... [Truncated]',
          wasTruncated: true,
        };
      }
      return { bounded: evidence, wasTruncated: false };
    }

    const boundValue = (val: unknown, depth: number): unknown => {
      if (val === null || val === undefined) return val;
      if (depth > 5) {
        wasTruncated = true;
        return '[Truncated: Max Depth]';
      }
      if (typeof val === 'string') {
        if (val.length > this.options.maxEvidenceLength) {
          wasTruncated = true;
          return val.slice(0, this.options.maxEvidenceLength) + '... [Truncated]';
        }
        return val;
      }
      if (typeof val === 'number' || typeof val === 'boolean') return val;

      if (typeof val === 'object' && val !== null) {
        if (seenObjects.has(val)) {
          wasTruncated = true;
          return '[Circular Reference]';
        }
        seenObjects.add(val);

        if (Array.isArray(val)) {
          if (val.length > 50) {
            wasTruncated = true;
          }
          return val.slice(0, 50).map(item => boundValue(item, depth + 1));
        }

        const res: Record<string, unknown> = {};
        const entries = Object.entries(val as Record<string, unknown>);
        if (entries.length > 50) {
          wasTruncated = true;
        }
        for (const [k, v] of entries.slice(0, 50)) {
          res[k] = boundValue(v, depth + 1);
        }
        return res;
      }

      return String(val).slice(0, this.options.maxEvidenceLength);
    };

    const result: Record<string, unknown> = {};
    seenObjects.add(evidence);
    const entries = Object.entries(evidence);
    if (entries.length > 50) {
      wasTruncated = true;
    }
    for (const [k, v] of entries.slice(0, 50)) {
      result[k] = boundValue(v, 1);
    }

    return { bounded: result, wasTruncated };
  }
}
