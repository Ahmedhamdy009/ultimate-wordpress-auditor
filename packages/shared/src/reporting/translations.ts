import { z } from 'zod';
import {
  REPORT_LOCALES,
  REPORT_VIEW_MODES,
  type ReportLocale,
  type ReportViewMode,
} from '../schemas/report.js';

export const REPORT_DIRECTIONS = ['ltr', 'rtl'] as const;
export type ReportDirection = (typeof REPORT_DIRECTIONS)[number];

export interface BilingualText {
  readonly en: string;
  readonly ar: string;
}

export const BilingualTextSchema = z.object({
  en: z.string().min(1),
  ar: z.string().min(1),
});

export interface TranslationResolutionResult {
  readonly text: string;
  readonly resolvedLocale: ReportLocale;
  readonly usedFallback: boolean;
  readonly fallbackReason?: 'unsupported_locale' | 'missing_translation' | 'missing_key';
}

export function normalizeReportLocale(locale: unknown): ReportLocale {
  if (typeof locale === 'string') {
    const trimmed = locale.trim().toLowerCase();
    if (trimmed === 'ar' || trimmed.startsWith('ar-')) {
      return 'ar';
    }
    if (trimmed === 'en' || trimmed.startsWith('en-')) {
      return 'en';
    }
  }
  return 'en';
}

export function normalizeReportViewMode(viewMode: unknown): ReportViewMode {
  if (typeof viewMode === 'string') {
    const trimmed = viewMode.trim().toLowerCase();
    if (trimmed === 'simple' || trimmed === 'technical' || trimmed === 'dual') {
      return trimmed;
    }
  }
  return 'dual';
}

export function getLocaleDirection(
  locale: ReportLocale | string | null | undefined,
): ReportDirection {
  const normalized = normalizeReportLocale(locale);
  return normalized === 'ar' ? 'rtl' : 'ltr';
}

export function resolveBilingualText(
  text: Partial<BilingualText> | null | undefined,
  locale: ReportLocale | string | null | undefined,
  fallbackText = '',
): TranslationResolutionResult {
  const normalizedLocale = normalizeReportLocale(locale);
  const rawLocaleValid =
    typeof locale === 'string' &&
    (REPORT_LOCALES as readonly string[]).includes(locale.trim().toLowerCase());

  if (!text) {
    return {
      text: fallbackText,
      resolvedLocale: 'en',
      usedFallback: true,
      fallbackReason: 'missing_key',
    };
  }

  const primary = text[normalizedLocale];
  if (typeof primary === 'string' && primary.trim().length > 0) {
    return {
      text: primary,
      resolvedLocale: normalizedLocale,
      usedFallback: !rawLocaleValid && locale !== undefined && locale !== null,
      ...(!rawLocaleValid && locale !== undefined && locale !== null
        ? { fallbackReason: 'unsupported_locale' as const }
        : {}),
    };
  }

  const alternateLocale: ReportLocale = normalizedLocale === 'ar' ? 'en' : 'ar';
  const alternate = text[alternateLocale];
  if (typeof alternate === 'string' && alternate.trim().length > 0) {
    return {
      text: alternate,
      resolvedLocale: alternateLocale,
      usedFallback: true,
      fallbackReason: 'missing_translation',
    };
  }

  return {
    text: fallbackText,
    resolvedLocale: 'en',
    usedFallback: true,
    fallbackReason: 'missing_key',
  };
}

/**
 * UI & Section headings dictionary (EN / AR).
 */
