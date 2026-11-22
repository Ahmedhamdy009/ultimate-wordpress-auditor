/**
 * Finding Identity & 3-Tier Fingerprinting Types.
 * Defines models for cross-scan finding correspondence, locator canonicalization,
 * and deterministic fingerprint generation.
 */

export const IDENTITY_TIERS = [
  'tier1_semantic',
  'tier2_positional',
  'tier3_aggregate',
] as const;

export type IdentityTier = (typeof IDENTITY_TIERS)[number];

export interface IdentityDescriptor {
  /**
   * Deterministic SHA-256 / normalized hex fingerprint for finding identity.
   */
  readonly fingerprint: string;

  /**
   * Identity tier classifying the stability of the match across deployments.
   */
  readonly tier: IdentityTier;

  /**
   * Baseline match confidence (1.0 for Tier 1, 0.7 for Tier 2, 0.5/parity for Tier 3).
   */
  readonly matchConfidence: number;

  /**
   * Human-readable diagnostic description of how identity was derived.
   */
  readonly signatureBasis: string;

  /**
   * Canonical locator string used for identity derivation (if applicable).
   */
  readonly canonicalLocator?: string;

  /**
   * Aggregate grouping key for Tier 3 findings: `normalizedUrl::ruleId`.
   */
  readonly aggregateGroupKey?: string;
}

export interface FindingIdentityInput {
  readonly ruleId: string;
  readonly category: string;
  readonly targetUrl: string;
  readonly evidence?: Record<string, unknown> | string | null;
  readonly title?: string;
}
