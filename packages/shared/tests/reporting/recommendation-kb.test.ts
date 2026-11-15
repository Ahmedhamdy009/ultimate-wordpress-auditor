import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LABELS_I18N,
  CAUSE_CONFIDENCE_LABELS_I18N,
  CONFIDENCE_BAND_LABELS_I18N,
  DIMENSION_LABELS_I18N,
  DIMENSION_STATUS_LABELS_I18N,
  FINDING_CATEGORIES,
  getAllRecommendationEntries,
  getLocaleDirection,
  getRecommendationById,
  getTranslatedLabel,
  HEALTH_BAND_LABELS_I18N,
  lookupRecommendationByRuleId,
  normalizeReportLocale,
  normalizeReportViewMode,
  RecommendationEntrySchema,
  resolveBilingualText,
  SEVERITY_LABELS_I18N,
  STATUS_LABELS_I18N,
  UI_LABELS,
  UNKNOWN_RULE_FALLBACK_ENTRY,
  validateRecommendationKnowledgeBase,
} from '../../src/index.js';

function collectScannerRuleIds(): string[] {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, '../../../..');
  const roots = [
    path.join(repoRoot, 'apps', 'desktop', 'src', 'main', 'scanner'),
    path.join(repoRoot, 'apps', 'desktop', 'src', 'main', 'browser'),
  ];

  const ruleIds = new Set<string>();
  const prefixPattern =
    /^(CONTENT_|HTTP_|NET_|PERF_|RESPONSIVE_|SEC_|SEO_|SYS_|WP_|JS_|BROWSER_|CONSOLE_|RUNTIME_|LAYOUT_|CLS_|A11Y_)/;

  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (fullPath.endsWith('.ts') && !fullPath.endsWith('.test.ts')) {
        const text = fs.readFileSync(fullPath, 'utf8');
        for (const match of text.matchAll(/['"`]([A-Z][A-Z0-9_]{3,})['"`]/g)) {
          const candidate = match[1];
          if (prefixPattern.test(candidate) && !candidate.endsWith('_')) {
            ruleIds.add(candidate);
          }
        }
      }
    }
  };

  for (const r of roots) walk(r);
  return [...ruleIds].sort();
}

