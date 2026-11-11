import { describe, it, expect } from 'vitest';
import { HtmlParserEngine } from '../../../src/main/scanner/parser/html-parser.js';
import { QualityContentAnalyzer } from '../../../src/main/scanner/analyzers/quality-content-analyzer.js';
import type { CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('QualityContentAnalyzer', () => {
  const analyzer = new QualityContentAnalyzer();
  const context = {
    authorizedOrigin: 'https://example.com',
    entryUrl: 'https://example.com/',
  };

  const createPage = (html: string): CrawledPageResult => {
    const url = 'https://example.com/page';
    const parsedDoc = HtmlParserEngine.parseHtml(html, url, 'https://example.com');
    return {
      requestedUrl: url,
      finalUrl: url,
      statusCode: 200,
      statusMessage: 'OK',
      headers: {},
      contentType: 'text/html; charset=utf-8',
      isHtml: true,
      durationMs: 80,
      depth: 0,
      parentUrl: null,
      encodedBodyBytes: html.length,
      decompressedBodyBytes: html.length,
      parsedDocument: parsedDoc,
    };
  };

  it('detects empty pages containing zero readable words', () => {
    const html = `<html><head><title>Empty</title></head><body><div></div></body></html>`;
    const res = analyzer.analyzePage(createPage(html), context);

    const emptyFinding = res.findings.find(f => f.ruleId === 'CONTENT_EMPTY_PAGE');
    expect(emptyFinding).toBeDefined();
    expect(emptyFinding?.severity).toBe('medium');
    expect(res.data.wordCount).toBe(0);
  });

  it('detects thin text content under configured threshold', () => {
    const html = `
      <html>
      <head><title>Brief</title></head>
      <body>
        <h1>Brief Summary</h1>
        <p><a href="/link1">Short link</a> <a href="/link2">Another link</a></p>
      </body>
      </html>
    `;
    const res = analyzer.analyzePage(createPage(html), context);

    const thinFinding = res.findings.find(f => f.ruleId === 'CONTENT_THIN_TEXT');
    expect(thinFinding).toBeDefined();
    expect(thinFinding?.severity).toBe('low');
    expect(res.data.wordCount).toBeLessThan(100);
  });

  it('detects empty anchor links and empty form buttons', () => {
    const html = `
      <html>
      <head><title>Buttons and Links</title></head>
      <body>
        <h1>Navigation</h1>
        <a href="/target1">Valid Link</a>
        <a href="/target2">   </a>
        <a href="/target3"></a>
        <form action="/submit" method="post">
          <button type="submit">Submit</button>
          <button type="button"></button>
        </form>
      </body>
      </html>
    `;
    const res = analyzer.analyzePage(createPage(html), context);

    const emptyLink = res.findings.find(f => f.ruleId === 'CONTENT_EMPTY_LINK');
    expect(emptyLink).toBeDefined();
    expect(emptyLink?.evidence).toMatchObject({ emptyLinksCount: 2 });

    const emptyButton = res.findings.find(f => f.ruleId === 'CONTENT_EMPTY_BUTTON');
    expect(emptyButton).toBeDefined();
    expect(emptyButton?.evidence).toMatchObject({ emptyButtonsCount: 1 });
  });

  it('detects high link density on link-heavy directory pages', () => {
    // Generate page where virtually all text is in links
    const links = Array.from(
      { length: 40 },
      (_, i) => `<a href="/item-${i}">Directory Item Number ${i}</a>`,
    ).join(' ');
    const html = `
      <html>
      <head><title>Directory</title></head>
      <body>
        ${links}
      </body>
      </html>
    `;
    const res = analyzer.analyzePage(createPage(html), context);

    const densityFinding = res.findings.find(f => f.ruleId === 'CONTENT_HIGH_LINK_DENSITY');
    expect(densityFinding).toBeDefined();
    expect(res.data.linkDensityPercent).toBeGreaterThanOrEqual(70);
  });

  it('detects repetitive heading patterns', () => {
    const html = `
      <html>
      <head><title>Repetitive Headings</title></head>
      <body>
        <h1>Product Overview</h1>
        <h2>Features</h2>
        <p>Details 1</p>
        <h2>Features</h2>
        <p>Details 2</p>
        <h2>Features</h2>
        <p>Details 3</p>
      </body>
      </html>
    `;
    const res = analyzer.analyzePage(createPage(html), context);

    const repeatedFinding = res.findings.find(f => f.ruleId === 'CONTENT_REPEATED_HEADINGS');
    expect(repeatedFinding).toBeDefined();
    expect(res.data.repeatedHeadingsCount).toBeGreaterThanOrEqual(1);
  });

  it('counts visible paragraph prose so substantive editorial articles are NOT false-flagged as thin text or high link density', () => {
    const navLinks = Array.from(
      { length: 20 },
      (_, i) => `<a href="/nav-${i}">Menu Item ${i}</a>`,
    ).join(' ');
    const articleParagraph = Array.from(
      { length: 30 },
      (_, i) =>
        `Architectural engineering paragraph sentence number ${i} discussing layout stability.`,
    ).join(' ');
    const html = `
      <html>
      <head><title>Deep Article</title></head>
      <body>
        <nav>${navLinks}</nav>
        <main>
          <h1>Enterprise WordPress Architecture</h1>
          <p>${articleParagraph}</p>
        </main>
        <script>const hiddenVar = "ignored words in script";</script>
      </body>
      </html>
    `;
    const res = analyzer.analyzePage(createPage(html), context);

    expect(res.data.wordCount).toBeGreaterThan(200);
    expect(res.data.linkDensityPercent).toBeLessThan(35);
    expect(res.findings.find(f => f.ruleId === 'CONTENT_THIN_TEXT')).toBeUndefined();
    expect(res.findings.find(f => f.ruleId === 'CONTENT_HIGH_LINK_DENSITY')).toBeUndefined();
  });
});
