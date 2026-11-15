import {
  classifyFindingConfidenceBucket,
  normalizeFindingLifecycleStatus,
  type ConsolidatedFindingDTO,
  type FindingConfidence,
  type FindingDTO,
  type FindingSeverity,
  type FindingStatus,
} from '../schemas/finding.js';
import { normalizeFindingCategoryId, type FindingCategoryId } from '../schemas/categories.js';
import {
  lookupRecommendationByRuleId,
  type CauseConfidenceLevel,
  type CodeExampleTemplate,
  type DualAudienceBilingualText,
  type EvidenceRequirementTag,
  type PlatformGuidanceTemplate,
  type RecommendationReference,
  type RecommendationStep,
  type SupportedPlatformScope,
} from './recommendation-kb.js';
import {
  extractDetectedStack,
  type DetectedStackDTO,
  type StackEvidenceFindingInput,
} from './stack-guidance.js';
import { UI_LABELS, type BilingualText } from './translations.js';

export interface EnrichableFindingInput {
  readonly id?: string;
  readonly ruleId?: string | null;
  readonly category?: string | null;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly severity?: FindingSeverity | string | null;
  readonly confidence?: FindingConfidence | string | null;
  readonly status?: FindingStatus | string | null;
  readonly targetUrl?: string | null;
  readonly selector?: string | null;
  readonly affectedUrls?: readonly string[] | null;
  readonly totalOccurrences?: number | null;
  readonly originalFindingIds?: readonly string[] | null;
  readonly signature?: string | null;
  readonly evidence?: Record<string, unknown> | string | null;
  readonly remediation?: string | null;
  readonly references?: readonly string[] | null;
  readonly occurrences?:
    | readonly {
        readonly id?: string;
        readonly targetUrl?: string | null;
        readonly selector?: string | null;
        readonly evidence?: Record<string, unknown> | string | null;
      }[]
    | null;
}

export interface ExactAffectedLocation {
  readonly urls: readonly string[];
  readonly selectors: readonly string[];
  readonly assetUrls: readonly string[];
  readonly headerNames: readonly string[];
  readonly schemaTypes: readonly string[];
  readonly sourceLocations: readonly string[];
  readonly hasSpecificDomSelector: boolean;
  readonly hasSpecificAssetOrHeaderLocator: boolean;
  readonly fallbackNotice: BilingualText | null;
  readonly summary: BilingualText;
}

export interface GatedPlatformGuidance {
  readonly platform: SupportedPlatformScope;
  readonly evidenceReason: BilingualText;
  readonly summary: DualAudienceBilingualText;
  readonly steps: readonly BilingualText[];
}

export interface PreservedOriginalFindingSnapshot {
  readonly findingIds: readonly string[];
  readonly groupSignature: string | null;
  readonly ruleId: string;
  readonly category: FindingCategoryId;
  readonly title: string;
  readonly description: string;
  readonly severity: string;
  readonly confidence: string;
  readonly status: string;
  readonly targetUrl: string;
  readonly remediation: string | null;
  readonly references: readonly string[];
  readonly preservedEvidence: unknown;
}

export interface EnrichedRecommendationItem {
  readonly recommendationId: string;
  readonly ruleId: string;
  readonly matchType: 'exact' | 'prefix' | 'fallback';
  readonly isFallback: boolean;
  readonly category: FindingCategoryId;
  readonly severity: string;
  readonly originalConfidence: string;
  readonly originalStatus: string;
  readonly effectiveCauseConfidence: CauseConfidenceLevel;
  readonly occurrenceCount: number;
  readonly exactLocation: ExactAffectedLocation;
  readonly problem: DualAudienceBilingualText;
  readonly impact: DualAudienceBilingualText;
  readonly confirmedCauses: readonly BilingualText[];
  readonly possibleCauses: readonly BilingualText[];
  readonly locationGuidance: DualAudienceBilingualText;
  readonly remediationSteps: readonly RecommendationStep[];
  readonly platformGuidance: readonly GatedPlatformGuidance[];
  readonly codeExamples: readonly CodeExampleTemplate[];
  readonly verificationSteps: readonly RecommendationStep[];
  readonly limitations: readonly BilingualText[];
  readonly references: readonly RecommendationReference[];
  readonly preservedOriginalFinding: PreservedOriginalFindingSnapshot;
}