export const UI_LABELS = {
  reportTitleDefault: {
    en: 'Website & WordPress Technical Audit Report',
    ar: 'تقرير الفحص التقني للموقع وووردبريس',
  },
  executiveSummary: {
    en: 'Executive Summary',
    ar: 'الملخص التنفيذي',
  },
  healthOverview: {
    en: 'Overall Health Overview',
    ar: 'نظرة عامة على صحة الموقع',
  },
  healthIndexLabel: {
    en: 'Evidence-Based Health Index',
    ar: 'مؤشر الصحة المبني على الأدلة',
  },
  auditCoverageLabel: {
    en: 'Audit Coverage',
    ar: 'نطاق تغطية الفحص',
  },
  auditConfidenceLabel: {
    en: 'Audit Confidence',
    ar: 'درجة موثوقية الفحص',
  },
  dimensionBreakdown: {
    en: 'Coverage Dimension Breakdown',
    ar: 'تفصيل أبعاد التغطية',
  },
  detectedStackSection: {
    en: 'Detected Technology Stack (Evidence-Gated)',
    ar: 'البنية التقنية المكتشفة بالأدلة',
  },
  chartsSection: {
    en: 'Visual Analytics & Distributions',
    ar: 'التحليلات الرسومية والتوزيعات',
  },
  findingsAndRemediation: {
    en: 'Findings & Actionable Remediation Guidance',
    ar: 'الملاحظات وإرشادات المعالجة العملية',
  },
  problemSummary: {
    en: 'Problem Summary',
    ar: 'ملخص المشكلة',
  },
  impactAnalysis: {
    en: 'Actual Impact',
    ar: 'التأثير الفعلي',
  },
  affectedLocation: {
    en: 'Affected Location',
    ar: 'الموقع المتأثر بالتحديد',
  },
  affectedUrls: {
    en: 'Affected URLs',
    ar: 'الروابط المتأثرة',
  },
  confirmedCauses: {
    en: 'Confirmed Causes',
    ar: 'الأسباب المؤكدة بالأدلة',
  },
  possibleCauses: {
    en: 'Possible Contributing Causes (Requires Verification)',
    ar: 'أسباب محتملة إضافية (تحتاج تحققاً)',
  },
  platformSpecificGuidance: {
    en: 'Platform & Stack Guidance',
    ar: 'إرشادات مخصصة للمنصة المكتشفة',
  },
  remediationSteps: {
    en: 'Ordered Remediation Steps',
    ar: 'خطوات المعالجة المرتبة',
  },
  codeExampleLabel: {
    en: 'Reference Code / Configuration Example',
    ar: 'مثال مرجعي للكود أو الإعدادات',
  },
  verificationSteps: {
    en: 'How to Verify the Fix',
    ar: 'خطوات التحقق من الإصلاح',
  },
  knownLimitations: {
    en: 'Scope & Limitations',
    ar: 'حدود الفحص والقيود',
  },
  rawEvidenceLabel: {
    en: 'Preserved Raw Evidence',
    ar: 'الأدلة الخام المحفوظة',
  },
  referencesLabel: {
    en: 'Technical References',
    ar: 'المراجع التقنية',
  },
  noSpecificSelectorFallback: {
    en: 'URL / Document-level observation (no specific DOM element selector)',
    ar: 'ملاحظة على مستوى الصفحة أو الاستجابة (لا يوجد محدد عنصر DOM محدد)',
  },
  readOnlyAuditNotice: {
    en: 'Read-only passive and browser observation only. No automatic changes were applied to the target site.',
    ar: 'تم الفحص في وضع القراءة فقط دون تعديل الموقع المستهدف، ولا يطبق النظام أي إصلاح تلقائي.',
  },
  laboratoryContextNotice: {
    en: 'Performance timings reflect controlled laboratory audit runs rather than field user monitoring (CrUX).',
    ar: 'قياسات الأداء تعكس ظروف الاختبار المعملي أثناء الفحص ولا تمثل بيانات المستخدمين الفعلية (CrUX).',
  },
  noComplianceCertificationNotice: {
    en: 'Automated findings do not constitute legal WCAG compliance certification or a full manual penetration test.',
    ar: 'النتائج الآلية لا تمثل شهادة مطابقة قانونية لمعايير WCAG ولا تغني عن اختبار الاختراق اليدوي الشامل.',
  },
  fallbackNotice: {
    en: 'General fallback guidance shown because no rule-specific knowledge base entry matched verbatim; raw finding details remain authoritative.',
    ar: 'يتم عرض إرشاد عام احتياطي لعدم مطابقة قاعدة معرفة محددة لهذا المعرف، وتبقى تفاصيل النتيجة الأصلية هي المرجع الأساسي.',
  },
  viewModeSimpleLabel: {
    en: 'Simple View',
    ar: 'العرض المبسط',
  },
  viewModeTechnicalLabel: {
    en: 'Technical View',
    ar: 'العرض التقني',
  },
  viewModeDualLabel: {
    en: 'Dual View (Simple + Technical)',
    ar: 'العرض المزدوج (مبسط + تقني)',
  },
  occurrencesLabel: {
    en: 'Occurrences',
    ar: 'عدد التكرارات',
  },
  evidenceOnlyDisclaimer: {
    en: 'Verify in a staging environment before applying changes to production.',
    ar: 'يُنصح باختبار التعديل على بيئة تجريبية (Staging) قبل تطبيقه على الموقع المباشر.',
  },
} as const satisfies Record<string, BilingualText>;

