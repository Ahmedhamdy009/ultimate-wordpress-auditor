/**
 * Canonical finding category taxonomy, display labels, and deterministic legacy alias normalization.
 * Keeps stable persisted identifiers strictly separated from human-readable UI/report labels and
 * maps every rule/finding 1:1 without cross-domain duplicate counting.
 */

export const FINDING_CATEGORIES = [
  'accessibility',
  'accessibility-best-practice',
  'security',
  'runtime-network',
  'responsive-design',
  'layout-stability',
  'technical-seo',
  'static-performance',
  'content-quality',
  'dom-quality',
  'content-structure',
  'wordpress',
  'system',
] as const;

export type FindingCategoryId = (typeof FINDING_CATEGORIES)[number];

export interface FindingCategoryDefinition {
  readonly id: FindingCategoryId;
  readonly label: string;
  readonly description: string;
}

export const FINDING_CATEGORY_DEFINITIONS: Readonly<
  Record<FindingCategoryId, FindingCategoryDefinition>
> = Object.freeze({
  accessibility: {
    id: 'accessibility',
    label: 'Accessibility',
    description:
      'WCAG, assistive technology, keyboard, contrast, and semantic interactive element checks.',
  },
  'accessibility-best-practice': {
    id: 'accessibility-best-practice',
    label: 'Accessibility (Best Practices)',
    description: 'Non-WCAG structural and semantic accessibility best-practice recommendations.',
  },
  security: {
    id: 'security',
    label: 'Security',
    description: 'HTTP security headers, transport hardening, TLS posture, and cookie flags.',
  },
  'runtime-network': {
    id: 'runtime-network',
    label: 'Runtime & Network',
    description:
      'JavaScript runtime errors, console errors, failed network requests, and HTTP error statuses.',
  },
  'responsive-design': {
    id: 'responsive-design',
    label: 'Responsive Design',
    description: 'Viewport overflow, element clipping, and responsive sizing checks.',
  },
  'layout-stability': {
    id: 'layout-stability',
    label: 'Layout Stability',
    description: 'Cumulative Layout Shift (CLS) stability measurements.',
  },
  'technical-seo': {
    id: 'technical-seo',
    label: 'Technical SEO',
    description:
      'Metadata, canonicalization, headings, social tags, viewport meta, language, and internal links.',
  },
  'static-performance': {
    id: 'static-performance',
    label: 'Static Performance',
    description:
      'Response latency, HTML payload size, script/stylesheet counts, and explicit image dimensions.',
  },
  'content-quality': {
    id: 'content-quality',
    label: 'Content Quality',
    description: 'Thin content, empty pages, and duplicate title quality checks.',
  },
  'dom-quality': {
    id: 'dom-quality',
    label: 'DOM Quality',
    description: 'Excessive DOM node tree size and structural complexity checks.',
  },
  'content-structure': {
    id: 'content-structure',
    label: 'Content Structure',
    description: 'Link-to-text density and repeated heading structure checks.',
  },
  wordpress: {
    id: 'wordpress',
    label: 'WordPress',
    description:
      'Passive WordPress CMS signals, REST/XML-RPC advertisement, and generator disclosure.',
  },
  system: {
    id: 'system',
    label: 'System',
    description: 'Execution environment and general uncategorized diagnostics.',
  },
});

export const FINDING_CATEGORY_FILTER_ORDER: readonly FindingCategoryDefinition[] =
  FINDING_CATEGORIES.map(id => FINDING_CATEGORY_DEFINITIONS[id]);

const CANONICAL_CATEGORY_SET = new Set<string>(FINDING_CATEGORIES);

const LEGACY_CATEGORY_ALIASES: Readonly<Record<string, FindingCategoryId>> = Object.freeze({
  accessibility: 'accessibility',
  'accessibility-best-practice': 'accessibility-best-practice',
  'accessibility (best practices)': 'accessibility-best-practice',
  'accessibility & quality': 'accessibility',
  'accessibility & seo': 'technical-seo',
  'technical seo & accessibility': 'technical-seo',
  security: 'security',
  'security configuration': 'security',
  'security headers': 'security',
  'transport security': 'security',
  'content security': 'security',
  'http headers': 'security',
  'anti-clickjacking': 'security',
  'information disclosure': 'security',
  'browser feature policy': 'security',
  cryptography: 'security',
  'certificate validation': 'security',
  'cookie security': 'security',
  'runtime-network': 'runtime-network',
  'runtime & network': 'runtime-network',
  'javascript runtime': 'runtime-network',
  'browser console': 'runtime-network',
  'network & connectivity': 'runtime-network',
  'http server error': 'runtime-network',
  'broken resource': 'runtime-network',
  'access & authorization': 'runtime-network',
  'http client error': 'runtime-network',
  'responsive-design': 'responsive-design',
  'responsive design': 'responsive-design',
  'responsive layout': 'responsive-design',
  'layout-stability': 'layout-stability',
  'layout stability': 'layout-stability',
  'technical-seo': 'technical-seo',
  'technical seo': 'technical-seo',
  seo: 'technical-seo',
  'mobile & responsive seo': 'technical-seo',
  'social seo': 'technical-seo',
  'static-performance': 'static-performance',
  'static performance': 'static-performance',
  performance: 'static-performance',
  'content-quality': 'content-quality',
  'content quality': 'content-quality',
  'dom-quality': 'dom-quality',
  'dom quality': 'dom-quality',
  'content-structure': 'content-structure',
  'content structure': 'content-structure',
  wordpress: 'wordpress',
  'technology detection': 'wordpress',
  'technology observation': 'wordpress',
  'attack surface': 'wordpress',
  system: 'system',
  general: 'system',
});

