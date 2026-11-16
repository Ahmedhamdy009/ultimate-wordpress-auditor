import { describe, expect, it } from 'vitest';
import { HtmlParserEngine } from '../../../src/main/scanner/parser/html-parser.js';
import {
  areHreflangTagsConsistent,
  validateHreflangTag,
} from '../../../src/main/scanner/parser/hreflang-validator.js';

describe('Hreflang Extraction Engine (HtmlParserEngine)', () => {
  const parser = new HtmlParserEngine();
  const pageUrl = 'https://example.com/en/page';
  const authorizedOrigin = 'https://example.com';

  it('extracts basic rel="alternate" hreflang links', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <link rel="alternate" hreflang="en" href="https://example.com/en/page" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar/page" />
        <link rel="alternate" hreflang="x-default" href="https://example.com/page" />
      </head>
      <body><h1>Content</h1></body>
      </html>
    `;

    const doc = parser.parse(html, pageUrl, authorizedOrigin);
    expect(doc.hreflangs).toBeDefined();
    expect(doc.hreflangs).toHaveLength(3);

    const en = doc.hreflangs![0];
    expect(en.hreflang).toBe('en');
    expect(en.normalizedHreflang).toBe('en');
    expect(en.resolvedUrl).toBe('https://example.com/en/page');
    expect(en.isSelfReference).toBe(true);

    const ar = doc.hreflangs![1];
    expect(ar.hreflang).toBe('ar');
    expect(ar.normalizedHreflang).toBe('ar');
    expect(ar.resolvedUrl).toBe('https://example.com/ar/page');
    expect(ar.isSelfReference).toBe(false);

    const xDef = doc.hreflangs![2];
    expect(xDef.hreflang).toBe('x-default');
    expect(xDef.normalizedHreflang).toBe('x-default');
    expect(xDef.resolvedUrl).toBe('https://example.com/page');
    expect(xDef.isSelfReference).toBe(false);
  });

  it('handles attribute order variations, mixed cases, and whitespace', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <link href="/es/page" hreflang="  es-ES  " rel="alternate" />
        <LINK HREFLANG="FR-CA" REL="ALTERNATE" HREF="/fr/page" />
        <link rel="alternate" href="/de/page" hreflang="de" />
      </head>
      <body></body>
      </html>
    `;

    const doc = parser.parse(html, pageUrl, authorizedOrigin);
    expect(doc.hreflangs).toBeDefined();
    expect(doc.hreflangs).toHaveLength(3);

    expect(doc.hreflangs![0].hreflang).toBe('es-ES');
    expect(doc.hreflangs![0].normalizedHreflang).toBe('es-es');
    expect(doc.hreflangs![0].resolvedUrl).toBe('https://example.com/es/page');

    expect(doc.hreflangs![1].hreflang).toBe('FR-CA');
    expect(doc.hreflangs![1].normalizedHreflang).toBe('fr-ca');
    expect(doc.hreflangs![1].resolvedUrl).toBe('https://example.com/fr/page');

    expect(doc.hreflangs![2].hreflang).toBe('de');
    expect(doc.hreflangs![2].normalizedHreflang).toBe('de');
    expect(doc.hreflangs![2].resolvedUrl).toBe('https://example.com/de/page');
  });

  it('correctly resolves relative href URLs against base page URL', () => {
    const html = `
      <head>
        <link rel="alternate" hreflang="en-GB" href="../uk/index.html" />
        <link rel="alternate" hreflang="ar-SA" href="/ar-sa/" />
      </head>
    `;

    const doc = parser.parse(html, 'https://example.com/intl/en/', authorizedOrigin);
    expect(doc.hreflangs).toBeDefined();
    expect(doc.hreflangs![0].resolvedUrl).toBe('https://example.com/intl/uk/index.html');
    expect(doc.hreflangs![1].resolvedUrl).toBe('https://example.com/ar-sa/');
  });

  it('detects self-reference with and without trailing slashes', () => {
    const html = `
      <head>
        <link rel="alternate" hreflang="en" href="https://example.com/en/page/" />
      </head>
    `;

    const doc = parser.parse(html, 'https://example.com/en/page', authorizedOrigin);
    expect(doc.hreflangs![0].isSelfReference).toBe(true);
  });

  it('ignores alternate links that do not have hreflang attributes (e.g. RSS/Atom feeds, stylesheets)', () => {
    const html = `
      <head>
        <link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml" />
        <link rel="alternate" type="application/atom+xml" title="Atom" href="/atom.xml" />
        <link rel="alternate stylesheet" title="Dark Theme" href="/dark.css" />
        <link rel="stylesheet" hreflang="en" href="/style.css" />
      </head>
    `;

    const doc = parser.parse(html, pageUrl, authorizedOrigin);
    expect(doc.hreflangs).toBeUndefined();
  });

  it('bounds extracted hreflang annotations to maxHreflangs', () => {
    const links = Array.from(
      { length: 60 },
      (_, i) => `<link rel="alternate" hreflang="lang-${i}" href="/page-${i}" />`,
    ).join('\n');
    const html = `<head>${links}</head>`;

    const customParser = new HtmlParserEngine({ maxHreflangs: 10 });
    const doc = customParser.parse(html, pageUrl, authorizedOrigin);
    expect(doc.hreflangs).toHaveLength(10);
  });
});