export const HEALTH_BAND_LABELS_I18N: Record<string, BilingualText> = {
  healthy: { en: 'Healthy', ar: 'سليم' },
  needs_attention: { en: 'Needs Attention', ar: 'يحتاج إلى متابعة' },
  at_risk: { en: 'At Risk', ar: 'معرّض للخطر' },
  critical: { en: 'Critical', ar: 'حرج' },
  unavailable: { en: 'Unavailable', ar: 'غير متاح' },
};

export const CONFIDENCE_BAND_LABELS_I18N: Record<string, BilingualText> = {
  high: { en: 'High Confidence', ar: 'موثوقية عالية' },
  moderate: { en: 'Moderate Confidence', ar: 'موثوقية متوسطة' },
  low: { en: 'Low Confidence', ar: 'موثوقية منخفضة' },
  very_low: { en: 'Very Low Confidence', ar: 'موثوقية منخفضة جداً' },
};

export const DIMENSION_STATUS_LABELS_I18N: Record<string, BilingualText> = {
  available: { en: 'Available (Exact)', ar: 'متاح (دقيق)' },
  partial: { en: 'Partial Coverage', ar: 'تغطية جزئية' },
  approximated: { en: 'Approximated', ar: 'تقديري' },
  excluded: { en: 'Excluded', ar: 'مستبعد' },
  unavailable: { en: 'Unavailable', ar: 'غير متاح' },
};

export const DIMENSION_LABELS_I18N: Record<string, BilingualText> = {
  D1: {
    en: 'D1 — Crawl & Page Reachability Coverage',
    ar: 'D1 — تغطية الزحف والوصول إلى الصفحات',
  },
  D2: {
    en: 'D2 — Static HTTP, Header, SEO & TLS Checks',
    ar: 'D2 — الفحوص الثابتة للاستجابة والترويسات وSEO وTLS',
  },
  D3: {
    en: 'D3 — Browser Runtime & Accessibility Checks',
    ar: 'D3 — فحوص بيئة المتصفح وإمكانية الوصول',
  },
  D4: {
    en: 'D4 — Responsive Viewport & Layout Stability (CLS)',
    ar: 'D4 — الاستجابة عبر الشاشات واستقرار التخطيط (CLS)',
  },
};

export const SEVERITY_LABELS_I18N: Record<string, BilingualText> = {
  critical: { en: 'Critical', ar: 'حرج' },
  high: { en: 'High', ar: 'مرتفع' },
  medium: { en: 'Medium', ar: 'متوسط' },
  low: { en: 'Low', ar: 'منخفض' },
  info: { en: 'Informational', ar: 'معلوماتي' },
  informational: { en: 'Informational', ar: 'معلوماتي' },
};

export const STATUS_LABELS_I18N: Record<string, BilingualText> = {
  confirmed: { en: 'Confirmed', ar: 'مؤكد' },
  firm: { en: 'Firm Evidence', ar: 'أدلة قوية' },
  potential: { en: 'Potential', ar: 'محتمل' },
  needs_manual_review: { en: 'Needs Manual Review', ar: 'يتطلب مراجعة يدوية' },
  resolved: { en: 'Resolved', ar: 'تم الحل' },
  false_positive: { en: 'False Positive', ar: 'إنذار كاذب' },
  ignored: { en: 'Ignored', ar: 'متجاهَل' },
  fixed: { en: 'Fixed', ar: 'تم الإصلاح' },
  accepted_risk: { en: 'Accepted Risk', ar: 'مخاطرة مقبولة' },
  retest_required: { en: 'Retest Required', ar: 'يتطلب إعادة فحص' },
  active: { en: 'Active', ar: 'نشط' },
};

export const CAUSE_CONFIDENCE_LABELS_I18N: Record<string, BilingualText> = {
  confirmed: {
    en: 'Confirmed by Direct Evidence',
    ar: 'مؤكد بأدلة مباشرة من الفحص',
  },
  potential: {
    en: 'Potential Cause (Verify Context)',
    ar: 'سبب محتمل (يلزم التحقق من السياق)',
  },
  mixed: {
    en: 'Confirmed Issue with Contextual Contributing Factors',
    ar: 'مشكلة مؤكدة مع عوامل مساهمة محتملة',
  },
  needs_manual_review: {
    en: 'Needs Manual Verification',
    ar: 'يتطلب فحصاً ومراجعة يدوية',
  },
};

