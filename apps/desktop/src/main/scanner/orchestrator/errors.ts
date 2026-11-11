/**
 * Error definitions and diagnostic codes for the Scan Orchestrator.
 */

export const SCAN_ORCHESTRATOR_ERROR_CODES = {
  ERR_SCAN_NOT_FOUND: 'ERR_SCAN_NOT_FOUND',
  ERR_SITE_NOT_FOUND: 'ERR_SITE_NOT_FOUND',
  ERR_SITE_ARCHIVED: 'ERR_SITE_ARCHIVED',
  ERR_SITE_SCAN_IN_PROGRESS: 'ERR_SITE_SCAN_IN_PROGRESS',
  ERR_CONCURRENT_SCAN_LIMIT_REACHED: 'ERR_CONCURRENT_SCAN_LIMIT_REACHED',
  ERR_INVALID_SCAN_CONFIG: 'ERR_INVALID_SCAN_CONFIG',
  ERR_INVALID_ENTRY_URL: 'ERR_INVALID_ENTRY_URL',
  ERR_SCAN_TIMEOUT: 'ERR_SCAN_TIMEOUT',
  ERR_SCAN_CANCELLED: 'ERR_SCAN_CANCELLED',
  ERR_SCAN_ALREADY_TERMINAL: 'ERR_SCAN_ALREADY_TERMINAL',
  ERR_PERSISTENCE_FAILED: 'ERR_PERSISTENCE_FAILED',
  ERR_CRAWL_FAILED: 'ERR_CRAWL_FAILED',
  ERR_INTERNAL_SCAN_ERROR: 'ERR_INTERNAL_SCAN_ERROR',
} as const;

export type ScanOrchestratorErrorCode =
  (typeof SCAN_ORCHESTRATOR_ERROR_CODES)[keyof typeof SCAN_ORCHESTRATOR_ERROR_CODES];

export class ScanOrchestratorError extends Error {
  public readonly code: ScanOrchestratorErrorCode;
  public readonly scanId?: string;
  public readonly siteId?: string;
  public readonly details?: unknown;

  constructor(
    code: ScanOrchestratorErrorCode,
    message: string,
    options?: {
      scanId?: string;
      siteId?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(`[${code}] ${message}`, options ? { cause: options.cause } : undefined);
    this.name = 'ScanOrchestratorError';
    this.code = code;
    this.scanId = options?.scanId;
    this.siteId = options?.siteId;
    this.details = options?.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
