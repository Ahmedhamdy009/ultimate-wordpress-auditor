import { z } from 'zod';
import { FINDING_CATEGORIES, type FindingCategoryId } from '../../schemas/categories.js';
import { BilingualTextSchema, type BilingualText } from '../translations.js';

export const SUPPORTED_PLATFORM_SCOPES = [
  'generic',
  'wordpress',
  'elementor',
  'elementor_pro',
  'woocommerce',
  'cdn_cache',
  'server_headers',
] as const;
export type SupportedPlatformScope = (typeof SUPPORTED_PLATFORM_SCOPES)[number];

export const CAUSE_CONFIDENCE_LEVELS = [
  'confirmed',
  'potential',
  'mixed',
  'needs_manual_review',
] as const;
export type CauseConfidenceLevel = (typeof CAUSE_CONFIDENCE_LEVELS)[number];

export const EVIDENCE_REQUIREMENT_TAGS = [
  'always_relevant',
  'http_header_evidence',
  'html_meta_evidence',
  'wordpress_core',
  'elementor',
  'elementor_pro',
  'woocommerce',
  'cdn_cache',
  'server_headers',
  'schema_jsonld',
  'robots_txt',
  'sitemap_xml',
  'cookie_header',
  'tls_handshake',
  'dom_selector',
  'network_request',
  'css_layout',
  'js_runtime',
  'media_asset',
] as const;
export type EvidenceRequirementTag = (typeof EVIDENCE_REQUIREMENT_TAGS)[number];

export const CODE_EXAMPLE_LANGUAGES = [
  'html',
  'css',
  'javascript',
  'typescript',
  'http',
  'nginx',
  'apache',
  'php',
  'xml',
  'json',
  'robots',
] as const;
export type CodeExampleLanguage = (typeof CODE_EXAMPLE_LANGUAGES)[number];

export interface DualAudienceBilingualText {
  readonly simple: BilingualText;
  readonly technical: BilingualText;
}

export const DualAudienceBilingualTextSchema = z.object({
  simple: BilingualTextSchema,
  technical: BilingualTextSchema,
});

export interface RecommendationStep {
  readonly stepNumber: number;
  readonly simple: BilingualText;
  readonly technical: BilingualText;
}

export const RecommendationStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  simple: BilingualTextSchema,
  technical: BilingualTextSchema,
});

export interface PlatformGuidanceTemplate {
  readonly platform: SupportedPlatformScope;
  readonly requiredEvidenceNote: BilingualText;
  readonly summary: DualAudienceBilingualText;
  readonly steps: readonly BilingualText[];
}

export const PlatformGuidanceTemplateSchema = z.object({
  platform: z.enum(SUPPORTED_PLATFORM_SCOPES),
  requiredEvidenceNote: BilingualTextSchema,
  summary: DualAudienceBilingualTextSchema,
  steps: z.array(BilingualTextSchema).min(1),
});

export interface CodeExampleTemplate {
  readonly title: BilingualText;
  readonly language: CodeExampleLanguage;
  readonly scopeDisclaimer: BilingualText;
  readonly requiredEvidenceTag: EvidenceRequirementTag;
  readonly snippet: string;
}

export const CodeExampleTemplateSchema = z.object({
  title: BilingualTextSchema,
  language: z.enum(CODE_EXAMPLE_LANGUAGES),
  scopeDisclaimer: BilingualTextSchema,
  requiredEvidenceTag: z.enum(EVIDENCE_REQUIREMENT_TAGS),
  snippet: z.string().min(1),
});

export interface RecommendationReference {
  readonly label: string;
  readonly url: string;
}

export const RecommendationReferenceSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
});

export interface RecommendationEntry {
  readonly recommendationId: string;
  readonly ruleIds: readonly string[];
  readonly ruleIdPrefixes?: readonly string[];
  readonly category: FindingCategoryId;
  readonly supportedPlatforms: readonly SupportedPlatformScope[];
  readonly causeConfidence: CauseConfidenceLevel;
  readonly problem: DualAudienceBilingualText;
  readonly impact: DualAudienceBilingualText;
  readonly confirmedCauseTemplates: readonly BilingualText[];
  readonly possibleCauseTemplates?: readonly BilingualText[];
  readonly locationGuidance: DualAudienceBilingualText;
  readonly remediationSteps: readonly RecommendationStep[];
  readonly platformGuidance?: readonly PlatformGuidanceTemplate[];
  readonly codeExamples?: readonly CodeExampleTemplate[];
  readonly verificationSteps: readonly RecommendationStep[];
  readonly limitations: readonly BilingualText[];
  readonly references: readonly RecommendationReference[];
  readonly isFallback?: boolean;
}

export const RecommendationEntrySchema = z
  .object({
    recommendationId: z.string().min(3),
    ruleIds: z.array(z.string().min(1)),
    ruleIdPrefixes: z.array(z.string().min(1)).optional(),
    category: z.enum(FINDING_CATEGORIES),
    supportedPlatforms: z.array(z.enum(SUPPORTED_PLATFORM_SCOPES)).min(1),
    causeConfidence: z.enum(CAUSE_CONFIDENCE_LEVELS),
    problem: DualAudienceBilingualTextSchema,
    impact: DualAudienceBilingualTextSchema,
    confirmedCauseTemplates: z.array(BilingualTextSchema),
    possibleCauseTemplates: z.array(BilingualTextSchema).optional(),
    locationGuidance: DualAudienceBilingualTextSchema,
    remediationSteps: z.array(RecommendationStepSchema).min(1),
    platformGuidance: z.array(PlatformGuidanceTemplateSchema).optional(),
    codeExamples: z.array(CodeExampleTemplateSchema).optional(),
    verificationSteps: z.array(RecommendationStepSchema).min(1),
    limitations: z.array(BilingualTextSchema).min(1),
    references: z.array(RecommendationReferenceSchema),
    isFallback: z.boolean().optional(),
  })
  .refine(
    val =>
      val.ruleIds.length > 0 ||
      (val.ruleIdPrefixes && val.ruleIdPrefixes.length > 0) ||
      val.isFallback === true,
    { message: 'Entry must match at least one ruleId, ruleIdPrefix, or be marked asFallback' },
  );

export function bi(en: string, ar: string): BilingualText {
  return { en, ar };
}

export function dual(
  simpleEn: string,
  simpleAr: string,
  techEn: string,
  techAr: string,
): DualAudienceBilingualText {
  return {
    simple: { en: simpleEn, ar: simpleAr },
    technical: { en: techEn, ar: techAr },
  };
}

export function step(
  stepNumber: number,
  simpleEn: string,
  simpleAr: string,
  techEn: string,
  techAr: string,
): RecommendationStep {
  return {
    stepNumber,
    simple: { en: simpleEn, ar: simpleAr },
    technical: { en: techEn, ar: techAr },
  };
}
