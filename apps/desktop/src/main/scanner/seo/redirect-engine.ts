/**
 * Standards-aware Redirect Mapping & Diagnostic Analysis Engine.
 * Detects redirect chains, loops, temporary vs permanent misconfigurations,
 * protocol transitions, trailing slash drift, broken destinations,
 * and internal links pointing directly to redirecting endpoints.
 */

import { URL } from 'node:url';
import type { CrawlResult } from '../crawler/types.js';
import type { AnalyzerFinding } from '../analyzers/types.js';
import type {
  RedirectAnalysisResult,
  RedirectHopRecord,
  RedirectTraceResult,
  SeoCoverageReport,
} from './types.js';

export class RedirectEngine {
  readonly id = 'redirect-engine';
  readonly name = 'Redirect Mapping & Diagnostics Engine';

  /**
   * Analyzes all redirects recorded during crawling and audits internal link references.
   */
  analyzeSite(crawlResult: CrawlResult): RedirectAnalysisResult {
    const traces: RedirectTraceResult[] = [];
    const findings: AnalyzerFinding[] = [];

    let redirectChainsCount = 0;
    let redirectLoopsCount = 0;
    let temporaryRedirectsCount = 0;
    let internalLinksToRedirectsCount = 0;

    // 1. Process redirect chains from CrawledPageResult
    const redirectingSourceMap = new Map<string, string>(); // sourceUrl (lower) -> finalUrl

    for (const page of crawlResult.pages) {
      if (page.redirectChain && page.redirectChain.length > 0) {
        const hops: RedirectHopRecord[] = page.redirectChain.map(h => ({
          fromUrl: h.fromUrl,
          toUrl: h.toUrl,
          statusCode: h.statusCode,
          location: h.location,
        }));

        const initialUrl = page.requestedUrl;
        const finalUrl =
          page.finalUrl || (hops.length > 0 ? hops[hops.length - 1].toUrl : initialUrl);
        const hopCount = hops.length;

        // Check Loop (detects if any URL appears more than once in the chain)
        const visitedInChain = new Set<string>();
        let isLoop = false;
        for (const h of hops) {
          const normFrom = h.fromUrl.toLowerCase();
          const normTo = h.toUrl.toLowerCase();
          if (visitedInChain.has(normTo) || normFrom === normTo) {
            isLoop = true;
            break;
          }
          visitedInChain.add(normFrom);
        }

        const isChain = hopCount > 1;
        const isTemporary = hops.some(h => h.statusCode === 302 || h.statusCode === 307);

        // Protocol check: HTTP -> HTTPS
        let isDowngrade = false;
        let isHttpToHttps = false;
        try {
          const uInit = new URL(initialUrl);
          const uFinal = new URL(finalUrl);
          if (uInit.protocol === 'http:' && uFinal.protocol === 'https:') {
            isHttpToHttps = true;
          } else if (uInit.protocol === 'https:' && uFinal.protocol === 'http:') {
            isDowngrade = true;
          }
        } catch {
          // ignore invalid URLs
        }

        // Trailing slash normalization check
        let isTrailingSlashNormalization = false;
        let isWwwNormalization = false;
        try {
          const uInit = new URL(initialUrl);
          const uFinal = new URL(finalUrl);
          if (
            uInit.hostname === uFinal.hostname &&
            uInit.pathname !== uFinal.pathname &&
            uInit.pathname.replace(/\/$/, '') === uFinal.pathname.replace(/\/$/, '')
          ) {
            isTrailingSlashNormalization = true;
          }
          if (
            uInit.hostname !== uFinal.hostname &&
            (uInit.hostname === `www.${uFinal.hostname}` ||
              uFinal.hostname === `www.${uInit.hostname}`)
          ) {
            isWwwNormalization = true;
          }
        } catch {
          // ignore
        }

        // Broken destination: final page returned 4xx/5xx or network/transport error
        const isBrokenDestination = Boolean(
          (page.statusCode && page.statusCode >= 400) || page.error,
        );

        const trace: RedirectTraceResult = {
          initialUrl,
          finalUrl,
          hopCount,
          hops: Object.freeze(hops),
          isChain,
          isLoop,
          isTemporary,
          isDowngrade,
          isTrailingSlashNormalization,
          isWwwNormalization,
          isBrokenDestination,
          finalStatusCode: page.statusCode,
        };

        traces.push(trace);
        redirectingSourceMap.set(initialUrl.toLowerCase().replace(/\/$/, ''), finalUrl);

        if (isChain) redirectChainsCount++;
        if (isLoop) redirectLoopsCount++;
        if (isTemporary) temporaryRedirectsCount++;

        // ==========================================
        // Finding Rules Evaluation
        // ==========================================

        // A. Redirect Loop
        if (isLoop) {
          findings.push({
            ruleId: 'SEO_REDIRECT_LOOP',
            category: 'technical-seo',
            title: `Circular Redirect Loop Detected (${initialUrl})`,
            description: `The URL ${initialUrl} enters a circular redirect loop. Browsers and search engine spiders will abort navigation with ERR_TOO_MANY_REDIRECTS.`,
            severity: 'high',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: initialUrl,
            evidence: { initialUrl, hopCount, hops },
            remediation:
              'Resolve the conflicting redirect rules on the web server or application router.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
            ],
          });
        }
        // B. Excessive Hops / Multi-Hop Chain
        else if (hopCount >= 4) {
          findings.push({
            ruleId: 'SEO_REDIRECT_EXCESSIVE_HOPS',
            category: 'technical-seo',
            title: `Excessive Redirect Hops (${hopCount} hops) for ${initialUrl}`,
            description: `The URL ${initialUrl} requires ${hopCount} redirect hops to reach its final destination. Long redirect chains deplete search engine crawl budgets and degrade page load speed.`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: initialUrl,
            evidence: { initialUrl, finalUrl, hopCount, hops },
            remediation:
              'Point the original URL directly to the final canonical destination in a single 301 hop.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
            ],
          });
        } else if (isChain) {
          findings.push({
            ruleId: 'SEO_REDIRECT_CHAIN',
            category: 'technical-seo',
            title: `Multi-Hop Redirect Chain (${hopCount} hops) for ${initialUrl}`,
            description: `The request to ${initialUrl} went through ${hopCount} redirect hops before resolving to ${finalUrl}. Eliminating intermediate hops speeds up indexing.`,
            severity: 'low',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: initialUrl,
            evidence: { initialUrl, finalUrl, hopCount, hops },
            remediation:
              'Update redirects to point directly from source to destination without intermediary hops.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
            ],
          });
        }

