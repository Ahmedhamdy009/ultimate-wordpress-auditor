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
  healthy: { en: 'Healthy', ar: 'سليم (مستقر)' },
  needs_attention: { en: 'Needs Attention', ar: 'يتطلب انتباهًا' },
  issues_detected: { en: 'Issues Detected', ar: 'مشكلات مكتشفة' },
  action_required: { en: 'Action Required', ar: 'يتطلب إجراءً عاجلًا' },
  provisional_incomplete_scan: {
    en: 'Provisional / Incomplete Scan',
    ar: 'تقييم مبدئي / فحص غير مكتمل',
  },
  insufficient_evidence: { en: 'Insufficient Evidence', ar: 'أدلة غير كافية' },
  at_risk: { en: 'At Risk', ar: 'معرّض للخطر' },
  critical: { en: 'Critical', ar: 'حرج' },
  unavailable: { en: 'Unavailable', ar: 'غير متاح' },
};

export const CONFIDENCE_BAND_LABELS_I18N: Record<string, BilingualText> = {
  high: { en: 'High Confidence', ar: 'موثوقية عالية' },
  moderate: { en: 'Moderate Confidence', ar: 'موثوقية متوسطة' },
  low: { en: 'Low Confidence', ar: 'موثوقية منخفضة' },
  insufficient: { en: 'Insufficient Confidence', ar: 'موثوقية غير كافية' },
  very_low: { en: 'Very Low Confidence', ar: 'موثوقية منخفضة جداً' },
};

export const DIMENSION_STATUS_LABELS_I18N: Record<string, BilingualText> = {
  exact: { en: 'Exact', ar: 'دقيق' },
  available: { en: 'Available (Exact)', ar: 'متاح (دقيق)' },
  full: { en: 'Full Coverage', ar: 'تغطية كاملة' },
  partial: { en: 'Partial Coverage', ar: 'تغطية جزئية' },
  approximated: { en: 'Approximated', ar: 'تقديري' },
  excluded: { en: 'Excluded', ar: 'مستبعد' },
  unavailable: { en: 'Unavailable', ar: 'غير متاح' },
  not_applicable: { en: 'Not Applicable', ar: 'غير مطبّق' },
};

