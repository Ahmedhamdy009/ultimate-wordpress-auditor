/**
 * Batch 4.4 Accessibility Auditor Facade.
 * Coordinates offline axe-core script injection, page evaluation under bounded timeouts
 * and cancellation signals, and delegates finding normalization to AccessibilityAnalyzer.
 * Provides concurrency guards against overlapping evaluations and accurate cancellation state.
 */

import type { Page } from 'playwright-core';
import type {
  AccessibilityAuditMetrics,
  AccessibilityAuditReport,
  AccessibilityAuditorOptions,
  AxeExecutionRawResults,
} from './accessibility-types.js';
import {
  A11Y_DISCLAIMER,
  BEST_PRACTICE_TAG,
  DEFAULT_AUDIT_TIMEOUT_MS,
  DEFAULT_WCAG_TAGS,
} from './accessibility-types.js';
import { AxeCoreLoader } from './axe-loader.js';
import { AccessibilityAnalyzer } from './accessibility-analyzer.js';

export class AccessibilityAuditor {
  private static readonly activePages = new Set<Page>();

  private readonly options: AccessibilityAuditorOptions;
  private readonly analyzer: AccessibilityAnalyzer;

  constructor(options: AccessibilityAuditorOptions = {}) {
    this.options = options;
    this.analyzer = new AccessibilityAnalyzer(options);
  }

  /**
   * Checks whether an accessibility audit is actively executing in the browser for the given page.
   */
  public static isPageAuditing(page: Page): boolean {
    return AccessibilityAuditor.activePages.has(page);
  }

  /**
   * Clears active audit locks (useful for test isolation).
   */
  public static clearLocks(): void {
    AccessibilityAuditor.activePages.clear();
  }

