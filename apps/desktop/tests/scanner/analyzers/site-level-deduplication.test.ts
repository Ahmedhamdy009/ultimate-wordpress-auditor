import { describe, it, expect } from 'vitest';
import {
  AnalyzerEngine,
  SITE_LEVEL_RULE_IDS,
} from '../../../src/main/scanner/analyzers/analyzer-engine.js';
import type {
  PageAnalyzer,
  PageAnalyzerResult,
} from '../../../src/main/scanner/analyzers/types.js';
import type { CrawlResult, CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('Site-Level Rule Deduplication & Aggregation Suite', () => {
  const context = {
    authorizedOrigin: 'https://example.com',
    entryUrl: 'https://example.com/',
  };

  const createFakePage = (url: string): CrawledPageResult => ({
    requestedUrl: url,
    finalUrl: url,
    statusCode: 200,
    statusMessage: 'OK',
    headers: {},
    contentType: 'text/html; charset=utf-8',
    isHtml: true,
    durationMs: 50,
    depth: 1,
    parentUrl: 'https://example.com/',
    encodedBodyBytes: 100,
    decompressedBodyBytes: 100,
    parsedDocument: null,
  });

  it('aggregates site-level rules across multiple pages with occurrenceCount and affectedUrls', async () => {
    // Custom mock analyzer that emits a site-level finding and a page-level finding on every page
    const mockAnalyzer: PageAnalyzer = {
      name: 'MockAnalyzer',
      analyzePage: (page): PageAnalyzerResult => ({
        findings: [
          {
            scanRunId: 'test-scan-1',
            ruleId: 'SEC_HEADER_CSP_MISSING',
            category: 'Security',
            title: 'Content Security Policy (CSP) Header Missing',
            description: 'The response does not include a Content-Security-Policy header.',
            severity: 'medium',
            confidence: 'confirmed',
            status: 'active',
            targetUrl: page.requestedUrl,
            evidence: { header: 'content-security-policy' },
            remediation: 'Implement a Content Security Policy.',
            references: [],
          },
          {
            scanRunId: 'test-scan-1',
            ruleId: 'PAGE_CUSTOM_ISSUE',
            category: 'SEO',
            title: 'Page Specific Issue',
            description: `Issue specific to ${page.requestedUrl}`,
            severity: 'low',
            confidence: 'confirmed',
            status: 'active',
            targetUrl: page.requestedUrl,
            evidence: { pageUrl: page.requestedUrl },
            remediation: 'Fix page.',
            references: [],
          },
        ],
      }),
    };

    const pages = [
      createFakePage('https://example.com/'),
      createFakePage('https://example.com/about/'),
      createFakePage('https://example.com/blog/'),
      createFakePage('https://example.com/contact/'),
      createFakePage('https://example.com/services/'),
    ];

    const crawlResult: CrawlResult = {
      pages,
      summary: {
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        totalPagesCrawled: pages.length,
        durationMs: 250,
        completedNormally: true,
      },
    };

    const engine = new AnalyzerEngine({}, [mockAnalyzer], []);
    const result = await engine.runAnalysis(crawlResult, context);

    // Site-level rule should be aggregated into exactly 1 finding
    const cspFindings = result.findings.filter(f => f.ruleId === 'SEC_HEADER_CSP_MISSING');
    expect(cspFindings.length).toBe(1);

    const cspFinding = cspFindings[0];
    expect(cspFinding).toBeDefined();
    const ev = cspFinding.evidence as Record<string, unknown>;
    expect(ev.occurrenceCount).toBe(5);
    expect(Array.isArray(ev.affectedUrls)).toBe(true);
    expect((ev.affectedUrls as string[]).length).toBe(5);
    expect(ev.affectedUrls).toContain('https://example.com/');
    expect(ev.affectedUrls).toContain('https://example.com/services/');

    // Page-level rule should NOT be site-aggregated; each distinct page keeps its finding
    const pageFindings = result.findings.filter(f => f.ruleId === 'PAGE_CUSTOM_ISSUE');
    expect(pageFindings.length).toBe(5);

    // Stats check: duplicatesFilteredCount should reflect the 4 suppressed occurrences of CSP
    expect(result.stats.duplicatesFilteredCount).toBe(4);
    expect(result.stats.byRule['SEC_HEADER_CSP_MISSING']).toBe(1);
    expect(result.stats.byRule['PAGE_CUSTOM_ISSUE']).toBe(5);
  });

  it('verifies SITE_LEVEL_RULE_IDS includes all expected site-wide rules', () => {
    expect(SITE_LEVEL_RULE_IDS.has('WP_DETECTED')).toBe(true);
    expect(SITE_LEVEL_RULE_IDS.has('WP_REST_API_ADVERTISED')).toBe(true);
    expect(SITE_LEVEL_RULE_IDS.has('SEC_HEADER_CSP_MISSING')).toBe(true);
    expect(SITE_LEVEL_RULE_IDS.has('SEC_HEADER_HSTS_PRELOAD_ELIGIBLE')).toBe(true);
  });
});
