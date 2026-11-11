import type {
  IPCResult,
  AppPingResponse,
  AppSystemInfoResponse,
  AuditValidateTargetRequest,
  AuditValidateTargetResponse,
  CreateProjectDTO,
  GetProjectDTO,
  ListProjectsQueryDTO,
  UpdateProjectDTO,
  ArchiveProjectDTO,
  RestoreProjectDTO,
  ProjectDTO,
  ProjectListResponseDTO,
  ArchiveProjectResultDTO,
  CreateSiteDTO,
  GetSiteDTO,
  ListSitesQueryDTO,
  UpdateSiteDTO,
  ArchiveSiteDTO,
  RestoreSiteDTO,
  SiteDTO,
  SiteListResponseDTO,
  CreateScanRunDTO,
  GetScanRunDTO,
  ListScanRunsQueryDTO,
  CancelScanRunDTO,
  GetScanProgressDTO,
  ScanProgressDTO,
  ScanRunDTO,
  ScanRunListResponseDTO,
  ListFindingsQueryDTO,
  GetFindingDTO,
  FindingDTO,
  FindingListResponseDTO,
  CreateReportDTO,
  GetReportDTO,
  ListReportsQueryDTO,
  ReportDTO,
  ReportListResponseDTO,
  DeleteReportDTO,
  DeleteReportResponseDTO,
  GetReportContentDTO,
  ReportContentDTO,
} from '@auditor/shared';

/**
 * Canonical strongly typed interface for the secure Electron Preload-to-Renderer bridge.
 * Shared across Preload and Renderer via type-only imports without circular runtime dependencies.
 */
export interface ElectronAPI {
  readonly ping: () => Promise<IPCResult<AppPingResponse>>;
  readonly getSystemInfo: () => Promise<IPCResult<AppSystemInfoResponse>>;
  readonly validateTarget: (
    request: AuditValidateTargetRequest,
  ) => Promise<IPCResult<AuditValidateTargetResponse>>;

  // Project operations (Phase 2.2)
  readonly createProject: (request: CreateProjectDTO) => Promise<IPCResult<ProjectDTO>>;
  readonly getProject: (request: GetProjectDTO) => Promise<IPCResult<ProjectDTO>>;
  readonly listProjects: (
    request?: ListProjectsQueryDTO,
  ) => Promise<IPCResult<ProjectListResponseDTO>>;
  readonly updateProject: (request: UpdateProjectDTO) => Promise<IPCResult<ProjectDTO>>;
  readonly archiveProject: (
    request: ArchiveProjectDTO,
  ) => Promise<IPCResult<ArchiveProjectResultDTO>>;
  readonly restoreProject: (request: RestoreProjectDTO) => Promise<IPCResult<ProjectDTO>>;

  // Site operations (Phase 2.2)
  readonly createSite: (request: CreateSiteDTO) => Promise<IPCResult<SiteDTO>>;
  readonly getSite: (request: GetSiteDTO) => Promise<IPCResult<SiteDTO>>;
  readonly listSites: (request?: ListSitesQueryDTO) => Promise<IPCResult<SiteListResponseDTO>>;
  readonly updateSite: (request: UpdateSiteDTO) => Promise<IPCResult<SiteDTO>>;
  readonly archiveSite: (request: ArchiveSiteDTO) => Promise<IPCResult<SiteDTO>>;
  readonly restoreSite: (request: RestoreSiteDTO) => Promise<IPCResult<SiteDTO>>;

  // Scan operations (Phase 2.3)
  readonly createScanRun: (request: CreateScanRunDTO) => Promise<IPCResult<ScanRunDTO>>;
  readonly getScanRun: (request: GetScanRunDTO) => Promise<IPCResult<ScanRunDTO>>;
  readonly listScanRuns: (
    request?: ListScanRunsQueryDTO,
  ) => Promise<IPCResult<ScanRunListResponseDTO>>;
  readonly cancelScanRun: (request: CancelScanRunDTO) => Promise<IPCResult<ScanRunDTO>>;
  readonly getScanProgress: (request: GetScanProgressDTO) => Promise<IPCResult<ScanProgressDTO>>;

  // Finding operations (Phase 2.3)
  readonly listFindings: (
    request: ListFindingsQueryDTO,
  ) => Promise<IPCResult<FindingListResponseDTO>>;
  readonly getFinding: (request: GetFindingDTO) => Promise<IPCResult<FindingDTO>>;

  // Report operations (Phase 2.3)
  readonly createReport: (request: CreateReportDTO) => Promise<IPCResult<ReportDTO>>;
  readonly getReport: (request: GetReportDTO) => Promise<IPCResult<ReportDTO>>;
  readonly listReports: (
    request?: ListReportsQueryDTO,
  ) => Promise<IPCResult<ReportListResponseDTO>>;
  readonly deleteReport: (request: DeleteReportDTO) => Promise<IPCResult<DeleteReportResponseDTO>>;
  readonly getReportContent: (request: GetReportContentDTO) => Promise<IPCResult<ReportContentDTO>>;
}

/**
 * Standard typed IPC response envelope.
 * Masks internal errors and stack traces from the renderer.
 */
export type IpcResult<T> = IPCResult<T>;

export interface SystemInfoData {
  platform: string;
  arch: string;
  version: string;
}

export interface PingData {
  pong: boolean;
  timestamp: number;
}

export interface ValidateTargetResultData {
  valid: boolean;
  normalized?: string;
  reason?: string;
}
