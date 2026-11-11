import type { BrowserErrorCode } from './types.js';

export class BrowserError extends Error {
  readonly code: BrowserErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: BrowserErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'BrowserError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isBrowserError(error: unknown): error is BrowserError {
  return error instanceof Error && 'code' in error && error.name === 'BrowserError';
}