describe('Hreflang BCP 47 Validator (validateHreflangTag)', () => {
  it('validates valid standard ISO language codes', () => {
    expect(validateHreflangTag('en').valid).toBe(true);
    expect(validateHreflangTag('ar').valid).toBe(true);
    expect(validateHreflangTag('es').valid).toBe(true);
    expect(validateHreflangTag('de').valid).toBe(true);
    expect(validateHreflangTag('fr').valid).toBe(true);
    expect(validateHreflangTag('zh').valid).toBe(true);
  });

  it('validates language-region combinations', () => {
    const resEnUs = validateHreflangTag('en-US');
    expect(resEnUs.valid).toBe(true);
    expect(resEnUs.language).toBe('en');
    expect(resEnUs.region).toBe('US');

    const resArEg = validateHreflangTag('ar-EG');
    expect(resArEg.valid).toBe(true);
    expect(resArEg.language).toBe('ar');
    expect(resArEg.region).toBe('EG');

    const resPtBr = validateHreflangTag('pt-BR');
    expect(resPtBr.valid).toBe(true);
    expect(resPtBr.region).toBe('BR');
  });

  it('validates UN M.49 3-digit regional codes (e.g. es-419 for Latin America)', () => {
    const res = validateHreflangTag('es-419');
    expect(res.valid).toBe(true);
    expect(res.language).toBe('es');
    expect(res.region).toBe('419');
  });

  it('validates script subtags (e.g. zh-Hant, zh-Hans)', () => {
    const res = validateHreflangTag('zh-Hant');
    expect(res.valid).toBe(true);
    expect(res.language).toBe('zh');
    expect(res.script).toBe('Hant');
  });

  it('validates language + script + region (e.g. zh-Hans-CN)', () => {
    const res = validateHreflangTag('zh-Hans-CN');
    expect(res.valid).toBe(true);
    expect(res.language).toBe('zh');
    expect(res.script).toBe('Hans');
    expect(res.region).toBe('CN');
  });

  it('validates x-default special value case-insensitively', () => {
    expect(validateHreflangTag('x-default').valid).toBe(true);
    expect(validateHreflangTag('x-default').isXDefault).toBe(true);
    expect(validateHreflangTag('X-DEFAULT').valid).toBe(true);
  });

  it('rejects underscores with clear BCP 47 explanation (e.g. en_US, ar_EG)', () => {
    const resEn = validateHreflangTag('en_US');
    expect(resEn.valid).toBe(false);
    expect(resEn.reason).toContain('BCP 47 requires hyphens (-) instead of underscores (_)');

    const resAr = validateHreflangTag('ar_EG');
    expect(resAr.valid).toBe(false);
    expect(resAr.reason).toContain('BCP 47 requires hyphens');
  });

  it('rejects numeric or invalid primary language tags', () => {
    expect(validateHreflangTag('123').valid).toBe(false);
    expect(validateHreflangTag('a').valid).toBe(false);
    expect(validateHreflangTag('toolonglanguagecode').valid).toBe(false);
    expect(validateHreflangTag('und').valid).toBe(false);
  });

  it('rejects empty, null, and whitespace-only tags', () => {
    expect(validateHreflangTag('').valid).toBe(false);
    expect(validateHreflangTag('   ').valid).toBe(false);
    expect(validateHreflangTag(null).valid).toBe(false);
    expect(validateHreflangTag(undefined).valid).toBe(false);
  });

  it('verifies language tag semantic consistency', () => {
    expect(areHreflangTagsConsistent('en', 'en-US')).toBe(true);
    expect(areHreflangTagsConsistent('en-US', 'en-GB')).toBe(true);
    expect(areHreflangTagsConsistent('ar', 'ar-EG')).toBe(true);
    expect(areHreflangTagsConsistent('x-default', 'en')).toBe(true);
    expect(areHreflangTagsConsistent('en', 'ar')).toBe(false);
    expect(areHreflangTagsConsistent('en', 'fr')).toBe(false);
  });
});
