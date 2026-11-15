import { bi, dual, step, RecommendationEntrySchema, type RecommendationEntry } from './kb/types.js';
import { SECURITY_KB_ENTRIES } from './kb/kb-security.js';
import { SEO_KB_ENTRIES } from './kb/kb-seo.js';
import { PERFORMANCE_RESPONSIVE_KB_ENTRIES } from './kb/kb-performance-responsive.js';
import { RUNTIME_CONTENT_WP_A11Y_KB_ENTRIES } from './kb/kb-runtime-content-wp-a11y.js';

export * from './kb/types.js';

/**
 * Safe deterministic fallback used only when a finding ruleId has no exact or
 * prefix match in the Knowledge Base. Never fabricates causes or code snippets.
 */
export const UNKNOWN_RULE_FALLBACK_ENTRY: RecommendationEntry = {
  recommendationId: 'rec-fallback-unknown-rule',
  ruleIds: [],
  category: 'system',
  supportedPlatforms: ['generic'],
  causeConfidence: 'potential',
  problem: dual(
    'An audit finding was recorded without a dedicated entry in the local recommendation knowledge base.',
    'تم تسجيل ملاحظة فحص لا تملك بطاقة إرشاد مخصصة في قاعدة المعرفة الحالية.',
    'No rule-specific knowledge base mapping matched this `ruleId`. The original raw finding title, description, remediation text, and evidence remain authoritative.',
    'لا توجد مطابقة محددة لهذا المعرف (`ruleId`) في قاعدة المعرفة؛ تبقى تفاصيل النتيجة الأصلية والأدلة الخام هي المرجع الأساسي.',
  ),
  impact: dual(
    'Review the original finding severity, description, and affected URL to assess practical impact.',
    'راجع درجة الخطورة ووصف النتيجة الأصلية والرابط المتأثر لتقدير الأثر الفعلي.',
    'Preserved without assuming or upgrading impact beyond the raw scanner observation.',
    'محفوظ دون افتراض أو تضخيم للأثر يتجاوز ما رصده الفاحص.',
  ),
  confirmedCauseTemplates: [],
  possibleCauseTemplates: [
    bi(
      'Refer directly to the original finding description and preserved evidence without extrapolating unverified causes.',
      'ارجع مباشرة إلى وصف النتيجة الأصلية والأدلة المحفوظة دون افتراض أسباب غير موثقة.',
    ),
  ],
  locationGuidance: dual(
    'Review the target URL and preserved evidence details from the original finding.',
    'راجع الرابط المستهدف وتفاصيل الأدلة المحفوظة في النتيجة الأصلية.',
    'Inspect `targetUrl` and `evidence` keys directly on the persisted finding record.',
    'افحص حقل `targetUrl` وبيانات `evidence` مباشرة في سجل النتيجة.',
  ),
  remediationSteps: [
    step(
      1,
      'Review the original finding guidance and preserved evidence in a staging environment before applying manual changes.',
      'راجع نص التوجيه المرفق في النتيجة الأصلية والأدلة في بيئة تجريبية قبل تطبيق أي تعديل يدوي.',
      'Follow the raw finding `remediation` text and references while verifying against `evidence` telemetry.',
      'اتبع إرشاد المعالجة الأصلي والمراجع الموثقة مع التحقق من الأدلة المسجلة.',
    ),
  ],
  verificationSteps: [
    step(
      1,
      'Manually confirm the reported condition on staging and run a follow-up scan.',
      'تحقق يدوياً من الحالة المرصودة في بيئة تجريبية ثم أعد تشغيل الفحص.',
      'Confirm the underlying observation resolves cleanly on subsequent scan.',
      'تأكد من زوال الملاحظة عند إعادة تشغيل الفحص.',
    ),
  ],
  limitations: [
    bi(
      'Fallback entry used: no rule-specific templates, platform heuristics, or code examples are fabricated for unrecognized rule IDs.',
      'تم استخدام الإرشاد الاحتياطي العام: لا يتم توليد أمثلة كود أو أسباب مفترضة لقواعد غير مسجلة.',
    ),
  ],
  references: [],
  isFallback: true,
};

