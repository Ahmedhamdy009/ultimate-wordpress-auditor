import { IPC_CHANNELS, type IPCChannel } from './channels.js';
import {
  AppPingRequestSchema,
  AppPingResponseSchema,
  type AppPingRequest,
  type AppPingResponse,
  AppSystemInfoRequestSchema,
  AppSystemInfoResponseSchema,
  type AppSystemInfoRequest,
  type AppSystemInfoResponse,
  AuditValidateTargetRequestSchema,
  AuditValidateTargetResponseSchema,
  type AuditValidateTargetRequest,
  type AuditValidateTargetResponse,
} from './schemas.js';
import {
  CreateProjectRequestSchema,
  GetProjectRequestSchema,
  ListProjectsRequestSchema,
  UpdateProjectRequestSchema,
  ArchiveProjectRequestSchema,
  RestoreProjectRequestSchema,
  ProjectDTOSchema,
  ProjectListResponseDTOSchema,
  ArchiveProjectResultDTOSchema,
  type CreateProjectRequest,
  type GetProjectRequest,
  type ListProjectsRequest,
  type UpdateProjectRequest,
  type ArchiveProjectRequest,
  type RestoreProjectRequest,
  type ProjectDTO,
  type ProjectListResponseDTO,
  type ArchiveProjectResultDTO,
} from '../schemas/project.js';
import {
  CreateSiteRequestSchema,
  GetSiteRequestSchema,
  ListSitesRequestSchema,
  UpdateSiteRequestSchema,
  ArchiveSiteRequestSchema,
  RestoreSiteRequestSchema,
  SiteDTOSchema,
  SiteListResponseDTOSchema,
  type CreateSiteRequest,
  type GetSiteRequest,
  type ListSitesRequest,
  type UpdateSiteRequest,
  type ArchiveSiteRequest,
  type RestoreSiteRequest,
  type SiteDTO,
  type SiteListResponseDTO,
} from '../schemas/site.js';
import {
  CreateScanRunRequestSchema,
  GetScanRunRequestSchema,
  ListScanRunsRequestSchema,
  CancelScanRunRequestSchema,
  GetScanProgressRequestSchema,
  ScanRunDTOSchema,
  ScanRunListResponseDTOSchema,
  ScanProgressDTOSchema,
  type CreateScanRunRequest,
  type GetScanRunRequest,
  type ListScanRunsRequest,
  type CancelScanRunRequest,
  type GetScanProgressRequest,
  type ScanRunDTO,
  type ScanRunListResponseDTO,
  type ScanProgressDTO,
} from '../schemas/scan-run.js';
import {
  GetFindingRequestSchema,
  ListFindingsRequestSchema,
  FindingDTOSchema,
  FindingListResponseDTOSchema,
  type GetFindingRequest,
  type ListFindingsRequest,
  type FindingDTO,
  type FindingListResponseDTO,
} from '../schemas/finding.js';
import {
  CreateReportRequestSchema,
  GetReportRequestSchema,
  ListReportsRequestSchema,
  DeleteReportRequestSchema,
  DeleteReportResponseDTOSchema,
  GetReportContentRequestSchema,
  ReportContentDTOSchema,
  ReportDTOSchema,
  ReportListResponseDTOSchema,
  type CreateReportRequest,
  type GetReportRequest,
  type ListReportsRequest,
  type DeleteReportRequest,
  type DeleteReportResponseDTO,
  type GetReportContentRequest,
  type ReportContentDTO,
  type ReportDTO,
  type ReportListResponseDTO,
} from '../schemas/report.js';
import {
  IPCError,
  IPCValidationError,
  IPC_ERROR_CODES,
  sanitizeZodIssues,
  type IPCSerializedError,
} from './errors.js';

export type IPCResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: IPCSerializedError };

