/**
 * BCP 47 Standards-Aware Language Tag Validator for Hreflang Annotations.
 *
 * Implements strict BCP 47 syntactic and semantic validation for HTML
 * <link rel="alternate" hreflang="..." href="..."> declarations according to
 * Google Search Central and RFC 5646 specifications.
 */

export interface HreflangValidationResult {
  readonly valid: boolean;
  readonly normalized: string;
  readonly language?: string;
  readonly region?: string;
  readonly script?: string;
  readonly isXDefault: boolean;
  readonly reason?: string;
}

/**
 * Validates a raw hreflang attribute value against BCP 47 standards and Google conventions.
 *
 * Accepted patterns:
 * - Special fallback: "x-default" (case-insensitive)
 * - ISO 639-1 / ISO 639-2/3 language: "en", "ar", "es", "de", "zh", "fr"
 * - Language + ISO 3166-1 alpha-2 region: "en-US", "ar-EG", "pt-BR", "fr-CA"
 * - Language + UN M.49 3-digit region: "es-419"
 * - Language + ISO 15924 script: "zh-Hant", "zh-Hans", "sr-Latn"
 * - Language + Script + Region: "zh-Hans-CN", "zh-Hant-TW"
 *
 * Rejected patterns:
 * - Underscore delimiters (e.g. "en_US", "ar_EG" - common PHP/POSIX mistake)
 * - Numeric primary languages (e.g. "123")
 * - Single-character languages or overly long languages (e.g. "a", "toolonglanguage")
 * - Malformed subtags (e.g. "en-12", "en-1234")
 * - Non-alphanumeric characters (e.g. "en@US", "ar EG")
 * - Empty, whitespace-only, or missing values
 */
export function validateHreflangTag(rawTag: string | null | undefined): HreflangValidationResult {
  if (rawTag === null || rawTag === undefined) {
    return {
      valid: false,
      normalized: '',
      isXDefault: false,
      reason: 'Missing or null hreflang language tag',
    };
  }

  const trimmed = rawTag.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      normalized: '',
      isXDefault: false,
      reason: 'Empty hreflang language tag',
    };
  }

  if (trimmed.length > 35) {
    return {
      valid: false,
      normalized: trimmed.slice(0, 35).toLowerCase(),
      isXDefault: false,
      reason: 'Language tag exceeds maximum allowable length (35 characters)',
    };
  }

  // Google reserved fallback: x-default
  if (trimmed.toLowerCase() === 'x-default') {
    return {
      valid: true,
      normalized: 'x-default',
      language: 'x-default',
      isXDefault: true,
    };
  }

  // Common defect: underscore instead of hyphen (POSIX / PHP locale confusion)
  if (trimmed.includes('_')) {
    return {
      valid: false,
      normalized: trimmed.toLowerCase(),
      isXDefault: false,
      reason: 'Invalid format: BCP 47 requires hyphens (-) instead of underscores (_)',
    };
  }

  // Check character set and basic hyphen spacing
  if (!/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(trimmed)) {
    return {
      valid: false,
      normalized: trimmed.toLowerCase(),
      isXDefault: false,
      reason: 'Language tag contains invalid characters or malformed hyphens',
    };
  }

  const parts = trimmed.split('-');
  if (parts.length > 3) {
    return {
      valid: false,
      normalized: trimmed.toLowerCase(),
      isXDefault: false,
      reason: 'Language tag contains too many subtags (maximum 3: language-script-region)',
    };
  }

  // Subtag 0: Primary language (2 or 3 letters)
  const langPart = parts[0];
  if (!/^[a-zA-Z]{2,3}$/.test(langPart)) {
    return {
      valid: false,
      normalized: trimmed.toLowerCase(),
      isXDefault: false,
      reason: 'Primary language must be a 2 or 3-letter ISO code',
    };
  }

  let scriptPart: string | undefined;
  let regionPart: string | undefined;

  if (parts.length === 2) {
    const p1 = parts[1];
    if (/^[a-zA-Z]{4}$/.test(p1)) {
      scriptPart = p1;
    } else if (/^[a-zA-Z]{2}$/.test(p1) || /^\d{3}$/.test(p1)) {
      regionPart = p1;
    } else {
      return {
        valid: false,
        normalized: trimmed.toLowerCase(),
        isXDefault: false,
        reason: 'Subtag must be a 4-letter script, 2-letter region, or 3-digit UN M.49 code',
      };
    }
  } else if (parts.length === 3) {
    const p1 = parts[1];
    const p2 = parts[2];
    if (!/^[a-zA-Z]{4}$/.test(p1)) {
      return {
        valid: false,
        normalized: trimmed.toLowerCase(),
        isXDefault: false,
        reason: 'Second subtag in a 3-part tag must be a 4-letter script',
      };
    }
    scriptPart = p1;
    if (!/^[a-zA-Z]{2}$/.test(p2) && !/^\d{3}$/.test(p2)) {
      return {
        valid: false,
        normalized: trimmed.toLowerCase(),
        isXDefault: false,
        reason: 'Third subtag must be a 2-letter region or 3-digit UN M.49 code',
      };
    }
    regionPart = p2;
  }

  // Validate semantics via ECMAScript Intl.Locale
  try {
    const loc = new Intl.Locale(trimmed);
    if (
      !loc.language ||
      loc.language === 'und' ||
      loc.language.length < 2 ||
      loc.language.length > 3
    ) {
      return {
        valid: false,
        normalized: trimmed.toLowerCase(),
        isXDefault: false,
        reason: 'Unrecognized or undetermined primary language code',
      };
    }

    return {
      valid: true,
      normalized: trimmed.toLowerCase(),
      language: loc.language.toLowerCase(),
      region: loc.region ? loc.region.toUpperCase() : regionPart?.toUpperCase(),
      script: loc.script ? loc.script : scriptPart,
      isXDefault: false,
    };
  } catch (err) {
    return {
      valid: false,
      normalized: trimmed.toLowerCase(),
      isXDefault: false,
      reason: err instanceof Error ? err.message : 'Invalid BCP 47 locale syntax',
    };
  }
}

/**
 * Checks whether two language tags are semantically consistent for reciprocal hreflang links.
 * E.g. "en" and "en-US" are consistent (same primary language family),
 * while "en" and "ar" or "fr" are inconsistent.
 */
export function areHreflangTagsConsistent(langA: string, langB: string): boolean {
  const normA = langA.trim().toLowerCase();
  const normB = langB.trim().toLowerCase();

  if (normA === 'x-default' || normB === 'x-default') {
    return true;
  }

  if (normA === normB) {
    return true;
  }

  const primaryA = normA.split('-')[0];
  const primaryB = normB.split('-')[0];

  return primaryA === primaryB;
}
