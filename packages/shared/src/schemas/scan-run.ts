import { z } from 'zod';

export const SCAN_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type ScanRunStatus = (typeof SCAN_RUN_STATUSES)[number];

export const SCAN_RUN_TYPES = [
  'full',
  'quick',
  'security',
  'performance',
  'seo',
  'accessibility',
  'wordpress',
] as const;
export type ScanRunType = (typeof SCAN_RUN_TYPES)[number];

export const ScanRunStatusSchema = z.enum(SCAN_RUN_STATUSES);
export const ScanRunTypeSchema = z.enum(SCAN_RUN_TYPES);

/**
 * State machine transition definitions for scan run lifecycle.
 */
export const SCAN_RUN_TRANSITIONS: Readonly<Record<ScanRunStatus, readonly ScanRunStatus[]>> =
  Object.freeze({
    pending: ['running', 'failed', 'cancelled'],
    running: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  });

/**
 * Validates whether a state transition is legal according to the lifecycle rules.
 */
export function isValidScanRunTransition(from: ScanRunStatus, to: ScanRunStatus): boolean {
  const allowed = SCAN_RUN_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Checks whether a scan run status is terminal (cannot transition further).
 */
export function isTerminalScanRunStatus(status: ScanRunStatus): boolean {
  return (SCAN_RUN_TRANSITIONS[status]?.length ?? 0) === 0;
}

export interface ScanRunSummaryDTO {
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  urlsCrawled?: number;
  pagesScanned?: number;
  pagesFailed?: number;
  browserPagesAudited?: number;
  viewportsCompleted?: number;
  accessibilityAuditsCompleted?: number;
  screenshotsCaptured?: number;
  browserCandidatesTotal?: number;
  browserCandidatesSkipped?: number;
  isPartialCoverage?: boolean;
  coverageStatus?: 'full' | 'partial';
  browserCoverageStatus?: 'full' | 'partial' | 'none';
  staticCoverageStatus?: 'full' | 'partial' | 'none';
  coverageWarning?: string;
  categories?: Record<string, number>;
}

export const ScanRunSummaryDTOSchema = z.object({
  totalFindings: z.number().int().min(0),
  criticalCount: z.number().int().min(0),
  highCount: z.number().int().min(0),
  mediumCount: z.number().int().min(0),
  lowCount: z.number().int().min(0),
  infoCount: z.number().int().min(0),
  urlsCrawled: z.number().int().min(0).optional(),
  pagesScanned: z.number().int().min(0).optional(),
  pagesFailed: z.number().int().min(0).optional(),
  browserPagesAudited: z.number().int().min(0).optional(),
  viewportsCompleted: z.number().int().min(0).optional(),
  accessibilityAuditsCompleted: z.number().int().min(0).optional(),
  screenshotsCaptured: z.number().int().min(0).optional(),
  browserCandidatesTotal: z.number().int().min(0).optional(),
  browserCandidatesSkipped: z.number().int().min(0).optional(),
  isPartialCoverage: z.boolean().optional(),
  coverageStatus: z.enum(['full', 'partial']).optional(),
  browserCoverageStatus: z.enum(['full', 'partial', 'none']).optional(),
  staticCoverageStatus: z.enum(['full', 'partial', 'none']).optional(),
  coverageWarning: z.string().optional(),
  categories: z.record(z.string(), z.number().int().min(0)).optional(),
});

export interface ScanRunErrorDTO {
  code: string;
  message: string;
  details?: unknown;
}

export const ScanRunErrorDTOSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(1000),
  details: z.unknown().optional(),
});

export interface ScanRunDTO {
  id: string;
  siteId: string;
  scanType: ScanRunType;
  status: ScanRunStatus;
  targetUrl: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  durationMs: number | null;
  config: Record<string, unknown>;
  summary: ScanRunSummaryDTO | null;
  error: ScanRunErrorDTO | null;
  errorDetails?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const ScanRunDTOSchema = z.object({
  id: z.string().uuid('Invalid scan run ID format'),
  siteId: z.string().uuid('Invalid site ID format'),
  scanType: ScanRunTypeSchema,
  status: ScanRunStatusSchema,
  targetUrl: z.string().min(1).max(2048),
  startedAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }).nullable(),
  completedAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }).nullable(),
  cancelledAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }).nullable(),
  durationMs: z.number().int().min(0).nullable(),
  config: z.record(z.string(), z.unknown()),
  summary: ScanRunSummaryDTOSchema.nullable(),
  error: ScanRunErrorDTOSchema.nullable(),
  createdAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
  updatedAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
});

