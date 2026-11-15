import { z } from 'zod';
import type { PlatformType } from '../schemas/site.js';

export interface StackEvidenceFindingInput {
  readonly ruleId?: string | null;
  readonly targetUrl?: string | null;
  readonly evidence?: Record<string, unknown> | string | null;
}

export interface DetectedStackInput {
  readonly sitePlatformType?: PlatformType | string | null;
  readonly findings?: readonly StackEvidenceFindingInput[] | null;
}

export const DETECTED_CDN_CACHE_HINTS = [
  'cloudflare',
  'litespeed',
  'varnish',
  'wp-rocket',
  'wp-super-cache',
  'w3-total-cache',
  'generic-cache-header',
] as const;
export type DetectedCdnCacheHint = (typeof DETECTED_CDN_CACHE_HINTS)[number];

export const DETECTED_SERVER_HINTS = ['nginx', 'apache', 'litespeed', 'iis', 'caddy'] as const;
export type DetectedServerHint = (typeof DETECTED_SERVER_HINTS)[number];

export interface DetectedStackDTO {
  readonly isWordPress: boolean;
  readonly wordPressConfidence: 'confirmed' | 'firm' | 'potential' | 'site_declared' | 'none';
  readonly wordPressVersion: string | null;
  readonly detectedThemes: readonly string[];
  readonly detectedPlugins: readonly string[];
  readonly isElementor: boolean;
  readonly isElementorPro: boolean;
  readonly isWooCommerce: boolean;
  readonly hasRestApi: boolean;
  readonly hasXmlRpc: boolean;
  readonly cdnOrCacheHints: readonly DetectedCdnCacheHint[];
  readonly serverHints: readonly DetectedServerHint[];
}

export const DetectedStackSchema = z.object({
  isWordPress: z.boolean(),
  wordPressConfidence: z.enum(['confirmed', 'firm', 'potential', 'site_declared', 'none']),
  wordPressVersion: z.string().nullable(),
  detectedThemes: z.array(z.string()),
  detectedPlugins: z.array(z.string()),
  isElementor: z.boolean(),
  isElementorPro: z.boolean(),
  isWooCommerce: z.boolean(),
  hasRestApi: z.boolean(),
  hasXmlRpc: z.boolean(),
  cdnOrCacheHints: z.array(z.enum(DETECTED_CDN_CACHE_HINTS)),
  serverHints: z.array(z.enum(DETECTED_SERVER_HINTS)),
});

function parseEvidenceRecord(
  evidence: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> | null {
  if (!evidence) return null;
  if (typeof evidence === 'string') {
    try {
      const parsed = JSON.parse(evidence) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : null;
}

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 4 || out.length > 200 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.length > 0) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      collectStrings(v, out, depth + 1);
    }
  }
}

/**
 * Strictly extracts detected CMS, page-builder, e-commerce, and server/cache signals
 * solely from observed scan evidence and declared site metadata.
 */
