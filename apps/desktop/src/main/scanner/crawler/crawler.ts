/**
 * Deterministic Bounded Crawler Engine.
 * Concurrently traverses web pages starting from an entry URL within authorized scope
 * using the Safe HTTP Client and HTML Parser Engine.
 */

import { normalizeCrawlUrl } from '@auditor/shared';
import { SafeHttpClient } from '../client/http-client.js';
import { ScannerClientError } from '../client/errors.js';
import {
  SCANNER_CLIENT_ERROR_CODES,
  type SafeHttpClientOptions,
  type SafeHttpResponse,
} from '../client/types.js';
import { HtmlParserEngine } from '../parser/html-parser.js';
import { CrawlQueue } from './queue.js';
import { SCANNER_CRAWLER_ERROR_CODES, ScannerCrawlerError } from './errors.js';
import type {
  CrawlConfig,
  CrawledPageResult,
  CrawlProgressCallback,
  CrawlQueueItem,
  CrawlResult,
  CrawlSummary,
} from './types.js';

const DEFAULT_CONFIG = {
  maxPages: 50,
  maxDepth: 3,
  maxConcurrency: 3,
  maxDiscoveredLinksPerPage: 100,
  maxDurationMs: 60_000,
  requestTimeoutMs: 10_000,
  maxEncodedBytes: 2 * 1024 * 1024, // 2 MB
  maxDecompressedBytes: 4 * 1024 * 1024, // 4 MB
  userAgent: 'WordPressAuditorBot/1.0 (+https://github.com/ultimate-auditor)',
};

/**
 * Checks whether the Content-Type header represents parseable HTML.
 */
function isHtmlContentType(contentTypeHeader: string | undefined): boolean {
  if (!contentTypeHeader) {
    return false;
  }
  const lower = contentTypeHeader.toLowerCase();
  return lower.includes('text/html') || lower.includes('application/xhtml+xml');
}

export class BoundedCrawler {
  private readonly parser: HtmlParserEngine;

  constructor(parser?: HtmlParserEngine) {
    this.parser = parser || new HtmlParserEngine();
  }

  /**
   * Executes a bounded crawl according to the supplied configuration.
   */
  async crawl(config: CrawlConfig, onProgress?: CrawlProgressCallback): Promise<CrawlResult> {
    const startTime = Date.now();

    // 1. Validate Entry URL and Scope
    const normalizedEntry = normalizeCrawlUrl(config.entryUrl);
    if (!normalizedEntry) {
      throw new ScannerCrawlerError(
        SCANNER_CRAWLER_ERROR_CODES.ERR_CRAWL_INVALID_ENTRY_URL,
        `Invalid or prohibited crawl entry URL: ${config.entryUrl}`,
        config.entryUrl,
      );
    }

    const authorizedOrigin = config.authorizedOrigin || normalizedEntry.origin;
    if (normalizedEntry.origin !== authorizedOrigin) {
      throw new ScannerCrawlerError(
        SCANNER_CRAWLER_ERROR_CODES.ERR_CRAWL_OUT_OF_SCOPE,
        `Entry URL origin (${normalizedEntry.origin}) does not match authorized origin (${authorizedOrigin})`,
        config.entryUrl,
      );
    }

    // 2. Resolve Effective Settings
    const maxPages = config.maxPages ?? DEFAULT_CONFIG.maxPages;
    const maxDepth = config.maxDepth ?? DEFAULT_CONFIG.maxDepth;
    const maxConcurrency = Math.max(1, config.maxConcurrency ?? DEFAULT_CONFIG.maxConcurrency);
    const maxDiscoveredLinksPerPage =
      config.maxDiscoveredLinksPerPage ?? DEFAULT_CONFIG.maxDiscoveredLinksPerPage;
    const maxDurationMs = config.maxDurationMs ?? DEFAULT_CONFIG.maxDurationMs;
    const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_CONFIG.requestTimeoutMs;
    const maxEncodedBytes = config.maxEncodedBytes ?? DEFAULT_CONFIG.maxEncodedBytes;
    const maxDecompressedBytes = config.maxDecompressedBytes ?? DEFAULT_CONFIG.maxDecompressedBytes;
    const userAgent = config.userAgent ?? DEFAULT_CONFIG.userAgent;

    // 3. Initialize SafeHttpClient
    const clientOptions: Partial<SafeHttpClientOptions> = {
      connectTimeoutMs: Math.min(requestTimeoutMs, 5000),
      responseTimeoutMs: requestTimeoutMs,
      maxEncodedBytes,
      maxDecompressedBytes,
      userAgent,
      allowedHosts: [normalizedEntry.hostname],
      ...config.clientOptions,
    };
    const client = new SafeHttpClient(clientOptions, config.testHooks);

    // 4. Initialize Queue and State
    const queue = new CrawlQueue();
    queue.enqueue({
      url: normalizedEntry.href,
      depth: 0,
      parentUrl: null,
      discoveredAt: startTime,
    });

    const pages: CrawledPageResult[] = [];
    const errors: Array<{ url: string; code: string; message: string }> = [];

    let totalPagesAttempted = 0;
    let reservedPages = 0;
    let currentDepth = 0;
    let successfulPages = 0;
    let failedPages = 0;
    let nonHtmlPages = 0;
    let urlsSkippedScope = 0;
    let urlsSkippedLimits = 0;
    let maxDepthReached = 0;
    let isCancelled = false;
    let cancellationReason: string | undefined;

    // 5. Setup Abort Controller and Timers
    const abortController = new AbortController();

    // Propagate external cancellation signal
    const externalSignalListener = () => {
      isCancelled = true;
      cancellationReason = 'USER_ABORT';
      abortController.abort();
      queue.clear();
    };

    if (config.signal) {
      if (config.signal.aborted) {
        externalSignalListener();
      } else {
        config.signal.addEventListener('abort', externalSignalListener, { once: true });
      }
    }

    // Overall duration timeout
    let timeoutTimer: NodeJS.Timeout | null = null;
    if (maxDurationMs > 0 && maxDurationMs < Infinity) {
      timeoutTimer = setTimeout(() => {
        isCancelled = true;
        cancellationReason = 'TIMEOUT_REACHED';
        abortController.abort();
        queue.clear();
      }, maxDurationMs);
    }

    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (config.signal) {
        config.signal.removeEventListener('abort', externalSignalListener);
      }
    };