export interface MatchAndEnrichOptions {
  readonly detectedStack?: DetectedStackDTO | null;
  readonly sitePlatformType?: string | null;
}

export interface RecommendationEnrichmentResult {
  readonly detectedStack: DetectedStackDTO;
  readonly items: readonly EnrichedRecommendationItem[];
  readonly deduplicatedCount: number;
  readonly fallbackCount: number;
}

const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|bearer|api[_-]?key|auth|cookie|session|jwt|private[_-]?key|credential/i;

const SENSITIVE_QUERY_PARAM_PATTERN =
  /([?&](?:token|access_token|refresh_token|api_key|apikey|key|secret|password|passwd|session|sid|jwt|auth|signature|sig)=)([^&#\s]+)/gi;

/**
 * Redacts potential secrets, bearer tokens, Set-Cookie values, URL userinfo,
 * and sensitive query parameter values without destroying structural locators.
 */
export function redactSensitiveText(input: string): string {
  if (!input) return '';
  let out = input;

  // Redact URL userinfo (https://user:pass@host)
  out = out.replace(/(https?:\/\/)([^/@\s]+:[^/@\s]+)@/gi, '$1<redacted>@');
  out = out.replace(/(https?:\/\/)([^/@:\s]+)@/gi, '$1<redacted>@');

  // Redact sensitive URL query params
  out = out.replace(SENSITIVE_QUERY_PARAM_PATTERN, '$1<redacted>');

  // Redact Authorization headers / Bearer tokens
  out = out.replace(/(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)([^\s,;]+)/gi, '$1<redacted>');
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 <redacted>');

  // Redact Set-Cookie value while keeping cookie name and attributes intact
  out = out.replace(/(Set-Cookie\s*:\s*[^=;\s]+=)([^;\r\n]+)/gi, '$1<redacted>');
  out = out.replace(/(Cookie\s*:\s*[^=;\s]+=)([^;\r\n]+)/gi, '$1<redacted>');

  // Redact JWTs and common API token formats
  out = out.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,})?\b/g,
    '<redacted-jwt>',
  );
  out = out.replace(
    /\b(?:sk_live|sk_test|pk_live|ghp|gho|AIza)[A-Za-z0-9_-]{10,}\b/g,
    '<redacted-token>',
  );

  return out;
}

export function redactEvidenceValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(item => redactEvidenceValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (SENSITIVE_KEY_PATTERN.test(k) && (typeof v === 'string' || typeof v === 'number')) {
        // Preserve header/cookie name if this key explicitly names a cookie/header instead of holding a secret
        if (/^(cookieName|headerName|header)$/i.test(k)) {
          sanitized[k] = redactSensitiveText(String(v));
        } else {
          sanitized[k] = '<redacted>';
        }
      } else {
        sanitized[k] = redactEvidenceValue(v, depth + 1);
      }
    }
    return sanitized;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function pushCleanString(target: Set<string>, value: unknown, maxLen = 300): void {
  if (typeof value !== 'string') return;
  const cleaned = redactSensitiveText(value).trim();
  if (cleaned.length > 0 && cleaned.length <= maxLen) {
    target.add(cleaned);
  }
}