export const RECOMMENDATION_KB_ENTRIES: readonly RecommendationEntry[] = [
  ...SECURITY_KB_ENTRIES,
  ...SEO_KB_ENTRIES,
  ...PERFORMANCE_RESPONSIVE_KB_ENTRIES,
  ...RUNTIME_CONTENT_WP_A11Y_KB_ENTRIES,
];

interface CompiledKBIndex {
  readonly exactMap: ReadonlyMap<string, RecommendationEntry>;
  readonly byIdMap: ReadonlyMap<string, RecommendationEntry>;
  readonly prefixList: readonly { readonly prefix: string; readonly entry: RecommendationEntry }[];
}

function buildCompiledIndex(entries: readonly RecommendationEntry[]): CompiledKBIndex {
  const exactMap = new Map<string, RecommendationEntry>();
  const byIdMap = new Map<string, RecommendationEntry>();
  const prefixList: { readonly prefix: string; readonly entry: RecommendationEntry }[] = [];

  for (const entry of entries) {
    RecommendationEntrySchema.parse(entry);

    if (byIdMap.has(entry.recommendationId)) {
      throw new Error(`Duplicate recommendationId in KB: ${entry.recommendationId}`);
    }
    byIdMap.set(entry.recommendationId, entry);

    for (const ruleId of entry.ruleIds) {
      const normalized = ruleId.trim();
      if (exactMap.has(normalized)) {
        throw new Error(
          `Duplicate exact ruleId mapping '${normalized}' between '${exactMap.get(normalized)!.recommendationId}' and '${entry.recommendationId}'`,
        );
      }
      exactMap.set(normalized, entry);
    }

    if (entry.ruleIdPrefixes) {
      for (const prefix of entry.ruleIdPrefixes) {
        prefixList.push({ prefix, entry });
      }
    }
  }

  // Sort longest prefixes first for deterministic specificity (e.g. 'a11y-review-' before 'a11y-')
  prefixList.sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));

  RecommendationEntrySchema.parse(UNKNOWN_RULE_FALLBACK_ENTRY);

  return { exactMap, byIdMap, prefixList };
}

const COMPILED_KB_INDEX = buildCompiledIndex(RECOMMENDATION_KB_ENTRIES);

export interface RecommendationLookupResult {
  readonly entry: RecommendationEntry;
  readonly matchType: 'exact' | 'prefix' | 'fallback';
  readonly matchedPattern: string | null;
}

/**
 * Deterministically resolves a finding ruleId against exact KB entries,
 * longest prefix families (e.g., axe-core dynamic rules), or safe fallback.
 */
export function lookupRecommendationByRuleId(
  ruleId: string | null | undefined,
): RecommendationLookupResult {
  const trimmed = typeof ruleId === 'string' ? ruleId.trim() : '';
  if (!trimmed) {
    return {
      entry: UNKNOWN_RULE_FALLBACK_ENTRY,
      matchType: 'fallback',
      matchedPattern: null,
    };
  }

  const exact = COMPILED_KB_INDEX.exactMap.get(trimmed);
  if (exact) {
    return {
      entry: exact,
      matchType: 'exact',
      matchedPattern: trimmed,
    };
  }

  const lower = trimmed.toLowerCase();
  for (const candidate of COMPILED_KB_INDEX.prefixList) {
    if (trimmed.startsWith(candidate.prefix) || lower.startsWith(candidate.prefix.toLowerCase())) {
      return {
        entry: candidate.entry,
        matchType: 'prefix',
        matchedPattern: candidate.prefix,
      };
    }
  }

  return {
    entry: UNKNOWN_RULE_FALLBACK_ENTRY,
    matchType: 'fallback',
    matchedPattern: null,
  };
}

export function getRecommendationById(recommendationId: string): RecommendationEntry | undefined {
  return COMPILED_KB_INDEX.byIdMap.get(recommendationId);
}

export function getAllRecommendationEntries(): readonly RecommendationEntry[] {
  return RECOMMENDATION_KB_ENTRIES;
}

export function validateRecommendationKnowledgeBase(): {
  readonly valid: boolean;
  readonly entryCount: number;
  readonly exactRuleCount: number;
  readonly prefixPatternCount: number;
} {
  return {
    valid: true,
    entryCount: RECOMMENDATION_KB_ENTRIES.length,
    exactRuleCount: COMPILED_KB_INDEX.exactMap.size,
    prefixPatternCount: COMPILED_KB_INDEX.prefixList.length,
  };
}
