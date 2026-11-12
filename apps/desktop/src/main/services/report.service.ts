import path from 'node:path';
import {
  IPCError,
  IPC_ERROR_CODES,
  type CreateReportRequest,
  type GetReportRequest,
  type ListReportsRequest,
  type DeleteReportRequest,
  type DeleteReportResponseDTO,
  type GetReportContentRequest,
  type ReportContentDTO,
  type ReportDTO,
  type ReportListResponseDTO,
} from '@auditor/shared';
import type { ReportRepository } from '../db/repositories/report.repository.js';
import type { ScanRunRepository } from '../db/repositories/scan-run.repository.js';
import type { SiteRepository } from '../db/repositories/site.repository.js';
import type { FindingRepository } from '../db/repositories/finding.repository.js';
import {
  assembleReportData,
  generateHtmlReport,
  generateJsonReport,
  generateCsvReport,
  sanitizeReportFilename,
  saveReportToFile,
  readReportFile,
  deleteReportFile,
  reconcileReportsStorage,
  type ReportReconciliationResult,
} from '../reports/index.js';

export interface ReportServiceOptions {
  readonly siteRepo?: SiteRepository;
  readonly findingRepo?: FindingRepository;
  readonly reportsDir?: string;
  readonly screenshotsDir?: string;
}

export interface IReportService {
  createReport(request: CreateReportRequest): ReportDTO;
  getReportById(request: GetReportRequest): ReportDTO;
  listReports(request?: ListReportsRequest): ReportListResponseDTO;
  deleteReport(request: DeleteReportRequest): DeleteReportResponseDTO;
  getReportContent(request: GetReportContentRequest): ReportContentDTO;
  reconcileStorage(): ReportReconciliationResult;
}

export class ReportService implements IReportService {
  private readonly reportRepo: ReportRepository;
  private readonly scanRunRepo: ScanRunRepository;
  private readonly siteRepo?: SiteRepository;
  private readonly findingRepo?: FindingRepository;
  private readonly reportsDir?: string;
  private readonly screenshotsDir?: string;

  constructor(
    reportRepo: ReportRepository,
    scanRunRepo: ScanRunRepository,
    options?: ReportServiceOptions,
  ) {
    this.reportRepo = reportRepo;
    this.scanRunRepo = scanRunRepo;
    this.siteRepo = options?.siteRepo;
    this.findingRepo = options?.findingRepo;
    this.reportsDir = options?.reportsDir;
    this.screenshotsDir =
      options?.screenshotsDir ??
      (options?.reportsDir
        ? path.join(path.resolve(options.reportsDir), 'screenshots')
        : undefined);
  }

  /**
   * Creates an audit report.
   * If storagePath is not provided and repositories are available,
   * generates the standalone report (HTML/JSON) from persisted SQLite scan data,
   * writes the file atomically to the application reports directory,
   * and records the report metadata and summary in SQLite.
   */
  public createReport(request: CreateReportRequest): ReportDTO {
    const run = this.scanRunRepo.getById(request.scanRunId);
    if (!run) {
      throw new IPCError(
        `Associated scan run '${request.scanRunId}' not found`,
        IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND,
      );
    }

    let storagePath: string | null = request.storagePath ? request.storagePath.trim() : null;
    let summary: Record<string, unknown> | null = request.summary ?? null;

    // If storagePath is not provided and engine repositories are available, generate the report
    if (!storagePath && this.siteRepo && this.findingRepo) {
      const model = assembleReportData(
        request.scanRunId,
        {
          siteRepo: this.siteRepo,
          scanRunRepo: this.scanRunRepo,
          findingRepo: this.findingRepo,
        },
        {
          title: request.title,
          screenshotsDir: this.screenshotsDir,
        },
      );

      summary = (summary ?? model.summary) as Record<string, unknown>;

      let content: string;
      if (request.format === 'html') {
        content = generateHtmlReport(model);
      } else if (request.format === 'json') {
        content = generateJsonReport(model);
      } else if (request.format === 'csv') {
        content = generateCsvReport(model);
      } else if (request.format === 'pdf') {
        throw new IPCError(
          'PDF export format is not supported in this version. Use HTML, JSON, or CSV.',
          IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
        );
      } else {
        throw new IPCError(
          `Unsupported report format: '${request.format}'`,
          IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
        );
      }

      const filename = sanitizeReportFilename(
        request.title,
        request.format,
        model.scanRun.id.slice(0, 8),
      );

      const exported = saveReportToFile(content, {
        filename,
        directory: this.reportsDir,
      });

      storagePath = exported.storagePath;
    }

    try {
      return this.reportRepo.create({
        scanRunId: request.scanRunId,
        title: request.title.trim(),
        format: request.format,
        summary,
        storagePath,
      });
    } catch {
      throw new IPCError(
        'Failed to create report record in database',
        IPC_ERROR_CODES.DATABASE_ERROR,
      );
    }
  }

