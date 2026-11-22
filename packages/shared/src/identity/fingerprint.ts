/**
 * 3-Tier Finding Identity Fingerprint Engine.
 * Deterministically computes cross-scan finding fingerprints conforming to the
 * 3-Tier Identity Strategy specified in ARCHITECTURE.md.
 */

import { createHash } from 'node:crypto';
import { normalizeCrawlUrl } from '../scope/url-normalizer.js';
import type { FindingIdentityInput, IdentityDescriptor } from './types.js';

/**
 * Site-level rule IDs that apply universally across an entire site origin.
 * These are inherently Tier 1 semantic singletons across the authorized origin.
 */
export const SITE_LEVEL_RULE_IDS = new Set<string>([
  'WP_DETECTED',
  'WP_VERSION_DISCLOSED',
  'WP_XMLRPC_PINGBACK_ADVERTISED',
  'WP_REST_API_ADVERTISED',
  'SEC_HEADER_CSP_MISSING',
  'SEC_HEADER_CSP_REPORT_ONLY',
  'SEC_HEADER_CSP_UNSAFE_INLINE',
  'SEC_HEADER_CSP_UNSAFE_EVAL',
  'SEC_HEADER_HSTS_MISSING',
  'SEC_HEADER_HSTS_MALFORMED',
  'SEC_HEADER_HSTS_WEAK',
  'SEC_HEADER_HSTS_NO_SUBDOMAINS',
  'SEC_HEADER_HSTS_PRELOAD_INELIGIBLE',
  'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE',
  'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED',
  'SEC_HEADER_X_CONTENT_TYPE_OPTIONS_MISSING',
  'SEC_HEADER_X_FRAME_OPTIONS_MISSING',
  'SEC_HEADER_REFERRER_POLICY_MISSING',
  'SEC_HEADER_REFERRER_POLICY_UNSAFE',
  'SEC_HEADER_PERMISSIONS_POLICY_MISSING',
  'SEC_TLS_DEPRECATED_PROTOCOL',
  'SEC_TLS_WEAK_CIPHER',
  'SEC_TLS_CERT_INVALID',
  'SEC_TLS_CERT_EXPIRED',
  'SEC_TLS_CERT_EXPIRING_SOON',
  // Advanced Technical SEO Site-Level Rules
  'SEO_ROBOTS_MISSING',
  'SEO_ROBOTS_DISALLOW_ALL',
  'SEO_ROBOTS_CONFLICTING_RULES',
  'SEO_ROBOTS_MALFORMED_SYNTAX',
  'SEO_ROBOTS_HIGH_CRAWL_DELAY',
  'SEO_ROBOTS_IMPORTANT_PAGE_BLOCKED',
  'SEO_SITEMAP_MISSING',
  'SEO_SITEMAP_MALFORMED',
  'SEO_SITEMAP_HTTP_ERROR',
  'SEO_SITEMAP_UNREACHABLE',
  'SEO_SITEMAP_CROSS_ORIGIN_URL',
  'SEO_SITEMAP_DUPLICATE_URL',
  'SEO_SITEMAP_INVALID_DATE',
  'SEO_SITEMAP_PAGE_NOT_IN_SITEMAP',
  'SEO_SITEMAP_URL_NOT_CRAWLED',
  'SEO_REDIRECT_CHAIN',
  'SEO_REDIRECT_LOOP',
  'SEO_REDIRECT_EXCESSIVE_HOPS',
  'SEO_REDIRECT_TEMPORARY_FOR_PERMANENT',
  'SEO_REDIRECT_TRAILING_SLASH',
  'SEO_REDIRECT_HTTP_TO_HTTPS',
  'SEO_REDIRECT_BROKEN_DESTINATION',
  'SEO_REDIRECT_INTERNAL_LINK_TO_REDIRECT',
]);

/**
 * Page-level singleton rule IDs that can occur at most once per page URL.
 * Inherently Tier 1 semantic singletons on that normalized page URL.
 */
export const PAGE_SINGLETON_RULE_IDS = new Set<string>([
  'SEO_TITLE_MISSING',
  'SEO_TITLE_LENGTH',
  'SEO_DESCRIPTION_MISSING',
  'SEO_DESCRIPTION_LENGTH',
  'SEO_H1_MISSING',
  'SEO_H1_MULTIPLE',
  'SEO_HEADING_HIERARCHY_GAP',
  'SEO_CANONICAL_MISSING',
  'SEO_CANONICAL_INVALID',
  'SEO_CANONICAL_OUT_OF_SCOPE',
  'SEO_CANONICAL_MISMATCH',
  'SEO_ROBOTS_NOINDEX',
  'SEO_VIEWPORT_MISSING',
  'SEO_LANG_MISSING',
  'SEO_OPENGRAPH_INCOMPLETE',
  'SEO_TWITTER_CARD_MISSING',
  'CONTENT_EMPTY_PAGE',
  'CONTENT_THIN_TEXT',
  'CONTENT_DOM_BLOAT',
  'CONTENT_HIGH_LINK_DENSITY',
  'CONTENT_REPEATED_HEADINGS',
  'PERF_SLOW_SERVER_RESPONSE',
  'PERF_LARGE_HTML_DOCUMENT',
  'PERF_EXCESSIVE_SCRIPTS',
  'PERF_EXCESSIVE_STYLESHEETS',
  'A11Y_PAGE_LANGUAGE_MISSING',
]);

