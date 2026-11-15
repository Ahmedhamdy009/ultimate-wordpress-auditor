import { describe, expect, it } from 'vitest';
import {
  extractExactAffectedLocation,
  matchAndEnrichFindings,
  redactSensitiveText,
  selectEvidenceGatedCodeExamples,
  selectEvidenceGatedPlatformGuidance,
  type EnrichableFindingInput,
  type PlatformGuidanceTemplate,
} from '../../src/index.js';

describe('Evidence-Gated Matching, Enrichment, Redaction & Deduplication', () => {
  it('suppresses WordPress/Elementor/WooCommerce guidance on non-WordPress sites and gates by detected stack', () => {
    const nonWpFinding: EnrichableFindingInput = {
      id: 'f-1',
      ruleId: 'SEO_TITLE_MISSING',
      category: 'technical-seo',
      severity: 'high',
      confidence: 'confirmed',
      status: 'confirmed',
      targetUrl: 'https://static-site.example.com/pricing',
    };

    const nonWpRes = matchAndEnrichFindings([nonWpFinding], {
      sitePlatformType: 'generic',
    });
    expect(nonWpRes.detectedStack.isWordPress).toBe(false);
    expect(nonWpRes.items[0].platformGuidance).toEqual([]);

    const wpSignalFinding: EnrichableFindingInput = {
      id: 'f-wp',
      ruleId: 'WP_DETECTED',
      category: 'wordpress',
      severity: 'info',
      confidence: 'confirmed',
      status: 'confirmed',
      targetUrl: 'https://wp-shop.example.com/',
      evidence: {
        confidence: 'confirmed',
        version: '6.7.1',
        plugins: ['elementor', 'woocommerce'],
        themes: ['hello-elementor'],
      },
    };
    const h1Missing: EnrichableFindingInput = {
      id: 'f-h1',
      ruleId: 'SEO_H1_MISSING',
      category: 'content-structure',
      severity: 'medium',
      confidence: 'confirmed',
      status: 'confirmed',
      targetUrl: 'https://wp-shop.example.com/shop',
    };

    const wpRes = matchAndEnrichFindings([wpSignalFinding, h1Missing], {
      sitePlatformType: 'wordpress',
    });
    expect(wpRes.detectedStack.isWordPress).toBe(true);
    expect(wpRes.detectedStack.isElementor).toBe(true);
    expect(wpRes.detectedStack.isElementorPro).toBe(false);
    expect(wpRes.detectedStack.isWooCommerce).toBe(true);

    const h1Enriched = wpRes.items.find(i => i.ruleId === 'SEO_H1_MISSING');
    expect(h1Enriched?.platformGuidance.some(p => p.platform === 'elementor')).toBe(true);
  });

  it('strictly distinguishes Elementor Free from Elementor Pro and gates CDN hints on response headers', () => {
    const proOnlyTemplates: PlatformGuidanceTemplate[] = [
      {
        platform: 'elementor',
        requiredEvidenceNote: { en: 'Elementor base detected', ar: 'Elementor مكتشف' },
        summary: {
          simple: { en: 'Check Elementor layout', ar: 'راجع التخطيط' },
          technical: { en: 'Check Elementor container settings', ar: 'راجع حاويات Elementor' },
        },
        steps: [{ en: 'Edit responsive padding', ar: 'عدّل الهوامش المتجاوبة' }],
      },
      {
        platform: 'elementor_pro',
        requiredEvidenceNote: { en: 'Elementor Pro detected', ar: 'Elementor Pro مكتشف' },
        summary: {
          simple: { en: 'Check Elementor Pro Theme Builder', ar: 'راجع منشئ القوالب Pro' },
          technical: { en: 'Check Elementor Pro custom CSS', ar: 'راجع CSS المخصص في Pro' },
        },
        steps: [{ en: 'Inspect Theme Builder header condition', ar: 'افحص شروط الترويسة' }],
      },
      {
        platform: 'cdn_cache',
        requiredEvidenceNote: { en: 'CDN headers detected', ar: 'ترويسات CDN مكتشفة' },
        summary: {
          simple: { en: 'Inspect CDN cache', ar: 'راجع تخزين CDN' },
          technical: { en: 'Inspect CDN edge cache headers', ar: 'راجع ترويسات حافة CDN' },
        },
        steps: [{ en: 'Check cache hit header', ar: 'افحص حالة الكاش' }],
      },
    ];

    const freeStack = matchAndEnrichFindings([
      {
        id: '1',
        ruleId: 'WP_DETECTED',
        severity: 'info',
        confidence: 'confirmed',
        targetUrl: 'https://example.com/',
        evidence: { confidence: 'confirmed', plugins: ['elementor'] },
      },
    ]).detectedStack;

    const freeSelected = selectEvidenceGatedPlatformGuidance(proOnlyTemplates, freeStack, []);
    expect(freeSelected.map(s => s.platform)).toEqual(['elementor']);

    const proWithCdnStack = matchAndEnrichFindings([
      {
        id: '2',
        ruleId: 'PERF_SLOW_SERVER_RESPONSE',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com/wp-content/plugins/elementor-pro/assets/js/frontend.min.js',
        evidence: { headers: { 'cf-ray': '12345-CAI', 'x-litespeed-cache': 'miss' } },
      },
    ]).detectedStack;

    const proSelected = selectEvidenceGatedPlatformGuidance(proOnlyTemplates, proWithCdnStack, []);
    expect(proSelected.map(s => s.platform)).toEqual(['elementor', 'elementor_pro', 'cdn_cache']);
  });

  it('never upgrades severity/confidence or emits confirmedCauses for potential/manual-review findings', () => {
    const potentialFinding: EnrichableFindingInput = {
      id: 'pot-1',
      ruleId: 'SEC_HEADER_HSTS_MISSING', // KB entry has causeConfidence: 'confirmed'
      category: 'security',
      severity: 'low',
      confidence: 'potential',
      status: 'potential',
      targetUrl: 'https://example.com/',
    };
    const manualReviewFinding: EnrichableFindingInput = {
      id: 'rev-1',
      ruleId: 'a11y-color-contrast',
      category: 'accessibility',
      severity: 'medium',
      confidence: 'potential',
      status: 'needs_manual_review',
      targetUrl: 'https://example.com/',
    };

    const snapshot = structuredClone(potentialFinding);
    const res = matchAndEnrichFindings([potentialFinding, manualReviewFinding]);

    // Caller object strictly unmutated
    expect(potentialFinding).toEqual(snapshot);

    const hsts = res.items.find(i => i.ruleId === 'SEC_HEADER_HSTS_MISSING')!;
    expect(hsts.severity).toBe('low');
    expect(hsts.originalConfidence).toBe('potential');
    expect(hsts.effectiveCauseConfidence).toBe('potential');
    expect(hsts.confirmedCauses).toEqual([]);
    expect(hsts.possibleCauses.length).toBeGreaterThan(0);

    const rev = res.items.find(i => i.ruleId === 'a11y-color-contrast')!;
    expect(rev.effectiveCauseConfidence).toBe('needs_manual_review');
    expect(rev.confirmedCauses).toEqual([]);
    expect(rev.possibleCauses.length).toBeGreaterThan(0);
  });

  it('extracts exact DOM selectors, CLS nodes, runtime file:line, and provides document-level fallback', () => {
    const withSelectors = extractExactAffectedLocation([
      {
        targetUrl: 'https://example.com/cart',
        evidence: {
          nodes: [{ target: ['#checkout-btn', '.btn-submit'] }],
          sources: [{ node: 'div.promo-banner' }],
          location: { url: 'https://example.com/app.js', lineNumber: 42, columnNumber: 9 },
          headerName: 'Set-Cookie',
        },
      },
    ]);
    expect(withSelectors.hasSpecificDomSelector).toBe(true);
    expect(withSelectors.selectors).toEqual(['#checkout-btn', '.btn-submit', 'div.promo-banner']);
    expect(withSelectors.sourceLocations).toEqual(['https://example.com/app.js:42:9']);
    expect(withSelectors.headerNames).toEqual(['Set-Cookie']);
    expect(withSelectors.fallbackNotice).toBeNull();

    const docOnly = extractExactAffectedLocation([
      {
        targetUrl: 'https://example.com/about',
        evidence: { statusCode: 200 },
      },
    ]);
    expect(docOnly.hasSpecificDomSelector).toBe(false);
    expect(docOnly.hasSpecificAssetOrHeaderLocator).toBe(false);
    expect(docOnly.fallbackNotice?.en).toContain('URL / Document-level observation');
  });

  it('redacts tokens, URL passwords, JWTs, and Set-Cookie secrets in locations and preserved evidence', () => {
    const raw =
      'https://admin:s3cr3t@example.com/callback?token=abc123xyz&ok=1 Authorization: Bearer my_secret_bearer_token Set-Cookie: wp_session=TOP_SECRET_VALUE; Secure; HttpOnly eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sig1234';
    const clean = redactSensitiveText(raw);
    expect(clean).not.toContain('s3cr3t');
    expect(clean).not.toContain('abc123xyz');
    expect(clean).not.toContain('my_secret_bearer_token');
    expect(clean).not.toContain('TOP_SECRET_VALUE');
    expect(clean).not.toContain('eyJhbGciOi');
    expect(clean).toContain('Set-Cookie: wp_session=<redacted>');
    expect(clean).toContain('ok=1');

    const enriched = matchAndEnrichFindings([
      {
        id: 'sec-1',
        ruleId: 'SEC_COOKIE_INSECURE',
        severity: 'high',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://example.com/login?api_key=leak999',
        evidence: {
          cookieName: 'session_id',
          rawSetCookie: 'Set-Cookie: session_id=VERY_SECRET_COOKIE; Path=/',
          apiToken: 'sk_live_verysecretkey123456',
        },
      },
    ]);
    const item = enriched.items[0];
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain('leak999');
    expect(serialized).not.toContain('VERY_SECRET_COOKIE');
    expect(serialized).not.toContain('sk_live_verysecretkey123456');
    expect(item.exactLocation.headerNames).toEqual(['session_id']);
  });

  it('deduplicates repeated multi-page occurrences deterministically while preserving all IDs & URLs', () => {
    const f1: EnrichableFindingInput = {
      id: 'id-b',
      ruleId: 'SEO_DESCRIPTION_MISSING',
      category: 'technical-seo',
      severity: 'medium',
      confidence: 'confirmed',
      status: 'confirmed',
      targetUrl: 'https://example.com/z-page',
    };
    const f2: EnrichableFindingInput = {
      id: 'id-a',
      ruleId: 'SEO_DESCRIPTION_MISSING',
      category: 'technical-seo',
      severity: 'medium',
      confidence: 'confirmed',
      status: 'confirmed',
      targetUrl: 'https://example.com/a-page',
    };

    const run1 = matchAndEnrichFindings([f1, f2]);
    const run2 = matchAndEnrichFindings([f2, f1]);

    expect(run1.items.length).toBe(1);
    expect(run1.deduplicatedCount).toBe(1);
    expect(run1.items[0].occurrenceCount).toBe(2);
    expect(run1.items[0].exactLocation.urls).toEqual([
      'https://example.com/a-page',
      'https://example.com/z-page',
    ]);
    expect(run1.items[0].preservedOriginalFinding.findingIds).toEqual(['id-a', 'id-b']);
    expect(run1.items[0].exactLocation.urls).toEqual(run2.items[0].exactLocation.urls);
    expect(run1.items[0].preservedOriginalFinding.findingIds).toEqual(
      run2.items[0].preservedOriginalFinding.findingIds,
    );
  });

  it('gates code examples strictly on supporting evidence and falls back safely for unknown ruleIds', () => {
    const emptyStack = matchAndEnrichFindings([]).detectedStack;
    const unknownRes = matchAndEnrichFindings([
      {
        id: 'unk-1',
        ruleId: 'FUTURE_UNKNOWN_RULE_777',
        category: 'system',
        severity: 'info',
        confidence: 'firm',
        status: 'active',
        targetUrl: 'https://example.com/',
        description: 'Custom diagnostic message.',
      },
    ]);

    expect(unknownRes.fallbackCount).toBe(1);
    expect(unknownRes.items[0].isFallback).toBe(true);
    expect(unknownRes.items[0].codeExamples).toEqual([]);
    expect(unknownRes.items[0].confirmedCauses).toEqual([]);
    expect(unknownRes.items[0].preservedOriginalFinding.description).toBe(
      'Custom diagnostic message.',
    );

    const gatedPhpExamples = selectEvidenceGatedCodeExamples(
      [
        {
          title: { en: 'WP Snippet', ar: 'مقتطف ووردبريس' },
          language: 'php',
          scopeDisclaimer: { en: 'WP only', ar: 'لووردبريس فقط' },
          requiredEvidenceTag: 'wordpress_core',
          snippet: "remove_action('wp_head', 'wp_generator');",
        },
      ],
      emptyStack,
      'WP_VERSION_DISCLOSED',
      [],
      extractExactAffectedLocation([]),
    );
    expect(gatedPhpExamples).toEqual([]);
  });
});