  /**
   * Retrieves a report by ID.
   */
  public getReportById(request: GetReportRequest): ReportDTO {
    const report = this.reportRepo.getById(request.id);
    if (!report) {
      throw new IPCError(`Report '${request.id}' not found`, IPC_ERROR_CODES.REPORT_NOT_FOUND);
    }
    return report;
  }

  /**
   * Lists reports with optional scanRun, site, status filters and pagination.
   */
  public listReports(request?: ListReportsRequest): ReportListResponseDTO {
    try {
      return this.reportRepo.list({
        scanRunId: request?.scanRunId,
        siteId: request?.siteId,
        status: request?.status,
        limit: request?.limit,
        offset: request?.offset,
      });
    } catch {
      throw new IPCError('Failed to list reports from database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Safely deletes a generated report:
   * 1. Removes the exported file from disk (if storagePath exists).
   * 2. Deletes the report record from SQLite.
   * Does NOT delete the underlying scan run or findings.
   */
  public deleteReport(request: DeleteReportRequest): DeleteReportResponseDTO {
    const report = this.reportRepo.getById(request.id);
    if (!report) {
      throw new IPCError(`Report '${request.id}' not found`, IPC_ERROR_CODES.REPORT_NOT_FOUND);
    }

    // 1. Delete from SQLite database first to ensure catalog consistency
    const deleted = this.reportRepo.delete(request.id);
    if (!deleted) {
      throw new IPCError(
        `Failed to delete report '${request.id}' from database`,
        IPC_ERROR_CODES.DATABASE_ERROR,
      );
    }

    // 2. Best-effort delete from filesystem (does not fail the operation if file was already gone)
    let fileDeleted = false;
    if (report.storagePath) {
      try {
        fileDeleted = deleteReportFile(report.storagePath, this.reportsDir);
      } catch {
        fileDeleted = false;
      }
    }

    return {
      success: true,
      id: request.id,
      fileDeleted,
    };
  }

  /**
   * Reconciles the reports directory against active SQLite records,
   * cleaning up orphaned report files from crashed deletions or interrupted temporary writes.
   */
  public reconcileStorage(): ReportReconciliationResult {
    const activePaths = this.reportRepo.getAllStoragePaths();
    return reconcileReportsStorage(activePaths, this.reportsDir);
  }

  /**
   * Safely reads the generated report file content for in-app viewing.
   */
  public getReportContent(request: GetReportContentRequest): ReportContentDTO {
    const report = this.reportRepo.getById(request.id);
    if (!report) {
      throw new IPCError(`Report '${request.id}' not found`, IPC_ERROR_CODES.REPORT_NOT_FOUND);
    }

    if (!report.storagePath) {
      throw new IPCError(
        `Report '${request.id}' has no exported file on disk`,
        IPC_ERROR_CODES.REPORT_NOT_FOUND,
      );
    }

    const content = readReportFile(report.storagePath, this.reportsDir);

    return {
      id: report.id,
      format: report.format,
      content,
      storagePath: report.storagePath,
    };
  }
}
