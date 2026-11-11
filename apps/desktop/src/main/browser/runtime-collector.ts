import crypto from 'node:crypto';
import type { Page, Request, Response, ConsoleMessage } from 'playwright-core';
import type {
  CapturedConsoleMessage,
  CapturedNetworkResource,
  CapturedRuntimeError,
  ResourceCategory,
  RuntimeAuditMetrics,
  RuntimeAuditorOptions,
  SourceLocation,
} from './runtime-types.js';
import { redactHeaders, redactString, redactUrl } from './redactor.js';

interface RequestState {
  readonly id: string;
  readonly url: string;
  readonly method: string;
  readonly resourceType: ResourceCategory;
  readonly isNavigationRequest: boolean;
  readonly isMainFrame: boolean;
  readonly frameUrl?: string;
  readonly startTime: number;
  readonly isFirstParty: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  failureText?: string;
  durationMs?: number;
  isAborted: boolean;
  isBlocked: boolean;
}

export class BrowserRuntimeCollector {
  private readonly options: Required<RuntimeAuditorOptions>;
  private readonly authHostname: string;
  private readonly allowedHostnames: ReadonlySet<string>;

  private page: Page | null = null;
  private listenersAttached = false;
  private limitsReached = false;

  private readonly errors: CapturedRuntimeError[] = [];
  private readonly consoleMessages: CapturedConsoleMessage[] = [];
  private readonly networkResources: CapturedNetworkResource[] = [];
  private readonly requestStates = new Map<Request, RequestState>();

  // Metrics
  private totalErrors = 0;
  private totalConsoleErrors = 0;
  private totalConsoleWarnings = 0;
  private totalNetworkRequests = 0;
  private failedRequests = 0;
  private http4xxErrors = 0;
  private http5xxErrors = 0;

  // Stored listener references for deterministic cleanup
  private onPageErrorListener?: (err: Error) => void;
  private onConsoleListener?: (msg: ConsoleMessage) => void;
  private onRequestListener?: (req: Request) => void;
  private onResponseListener?: (res: Response) => void;
  private onRequestFailedListener?: (req: Request) => void;
  private onRequestFinishedListener?: (req: Request) => void;

  constructor(options: RuntimeAuditorOptions) {
    let authHost: string;
    try {
      authHost = new URL(options.authorizedOrigin).hostname.toLowerCase();
    } catch {
      authHost = options.authorizedOrigin.toLowerCase();
    }
    this.authHostname = authHost;

    const allowed = new Set<string>();
    allowed.add(authHost);
    if (options.additionalAllowedDomains) {
      for (const d of options.additionalAllowedDomains) {
        allowed.add(d.trim().toLowerCase());
      }
    }
    this.allowedHostnames = allowed;

    this.options = {
      authorizedOrigin: options.authorizedOrigin,
      additionalAllowedDomains: options.additionalAllowedDomains ?? [],
      maxErrors: options.maxErrors ?? 100,
      maxConsoleMessages: options.maxConsoleMessages ?? 100,
      maxNetworkResources: options.maxNetworkResources ?? 200,
      maxMessageLength: options.maxMessageLength ?? 1000,
      maxStackLength: options.maxStackLength ?? 2000,
      maxFindings: options.maxFindings ?? 50,
    };
  }

  /**
   * Attaches runtime and network event collectors to a managed Page.
   */
  public attach(page: Page): void {
    if (this.listenersAttached || this.page) {
      this.detach();
    }

    this.page = page;

    this.onPageErrorListener = (err: Error) => this.handlePageError(err);
    this.onConsoleListener = (msg: ConsoleMessage) => this.handleConsoleMessage(msg);
    this.onRequestListener = (req: Request) => this.handleRequest(req);
    this.onResponseListener = (res: Response) => this.handleResponse(res);
    this.onRequestFailedListener = (req: Request) => this.handleRequestFailed(req);
    this.onRequestFinishedListener = (req: Request) => this.handleRequestFinished(req);

    page.on('pageerror', this.onPageErrorListener);
    page.on('console', this.onConsoleListener);
    page.on('request', this.onRequestListener);
    page.on('response', this.onResponseListener);
    page.on('requestfailed', this.onRequestFailedListener);
    page.on('requestfinished', this.onRequestFinishedListener);

    this.listenersAttached = true;
  }

