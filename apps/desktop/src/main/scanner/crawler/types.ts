/**
 * Typed contracts and data models for the Bounded Crawler Engine.
 */

import type { IncomingHttpHeaders } from 'node:http';
import type {
  RedirectHopInfo,
  SafeHttpClientOptions,
  SafeHttpClientTestHooks,
  TlsConnectionMetadata,
} from '../client/types.js';
import type { ParsedHtmlDocument } from '../parser/types.js';

export interface CrawlConfig {
  /**
   * The initial URL where the crawl begins.
   */
  readonly entryUrl: string;

  /**
   * Authorized origin (e.g. "https://example.com" or "http://example.com:8080").
   * Crawling is strictly confined to this origin.
   * If omitted, derived automatically from entryUrl.
   */
  readonly authorizedOrigin?: string;

  /**
   * Maximum total pages to attempt fetching.
   * Default: 50.
   */
  readonly maxPages?: number;

  /**
   * Maximum link distance from entryUrl.
   * Depth 0 = entryUrl, Depth 1 = links on entryUrl, etc.
   * Default: 3.
   */
  readonly maxDepth?: number;

  /**
   * Maximum concurrent HTTP requests in flight.
   * Default: 3.
   */
  readonly maxConcurrency?: number;

  /**
   * Maximum discovered internal links to enqueue per crawled page.
   * Protects against link-bombing pages.
   * Default: 100.
   */
  readonly maxDiscoveredLinksPerPage?: number;

  /**
   * Overall crawl duration limit in milliseconds.
   * Default: 60,000 ms (60 seconds).
   */
  readonly maxDurationMs?: number;

  /**
   * Per-request timeout in milliseconds.
   * Default: 10,000 ms.
   */
  readonly requestTimeoutMs?: number;

  /**
   * Maximum permitted encoded response body bytes (wire bytes).
   * Default: 2,097,152 (2 MB).
   */
  readonly maxEncodedBytes?: number;

  /**
   * Maximum permitted decompressed body bytes.
   * Default: 4,194,304 (4 MB).
   */
  readonly maxDecompressedBytes?: number;

  /**
   * User-Agent header value for crawl requests.
   */
  readonly userAgent?: string;

  /**
   * Optional AbortSignal for user cancellation.
   */
  readonly signal?: AbortSignal;

  /**
   * HTTP client configuration overrides.
   */
  readonly clientOptions?: Partial<SafeHttpClientOptions>;

  /**
   * Isolated test-only hooks for dependency injection and deterministic local testing.
   */
  readonly testHooks?: SafeHttpClientTestHooks;
}

export interface CrawlQueueItem {
  readonly url: string;
  readonly depth: number;
  readonly parentUrl: string | null;
  readonly discoveredAt: number;
}

export interface CrawledPageResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number | null;
  readonly statusMessage: string | null;
  readonly headers: IncomingHttpHeaders | null;
  readonly contentType: string | null;
  readonly isHtml: boolean;
  readonly durationMs: number;
  readonly depth: number;
  readonly parentUrl: string | null;
  readonly encodedBodyBytes: number;
  readonly decompressedBodyBytes: number;
  readonly parsedDocument: ParsedHtmlDocument | null;
  readonly redirectChain?: readonly RedirectHopInfo[];
  readonly tls?: TlsConnectionMetadata | null;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface CrawlSummary {
  readonly entryUrl: string;
  readonly authorizedOrigin: string;
  readonly totalPagesAttempted: number;
  readonly successfulPages: number;
  readonly failedPages: number;
  readonly nonHtmlPages: number;
  readonly uniqueUrlsDiscovered: number;
  readonly urlsSkippedScope: number;
  readonly urlsSkippedLimits: number;
  readonly maxDepthReached: number;
  readonly durationMs: number;
  readonly cancelled: boolean;
  readonly cancellationReason?: string;
}

export interface CrawlProgress {
  readonly pagesCrawled: number;
  readonly queueSize: number;
  readonly currentUrl: string;
  readonly depth: number;
}

export type CrawlProgressCallback = (progress: CrawlProgress) => void;

export interface CrawlResult {
  readonly summary: CrawlSummary;
  readonly pages: readonly CrawledPageResult[];
  readonly discoveredUrls: readonly string[];
  readonly errors: ReadonlyArray<{
    readonly url: string;
    readonly code: string;
    readonly message: string;
  }>;
}