export const CATEGORY_LABELS_I18N: Record<string, BilingualText> = {
  accessibility: { en: 'Accessibility (WCAG)', ar: 'إمكانية الوصول (WCAG)' },
  'accessibility-best-practice': {
    en: 'Accessibility Best Practices',
    ar: 'أفضل ممارسات إمكانية الوصول',
  },
  security: { en: 'Security & Hardening', ar: 'الأمان وتحصين الإعدادات' },
  'runtime-network': { en: 'Runtime & Network', ar: 'أخطاء التشغيل والشبكة' },
  'responsive-design': { en: 'Responsive Design', ar: 'التصميم المتجاوب' },
  'layout-stability': { en: 'Layout Stability (CLS)', ar: 'استقرار التخطيط (CLS)' },
  'technical-seo': { en: 'Technical SEO', ar: 'تحسين محركات البحث التقني' },
  'static-performance': { en: 'Performance & Assets', ar: 'الأداء وحجم الأصول' },
  'content-quality': { en: 'Content Quality', ar: 'جودة المحتوى' },
  'dom-quality': { en: 'DOM Structure Quality', ar: 'جودة بنية DOM' },
  'content-structure': { en: 'Content & Headings Structure', ar: 'بنية المحتوى والعناوين' },
  wordpress: { en: 'WordPress Platform', ar: 'منصة ووردبريس' },
  system: { en: 'Audit Telemetry & System', ar: 'نظام الفحص والقياس' },
};