  /**
   * Deterministically removes all event listeners and releases page references.
   */
  public detach(): void {
    if (this.page && this.listenersAttached) {
      if (this.onPageErrorListener) this.page.off('pageerror', this.onPageErrorListener);
      if (this.onConsoleListener) this.page.off('console', this.onConsoleListener);
      if (this.onRequestListener) this.page.off('request', this.onRequestListener);
      if (this.onResponseListener) this.page.off('response', this.onResponseListener);
      if (this.onRequestFailedListener)
        this.page.off('requestfailed', this.onRequestFailedListener);
      if (this.onRequestFinishedListener)
        this.page.off('requestfinished', this.onRequestFinishedListener);
    }

    this.page = null;
    this.listenersAttached = false;
    this.requestStates.clear();
  }

  public getCollectedErrors(): readonly CapturedRuntimeError[] {
    return [...this.errors];
  }

  public getCollectedConsoleMessages(): readonly CapturedConsoleMessage[] {
    return [...this.consoleMessages];
  }

  public getCollectedNetworkResources(): readonly CapturedNetworkResource[] {
    return [...this.networkResources];
  }

  public isLimitsReached(): boolean {
    return this.limitsReached;
  }

  public getMetrics(): RuntimeAuditMetrics {
    return {
      totalErrors: this.totalErrors,
      totalConsoleErrors: this.totalConsoleErrors,
      totalConsoleWarnings: this.totalConsoleWarnings,
      totalNetworkRequests: this.totalNetworkRequests,
      failedRequests: this.failedRequests,
      http4xxErrors: this.http4xxErrors,
      http5xxErrors: this.http5xxErrors,
      duplicatesConsolidated: 0, // Computed by analyzer
    };
  }

  private handlePageError(err: Error): void {
    try {
      this.totalErrors++;

      if (this.errors.length >= this.options.maxErrors) {
        this.limitsReached = true;
        return;
      }

      const rawMessage = err.message || String(err);
      const isUnhandledRejection =
        rawMessage.includes('Unhandled rejection') ||
        rawMessage.includes('Uncaught (in promise)') ||
        rawMessage.toLowerCase().includes('promise rejection') ||
        err.name === 'UnhandledPromiseRejection';

      const sanitizedMessage = redactString(rawMessage, this.options.maxMessageLength);
      const sanitizedStack = err.stack
        ? redactString(err.stack, this.options.maxStackLength)
        : undefined;

      const location = this.extractLocationFromStack(err.stack);

      const frameUrl = this.page && !this.page.isClosed() ? this.page.url() : undefined;

      this.errors.push({
        id: crypto.randomUUID(),
        type: isUnhandledRejection ? 'unhandled_rejection' : 'runtime_error',
        name: err.name || 'Error',
        message: sanitizedMessage,
        stack: sanitizedStack,
        location,
        frameUrl: frameUrl ? redactUrl(frameUrl) : undefined,
        timestamp: Date.now(),
      });
    } catch {
      // Never throw from collector callback into browser loop
    }
  }

  private handleConsoleMessage(msg: ConsoleMessage): void {
    try {
      const type = msg.type();
      if (type !== 'error' && type !== 'warning' && type !== 'assert') {
        return; // Ignore benign logs, debug, and info
      }

      if (type === 'error' || type === 'assert') {
        this.totalConsoleErrors++;
      } else if (type === 'warning') {
        this.totalConsoleWarnings++;
      }

      if (this.consoleMessages.length >= this.options.maxConsoleMessages) {
        this.limitsReached = true;
        return;
      }

      const rawText = msg.text();
      const sanitizedText = redactString(rawText, this.options.maxMessageLength);

      const loc = msg.location();
      const location: SourceLocation | undefined = loc.url
        ? {
            url: redactUrl(loc.url),
            lineNumber: loc.lineNumber,
            columnNumber: loc.columnNumber,
          }
        : undefined;

      const pageUrl = this.page && !this.page.isClosed() ? this.page.url() : '';

      this.consoleMessages.push({
        id: crypto.randomUUID(),
        type,
        text: sanitizedText,
        location,
        pageUrl: redactUrl(pageUrl),
        timestamp: Date.now(),
      });
    } catch {
      // Never throw from collector callback
    }
  }