        // C. Broken Destination
        if (isBrokenDestination) {
          const statusText = page.statusCode
            ? `HTTP ${page.statusCode}`
            : (page.error?.message ?? 'Network Failure');
          findings.push({
            ruleId: 'SEO_REDIRECT_BROKEN_DESTINATION',
            category: 'technical-seo',
            title: `Redirect Leads to Broken Destination (${page.statusCode ? `HTTP ${page.statusCode}` : 'Connection Error'})`,
            description: `The URL ${initialUrl} redirects to ${finalUrl}, but the final destination returned error status (${statusText}).`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: initialUrl,
            evidence: {
              initialUrl,
              finalUrl,
              finalStatusCode: page.statusCode,
              error: page.error,
              hops,
            },
            remediation:
              'Update or remove the redirect so it targets an active, valid HTTP 200 resource.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
            ],
          });
        }

        // D. Temporary Redirect Used for Canonical Structure
        if (isTemporary && !isLoop && !isBrokenDestination) {
          findings.push({
            ruleId: 'SEO_REDIRECT_TEMPORARY_FOR_PERMANENT',
            category: 'technical-seo',
            title: `Temporary Redirect (HTTP 302/307) Used Instead of Permanent 301`,
            description: `The URL ${initialUrl} uses an HTTP 302/307 temporary redirect to ${finalUrl}. Unless the change is strictly temporary, search engines may retain the old URL and fail to consolidate link signals.`,
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: initialUrl,
            evidence: { initialUrl, finalUrl, statusCodes: hops.map(h => h.statusCode) },
            remediation:
              'Switch to an HTTP 301 (Moved Permanently) or 308 redirect for permanent URL migrations.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
            ],
          });
        }

        // E. Trailing Slash Inconsistency
        if (isTrailingSlashNormalization) {
          findings.push({
            ruleId: 'SEO_REDIRECT_TRAILING_SLASH',
            category: 'technical-seo',
            title: `Trailing Slash URL Normalization Redirect`,
            description: `The URL ${initialUrl} redirects to ${finalUrl} solely to append or remove a trailing slash. Internal links should point directly to the normalized slash convention.`,
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: initialUrl,
            evidence: { initialUrl, finalUrl },
            remediation:
              'Enforce a uniform trailing slash convention across internal navigation links.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
            ],
          });
        }

        // F. HTTP to HTTPS Upgrade (Informative confirmation)
        if (isHttpToHttps && hopCount === 1) {
          findings.push({
            ruleId: 'SEO_REDIRECT_HTTP_TO_HTTPS',
            category: 'technical-seo',
            title: `HTTP to HTTPS Canonical Redirection Verified`,
            description: `The insecure URL ${initialUrl} properly redirects to secure transport at ${finalUrl}.`,
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: initialUrl,
            evidence: { initialUrl, finalUrl, statusCode: hops[0].statusCode },
            remediation: 'Maintain secure HTTPS redirection across all entry points.',
            references: ['https://developers.google.com/search/docs/crawling-indexing/https'],
          });
        }
      }
    }

    // 2. Audit Internal Links on Crawled Pages: identify links pointing to known redirecting URLs
    if (redirectingSourceMap.size > 0) {
      const internalLinkIssues: Array<{
        sourcePage: string;
        linkTarget: string;
        resolvesTo: string;
      }> = [];

      for (const page of crawlResult.pages) {
        if (!page.parsedDocument) continue;

        for (const link of page.parsedDocument.links) {
          if (!link.isInternal) continue;
          const rawUrl = link.resolvedUrl || link.originalValue;
          if (!rawUrl) continue;

          const normLink = rawUrl.toLowerCase().replace(/\/$/, '');
          if (redirectingSourceMap.has(normLink)) {
            const finalDestination = redirectingSourceMap.get(normLink)!;
            internalLinkIssues.push({
              sourcePage: page.requestedUrl,
              linkTarget: rawUrl,
              resolvesTo: finalDestination,
            });
          }
        }
      }

      if (internalLinkIssues.length > 0) {
        internalLinksToRedirectsCount = internalLinkIssues.length;
        findings.push({
          ruleId: 'SEO_REDIRECT_INTERNAL_LINK_TO_REDIRECT',
          category: 'technical-seo',
          title: `Internal Links Pointing to Redirecting URLs (${internalLinkIssues.length} link(s))`,
          description: `Internal links on crawled HTML pages point directly to URLs that trigger HTTP redirects instead of pointing to their final resolved destination.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: internalLinkIssues[0].sourcePage,
          evidence: {
            totalLinks: internalLinkIssues.length,
            samples: internalLinkIssues.slice(0, 5),
          },
          remediation:
            'Update internal href attributes to point directly to the destination URL to avoid unnecessary redirect round-trips.',
          references: ['https://developers.google.com/search/docs/crawling-indexing/301-redirects'],
        });
      }
    }

    const coverage: SeoCoverageReport = {
      engine: 'redirects',
      executed: true,
      status: 'full',
      itemsEvaluated: crawlResult.pages.length,
    };

    return {
      totalTraces: traces.length,
      redirectChainsCount,
      chainsDetected: redirectChainsCount,
      redirectLoopsCount,
      loopsDetected: redirectLoopsCount,
      temporaryRedirectsCount,
      traces: Object.freeze(traces),
      internalLinksToRedirectsCount,
      findings: Object.freeze(findings),
      coverage,
    };
  }
}