/**
 * Rules where individual occurrences lack stable element identities and must be
 * treated strictly as Tier 3 aggregate groups.
 */
export const TIER3_AGGREGATE_RULE_IDS = new Set<string>([
  'SEO_IMG_ALT_MISSING',
  'PERF_IMG_DIMENSIONS_MISSING',
  'CONTENT_EMPTY_LINK',
  'CONTENT_EMPTY_BUTTON',
]);

/**
 * Regex patterns identifying dynamic or framework-generated IDs that are unstable across deployments.
 */
const DYNAMIC_ID_PATTERNS = [
  /^(?:ember|react|vue|radix|headlessui|chakra|next|styled|mantine)[-_:\d]/i,
  /[-_][0-9a-f]{8,}$/i, // trailing random hashes
  /^:\w+:$/i, // React 18 useId format e.g. :r0:
  /\d{5,}$/, // trailing large numbers
];

export function isStableHtmlId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  return !DYNAMIC_ID_PATTERNS.some(pattern => pattern.test(trimmed));
}

function computeSha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Inspects finding evidence to extract semantic locators (Tier 1) or positional locators (Tier 2).
 */
export function extractElementLocator(evidence: Record<string, unknown> | string | null | undefined): {
  semanticLocator: string | null;
  positionalLocator: string | null;
  signatureBasis: string;
} {
  if (!evidence) {
    return { semanticLocator: null, positionalLocator: null, signatureBasis: 'no_evidence' };
  }

  const ev: Record<string, unknown> =
    typeof evidence === 'string'
      ? (() => {
          try {
            return JSON.parse(evidence);
          } catch {
            return { raw: evidence };
          }
        })()
      : evidence;

  // 1. Check for data-testid / data-qa / data-cy test attributes (Tier 1)
  if (typeof ev.testId === 'string' && ev.testId.trim().length > 0) {
    return {
      semanticLocator: `testid:${ev.testId.trim()}`,
      positionalLocator: null,
      signatureBasis: 'data_testid_attribute',
    };
  }

  // 2. Check for unique form control name attribute (Tier 1)
  if (typeof ev.inputName === 'string' && ev.inputName.trim().length > 0) {
    return {
      semanticLocator: `input:name=${ev.inputName.trim()}`,
      positionalLocator: null,
      signatureBasis: 'form_control_name',
    };
  }

  // 3. Inspect selector string (from CSS selector, Axe node targets, etc.)
  let rawSelector: string | null = null;
  if (typeof ev.selector === 'string' && ev.selector.trim().length > 0) {
    rawSelector = ev.selector.trim();
  } else if (typeof ev.targetSelector === 'string' && ev.targetSelector.trim().length > 0) {
    rawSelector = ev.targetSelector.trim();
  } else if (Array.isArray(ev.nodes) && ev.nodes.length > 0 && typeof ev.nodes[0] === 'object' && ev.nodes[0]) {
    const node0 = ev.nodes[0] as Record<string, unknown>;
    if (typeof node0.targetSelector === 'string') {
      rawSelector = node0.targetSelector.trim();
    } else if (typeof node0.structuralLocator === 'string') {
      rawSelector = node0.structuralLocator.trim();
    } else if (Array.isArray(node0.target) && node0.target.length > 0 && typeof node0.target[0] === 'string') {
      rawSelector = node0.target[0].trim();
    }
  }

  if (rawSelector) {
    // Check if selector contains a stable ID: e.g. #site-navigation or nav#main-menu
    const idMatch = rawSelector.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch && isStableHtmlId(idMatch[1])) {
      return {
        semanticLocator: `id:${idMatch[1]}`,
        positionalLocator: rawSelector,
        signatureBasis: 'stable_element_id',
      };
    }

    // Check if selector contains a test attribute: e.g. [data-testid="xyz"]
    const testAttrMatch = rawSelector.match(/\[data-(?:testid|qa|cy)=["']?([^"']+)["']?\]/);
    if (testAttrMatch && testAttrMatch[1]) {
      return {
        semanticLocator: `testid:${testAttrMatch[1]}`,
        positionalLocator: rawSelector,
        signatureBasis: 'data_testid_selector',
      };
    }

    // Check if selector contains an input[name="xyz"]
    const nameAttrMatch = rawSelector.match(/\[name=["']?([^"']+)["']?\]/);
    if (nameAttrMatch && nameAttrMatch[1]) {
      return {
        semanticLocator: `name:${nameAttrMatch[1]}`,
        positionalLocator: rawSelector,
        signatureBasis: 'named_element_selector',
      };
    }

    // Otherwise, selector represents a positional/structural locator (Tier 2)
    return {
      semanticLocator: null,
      positionalLocator: rawSelector,
      signatureBasis: 'positional_css_selector',
    };
  }

  // 4. Check for stable HTML snippet or canonical property name
  if (typeof ev.propertyName === 'string' && ev.propertyName.trim().length > 0) {
    return {
      semanticLocator: `prop:${ev.propertyName.trim()}`,
      positionalLocator: null,
      signatureBasis: 'named_schema_property',
    };
  }

  return { semanticLocator: null, positionalLocator: null, signatureBasis: 'unresolved_locator' };
}

