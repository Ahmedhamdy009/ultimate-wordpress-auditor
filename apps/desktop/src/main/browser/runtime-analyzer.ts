import type { AnalyzerFinding } from '../scanner/analyzers/types.js';
import type {
  CapturedConsoleMessage,
  CapturedNetworkResource,
  CapturedRuntimeError,
  RuntimeAuditMetrics,
  RuntimeAuditorOptions,
} from './runtime-types.js';
import { sanitizeEvidence } from './redactor.js';

interface RawCandidateFinding {
  readonly ruleId: string;
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly severity: AnalyzerFinding['severity'];
  readonly confidence: AnalyzerFinding['confidence'];
  readonly status: AnalyzerFinding['status'];
  readonly targetUrl: string;
  readonly evidence: Record<string, unknown>;
  readonly remediation?: string;
  readonly references?: readonly string[];
  readonly timestamp: number;
}

interface ConsolidatedFinding {
  base: RawCandidateFinding;
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export class BrowserRuntimeAnalyzer {
  private readonly options: Required<RuntimeAuditorOptions>;

  constructor(options: RuntimeAuditorOptions) {
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

  public analyze(params: {
    pageUrl: string;
    errors: readonly CapturedRuntimeError[];
    consoleMessages: readonly CapturedConsoleMessage[];
    networkResources: readonly CapturedNetworkResource[];
    rawMetrics: RuntimeAuditMetrics;
  }): {
    findings: readonly AnalyzerFinding[];
    metrics: RuntimeAuditMetrics;
  } {
    const candidateFindings: RawCandidateFinding[] = [];

    // 1. Analyze JavaScript Runtime Errors & Unhandled Rejections
    this.analyzeRuntimeErrors(params.errors, params.pageUrl, candidateFindings);

    // 2. Analyze Browser Console Errors & Warnings
    this.analyzeConsoleMessages(params.consoleMessages, params.pageUrl, candidateFindings);

    // 3. Analyze Network Resources (Failures & HTTP Status)
    this.analyzeNetworkResources(params.networkResources, params.pageUrl, candidateFindings);

    // 4. Deterministic Deduplication and Consolidation
    const { consolidatedFindings, duplicatesConsolidated } =
      this.deduplicateFindings(candidateFindings);

    // 5. Map to standard AnalyzerFinding format with bounded limits
    const findings: AnalyzerFinding[] = consolidatedFindings
      .slice(0, this.options.maxFindings)
      .map(cf => this.mapToAnalyzerFinding(cf));

    const metrics: RuntimeAuditMetrics = {
      ...params.rawMetrics,
      duplicatesConsolidated,
    };

    return { findings, metrics };
  }

  private analyzeRuntimeErrors(
    errors: readonly CapturedRuntimeError[],
    pageUrl: string,
    out: RawCandidateFinding[],
  ): void {
    for (const err of errors) {
      const isRejection = err.type === 'unhandled_rejection';
      const ruleId = isRejection ? 'JS_UNHANDLED_PROMISE_REJECTION' : 'JS_RUNTIME_ERROR';
      const title = isRejection
        ? 'Unhandled Promise Rejection'
        : `JavaScript Runtime Error: ${err.name || 'Error'}`;

      const targetUrl = err.location?.url || err.frameUrl || pageUrl;

      const description = isRejection
        ? `An unhandled Promise rejection occurred on ${pageUrl}: "${err.message}". Unhandled rejections can disrupt asynchronous application flows and leave user interface states frozen.`
        : `Uncaught ${err.name || 'Error'} thrown on ${pageUrl}: "${err.message}". This unhandled exception may break page functionality or interactive components.`;

      const severity: AnalyzerFinding['severity'] = isRejection ? 'medium' : 'high';
      const confidence: AnalyzerFinding['confidence'] = isRejection ? 'firm' : 'confirmed';

      out.push({
        ruleId,
        category: 'runtime-network',
        title,
        description,
        severity,
        confidence,
        status: 'confirmed',
        targetUrl,
        evidence: {
          errorType: err.type,
          name: err.name,
          message: err.message,
          stack: err.stack,
          location: err.location,
          frameUrl: err.frameUrl,
        },
        remediation: isRejection
          ? 'Add .catch() handlers or wrap asynchronous code in try/catch blocks.'
          : 'Inspect script source, add defensive checks for null/undefined properties, and fix syntax or reference errors.',
        references: isRejection
          ? [
              'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises#promise_rejection_events',
            ]
          : [
              'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error',
            ],
        timestamp: err.timestamp,
      });
    }
  }

  private analyzeConsoleMessages(
    messages: readonly CapturedConsoleMessage[],
    pageUrl: string,
    out: RawCandidateFinding[],
  ): void {
    for (const msg of messages) {
      let ruleId: string;
      let title: string;
      let severity: AnalyzerFinding['severity'];
      let confidence: AnalyzerFinding['confidence'];
      let status: AnalyzerFinding['status'];

      if (msg.type === 'error') {
        ruleId = 'BROWSER_CONSOLE_ERROR';
        title = 'Browser Console Error';
        severity = 'medium';
        confidence = 'confirmed';
        status = 'confirmed';
      } else if (msg.type === 'assert') {
        ruleId = 'BROWSER_CONSOLE_ASSERTION_FAILED';
        title = 'Console Assertion Failed';
        severity = 'medium';
        confidence = 'confirmed';
        status = 'confirmed';
      } else {
        // Warning
        ruleId = 'BROWSER_CONSOLE_WARN';
        title = 'Browser Console Warning';
        severity = 'low';
        confidence = 'firm';
        status = 'potential';
      }

      const targetUrl = msg.location?.url || pageUrl;

      out.push({
        ruleId,
        category: 'runtime-network',
        title,
        description: `Browser console emitted a ${msg.type} on ${pageUrl}: "${msg.text}".`,
        severity,
        confidence,
        status,
        targetUrl,
        evidence: {
          type: msg.type,
          text: msg.text,
          location: msg.location,
          pageUrl: msg.pageUrl,
        },
        remediation:
          msg.type === 'warning'
            ? 'Review browser console warning for deprecation notices or security recommendations.'
            : 'Inspect source code at the reported location to resolve console errors.',
        timestamp: msg.timestamp,
      });
    }
  }

  private analyzeNetworkResources(
    resources: readonly CapturedNetworkResource[],
    pageUrl: string,
    out: RawCandidateFinding[],
  ): void {
    for (const res of resources) {
      // 1. Skip intentionally blocked requests (e.g. ad blockers or SSRF proxy policy)
      if (res.isBlocked) {
        continue;
      }

      // 2. Skip harmless navigation aborts without error status
      if (res.isAborted && !res.status) {
        continue;
      }

      const isMainDoc =
        res.isMainFrame && (res.isNavigationRequest || res.resourceType === 'document');
      const isIframeDoc =
        !res.isMainFrame && (res.isNavigationRequest || res.resourceType === 'document');

      // 3. Network-Level Connection Failures (DNS failure, connection refused, timeout)
      if (!res.status && res.failureText) {
        if (isMainDoc) {
          out.push({
            ruleId: 'NET_MAIN_DOCUMENT_FAILED',
            category: 'runtime-network',
            title: `Main Document Request Failed (${res.failureText})`,
            description: `Top-level document at ${res.url} failed to load due to network error: ${res.failureText}. Target page was unreachable.`,
            severity: 'critical',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: res.url,
            evidence: {
              url: res.url,
              failureText: res.failureText,
              resourceType: res.resourceType,
              isMainFrame: true,
              isFirstParty: res.isFirstParty,
            },
            remediation: 'Verify server availability, DNS resolution, and firewall configurations.',
            timestamp: res.timestamp,
          });
        } else if (isIframeDoc) {
          out.push({
            ruleId: 'NET_IFRAME_DOCUMENT_FAILED',
            category: 'runtime-network',
            title: `Iframe Document Request Failed (${res.failureText})`,
            description: `Embedded iframe document at ${res.url} failed to load due to network error: ${res.failureText}. Main frame was unaffected.`,
            severity: res.isFirstParty ? 'medium' : 'low',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: res.url,
            evidence: {
              url: res.url,
              failureText: res.failureText,
              resourceType: res.resourceType,
              isMainFrame: false,
              frameUrl: res.frameUrl,
              isFirstParty: res.isFirstParty,
            },
            remediation: 'Verify embedded iframe host reachability and network access.',
            timestamp: res.timestamp,
          });
        } else {
          const isCriticalAsset =
            res.resourceType === 'script' || res.resourceType === 'stylesheet';
          out.push({
            ruleId: 'NET_RESOURCE_FAILED',
            category: 'runtime-network',
            title: `Network Request Failed: ${res.resourceType} (${res.failureText})`,
            description: `Failed to load ${res.resourceType} at ${res.url}: ${res.failureText}.`,
            severity: res.isFirstParty ? (isCriticalAsset ? 'high' : 'medium') : 'low',
            confidence: res.isFirstParty ? 'confirmed' : 'potential',
            status: 'confirmed',
            targetUrl: res.url,
            evidence: {
              url: res.url,
              resourceType: res.resourceType,
              failureText: res.failureText,
              durationMs: res.durationMs,
              isMainFrame: res.isMainFrame,
              frameUrl: res.frameUrl,
              isFirstParty: res.isFirstParty,
            },
            remediation:
              'Verify that the host server is reachable and network connectivity is reliable.',
            timestamp: res.timestamp,
          });
        }
        continue;
      }

      // 4. HTTP 5xx Server Errors
      if (res.status && res.status >= 500) {
        const isGatewayOrUnavailable =
          res.status === 502 || res.status === 503 || res.status === 504;

        let ruleId: string;
        let title: string;
        let severity: AnalyzerFinding['severity'];

        if (isMainDoc) {
          ruleId = 'HTTP_MAIN_DOCUMENT_5XX';
          title = `Main Document HTTP ${res.status} Server Error`;
          severity = 'critical';
        } else if (isIframeDoc) {
          ruleId = 'HTTP_IFRAME_DOCUMENT_5XX';
          title = `Iframe Document HTTP ${res.status} Server Error`;
          severity = res.isFirstParty ? 'medium' : 'low';
        } else if (isGatewayOrUnavailable) {
          ruleId = 'HTTP_GATEWAY_UNAVAILABLE_5XX';
          title = `HTTP ${res.status} Gateway/Service Unavailable on ${res.resourceType}`;
          severity = res.isFirstParty ? 'high' : 'medium';
        } else {
          ruleId = res.status === 500 ? 'HTTP_INTERNAL_SERVER_ERROR_500' : 'HTTP_5XX_SERVER_ERROR';
          title = `HTTP ${res.status} Server Error on ${res.resourceType}`;
          severity = res.isFirstParty ? 'high' : 'medium';
        }

        out.push({
          ruleId,
          category: 'runtime-network',
          title,
          description: isMainDoc
            ? `Top-level main document returned HTTP ${res.status} ${res.statusText || ''} at ${res.url}. Indicates an unhandled backend exception or infrastructure failure on the target page.`
            : isIframeDoc
              ? `Embedded iframe document returned HTTP ${res.status} ${res.statusText || ''} at ${res.url}. Main page navigation succeeded but embedded frame experienced server error.`
              : `Server returned HTTP ${res.status} ${res.statusText || ''} for ${res.resourceType} at ${res.url}. Indicates an unhandled backend exception or infrastructure failure.`,
          severity,
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: res.url,
          evidence: {
            url: res.url,
            status: res.status,
            statusText: res.statusText,
            resourceType: res.resourceType,
            headers: res.headers,
            isMainFrame: res.isMainFrame,
            frameUrl: res.frameUrl,
            isFirstParty: res.isFirstParty,
          },
          remediation:
            'Inspect web server and application backend logs to diagnose the 5xx internal error.',
          timestamp: res.timestamp,
        });
        continue;
      }

      // 5. HTTP 4xx Client Errors
      if (res.status && res.status >= 400 && res.status < 500) {
        if (res.status === 404) {
          // Broken resource
          const isCritical = res.resourceType === 'script' || res.resourceType === 'stylesheet';
          const isVisual = res.resourceType === 'image' || res.resourceType === 'font';

          let ruleId: string;
          let title: string;
          let severity: AnalyzerFinding['severity'];

          if (isMainDoc) {
            ruleId = 'HTTP_MAIN_DOCUMENT_404';
            title = 'Main Document Not Found (HTTP 404)';
            severity = 'critical';
          } else if (isIframeDoc) {
            ruleId = 'HTTP_IFRAME_DOCUMENT_404';
            title = 'Iframe Document Not Found (HTTP 404)';
            severity = res.isFirstParty ? 'medium' : 'low';
          } else {
            ruleId = 'HTTP_BROKEN_RESOURCE_404';
            title = `Broken ${res.resourceType} (HTTP 404 Not Found)`;
            severity = isCritical ? 'high' : isVisual ? 'medium' : 'low';
          }

          out.push({
            ruleId,
            category: 'runtime-network',
            title,
            description: isMainDoc
              ? `Main document at ${res.url} returned HTTP 404 Not Found. Target page does not exist.`
              : isIframeDoc
                ? `Embedded iframe document at ${res.url} returned HTTP 404 Not Found. Main page succeeded but iframe content is missing.`
                : `The requested ${res.resourceType} at ${res.url} returned HTTP 404 Not Found. Missing assets can cause broken functionality, unstyled pages, or missing visual content.`,
            severity,
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: res.url,
            evidence: {
              url: res.url,
              status: 404,
              resourceType: res.resourceType,
              isMainFrame: res.isMainFrame,
              frameUrl: res.frameUrl,
              isFirstParty: res.isFirstParty,
            },
            remediation:
              'Restore the missing file at the specified URL or update the HTML link reference.',
            timestamp: res.timestamp,
          });
        } else if (res.status === 401) {
          // Authentication required
          out.push({
            ruleId: 'HTTP_UNAUTHORIZED_401',
            category: 'runtime-network',
            title: `HTTP 401 Unauthorized on ${res.resourceType}`,
            description: `Request for ${res.resourceType} at ${res.url} returned HTTP 401 Unauthorized (${res.statusText || ''}). Authentication is required or credentials were not provided.`,
            severity: 'info',
            confidence: 'potential',
            status: 'potential',
            targetUrl: res.url,
            evidence: {
              url: res.url,
              status: 401,
              statusText: res.statusText,
              resourceType: res.resourceType,
              isFirstParty: res.isFirstParty,
            },
            remediation:
              'Verify whether public access to this resource was intended or if proper authentication credentials should be provided.',
            timestamp: res.timestamp,
          });
        } else if (res.status === 403) {
          // Authorization forbidden
          out.push({
            ruleId: 'HTTP_FORBIDDEN_403',
            category: 'runtime-network',
            title: `HTTP 403 Forbidden on ${res.resourceType}`,
            description: `Request for ${res.resourceType} at ${res.url} returned HTTP 403 Forbidden (${res.statusText || ''}). Access is restricted by server authorization policy.`,
            severity: 'info',
            confidence: 'potential',
            status: 'potential',
            targetUrl: res.url,
            evidence: {
              url: res.url,
              status: 403,
              statusText: res.statusText,
              resourceType: res.resourceType,
              isFirstParty: res.isFirstParty,
            },
            remediation:
              'Verify whether public access to this resource was intended or if permission configuration is accurate.',
            timestamp: res.timestamp,
          });
        } else {
          // Other 4xx
          out.push({
            ruleId: 'HTTP_CLIENT_ERROR_4XX',
            category: 'runtime-network',
            title: `HTTP ${res.status} Client Error on ${res.resourceType}`,
            description: `Request for ${res.resourceType} at ${res.url} returned HTTP ${res.status} (${res.statusText || ''}).`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: res.url,
            evidence: {
              url: res.url,
              status: res.status,
              statusText: res.statusText,
              resourceType: res.resourceType,
              isFirstParty: res.isFirstParty,
            },
            remediation: 'Inspect client request syntax and server endpoint specifications.',
            timestamp: res.timestamp,
          });
        }
      }
    }
  }

  private deduplicateFindings(candidates: readonly RawCandidateFinding[]): {
    consolidatedFindings: readonly ConsolidatedFinding[];
    duplicatesConsolidated: number;
  } {
    const map = new Map<string, ConsolidatedFinding>();
    let duplicatesConsolidated = 0;

    for (const candidate of candidates) {
      // Fingerprint combines ruleId, category, targetUrl, and main title pattern
      const fingerprint = `${candidate.ruleId}|${candidate.category}|${candidate.targetUrl}|${candidate.title}`;

      const existing = map.get(fingerprint);
      if (existing) {
        existing.occurrences++;
        existing.lastSeenAt = Math.max(existing.lastSeenAt, candidate.timestamp);
        duplicatesConsolidated++;
      } else {
        map.set(fingerprint, {
          base: candidate,
          occurrences: 1,
          firstSeenAt: candidate.timestamp,
          lastSeenAt: candidate.timestamp,
        });
      }
    }

    return {
      consolidatedFindings: Array.from(map.values()),
      duplicatesConsolidated,
    };
  }

  private mapToAnalyzerFinding(cf: ConsolidatedFinding): AnalyzerFinding {
    const { base, occurrences, firstSeenAt, lastSeenAt } = cf;

    const title = occurrences > 1 ? `${base.title} (${occurrences} occurrences)` : base.title;

    const evidenceData: Record<string, unknown> = {
      ...base.evidence,
      occurrences,
      firstSeenAt,
      lastSeenAt,
    };

    const sanitizedEvidence = sanitizeEvidence(evidenceData);

    return {
      ruleId: base.ruleId,
      category: base.category,
      title,
      description: base.description,
      severity: base.severity,
      confidence: base.confidence,
      status: base.status,
      targetUrl: base.targetUrl,
      evidence: sanitizedEvidence,
      remediation: base.remediation,
      references: base.references,
    };
  }
}
