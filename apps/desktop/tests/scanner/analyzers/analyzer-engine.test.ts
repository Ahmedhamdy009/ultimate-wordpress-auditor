import { describe, it, expect } from 'vitest';
import { HtmlParserEngine } from '../../../src/main/scanner/parser/html-parser.js';
import { AnalyzerEngine } from '../../../src/main/scanner/analyzers/analyzer-engine.js';
import type { AnalyzerFinding, PageAnalyzer } from '../../../src/main/scanner/analyzers/types.js';
import type { CrawlResult, CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('AnalyzerEngine Orchestrator', () => {
  const context = {
    authorizedOrigin: 'https://example.com',
    entryUrl: 'https://example.com/',
  };

  const createPage = (url: string, html: string): CrawledPageResult => {
    const parsedDoc = HtmlParserEngine.parseHtml(html, url, 'https://example.com');
    return {
      requestedUrl: url,
      finalUrl: url,
      statusCode: 200,
      statusMessage: 'OK',
      headers: {
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      },
      contentType: 'text/html; charset=utf-8',
      isHtml: true,
      durationMs: 90,
      depth: 0,
      parentUrl: null,
      encodedBodyBytes: html.length,
      decompressedBodyBytes: html.length,
      parsedDocument: parsedDoc,
    };
  };

  it('runs all default analyzers end-to-end and computes aggregated stats', async () => {
    const htmlHome = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Home Page for WordPress Audit</title>
        <meta name="description" content="A comprehensive testing page with sufficient content length to avoid thin content warnings." />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="generator" content="WordPress 6.4.2" />
        <link rel="canonical" href="https://example.com/" />
        <link rel="stylesheet" href="/wp-content/themes/twentytwentyfour/style.css" />
      </head>
      <body>
        <h1>Welcome to WordPress Site</h1>
        <p>This is a solid paragraph explaining the website architecture and capabilities in full depth.</p>
        <a href="/about">Learn more about us</a>
        <img src="/logo.png" alt="Company Logo" width="200" height="50" />
      </body>
      </html>
    `;

    const htmlAbout = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>About Us Page for Testing</title>
        <meta name="description" content="This is another distinct description describing our company and background details." />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="canonical" href="https://example.com/about" />
      </head>
      <body>
        <h1>About Us</h1>
        <p>Detailed company background narrative that provides valuable information for users and visitors.</p>
      </body>
      </html>
    `;

    const crawlResult: CrawlResult = {
      summary: {
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 2,
        successfulPages: 2,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 2,
        urlsSkippedScope: 0,
        urlsSkippedLimits: 0,
        maxDepthReached: 1,
        durationMs: 250,
        cancelled: false,
      },
      pages: [
        createPage('https://example.com/', htmlHome),
        createPage('https://example.com/about', htmlAbout),
      ],
      discoveredUrls: ['https://example.com/', 'https://example.com/about'],
      errors: [],
    };

    const engine = new AnalyzerEngine();
    const result = await engine.runAnalysis(crawlResult, context);

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.stats.pagesAnalyzed).toBe(2);
    expect(result.stats.totalFindings).toBe(result.findings.length);

    // Verify stats breakdown exists and aligns
    expect(typeof result.stats.bySeverity).toBe('object');
    expect(typeof result.stats.byCategory).toBe('object');
    expect(typeof result.stats.byConfidence).toBe('object');
    expect(typeof result.stats.byRule).toBe('object');

    // Verify WordPress detection was triggered
    expect(result.findings.some(f => f.ruleId === 'WP_DETECTED')).toBe(true);
    expect(result.findings.some(f => f.ruleId === 'WP_VERSION_DISCLOSED')).toBe(true);
  });

  it('guarantees fair opportunity across analyzers via round-robin interleaving without starvation', async () => {
    // Analyzer A attempts to emit 20 findings
    const analyzerA: PageAnalyzer = {
      id: 'analyzer-a',
      name: 'Noisy Analyzer A',
      analyzePage: () => ({
        findings: Array.from({ length: 20 }, (_, i) => ({
          ruleId: `RULE_A_${i}`,
          category: 'Category A',
          title: `Finding A-${i}`,
          description: `Description A ${i}`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/page',
        })),
      }),
    };

    // Analyzer B attempts to emit 20 findings
    const analyzerB: PageAnalyzer = {
      id: 'analyzer-b',
      name: 'Quiet Analyzer B',
      analyzePage: () => ({
        findings: Array.from({ length: 20 }, (_, i) => ({
          ruleId: `RULE_B_${i}`,
          category: 'Category B',
          title: `Finding B-${i}`,
          description: `Description B ${i}`,
          severity: 'high',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/page',
        })),
      }),
    };

    const crawlResult: CrawlResult = {
      summary: {
        entryUrl: 'https://example.com/page',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 1,
        successfulPages: 1,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 1,
        urlsSkippedScope: 0,
        urlsSkippedLimits: 0,
        maxDepthReached: 0,
        durationMs: 50,
        cancelled: false,
      },
      pages: [createPage('https://example.com/page', '<html><body>Test</body></html>')],
      discoveredUrls: ['https://example.com/page'],
      errors: [],
    };

    // Limit to 4 findings per page
    const engine = new AnalyzerEngine({ maxFindingsPerPage: 4 }, [analyzerA, analyzerB], []);
    const result = await engine.runAnalysis(crawlResult, context);

    expect(result.findings.length).toBe(4);
    // Fair round-robin interleaving guarantees both analyzers are represented
    const ruleIds = result.findings.map(f => f.ruleId);
    expect(ruleIds).toEqual(['RULE_A_0', 'RULE_B_0', 'RULE_A_1', 'RULE_B_1']);

    // Summary truncation counter tracks the unconsumed candidate findings
    expect(result.stats.findingsTruncatedCount).toBe(36);
  });

  it('safely handles circular references and deep nesting without stack overflow', async () => {
    // Construct circular data structure
    interface CircularNode {
      name: string;
      nested: { refToParent?: CircularNode };
    }
    const circularObj: CircularNode = { name: 'Parent', nested: {} };
    circularObj.nested.refToParent = circularObj;

    const circularAnalyzer: PageAnalyzer = {
      id: 'circular-analyzer',
      name: 'Circular Analyzer',
      analyzePage: () => ({
        findings: [
          {
            ruleId: 'CIRCULAR_EVIDENCE',
            category: 'Safety',
            title: 'Circular Evidence Test',
            description: 'Verifies circular safety',
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: 'https://example.com/',
            evidence: circularObj,
          },
        ],
      }),
    };

    const crawlResult: CrawlResult = {
      summary: {
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 1,
        successfulPages: 1,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 1,
        urlsSkippedScope: 0,
        urlsSkippedLimits: 0,
        maxDepthReached: 0,
        durationMs: 50,
        cancelled: false,
      },
      pages: [createPage('https://example.com/', '<html><body>Test</body></html>')],
      discoveredUrls: ['https://example.com/'],
      errors: [],
    };

    const engine = new AnalyzerEngine({}, [circularAnalyzer], []);
    const result = await engine.runAnalysis(crawlResult, context);

    expect(result.findings.length).toBe(1);
    const finding = result.findings[0];
    const evidenceObj = finding.evidence as { nested: { refToParent: string } };
    expect(evidenceObj.nested.refToParent).toBe('[Circular Reference]');
    expect(result.stats.evidenceTruncatedCount).toBeGreaterThan(0);
  });

  it('deduplicates identical findings and ensures stats are not inflated by duplicates', async () => {
    const duplicateFinding: AnalyzerFinding = {
      ruleId: 'DUPLICATE_RULE',
      category: 'Deduplication',
      title: 'Duplicate Finding Title',
      description: 'First description',
      severity: 'medium',
      confidence: 'confirmed',
      status: 'confirmed',
      targetUrl: 'https://example.com/item',
      evidence: { count: 1 },
    };

    const dupAnalyzer: PageAnalyzer = {
      id: 'dup-analyzer',
      name: 'Duplicate Generator',
      analyzePage: () => ({
        // Emits identical finding 3 times
        findings: [duplicateFinding, duplicateFinding, duplicateFinding],
      }),
    };

    const crawlResult: CrawlResult = {
      summary: {
        entryUrl: 'https://example.com/item',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 1,
        successfulPages: 1,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 1,
        urlsSkippedScope: 0,
        urlsSkippedLimits: 0,
        maxDepthReached: 0,
        durationMs: 50,
        cancelled: false,
      },
      pages: [createPage('https://example.com/item', '<html><body>Test</body></html>')],
      discoveredUrls: ['https://example.com/item'],
      errors: [],
    };

    const engine = new AnalyzerEngine({}, [dupAnalyzer], []);
    const result = await engine.runAnalysis(crawlResult, context);

    expect(result.findings.length).toBe(1);
    // Verified: duplicate findings do NOT inflate statistics
    expect(result.stats.totalFindings).toBe(1);
    expect(result.stats.bySeverity['medium']).toBe(1);
    expect(result.stats.byCategory['Deduplication']).toBe(1);
    expect(result.stats.byRule['DUPLICATE_RULE']).toBe(1);
    expect(result.stats.duplicatesFilteredCount).toBe(2);
  });

  it('enforces maxTotalFindings limit across all pages and site analyzers', async () => {
    const pages = Array.from({ length: 10 }, (_, i) =>
      createPage(
        `https://example.com/page-${i}`,
        `<html><body>Page ${i} with no metadata</body></html>`,
      ),
    );

    const crawlResult: CrawlResult = {
      summary: {
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 10,
        successfulPages: 10,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 10,
        urlsSkippedScope: 0,
        urlsSkippedLimits: 0,
        maxDepthReached: 1,
        durationMs: 400,
        cancelled: false,
      },
      pages,
      discoveredUrls: pages.map(p => p.requestedUrl),
      errors: [],
    };

    const engine = new AnalyzerEngine({ maxTotalFindings: 5 });
    const result = await engine.runAnalysis(crawlResult, context);

    expect(result.findings.length).toBeLessThanOrEqual(5);
    expect(result.stats.totalFindings).toBeLessThanOrEqual(5);
    expect(result.stats.findingsTruncatedCount).toBeGreaterThan(0);
  });

  it('resiliently handles failing analyzers without crashing the engine', async () => {
    const brokenAnalyzer: PageAnalyzer = {
      id: 'broken-analyzer',
      name: 'Broken Analyzer',
      analyzePage: () => {
        throw new Error('Explosive analyzer failure!');
      },
    };

    const workingAnalyzer: PageAnalyzer = {
      id: 'working-analyzer',
      name: 'Working Analyzer',
      analyzePage: () => ({
        findings: [
          {
            ruleId: 'SAFE_FINDING',
            category: 'Safety',
            title: 'Safe Observation',
            description: 'Engine survived',
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: 'https://example.com/',
          },
        ],
      }),
    };

    const crawlResult: CrawlResult = {
      summary: {
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 1,
        successfulPages: 1,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 1,
        urlsSkippedScope: 0,
        urlsSkippedLimits: 0,
        maxDepthReached: 0,
        durationMs: 50,
        cancelled: false,
      },
      pages: [createPage('https://example.com/', '<html><body>Test</body></html>')],
      discoveredUrls: ['https://example.com/'],
      errors: [],
    };

    const engine = new AnalyzerEngine({}, [brokenAnalyzer, workingAnalyzer], []);
    const result = await engine.runAnalysis(crawlResult, context);

    expect(result.findings.length).toBe(1);
    expect(result.findings[0].ruleId).toBe('SAFE_FINDING');
  });
});