function extractLocatorsFromEvidenceRecord(
  ev: Record<string, unknown>,
  buckets: {
    urls: Set<string>;
    selectors: Set<string>;
    assetUrls: Set<string>;
    headerNames: Set<string>;
    schemaTypes: Set<string>;
    sourceLocations: Set<string>;
  },
): void {
  pushCleanString(buckets.selectors, ev.selector);
  pushCleanString(buckets.selectors, ev.structuralLocator);
  pushCleanString(buckets.selectors, ev.targetSelector);
  pushCleanString(buckets.selectors, ev.lcpElement);
  pushCleanString(buckets.selectors, ev.element);

  pushCleanString(buckets.assetUrls, ev.resourceUrl);
  pushCleanString(buckets.assetUrls, ev.assetUrl);
  pushCleanString(buckets.assetUrls, ev.src);
  pushCleanString(buckets.assetUrls, ev.url);
  pushCleanString(buckets.assetUrls, ev.canonicalUrl);
  pushCleanString(buckets.assetUrls, ev.frameUrl);

  pushCleanString(buckets.headerNames, ev.headerName, 120);
  pushCleanString(buckets.headerNames, ev.header, 120);
  pushCleanString(buckets.headerNames, ev.cookieName, 120);

  pushCleanString(buckets.schemaTypes, ev.schemaType, 120);
  pushCleanString(buckets.schemaTypes, ev.missingProperty, 120);

  if (Array.isArray(ev.affectedUrls)) {
    for (const u of ev.affectedUrls) pushCleanString(buckets.urls, u);
  }
  if (Array.isArray(ev.urls)) {
    for (const u of ev.urls) pushCleanString(buckets.urls, u);
  }

  // Accessibility axe-core nodes[*].target
  if (Array.isArray(ev.nodes)) {
    for (const node of ev.nodes) {
      const nr = asRecord(node);
      if (!nr) continue;
      if (Array.isArray(nr.target)) {
        for (const t of nr.target) pushCleanString(buckets.selectors, t);
      } else if (typeof nr.target === 'string') {
        pushCleanString(buckets.selectors, nr.target);
      }
      pushCleanString(buckets.selectors, nr.selector);
    }
  }

  // CLS layout-shift sources[*].node / selector
  if (Array.isArray(ev.sources)) {
    for (const src of ev.sources) {
      const sr = asRecord(src);
      if (!sr) continue;
      pushCleanString(buckets.selectors, sr.node);
      pushCleanString(buckets.selectors, sr.selector);
    }
  }

  // Responsive offending elements
  if (Array.isArray(ev.offendingElements)) {
    for (const item of ev.offendingElements) {
      const ir = asRecord(item);
      if (ir) {
        pushCleanString(buckets.selectors, ir.selector);
      } else {
        pushCleanString(buckets.selectors, item);
      }
    }
  }

  // Runtime / console source location
  const loc = asRecord(ev.location);
  if (loc) {
    const locUrl = typeof loc.url === 'string' ? redactSensitiveText(loc.url).trim() : '';
    const line = typeof loc.lineNumber === 'number' ? loc.lineNumber : undefined;
    const col = typeof loc.columnNumber === 'number' ? loc.columnNumber : undefined;
    if (locUrl) {
      const formatted =
        line !== undefined ? `${locUrl}:${line}${col !== undefined ? `:${col}` : ''}` : locUrl;
      buckets.sourceLocations.add(formatted);
    }
  }
}