export const IPC_CONTRACTS = {
  [IPC_CHANNELS.APP_PING]: {
    requestSchema: AppPingRequestSchema,
    responseSchema: AppPingResponseSchema,
  },
  [IPC_CHANNELS.APP_GET_SYSTEM_INFO]: {
    requestSchema: AppSystemInfoRequestSchema,
    responseSchema: AppSystemInfoResponseSchema,
  },
  [IPC_CHANNELS.AUDIT_VALIDATE_TARGET]: {
    requestSchema: AuditValidateTargetRequestSchema,
    responseSchema: AuditValidateTargetResponseSchema,
  },

  // Project Management Contracts
  [IPC_CHANNELS.PROJECT_CREATE]: {
    requestSchema: CreateProjectRequestSchema,
    responseSchema: ProjectDTOSchema,
  },
  [IPC_CHANNELS.PROJECT_GET]: {
    requestSchema: GetProjectRequestSchema,
    responseSchema: ProjectDTOSchema,
  },
  [IPC_CHANNELS.PROJECT_LIST]: {
    requestSchema: ListProjectsRequestSchema,
    responseSchema: ProjectListResponseDTOSchema,
  },
  [IPC_CHANNELS.PROJECT_UPDATE]: {
    requestSchema: UpdateProjectRequestSchema,
    responseSchema: ProjectDTOSchema,
  },
  [IPC_CHANNELS.PROJECT_ARCHIVE]: {
    requestSchema: ArchiveProjectRequestSchema,
    responseSchema: ArchiveProjectResultDTOSchema,
  },
  [IPC_CHANNELS.PROJECT_RESTORE]: {
    requestSchema: RestoreProjectRequestSchema,
    responseSchema: ProjectDTOSchema,
  },

  // Site Management Contracts
  [IPC_CHANNELS.SITE_CREATE]: {
    requestSchema: CreateSiteRequestSchema,
    responseSchema: SiteDTOSchema,
  },
  [IPC_CHANNELS.SITE_GET]: {
    requestSchema: GetSiteRequestSchema,
    responseSchema: SiteDTOSchema,
  },
  [IPC_CHANNELS.SITE_LIST]: {
    requestSchema: ListSitesRequestSchema,
    responseSchema: SiteListResponseDTOSchema,
  },
  [IPC_CHANNELS.SITE_UPDATE]: {
    requestSchema: UpdateSiteRequestSchema,
    responseSchema: SiteDTOSchema,
  },
  [IPC_CHANNELS.SITE_ARCHIVE]: {
    requestSchema: ArchiveSiteRequestSchema,
    responseSchema: SiteDTOSchema,
  },
  [IPC_CHANNELS.SITE_RESTORE]: {
    requestSchema: RestoreSiteRequestSchema,
    responseSchema: SiteDTOSchema,
  },

  // Scan Run Contracts (Phase 2.3)
  [IPC_CHANNELS.SCAN_CREATE]: {
    requestSchema: CreateScanRunRequestSchema,
    responseSchema: ScanRunDTOSchema,
  },
  [IPC_CHANNELS.SCAN_GET]: {
    requestSchema: GetScanRunRequestSchema,
    responseSchema: ScanRunDTOSchema,
  },
  [IPC_CHANNELS.SCAN_LIST]: {
    requestSchema: ListScanRunsRequestSchema,
    responseSchema: ScanRunListResponseDTOSchema,
  },
  [IPC_CHANNELS.SCAN_CANCEL]: {
    requestSchema: CancelScanRunRequestSchema,
    responseSchema: ScanRunDTOSchema,
  },
  [IPC_CHANNELS.SCAN_PROGRESS]: {
    requestSchema: GetScanProgressRequestSchema,
    responseSchema: ScanProgressDTOSchema,
  },

  // Finding Contracts (Phase 2.3)
  [IPC_CHANNELS.FINDING_LIST]: {
    requestSchema: ListFindingsRequestSchema,
    responseSchema: FindingListResponseDTOSchema,
  },
  [IPC_CHANNELS.FINDING_GET]: {
    requestSchema: GetFindingRequestSchema,
    responseSchema: FindingDTOSchema,
  },

  // Report Contracts (Phase 2.3 & Batch 3.6)
  [IPC_CHANNELS.REPORT_CREATE]: {
    requestSchema: CreateReportRequestSchema,
    responseSchema: ReportDTOSchema,
  },
  [IPC_CHANNELS.REPORT_GET]: {
    requestSchema: GetReportRequestSchema,
    responseSchema: ReportDTOSchema,
  },
  [IPC_CHANNELS.REPORT_LIST]: {
    requestSchema: ListReportsRequestSchema,
    responseSchema: ReportListResponseDTOSchema,
  },
  [IPC_CHANNELS.REPORT_DELETE]: {
    requestSchema: DeleteReportRequestSchema,
    responseSchema: DeleteReportResponseDTOSchema,
  },
  [IPC_CHANNELS.REPORT_GET_CONTENT]: {
    requestSchema: GetReportContentRequestSchema,
    responseSchema: ReportContentDTOSchema,
  },
} as const;

