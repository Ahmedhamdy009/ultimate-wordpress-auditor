import { describe, it, expect } from 'vitest';
import {
  AccessibilityAnalyzer,
  mapAxeImpactToSeverity,
  extractWcagCriteria,
  isBestPracticeOnly,
} from '../../src/main/browser/accessibility-analyzer.js';
import {
  DEFAULT_WCAG_TAGS,
  BEST_PRACTICE_TAG,
  SUPPORTED_WCAG_TAGS,
} from '../../src/main/browser/accessibility-types.js';

describe('Accessibility Engine — WCAG Tag & Finding Classification Verification', () => {
  it('1. verifies default WCAG tags passed to axe.run include 2.0, 2.1, and 2.2 standards', () => {
    expect(DEFAULT_WCAG_TAGS).toEqual(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
    expect(BEST_PRACTICE_TAG).toBe('best-practice');
    expect(SUPPORTED_WCAG_TAGS).toContain('wcag22aa');
  });

  it('2. verifies confirmed WCAG violation produces confirmed status and confirmed confidence', () => {
    const analyzer = new AccessibilityAnalyzer();
    const result = analyzer.analyze({
      pageUrl: 'http://audit.test/page',
      rawResults: {
        violations: [
          {
            id: 'image-alt',
            description: 'Images must have alternate text',
            help: 'Images must have alternate text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
            impact: 'critical',
            tags: ['cat.text-alternatives', 'wcag2a', 'wcag111'],
            nodes: [
              {
                html: '<img src="/photo.jpg">',
                target: ['#photo'],
                impact: 'critical',
                failureSummary: 'Fix: Element does not have an alt attribute',
              },
            ],
          },
        ],
        incomplete: [],
        passes: [],
        inapplicable: [],
      },
    });

    expect(result.metrics.violationsCount).toBe(1);
    expect(result.metrics.criticalCount).toBe(1);
    expect(result.violations.length).toBe(1);

    const finding = result.findings[0];
    expect(finding.ruleId).toBe('a11y-image-alt');
    expect(finding.category).toBe('accessibility');
    expect(finding.status).toBe('confirmed');
    expect(finding.confidence).toBe('confirmed');
    expect(finding.severity).toBe('critical');
    expect(finding.references).toContain('WCAG 1.1.1 Non-text Content (Level A)');
  });

  it('3. verifies best-practice rule is distinctly classified as accessibility-best-practice', () => {
    const analyzer = new AccessibilityAnalyzer();
    const result = analyzer.analyze({
      pageUrl: 'http://audit.test/page',
      rawResults: {
        violations: [
          {
            id: 'heading-order',
            description: 'Ensure the order of headings is semantically correct',
            help: 'Heading levels should only increase by one',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/heading-order',
            impact: 'moderate',
            tags: ['cat.semantics', 'best-practice'],
            nodes: [
              {
                html: '<h4>Skipped level</h4>',
                target: ['h4'],
                impact: 'moderate',
                failureSummary: 'Fix: Heading order invalid',
              },
            ],
          },
        ],
        incomplete: [],
        passes: [],
        inapplicable: [],
      },
    });

    expect(isBestPracticeOnly(['cat.semantics', 'best-practice'])).toBe(true);
    expect(isBestPracticeOnly(['wcag2a', 'best-practice'])).toBe(false);

    const finding = result.findings[0];
    expect(finding.ruleId).toBe('a11y-bp-heading-order');
    expect(finding.category).toBe('accessibility-best-practice');
    expect(finding.severity).toBe('medium');
    expect(finding.status).toBe('confirmed');
  });

  it('4. verifies incomplete/manual-review result never inflates confirmed violations count and assigns needs_manual_review status', () => {
    const analyzer = new AccessibilityAnalyzer();
    const result = analyzer.analyze({
      pageUrl: 'http://audit.test/page',
      rawResults: {
        violations: [],
        incomplete: [
          {
            id: 'color-contrast',
            description: 'Ensure contrast meets thresholds',
            help: 'Elements must meet minimum color contrast ratio thresholds',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/color-contrast',
            impact: 'serious',
            tags: ['cat.color', 'wcag2aa', 'wcag143'],
            nodes: [
              {
                html: '<span class="gradient-text">Gradient text</span>',
                target: ['.gradient-text'],
                impact: 'serious',
                failureSummary: 'Element has a linear gradient background requiring human review',
              },
            ],
          },
        ],
        passes: [],
        inapplicable: [],
      },
    });

    // Zero confirmed violations
    expect(result.metrics.violationsCount).toBe(0);
    expect(result.metrics.seriousCount).toBe(0);
    expect(result.violations.length).toBe(0);

    // Incomplete count tracked separately
    expect(result.metrics.incompleteCount).toBe(1);
    expect(result.incomplete.length).toBe(1);

    const finding = result.findings[0];
    expect(finding.ruleId).toBe('a11y-review-color-contrast');
    expect(finding.category).toBe('accessibility');
    expect(finding.status).toBe('needs_manual_review');
    expect(finding.confidence).toBe('potential');
    expect(finding.severity).toBe('low');
  });

  it('5. verifies undefined or null impact maps safely to low severity and never to high or critical', () => {
    expect(mapAxeImpactToSeverity(undefined)).toBe('low');
    expect(mapAxeImpactToSeverity(null)).toBe('low');
    expect(mapAxeImpactToSeverity('minor')).toBe('low');
    expect(mapAxeImpactToSeverity('moderate')).toBe('medium');
    expect(mapAxeImpactToSeverity('serious')).toBe('high');
    expect(mapAxeImpactToSeverity('critical')).toBe('critical');

    const analyzer = new AccessibilityAnalyzer();
    const result = analyzer.analyze({
      pageUrl: 'http://audit.test/page',
      rawResults: {
        violations: [
          {
            id: 'custom-check',
            description: 'Custom check without explicit impact',
            help: 'Ensure compliance',
            helpUrl: 'https://example.com/rules/custom',
            impact: null,
            tags: ['wcag2a'],
            nodes: [
              {
                html: '<div>Unknown</div>',
                target: ['div'],
                impact: null,
              },
            ],
          },
        ],
        incomplete: [],
        passes: [],
        inapplicable: [],
      },
    });

    expect(result.findings[0].severity).toBe('low');
    expect(result.metrics.minorCount).toBe(1);
    expect(result.metrics.criticalCount).toBe(0);
    expect(result.metrics.seriousCount).toBe(0);
  });

  it('6. verifies passing and inapplicable rules increment metrics without generating findings', () => {
    const analyzer = new AccessibilityAnalyzer();
    const result = analyzer.analyze({
      pageUrl: 'http://audit.test/page',
      rawResults: {
        violations: [],
        incomplete: [],
        passes: [
          {
            id: 'image-alt',
            description: 'Images have alt',
            help: 'Images must have alt',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
            tags: ['wcag2a'],
            nodes: [],
          },
          {
            id: 'button-name',
            description: 'Buttons have name',
            help: 'Buttons must have name',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/button-name',
            tags: ['wcag2a'],
            nodes: [],
          },
        ],
        inapplicable: [
          {
            id: 'video-caption',
            description: 'Videos have caption',
            help: 'Videos must have caption',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/video-caption',
            tags: ['wcag2a'],
            nodes: [],
          },
        ],
      },
    });

    expect(result.metrics.passesCount).toBe(2);
    expect(result.metrics.inapplicableCount).toBe(1);
    expect(result.metrics.violationsCount).toBe(0);
    expect(result.findings.length).toBe(0);
  });

  it('7. verifies extractWcagCriteria accurately maps criterion tags', () => {
    const tags = ['wcag111', 'wcag143', 'wcag22aa', 'wcag258', 'wcag412', 'cat.color'];
    const criteria = extractWcagCriteria(tags);

    expect(criteria).toContain('WCAG 1.1.1 Non-text Content (Level A)');
    expect(criteria).toContain('WCAG 1.4.3 Contrast (Minimum) (Level AA)');
    expect(criteria).toContain('WCAG 2.5.8 Target Size (Minimum) (Level AA)');
    expect(criteria).toContain('WCAG 4.1.2 Name, Role, Value (Level A)');
  });
});