describe('Recommendation Knowledge Base & Bilingual Localization Dictionary', () => {
  it('validates all KB entries against RecommendationEntrySchema with zero duplicates', () => {
    const stats = validateRecommendationKnowledgeBase();
    expect(stats.valid).toBe(true);
    expect(stats.entryCount).toBeGreaterThan(50);
    expect(stats.exactRuleCount).toBeGreaterThanOrEqual(135);
    expect(stats.prefixPatternCount).toBeGreaterThanOrEqual(3);

    for (const entry of getAllRecommendationEntries()) {
      expect(() => RecommendationEntrySchema.parse(entry)).not.toThrow();
      expect(getRecommendationById(entry.recommendationId)?.recommendationId).toBe(
        entry.recommendationId,
      );
      expect(entry.remediationSteps.length).toBeGreaterThanOrEqual(1);
      expect(entry.verificationSteps.length).toBeGreaterThanOrEqual(1);
      expect(entry.limitations.length).toBeGreaterThanOrEqual(1);
    }
    expect(() => RecommendationEntrySchema.parse(UNKNOWN_RULE_FALLBACK_ENTRY)).not.toThrow();
  });

  it('achieves 100% deterministic coverage over all scanner and browser ruleIds', () => {
    const discoveredRules = collectScannerRuleIds();
    expect(discoveredRules.length).toBeGreaterThanOrEqual(135);

    const uncovered: string[] = [];
    for (const ruleId of discoveredRules) {
      const result = lookupRecommendationByRuleId(ruleId);
      if (result.matchType === 'fallback' || result.entry.isFallback) {
        uncovered.push(ruleId);
      }
    }
    expect(uncovered).toEqual([]);
  });

  it('routes dynamic axe-core rule families deterministically with exact priority over prefix', () => {
    const exactContrast = lookupRecommendationByRuleId('a11y-color-contrast');
    expect(exactContrast.matchType).toBe('exact');
    expect(exactContrast.entry.recommendationId).toBe('rec-a11y-color-contrast');

    const dynamicWcag = lookupRecommendationByRuleId('a11y-aria-hidden-focus');
    expect(dynamicWcag.matchType).toBe('prefix');
    expect(dynamicWcag.matchedPattern).toBe('a11y-');
    expect(dynamicWcag.entry.recommendationId).toBe('rec-a11y-wcag-generic');

    const dynamicBestPractice = lookupRecommendationByRuleId('a11y-bp-region');
    expect(dynamicBestPractice.matchType).toBe('prefix');
    expect(dynamicBestPractice.matchedPattern).toBe('a11y-bp-');
    expect(dynamicBestPractice.entry.category).toBe('accessibility-best-practice');

    const dynamicReview = lookupRecommendationByRuleId('a11y-review-color-contrast');
    expect(dynamicReview.matchType).toBe('prefix');
    expect(dynamicReview.matchedPattern).toBe('a11y-review-');
    expect(dynamicReview.entry.causeConfidence).toBe('needs_manual_review');
  });

  it('provides safe fallback for unknown/empty ruleIds without fabricating causes or code examples', () => {
    for (const unknown of ['CUSTOM_UNREGISTERED_999', '', null, undefined]) {
      const res = lookupRecommendationByRuleId(unknown);
      expect(res.matchType).toBe('fallback');
      expect(res.entry.isFallback).toBe(true);
      expect(res.entry.confirmedCauseTemplates).toEqual([]);
      expect(res.entry.codeExamples).toBeUndefined();
    }
  });

  it('never promises automatic fixes or legal WCAG/CrUX/pentest certification in KB or UI disclaimers', () => {
    const serialized = JSON.stringify({
      entries: getAllRecommendationEntries(),
      fallback: UNKNOWN_RULE_FALLBACK_ENTRY,
      ui: UI_LABELS,
    }).toLowerCase();

    expect(serialized).not.toContain('automatically fixed your');
    expect(serialized).not.toContain('100% wcag compliant certified');
    expect(UI_LABELS.readOnlyAuditNotice.en.toLowerCase()).toContain('no automatic changes');
    expect(UI_LABELS.noComplianceCertificationNotice.en.toLowerCase()).toContain(
      'do not constitute legal wcag compliance certification',
    );
  });

  it('covers all 13 canonical finding categories and resolves locales/directions safely', () => {
    for (const cat of FINDING_CATEGORIES) {
      expect(CATEGORY_LABELS_I18N[cat]).toBeDefined();
      expect(CATEGORY_LABELS_I18N[cat].en.length).toBeGreaterThan(0);
      expect(CATEGORY_LABELS_I18N[cat].ar.length).toBeGreaterThan(0);
    }

    for (const dict of [
      UI_LABELS,
      HEALTH_BAND_LABELS_I18N,
      CONFIDENCE_BAND_LABELS_I18N,
      DIMENSION_STATUS_LABELS_I18N,
      DIMENSION_LABELS_I18N,
      SEVERITY_LABELS_I18N,
      STATUS_LABELS_I18N,
      CAUSE_CONFIDENCE_LABELS_I18N,
    ]) {
      for (const [, val] of Object.entries(dict)) {
        expect(val.en.trim().length).toBeGreaterThan(0);
        expect(val.ar.trim().length).toBeGreaterThan(0);
      }
    }

    expect(getLocaleDirection('ar')).toBe('rtl');
    expect(getLocaleDirection('en')).toBe('ltr');
    expect(normalizeReportLocale('ar-EG')).toBe('ar');
    expect(normalizeReportLocale('fr')).toBe('en');
    expect(normalizeReportViewMode('simple')).toBe('simple');
    expect(normalizeReportViewMode('unknown')).toBe('dual');

    const missingTranslation = resolveBilingualText({ en: 'English only' }, 'ar');
    expect(missingTranslation.text).toBe('English only');
    expect(missingTranslation.usedFallback).toBe(true);
    expect(missingTranslation.fallbackReason).toBe('missing_translation');

    const missingKey = getTranslatedLabel({
      key: 'NON_EXISTENT_KEY',
      locale: 'ar',
      fallback: 'Fallback',
    });
    expect(missingKey.text).toBe('Fallback');
    expect(missingKey.usedFallback).toBe(true);
    expect(missingKey.fallbackReason).toBe('missing_key');
  });
});