export const CreateScanRunRequestSchema = z.object({
  siteId: z.string().uuid('Invalid site ID format'),
  scanType: ScanRunTypeSchema.optional().default('full'),
  targetUrl: z.string().trim().min(1).max(2048).optional(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

export type CreateScanRunRequest = z.input<typeof CreateScanRunRequestSchema>;
export type CreateScanRunOutput = z.output<typeof CreateScanRunRequestSchema>;

export const GetScanRunRequestSchema = z.object({
  id: z.string().uuid('Invalid scan run ID format'),
});

export type GetScanRunRequest = z.input<typeof GetScanRunRequestSchema>;

export const ListScanRunsRequestSchema = z.object({
  siteId: z.string().uuid('Invalid site ID format').optional(),
  status: ScanRunStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type ListScanRunsRequest = z.input<typeof ListScanRunsRequestSchema>;
export type ListScanRunsOutput = z.output<typeof ListScanRunsRequestSchema>;

export const ScanRunListResponseDTOSchema = z.object({
  items: z.array(ScanRunDTOSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});

export type ScanRunListResponseDTO = z.infer<typeof ScanRunListResponseDTOSchema>;

export const CancelScanRunRequestSchema = z.object({
  id: z.string().uuid('Invalid scan run ID format'),
});

export type CancelScanRunRequest = z.input<typeof CancelScanRunRequestSchema>;

export const UpdateScanRunStatusRequestSchema = z.object({
  id: z.string().uuid('Invalid scan run ID format'),
  status: ScanRunStatusSchema,
  summary: ScanRunSummaryDTOSchema.optional().nullable(),
  error: ScanRunErrorDTOSchema.optional().nullable(),
});

export type UpdateScanRunStatusRequest = z.input<typeof UpdateScanRunStatusRequestSchema>;
export type UpdateScanRunStatusOutput = z.output<typeof UpdateScanRunStatusRequestSchema>;

// Aliases for compatibility
export type CreateScanRunDTO = CreateScanRunRequest;
export type GetScanRunDTO = GetScanRunRequest;
export type ListScanRunsQueryDTO = ListScanRunsRequest;
export type CancelScanRunDTO = CancelScanRunRequest;

/**
 * Configurable audit modules configuration with safe defaults.
 */
export const DEFAULT_AUDIT_MODULES = Object.freeze({
  http: true,
  wordpress: true,
  securityHeaders: true,
  cookies: true,
  seo: true,
  runtimeErrors: true,
  networkResources: true,
  responsiveLayout: true,
  layoutStability: true,
  screenshots: true,
  accessibility: true,
});

export const AuditModulesConfigSchema = z
  .object({
    http: z.boolean().default(true),
    wordpress: z.boolean().default(true),
    securityHeaders: z.boolean().default(true),
    cookies: z.boolean().default(true),
    seo: z.boolean().default(true),
    runtimeErrors: z.boolean().default(true),
    networkResources: z.boolean().default(true),
    responsiveLayout: z.boolean().default(true),
    layoutStability: z.boolean().default(true),
    screenshots: z.boolean().default(true),
    accessibility: z.boolean().default(true),
  })
  .default(DEFAULT_AUDIT_MODULES);

export type AuditModulesConfig = z.infer<typeof AuditModulesConfigSchema>;

/**
 * Validated scan execution configuration.
 * Strictly bounds crawler, HTTP client, and browser audit limits to prevent resource exhaustion.
 */
export const ScanConfigSchema = z.object({
  maxPages: z.number().int().min(1).max(500).default(50),
  maxDepth: z.number().int().min(0).max(10).default(3),
  maxConcurrency: z.number().int().min(1).max(10).default(3),
  maxDiscoveredLinksPerPage: z.number().int().min(1).max(500).default(100),
  requestTimeoutMs: z.number().int().min(1000).max(60000).default(10000),
  maxDurationMs: z.number().int().min(100).max(600000).default(60000),
  maxEncodedBytes: z
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  maxDecompressedBytes: z
    .number()
    .int()
    .min(1024)
    .max(20 * 1024 * 1024)
    .default(4 * 1024 * 1024),
  userAgent: z.string().min(1).max(256).optional(),
  enabledAnalyzers: z.array(z.string().min(1).max(64)).optional(),
  auditModules: AuditModulesConfigSchema.optional(),
  enableBrowserAudit: z.boolean().default(false),
  maxBrowserPages: z.number().int().min(1).max(50).default(5),
  viewportProfiles: z.array(z.string().min(1).max(50)).optional(),
  captureScreenshots: z.boolean().default(true),
  wcagTags: z.array(z.string().min(1).max(50)).optional(),
});

export type ScanConfig = z.infer<typeof ScanConfigSchema>;

export const ScanStageSchema = z.enum([
  'pending',
  'initializing',
  'crawling',
  'analyzing',
  'browser_auditing',
  'persisting',
  'completed',
  'failed',
  'cancelled',
]);

export type ScanStage = z.infer<typeof ScanStageSchema>;

/**
 * Scan progress DTO reporting live and final metrics.
 */
export const ScanProgressDTOSchema = z.object({
  scanId: z.string().uuid(),
  status: ScanRunStatusSchema,
  stage: ScanStageSchema,
  pagesAttempted: z.number().int().min(0),
  pagesSucceeded: z.number().int().min(0),
  pagesFailed: z.number().int().min(0),
  pagesPending: z.number().int().min(0),
  uniqueUrlsDiscovered: z.number().int().min(0),
  currentCrawlDepth: z.number().int().min(0),
  findingsProduced: z.number().int().min(0),
  findingsPersisted: z.number().int().min(0),
  activeRequests: z.number().int().min(0),
  elapsedMs: z.number().int().min(0),
  currentUrl: z.string().nullable().optional(),
  browserPagesAudited: z.number().int().min(0).default(0),
  viewportsCompleted: z.number().int().min(0).default(0),
  accessibilityAuditsCompleted: z.number().int().min(0).default(0),
  screenshotsCaptured: z.number().int().min(0).default(0),
  browserCandidatesTotal: z.number().int().min(0).optional(),
  browserCandidatesSkipped: z.number().int().min(0).optional(),
  isPartialCoverage: z.boolean().optional(),
  coverageStatus: z.enum(['full', 'partial']).optional(),
  browserCoverageStatus: z.enum(['full', 'partial', 'none']).optional(),
  staticCoverageStatus: z.enum(['full', 'partial', 'none']).optional(),
  currentEngine: z.string().nullable().optional(),
});

export type ScanProgressDTO = z.infer<typeof ScanProgressDTOSchema>;

export const GetScanProgressRequestSchema = z.object({
  id: z.string().uuid('Invalid scan run ID format'),
});

export type GetScanProgressRequest = z.input<typeof GetScanProgressRequestSchema>;
export type GetScanProgressDTO = GetScanProgressRequest;
