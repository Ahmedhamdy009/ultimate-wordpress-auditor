import type {
  BottleneckClassification,
  BottleneckDiagnosis,
  LabWebVitalsMetrics,
  ResourcePerformanceResult,
  ResourceSummaryMetrics,
  UnifiedPerformanceEvidence,
  CreateFindingRequest,
} from '@auditor/shared';

export type { BottleneckClassification, BottleneckDiagnosis, UnifiedPerformanceEvidence };

export interface PerformanceAuditorOptions {
  readonly scanRunId?: string;
  readonly signal?: AbortSignal;
  readonly settleTimeoutMs?: number;
  readonly maxCeilingMs?: number;
  readonly maxResources?: number;
  readonly maxImages?: number;
}

export interface PerformanceAuditResult {
  readonly pageUrl: string;
  readonly evidence: UnifiedPerformanceEvidence;
  readonly diagnoses: readonly BottleneckDiagnosis[];
  readonly labMetrics: LabWebVitalsMetrics | null;
  readonly resourceSummary: ResourceSummaryMetrics | null;
  readonly findings: CreateFindingRequest[];
  readonly durationMs: number;
}

export interface UnifiedEvidenceBuildInput {
  readonly pageUrl: string;
  readonly labMetrics: LabWebVitalsMetrics | null;
  readonly resourceResult: ResourcePerformanceResult | null;
  readonly completenessState?: {
    readonly lcpState?: 'complete' | 'capped' | 'unavailable' | 'interrupted';
    readonly isLcpCapped?: boolean;
    readonly tbtCalculated?: boolean;
    readonly navigationTimingAvailable?: boolean;
    readonly resourceBufferLimitReached?: boolean;
  };
  readonly limitations?: readonly string[];
}
