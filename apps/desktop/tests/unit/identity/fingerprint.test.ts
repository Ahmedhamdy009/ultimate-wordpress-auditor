import { describe, it, expect } from 'vitest';
import {
  computeFindingIdentity,
  extractElementLocator,
  isStableHtmlId,
  SITE_LEVEL_RULE_IDS,
  PAGE_SINGLETON_RULE_IDS,
  TIER3_AGGREGATE_RULE_IDS,
} from '@auditor/shared';

describe('Finding Fingerprint & Identity Engine', () => {
  describe('Stable HTML ID Heuristic', () => {
    it('accepts semantic, stable element IDs', () => {
      expect(isStableHtmlId('main-content')).toBe(true);
      expect(isStableHtmlId('site-header')).toBe(true);
      expect(isStableHtmlId('primary-navigation')).toBe(true);
      expect(isStableHtmlId('login_form')).toBe(true);
      expect(isStableHtmlId('email')).toBe(true);
    });

    it('rejects dynamic framework IDs with generated hashes or numbers', () => {
      expect(isStableHtmlId('ember123')).toBe(false);
      expect(isStableHtmlId('react-aria-9876543210')).toBe(false);
      expect(isStableHtmlId('uid-abc1234567')).toBe(false);
      expect(isStableHtmlId('guid-4f9e8a7b6c5d4e3f')).toBe(false);
      expect(isStableHtmlId('gen-12345')).toBe(false);
      expect(isStableHtmlId('a1b2c3d4e5f60718')).toBe(false);
    });
  });

  describe('extractElementLocator', () => {
    it('prefers stable HTML ID when present in selector', () => {
      const res = extractElementLocator({ selector: '#main-content > div' });
      expect(res.semanticLocator).toBe('id:main-content');
      expect(res.signatureBasis).toBe('stable_element_id');
    });

    it('falls back to structural selector when ID is dynamic', () => {
      const res = extractElementLocator({ selector: '#ember123 > form > input' });
      expect(res.semanticLocator).toBeNull();
      expect(res.positionalLocator).toBe('#ember123 > form > input');
      expect(res.signatureBasis).toBe('positional_css_selector');
    });

    it('extracts input name attribute as semantic locator', () => {
      const res = extractElementLocator({ selector: 'input[name="user_email"]' });
      expect(res.semanticLocator).toBe('name:user_email');
      expect(res.signatureBasis).toBe('named_element_selector');
    });

    it('extracts named property from evidence', () => {
      const res = extractElementLocator({ propertyName: 'og:title' });
      expect(res.semanticLocator).toBe('prop:og:title');
      expect(res.signatureBasis).toBe('named_schema_property');
    });
  });

  describe('computeFindingIdentity', () => {
    it('computes Tier 1 Site-level singleton fingerprint based on origin', () => {
      const ruleId = Array.from(SITE_LEVEL_RULE_IDS)[0]; // e.g. SEC_ROBOTS_TXT_MISSING
      const res1 = computeFindingIdentity({
        ruleId,
        category: 'security',
        targetUrl: 'https://example.com/blog/article-1',
      });
      const res2 = computeFindingIdentity({
        ruleId,
        category: 'security',
        targetUrl: 'https://example.com/about/team',
      });

      expect(res1.tier).toBe('tier1_semantic');
      expect(res1.matchConfidence).toBe(1.0);
      expect(res1.signatureBasis).toBe('site_level_singleton');
      expect(res1.canonicalLocator).toBe('https://example.com');
      // Both URLs share the same origin, so site-level singletons produce the EXACT same fingerprint
      expect(res1.fingerprint).toBe(res2.fingerprint);
    });

    it('computes Tier 1 Page-level singleton fingerprint based on normalized page URL', () => {
      const ruleId = Array.from(PAGE_SINGLETON_RULE_IDS)[0]; // e.g. SEO_TITLE_MISSING
      const res1 = computeFindingIdentity({
        ruleId,
        category: 'seo',
        targetUrl: 'https://example.com/landing?utm_source=test#frag1',
      });
      const res2 = computeFindingIdentity({
        ruleId,
        category: 'seo',
        targetUrl: 'https://example.com/landing?utm_source=test#frag2',
      });

      expect(res1.tier).toBe('tier1_semantic');
      expect(res1.matchConfidence).toBe(1.0);
      expect(res1.signatureBasis).toBe('page_level_singleton');
      // Fragment stripped, normalized URL matches
      expect(res1.fingerprint).toBe(res2.fingerprint);
    });

    it('computes Tier 1 Element Semantic Identity when stable locator exists', () => {
      const res = computeFindingIdentity({
        ruleId: 'A11Y_MISSING_ALT',
        category: 'accessibility',
        targetUrl: 'https://example.com/page',
        evidence: { selector: '#hero-banner > img' },
      });

      expect(res.tier).toBe('tier1_semantic');
      expect(res.canonicalLocator).toBe('id:hero-banner');
      expect(res.matchConfidence).toBe(1.0);
    });

    it('computes Tier 2 Positional Identity when only structural selector exists', () => {
      const res = computeFindingIdentity({
        ruleId: 'A11Y_COLOR_CONTRAST',
        category: 'accessibility',
        targetUrl: 'https://example.com/page',
        evidence: { selector: 'body > main > section:nth-child(2) > p' },
      });

      expect(res.tier).toBe('tier2_positional');
      expect(res.matchConfidence).toBe(0.7);
      expect(res.canonicalLocator).toBe('body > main > section:nth-child(2) > p');
    });

    it('computes Tier 3 Aggregate Identity for designated aggregate rules or unlocated findings', () => {
      const ruleId = Array.from(TIER3_AGGREGATE_RULE_IDS)[0]; // e.g. A11Y_EMPTY_HEADING
      const res = computeFindingIdentity({
        ruleId,
        category: 'accessibility',
        targetUrl: 'https://example.com/page',
      });

      expect(res.tier).toBe('tier3_aggregate');
      expect(res.matchConfidence).toBe(0.5);
      expect(res.signatureBasis).toBe('aggregate_occurrence_group');
      expect(res.aggregateGroupKey).toBe(`https://example.com/page::${ruleId}`);
    });
  });
});
