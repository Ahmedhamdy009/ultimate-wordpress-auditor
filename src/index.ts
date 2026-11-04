/**
 * Ultimate WordPress & Website Auditor
 * Foundational Domain Types & Scope Guard Utilities
 *
 * Implements architecture principles defined in ARCHITECTURE.md and SECURITY_POLICY.md:
 * - Strict URL scope enforcement (passive / read-only boundaries)
 * - Standardized Finding schemas and status representations
 */

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export type FindingConfidence = 'high' | 'medium' | 'low';

export type FindingStatus =
  | 'confirmed'
  | 'potential'
  | 'needs_manual_review'
  | 'false_positive'
  | 'fixed'
  | 'accepted_risk'
  | 'retest_required';

export interface Finding {
  id: string;
  siteId: string;
  scanRunId: string;
  module: string;
  category: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  status: FindingStatus;
  affectedUrl: string;
  evidence: string;
  source: string;
  detectedAt: string;
  remediation: string;
  verificationSteps: string;
}

export interface ScopeConfig {
  initialUrl: string;
  allowedHosts: readonly string[];
  maxPages: number;
  maxDepth: number;
  rateLimitPerSecond: number;
  timeoutMs: number;
}

/**
 * Normalizes host strings by stripping protocol prefixes, ports, and trailing slashes,
 * and converting to lower case.
 */
export function normalizeHost(hostOrUrl: string): string {
  const trimmed = hostOrUrl.trim().toLowerCase();
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname;
  } catch {
    return trimmed
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0];
  }
}

/**
 * Validates whether a target URL conforms to basic HTTP/HTTPS security requirements.
 */
export function validateScanTarget(targetUrl: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(targetUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        reason: `Unsupported protocol: ${parsed.protocol}. Only http and https are permitted.`,
      };
    }
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return { valid: false, reason: 'Target URL has no hostname.' };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid URL format.' };
  }
}

/**
 * Strictly verifies whether a target URL falls within the permitted scope hosts.
 * Protects against scope creep and unauthorized external crawling.
 */
export function isUrlInScope(targetUrl: string, allowedHosts: readonly string[]): boolean {
  const targetValidation = validateScanTarget(targetUrl);
  if (!targetValidation.valid) {
    return false;
  }

  const parsed = new URL(targetUrl.trim());
  const targetHost = parsed.hostname.toLowerCase();
  const normalizedAllowed = allowedHosts.map(h => normalizeHost(h));

  return normalizedAllowed.some(
    allowed => targetHost === allowed || targetHost.endsWith(`.${allowed}`),
  );
}
