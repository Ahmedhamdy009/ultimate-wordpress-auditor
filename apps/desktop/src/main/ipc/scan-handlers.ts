import {
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  IPCError,
  type ScanRunDTO,
  type ScanRunListResponseDTO,
  type ScanProgressDTO,
  type FindingDTO,
  type FindingListResponseDTO,
  type ReportDTO,
  type ReportListResponseDTO,
  type DeleteReportResponseDTO,
  type ReportContentDTO,
} from '@auditor/shared';
import type { IpcChannelHandler, SecureIpcDispatcher } from './dispatcher.js';
import type { IScanRunService } from '../services/scan-run.service.js';
import type { IFindingService } from '../services/finding.service.js';
import type { IReportService } from '../services/report.service.js';
import type { IScanOrchestrator } from '../scanner/orchestrator/types.js';
import {
  SCAN_ORCHESTRATOR_ERROR_CODES,
  ScanOrchestratorError,
} from '../scanner/orchestrator/errors.js';

// --- Scan Run Handler Factories ---

export function createScanCreateHandler(
  service: IScanRunService,
  orchestrator?: IScanOrchestrator,
): IpcChannelHandler<typeof IPC_CHANNELS.SCAN_CREATE> {
  return async (request, context): Promise<ScanRunDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    if (orchestrator) {
      try {
        const run = orchestrator.createScan(request);
        // Fire-and-forget execution in background; orchestrator handles DB failure state
        orchestrator.executeScan(run.id).catch(() => {
          // Internal errors are recorded directly to SQLite scan_runs table by orchestrator
        });
        return run;
      } catch (err) {
        if (err instanceof ScanOrchestratorError) {
          if (
            err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SITE_NOT_FOUND ||
            err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SITE_ARCHIVED
          ) {
            throw new IPCError(err.message, IPC_ERROR_CODES.SITE_NOT_FOUND);
          }
          if (
            err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_CONCURRENT_SCAN_LIMIT_REACHED ||
            err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SITE_SCAN_IN_PROGRESS
          ) {
            throw new IPCError(err.message, IPC_ERROR_CODES.SCAN_RUN_ACTIVE);
          }
          if (err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INVALID_ENTRY_URL) {
            throw new IPCError(err.message, IPC_ERROR_CODES.INVALID_TARGET_URL);
          }
          if (err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INVALID_SCAN_CONFIG) {
            throw new IPCError(err.message, IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
          }
        }
        if (err instanceof IPCError) throw err;
        throw new IPCError(
          err instanceof Error ? err.message : 'Failed to create scan run',
          IPC_ERROR_CODES.INTERNAL_ERROR,
        );
      }
    }
    return service.createScanRun(request);
  };
}

export function createScanGetHandler(
  service: IScanRunService,
): IpcChannelHandler<typeof IPC_CHANNELS.SCAN_GET> {
  return async (request, context): Promise<ScanRunDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.getScanRunById(request);
  };
}

export function createScanListHandler(
  service: IScanRunService,
): IpcChannelHandler<typeof IPC_CHANNELS.SCAN_LIST> {
  return async (request, context): Promise<ScanRunListResponseDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.listScanRuns(request);
  };
}

export function createScanCancelHandler(
  service: IScanRunService,
  orchestrator?: IScanOrchestrator,
): IpcChannelHandler<typeof IPC_CHANNELS.SCAN_CANCEL> {
  return async (request, context): Promise<ScanRunDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    if (orchestrator) {
      try {
        return await orchestrator.cancelScan(request);
      } catch (err) {
        if (err instanceof ScanOrchestratorError) {
          if (err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_NOT_FOUND) {
            throw new IPCError(err.message, IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND);
          }
          if (err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_ALREADY_TERMINAL) {
            throw new IPCError(err.message, IPC_ERROR_CODES.SCAN_RUN_INVALID_TRANSITION);
          }
        }
        if (err instanceof IPCError) throw err;
        throw new IPCError(
          err instanceof Error ? err.message : 'Failed to cancel scan run',
          IPC_ERROR_CODES.INTERNAL_ERROR,
        );
      }
    }
    return service.cancelScanRun(request);
  };
}