/**
 * Computes the 3-tier identity descriptor and deterministic fingerprint for a finding.
 */
export function computeFindingIdentity(input: FindingIdentityInput): IdentityDescriptor {
  const ruleId = input.ruleId.trim();
  const category = input.category.trim();
  const rawTargetUrl = input.targetUrl.trim();
  const normalizedResult = normalizeCrawlUrl(rawTargetUrl);
  const normalizedUrl = normalizedResult ? normalizedResult.href : rawTargetUrl;

  let origin: string;
  try {
    origin = new URL(normalizedUrl).origin;
  } catch {
    origin = normalizedUrl;
  }

  // ==========================================
  // CASE 1: Site-Level Rules (Tier 1: Semantic Singleton on Site Origin)
  // ==========================================
  if (SITE_LEVEL_RULE_IDS.has(ruleId)) {
    const rawSignature = `tier1::site::${origin}::${category}::${ruleId}`;
    return {
      fingerprint: computeSha256(rawSignature),
      tier: 'tier1_semantic',
      matchConfidence: 1.0,
      signatureBasis: 'site_level_singleton',
      canonicalLocator: origin,
    };
  }

  // ==========================================
  // CASE 2: Page-Level Singletons (Tier 1: Semantic Singleton on Page URL)
  // ==========================================
  if (PAGE_SINGLETON_RULE_IDS.has(ruleId)) {
    const rawSignature = `tier1::page::${normalizedUrl}::${category}::${ruleId}`;
    return {
      fingerprint: computeSha256(rawSignature),
      tier: 'tier1_semantic',
      matchConfidence: 1.0,
      signatureBasis: 'page_level_singleton',
      canonicalLocator: normalizedUrl,
    };
  }

  // Extract evidence locators
  const { semanticLocator, positionalLocator, signatureBasis } = extractElementLocator(input.evidence);

  // ==========================================
  // CASE 3: Explicit Semantic Locator (Tier 1: Element Semantic Identity)
  // ==========================================
  if (semanticLocator) {
    const rawSignature = `tier1::elem::${normalizedUrl}::${category}::${ruleId}::${semanticLocator}`;
    return {
      fingerprint: computeSha256(rawSignature),
      tier: 'tier1_semantic',
      matchConfidence: 1.0,
      signatureBasis,
      canonicalLocator: semanticLocator,
    };
  }

  // ==========================================
  // CASE 4: Mandatory Aggregate Rules (Tier 3: Ambiguous Aggregate Identity)
  // ==========================================
  if (TIER3_AGGREGATE_RULE_IDS.has(ruleId) || (!positionalLocator && !semanticLocator)) {
    const aggregateGroupKey = `${normalizedUrl}::${ruleId}`;
    const rawSignature = `tier3::aggregate::${aggregateGroupKey}`;
    return {
      fingerprint: computeSha256(rawSignature),
      tier: 'tier3_aggregate',
      matchConfidence: 0.5,
      signatureBasis: 'aggregate_occurrence_group',
      canonicalLocator: undefined,
      aggregateGroupKey,
    };
  }

  // ==========================================
  // CASE 5: Structural / Positional Locator (Tier 2: Positional Identity)
  // ==========================================
  const rawSignature = `tier2::positional::${normalizedUrl}::${category}::${ruleId}::${positionalLocator}`;
  return {
    fingerprint: computeSha256(rawSignature),
    tier: 'tier2_positional',
    matchConfidence: 0.7,
    signatureBasis,
    canonicalLocator: positionalLocator ?? undefined,
  };
}

/**
 * Convenience helper to compute the deterministic hex fingerprint string directly.
 */
export function computeFindingFingerprint(input: FindingIdentityInput): string {
  return computeFindingIdentity(input).fingerprint;
}

