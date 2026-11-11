import {
  IPCError,
  IPC_ERROR_CODES,
  type CreateScanRunRequest,
  type GetScanRunRequest,
  type ListScanRunsRequest,
  type CancelScanRunRequest,
  type UpdateScanRunStatusRequest,
  type ScanRunDTO,
  type ScanRunListResponseDTO,
  isValidScanRunTransition,
  isTerminalScanRunStatus,
} from '@auditor/shared';
import type { ScanRunRepository } from '../db/repositories/scan-run.repository.js';
import type { SiteRepository } from '../db/repositories/site.repository.js';

export interface IScanRunService {
  createScanRun(request: CreateScanRunRequest): ScanRunDTO;
  getScanRunById(request: GetScanRunRequest): ScanRunDTO;
  listScanRuns(request?: ListScanRunsRequest): ScanRunListResponseDTO;
  cancelScanRun(request: CancelScanRunRequest): ScanRunDTO;
  updateScanRunStatus(request: UpdateScanRunStatusRequest): ScanRunDTO;
}

export class ScanRunService implements IScanRunService {
  private readonly scanRunRepo: ScanRunRepository;
  private readonly siteRepo: SiteRepository;

  constructor(scanRunRepo: ScanRunRepository, siteRepo: SiteRepository) {
    this.scanRunRepo = scanRunRepo;
    this.siteRepo = siteRepo;
  }

  /**
   * Creates a new scan run in 'pending' state.
   * Business Rules:
   * - Target site must exist and must not be archived.
   * - Target URL defaults to site base URL if not explicitly supplied.
   */
  public createScanRun(request: CreateScanRunRequest): ScanRunDTO {
    const site = this.siteRepo.getById(request.siteId);
    if (!site) {
      throw new IPCError(`Site '${request.siteId}' not found`, IPC_ERROR_CODES.SITE_NOT_FOUND);
    }

    if (site.isArchived) {
      throw new IPCError(
        `Cannot create scan run for archived site '${site.name}'`,
        IPC_ERROR_CODES.SITE_NOT_FOUND,
      );
    }

    const targetUrl =
      request.targetUrl && request.targetUrl.trim() !== ''
        ? request.targetUrl.trim()
        : site.baseUrl;

    try {
      return this.scanRunRepo.create({
        siteId: site.id,
        scanType: request.scanType ?? 'full',
        targetUrl,
        config: request.config ?? {},
      });
    } catch {
      throw new IPCError('Failed to create scan run in database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Retrieves a scan run by ID.
   */
  public getScanRunById(request: GetScanRunRequest): ScanRunDTO {
    const run = this.scanRunRepo.getById(request.id);
    if (!run) {
      throw new IPCError(`Scan run '${request.id}' not found`, IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND);
    }
    return run;
  }

  /**
   * Lists scan runs with optional filters and pagination.
   */
  public listScanRuns(request?: ListScanRunsRequest): ScanRunListResponseDTO {
    try {
      return this.scanRunRepo.list({
        siteId: request?.siteId,
        status: request?.status,
        limit: request?.limit,
        offset: request?.offset,
      });
    } catch {
      throw new IPCError('Failed to list scan runs from database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Cancels a pending or running scan run.
   */
  public cancelScanRun(request: CancelScanRunRequest): ScanRunDTO {
    const current = this.getScanRunById(request);

    if (isTerminalScanRunStatus(current.status)) {
      throw new IPCError(
        `Cannot cancel scan run in terminal status '${current.status}'`,
        IPC_ERROR_CODES.SCAN_RUN_INVALID_TRANSITION,
      );
    }

    if (!isValidScanRunTransition(current.status, 'cancelled')) {
      throw new IPCError(
        `Cannot transition scan run from '${current.status}' to 'cancelled'`,
        IPC_ERROR_CODES.SCAN_RUN_INVALID_TRANSITION,
      );
    }

    const now = new Date().toISOString();
    let durationMs: number | null = null;
    if (current.startedAt) {
      durationMs = Math.max(0, Date.now() - new Date(current.startedAt).getTime());
    }

    try {
      return this.scanRunRepo.updateStatus(request.id, {
        status: 'cancelled',
        cancelledAt: now,
        durationMs,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('ERR_SCAN_RUN_INVALID_TRANSITION')) {
        throw new IPCError(err.message, IPC_ERROR_CODES.SCAN_RUN_INVALID_TRANSITION);
      }
      throw new IPCError('Failed to cancel scan run in database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Updates scan run status (e.g. running -> completed / failed).
   */
  public updateScanRunStatus(request: UpdateScanRunStatusRequest): ScanRunDTO {
    const current = this.scanRunRepo.getById(request.id);
    if (!current) {
      throw new IPCError(`Scan run '${request.id}' not found`, IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND);
    }

    if (!isValidScanRunTransition(current.status, request.status)) {
      throw new IPCError(
        `Cannot transition scan run from '${current.status}' to '${request.status}'`,
        IPC_ERROR_CODES.SCAN_RUN_INVALID_TRANSITION,
      );
    }

    const now = new Date().toISOString();
    let startedAt = current.startedAt;
    let completedAt = current.completedAt;
    let cancelledAt = current.cancelledAt;
    let durationMs = current.durationMs;

    if (request.status === 'running' && !startedAt) {
      startedAt = now;
    } else if (request.status === 'completed' || request.status === 'failed') {
      completedAt = now;
      if (startedAt) {
        durationMs = Math.max(0, new Date(now).getTime() - new Date(startedAt).getTime());
      }
    } else if (request.status === 'cancelled') {
      cancelledAt = now;
      if (startedAt) {
        durationMs = Math.max(0, new Date(now).getTime() - new Date(startedAt).getTime());
      }
    }

    try {
      return this.scanRunRepo.updateStatus(request.id, {
        status: request.status,
        startedAt,
        completedAt,
        cancelledAt,
        durationMs,
        summary: request.summary ?? null,
        error: request.error ?? null,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('ERR_SCAN_RUN_INVALID_TRANSITION')) {
        throw new IPCError(err.message, IPC_ERROR_CODES.SCAN_RUN_INVALID_TRANSITION);
      }
      throw new IPCError(
        'Failed to update scan run status in database',
        IPC_ERROR_CODES.DATABASE_ERROR,
      );
    }
  }
}
