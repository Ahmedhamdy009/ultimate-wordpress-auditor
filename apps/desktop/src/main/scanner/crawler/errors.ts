/**
 * Error definitions and standard error codes for the Bounded Crawler Engine.
 */

export const SCANNER_CRAWLER_ERROR_CODES = {
  ERR_CRAWL_INVALID_ENTRY_URL: 'ERR_CRAWL_INVALID_ENTRY_URL',
  ERR_CRAWL_MAX_PAGES_REACHED: 'ERR_CRAWL_MAX_PAGES_REACHED',
  ERR_CRAWL_MAX_DEPTH_REACHED: 'ERR_CRAWL_MAX_DEPTH_REACHED',
  ERR_CRAWL_TIMEOUT: 'ERR_CRAWL_TIMEOUT',
  ERR_CRAWL_CANCELLED: 'ERR_CRAWL_CANCELLED',
  ERR_CRAWL_OUT_OF_SCOPE: 'ERR_CRAWL_OUT_OF_SCOPE',
  ERR_CRAWL_HTTP_ERROR: 'ERR_CRAWL_HTTP_ERROR',
  ERR_CRAWL_PARSER_ERROR: 'ERR_CRAWL_PARSER_ERROR',
} as const;

export type ScannerCrawlerErrorCode =
  (typeof SCANNER_CRAWLER_ERROR_CODES)[keyof typeof SCANNER_CRAWLER_ERROR_CODES];

export class ScannerCrawlerError extends Error {
  readonly code: ScannerCrawlerErrorCode;
  readonly url?: string;

  constructor(code: ScannerCrawlerErrorCode, message: string, url?: string) {
    super(message);
    this.name = 'ScannerCrawlerError';
    this.code = code;
    this.url = url;
  }
}