export type IPCContracts = typeof IPC_CONTRACTS;

export type IPCChannelRequest<C extends IPCChannel> = C extends typeof IPC_CHANNELS.APP_PING
  ? AppPingRequest
  : C extends typeof IPC_CHANNELS.APP_GET_SYSTEM_INFO
    ? AppSystemInfoRequest
    : C extends typeof IPC_CHANNELS.AUDIT_VALIDATE_TARGET
      ? AuditValidateTargetRequest
      : C extends typeof IPC_CHANNELS.PROJECT_CREATE
        ? CreateProjectRequest
        : C extends typeof IPC_CHANNELS.PROJECT_GET
          ? GetProjectRequest
          : C extends typeof IPC_CHANNELS.PROJECT_LIST
            ? ListProjectsRequest
            : C extends typeof IPC_CHANNELS.PROJECT_UPDATE
              ? UpdateProjectRequest
              : C extends typeof IPC_CHANNELS.PROJECT_ARCHIVE
                ? ArchiveProjectRequest
                : C extends typeof IPC_CHANNELS.PROJECT_RESTORE
                  ? RestoreProjectRequest
                  : C extends typeof IPC_CHANNELS.SITE_CREATE
                    ? CreateSiteRequest
                    : C extends typeof IPC_CHANNELS.SITE_GET
                      ? GetSiteRequest
                      : C extends typeof IPC_CHANNELS.SITE_LIST
                        ? ListSitesRequest
                        : C extends typeof IPC_CHANNELS.SITE_UPDATE
                          ? UpdateSiteRequest
                          : C extends typeof IPC_CHANNELS.SITE_ARCHIVE
                            ? ArchiveSiteRequest
                            : C extends typeof IPC_CHANNELS.SITE_RESTORE
                              ? RestoreSiteRequest
                              : C extends typeof IPC_CHANNELS.SCAN_CREATE
                                ? CreateScanRunRequest
                                : C extends typeof IPC_CHANNELS.SCAN_GET
                                  ? GetScanRunRequest
                                  : C extends typeof IPC_CHANNELS.SCAN_LIST
                                    ? ListScanRunsRequest
                                    : C extends typeof IPC_CHANNELS.SCAN_CANCEL
                                      ? CancelScanRunRequest
                                      : C extends typeof IPC_CHANNELS.SCAN_PROGRESS
                                        ? GetScanProgressRequest
                                        : C extends typeof IPC_CHANNELS.FINDING_LIST
                                          ? ListFindingsRequest
                                          : C extends typeof IPC_CHANNELS.FINDING_GET
                                            ? GetFindingRequest
                                            : C extends typeof IPC_CHANNELS.REPORT_CREATE
                                              ? CreateReportRequest
                                              : C extends typeof IPC_CHANNELS.REPORT_GET
                                                ? GetReportRequest
                                                : C extends typeof IPC_CHANNELS.REPORT_LIST
                                                  ? ListReportsRequest
                                                  : C extends typeof IPC_CHANNELS.REPORT_DELETE
                                                    ? DeleteReportRequest
                                                    : C extends typeof IPC_CHANNELS.REPORT_GET_CONTENT
                                                      ? GetReportContentRequest
                                                      : never;

