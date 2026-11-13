/**
 * Contracts, models, and diagnostic structures for the Advanced Technical SEO Engine.
 * Covers XML Sitemaps, robots.txt, Schema.org Structured Data, and Redirect Mapping.
 */

import type { AnalyzerFinding } from '../analyzers/types.js';

// ============================================================================
// 1. Common SEO Architecture Models
// ============================================================================

export interface SeoEngineConfig {
  readonly maxSitemaps?: number; // Default: 20
  readonly maxSitemapUrls?: number; // Default: 50,000
  readonly maxIndexDepth?: number; // Default: 2
  readonly requestTimeoutMs?: number; // Default: 10,000
  readonly maxByteBudget?: number; // Default: 5,242,880 (5 MB per XML)
  readonly userAgent?: string;
  readonly allowedHosts?: readonly string[];
}

export interface SeoCoverageReport {
  readonly engine: 'sitemap' | 'robots' | 'structured-data' | 'redirects';
  readonly executed: boolean;
  readonly status: 'full' | 'partial' | 'skipped' | 'failed';
  readonly itemsEvaluated: number;
  readonly reason?: string;
}

// ============================================================================
// 2. XML Sitemap Engine Types
// ============================================================================

export interface SitemapUrlEntry {
  readonly loc: string;
  readonly lastmod?: string | null;
  readonly changefreq?: string | null;
  readonly priority?: number | null;
  readonly sourceSitemapUrl: string;
}

export interface SitemapIndexEntry {
  readonly loc: string;
  readonly lastmod?: string | null;
  readonly sourceSitemapUrl: string;
}

export interface SitemapDiscrepancy {
  readonly type: 'missing_from_sitemap' | 'uncrawled_sitemap_url' | 'canonical_mismatch';
  readonly url: string;
  readonly sitemapUrl?: string;
  readonly canonicalUrl?: string;
  readonly pageClassification?: 'content' | 'archive' | 'utility' | 'redirect' | 'noindex';
  readonly details: string;
}

export interface SitemapAnalysisResult {
  readonly discoveredSitemaps: readonly string[];
  readonly totalUrlsDiscovered: number;
  readonly urls: readonly SitemapUrlEntry[];
  readonly sitemapIndexes: readonly SitemapIndexEntry[];
  readonly discrepancies: readonly SitemapDiscrepancy[];
  readonly findings: readonly AnalyzerFinding[];
  readonly coverage: SeoCoverageReport;
}

// ============================================================================
// 3. robots.txt Engine Types
// ============================================================================

export interface RobotsRuleGroup {
  readonly userAgents: readonly string[];
  readonly allows: readonly string[];
  readonly disallows: readonly string[];
  readonly crawlDelay?: number;
}

export interface RobotsAnalysisResult {
  readonly exists: boolean;
  readonly robotsUrl: string;
  readonly sitemapDirectives: readonly string[];
  readonly groups: readonly RobotsRuleGroup[];
  readonly effectiveRulesForAuditor: {
    readonly matchedAgent: string;
    readonly allows: readonly string[];
    readonly disallows: readonly string[];
  };
  readonly findings: readonly AnalyzerFinding[];
  readonly coverage: SeoCoverageReport;
}

// ============================================================================
// 4. Structured Data / Schema.org Engine Types
// ============================================================================

export type SchemaValidationSeverity = 'error' | 'warning' | 'info';

export interface SchemaValidationIssue {
  readonly ruleId: string;
  readonly message: string;
  readonly severity: SchemaValidationSeverity;
  readonly path?: string;
  readonly entityType?: string;
}

export interface ExtractedSchemaEntity {
  readonly type: string;
  readonly id?: string | null;
  readonly context?: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly issues: readonly SchemaValidationIssue[];
}

export interface PageStructuredDataResult {
  readonly targetUrl: string;
  readonly scriptBlocksCount: number;
  readonly scriptsFound?: number;
  readonly syntaxErrorsCount: number;
  readonly syntaxErrors?: readonly string[];
  readonly entities: readonly ExtractedSchemaEntity[];
  readonly entitiesParsed?: number;
  readonly findings: readonly AnalyzerFinding[];
}

export interface StructuredDataAnalysisResult {
  readonly pagesWithStructuredData: number;
  readonly totalEntitiesFound: number;
  readonly entityCountsByType: Readonly<Record<string, number>>;
  readonly entityTypeDistribution?: Readonly<Record<string, number>>;
  readonly totalScriptsFound?: number;
  readonly totalSyntaxErrors?: number;
  readonly totalPagesAudited?: number;
  readonly findings: readonly AnalyzerFinding[];
  readonly coverage: SeoCoverageReport;
}

// ============================================================================
// 5. Redirect Mapping & Diagnostics Types
// ============================================================================

export interface RedirectHopRecord {
  readonly fromUrl: string;
  readonly toUrl: string;
  readonly statusCode: number;
  readonly location: string;
}

export interface RedirectTraceResult {
  readonly initialUrl: string;
  readonly finalUrl: string;
  readonly hopCount: number;
  readonly hops: readonly RedirectHopRecord[];
  readonly isChain: boolean;
  readonly isLoop: boolean;
  readonly isTemporary: boolean;
  readonly isDowngrade: boolean;
  readonly isTrailingSlashNormalization: boolean;
  readonly isWwwNormalization: boolean;
  readonly isBrokenDestination: boolean;
  readonly finalStatusCode: number | null;
}

export interface RedirectAnalysisResult {
  readonly totalTraces: number;
  readonly redirectChainsCount: number;
  readonly chainsDetected?: number;
  readonly redirectLoopsCount: number;
  readonly loopsDetected?: number;
  readonly temporaryRedirectsCount: number;
  readonly traces: readonly RedirectTraceResult[];
  readonly internalLinksToRedirectsCount: number;
  readonly findings: readonly AnalyzerFinding[];
  readonly coverage: SeoCoverageReport;
}

// ============================================================================
// 6. Unified Advanced Technical SEO Result
// ============================================================================

export interface AdvancedSeoResult {
  readonly sitemap: SitemapAnalysisResult;
  readonly sitemaps?: SitemapAnalysisResult;
  readonly robots: RobotsAnalysisResult;
  readonly structuredData: StructuredDataAnalysisResult;
  readonly redirects: RedirectAnalysisResult;
  readonly allFindings: readonly AnalyzerFinding[];
}