export function extractDetectedStack(input: DetectedStackInput): DetectedStackDTO {
  const themes = new Set<string>();
  const plugins = new Set<string>();
  const cdnHints = new Set<DetectedCdnCacheHint>();
  const serverHints = new Set<DetectedServerHint>();

  let isWordPress = input.sitePlatformType === 'wordpress';
  let wpConfidence: DetectedStackDTO['wordPressConfidence'] = isWordPress
    ? 'site_declared'
    : 'none';
  let wpVersion: string | null = null;
  let hasRestApi = false;
  let hasXmlRpc = false;

  for (const finding of input.findings ?? []) {
    const ruleId = (finding.ruleId ?? '').trim().toUpperCase();
    const ev = parseEvidenceRecord(finding.evidence);

    if (ruleId === 'WP_DETECTED') {
      isWordPress = true;
      const rawConf = typeof ev?.confidence === 'string' ? ev.confidence.toLowerCase() : '';
      if (rawConf === 'confirmed' || rawConf === 'high') {
        wpConfidence = 'confirmed';
      } else if ((rawConf === 'firm' || rawConf === 'medium') && wpConfidence !== 'confirmed') {
        wpConfidence = 'firm';
      } else if (wpConfidence === 'none' || wpConfidence === 'site_declared') {
        wpConfidence = 'potential';
      }

      if (
        typeof ev?.version === 'string' &&
        ev.version.trim().length > 0 &&
        !ev.version.toLowerCase().includes('unknown')
      ) {
        wpVersion = ev.version.trim();
      }
      if (Array.isArray(ev?.themes)) {
        for (const t of ev.themes) {
          if (typeof t === 'string' && t.trim()) themes.add(t.trim().toLowerCase());
        }
      }
      if (Array.isArray(ev?.plugins)) {
        for (const p of ev.plugins) {
          if (typeof p === 'string' && p.trim()) plugins.add(p.trim().toLowerCase());
        }
      }
      if (ev?.hasRestApi === true) hasRestApi = true;
      if (ev?.hasXmlRpc === true) hasXmlRpc = true;
    } else if (ruleId === 'WP_VERSION_DISCLOSED' && typeof ev?.version === 'string') {
      isWordPress = true;
      if (!wpVersion && ev.version.trim().length > 0) {
        wpVersion = ev.version.trim();
      }
    } else if (ruleId === 'WP_REST_API_ADVERTISED') {
      isWordPress = true;
      hasRestApi = true;
    } else if (ruleId === 'WP_XMLRPC_PINGBACK_ADVERTISED') {
      isWordPress = true;
      hasXmlRpc = true;
    }

    const stringsToInspect: string[] = [];
    if (typeof finding.targetUrl === 'string') stringsToInspect.push(finding.targetUrl);
    if (typeof finding.evidence === 'string') stringsToInspect.push(finding.evidence);
    if (ev) collectStrings(ev, stringsToInspect);

    for (const rawStr of stringsToInspect) {
      const lower = rawStr.toLowerCase();

      if (
        lower.includes('/wp-content/') ||
        lower.includes('/wp-includes/') ||
        lower.includes('/wp-json/')
      ) {
        isWordPress = true;
        if (wpConfidence === 'none') wpConfidence = 'potential';
      }

      const themeMatches = rawStr.matchAll(/\/wp-content\/themes\/([a-zA-Z0-9_-]+)/gi);
      for (const m of themeMatches) {
        if (m[1]) themes.add(m[1].toLowerCase());
      }

      const pluginMatches = rawStr.matchAll(/\/wp-content\/plugins\/([a-zA-Z0-9_-]+)/gi);
      for (const m of pluginMatches) {
        if (m[1]) plugins.add(m[1].toLowerCase());
      }

      if (lower.includes('/wc-api/') || lower.includes('woocommerce-')) {
        plugins.add('woocommerce');
      }

      // Header-grounded CDN / cache / server detection
      if (lower.includes('cf-ray') || lower.includes('cloudflare')) {
        cdnHints.add('cloudflare');
      }
      if (lower.includes('x-litespeed-cache') || lower.includes('litespeed')) {
        cdnHints.add('litespeed');
        serverHints.add('litespeed');
      }
      if (lower.includes('x-varnish')) {
        cdnHints.add('varnish');
      }
      if (lower.includes('x-rocket-cache') || lower.includes('wp-rocket')) {
        cdnHints.add('wp-rocket');
      }
      if (lower.includes('x-wp-super-cache') || lower.includes('wp-super-cache')) {
        cdnHints.add('wp-super-cache');
      }
      if (lower.includes('x-w3tc') || lower.includes('w3-total-cache')) {
        cdnHints.add('w3-total-cache');
      }
      if (lower.includes('x-cache')) {
        cdnHints.add('generic-cache-header');
      }

      if (/\bnginx\b/i.test(rawStr)) serverHints.add('nginx');
      if (/\bapache\b/i.test(rawStr)) serverHints.add('apache');
      if (/\bmicrosoft-iis\b|\biis\b/i.test(rawStr)) serverHints.add('iis');
      if (/\bcaddy\b/i.test(rawStr)) serverHints.add('caddy');
    }
  }

  const sortedThemes = Array.from(themes).sort();
  const sortedPlugins = Array.from(plugins).sort();

  const isElementorPro = sortedPlugins.includes('elementor-pro');
  const isElementor = isElementorPro || sortedPlugins.includes('elementor');
  const isWooCommerce = sortedPlugins.includes('woocommerce');

  return {
    isWordPress,
    wordPressConfidence: wpConfidence,
    wordPressVersion: wpVersion,
    detectedThemes: sortedThemes,
    detectedPlugins: sortedPlugins,
    isElementor,
    isElementorPro,
    isWooCommerce,
    hasRestApi,
    hasXmlRpc,
    cdnOrCacheHints: Array.from(cdnHints).sort(),
    serverHints: Array.from(serverHints).sort(),
  };
}