export type IPCChannelResponse<C extends IPCChannel> = C extends typeof IPC_CHANNELS.APP_PING
  ? AppPingResponse
  : C extends typeof IPC_CHANNELS.APP_GET_SYSTEM_INFO
    ? AppSystemInfoResponse
    : C extends typeof IPC_CHANNELS.AUDIT_VALIDATE_TARGET
      ? AuditValidateTargetResponse
      : C extends typeof IPC_CHANNELS.PROJECT_CREATE
        ? ProjectDTO
        : C extends typeof IPC_CHANNELS.PROJECT_GET
          ? ProjectDTO
          : C extends typeof IPC_CHANNELS.PROJECT_LIST
            ? ProjectListResponseDTO
            : C extends typeof IPC_CHANNELS.PROJECT_UPDATE
              ? ProjectDTO
              : C extends typeof IPC_CHANNELS.PROJECT_ARCHIVE
                ? ArchiveProjectResultDTO
                : C extends typeof IPC_CHANNELS.PROJECT_RESTORE
                  ? ProjectDTO
                  : C extends typeof IPC_CHANNELS.SITE_CREATE
                    ? SiteDTO
                    : C extends typeof IPC_CHANNELS.SITE_GET
                      ? SiteDTO
                      : C extends typeof IPC_CHANNELS.SITE_LIST
                        ? SiteListResponseDTO
                        : C extends typeof IPC_CHANNELS.SITE_UPDATE
                          ? SiteDTO
                          : C extends typeof IPC_CHANNELS.SITE_ARCHIVE
                            ? SiteDTO
                            : C extends typeof IPC_CHANNELS.SITE_RESTORE
                              ? SiteDTO
                              : C extends typeof IPC_CHANNELS.SCAN_CREATE
                                ? ScanRunDTO
                                : C extends typeof IPC_CHANNELS.SCAN_GET
                                  ? ScanRunDTO
                                  : C extends typeof IPC_CHANNELS.SCAN_LIST
                                    ? ScanRunListResponseDTO
                                    : C extends typeof IPC_CHANNELS.SCAN_CANCEL
                                      ? ScanRunDTO
                                      : C extends typeof IPC_CHANNELS.SCAN_PROGRESS
                                        ? ScanProgressDTO
                                        : C extends typeof IPC_CHANNELS.FINDING_LIST
                                          ? FindingListResponseDTO
                                          : C extends typeof IPC_CHANNELS.FINDING_GET
                                            ? FindingDTO
                                            : C extends typeof IPC_CHANNELS.REPORT_CREATE
                                              ? ReportDTO
                                              : C extends typeof IPC_CHANNELS.REPORT_GET
                                                ? ReportDTO
                                                : C extends typeof IPC_CHANNELS.REPORT_LIST
                                                  ? ReportListResponseDTO
                                                  : C extends typeof IPC_CHANNELS.REPORT_DELETE
                                                    ? DeleteReportResponseDTO
                                                    : C extends typeof IPC_CHANNELS.REPORT_GET_CONTENT
                                                      ? ReportContentDTO
                                                      : never;

export function validateIPCRequest<C extends IPCChannel>(
  channel: C,
  payload: unknown,
): IPCChannelRequest<C> {
  const contract = (
    IPC_CONTRACTS as Record<
      string,
      {
        requestSchema: {
          safeParse: (p: unknown) => {
            success: boolean;
            data?: unknown;
            error?: { issues: unknown[] };
          };
        };
        responseSchema: {
          safeParse: (p: unknown) => {
            success: boolean;
            data?: unknown;
            error?: { issues: unknown[] };
          };
        };
      }
    >
  )[channel];
  if (!contract) {
    throw new IPCError(
      `Unknown IPC channel: '${String(channel)}'`,
      IPC_ERROR_CODES.CHANNEL_NOT_FOUND,
    );
  }
  const result = contract.requestSchema.safeParse(payload);
  if (!result.success) {
    const sanitizedDetails = sanitizeZodIssues(
      result.error!.issues as unknown as Parameters<typeof sanitizeZodIssues>[0],
    );
    throw new IPCValidationError(
      `Request validation failed for channel '${channel}'`,
      sanitizedDetails,
    );
  }
  return result.data as IPCChannelRequest<C>;
}

export function validateIPCResponse<C extends IPCChannel>(
  channel: C,
  payload: unknown,
): IPCChannelResponse<C> {
  const contract = (
    IPC_CONTRACTS as Record<
      string,
      {
        requestSchema: {
          safeParse: (p: unknown) => {
            success: boolean;
            data?: unknown;
            error?: { issues: unknown[] };
          };
        };
        responseSchema: {
          safeParse: (p: unknown) => {
            success: boolean;
            data?: unknown;
            error?: { issues: unknown[] };
          };
        };
      }
    >
  )[channel];
  if (!contract) {
    throw new IPCError(
      `Unknown IPC channel: '${String(channel)}'`,
      IPC_ERROR_CODES.CHANNEL_NOT_FOUND,
    );
  }
  const result = contract.responseSchema.safeParse(payload);
  if (!result.success) {
    const sanitizedDetails = sanitizeZodIssues(
      result.error!.issues as unknown as Parameters<typeof sanitizeZodIssues>[0],
    );
    throw new IPCValidationError(
      `Response validation failed for channel '${channel}'`,
      sanitizedDetails,
    );
  }
  return result.data as IPCChannelResponse<C>;
}
