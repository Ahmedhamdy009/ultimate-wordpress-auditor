/**
 * Immutable Rule Registry System.
 * Enforces true runtime immutability through private closure encapsulation,
 * preventing mutation of internal Set elements or frozen enumeration arrays.
 */

import type { ReadOnlyRuleRegistry } from './types.js';

export const CURRENT_REGISTRY_VERSION = '2026.11-v1';

/**
 * Creates an encapsulated read-only rule registry.
 * Does NOT expose internal mutable Set references.
 */
export function createImmutableRuleRegistry(
  version: string,
  ruleIds: Iterable<string>,
): ReadOnlyRuleRegistry {
  const internalSet = new Set<string>();
  for (const id of ruleIds) {
    if (typeof id === 'string' && id.trim().length > 0) {
      internalSet.add(id.trim());
    }
  }

  const frozenSortedArray = Object.freeze(Array.from(internalSet).sort());

  return Object.freeze({
    version,
    get size(): number {
      return internalSet.size;
    },
    has(ruleId: string): boolean {
      return internalSet.has(ruleId);
    },
    getRuleIds(): readonly string[] {
      return frozenSortedArray;
    },
  });
}

/**
 * Complete frozen list of all known active rule IDs recognized by the v0.1.8 scanner engine.
 */
export const KNOWN_RULE_IDS_V1: readonly string[] = Object.freeze([
  // WordPress Analyzer (4)
  'WP_DETECTED',
  'WP_VERSION_DISCLOSED',
  'WP_XMLRPC_PINGBACK_ADVERTISED',
  'WP_REST_API_ADVERTISED',

  // Security Headers Analyzer (25)
  'SEC_HEADER_HSTS_MISSING',
  'SEC_HEADER_HSTS_MALFORMED',
  'SEC_HEADER_HSTS_WEAK',
  'SEC_HEADER_HSTS_NO_SUBDOMAINS',
  'SEC_HEADER_HSTS_PRELOAD_INELIGIBLE',
  'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE',
  'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED',
  'SEC_HEADER_CSP_MISSING',
  'SEC_HEADER_CSP_REPORT_ONLY',
  'SEC_HEADER_CSP_UNSAFE_INLINE',
  'SEC_HEADER_CSP_UNSAFE_EVAL',
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
  'SEC_COOKIE_INSECURE',
  'SEC_COOKIE_NO_HTTPONLY',
  'SEC_COOKIE_SAMESITE_NONE_INSECURE',
  'SEC_COOKIE_SAMESITE_MISSING',

  // SEO & Static Performance Analyzer (27)
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
  'SEO_IMG_ALT_MISSING',
  'SEO_HREFLANG_INVALID_TAG',
  'SEO_HREFLANG_X_DEFAULT_INVALID',
  'SEO_HREFLANG_CONFLICTING_URLS',
  'SEO_HREFLANG_DUPLICATE_DECLARATION',
  'SEO_HREFLANG_MISSING_SELF_REFERENCE',
  'PERF_SLOW_SERVER_RESPONSE',
  'PERF_LARGE_HTML_DOCUMENT',
  'PERF_EXCESSIVE_SCRIPTS',
  'PERF_EXCESSIVE_STYLESHEETS',
  'PERF_IMG_DIMENSIONS_MISSING',

  // Quality & Content Analyzer (7)
  'CONTENT_EMPTY_PAGE',
  'CONTENT_THIN_TEXT',
  'CONTENT_DOM_BLOAT',
  'CONTENT_HIGH_LINK_DENSITY',
  'CONTENT_EMPTY_LINK',
  'CONTENT_EMPTY_BUTTON',
  'CONTENT_REPEATED_HEADINGS',

  // Structured Data Engine (6)
  'SEO_SCHEMA_MISSING_CONTEXT',
  'SEO_SCHEMA_MISSING_TYPE',
  'SEO_SCHEMA_RECOMMENDED_PROPERTY_MISSING',
  'SEO_SCHEMA_PROPERTY_VALUE_INVALID',
  'SEO_SCHEMA_SYNTAX_ERROR',
  'SEO_SCHEMA_DUPLICATE_ID',

  // Cross-Page Analyzer (12)
  'CONTENT_DUPLICATE_TITLE',
  'CONTENT_DUPLICATE_DESCRIPTION',
  'SEO_BROKEN_INTERNAL_LINK',
  'SEO_CANONICAL_TARGET_BROKEN',
  'SEO_CANONICAL_LOOP',
  'SEO_CANONICAL_CHAIN',
  'CONTENT_DUPLICATE_PAGE_CANDIDATE',
  'SEO_HREFLANG_EXTERNAL_TARGET',
  'SEO_HREFLANG_UNCRAWLED_TARGET',
  'SEO_HREFLANG_TARGET_BROKEN',
  'SEO_HREFLANG_MISSING_RECIPROCAL',
  'SEO_HREFLANG_INCONSISTENT_LANGUAGE',

  // Robots Engine (6)
  'SEO_ROBOTS_MISSING',
  'SEO_ROBOTS_DISALLOW_ALL',
  'SEO_ROBOTS_CONFLICTING_RULES',
  'SEO_ROBOTS_HIGH_CRAWL_DELAY',
  'SEO_ROBOTS_MALFORMED_SYNTAX',
  'SEO_ROBOTS_IMPORTANT_PAGE_BLOCKED',

  // Sitemap Engine (9)
  'SEO_SITEMAP_HTTP_ERROR',
  'SEO_SITEMAP_MALFORMED',
  'SEO_SITEMAP_UNREACHABLE',
  'SEO_SITEMAP_MISSING',
  'SEO_SITEMAP_CROSS_ORIGIN_URL',
  'SEO_SITEMAP_DUPLICATE_URL',
  'SEO_SITEMAP_INVALID_DATE',
  'SEO_SITEMAP_PAGE_NOT_IN_SITEMAP',
  'SEO_SITEMAP_URL_NOT_CRAWLED',

  // Redirect Engine (8)
  'SEO_REDIRECT_LOOP',
  'SEO_REDIRECT_EXCESSIVE_HOPS',
  'SEO_REDIRECT_CHAIN',
  'SEO_REDIRECT_BROKEN_DESTINATION',
  'SEO_REDIRECT_TEMPORARY_FOR_PERMANENT',
  'SEO_REDIRECT_TRAILING_SLASH',
  'SEO_REDIRECT_HTTP_TO_HTTPS',
  'SEO_REDIRECT_INTERNAL_LINK_TO_REDIRECT',

  // Performance Lab Auditor (4)
  'PERF_LAB_SLOW_TTFB',
  'PERF_LAB_SLOW_FCP',
  'PERF_LAB_SLOW_LCP',
  'PERF_LAB_HIGH_TBT',

  // Runtime Auditor (6)
  'NET_MAIN_DOCUMENT_FAILED',
  'NET_IFRAME_DOCUMENT_FAILED',
  'NET_RESOURCE_FAILED',
  'HTTP_UNAUTHORIZED_401',
  'HTTP_FORBIDDEN_403',
  'HTTP_CLIENT_ERROR_4XX',

  // Responsive & Layout Shift Auditor (8)
  'LAYOUT_SHIFT_HIGH',
  'LAYOUT_SHIFT_NEEDS_IMPROVEMENT',
  'RESPONSIVE_HORIZONTAL_OVERFLOW',
  'RESPONSIVE_FIXED_WIDTH_CONTAINER',
  'RESPONSIVE_IMAGE_OVERFLOW',
  'RESPONSIVE_CONTROL_OVERFLOW',
  'RESPONSIVE_TEXT_CLIPPED',
  'RESPONSIVE_ELEMENT_OVERFLOW',
]);

export const SYSTEM_RULE_REGISTRIES: Readonly<Record<string, ReadOnlyRuleRegistry>> = Object.freeze({
  [CURRENT_REGISTRY_VERSION]: createImmutableRuleRegistry(
    CURRENT_REGISTRY_VERSION,
    KNOWN_RULE_IDS_V1,
  ),
});

/**
 * Checks whether a rule is an active recognized rule in the specified registry version.
 */
export function isRuleKnownInRegistryVersion(ruleId: string, version: string): boolean {
  const registry = SYSTEM_RULE_REGISTRIES[version];
  if (!registry) {
    return false;
  }
  return registry.has(ruleId);
}
