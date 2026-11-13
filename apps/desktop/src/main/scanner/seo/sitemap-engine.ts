/**
 * Comprehensive XML Sitemap Discovery, Parsing, Validation & Cross-Referencing Engine.
 * Supports sitemap indexes, standard URL sets, safe entity handling (XXE immune via htmlparser2),
 * and truthful discrepancy analysis against crawled pages.
 */

import { parseDocument, DomUtils } from 'htmlparser2';
import { URL } from 'node:url';
import type { SafeHttpClient } from '../client/http-client.js';
import type { CrawledPageResult } from '../crawler/types.js';
import type { AnalyzerFinding } from '../analyzers/types.js';
import type {
  SeoCoverageReport,
  SitemapAnalysisResult,
  SitemapDiscrepancy,
  SitemapIndexEntry,
  SitemapUrlEntry,
} from './types.js';

interface RawXmlParseResult {
  readonly isIndex: boolean;
  readonly isSitemapIndex?: boolean;
  readonly isUrlSet: boolean;
  readonly urls: SitemapUrlEntry[];
  readonly sitemapIndexes: SitemapIndexEntry[];
  readonly errors: string[];
}

/**
 * Parses raw XML sitemap text safely using htmlparser2 in XML mode.
 */
export function parseSitemapXml(xmlContent: string, sourceUrl: string): RawXmlParseResult {
  const urls: SitemapUrlEntry[] = [];
  const sitemapIndexes: SitemapIndexEntry[] = [];
  const errors: string[] = [];

  const trimmed = xmlContent.trim();
  if (!trimmed) {
    return {
      isIndex: false,
      isUrlSet: false,
      urls,
      sitemapIndexes,
      errors: ['XML content is empty'],
    };
  }

  // Pre-check for basic XML tag presence
  if (!trimmed.includes('<') || !trimmed.includes('>')) {
    return {
      isIndex: false,
      isUrlSet: false,
      urls,
      sitemapIndexes,
      errors: ['Content does not contain valid XML markup'],
    };
  }

  let doc;
  try {
    // Strip DOCTYPE declarations safely to neutralize any DTD/XXE entity attempts
    const sanitizedXml = trimmed.replace(/<!DOCTYPE[^>[\]]*(\[[^\]]*\])?>/gi, '');
    doc = parseDocument(sanitizedXml, { xmlMode: true, lowerCaseTags: true });
  } catch (err) {
    return {
      isIndex: false,
      isUrlSet: false,
      urls,
      sitemapIndexes,
      errors: [`XML Parser fatal error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const sitemapIndexTags = DomUtils.getElementsByTagName('sitemapindex', doc, true);
  const urlsetTags = DomUtils.getElementsByTagName('urlset', doc, true);

  const isIndex = sitemapIndexTags.length > 0;
  const isUrlSet = urlsetTags.length > 0;

  if (!isIndex && !isUrlSet) {
    errors.push('Root element is neither <urlset> nor <sitemapindex>');
  }

  // Parse Sitemap Index entries (<sitemap><loc>...</loc><lastmod>...</lastmod></sitemap>)
  if (isIndex) {
    const sitemapElements = DomUtils.getElementsByTagName('sitemap', doc, true);
    for (const smEl of sitemapElements) {
      const locEls = DomUtils.getElementsByTagName('loc', smEl, true);
      const loc = locEls.length > 0 ? DomUtils.getText(locEls[0]).trim() : '';

      const lastmodEls = DomUtils.getElementsByTagName('lastmod', smEl, true);
      const lastmod = lastmodEls.length > 0 ? DomUtils.getText(lastmodEls[0]).trim() : null;

      if (loc) {
        sitemapIndexes.push({
          loc,
          lastmod: lastmod || null,
          sourceSitemapUrl: sourceUrl,
        });
      }
    }
  }

  // Parse standard URL set entries (<url><loc>...</loc><lastmod>...</lastmod><changefreq>...</changefreq><priority>...</priority></url>)
  if (isUrlSet) {
    const urlElements = DomUtils.getElementsByTagName('url', doc, true);
    for (const urlEl of urlElements) {
      const locEls = DomUtils.getElementsByTagName('loc', urlEl, true);
      const loc = locEls.length > 0 ? DomUtils.getText(locEls[0]).trim() : '';

      const lastmodEls = DomUtils.getElementsByTagName('lastmod', urlEl, true);
      const lastmod = lastmodEls.length > 0 ? DomUtils.getText(lastmodEls[0]).trim() : null;

      const changefreqEls = DomUtils.getElementsByTagName('changefreq', urlEl, true);
      const changefreq =
        changefreqEls.length > 0 ? DomUtils.getText(changefreqEls[0]).trim() : null;

      const priorityEls = DomUtils.getElementsByTagName('priority', urlEl, true);
      let priority: number | null = null;
      if (priorityEls.length > 0) {
        const parsedPriority = parseFloat(DomUtils.getText(priorityEls[0]).trim());
        if (!isNaN(parsedPriority)) priority = parsedPriority;
      }

      if (loc) {
        urls.push({
          loc,
          lastmod: lastmod || null,
          changefreq: changefreq || null,
          priority,
          sourceSitemapUrl: sourceUrl,
        });
      }
    }
  }

  return {
    isIndex,
    isSitemapIndex: isIndex,
    isUrlSet,
    urls,
    sitemapIndexes,
    errors,
  };
}

export class SitemapEngine {
  readonly id = 'sitemap-engine';
  readonly name = 'XML Sitemap Analysis Engine';

  /**
   * Discovers, fetches, validates, and cross-references sitemaps.
   */
  async analyze(args: {
    authorizedOrigin: string;
    entryUrl: string;
    httpClient?: SafeHttpClient;
    signal?: AbortSignal;
    robotsSitemaps?: readonly string[];
    crawledPages?: readonly CrawledPageResult[];
    isCrawlPartial?: boolean;
    maxSitemaps?: number;
    maxSitemapUrls?: number;
  }): Promise<SitemapAnalysisResult> {
    const {
      authorizedOrigin,
      entryUrl,
      httpClient,
      signal,
      robotsSitemaps = [],
      crawledPages = [],
      isCrawlPartial = false,
      maxSitemaps = 20,
      maxSitemapUrls = 50000,
    } = args;

    const findings: AnalyzerFinding[] = [];
    const discoveredSitemaps: string[] = [];
    const allUrls: SitemapUrlEntry[] = [];
    const allIndexes: SitemapIndexEntry[] = [];
    const discrepancies: SitemapDiscrepancy[] = [];

    if (!httpClient) {
      return {
        discoveredSitemaps: [],
        totalUrlsDiscovered: 0,
        urls: [],
        sitemapIndexes: [],
        discrepancies: [],
        findings: [],
        coverage: {
          engine: 'sitemap',
          executed: false,
          status: 'skipped',
          itemsEvaluated: 0,
          reason: 'No HTTP client provided to fetch sitemaps',
        },
      };
    }

    const normOrigin = authorizedOrigin.toLowerCase().replace(/\/$/, '');
    const crossOriginUrls: string[] = [];

    // 1. Compile discovery candidates
    const candidateUrls = new Set<string>();

    for (const sm of robotsSitemaps) {
      if (sm && typeof sm === 'string' && sm.trim().length > 0) {
        const trimmedSm = sm.trim();
        try {
          const u = new URL(trimmedSm);
          if (u.origin.toLowerCase() === normOrigin) {
            candidateUrls.add(trimmedSm);
          } else {
            crossOriginUrls.push(trimmedSm);
          }
        } catch {
          // ignore unparseable robots sitemap entries
        }
      }
    }

    const originTrimmed = authorizedOrigin.replace(/\/$/, '');
    candidateUrls.add(`${originTrimmed}/sitemap.xml`);
    candidateUrls.add(`${originTrimmed}/sitemap_index.xml`);
    candidateUrls.add(`${originTrimmed}/wp-sitemap.xml`); // WordPress 5.5+ core sitemap

    const sitemapsToFetch = Array.from(candidateUrls);
    const fetchedSitemapUrls = new Set<string>();

    while (sitemapsToFetch.length > 0 && fetchedSitemapUrls.size < maxSitemaps) {
      if (signal?.aborted) break;

      const currentSitemapUrl = sitemapsToFetch.shift()!;
      if (fetchedSitemapUrls.has(currentSitemapUrl)) continue;
      fetchedSitemapUrls.add(currentSitemapUrl);

      try {
        const response = await httpClient.request({
          url: currentSitemapUrl,
          method: 'GET',
          signal,
        });

        if (response.statusCode >= 400) {
          // If this was an explicit robots.txt sitemap directive that failed, report error
          if (robotsSitemaps.includes(currentSitemapUrl)) {
            findings.push({
              ruleId: 'SEO_SITEMAP_HTTP_ERROR',
              category: 'technical-seo',
              title: `Sitemap Returned HTTP Error (${response.statusCode})`,
              description: `The sitemap referenced in robots.txt at ${currentSitemapUrl} returned HTTP status ${response.statusCode}. Search engines will fail to process this sitemap.`,
              severity: 'medium',
              confidence: 'confirmed',
              status: 'confirmed',
              targetUrl: currentSitemapUrl,
              evidence: { sitemapUrl: currentSitemapUrl, statusCode: response.statusCode },
              remediation:
                'Ensure the sitemap URL returns a valid HTTP 200 response with XML content.',
              references: [
                'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
              ],
            });
          }
          continue;
        }

        discoveredSitemaps.push(currentSitemapUrl);
        const xmlText = response.text();
        const parsed = parseSitemapXml(xmlText, currentSitemapUrl);

        if (parsed.errors.length > 0) {
          findings.push({
            ruleId: 'SEO_SITEMAP_MALFORMED',
            category: 'technical-seo',
            title: `Malformed XML Sitemap Syntax`,
            description: `The sitemap at ${currentSitemapUrl} contains malformed XML syntax or lacks valid root elements (<urlset> or <sitemapindex>).`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: currentSitemapUrl,
            evidence: { sitemapUrl: currentSitemapUrl, errors: parsed.errors },
            remediation:
              'Validate the XML document using a standards-compliant XML validator against the sitemaps.org schema.',
            references: ['https://www.sitemaps.org/protocol.html'],
          });
        }

        // Add sub-sitemaps from sitemap index
        for (const idx of parsed.sitemapIndexes) {
          allIndexes.push(idx);

          // Scope check: Child sitemaps must remain on the authorized origin
          try {
            const childUrl = new URL(idx.loc);
            if (childUrl.origin.toLowerCase() !== normOrigin) {
              crossOriginUrls.push(idx.loc);
              continue; // Never enqueue cross-origin child sitemaps
            }
          } catch {
            continue; // Skip invalid child URLs
          }

          if (
            !fetchedSitemapUrls.has(idx.loc) &&
            !sitemapsToFetch.includes(idx.loc) &&
            sitemapsToFetch.length + fetchedSitemapUrls.size < maxSitemaps
          ) {
            sitemapsToFetch.push(idx.loc);
          }
        }

        // Add URL entries
        for (const u of parsed.urls) {
          if (allUrls.length < maxSitemapUrls) {
            allUrls.push(u);
          }
        }
      } catch (err: unknown) {
        if (robotsSitemaps.includes(currentSitemapUrl)) {
          findings.push({
            ruleId: 'SEO_SITEMAP_UNREACHABLE',
            category: 'technical-seo',
            title: `Sitemap Resource Unreachable`,
            description: `Failed to connect to the sitemap at ${currentSitemapUrl}: ${err instanceof Error ? err.message : String(err)}`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: currentSitemapUrl,
            evidence: { sitemapUrl: currentSitemapUrl, error: String(err) },
            remediation:
              'Verify DNS, SSL certificates, and network routing for the sitemap endpoint.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
            ],
          });
        }
      }
    }

    const coverage: SeoCoverageReport = {
      engine: 'sitemap',
      executed: true,
      status: allUrls.length > 0 ? 'full' : 'partial',
      itemsEvaluated: allUrls.length,
    };

    // 2. Check for missing sitemap across all candidates
    if (discoveredSitemaps.length === 0) {
      findings.push({
        ruleId: 'SEO_SITEMAP_MISSING',
        category: 'technical-seo',
        title: 'No XML Sitemap Discovered',
        description: `No XML sitemaps were discovered via robots.txt directives or standard default paths (/sitemap.xml, /sitemap_index.xml, /wp-sitemap.xml). Sitemaps guide search engines to indexable content.`,
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: entryUrl,
        evidence: { searchedPaths: Array.from(candidateUrls) },
        remediation:
          'Generate and publish a standard XML sitemap (e.g. using WordPress core sitemaps or an SEO plugin) and reference it in robots.txt.',
        references: [
          'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
        ],
      });

      if (crossOriginUrls.length > 0) {
        findings.push({
          ruleId: 'SEO_SITEMAP_CROSS_ORIGIN_URL',
          category: 'technical-seo',
          title: `Cross-Origin Sitemap Declared (${crossOriginUrls.length} entries)`,
          description: `Sitemap directives reference locations outside the authorized domain (${normOrigin}). Sitemaps outside the target host are rejected to preserve security boundaries.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: crossOriginUrls[0],
          evidence: {
            crossOriginCount: crossOriginUrls.length,
            sampleUrls: crossOriginUrls.slice(0, 5),
            authorizedOrigin: normOrigin,
          },
          remediation: 'Ensure all sitemaps belong strictly to the authoritative domain.',
          references: ['https://www.sitemaps.org/protocol.html#location'],
        });
      }

      return {
        discoveredSitemaps: [],
        totalUrlsDiscovered: 0,
        urls: [],
        sitemapIndexes: [],
        discrepancies: [],
        findings: Object.freeze(findings),
        coverage,
      };
    }

    // 3. Validate entries in discovered sitemaps
    const seenLocs = new Map<string, string>();
    const duplicateUrls: string[] = [];
    const invalidDateUrls: string[] = [];

    for (const entry of allUrls) {
      const loc = entry.loc.trim();

      // Check cross-origin
      try {
        const u = new URL(loc);
        if (u.origin.toLowerCase() !== normOrigin) {
          crossOriginUrls.push(loc);
        }
      } catch {
        crossOriginUrls.push(loc);
      }

      // Check duplicate <loc>
      if (seenLocs.has(loc)) {
        duplicateUrls.push(loc);
      } else {
        seenLocs.set(loc, entry.sourceSitemapUrl);
      }

      // Check date format
      if (entry.lastmod) {
        const parsedDate = Date.parse(entry.lastmod);
        if (isNaN(parsedDate)) {
          invalidDateUrls.push(loc);
        }
      }
    }

    if (crossOriginUrls.length > 0) {
      findings.push({
        ruleId: 'SEO_SITEMAP_CROSS_ORIGIN_URL',
        category: 'technical-seo',
        title: `Cross-Origin URLs in XML Sitemap (${crossOriginUrls.length} entries)`,
        description: `The sitemap declares URLs outside the authorized domain (${normOrigin}). Search engines typically reject sitemap entries pointing to foreign domains unless verified via cross-domain authorization.`,
        severity: 'low',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: discoveredSitemaps[0],
        evidence: {
          crossOriginCount: crossOriginUrls.length,
          sampleUrls: crossOriginUrls.slice(0, 5),
          authorizedOrigin: normOrigin,
        },
        remediation: 'Ensure all sitemap entries belong strictly to the authoritative domain.',
        references: ['https://www.sitemaps.org/protocol.html#location'],
      });
    }

    if (duplicateUrls.length > 0) {
      findings.push({
        ruleId: 'SEO_SITEMAP_DUPLICATE_URL',
        category: 'technical-seo',
        title: `Duplicate URL Entries in XML Sitemap (${duplicateUrls.length} duplicates)`,
        description: `Multiple <url> blocks define the exact same <loc> address within the site's XML sitemaps. Duplicates waste search engine crawl budget.`,
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: discoveredSitemaps[0],
        evidence: {
          duplicateCount: duplicateUrls.length,
          sampleUrls: duplicateUrls.slice(0, 5),
        },
        remediation:
          'Deduplicate sitemap entries to ensure each unique canonical URL appears once.',
        references: ['https://www.sitemaps.org/protocol.html'],
      });
    }

    if (invalidDateUrls.length > 0) {
      findings.push({
        ruleId: 'SEO_SITEMAP_INVALID_DATE',
        category: 'technical-seo',
        title: `Invalid <lastmod> Date Format in Sitemap (${invalidDateUrls.length} entries)`,
        description: `Several <lastmod> elements do not conform to W3C Datetime format (YYYY-MM-DD or ISO 8601). Search engines require valid W3C timestamps.`,
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: discoveredSitemaps[0],
        evidence: {
          invalidDateCount: invalidDateUrls.length,
          sampleUrls: invalidDateUrls.slice(0, 5),
        },
        remediation: 'Format sitemap timestamps as YYYY-MM-DD or YYYY-MM-DDThh:mm:ssTZD.',
        references: ['https://www.w3.org/TR/NOTE-datetime'],
      });
    }

    // 4. Cross-Reference with Crawled Pages
    const sitemapUrlSet = new Set<string>();
    for (const u of allUrls) {
      sitemapUrlSet.add(u.loc.toLowerCase().replace(/\/$/, ''));
    }

    // A. Crawled pages missing from sitemap
    const indexablePagesMissingFromSitemap: string[] = [];

    for (const page of crawledPages) {
      if (!page.isHtml || (page.statusCode !== null && page.statusCode >= 300)) continue;

      const normPageUrl = page.requestedUrl.toLowerCase().replace(/\/$/, '');
      const path = new URL(page.requestedUrl).pathname.toLowerCase();

      // Skip archives, feeds, search queries, pagination, or utility URLs
      const isArchiveOrUtility =
        path.includes('/category/') ||
        path.includes('/tag/') ||
        path.includes('/author/') ||
        path.includes('/page/') ||
        path.includes('/feed/') ||
        path.includes('/wp-json/') ||
        path.includes('/cart/') ||
        path.includes('/checkout/') ||
        path.includes('/my-account/');

      const isNoindex =
        page.parsedDocument?.metadata?.robots?.toLowerCase().includes('noindex') ?? false;

      if (!isArchiveOrUtility && !isNoindex) {
        if (!sitemapUrlSet.has(normPageUrl)) {
          indexablePagesMissingFromSitemap.push(page.requestedUrl);
          discrepancies.push({
            type: 'missing_from_sitemap',
            url: page.requestedUrl,
            pageClassification: 'content',
            details: 'Indexable crawled content page not listed in any discovered XML sitemap.',
          });
        }
      }
    }

    if (indexablePagesMissingFromSitemap.length > 0) {
      findings.push({
        ruleId: 'SEO_SITEMAP_PAGE_NOT_IN_SITEMAP',
        category: 'technical-seo',
        title: `Indexable Pages Missing from XML Sitemap (${indexablePagesMissingFromSitemap.length} page(s))`,
        description: `Discovered content pages were crawled and returned HTTP 200 without noindex directives, but are not listed in any discovered XML sitemap.`,
        severity: 'low',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: indexablePagesMissingFromSitemap[0],
        evidence: {
          missingCount: indexablePagesMissingFromSitemap.length,
          sampleUrls: indexablePagesMissingFromSitemap.slice(0, 5),
        },
        remediation:
          'Update your XML sitemap generator to include all published, indexable content pages.',
        references: [
          'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
        ],
      });
    }

    // B. Sitemap URLs not crawled
    const crawledUrlSet = new Set<string>();
    for (const p of crawledPages) {
      crawledUrlSet.add(p.requestedUrl.toLowerCase().replace(/\/$/, ''));
      if (p.finalUrl) crawledUrlSet.add(p.finalUrl.toLowerCase().replace(/\/$/, ''));
    }

    const sitemapUrlsNotCrawled: string[] = [];
    for (const u of allUrls) {
      const normLoc = u.loc.toLowerCase().replace(/\/$/, '');
      if (!crawledUrlSet.has(normLoc)) {
        sitemapUrlsNotCrawled.push(u.loc);
        discrepancies.push({
          type: 'uncrawled_sitemap_url',
          url: u.loc,
          sitemapUrl: u.sourceSitemapUrl,
          details: isCrawlPartial
            ? 'URL listed in sitemap was not reached within crawler depth/page limits.'
            : 'URL listed in sitemap was not discovered via internal links during crawl.',
        });
      }
    }

    if (sitemapUrlsNotCrawled.length > 0) {
      findings.push({
        ruleId: 'SEO_SITEMAP_URL_NOT_CRAWLED',
        category: 'technical-seo',
        title: `Sitemap URLs Not Discovered During Crawl (${sitemapUrlsNotCrawled.length} URL(s))`,
        description: isCrawlPartial
          ? `The sitemap lists URLs that were not reached during the crawl. Because crawl execution was bounded by depth/page limits, these URLs may be valid pages beyond the sampled crawl horizon.`
          : `The sitemap lists URLs that have zero incoming internal links from crawled pages. These may be orphaned pages.`,
        severity: 'info',
        confidence: isCrawlPartial ? 'potential' : 'confirmed',
        status: isCrawlPartial ? 'needs_manual_review' : 'confirmed',
        targetUrl: sitemapUrlsNotCrawled[0],
        evidence: {
          uncrawledCount: sitemapUrlsNotCrawled.length,
          sampleUrls: sitemapUrlsNotCrawled.slice(0, 5),
          isCrawlPartial,
        },
        remediation:
          'Ensure all valuable pages listed in the sitemap are accessible through internal website navigation.',
        references: [
          'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
        ],
      });
    }

    return {
      discoveredSitemaps: Object.freeze(discoveredSitemaps),
      totalUrlsDiscovered: allUrls.length,
      urls: Object.freeze(allUrls),
      sitemapIndexes: Object.freeze(allIndexes),
      discrepancies: Object.freeze(discrepancies),
      findings: Object.freeze(findings),
      coverage,
    };
  }
}
