import type { AnalyzerFinding } from '../scanner/analyzers/types.js';

export type RuntimeEventType =
  | 'runtime_error'
  | 'unhandled_rejection'
  | 'console_error'
  | 'console_warning'
  | 'console_assert'
  | 'network_failure'
  | 'http_client_error'
  | 'http_server_error'
  | 'broken_resource';

export interface SourceLocation {
  readonly url?: string;
  readonly lineNumber?: number;
  readonly columnNumber?: number;
}

export interface CapturedRuntimeError {
  readonly id: string;
  readonly type: 'runtime_error' | 'unhandled_rejection';
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly location?: SourceLocation;
  readonly frameUrl?: string;
  readonly timestamp: number;
}

export interface CapturedConsoleMessage {
  readonly id: string;
  readonly type: 'error' | 'warning' | 'assert';
  readonly text: string;
  readonly location?: SourceLocation;
  readonly pageUrl: string;
  readonly frameUrl?: string;
  readonly timestamp: number;
}

export type ResourceCategory =
  | 'document'
  | 'stylesheet'
  | 'image'
  | 'media'
  | 'font'
  | 'script'
  | 'texttrack'
  | 'xhr'
  | 'fetch'
  | 'eventsource'
  | 'websocket'
  | 'manifest'
  | 'other';

export interface CapturedNetworkResource {
  readonly id: string;
  readonly url: string;
  readonly method: string;
  readonly resourceType: ResourceCategory;
  readonly status?: number;
  readonly statusText?: string;
  readonly headers?: Record<string, string>;
  readonly failureText?: string;
  readonly isNavigationRequest: boolean;
  readonly isMainFrame: boolean;
  readonly frameUrl?: string;
  readonly durationMs?: number;
  readonly timestamp: number;
  readonly isAborted: boolean;
  readonly isBlocked: boolean;
  readonly isFirstParty: boolean;
}

export interface RuntimeAuditorOptions {
  /**
   * Primary authorized origin for the audit session (e.g. 'https://example.com').
   */
  readonly authorizedOrigin: string;

  /**
   * Additional allowed origins/domains treated as first-party or approved CDN partners.
   */
  readonly additionalAllowedDomains?: readonly string[];

  /**
   * Maximum runtime JavaScript errors to collect before bounding.
   * Default: 100.
   */
  readonly maxErrors?: number;

  /**
   * Maximum console events (errors/warnings) to collect before bounding.
   * Default: 100.
   */
  readonly maxConsoleMessages?: number;

  /**
   * Maximum network resource events to collect before bounding.
   * Default: 200.
   */
  readonly maxNetworkResources?: number;

  /**
   * Maximum characters of any single error or console message string before redaction/truncation.
   * Default: 1000 characters.
   */
  readonly maxMessageLength?: number;

  /**
   * Maximum characters of any stack trace before truncation.
   * Default: 2000 characters.
   */
  readonly maxStackLength?: number;

  /**
   * Maximum findings to produce per page session.
   * Default: 50.
   */
  readonly maxFindings?: number;
}

export interface RuntimeAuditMetrics {
  readonly totalErrors: number;
  readonly totalConsoleErrors: number;
  readonly totalConsoleWarnings: number;
  readonly totalNetworkRequests: number;
  readonly failedRequests: number;
  readonly http4xxErrors: number;
  readonly http5xxErrors: number;
  readonly duplicatesConsolidated: number;
}

export interface RuntimeAuditResult {
  readonly pageUrl: string;
  readonly authorizedOrigin: string;
  readonly errors: readonly CapturedRuntimeError[];
  readonly consoleMessages: readonly CapturedConsoleMessage[];
  readonly networkResources: readonly CapturedNetworkResource[];
  readonly findings: readonly AnalyzerFinding[];
  readonly metrics: RuntimeAuditMetrics;
  readonly limitsReached: boolean;
  readonly startedAt: number;
  readonly completedAt: number;
}