  /**
   * Evaluates accessibility of the rendered page using offline axe-core.
   * Handles timeouts, cancellation signals, and page lifecycle failures gracefully.
   */
  public async auditPage(
    page: Page,
    overrideOptions?: AccessibilityAuditorOptions,
  ): Promise<AccessibilityAuditReport> {
    const startedAt = Date.now();
    const mergedOptions: AccessibilityAuditorOptions = {
      ...this.options,
      ...overrideOptions,
    };

    const timeoutMs = mergedOptions.timeoutMs ?? DEFAULT_AUDIT_TIMEOUT_MS;
    const activeTags = mergedOptions.tags ? [...mergedOptions.tags] : [...DEFAULT_WCAG_TAGS];

    if (mergedOptions.includeBestPractice && !activeTags.includes(BEST_PRACTICE_TAG)) {
      activeTags.push(BEST_PRACTICE_TAG);
    }

    const emptyMetrics: AccessibilityAuditMetrics = {
      violationsCount: 0,
      criticalCount: 0,
      seriousCount: 0,
      moderateCount: 0,
      minorCount: 0,
      incompleteCount: 0,
      passesCount: 0,
      inapplicableCount: 0,
      durationMs: 0,
    };

    // 1. Initial Lifecycle and Pre-flight Checks
    if (page.isClosed()) {
      return {
        pageUrl: '',
        wcagStandards: activeTags,
        violations: [],
        incomplete: [],
        findings: [],
        metrics: emptyMetrics,
        limitsReached: {
          violationsLimit: false,
          incompleteLimit: false,
          nodesLimit: false,
          snippetLimit: false,
          evidenceLimit: false,
          timeout: false,
        },
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        disclaimer: A11Y_DISCLAIMER,
        cancellationState: 'terminated_by_page_close',
        error: 'Target page is closed before accessibility audit could begin.',
      };
    }

    if (mergedOptions.signal?.aborted) {
      const canClosePage =
        mergedOptions.pageOwnership === 'exclusive' && Boolean(mergedOptions.closePageOnCancel);
      if (canClosePage) {
        await page.close().catch(() => {});
      }
      return {
        pageUrl: page.url() || '',
        wcagStandards: activeTags,
        violations: [],
        incomplete: [],
        findings: [],
        metrics: emptyMetrics,
        limitsReached: {
          violationsLimit: false,
          incompleteLimit: false,
          nodesLimit: false,
          snippetLimit: false,
          evidenceLimit: false,
          timeout: false,
        },
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        disclaimer: A11Y_DISCLAIMER,
        cancellationState: canClosePage
          ? 'terminated_by_page_close'
          : 'caller_aborted_renderer_pending',
        error: 'Accessibility audit aborted by caller signal.',
      };
    }

    // 2. Prevent Overlapping Audits on the Same Page
    if (AccessibilityAuditor.isPageAuditing(page)) {
      return {
        pageUrl: page.url() || '',
        wcagStandards: activeTags,
        violations: [],
        incomplete: [],
        findings: [],
        metrics: emptyMetrics,
        limitsReached: {
          violationsLimit: false,
          incompleteLimit: false,
          nodesLimit: false,
          snippetLimit: false,
          evidenceLimit: false,
          timeout: false,
        },
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        disclaimer: A11Y_DISCLAIMER,
        cancellationState: 'overlapping_prevented',
        error:
          'Concurrent or overlapping accessibility audit on the same page is not permitted while previous audit is still executing in the renderer.',
      };
    }

    // Acquire lock for this page
    AccessibilityAuditor.activePages.add(page);

    const onClose = (): void => {
      AccessibilityAuditor.activePages.delete(page);
    };
    page.once('close', onClose);

    let pageUrl = '';
    try {
      pageUrl = page.url();
    } catch {
      // Retain default empty string
    }

    // 3. Inject axe-core bundle
    try {
      await AxeCoreLoader.injectAxe(page);
    } catch (injectError: unknown) {
      page.removeListener('close', onClose);
      AccessibilityAuditor.activePages.delete(page);
      const errMessage = injectError instanceof Error ? injectError.message : String(injectError);
      return {
        pageUrl,
        wcagStandards: activeTags,
        violations: [],
        incomplete: [],
        findings: [],
        metrics: emptyMetrics,
        limitsReached: {
          violationsLimit: false,
          incompleteLimit: false,
          nodesLimit: false,
          snippetLimit: false,
          evidenceLimit: false,
          timeout: false,
        },
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        disclaimer: A11Y_DISCLAIMER,
        error: `Failed to inject offline axe-core: ${errMessage}`,
      };
    }

    // 4. Prepare axe execution configuration
    const axeRunConfig = {
      runOnly: {
        type: 'tag' as const,
        values: activeTags,
      },
      rules: mergedOptions.rules,
      resultTypes: ['violations', 'incomplete', 'passes', 'inapplicable'],
      elementRef: false,
      selectors: true,
      ancestry: false,
      xpath: false,
    };

    // 5. Execute axe-core inside page with timeout and cancellation race
    let rawResults: AxeExecutionRawResults | null = null;
    let timedOut = false;
    let executionError: string | null = null;

    let timeoutTimer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Accessibility audit timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    const abortPromise = new Promise<never>((_, reject) => {
      if (mergedOptions.signal) {
        if (mergedOptions.signal.aborted) {
          reject(new Error('Accessibility audit aborted by caller signal.'));
        } else {
          mergedOptions.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('Accessibility audit aborted by caller signal.'));
            },
            { once: true },
          );
        }
      }
    });

    try {
      const evaluatePromise = page.evaluate(options => {
        const globalTarget = globalThis as unknown as {
          axe?: {
            run: (context: unknown, options: unknown) => Promise<AxeExecutionRawResults>;
          };
          document?: unknown;
        };

        const axeGlobal = globalTarget.axe;
        if (!axeGlobal || typeof axeGlobal.run !== 'function') {
          throw new Error('axe-core is not initialized in the browser window.');
        }

        return axeGlobal.run(globalTarget.document, options);
      }, axeRunConfig);

      // Keep background monitor to release the page lock once Chromium finishes execution
      evaluatePromise
        .catch(() => {})
        .finally(() => {
          page.removeListener('close', onClose);
          AccessibilityAuditor.activePages.delete(page);
        });

      rawResults = await Promise.race([evaluatePromise, timeoutPromise, abortPromise]);
    } catch (evalErr: unknown) {
      executionError = evalErr instanceof Error ? evalErr.message : String(evalErr);
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
    }

    const completedAt = Date.now();
    const durationMs = completedAt - startedAt;

    if (!rawResults || executionError) {
      let state: AccessibilityAuditReport['cancellationState'] = undefined;
      const canClosePage =
        mergedOptions.pageOwnership === 'exclusive' && Boolean(mergedOptions.closePageOnCancel);
      if (page.isClosed()) {
        state = 'terminated_by_page_close';
      } else if (timedOut) {
        state = 'caller_timeout_renderer_pending';
        if (canClosePage) {
          await page.close().catch(() => {});
          state = 'terminated_by_page_close';
        }
      } else if (mergedOptions.signal?.aborted) {
        state = 'caller_aborted_renderer_pending';
        if (canClosePage) {
          await page.close().catch(() => {});
          state = 'terminated_by_page_close';
        }
      }

      return {
        pageUrl,
        wcagStandards: activeTags,
        violations: [],
        incomplete: [],
        findings: [],
        metrics: {
          ...emptyMetrics,
          durationMs,
        },
        limitsReached: {
          violationsLimit: false,
          incompleteLimit: false,
          nodesLimit: false,
          snippetLimit: false,
          evidenceLimit: false,
          timeout: timedOut,
        },
        startedAt,
        completedAt,
        durationMs,
        disclaimer: A11Y_DISCLAIMER,
        cancellationState: state,
        error: executionError || 'Accessibility audit returned no results.',
      };
    }

    // 6. Delegate result parsing and evidence formatting to analyzer
    const analysis = this.analyzer.analyze({
      pageUrl,
      rawResults,
    });

    return {
      pageUrl,
      wcagStandards: activeTags,
      violations: analysis.violations,
      incomplete: analysis.incomplete,
      findings: analysis.findings,
      metrics: {
        ...analysis.metrics,
        durationMs,
      },
      limitsReached: {
        ...analysis.limitsReached,
        timeout: timedOut,
      },
      startedAt,
      completedAt,
      durationMs,
      disclaimer: A11Y_DISCLAIMER,
      cancellationState: 'completed',
    };
  }
}