/**
 * Resolves a finding's deterministic 1:1 canonical category identifier from its ruleId and/or raw category.
 */
export function normalizeFindingCategoryId(input: {
  category?: string | null;
  ruleId?: string | null;
}): FindingCategoryId {
  const rule = (input.ruleId ?? '').trim().toUpperCase();
  if (rule) {
    if (rule.startsWith('WP_') || rule.startsWith('WP-')) {
      return 'wordpress';
    }
    if (rule.startsWith('A11Y-BP-') || rule.startsWith('A11Y_BP_')) {
      return 'accessibility-best-practice';
    }
    if (
      rule.startsWith('A11Y_') ||
      rule.startsWith('A11Y-') ||
      rule === 'CONTENT_EMPTY_LINK' ||
      rule === 'CONTENT_EMPTY_BUTTON'
    ) {
      return 'accessibility';
    }
    if (rule === 'CONTENT_DOM_BLOAT') {
      return 'dom-quality';
    }
    if (rule === 'CONTENT_HIGH_LINK_DENSITY' || rule === 'CONTENT_REPEATED_HEADINGS') {
      return 'content-structure';
    }
    if (
      rule === 'CONTENT_EMPTY_PAGE' ||
      rule === 'CONTENT_THIN_TEXT' ||
      rule === 'CONTENT_DUPLICATE_TITLE'
    ) {
      return 'content-quality';
    }
    if (
      rule === 'CONTENT_DUPLICATE_DESCRIPTION' ||
      rule.startsWith('SEO_') ||
      rule.startsWith('SEO-')
    ) {
      return 'technical-seo';
    }
    if (rule.startsWith('PERF_') || rule.startsWith('PERF-')) {
      return 'static-performance';
    }
    if (rule.startsWith('RESPONSIVE_') || rule.startsWith('RESPONSIVE-')) {
      return 'responsive-design';
    }
    if (
      rule.startsWith('LAYOUT_SHIFT_') ||
      rule.startsWith('LAYOUT_STABILITY_') ||
      rule.startsWith('LAYOUT_STABILITY-')
    ) {
      return 'layout-stability';
    }
    if (rule.startsWith('SEC_') || rule.startsWith('SEC-')) {
      return 'security';
    }
    if (
      rule.startsWith('RUN_') ||
      rule.startsWith('RUNTIME_') ||
      rule.startsWith('RUNTIME-') ||
      rule.startsWith('NET_') ||
      rule.startsWith('NETWORK_') ||
      rule.startsWith('NETWORK-') ||
      rule.startsWith('HTTP_') ||
      rule.startsWith('HTTP-')
    ) {
      return 'runtime-network';
    }
    if (rule.startsWith('SYS_') || rule.startsWith('SYS-')) {
      return 'system';
    }
  }

  const rawCat = (input.category ?? '').trim().toLowerCase();
  if (rawCat) {
    if (CANONICAL_CATEGORY_SET.has(rawCat)) {
      return rawCat as FindingCategoryId;
    }
    const aliased = LEGACY_CATEGORY_ALIASES[rawCat];
    if (aliased) {
      return aliased;
    }
    if (rawCat.includes('wordpress') || rawCat.includes('technology')) {
      return 'wordpress';
    }
    if (rawCat.includes('responsive')) {
      return 'responsive-design';
    }
    if (rawCat.includes('stability') || rawCat.includes('cls')) {
      return 'layout-stability';
    }
    if (rawCat.includes('dom quality')) {
      return 'dom-quality';
    }
    if (rawCat.includes('content structure')) {
      return 'content-structure';
    }
    if (rawCat.includes('content quality')) {
      return 'content-quality';
    }
    if (rawCat.includes('performance')) {
      return 'static-performance';
    }
    if (rawCat.includes('seo')) {
      return 'technical-seo';
    }
    if (rawCat.includes('accessibility')) {
      return 'accessibility';
    }
    if (rawCat.includes('security') || rawCat.includes('cookie')) {
      return 'security';
    }
    if (rawCat.includes('runtime') || rawCat.includes('network') || rawCat.includes('console')) {
      return 'runtime-network';
    }
  }

  return 'system';
}

/**
 * Returns the human-readable display label for a canonical or legacy finding category.
 */
export function getFindingCategoryLabel(
  categoryOrFinding: string | { category?: string | null; ruleId?: string | null },
): string {
  const input =
    typeof categoryOrFinding === 'string' ? { category: categoryOrFinding } : categoryOrFinding;
  const canonicalId = normalizeFindingCategoryId(input);
  return FINDING_CATEGORY_DEFINITIONS[canonicalId].label;
}
