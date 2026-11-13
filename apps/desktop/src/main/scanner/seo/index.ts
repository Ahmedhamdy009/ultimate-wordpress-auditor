/**
 * Advanced Technical SEO Subsystem.
 * Bundles XML Sitemap Analysis, robots.txt Analysis, Structured Data / JSON-LD Validation,
 * and Redirect Mapping & Diagnostics.
 */

import type { SafeHttpClient } from '../client/http-client.js';
import type { CrawlResult } from '../crawler/types.js';
import type { AnalyzerFinding } from '../analyzers/types.js';
import { RobotsEngine } from './robots-engine.js';
import { SitemapEngine } from './sitemap-engine.js';
import { StructuredDataEngine } from './structured-data-engine.js';
import { RedirectEngine } from './redirect-engine.js';
import type {
  AdvancedSeoResult,
  RobotsAnalysisResult,
  SitemapAnalysisResult,
  StructuredDataAnalysisResult,
  RedirectAnalysisResult,
} from './types.js';

export * from './types.js';
export * from './robots-engine.js';
export * from './sitemap-engine.js';
export * from './structured-data-engine.js';
export * from './redirect-engine.js';

export class AdvancedSeoEngine {
  readonly robotsEngine = new RobotsEngine();
  readonly sitemapEngine = new SitemapEngine();
  readonly structuredDataEngine = new StructuredDataEngine();
  readonly redirectEngine = new RedirectEngine();
  readonly runAll = this.runAudit.bind(this);

  /**
   * Executes the complete Advanced Technical SEO analysis across all four engines.
   */
  async runAudit(args: {
    crawlResult: CrawlResult;
    authorizedOrigin: string;
    entryUrl: string;
    httpClient?: SafeHttpClient;
    signal?: AbortSignal;
    isCrawlPartial?: boolean;
    botUserAgent?: string;
  }): Promise<AdvancedSeoResult> {
    const {
      crawlResult,
      authorizedOrigin,
      entryUrl,
      httpClient,
      signal,
      isCrawlPartial = false,
      botUserAgent,
    } = args;

    const crawledUrls = crawlResult.pages.map(p => p.requestedUrl);

    // 1. robots.txt Analysis
    const robots: RobotsAnalysisResult = await this.robotsEngine.analyze({
      entryUrl,
      authorizedOrigin,
      httpClient,
      signal,
      botUserAgent,
      crawledUrls,
    });

    // 2. XML Sitemap Analysis
    const sitemap: SitemapAnalysisResult = await this.sitemapEngine.analyze({
      authorizedOrigin,
      entryUrl,
      httpClient,
      signal,
      robotsSitemaps: robots.sitemapDirectives,
      crawledPages: crawlResult.pages,
      isCrawlPartial,
    });

    // 3. Structured Data / Schema.org Analysis (per crawled page)
    const pageSchemaResults = crawlResult.pages.map(p => {
      const jsonLdScripts = p.parsedDocument?.jsonLdScripts ?? [];
      return this.structuredDataEngine.analyzePage(jsonLdScripts, p.requestedUrl);
    });
    const structuredData: StructuredDataAnalysisResult =
      this.structuredDataEngine.summarizeSite(pageSchemaResults);

    // 4. Redirect Mapping & Diagnostics
    const redirects: RedirectAnalysisResult = this.redirectEngine.analyzeSite(crawlResult);

    // 5. Aggregate all findings
    const allFindings: AnalyzerFinding[] = [
      ...robots.findings,
      ...sitemap.findings,
      ...structuredData.findings,
      ...redirects.findings,
    ];

    return {
      robots,
      sitemap,
      sitemaps: sitemap,
      structuredData,
      redirects,
      allFindings: Object.freeze(allFindings),
    };
  }
}
