import { z } from 'zod';

/**
 * Standard finding schema and status definitions according to ARCHITECTURE.md.
 */

export const FINDING_SEVERITIES = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
  'informational',
] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_CONFIDENCES = [
  'confirmed',
  'firm',
  'tentative',
  'potential',
  'high',
  'medium',
  'low',
] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];

export const FINDING_STATUSES = [
  'active',
  'resolved',
  'false_positive',
  'ignored',
  'confirmed',
  'potential',
  'needs_manual_review',
  'fixed',
  'accepted_risk',
  'retest_required',
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const FindingSeveritySchema = z.enum(FINDING_SEVERITIES);
export const FindingConfidenceSchema = z.enum(FINDING_CONFIDENCES);
export const FindingStatusSchema = z.enum(FINDING_STATUSES);

export type ConfidenceSummaryBucket = 'confirmed' | 'firm' | 'potential';

const FINDING_STATUS_SET = new Set<string>(FINDING_STATUSES);

/**
 * Classifies a raw finding confidence into the three explicit verification buckets
 * (`confirmed`, `firm`, `potential`) without merging `firm` into `confirmed`.
 */
export function classifyFindingConfidenceBucket(
  confidence: string | null | undefined,
): ConfidenceSummaryBucket {
  const normalized = (confidence ?? '').trim().toLowerCase();
  if (normalized === 'confirmed' || normalized === 'high') {
    return 'confirmed';
  }
  if (normalized === 'firm' || normalized === 'medium') {
    return 'firm';
  }
  return 'potential';
}

/**
 * Normalizes omitted or legacy `'active'` lifecycle statuses into explicit non-active
 * terminal classifications while keeping confidence and lifecycle status distinct.
 */
export function normalizeFindingLifecycleStatus(
  status: string | null | undefined,
  confidence: string | null | undefined,
): FindingStatus {
  const normalizedStatus = (status ?? '').trim().toLowerCase();
  if (
    normalizedStatus &&
    normalizedStatus !== 'active' &&
    FINDING_STATUS_SET.has(normalizedStatus)
  ) {
    return normalizedStatus as FindingStatus;
  }

  const normalizedConf = (confidence ?? '').trim().toLowerCase();
  if (normalizedConf === 'confirmed' || normalizedConf === 'high') {
    return 'confirmed';
  }
  return 'potential';
}

/** Legacy finding interface maintained for backwards compatibility */
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

/** Persistent Normalized Finding DTO */
export interface FindingDTO {
  id: string;
  scanRunId: string;
  ruleId: string;
  category: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  status: FindingStatus;
  targetUrl: string;
  evidence: Record<string, unknown> | string | null;
  remediation: string | null;
  references: string[] | null;
  createdAt: string;
}

export const FindingDTOSchema = z.object({
  id: z.string().uuid('Invalid finding ID format'),
  scanRunId: z.string().uuid('Invalid scan run ID format'),
  ruleId: z.string().min(1).max(100),
  category: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(10000),
  severity: FindingSeveritySchema,
  confidence: FindingConfidenceSchema,
  status: FindingStatusSchema,
  targetUrl: z.string().min(1).max(2048),
  evidence: z.union([z.record(z.string(), z.unknown()), z.string()]).nullable(),
  remediation: z.string().max(10000).nullable(),
  references: z.array(z.string().max(2048)).nullable(),
  createdAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
});

export const CreateFindingRequestSchema = z.object({
  scanRunId: z.string().uuid('Invalid scan run ID format'),
  ruleId: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(10000),
  severity: FindingSeveritySchema,
  confidence: FindingConfidenceSchema,
  status: FindingStatusSchema.optional().default('potential'),
  targetUrl: z.string().trim().min(1).max(2048),
  evidence: z
    .union([z.record(z.string(), z.unknown()), z.string()])
    .optional()
    .nullable(),
  remediation: z.string().trim().max(10000).optional().nullable(),
  references: z.array(z.string().trim().max(2048)).optional().nullable(),
});

export type CreateFindingRequest = z.input<typeof CreateFindingRequestSchema>;
export type CreateFindingOutput = z.output<typeof CreateFindingRequestSchema>;

export const GetFindingRequestSchema = z.object({
  id: z.string().uuid('Invalid finding ID format'),
});

export type GetFindingRequest = z.input<typeof GetFindingRequestSchema>;

export const ListFindingsRequestSchema = z.object({
  scanRunId: z.string().uuid('Invalid scan run ID format'),
  severity: FindingSeveritySchema.optional(),
  category: z.string().trim().optional(),
  status: FindingStatusSchema.optional(),
  limit: z.number().int().min(1).max(1000).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type ListFindingsRequest = z.input<typeof ListFindingsRequestSchema>;
export type ListFindingsOutput = z.output<typeof ListFindingsRequestSchema>;

export const FindingListResponseDTOSchema = z.object({
  items: z.array(FindingDTOSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});

export type FindingListResponseDTO = z.infer<typeof FindingListResponseDTOSchema>;

// Aliases
export type GetFindingDTO = GetFindingRequest;
export type ListFindingsQueryDTO = ListFindingsRequest;

export type FindingGroupType = 'shared_template_component' | 'repeated_issue' | 'single_occurrence';

export interface FindingOccurrenceDTO {
  readonly findingId: string;
  readonly targetUrl: string;
  readonly evidence: Record<string, unknown> | string | null;
  readonly createdAt?: string;
}

export const FindingOccurrenceDTOSchema = z.object({
  findingId: z.string(),
  targetUrl: z.string(),
  evidence: z.union([z.record(z.string(), z.unknown()), z.string()]).nullable(),
  createdAt: z.string().optional(),
});

export interface ConsolidatedFindingDTO {
  readonly id: string;
  readonly signature: string;
  readonly ruleId: string;
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
  readonly status: FindingStatus;
  readonly groupType: FindingGroupType;
  readonly groupReason?: string | null;
  readonly selector?: string | null;
  readonly totalOccurrences: number;
  readonly affectedUrls: readonly string[];
  readonly remediation: string | null;
  readonly references: readonly string[] | null;
  readonly originalFindingIds: readonly string[];
  readonly occurrences: readonly FindingOccurrenceDTO[];
}

export const ConsolidatedFindingDTOSchema = z.object({
  id: z.string(),
  signature: z.string(),
  ruleId: z.string(),
  category: z.string(),
  title: z.string(),
  description: z.string(),
  severity: FindingSeveritySchema,
  confidence: FindingConfidenceSchema,
  status: FindingStatusSchema,
  groupType: z.enum(['shared_template_component', 'repeated_issue', 'single_occurrence']),
  groupReason: z.string().nullable().optional(),
  selector: z.string().nullable().optional(),
  totalOccurrences: z.number().int().min(1),
  affectedUrls: z.array(z.string()),
  remediation: z.string().nullable(),
  references: z.array(z.string()).nullable(),
  originalFindingIds: z.array(z.string()),
  occurrences: z.array(FindingOccurrenceDTOSchema),
});

function extractSelectorOrSignature(f: FindingDTO): {
  selector: string | null;
  signatureKey: string;
} {
  let ev: Record<string, unknown> | null = null;
  if (typeof f.evidence === 'string') {
    try {
      ev = JSON.parse(f.evidence) as Record<string, unknown>;
    } catch {
      ev = null;
    }
  } else if (f.evidence && typeof f.evidence === 'object') {
    ev = f.evidence;
  }

  let selector: string | null = null;
  if (typeof ev?.structuralLocator === 'string' && ev.structuralLocator.trim().length > 0) {
    selector = ev.structuralLocator.trim();
  } else if (typeof ev?.targetSelector === 'string' && ev.targetSelector.trim().length > 0) {
    selector = ev.targetSelector.trim();
  } else if (typeof ev?.selector === 'string' && ev.selector.trim().length > 0) {
    selector = ev.selector.trim();
  } else if (
    Array.isArray(ev?.nodes) &&
    ev.nodes.length > 0 &&
    typeof ev.nodes[0] === 'object' &&
    ev.nodes[0]
  ) {
    const node0 = ev.nodes[0] as Record<string, unknown>;
    if (typeof node0.structuralLocator === 'string') {
      selector = node0.structuralLocator.trim();
    } else if (typeof node0.targetSelector === 'string') {
      selector = node0.targetSelector.trim();
    } else if (
      Array.isArray(node0.target) &&
      node0.target.length > 0 &&
      typeof node0.target[0] === 'string'
    ) {
      selector = node0.target[0].trim();
    }
  }

  if (selector) {
    return { selector, signatureKey: `sel:${selector}` };
  }

  if (typeof ev?.html === 'string' && ev.html.trim().length > 0) {
    return { selector: null, signatureKey: `html:${ev.html.trim()}` };
  }

  const ruleId = f.ruleId;
  if (
    ruleId === 'PERF_EXCESSIVE_STYLESHEETS' ||
    ruleId === 'CONTENT_EMPTY_LINK' ||
    ruleId === 'SEO_IMG_ALT_MISSING' ||
    ruleId === 'SEO_HEADING_HIERARCHY_GAP' ||
    ruleId === 'CONTENT_REPEATED_HEADINGS' ||
    ruleId === 'CONTENT_DOM_BLOAT'
  ) {
    return { selector: null, signatureKey: `rule_pattern:${ruleId}` };
  }

  return { selector: null, signatureKey: `item:${f.id}` };
}

function hashSignature(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Consolidates repeated findings into structured presentation groups while preserving
 * 100% of individual occurrences, original finding IDs, and per-page evidence.
 */
export function consolidateFindings(findings: readonly FindingDTO[]): ConsolidatedFindingDTO[] {
  if (!findings || findings.length === 0) {
    return [];
  }

  const groups = new Map<string, FindingDTO[]>();
  const groupSelectors = new Map<string, string | null>();

  for (const f of findings) {
    const { selector, signatureKey } = extractSelectorOrSignature(f);
    const signature = `${f.category}::${f.ruleId}::${signatureKey}`;
    const list = groups.get(signature) ?? [];
    list.push(f);
    groups.set(signature, list);
    if (selector && !groupSelectors.has(signature)) {
      groupSelectors.set(signature, selector);
    }
  }

  const severityOrder: Record<FindingSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
    informational: 4,
  };

  const result: ConsolidatedFindingDTO[] = [];

  for (const [signature, items] of groups.entries()) {
    const representative = items[0];
    const selector = groupSelectors.get(signature) ?? null;
    const uniqueUrls = Array.from(new Set(items.map(i => i.targetUrl)));

    let groupType: FindingGroupType = 'single_occurrence';
    let groupReason: string | null = null;

    if (items.length > 1) {
      if (uniqueUrls.length > 1 && selector) {
        groupType = 'shared_template_component';
        groupReason = `Identical element locator ("${selector}") detected across ${uniqueUrls.length} pages, indicating a shared template or component.`;
      } else if (uniqueUrls.length > 1) {
        groupType = 'repeated_issue';
        groupReason = `Same defect pattern detected across ${uniqueUrls.length} pages.`;
      } else {
        groupType = 'repeated_issue';
        groupReason = `Multiple occurrences (${items.length}) detected on ${uniqueUrls[0]}.`;
      }
    }

    const occurrences: FindingOccurrenceDTO[] = items.map(i => ({
      findingId: i.id,
      targetUrl: i.targetUrl,
      evidence: i.evidence,
      createdAt: i.createdAt,
    }));

    let highestSeverity = representative.severity;
    for (const item of items) {
      if (severityOrder[item.severity] < severityOrder[highestSeverity]) {
        highestSeverity = item.severity;
      }
    }

    result.push({
      id: `cf-${representative.ruleId}-${hashSignature(signature)}`,
      signature,
      ruleId: representative.ruleId,
      category: representative.category,
      title: representative.title,
      description: representative.description,
      severity: highestSeverity,
      confidence: representative.confidence,
      status: representative.status,
      groupType,
      groupReason,
      selector,
      totalOccurrences: items.length,
      affectedUrls: uniqueUrls,
      remediation: representative.remediation,
      references: representative.references,
      originalFindingIds: items.map(i => i.id),
      occurrences,
    });
  }

  result.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    const occDiff = b.totalOccurrences - a.totalOccurrences;
    if (occDiff !== 0) return occDiff;
    return a.title.localeCompare(b.title);
  });

  return result;
}