export function extractExactAffectedLocation(
  findings: readonly EnrichableFindingInput[],
): ExactAffectedLocation {
  const buckets = {
    urls: new Set<string>(),
    selectors: new Set<string>(),
    assetUrls: new Set<string>(),
    headerNames: new Set<string>(),
    schemaTypes: new Set<string>(),
    sourceLocations: new Set<string>(),
  };

  for (const f of findings) {
    pushCleanString(buckets.urls, f.targetUrl);
    pushCleanString(buckets.selectors, f.selector);

    if (Array.isArray(f.affectedUrls)) {
      for (const u of f.affectedUrls) pushCleanString(buckets.urls, u);
    }

    const ev = asRecord(f.evidence);
    if (ev) extractLocatorsFromEvidenceRecord(ev, buckets);

    if (Array.isArray(f.occurrences)) {
      for (const occ of f.occurrences) {
        pushCleanString(buckets.urls, occ.targetUrl);
        pushCleanString(buckets.selectors, occ.selector);
        const occEv = asRecord(occ.evidence);
        if (occEv) extractLocatorsFromEvidenceRecord(occEv, buckets);
      }
    }
  }

  const urls = Array.from(buckets.urls).sort();
  const selectors = Array.from(buckets.selectors).sort();
  // Remove URLs identical to primary page URLs from assetUrls to keep distinction crisp
  const pageUrlSet = new Set(urls);
  const assetUrls = Array.from(buckets.assetUrls)
    .filter(a => !pageUrlSet.has(a))
    .sort();
  const headerNames = Array.from(buckets.headerNames).sort();
  const schemaTypes = Array.from(buckets.schemaTypes).sort();
  const sourceLocations = Array.from(buckets.sourceLocations).sort();

  const hasSpecificDomSelector = selectors.length > 0;
  const hasSpecificAssetOrHeaderLocator =
    assetUrls.length > 0 ||
    headerNames.length > 0 ||
    sourceLocations.length > 0 ||
    schemaTypes.length > 0;

  const fallbackNotice =
    !hasSpecificDomSelector && !hasSpecificAssetOrHeaderLocator
      ? UI_LABELS.noSpecificSelectorFallback
      : null;

  const summaryPartsEn: string[] = [];
  const summaryPartsAr: string[] = [];

  if (urls.length > 0) {
    summaryPartsEn.push(`URL: ${urls[0]}${urls.length > 1 ? ` (+${urls.length - 1} more)` : ''}`);
    summaryPartsAr.push(
      `الرابط: ${urls[0]}${urls.length > 1 ? ` (+${urls.length - 1} أخرى)` : ''}`,
    );
  }
  if (selectors.length > 0) {
    summaryPartsEn.push(`Selector: ${selectors[0]}`);
    summaryPartsAr.push(`المحدد: ${selectors[0]}`);
  }
  if (headerNames.length > 0) {
    summaryPartsEn.push(`Header/Cookie: ${headerNames.join(', ')}`);
    summaryPartsAr.push(`الترويسة/الكوكي: ${headerNames.join(', ')}`);
  }
  if (assetUrls.length > 0) {
    summaryPartsEn.push(`Resource: ${assetUrls[0]}`);
    summaryPartsAr.push(`المورد: ${assetUrls[0]}`);
  }
  if (sourceLocations.length > 0) {
    summaryPartsEn.push(`Source: ${sourceLocations[0]}`);
    summaryPartsAr.push(`المصدر البرمجي: ${sourceLocations[0]}`);
  }
  if (fallbackNotice) {
    summaryPartsEn.push(fallbackNotice.en);
    summaryPartsAr.push(fallbackNotice.ar);
  }

  return {
    urls,
    selectors,
    assetUrls,
    headerNames,
    schemaTypes,
    sourceLocations,
    hasSpecificDomSelector,
    hasSpecificAssetOrHeaderLocator,
    fallbackNotice,
    summary: {
      en: summaryPartsEn.join(' | ') || UI_LABELS.noSpecificSelectorFallback.en,
      ar: summaryPartsAr.join(' | ') || UI_LABELS.noSpecificSelectorFallback.ar,
    },
  };
}

/**
 * Resolves effective cause confidence strictly bounded by the finding's own
 * confidence & lifecycle status. Never upgrades potential findings to confirmed.
 */
export function resolveCauseClassification(params: {
  readonly kbCauseConfidence: CauseConfidenceLevel;
  readonly rawConfidence: string;
  readonly rawStatus: string;
  readonly confirmedTemplates: readonly BilingualText[];
  readonly possibleTemplates: readonly BilingualText[];
}): {
  readonly effectiveCauseConfidence: CauseConfidenceLevel;
  readonly confirmedCauses: readonly BilingualText[];
  readonly possibleCauses: readonly BilingualText[];
} {
  const normalizedStatus = normalizeFindingLifecycleStatus(params.rawStatus, params.rawConfidence);
  const confBucket = classifyFindingConfidenceBucket(params.rawConfidence);

  if (normalizedStatus === 'needs_manual_review') {
    return {
      effectiveCauseConfidence: 'needs_manual_review',
      confirmedCauses: [],
      possibleCauses: [...params.confirmedTemplates, ...params.possibleTemplates],
    };
  }

  if (confBucket === 'potential' || normalizedStatus === 'potential') {
    return {
      effectiveCauseConfidence: 'potential',
      confirmedCauses: [],
      possibleCauses: [...params.confirmedTemplates, ...params.possibleTemplates],
    };
  }

  return {
    effectiveCauseConfidence: params.kbCauseConfidence,
    confirmedCauses: [...params.confirmedTemplates],
    possibleCauses: [...params.possibleTemplates],
  };
}

