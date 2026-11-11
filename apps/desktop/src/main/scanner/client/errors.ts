import type { ScannerClientErrorCode } from './types.js';

export class ScannerClientError extends Error {
  readonly code: ScannerClientErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ScannerClientErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ScannerClientError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isScannerClientError(error: unknown): error is ScannerClientError {
  return error instanceof Error && 'code' in error && error.name === 'ScannerClientError';
}
