/**
 * Site-Level Advanced Technical SEO Analyzer.
 * Orchestrates XML Sitemap Analysis, robots.txt Evaluation, and Redirect Mapping
 * across the entire crawled site.
 */

import type { CrawlResult } from '../crawler/types.js';
import { RobotsEngine } from '../seo/robots-engine.js';
import { SitemapEngine } from '../seo/sitemap-engine.js';
import { RedirectEngine } from '../seo/redirect-engine.js';
import type {
  RobotsAnalysisResult,
  SitemapAnalysisResult,
  RedirectAnalysisResult,
} from '../seo/types.js';
import type {
  AnalyzerContext,
  AnalyzerFinding,
  SiteAnalysisResult,
  SiteAnalyzer,
} from './types.js';

export interface AdvancedSeoSiteData {
  readonly robots: RobotsAnalysisResult;
  readonly sitemap: SitemapAnalysisResult;
  readonly redirects: RedirectAnalysisResult;
}

export class AdvancedSeoSiteAnalyzer implements SiteAnalyzer<AdvancedSeoSiteData> {
  readonly id = 'advanced-seo-site-analyzer';
  readonly name = 'Advanced Technical SEO Site Analyzer';

  private readonly robotsEngine = new RobotsEngine();
  private readonly sitemapEngine = new SitemapEngine();
  private readonly redirectEngine = new RedirectEngine();

  async analyzeSite(
    crawlResult: CrawlResult,
    context: AnalyzerContext,
  ): Promise<SiteAnalysisResult<AdvancedSeoSiteData>> {
    const isCrawlPartial = Boolean(
      crawlResult.summary.urlsSkippedLimits > 0 || crawlResult.summary.cancelled,
    );

    const crawledUrls = crawlResult.pages.map(p => p.requestedUrl);

    // 1. Analyze robots.txt
    const robots = await this.robotsEngine.analyze({
      entryUrl: context.entryUrl,
      authorizedOrigin: context.authorizedOrigin,
      httpClient: context.httpClient,
      signal: context.signal,
      crawledUrls,
    });

    // 2. Analyze XML Sitemaps (utilizing discovered sitemaps from robots.txt)
    const sitemap = await this.sitemapEngine.analyze({
      authorizedOrigin: context.authorizedOrigin,
      entryUrl: context.entryUrl,
      httpClient: context.httpClient,
      signal: context.signal,
      robotsSitemaps: robots.sitemapDirectives,
      crawledPages: crawlResult.pages,
      isCrawlPartial,
    });

    // 3. Analyze Redirects
    const redirects = this.redirectEngine.analyzeSite(crawlResult);

    const findings: AnalyzerFinding[] = [
      ...robots.findings,
      ...sitemap.findings,
      ...redirects.findings,
    ];

    return {
      findings: Object.freeze(findings),
      data: {
        robots,
        sitemap,
        redirects,
      },
    };
  }
}