  private handleRequest(req: Request): void {
    try {
      this.totalNetworkRequests++;

      const rawUrl = req.url();
      const isFirstParty = this.isUrlFirstParty(rawUrl);

      let isMainFrame = false;
      let frameUrl: string | undefined;
      try {
        const frame = req.frame();
        if (frame) {
          isMainFrame = frame.parentFrame() === null;
          frameUrl = redactUrl(frame.url());
        }
      } catch {
        // Safe fallback if frame was detached
      }

      const state: RequestState = {
        id: crypto.randomUUID(),
        url: redactUrl(rawUrl),
        method: req.method(),
        resourceType: (req.resourceType() as ResourceCategory) || 'other',
        isNavigationRequest: req.isNavigationRequest(),
        isMainFrame,
        frameUrl,
        startTime: Date.now(),
        isFirstParty,
        isAborted: false,
        isBlocked: false,
      };

      this.requestStates.set(req, state);
    } catch {
      // Never throw from collector callback
    }
  }

  private handleResponse(res: Response): void {
    try {
      const req = res.request();
      const state = this.requestStates.get(req);
      const status = res.status();

      if (status >= 400 && status < 500) {
        this.http4xxErrors++;
      } else if (status >= 500) {
        this.http5xxErrors++;
      }

      if (state) {
        state.status = status;
        state.statusText = res.statusText();
        state.durationMs = Math.max(0, Date.now() - state.startTime);

        try {
          const rawHeaders = res.headers();
          state.headers = redactHeaders(rawHeaders);
        } catch {
          // Ignore header extraction errors
        }
      }
    } catch {
      // Never throw from collector callback
    }
  }

  private handleRequestFailed(req: Request): void {
    try {
      const state = this.requestStates.get(req);
      const failure = req.failure();
      const errorText = failure?.errorText || '';

      const isAborted = errorText === 'net::ERR_ABORTED';
      const isBlocked = errorText === 'net::ERR_BLOCKED_BY_CLIENT' || errorText.includes('BLOCKED');

      if (!isAborted && !isBlocked) {
        this.failedRequests++;
      }

      if (state) {
        state.failureText = errorText;
        state.isAborted = isAborted;
        state.isBlocked = isBlocked;
        state.durationMs = Math.max(0, Date.now() - state.startTime);
        this.commitNetworkResource(state);
      }
      this.requestStates.delete(req);
    } catch {
      // Never throw from collector callback
    }
  }

  private handleRequestFinished(req: Request): void {
    try {
      const state = this.requestStates.get(req);
      if (state) {
        state.durationMs = Math.max(0, Date.now() - state.startTime);
        this.commitNetworkResource(state);
      }
      this.requestStates.delete(req);
    } catch {
      // Never throw from collector callback
    }
  }

  private commitNetworkResource(state: RequestState): void {
    if (this.networkResources.length >= this.options.maxNetworkResources) {
      this.limitsReached = true;
      return;
    }

    this.networkResources.push({
      id: state.id,
      url: state.url,
      method: state.method,
      resourceType: state.resourceType,
      status: state.status,
      statusText: state.statusText,
      headers: state.headers,
      failureText: state.failureText,
      isNavigationRequest: state.isNavigationRequest,
      isMainFrame: state.isMainFrame,
      frameUrl: state.frameUrl,
      durationMs: state.durationMs,
      timestamp: Date.now(),
      isAborted: state.isAborted,
      isBlocked: state.isBlocked,
      isFirstParty: state.isFirstParty,
    });
  }

  private isUrlFirstParty(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      if (host === this.authHostname || host.endsWith(`.${this.authHostname}`)) {
        return true;
      }
      for (const allowed of this.allowedHostnames) {
        if (host === allowed || host.endsWith(`.${allowed}`)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private extractLocationFromStack(stack?: string): SourceLocation | undefined {
    if (!stack) return undefined;

    // Pattern matching `at http://domain.test/path/to/script.js:42:15` or `(http://...:42:15)`
    const match = stack.match(/(?:at\s+(?:.*?\s+)?\(?)(https?:\/\/[^\s)]+):(\d+):(\d+)\)?/i);
    if (match) {
      return {
        url: redactUrl(match[1]),
        lineNumber: Number.parseInt(match[2], 10),
        columnNumber: Number.parseInt(match[3], 10),
      };
    }

    return undefined;
  }
}
