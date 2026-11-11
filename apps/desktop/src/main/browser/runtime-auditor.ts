import type { Page } from 'playwright-core';
import type {
  RuntimeAuditMetrics,
  RuntimeAuditResult,
  RuntimeAuditorOptions,
} from './runtime-types.js';
import { BrowserRuntimeCollector } from './runtime-collector.js';
import { BrowserRuntimeAnalyzer } from './runtime-analyzer.js';

export class RuntimeResourceAuditor {
  private readonly options: RuntimeAuditorOptions;
  private readonly collector: BrowserRuntimeCollector;
  private readonly analyzer: BrowserRuntimeAnalyzer;

  private targetPage: Page | null = null;
  private startedAt = 0;

  constructor(options: RuntimeAuditorOptions) {
    this.options = options;
    this.collector = new BrowserRuntimeCollector(options);
    this.analyzer = new BrowserRuntimeAnalyzer(options);
  }

  /**
   * Attaches runtime and network listeners to the target page and begins collection.
   */
  public attach(page: Page): void {
    this.targetPage = page;
    this.startedAt = Date.now();
    this.collector.attach(page);
  }

  /**
   * Detaches listeners and releases page references.
   */
  public detach(): void {
    this.collector.detach();
    this.targetPage = null;
  }

  /**
   * Performs analysis over the collected runtime and network events,
   * generates deduplicated findings, and calculates metrics.
   */
  public audit(explicitPageUrl?: string): RuntimeAuditResult {
    const pageUrl =
      explicitPageUrl ||
      (this.targetPage && !this.targetPage.isClosed() ? this.targetPage.url() : '') ||
      this.options.authorizedOrigin;

    const errors = this.collector.getCollectedErrors();
    const consoleMessages = this.collector.getCollectedConsoleMessages();
    const networkResources = this.collector.getCollectedNetworkResources();
    const rawMetrics = this.collector.getMetrics();

    const { findings, metrics } = this.analyzer.analyze({
      pageUrl,
      errors,
      consoleMessages,
      networkResources,
      rawMetrics,
    });

    return {
      pageUrl,
      authorizedOrigin: this.options.authorizedOrigin,
      errors,
      consoleMessages,
      networkResources,
      findings,
      metrics,
      limitsReached: this.collector.isLimitsReached(),
      startedAt: this.startedAt || Date.now(),
      completedAt: Date.now(),
    };
  }

  public getMetrics(): RuntimeAuditMetrics {
    return this.collector.getMetrics();
  }

  public isLimitsReached(): boolean {
    return this.collector.isLimitsReached();
  }
}
