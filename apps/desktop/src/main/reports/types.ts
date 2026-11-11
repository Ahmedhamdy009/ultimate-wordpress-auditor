import type { ConsolidatedFindingDTO, FindingDTO, FindingSeverity, PlatformType, EnvironmentType, ScanRunType, ScanRunStatus } from '@auditor/shared';
import type { ReportVisualEvidenceEntry } from './visual-evidence.js';

export interface ReportSiteModel {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly platformType: PlatformType;
  readonly environmentType: EnvironmentType;
  readonly description: string | null;
}

export interface ReportScanRunModel {
  readonly id: string;
  readonly siteId: string;
  readonly scanType: ScanRunType;
  readonly status: ScanRunStatus;
  readonly targetUrl: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly durationMs: number | null;
  readonly config: Record<string, unknown>;
  readonly pagesScanned?: number;
  readonly pagesFailed?: number;
  readonly browserPagesAudited?: number;
  readonly screenshotsCaptured?: number;
  readonly isPartialAudit?: boolean;
  readonly completedEngines?: readonly string[];
  readonly interruptedEngine?: string | null;
  readonly browserCandidatesTotal?: number;
  readonly browserCandidatesSkipped?: number;
  readonly isPartialCoverage?: boolean;
  readonly coverageStatus?: 'full' | 'partial';
  readonly browserCoverageStatus?: 'full' | 'partial' | 'none';
  readonly staticCoverageStatus?: 'full' | 'partial' | 'none';
  readonly coverageWarning?: string;
}

export interface ReportSummaryModel {
  readonly totalFindings: number;
  readonly bySeverity: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly info: number;
  };
  readonly byCategory: Readonly<Record<string, number>>;
  readonly confirmedCount: number;
  readonly firmCount?: number;
  readonly potentialCount: number;
  readonly byStatus?: Readonly<Record<string, number>>;
  readonly pagesScanned: number;
  readonly pagesFailed: number;
  readonly browserPagesAudited?: number;
  readonly screenshotsCaptured?: number;
  readonly scanDurationMs: number | null;
  readonly scanStatus: ScanRunStatus;
  readonly isPartialAudit?: boolean;
  readonly completedEngines?: readonly string[];
  readonly interruptedEngine?: string | null;
  readonly browserCandidatesTotal?: number;
  readonly browserCandidatesSkipped?: number;
  readonly isPartialCoverage?: boolean;
  readonly coverageStatus?: 'full' | 'partial';
  readonly browserCoverageStatus?: 'full' | 'partial' | 'none';
  readonly staticCoverageStatus?: 'full' | 'partial' | 'none';
  readonly coverageWarning?: string;
  readonly generatedAt: string;
}

export interface ReportModel {
  readonly reportId: string;
  readonly title: string;
  readonly site: ReportSiteModel;
  readonly scanRun: ReportScanRunModel;
  readonly findings: readonly FindingDTO[];
  readonly consolidatedFindings?: readonly ConsolidatedFindingDTO[];
  readonly summary: ReportSummaryModel;
  readonly visualEvidence?: Readonly<Record<string, ReportVisualEvidenceEntry>>;
  readonly generatedAt: string;
  readonly version: string;
}
