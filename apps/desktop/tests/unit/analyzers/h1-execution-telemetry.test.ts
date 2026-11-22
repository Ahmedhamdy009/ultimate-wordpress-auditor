import { describe, it, expect } from 'vitest';
import { SeoPerformanceAnalyzer } from '../../../src/main/scanner/analyzers/seo-performance-analyzer.js';
import type { CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('SeoPerformanceAnalyzer — H1 Rule Execution Telemetry', () => {
  const analyzer = new SeoPerformanceAnalyzer();

  const makePageWithHeadings = (headings: Array<{ level: number; text: string }>): CrawledPageResult => ({
    requestedUrl: 'https://example.com/test',
    status: 200,
    headers: { 'content-type': 'text/html' },
    durationMs: 50,
    encodedBodyBytes: 100,
    decompressedBodyBytes: 200,
    findings: [],
    links: [],
    assets: [],
    forms: [],
    parsedDocument: {
      metadata: {
        title: 'Test Page With Valid Length',
        openGraph: {},
        twitterCard: {},
      },
      headings,
      canonicalUrl: null,
      metaRobots: null,
      viewport: 'width=device-width, initial-scale=1',
      htmlLang: 'en',
      images: [],
      hreflangs: [],
      resources: [],
    },
  });

  it('h1Count === 0: emits SEO_H1_MISSING finding and marks SEO_H1_MULTIPLE SKIPPED', () => {
    const page = makePageWithHeadings([
      { level: 2, text: 'Secondary Section' },
    ]);
    const res = analyzer.analyzePage(page, { authorizedOrigin: 'https://example.com', entryUrl: 'https://example.com' });

    expect(res.findings.some(f => f.ruleId === 'SEO_H1_MISSING')).toBe(true);
    expect(res.findings.some(f => f.ruleId === 'SEO_H1_MULTIPLE')).toBe(false);

    const missingExec = res.ruleExecutions?.find(r => r.ruleId === 'SEO_H1_MISSING');
    expect(missingExec?.outcome).toBe('WITH_FINDINGS');

    const multipleExec = res.ruleExecutions?.find(r => r.ruleId === 'SEO_H1_MULTIPLE');
    expect(multipleExec?.outcome).toBe('SKIPPED');
    expect(multipleExec?.skipReason).toBe('NO_MATCHING_ELEMENTS');
  });

  it('h1Count === 1: marks both SEO_H1_MISSING and SEO_H1_MULTIPLE as affirmative CLEAN', () => {
    const page = makePageWithHeadings([
      { level: 1, text: 'Single Primary Heading' },
      { level: 2, text: 'Secondary Heading' },
    ]);
    const res = analyzer.analyzePage(page, { authorizedOrigin: 'https://example.com', entryUrl: 'https://example.com' });

    expect(res.findings.some(f => f.ruleId === 'SEO_H1_MISSING')).toBe(false);
    expect(res.findings.some(f => f.ruleId === 'SEO_H1_MULTIPLE')).toBe(false);

    const missingExec = res.ruleExecutions?.find(r => r.ruleId === 'SEO_H1_MISSING');
    expect(missingExec?.outcome).toBe('CLEAN');

    const multipleExec = res.ruleExecutions?.find(r => r.ruleId === 'SEO_H1_MULTIPLE');
    expect(multipleExec?.outcome).toBe('CLEAN');
  });

  it('h1Count > 1: marks SEO_H1_MISSING as CLEAN and emits SEO_H1_MULTIPLE WITH_FINDINGS', () => {
    const page = makePageWithHeadings([
      { level: 1, text: 'First H1' },
      { level: 1, text: 'Second H1' },
    ]);
    const res = analyzer.analyzePage(page, { authorizedOrigin: 'https://example.com', entryUrl: 'https://example.com' });

    expect(res.findings.some(f => f.ruleId === 'SEO_H1_MISSING')).toBe(false);
    expect(res.findings.some(f => f.ruleId === 'SEO_H1_MULTIPLE')).toBe(true);

    const missingExec = res.ruleExecutions?.find(r => r.ruleId === 'SEO_H1_MISSING');
    expect(missingExec?.outcome).toBe('CLEAN');

    const multipleExec = res.ruleExecutions?.find(r => r.ruleId === 'SEO_H1_MULTIPLE');
    expect(multipleExec?.outcome).toBe('WITH_FINDINGS');
  });
});