function findingEvidenceContainsHeaderOrToken(
  findings: readonly EnrichableFindingInput[],
  tokens: readonly string[],
): boolean {
  for (const f of findings) {
    const rawStr = JSON.stringify(f.evidence ?? '').toLowerCase();
    for (const token of tokens) {
      if (rawStr.includes(token.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

export function selectEvidenceGatedPlatformGuidance(
  templates: readonly PlatformGuidanceTemplate[] | undefined,
  stack: DetectedStackDTO,
  findings: readonly EnrichableFindingInput[],
): readonly GatedPlatformGuidance[] {
  if (!templates || templates.length === 0) return [];

  const result: GatedPlatformGuidance[] = [];
  for (const tpl of templates) {
    let supported = false;
    let evidenceReason: BilingualText = tpl.requiredEvidenceNote;

    switch (tpl.platform) {
      case 'generic':
        supported = true;
        break;
      case 'wordpress':
        supported = stack.isWordPress;
        if (supported && stack.wordPressVersion) {
          evidenceReason = {
            en: `${tpl.requiredEvidenceNote.en} (Detected WordPress v${stack.wordPressVersion})`,
            ar: `${tpl.requiredEvidenceNote.ar} (الإصدار المرصود ${stack.wordPressVersion})`,
          };
        }
        break;
      case 'elementor':
        supported = stack.isElementor;
        break;
      case 'elementor_pro':
        supported = stack.isElementorPro;
        break;
      case 'woocommerce':
        supported = stack.isWooCommerce;
        break;
      case 'cdn_cache':
        supported =
          stack.cdnOrCacheHints.length > 0 ||
          findingEvidenceContainsHeaderOrToken(findings, [
            'cf-ray',
            'x-cache',
            'x-litespeed-cache',
            'x-varnish',
            'x-rocket-cache',
            'cache-control',
          ]);
        if (supported && stack.cdnOrCacheHints.length > 0) {
          evidenceReason = {
            en: `${tpl.requiredEvidenceNote.en} (${stack.cdnOrCacheHints.join(', ')})`,
            ar: `${tpl.requiredEvidenceNote.ar} (${stack.cdnOrCacheHints.join(', ')})`,
          };
        }
        break;
      case 'server_headers':
        supported =
          stack.serverHints.length > 0 ||
          findingEvidenceContainsHeaderOrToken(findings, ['server', 'x-powered-by', 'headerName']);
        break;
    }

    if (supported) {
      result.push({
        platform: tpl.platform,
        evidenceReason,
        summary: tpl.summary,
        steps: tpl.steps,
      });
    }
  }
  return result;
}

export function selectEvidenceGatedCodeExamples(
  templates: readonly CodeExampleTemplate[] | undefined,
  stack: DetectedStackDTO,
  ruleId: string,
  findings: readonly EnrichableFindingInput[],
  exactLocation: ExactAffectedLocation,
): readonly CodeExampleTemplate[] {
  if (!templates || templates.length === 0) return [];
  const upperRule = ruleId.toUpperCase();

  return templates.filter(ex => {
    const tag: EvidenceRequirementTag = ex.requiredEvidenceTag;
    switch (tag) {
      case 'always_relevant':
        return true;
      case 'wordpress_core':
        return stack.isWordPress;
      case 'elementor':
        return stack.isElementor;
      case 'elementor_pro':
        return stack.isElementorPro;
      case 'woocommerce':
        return stack.isWooCommerce;
      case 'cdn_cache':
        return stack.cdnOrCacheHints.length > 0;
      case 'server_headers':
        return stack.serverHints.length > 0;
      case 'cookie_header':
        return upperRule.startsWith('SEC_COOKIE_') || exactLocation.headerNames.length > 0;
      case 'http_header_evidence':
        return upperRule.startsWith('SEC_HEADER_') || exactLocation.headerNames.length > 0;
      case 'tls_handshake':
        return upperRule.startsWith('SEC_TLS_');
      case 'html_meta_evidence':
        return (
          upperRule.startsWith('SEO_TITLE') ||
          upperRule.startsWith('SEO_DESCRIPTION') ||
          upperRule.startsWith('SEO_VIEWPORT') ||
          upperRule.startsWith('SEO_OPENGRAPH') ||
          upperRule.startsWith('SEO_TWITTER') ||
          upperRule.startsWith('SEO_CANONICAL')
        );
      case 'schema_jsonld':
        return upperRule.startsWith('SEO_SCHEMA_');
      case 'robots_txt':
        return upperRule.startsWith('SEO_ROBOTS_');
      case 'sitemap_xml':
        return upperRule.startsWith('SEO_SITEMAP_');
      case 'dom_selector':
        return exactLocation.hasSpecificDomSelector;
      case 'media_asset':
        return (
          upperRule.includes('IMG') ||
          findingEvidenceContainsHeaderOrToken(findings, ['<img', 'src', 'image'])
        );
      case 'css_layout':
        return upperRule.startsWith('RESPONSIVE_') || upperRule.startsWith('LAYOUT_');
      case 'network_request':
        return upperRule.startsWith('HTTP_') || upperRule.startsWith('NET_');
      case 'js_runtime':
        return upperRule.startsWith('JS_') || upperRule.startsWith('BROWSER_CONSOLE_');
      default:
        return false;
    }
  });
}

const SEVERITY_ORDER: Readonly<Record<string, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  informational: 4,
};

function severityRank(severity: string): number {
  return SEVERITY_ORDER[severity.trim().toLowerCase()] ?? 5;
}

function buildDedupeKey(
  f: EnrichableFindingInput,
  category: FindingCategoryId,
  recommendationId: string,
): string {
  const rule = (f.ruleId ?? 'UNKNOWN').trim();
  const sev = (f.severity ?? 'info').toString().trim().toLowerCase();
  const conf = (f.confidence ?? 'potential').toString().trim().toLowerCase();
  const stat = normalizeFindingLifecycleStatus(f.status, f.confidence);
  const sel = (f.selector ?? '').toString().trim();
  return `rule::${rule}::${category}::${sev}::${conf}::${stat}::${sel}::${recommendationId}`;
}

export function matchAndEnrichFindings(
  rawFindings: readonly (EnrichableFindingInput | FindingDTO | ConsolidatedFindingDTO)[],
  options?: MatchAndEnrichOptions,
): RecommendationEnrichmentResult {
  const stackInputs: StackEvidenceFindingInput[] = [];
  for (const raw of rawFindings) {
    const f = raw as EnrichableFindingInput;
    const primaryUrl =
      f.targetUrl ?? (Array.isArray(f.affectedUrls) ? f.affectedUrls[0] : null) ?? null;
    stackInputs.push({
      ruleId: f.ruleId ?? null,
      targetUrl: primaryUrl,
      evidence: f.evidence ?? null,
    });
    if (Array.isArray(f.occurrences)) {
      for (const occ of f.occurrences) {
        stackInputs.push({
          ruleId: f.ruleId ?? null,
          targetUrl: occ.targetUrl ?? primaryUrl,
          evidence: occ.evidence ?? null,
        });
      }
    }
  }

  const detectedStack =
    options?.detectedStack ??
    extractDetectedStack({
      sitePlatformType: options?.sitePlatformType ?? null,
      findings: stackInputs,
    });

  // Group findings deterministically so identical underlying rule + context issues never duplicate guidance
  const groups = new Map<
    string,
    {
      readonly items: EnrichableFindingInput[];
      readonly ruleId: string;
      readonly category: FindingCategoryId;
      readonly recommendationId: string;
    }
  >();

  for (const raw of rawFindings) {
    const f = raw as EnrichableFindingInput;
    const ruleId = (f.ruleId ?? '').trim() || 'UNKNOWN_RULE';
    const category = normalizeFindingCategoryId({
      category: f.category ?? undefined,
      ruleId,
    });
    const lookup = lookupRecommendationByRuleId(ruleId);
    const key = buildDedupeKey(f, category, lookup.entry.recommendationId);

    const existing = groups.get(key);
    if (existing) {
      existing.items.push(f);
    } else {
      groups.set(key, {
        items: [f],
        ruleId,
        category,
        recommendationId: lookup.entry.recommendationId,
      });
    }
  }

  const enrichedItems: EnrichedRecommendationItem[] = [];
  let deduplicatedCount = 0;
  let fallbackCount = 0;

  for (const group of groups.values()) {
    const primary = group.items[0];
    const lookup = lookupRecommendationByRuleId(group.ruleId);
    const entry = lookup.entry;
    if (lookup.matchType === 'fallback') {
      fallbackCount++;
    }
    if (group.items.length > 1) {
      deduplicatedCount += group.items.length - 1;
    }

    const rawSeverity = (primary.severity ?? 'info').toString().trim().toLowerCase();
    const rawConfidence = (primary.confidence ?? 'potential').toString().trim().toLowerCase();
    const rawStatus = (primary.status ?? 'potential').toString().trim().toLowerCase();

    const exactLocation = extractExactAffectedLocation(group.items);
    const causeResolution = resolveCauseClassification({
      kbCauseConfidence: entry.causeConfidence,
      rawConfidence,
      rawStatus,
      confirmedTemplates: entry.confirmedCauseTemplates,
      possibleTemplates: entry.possibleCauseTemplates ?? [],
    });

    const platformGuidance = selectEvidenceGatedPlatformGuidance(
      entry.platformGuidance,
      detectedStack,
      group.items,
    );
    const codeExamples = selectEvidenceGatedCodeExamples(
      entry.codeExamples,
      detectedStack,
      group.ruleId,
      group.items,
      exactLocation,
    );

    const findingIds = new Set<string>();
    let totalOccurrences = 0;
    const allRefs = new Set<string>();
    for (const item of group.items) {
      if (typeof item.id === 'string' && item.id.trim()) findingIds.add(item.id.trim());
      if (Array.isArray(item.originalFindingIds)) {
        for (const oid of item.originalFindingIds) {
          if (typeof oid === 'string' && oid.trim()) findingIds.add(oid.trim());
        }
      }
      totalOccurrences +=
        typeof item.totalOccurrences === 'number' && item.totalOccurrences > 0
          ? item.totalOccurrences
          : 1;
      if (Array.isArray(item.references)) {
        for (const ref of item.references) {
          if (typeof ref === 'string' && ref.trim()) allRefs.add(redactSensitiveText(ref.trim()));
        }
      }
    }

    const primaryRawEvidence =
      group.items.length === 1
        ? redactEvidenceValue(primary.evidence ?? null)
        : group.items.slice(0, 5).map(it => redactEvidenceValue(it.evidence ?? null));

    const preservedOriginalFinding: PreservedOriginalFindingSnapshot = {
      findingIds: Array.from(findingIds).sort(),
      groupSignature: typeof primary.signature === 'string' ? primary.signature : null,
      ruleId: group.ruleId,
      category: group.category,
      title: redactSensitiveText(primary.title ?? group.ruleId),
      description: redactSensitiveText(primary.description ?? ''),
      severity: rawSeverity,
      confidence: rawConfidence,
      status: rawStatus,
      targetUrl: redactSensitiveText(primary.targetUrl ?? exactLocation.urls[0] ?? ''),
      remediation: primary.remediation ? redactSensitiveText(primary.remediation) : null,
      references: Array.from(allRefs).sort(),
      preservedEvidence: primaryRawEvidence,
    };

    enrichedItems.push({
      recommendationId: entry.recommendationId,
      ruleId: group.ruleId,
      matchType: lookup.matchType,
      isFallback: lookup.matchType === 'fallback',
      category: group.category,
      severity: rawSeverity,
      originalConfidence: rawConfidence,
      originalStatus: rawStatus,
      effectiveCauseConfidence: causeResolution.effectiveCauseConfidence,
      occurrenceCount: totalOccurrences,
      exactLocation,
      problem: entry.problem,
      impact: entry.impact,
      confirmedCauses: causeResolution.confirmedCauses,
      possibleCauses: causeResolution.possibleCauses,
      locationGuidance: entry.locationGuidance,
      remediationSteps: entry.remediationSteps,
      platformGuidance,
      codeExamples,
      verificationSteps: entry.verificationSteps,
      limitations: entry.limitations,
      references: entry.references,
      preservedOriginalFinding,
    });
  }

  // Deterministic ordering: severity -> category -> ruleId -> primary URL -> recommendationId
  enrichedItems.sort((a, b) => {
    const sDiff = severityRank(a.severity) - severityRank(b.severity);
    if (sDiff !== 0) return sDiff;
    const cDiff = a.category.localeCompare(b.category);
    if (cDiff !== 0) return cDiff;
    const rDiff = a.ruleId.localeCompare(b.ruleId);
    if (rDiff !== 0) return rDiff;
    const uDiff = (a.exactLocation.urls[0] ?? '').localeCompare(b.exactLocation.urls[0] ?? '');
    if (uDiff !== 0) return uDiff;
    return a.recommendationId.localeCompare(b.recommendationId);
  });

  return {
    detectedStack,
    items: enrichedItems,
    deduplicatedCount,
    fallbackCount,
  };
}