    // 6. Concurrency-Controlled Worker Execution
    return new Promise<CrawlResult>(resolve => {
      let activeWorkers = 0;
      let hasCompleted = false;

      const finishCrawl = () => {
        if (hasCompleted) return;
        hasCompleted = true;
        cleanup();

        const durationMs = Date.now() - startTime;
        const summary: CrawlSummary = {
          entryUrl: normalizedEntry.href,
          authorizedOrigin,
          totalPagesAttempted,
          successfulPages,
          failedPages,
          nonHtmlPages,
          uniqueUrlsDiscovered: queue.totalScheduledCount,
          urlsSkippedScope,
          urlsSkippedLimits,
          maxDepthReached,
          durationMs,
          cancelled: isCancelled,
          cancellationReason,
        };

        resolve({
          summary,
          pages,
          discoveredUrls: queue.getAllDiscoveredUrls(),
          errors,
        });
      };

      const processPage = async (item: CrawlQueueItem): Promise<void> => {
        const reqStart = performance.now();
        queue.markVisited(item.url);
        maxDepthReached = Math.max(maxDepthReached, item.depth);

        if (onProgress) {
          try {
            onProgress({
              pagesCrawled: totalPagesAttempted,
              queueSize: queue.size,
              currentUrl: item.url,
              depth: item.depth,
            });
          } catch {
            // progress reporting should never break crawl execution
          }
        }

        try {
          const response: SafeHttpResponse = await client.get(item.url, {
            signal: abortController.signal,
          });

          const contentTypeHeader = (response.headers['content-type'] as string) || '';
          const isHtml = isHtmlContentType(contentTypeHeader);
          const durationMs = Math.round(performance.now() - reqStart);

          if (!isHtml) {
            nonHtmlPages++;
            successfulPages++;
            pages.push({
              requestedUrl: item.url,
              finalUrl: response.finalUrl,
              statusCode: response.statusCode,
              statusMessage: response.statusMessage,
              headers: response.headers,
              contentType: contentTypeHeader || null,
              isHtml: false,
              durationMs,
              depth: item.depth,
              parentUrl: item.parentUrl,
              encodedBodyBytes: response.encodedBodyBytes,
              decompressedBodyBytes: response.decompressedBodyBytes,
              parsedDocument: null,
              redirectChain: response.redirectChain,
              tls: response.tls ?? null,
            });
            return;
          }

          // Parse HTML and extract page structure
          const htmlContent = response.text();
          const parsedDoc = this.parser.parse(htmlContent, response.finalUrl, authorizedOrigin);

          // Discover links if within depth limit and crawl is active
          if (item.depth < maxDepth && !isCancelled && reservedPages < maxPages) {
            let pageEnqueuedCount = 0;

            for (const link of parsedDoc.links) {
              if (!link.isInternal) {
                urlsSkippedScope++;
                continue;
              }

              if (link.isEligibleForCrawl && link.resolvedUrl) {
                if (pageEnqueuedCount < maxDiscoveredLinksPerPage) {
                  if (queue.isScheduled(link.resolvedUrl) || queue.isVisited(link.resolvedUrl)) {
                    continue;
                  }
                  if (reservedPages + queue.size < maxPages) {
                    const enqueued = queue.enqueue({
                      url: link.resolvedUrl,
                      depth: item.depth + 1,
                      parentUrl: item.url,
                      discoveredAt: Date.now(),
                    });
                    if (enqueued) {
                      pageEnqueuedCount++;
                    }
                  } else {
                    urlsSkippedLimits++;
                  }
                } else {
                  urlsSkippedLimits++;
                }
              }
            }
          } else {
            // Count candidate links that exceeded max depth or maxPages
            for (const link of parsedDoc.links) {
              if (!link.isInternal) {
                urlsSkippedScope++;
              } else if (link.isEligibleForCrawl) {
                urlsSkippedLimits++;
              }
            }
          }

          successfulPages++;
          pages.push({
            requestedUrl: item.url,
            finalUrl: response.finalUrl,
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
            contentType: contentTypeHeader || null,
            isHtml: true,
            durationMs,
            depth: item.depth,
            parentUrl: item.parentUrl,
            encodedBodyBytes: response.encodedBodyBytes,
            decompressedBodyBytes: response.decompressedBodyBytes,
            parsedDocument: parsedDoc,
            redirectChain: response.redirectChain,
            tls: response.tls ?? null,
          });
        } catch (err: unknown) {
          const durationMs = Math.round(performance.now() - reqStart);

          if (
            err instanceof ScannerClientError &&
            err.code === SCANNER_CLIENT_ERROR_CODES.ERR_NON_HTML_CONTENT_TYPE
          ) {
            nonHtmlPages++;
            successfulPages++;
            const details = err.details as { contentType?: string } | undefined;
            pages.push({
              requestedUrl: item.url,
              finalUrl: item.url,
              statusCode: null,
              statusMessage: null,
              headers: null,
              contentType: details?.contentType ?? null,
              isHtml: false,
              durationMs,
              depth: item.depth,
              parentUrl: item.parentUrl,
              encodedBodyBytes: 0,
              decompressedBodyBytes: 0,
              parsedDocument: null,
            });
            return;
          }

          failedPages++;
          let code = 'ERR_CRAWL_PAGE_FAILED';
          let message = 'Unknown page crawl error';

          if (err instanceof ScannerClientError) {
            code = err.code;
            message = err.message;
          } else if (err instanceof Error) {
            code = err.name;
            message = err.message;
          }

          errors.push({ url: item.url, code, message });

          pages.push({
            requestedUrl: item.url,
            finalUrl: item.url,
            statusCode: null,
            statusMessage: null,
            headers: null,
            contentType: null,
            isHtml: false,
            durationMs,
            depth: item.depth,
            parentUrl: item.parentUrl,
            encodedBodyBytes: 0,
            decompressedBodyBytes: 0,
            parsedDocument: null,
            error: { code, message },
          });
        }
      };

      const dispatch = () => {
        if (hasCompleted) return;

        // If cancelled or page limit reached, drain queue
        if (isCancelled || reservedPages >= maxPages) {
          queue.clear();
          if (activeWorkers === 0) {
            finishCrawl();
          }
          return;
        }

        // Check if finished
        if (queue.isEmpty && activeWorkers === 0) {
          finishCrawl();
          return;
        }

        // Advance to next depth frontier once all active workers at current depth have completed
        if (activeWorkers === 0 && !queue.isEmpty) {
          const nextDepth = queue.peekDepth();
          if (nextDepth !== undefined && nextDepth > currentDepth) {
            currentDepth = nextDepth;
          }
        }

        // Spawn workers up to concurrency limit, strictly confined to currentDepth
        while (
          !isCancelled &&
          activeWorkers < maxConcurrency &&
          reservedPages < maxPages &&
          !queue.isEmpty &&
          queue.peekDepth() === currentDepth
        ) {
          const nextItem = queue.dequeueForDepth(currentDepth);
          if (!nextItem) break;

          reservedPages++;
          totalPagesAttempted++;
          activeWorkers++;
          processPage(nextItem)
            .catch(() => {})
            .finally(() => {
              activeWorkers--;
              dispatch();
            });
        }

        // Final check after loop
        if (queue.isEmpty && activeWorkers === 0) {
          finishCrawl();
        }
      };

      // Kick off crawling
      dispatch();
    });
  }
}