export const REASON_CODE_LABELS_I18N: Record<string, BilingualText> = {
  path1_exact_triple: {
    en: 'Exact crawl telemetry counters recorded (attempted, scanned, failed).',
    ar: 'تم تسجيل عدادات الزحف الدقيقة (المحاولات، الناجحة، الفاشلة).',
  },
  path2_missing_crawl_failed: {
    en: 'Crawl failure count omitted; derived from crawled attempts and scanned pages.',
    ar: 'عدد صفحات فشل الزحف غير منفصل؛ تم احتساب النسبة من إجمالي المحاولات والصفحات المفحوصة.',
  },
  path3_missing_urls_crawled: {
    en: 'Attempted URL total omitted; coverage derived from scanned and failed counts.',
    ar: 'إجمالي الروابط المُحاوَلة غير متوفر؛ تم الاشتقاق من الصفحات المفحوصة والفاشلة.',
  },
  path4_h1_crawler_only_proven: {
    en: 'Historical scan fallback using verified crawler-only failure count.',
    ar: 'اعتماد احتياطي لفحص تاريخي بعدد إخفاقات الزاحف الموثق.',
  },
  path4_h2_mixed_or_missing: {
    en: 'Historical scan telemetry contains mixed or incomplete crawl failure counters.',
    ar: 'بيانات الفحص التاريخي تحتوي على عدادات فشل مختلطة أو غير مكتملة.',
  },
  d1_crawl_telemetry_invalid_count: {
    en: 'Invalid or overflow crawl counter detected; crawl dimension marked unavailable.',
    ar: 'تم رصد عداد زحف غير صالح؛ تعذّر احتساب بُعد تغطية الزحف.',
  },
  d1_crawl_telemetry_mismatch_attempts_gt_outcomes: {
    en: 'Crawl attempts exceed recorded outcomes (scanned + failed).',
    ar: 'عدد محاولات الزحف أكبر من مجموع الصفحات الناجحة والفاشلة المسجل.',
  },
  d1_crawl_telemetry_mismatch_outcomes_exceed_attempts: {
    en: 'Recorded outcomes exceed total crawl attempts.',
    ar: 'النتائج المسجلة تتجاوز إجمالي محاولات الزحف.',
  },
  d1_historical_missing_crawl_failed_split: {
    en: 'Crawler-only failure count was not stored separately in this historical scan.',
    ar: 'لم يُخزَّن عدد إخفاقات الزاحف منفصلاً في هذا الفحص التاريخي.',
  },
  d1_historical_missing_urls_crawled: {
    en: 'Historical scan lacks explicit urlsCrawled counter; coverage is approximated.',
    ar: 'يفتقد الفحص التاريخي إلى عداد urlsCrawled؛ التغطية تقديرية.',
  },
  d1_historical_mixed_pages_failed: {
    en: 'Historical pagesFailed counter may combine crawler and analyzer failures.',
    ar: 'عداد pagesFailed التاريخي قد يدمج إخفاقات الزحف مع إخفاقات التحليل.',
  },
  d1_missing_denominator_units: {
    en: 'Missing crawl denominator unit count.',
    ar: 'مقام بُعد تغطية الزحف غير متاح.',
  },
  d1_missing_pages_scanned_numerator: {
    en: 'Missing scanned page numerator.',
    ar: 'بسط عدد الصفحات المفحوصة غير متاح.',
  },
  d2_historical_partial_static_approximated: {
    en: 'Static check denominator was approximated from partial telemetry.',
    ar: 'تم تقريب مقام الفحوص الثابتة من بيانات القياس المتاحة.',
  },
  d3_historical_a11y_candidates_from_browser_candidates: {
    en: 'Accessibility candidate pages inferred from browser candidate queue count.',
    ar: 'تم استنتاج صفحات فحص إمكانية الوصول من مرشحي المتصفح.',
  },
  d3_historical_a11y_candidates_from_pages_scanned: {
    en: 'Accessibility candidate count approximated from scanned page total.',
    ar: 'تم تقريب مرشحي إمكانية الوصول من إجمالي الصفحات المفحوصة.',
  },
  d3_historical_missing_a11y_completed_count: {
    en: 'Explicit accessibility completed count missing; approximated from browser telemetry.',
    ar: 'العداد الصريح لصفحات إمكانية الوصول المكتملة مفقود؛ تم تقريبه.',
  },
  d3_historical_runtime_from_browser_pages: {
    en: 'Runtime browser coverage derived from audited browser page count.',
    ar: 'تم اشتقاق تغطية التشغيل من عدد الصفحات المفحوصة بالمتصفح.',
  },
  d4_historical_cls_from_findings: {
    en: 'CLS coverage inferred from persisted layout shift telemetry/findings.',
    ar: 'تم استدلال تغطية CLS من بيانات أو ملاحظات إزاحة التخطيط المحفوظة.',
  },
  d4_historical_cls_from_summary: {
    en: 'CLS coverage derived from browser performance summary.',
    ar: 'تم اشتقاق تغطية CLS من ملخص قياسات المتصفح.',
  },
  d4_historical_network_from_summary: {
    en: 'Responsive/network viewport signal derived from summary metrics.',
    ar: 'تم اشتقاق إشارة التغطية التفاعلية من ملخص الفحص.',
  },
  d4_historical_screenshots_count: {
    en: 'Responsive viewport coverage backed by persisted screenshot count.',
    ar: 'تغطية الشاشات المتجاوبة مدعومة بعدد لقطات الشاشة المحفوظة.',
  },
  d4_responsive_default_viewport_count_assumed: {
    en: 'Standard viewport profile count assumed where explicit denominator was omitted.',
    ar: 'تم افتراض عدد شاشات العرض القياسي لعدم تسجيل المقام صراحة.',
  },
  provisional_incomplete_scan: {
    en: 'Scan did not finish cleanly or omitted final confirmation.',
    ar: 'الفحص لم يكتمل بالكامل أو يفتقد تأكيد الاكتمال النهائي.',
  },
  insufficient_evidence: {
    en: 'Insufficient executed telemetry to compute a definitive score.',
    ar: 'الأدلة المنفذة غير كافية لإصدار تقييم حاسم.',
  },
  not_applicable: {
    en: 'Check dimension was not applicable or disabled in scan configuration.',
    ar: 'البُعد غير مطبّق أو غير مفعّل في إعدادات هذا الفحص.',
  },
  no_findings_recorded: {
    en: 'No findings recorded for executed checks.',
    ar: 'لم تُسجَّل أي ملاحظات سلبية ضمن الفحوص المنفذة.',
  },
};

export interface DictionaryLookupOptions {
  readonly dictionary?: Readonly<Record<string, BilingualText>>;
  readonly key: string;
  readonly locale?: ReportLocale | string | null;
  readonly fallback?: string;
}

export function getTranslatedLabel(options: DictionaryLookupOptions): TranslationResolutionResult {
  const dict: Readonly<Record<string, BilingualText>> = options.dictionary ?? UI_LABELS;
  const entry = dict[options.key];
  if (!entry) {
    return {
      text: options.fallback ?? options.key,
      resolvedLocale: 'en',
      usedFallback: true,
      fallbackReason: 'missing_key',
    };
  }
  return resolveBilingualText(entry, options.locale, options.fallback ?? options.key);
}

export function isSupportedReportLocale(locale: unknown): locale is ReportLocale {
  return typeof locale === 'string' && (REPORT_LOCALES as readonly string[]).includes(locale);
}

export function isSupportedReportViewMode(mode: unknown): mode is ReportViewMode {
  return typeof mode === 'string' && (REPORT_VIEW_MODES as readonly string[]).includes(mode);
}
