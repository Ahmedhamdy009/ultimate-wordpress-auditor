/**
 * Cross-Page & Site-Level Analyzer.
 * Aggregates crawl results across multiple pages to detect:
 * 1. Duplicate page titles across distinct URLs.
 * 2. Duplicate meta descriptions across distinct URLs.
 * 3. Broken internal links referencing 4xx/5xx responses or crawl errors.
 */

import type { CrawledPageResult, CrawlResult } from '../crawler/types.js';
import type {
  AnalyzerContext,
  AnalyzerFinding,
  SiteAnalysisResult,
  SiteAnalyzer,
} from './types.js';

export interface CrossPageData {
  readonly duplicateTitlesCount: number;
  readonly duplicateDescriptionsCount: number;
  readonly brokenInternalLinksCount: number;
  readonly canonicalIssuesCount?: number;
  readonly duplicateContentCandidatesCount?: number;
}

export class CrossPageAnalyzer implements SiteAnalyzer<CrossPageData> {
  readonly id = 'cross-page-analyzer';
  readonly name = 'Cross-Page Audit Analyzer';

  analyzeSite(
    crawlResult: CrawlResult,
    _context: AnalyzerContext,
  ): SiteAnalysisResult<CrossPageData> {
    const findings: AnalyzerFinding[] = [];

    // Map crawled pages by both requested and final URLs for fast link lookups
    const pageByUrl = new Map<string, CrawledPageResult>();
    for (const page of crawlResult.pages) {
      pageByUrl.set(page.requestedUrl, page);
      if (page.finalUrl && page.finalUrl !== page.requestedUrl) {
        pageByUrl.set(page.finalUrl, page);
      }
    }

    // Map crawl errors
    const errorByUrl = new Map<string, { code: string; message: string }>();
    for (const err of crawlResult.errors) {
      errorByUrl.set(err.url, { code: err.code, message: err.message });
    }

    // ==========================================
    // 1. Duplicate Page Titles
    // ==========================================
    const pagesByTitle = new Map<string, string[]>();
    for (const page of crawlResult.pages) {
      const title = page.parsedDocument?.metadata.title?.trim();
      if (title && title.length > 0) {
        const normTitle = title.toLowerCase();
        const list = pagesByTitle.get(normTitle) || [];
        if (!list.includes(page.requestedUrl)) {
          list.push(page.requestedUrl);
        }
        pagesByTitle.set(normTitle, list);
      }
    }

    let duplicateTitlesCount = 0;
    for (const [titleKey, urls] of pagesByTitle.entries()) {
      if (urls.length >= 2) {
        duplicateTitlesCount++;
        const sampleUrl = urls[0];
        findings.push({
          ruleId: 'CONTENT_DUPLICATE_TITLE',
          category: 'content-quality',
          title: `Duplicate Page Title Across Multiple URLs (${urls.length} pages)`,
          description: `The exact title ("${titleKey.slice(0, 60)}${titleKey.length > 60 ? '...' : ''}") is shared by ${urls.length} distinct pages. Unique titles help search engines and users differentiate content.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: sampleUrl,
          evidence: {
            title: titleKey,
            count: urls.length,
            affectedUrls: urls.slice(0, 10),
          },
          remediation:
            'Ensure each page possesses a unique, descriptive title tag reflecting its distinct topic.',
          references: ['https://developers.google.com/search/docs/appearance/title-link'],
        });
      }
    }

    // ==========================================
    // 2. Duplicate Meta Descriptions
    // ==========================================
    const pagesByDescription = new Map<string, string[]>();
    for (const page of crawlResult.pages) {
      const desc = page.parsedDocument?.metadata.description?.trim();
      if (desc && desc.length > 0) {
        const normDesc = desc.toLowerCase();
        const list = pagesByDescription.get(normDesc) || [];
        if (!list.includes(page.requestedUrl)) {
          list.push(page.requestedUrl);
        }
        pagesByDescription.set(normDesc, list);
      }
    }

    let duplicateDescriptionsCount = 0;
    for (const [descKey, urls] of pagesByDescription.entries()) {
      if (urls.length >= 2) {
        duplicateDescriptionsCount++;
        const sampleUrl = urls[0];
        findings.push({
          ruleId: 'CONTENT_DUPLICATE_DESCRIPTION',
          category: 'technical-seo',
          title: `Duplicate Meta Description Across Multiple URLs (${urls.length} pages)`,
          description: `The identical meta description is shared by ${urls.length} separate pages.`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: sampleUrl,
          evidence: {
            descriptionSnippet: descKey.slice(0, 100),
            count: urls.length,
            affectedUrls: urls.slice(0, 10),
          },
          remediation:
            'Provide customized meta descriptions for distinct pages, or omit them where automated snippets are suitable.',
          references: ['https://developers.google.com/search/docs/appearance/snippets'],
        });
      }
    }

    // ==========================================
    // 3. Broken Internal Links
    // ==========================================
    let brokenInternalLinksCount = 0;
    const reportedBrokenLinks = new Set<string>();

    for (const page of crawlResult.pages) {
      if (!page.parsedDocument) continue;

      for (const link of page.parsedDocument.links) {
        if (!link.isInternal || !link.resolvedUrl) continue;

        const targetUrl = link.resolvedUrl;
        // Ignore CDN utility / email obfuscation endpoints (e.g. Cloudflare email protection)
        if (targetUrl.includes('/cdn-cgi/')) continue;

        const linkKey = `${page.requestedUrl}->${targetUrl}`;
        if (reportedBrokenLinks.has(linkKey)) continue;

        const targetPage = pageByUrl.get(targetUrl);
        const targetErr = errorByUrl.get(targetUrl);

        if (targetPage && targetPage.statusCode !== null && targetPage.statusCode >= 400) {
          reportedBrokenLinks.add(linkKey);
          brokenInternalLinksCount++;

          const is404 = targetPage.statusCode === 404;
          const is5xx = targetPage.statusCode >= 500;

          findings.push({
            ruleId: 'SEO_BROKEN_INTERNAL_LINK',
            category: 'technical-seo',
            title: `Broken Internal Link (HTTP ${targetPage.statusCode})`,
            description: `Page ${page.requestedUrl} contains an internal link to ${targetUrl}, which returned HTTP ${targetPage.statusCode} (${targetPage.statusMessage || 'Error'}).`,
            severity: is5xx ? 'high' : is404 ? 'medium' : 'low',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: page.requestedUrl,
            evidence: {
              sourceUrl: page.requestedUrl,
              targetUrl,
              statusCode: targetPage.statusCode,
              statusMessage: targetPage.statusMessage,
              linkText: link.text.trim().slice(0, 50),
            },
            remediation:
              'Update the link to point to a valid URL, or remove the outdated anchor tag.',
            references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404'],
          });
        } else if (targetPage?.error || targetErr) {
          reportedBrokenLinks.add(linkKey);
          brokenInternalLinksCount++;

          const errCode = targetPage?.error?.code || targetErr?.code || 'FETCH_ERROR';
          const errMsg = targetPage?.error?.message || targetErr?.message || 'Network error';

          findings.push({
            ruleId: 'SEO_BROKEN_INTERNAL_LINK',
            category: 'technical-seo',
            title: `Internal Link Fetch Failure (${errCode})`,
            description: `Page ${page.requestedUrl} contains an internal link to ${targetUrl}, which failed with error ${errCode}: ${errMsg}.`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: page.requestedUrl,
            evidence: {
              sourceUrl: page.requestedUrl,
              targetUrl,
              errorCode: errCode,
              errorMessage: errMsg,
              linkText: link.text.trim().slice(0, 50),
            },
            remediation: 'Verify the destination server endpoint and remove broken internal links.',
            references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Status'],
          });
        }
      }
    }

    // ==========================================
    // 4. Canonical Target Resolution & Chains
    // ==========================================
    let canonicalIssuesCount = 0;
    const evaluatedCanonicals = new Set<string>();

    for (const page of crawlResult.pages) {
      const canonical = page.parsedDocument?.metadata.canonical?.trim();
      if (!canonical) continue;

      const pageKey = page.requestedUrl;
      if (evaluatedCanonicals.has(pageKey)) continue;
      evaluatedCanonicals.add(pageKey);

      // Check if canonical points to a target URL in the crawl
      const targetPage = pageByUrl.get(canonical);

      if (targetPage && targetPage.statusCode !== null && targetPage.statusCode >= 400) {
        canonicalIssuesCount++;
        findings.push({
          ruleId: 'SEO_CANONICAL_TARGET_BROKEN',
          category: 'technical-seo',
          title: `Broken Canonical Target URL (HTTP ${targetPage.statusCode})`,
          description: `Page ${pageKey} declares a canonical URL pointing to ${canonical}, but the destination returned HTTP ${targetPage.statusCode} (${targetPage.statusMessage || 'Error'}). Canonical targets must be valid, 200 OK pages.`,
          severity: targetPage.statusCode >= 500 ? 'high' : 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: pageKey,
          evidence: {
            sourceUrl: pageKey,
            canonicalTarget: canonical,
            targetStatusCode: targetPage.statusCode,
          },
          remediation:
            'Update the canonical tag to point to a valid, live URL or self-reference if the target page has been removed.',
          references: [
            'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
          ],
        });
      } else if (targetPage?.parsedDocument?.metadata.canonical) {
        const targetCanonical = targetPage.parsedDocument.metadata.canonical.trim();
        // Check for loop: A -> B -> A
        if (
          targetCanonical === pageKey ||
          targetCanonical.replace(/\/$/, '') === pageKey.replace(/\/$/, '')
        ) {
          canonicalIssuesCount++;
          findings.push({
            ruleId: 'SEO_CANONICAL_LOOP',
            category: 'technical-seo',
            title: 'Canonical URL Loop Detected (A <-> B)',
            description: `Page ${pageKey} points its canonical tag to ${canonical}, but ${canonical} specifies its canonical tag back to ${pageKey}. This loop confuses search indexing signals.`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: pageKey,
            evidence: {
              sourceUrl: pageKey,
              targetUrl: canonical,
              targetCanonical,
            },
            remediation:
              'Break the canonical loop by designating one authoritative URL and making the other point to it consistently.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
            ],
          });
        }
        // Check for chain: A -> B -> C (where B != C and C != A)
        else if (
          targetCanonical !== canonical &&
          targetCanonical.replace(/\/$/, '') !== canonical.replace(/\/$/, '')
        ) {
          canonicalIssuesCount++;
          findings.push({
            ruleId: 'SEO_CANONICAL_CHAIN',
            category: 'technical-seo',
            title: 'Canonical URL Chain Detected (A -> B -> C)',
            description: `Page ${pageKey} declares a canonical URL of ${canonical}, which in turn declares a canonical URL of ${targetCanonical}. Multi-hop canonical chains may be ignored by search engines.`,
            severity: 'low',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: pageKey,
            evidence: {
              sourceUrl: pageKey,
              intermediateUrl: canonical,
              finalCanonical: targetCanonical,
            },
            remediation:
              'Point the canonical tag directly to the final authoritative target URL rather than an intermediate alias.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
            ],
          });
        }
      }
    }

    // ==========================================
    // 5. Language-Aware Duplicate Content Candidates
    // ==========================================
    let duplicateContentCandidatesCount = 0;
    const pagesByContentSignature = new Map<string, string[]>();

    for (const page of crawlResult.pages) {
      const meta = page.parsedDocument?.metadata;
      if (!meta) continue;

      const title = meta.title?.trim().toLowerCase();
      const desc = meta.description?.trim().toLowerCase();
      if (!title || !desc) continue;

      // Determine language context (from HTML lang or URL path) to ensure
      // Arabic and English translations are NEVER conflated or collapsed!
      let lang = meta.lang?.toLowerCase().split('-')[0] || '';
      if (!lang) {
        lang = page.requestedUrl.includes('/ar/') ? 'ar' : 'en';
      }

      // Skip taxonomy archive listings and pagination from duplicate content checks
      const isTaxonomy = /\/(?:project-)?(?:category|technology|tag)\//i.test(page.requestedUrl);
      const isPagination = /\/page\/\d+/i.test(page.requestedUrl);
      if (isTaxonomy || isPagination) continue;

      const signature = `${lang}::${title}::${desc}`;
      const list = pagesByContentSignature.get(signature) ?? [];
      if (!list.includes(page.requestedUrl)) {
        list.push(page.requestedUrl);
      }
      pagesByContentSignature.set(signature, list);
    }

    for (const [sig, urls] of pagesByContentSignature.entries()) {
      if (urls.length >= 2) {
        duplicateContentCandidatesCount++;
        const sampleUrl = urls[0];
        const [lang, title] = sig.split('::');

        findings.push({
          ruleId: 'CONTENT_DUPLICATE_PAGE_CANDIDATE',
          category: 'content-quality',
          title: `Duplicate Content Candidate (${urls.length} URLs with identical metadata in [${lang.toUpperCase()}])`,
          description: `The pages [${urls.slice(0, 3).join(', ')}] share identical titles and meta descriptions within the "${lang}" language context without canonical consolidation. This often indicates duplicate template instances, staging clones, or unindexed duplicates.`,
          severity: 'low',
          confidence: 'potential',
          status: 'potential',
          targetUrl: sampleUrl,
          evidence: {
            language: lang,
            sharedTitle: title,
            count: urls.length,
            affectedUrls: urls.slice(0, 10),
          },
          remediation:
            'Add a canonical tag pointing to the primary URL, configure a 301 redirect, or ensure each page contains distinct editorial content.',
          references: [
            'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
          ],
        });
      }
    }

    const data: CrossPageData = {
      duplicateTitlesCount,
      duplicateDescriptionsCount,
      brokenInternalLinksCount,
      canonicalIssuesCount,
      duplicateContentCandidatesCount,
    };

    return {
      findings,
      data,
    };
  }
}