export const DIMENSION_LABELS_I18N: Record<string, BilingualText> = {
  d1: {
    en: 'D1 — Crawl & Page Reachability Coverage',
    ar: 'D1 — تغطية الزحف والوصول إلى الصفحات',
  },
  d2: {
    en: 'D2 — Static HTTP, Header, SEO & TLS Checks',
    ar: 'D2 — الفحوص الثابتة للاستجابة والترويسات وSEO وTLS',
  },
  d3: {
    en: 'D3 — Browser Runtime & Accessibility Checks',
    ar: 'D3 — فحوص بيئة المتصفح وإمكانية الوصول',
  },
  d4: {
    en: 'D4 — Responsive Viewport & Layout Stability (CLS)',
    ar: 'D4 — الاستجابة عبر الشاشات واستقرار التخطيط (CLS)',
  },
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

export const SCAN_STATUS_LABELS_I18N: Record<string, BilingualText> = {
  pending: { en: 'Pending', ar: 'قيد الانتظار' },
  running: { en: 'Running', ar: 'قيد التنفيذ' },
  completed: { en: 'Completed', ar: 'مكتمل' },
  completed_partial: { en: 'Completed (Partial)', ar: 'مكتمل جزئياً' },
  failed: { en: 'Failed', ar: 'فشل الفحص' },
  cancelled: { en: 'Cancelled', ar: 'ملغى' },
  timed_out: { en: 'Timed Out', ar: 'انتهت المهلة' },
};

export const HEALTH_INDEX_DISCLAIMER_BILINGUAL: BilingualText = {
  en: 'Internal audit health metric (0-100) derived from observed findings and executed coverage; not a legal accessibility certification, search ranking guarantee, or penetration test.',
  ar: 'مؤشر صحة فحصي داخلي (0-100) مشتق من الملاحظات المرصودة ونطاق التغطية المنفذ فقط؛ ولا يمثل شهادة مطابقة قانونية لإمكانية الوصول أو ضماناً لترتيب البحث أو اختبار اختراق شاملاً.',
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

/**
 * Shared Desktop Dashboard, Charts, Performance & Interactive Findings labels (EN / AR).
 * Centralized in @auditor/shared so the React renderer never duplicates translation dictionaries.
 */
export const DESKTOP_DASHBOARD_LABELS_I18N = {
  scanInspectionDashboard: {
    en: 'Scan Inspection & Health Dashboard',
    ar: 'لوحة فحص النتائج وصحة الموقع',
  },
  selectedScanLabel: {
    en: 'Selected Scan',
    ar: 'الفحص المحدد',
  },
  targetWebsiteLabel: {
    en: 'Target Website',
    ar: 'الموقع المستهدف',
  },
  scanDateLabel: {
    en: 'Scan Date',
    ar: 'تاريخ الفحص',
  },
  scanStatusLabel: {
    en: 'Scan Status',
    ar: 'حالة الفحص',
  },
  scanDurationLabel: {
    en: 'Duration',
    ar: 'مدة الفحص',
  },
  healthBandLabel: {
    en: 'Health Band',
    ar: 'تصنيف الحالة',
  },
  provisionalBadge: {
    en: 'Provisional',
    ar: 'تقييم مبدئي',
  },
  approximatedBadge: {
    en: 'Approximated',
    ar: 'تقديري',
  },
  unavailableValue: {
    en: 'Unavailable',
    ar: 'غير متاح',
  },
  measurementLimitationsHeading: {
    en: 'Measurement Scope & Limitations',
    ar: 'نطاق القياس والقيود',
  },
  telemetryReasonsHeading: {
    en: 'Coverage & Telemetry Notes',
    ar: 'ملاحظات التغطية والقياس',
  },
  executedChecksLabel: {
    en: 'Executed',
    ar: 'المنفَّذ',
  },
  eligibleChecksLabel: {
    en: 'Eligible',
    ar: 'المؤهَّل',
  },
  coverageRatioLabel: {
    en: 'Coverage Ratio',
    ar: 'نسبة التغطية',
  },
  dimensionWeightLabel: {
    en: 'Weight',
    ar: 'الوزن',
  },
  pagesUnitLabel: {
    en: 'pages',
    ar: 'صفحات',
  },
  modulesUnitLabel: {
    en: 'modules',
    ar: 'وحدات',
  },
  subchecksLabel: {
    en: 'Sub-checks',
    ar: 'الفحوص الفرعية',
  },
  historicalCompatibilityNotice: {
    en: 'Historical scan record: missing telemetry counters are marked as approximated or unavailable rather than assumed successful.',
    ar: 'سجل فحص تاريخي: العدادات غير المسجلة تُعرض كتقديرية أو غير متاحة ولا تُحتسب كناجحة تلقائياً.',
  },
  noScanSelectedTitle: {
    en: 'Select a Scan to Inspect',
    ar: 'اختر فحصاً لعرض تفاصيله',
  },
  noScanSelectedHint: {
    en: 'Choose any scan run from the list to view its Health Triad, D1–D4 coverage, analytics charts, and actionable findings.',
    ar: 'اختر أي عملية فحص من القائمة لعرض مؤشر الصحة وتغطية الأبعاد الأربعة والمخططات والتوصيات.',
  },
  noStackDetected: {
    en: 'No CMS, page builder, or infrastructure stack markers were confirmed by scan evidence.',
    ar: 'لم ترصد أدلة الفحص مؤشرات مؤكدة لنظام إدارة محتوى أو بنية تقنية محددة.',
  },
  wpPlatformLabel: {
    en: 'WordPress CMS',
    ar: 'نظام ووردبريس',
  },
  wpVersionLabel: {
    en: 'Version',
    ar: 'الإصدار',
  },
  wpConfidenceLabel: {
    en: 'Detection Confidence',
    ar: 'ثقة الاكتشاف',
  },
  themesLabel: {
    en: 'Detected Themes',
    ar: 'القوالب المكتشفة',
  },
  pluginsLabel: {
    en: 'Detected Plugins',
    ar: 'الإضافات المكتشفة',
  },
  elementorLabel: {
    en: 'Elementor',
    ar: 'إليمنتور',
  },
  elementorProLabel: {
    en: 'Elementor Pro',
    ar: 'إليمنتور برو',
  },
  wooCommerceLabel: {
    en: 'WooCommerce',
    ar: 'ووكومرس',
  },
  restApiLabel: {
    en: 'WP REST API Exposed',
    ar: 'واجهة REST API متاحة',
  },
  xmlRpcLabel: {
    en: 'XML-RPC Endpoint Exposed',
    ar: 'نقطة XML-RPC متاحة',
  },
  cdnCacheLabel: {
    en: 'CDN / Caching Hints',
    ar: 'مؤشرات CDN والتخزين المؤقت',
  },
  serverHintsLabel: {
    en: 'Server Hints',
    ar: 'مؤشرات الخادم',
  },
  languageLabel: {
    en: 'Language',
    ar: 'اللغة',
  },
  viewModeLabel: {
    en: 'Audience Mode',
    ar: 'وضع العرض',
  },
  rawFindingsCountLabel: {
    en: 'Raw Findings',
    ar: 'إجمالي الملاحظات',
  },
  consolidatedGroupsLabel: {
    en: 'Actionable Groups',
    ar: 'المجموعات الموحدة',
  },
  confirmedFindingsLabel: {
    en: 'Confirmed',
    ar: 'مؤكد',
  },
  firmFindingsLabel: {
    en: 'Firm',
    ar: 'قوي',
  },
  potentialFindingsLabel: {
    en: 'Potential',
    ar: 'محتمل',
  },
  // Chart & Performance labels
  chartSeverityTitle: {
    en: 'Severity Distribution',
    ar: 'توزيع درجات الخطورة',
  },
  chartCategoryTitle: {
    en: 'Category Breakdown',
    ar: 'توزيع الملاحظات حسب الفئة',
  },
  chartCoverageTitle: {
    en: 'D1–D4 Coverage Dimensions',
    ar: 'أبعاد تغطية الفحص (D1–D4)',
  },
  chartLabVitalsTitle: {
    en: 'Laboratory Performance Metrics',
    ar: 'قياسات الأداء المعملية (Web Vitals)',
  },
  chartAssetTitle: {
    en: 'Asset Breakdown',
    ar: 'توزيع الأصول والموارد',
  },
  chartBottleneckTitle: {
    en: 'Bottleneck Summary',
    ar: 'ملخص اختناقات الأداء',
  },
  chartTopPagesTitle: {
    en: 'Top Affected Pages',
    ar: 'أكثر الصفحات تأثراً',
  },
  chartStatusMeasured: { en: 'Measured', ar: 'مقاس' },
  chartStatusPartial: { en: 'Partial', ar: 'جزئي' },
  chartStatusApproximated: { en: 'Approximated', ar: 'تقديري' },
  chartStatusUnavailable: { en: 'Unavailable', ar: 'غير متاح' },
  chartStatusExcluded: { en: 'Excluded', ar: 'مستبعد' },
  chartNoDataUnavailable: {
    en: 'Metric data unavailable or not executed in this scan.',
    ar: 'بيانات هذا المخطط غير متاحة أو لم تُنفَّذ في هذا الفحص.',
  },
  chartExcludedNote: {
    en: 'Excluded from chart metric (non-target system or lifecycle-resolved findings).',
    ar: 'مستبعد من احتساب المخطط (ملاحظات نظامية أو محلولة).',
  },
  chartBytesUnavailableNote: {
    en: 'Exact byte-by-type telemetry was not recorded; showing asset counts and flagged indicators only.',
    ar: 'لم تُسجل أحجام البايتات حسب النوع؛ يتم عرض أعداد الأصول والمؤشرات المرصودة فقط.',
  },
  labVsFieldBadge: {
    en: 'Lab Measurement Only — Not CrUX / Lighthouse',
    ar: 'قياس معملي فقط — لا يمثل CrUX أو Lighthouse',
  },
  inpUnavailableInLab: {
    en: 'Unsupported in passive lab audit (field-only metric)',
    ar: 'غير متاح في الفحص المعملي السلبي (مقياس ميداني فقط)',
  },
  ratingGood: { en: 'Good', ar: 'جيد' },
  ratingNeedsImprovement: { en: 'Needs Improvement', ar: 'يحتاج تحسين' },
  ratingPoor: { en: 'Poor', ar: 'ضعيف' },
  ratingUnavailable: { en: 'Unavailable', ar: 'غير متاح' },
  ratingUnsupportedInLab: { en: 'Unsupported in Lab', ar: 'غير متاح معملياً' },
  causalLabel: { en: 'Causal (Proven Cause)', ar: 'سببي (سبب مثبت)' },
  correlationalLabel: { en: 'Correlational (Associated Factor)', ar: 'ارتباطي (عامل مصاحب)' },
  observedVsBudgetLabel: { en: 'Observed vs Threshold', ar: 'المرصود مقابل الحد' },
  lcpCappedNote: {
    en: 'Capped at 5,000ms deadline ceiling',
    ar: 'مقيد بسقف مهلة 5,000 مللي ثانية',
  },
  // Asset buckets
  assetDocument: { en: 'HTML Documents', ar: 'مستندات HTML' },
  assetScript: { en: 'JavaScript', ar: 'ملفات JavaScript' },
  assetStylesheet: { en: 'Stylesheets (CSS)', ar: 'ملفات CSS' },
  assetImage: { en: 'Images', ar: 'الصور' },
  assetFont: { en: 'Fonts', ar: 'الخطوط' },
  assetOther: { en: 'Other Resources', ar: 'موارد أخرى' },
  assetFlaggedHeavy: { en: 'Flagged Heavy Assets', ar: 'أصول ثقيلة مرصودة' },
  // Interactive Findings Explorer
  searchFindingsPlaceholder: {
    en: 'Search by title, rule ID, finding ID, URL, or selector...',
    ar: 'ابحث بالعنوان أو معرف القاعدة أو معرف النتيجة أو الرابط أو المحدد...',
  },
  filterAll: { en: 'All', ar: 'الكل' },
  filterSeverityLabel: { en: 'Severity', ar: 'الخطورة' },
  filterCategoryLabel: { en: 'Category', ar: 'الفئة' },
  filterClassificationLabel: { en: 'Classification', ar: 'التصنيف' },
  filterConfirmedFirm: { en: 'Confirmed / Firm', ar: 'مؤكد / قوي' },
  filterProvisional: { en: 'Provisional', ar: 'مبدئي' },
  filterManualReview: { en: 'Needs Manual Review', ar: 'مراجعة يدوية' },
  filterHasScreenshot: { en: 'With Visual Evidence', ar: 'تحتوي دليلاً بصرياً' },
  sortByLabel: { en: 'Sort by', ar: 'ترتيب حسب' },
  sortSeverityDesc: { en: 'Severity (Highest first)', ar: 'الخطورة (الأعلى أولاً)' },
  sortSeverityAsc: { en: 'Severity (Lowest first)', ar: 'الخطورة (الأقل أولاً)' },
  sortOccurrencesDesc: { en: 'Occurrences (Most first)', ar: 'التكرارات (الأكثر أولاً)' },
  sortCategoryAsc: { en: 'Category (A–Z)', ar: 'الفئة (أبجدياً)' },
  sortRuleIdAsc: { en: 'Rule ID (A–Z)', ar: 'معرف القاعدة' },
  expandDetailsLabel: { en: 'Show Details & Guidance', ar: 'عرض التفاصيل والإرشادات' },
  collapseDetailsLabel: { en: 'Hide Details', ar: 'إخفاء التفاصيل' },
  findingIdLabel: { en: 'Original Finding IDs', ar: 'معرفات النتائج الأصلية' },
  ruleIdLabel: { en: 'Rule ID', ar: 'معرف القاعدة' },
  originalSeverityConfidenceLabel: {
    en: 'Original Confidence & Status',
    ar: 'الثقة والحالة الأصلية',
  },
  selectorsLabel: { en: 'DOM Selectors', ar: 'محددات العناصر (CSS)' },
  resourcesLabel: { en: 'Affected Resources / Assets', ar: 'الموارد والأصول المتأثرة' },
  headersLabel: { en: 'HTTP Headers', ar: 'ترويسات HTTP' },
  schemaTypesLabel: { en: 'Schema Types', ar: 'أنواع البيانات المهيكلة' },
  screenshotPreviewLabel: { en: 'Visual Evidence (Screenshot)', ar: 'الدليل البصري (لقطة الشاشة)' },
  openScreenshotModalLabel: { en: 'Open Full Preview', ar: 'فتح المعاينة الكاملة' },
  closeModalLabel: { en: 'Close Preview', ar: 'إغلاق المعاينة' },
  screenshotUnavailableFallback: {
    en: 'Screenshot preview unavailable on disk or omitted by safety bounds.',
    ar: 'معاينة لقطة الشاشة غير متوفرة على القرص أو مستبعدة لحدود الأمان.',
  },
  paginationPrev: { en: 'Previous', ar: 'السابق' },
  paginationNext: { en: 'Next', ar: 'التالي' },
  paginationShowing: { en: 'Showing', ar: 'عرض' },
  paginationOf: { en: 'of', ar: 'من' },
  pageSizeLabel: { en: 'Per page', ar: 'لكل صفحة' },
  noMatchingFindings: {
    en: 'No findings match the current search and filter criteria.',
    ar: 'لا توجد نتائج تطابق معايير البحث والتصفية الحالية.',
  },
  resetFiltersLabel: { en: 'Reset Filters', ar: 'إعادة ضبط المرشحات' },
  viewModeSimpleShort: { en: 'Simple', ar: 'مبسط' },
  viewModeTechnicalShort: { en: 'Technical', ar: 'تقني' },
  viewModeDualShort: { en: 'Dual', ar: 'مزدوج' },
  backToDashboardLabel: { en: 'Close Inspection', ar: 'إغلاق الفحص' },
  navOverview: { en: 'Overview', ar: 'نظرة عامة' },
  navScans: { en: 'Audit & Scans', ar: 'الفحوصات والتدقيق' },
  navProjects: { en: 'Projects & Sites', ar: 'المشاريع والمواقع' },
  navReports: { en: 'Reports & Exports', ar: 'التقارير والتصدير' },
  navTargetValidator: { en: 'Target Validator', ar: 'فاحص النطاق' },
  navSystemDiagnostics: { en: 'System Diagnostics', ar: 'تشخيص النظام' },
  reportLanguageLabel: { en: 'Report Language', ar: 'لغة التقرير' },
  reportAudienceModeLabel: { en: 'Report View Mode', ar: 'وضع عرض التقرير' },
} as const satisfies Record<string, BilingualText>;