export function createScanProgressHandler(
  orchestrator: IScanOrchestrator,
): IpcChannelHandler<typeof IPC_CHANNELS.SCAN_PROGRESS> {
  return async (request, context): Promise<ScanProgressDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    try {
      return orchestrator.getScanProgress(request);
    } catch (err) {
      if (err instanceof ScanOrchestratorError) {
        if (err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_NOT_FOUND) {
          throw new IPCError(err.message, IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND);
        }
      }
      if (err instanceof IPCError) throw err;
      throw new IPCError(
        err instanceof Error ? err.message : 'Failed to retrieve scan progress',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
  };
}

// --- Finding Handler Factories ---

export function createFindingListHandler(
  service: IFindingService,
): IpcChannelHandler<typeof IPC_CHANNELS.FINDING_LIST> {
  return async (request, context): Promise<FindingListResponseDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.listFindings(request);
  };
}

export function createFindingGetHandler(
  service: IFindingService,
): IpcChannelHandler<typeof IPC_CHANNELS.FINDING_GET> {
  return async (request, context): Promise<FindingDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.getFindingById(request);
  };
}

// --- Report Handler Factories ---

export function createReportCreateHandler(
  service: IReportService,
): IpcChannelHandler<typeof IPC_CHANNELS.REPORT_CREATE> {
  return async (request, context): Promise<ReportDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.createReport(request);
  };
}

export function createReportGetHandler(
  service: IReportService,
): IpcChannelHandler<typeof IPC_CHANNELS.REPORT_GET> {
  return async (request, context): Promise<ReportDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.getReportById(request);
  };
}

export function createReportListHandler(
  service: IReportService,
): IpcChannelHandler<typeof IPC_CHANNELS.REPORT_LIST> {
  return async (request, context): Promise<ReportListResponseDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.listReports(request);
  };
}

export function createReportDeleteHandler(
  service: IReportService,
): IpcChannelHandler<typeof IPC_CHANNELS.REPORT_DELETE> {
  return async (request, context): Promise<DeleteReportResponseDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.deleteReport(request);
  };
}

export function createReportGetContentHandler(
  service: IReportService,
): IpcChannelHandler<typeof IPC_CHANNELS.REPORT_GET_CONTENT> {
  return async (request, context): Promise<ReportContentDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.getReportContent(request);
  };
}

/**
 * Registers all Scan, Finding, and Report handlers with the SecureIpcDispatcher.
 */
export function registerScanHandlers(
  dispatcher: SecureIpcDispatcher,
  scanService: IScanRunService,
  findingService: IFindingService,
  reportService: IReportService,
  orchestrator?: IScanOrchestrator,
): void {
  // Scan Runs
  dispatcher.registerHandler(
    IPC_CHANNELS.SCAN_CREATE,
    createScanCreateHandler(scanService, orchestrator),
  );
  dispatcher.registerHandler(IPC_CHANNELS.SCAN_GET, createScanGetHandler(scanService));
  dispatcher.registerHandler(IPC_CHANNELS.SCAN_LIST, createScanListHandler(scanService));
  dispatcher.registerHandler(
    IPC_CHANNELS.SCAN_CANCEL,
    createScanCancelHandler(scanService, orchestrator),
  );
  if (orchestrator) {
    dispatcher.registerHandler(IPC_CHANNELS.SCAN_PROGRESS, createScanProgressHandler(orchestrator));
  }

  // Findings
  dispatcher.registerHandler(IPC_CHANNELS.FINDING_LIST, createFindingListHandler(findingService));
  dispatcher.registerHandler(IPC_CHANNELS.FINDING_GET, createFindingGetHandler(findingService));

  // Reports
  dispatcher.registerHandler(IPC_CHANNELS.REPORT_CREATE, createReportCreateHandler(reportService));
  dispatcher.registerHandler(IPC_CHANNELS.REPORT_GET, createReportGetHandler(reportService));
  dispatcher.registerHandler(IPC_CHANNELS.REPORT_LIST, createReportListHandler(reportService));
  dispatcher.registerHandler(IPC_CHANNELS.REPORT_DELETE, createReportDeleteHandler(reportService));
  dispatcher.registerHandler(
    IPC_CHANNELS.REPORT_GET_CONTENT,
    createReportGetContentHandler(reportService),
  );
}
