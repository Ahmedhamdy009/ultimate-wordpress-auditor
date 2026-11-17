import type { CreateFindingRequest } from '@auditor/shared';
import type { BrowserManager } from './manager.js';
import {
  type ScreenshotMetadata,
  type ViewportAuditResult,
  type ViewportProfile,
  type VisualAuditReport,
  type VisualAuditorOptions,
  type VisualAuditUrlOptions,
  VisualAuditorTimeoutError,
} from './visual-types.js';
import {
  DEFAULT_MAX_PROFILES,
  DEFAULT_VIEWPORT_PROFILES,
  validateViewportProfileList,
} from './viewport-profiles.js';
import { ResponsiveLayoutAnalyzer } from './responsive-analyzer.js';
import { LayoutShiftCollector } from './layout-shift-collector.js';
import { ScreenshotManager } from './screenshot-manager.js';

export const DEFAULT_VISUAL_NAVIGATION_TIMEOUT_MS = 30_000;
export const MIN_VISUAL_NAVIGATION_TIMEOUT_MS = 1_000;
export const VISUAL_FINALIZATION_RESERVE_MS = 500;

export class VisualAuditor {
  private readonly browserManager: BrowserManager;
  private readonly options: VisualAuditorOptions;
  private readonly profiles: readonly ViewportProfile[];
  private readonly responsiveAnalyzer: ResponsiveLayoutAnalyzer;
  private readonly layoutShiftCollector: LayoutShiftCollector;
  private readonly screenshotManager: ScreenshotManager;

  constructor(browserManager: BrowserManager, options: VisualAuditorOptions = {}) {
    this.browserManager = browserManager;
    this.options = options;

    const maxProfiles = options.maxProfiles ?? DEFAULT_MAX_PROFILES;
    const requestedProfiles = options.profiles ?? DEFAULT_VIEWPORT_PROFILES;
    this.profiles = validateViewportProfileList(requestedProfiles, maxProfiles);

    this.responsiveAnalyzer = new ResponsiveLayoutAnalyzer(options.responsiveOptions);
    this.layoutShiftCollector = new LayoutShiftCollector(options.layoutShiftOptions);
    this.screenshotManager = new ScreenshotManager(options.screenshotOptions);
  }

  public getScreenshotManager(): ScreenshotManager {
    return this.screenshotManager;
  }

  public getProfiles(): readonly ViewportProfile[] {
    return this.profiles;
  }

  private buildPartialReport(
    targetUrl: string,
    startedAt: number,
    completedAt: number,
    viewportResults: ViewportAuditResult[],
    allFindings: CreateFindingRequest[],
    anyElementsLimit: boolean,
    anyShiftEventsLimit: boolean,
  ): VisualAuditReport {
    return {
      targetUrl,
      profilesEvaluated: viewportResults.length,
      totalFindings: allFindings.length,
      findings: allFindings,
      viewportResults,
      totalScreenshots: this.screenshotManager.getScreenshotsCount(),
      totalScreenshotStorageBytes: this.screenshotManager.getTotalStoredBytes(),
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      limitsReached: {
        profilesLimit: this.profiles.length >= (this.options.maxProfiles ?? DEFAULT_MAX_PROFILES),
        elementsLimit: anyElementsLimit,
        shiftEventsLimit: anyShiftEventsLimit,
        screenshotCountLimit: this.screenshotManager.getScreenshotsCount() >= 20,
        screenshotStorageLimit: this.screenshotManager.getTotalStoredBytes() >= 50 * 1024 * 1024,
      },
    };
  }

  /**
   * Audits a target URL across all configured viewport profiles sequentially.
   * Isolates failures so an error on one viewport profile does not abort remaining profiles.
   * Clamps navigation timeouts to respect the remaining scan deadline.
   */
  public async auditUrl(
    targetUrl: string,
    urlOptions?: VisualAuditUrlOptions,
  ): Promise<VisualAuditReport> {
    const clock = this.options.clock ?? Date.now;
    const startedAt = clock();
    const effectiveDeadlineAt = urlOptions?.deadlineAt ?? this.options.deadlineAt;
    const effectiveSignal = urlOptions?.signal ?? this.options.signal;
    const effectiveNavTimeout =
      urlOptions?.navigationTimeoutMs ??
      this.options.navigationTimeoutMs ??
      DEFAULT_VISUAL_NAVIGATION_TIMEOUT_MS;

    const scanRunId = this.options.scanRunId ?? '00000000-0000-0000-0000-000000000000';
    const viewportResults: ViewportAuditResult[] = [];
    const allFindings: CreateFindingRequest[] = [];

    let anyElementsLimit = false;
    let anyShiftEventsLimit = false;

    // If already cancelled before start, return empty/partial report immediately
    if (effectiveSignal?.aborted) {
      return this.buildPartialReport(
        targetUrl,
        startedAt,
        clock(),
        viewportResults,
        allFindings,
        anyElementsLimit,
        anyShiftEventsLimit,
      );
    }

    // Check deadline before start
    if (effectiveDeadlineAt !== undefined) {
      const remainingBudgetMs = effectiveDeadlineAt - clock();
      if (remainingBudgetMs <= 0) {
        throw new VisualAuditorTimeoutError(
          `Scan deadline exceeded before visual audit could start for ${targetUrl} (remaining: ${remainingBudgetMs}ms)`,
          {
            targetUrl,
            remainingBudgetMs,
            deadlineAt: effectiveDeadlineAt,
            partialReport: this.buildPartialReport(
              targetUrl,
              startedAt,
              clock(),
              viewportResults,
              allFindings,
              anyElementsLimit,
              anyShiftEventsLimit,
            ),
          },
        );
      }
    }

    let currentManagedPage: Awaited<ReturnType<BrowserManager['acquirePage']>> | null = null;
    let currentEmulationKey = '';

    try {
      for (const profile of this.profiles) {
        if (effectiveSignal?.aborted) {
          break;
        }

        // Deadline check before starting profile
        if (effectiveDeadlineAt !== undefined) {
          const remainingForProfile = effectiveDeadlineAt - clock();
          if (remainingForProfile <= VISUAL_FINALIZATION_RESERVE_MS) {
            throw new VisualAuditorTimeoutError(
              `Scan deadline exceeded before processing profile ${profile.name} for ${targetUrl} (remaining: ${remainingForProfile}ms)`,
              {
                targetUrl,
                remainingBudgetMs: remainingForProfile,
                deadlineAt: effectiveDeadlineAt,
                partialReport: this.buildPartialReport(
                  targetUrl,
                  startedAt,
                  clock(),
                  viewportResults,
                  allFindings,
                  anyElementsLimit,
                  anyShiftEventsLimit,
                ),
              },
            );
          }
        }

        const profileStartTime = clock();
        const emulationKey = `${profile.isMobile ? 'mobile' : 'desktop'}-${profile.deviceScaleFactor}-${profile.hasTouch ? 'touch' : 'notouch'}`;

        try {
          // Reuse managed page if emulation settings match to avoid redundant network navigations;
          // otherwise acquire new page and navigate.
          if (
            !currentManagedPage ||
            currentManagedPage.page.isClosed() ||
            currentEmulationKey !== emulationKey
          ) {
            if (currentManagedPage) {
              await currentManagedPage.release().catch(() => {});
              currentManagedPage = null;
            }

            // Compute navigation timeout respecting scan deadline
            let navTimeout = effectiveNavTimeout;
            if (effectiveDeadlineAt !== undefined) {
              const remainingBudgetForNav =
                effectiveDeadlineAt - clock() - VISUAL_FINALIZATION_RESERVE_MS;
              if (remainingBudgetForNav <= 0) {
                throw new VisualAuditorTimeoutError(
                  `Scan deadline exceeded before navigation to ${targetUrl} for profile ${profile.name}`,
                  {
                    targetUrl,
                    remainingBudgetMs: effectiveDeadlineAt - clock(),
                    deadlineAt: effectiveDeadlineAt,
                    partialReport: this.buildPartialReport(
                      targetUrl,
                      startedAt,
                      clock(),
                      viewportResults,
                      allFindings,
                      anyElementsLimit,
                      anyShiftEventsLimit,
                    ),
                  },
                );
              }
              navTimeout = Math.min(
                effectiveNavTimeout,
                Math.max(MIN_VISUAL_NAVIGATION_TIMEOUT_MS, Math.floor(remainingBudgetForNav)),
              );
            }

            currentManagedPage = await this.browserManager.acquirePage({
              viewport: {
                width: profile.width,
                height: profile.height,
                deviceScaleFactor: profile.deviceScaleFactor,
                isMobile: profile.isMobile,
                hasTouch: profile.hasTouch,
              },
              deviceScaleFactor: profile.deviceScaleFactor,
              isMobile: profile.isMobile,
              hasTouch: profile.hasTouch,
              signal: effectiveSignal,
            });
            currentEmulationKey = emulationKey;

            const page = currentManagedPage.page;
            await this.layoutShiftCollector.installScript(page);

            // Abort race setup: if signal aborts during page.goto, close page to break network wait
            let abortListener: (() => void) | null = null;
            const abortPromise = new Promise<never>((_, reject) => {
              if (effectiveSignal?.aborted) {
                reject(effectiveSignal.reason ?? new Error('Visual audit cancelled by user'));
                return;
              }
              abortListener = () => {
                page.close().catch(() => {});
                reject(effectiveSignal!.reason ?? new Error('Visual audit cancelled by user'));
              };
              effectiveSignal?.addEventListener('abort', abortListener, { once: true });
            });

            try {
              await Promise.race([
                page.goto(targetUrl, {
                  waitUntil: 'domcontentloaded',
                  timeout: navTimeout,
                }),
                abortPromise,
              ]);
            } finally {
              if (abortListener && effectiveSignal) {
                effectiveSignal.removeEventListener('abort', abortListener);
              }
            }
          } else {
            // Instant viewport resize without network roundtrip
            await currentManagedPage.page.setViewportSize({
              width: profile.width,
              height: profile.height,
            });
          }

          const page = currentManagedPage.page;

          // Check deadline before analysis
          if (effectiveDeadlineAt !== undefined && clock() >= effectiveDeadlineAt) {
            throw new VisualAuditorTimeoutError(
              `Scan deadline exceeded after navigation to ${targetUrl}`,
              {
                targetUrl,
                remainingBudgetMs: effectiveDeadlineAt - clock(),
                deadlineAt: effectiveDeadlineAt,
                partialReport: this.buildPartialReport(
                  targetUrl,
                  startedAt,
                  clock(),
                  viewportResults,
                  allFindings,
                  anyElementsLimit,
                  anyShiftEventsLimit,
                ),
              },
            );
          }

          // Collect layout shifts
          const {
            metrics: shiftMetrics,
            events: shiftEvents,
            findings: shiftFindings,
          } = await this.layoutShiftCollector.collectMetrics(page, profile, targetUrl, scanRunId);

          if (shiftMetrics.isLimitReached) {
            anyShiftEventsLimit = true;
          }

          // Analyze responsive layout
          const {
            metrics: respMetrics,
            overflowingElements,
            findings: respFindings,
          } = await this.responsiveAnalyzer.analyzePage(page, profile, targetUrl, scanRunId);

          if (respMetrics.inspectedElementsCount >= 500) {
            anyElementsLimit = true;
          }

          // Capture screenshots if enabled (and deadline allows)
          const screenshots: ScreenshotMetadata[] = [];
          const canCapture =
            effectiveDeadlineAt === undefined ||
            effectiveDeadlineAt - clock() > VISUAL_FINALIZATION_RESERVE_MS;

          if (this.options.captureScreenshots !== false && !page.isClosed() && canCapture) {
            try {
              const viewportScreenshot = await this.screenshotManager.capture({
                page,
                viewport: profile,
                captureType: 'viewport',
                scanRunId,
                signal: effectiveSignal,
              });
              screenshots.push(viewportScreenshot);
            } catch (err) {
              if (effectiveSignal?.aborted) {
                throw err;
              }
              // Ignore non-cancellation screenshot capture error to preserve audit results
            }

            if (
              this.options.captureFullPageScreenshots &&
              !page.isClosed() &&
              !effectiveSignal?.aborted &&
              (effectiveDeadlineAt === undefined ||
                effectiveDeadlineAt - clock() > VISUAL_FINALIZATION_RESERVE_MS)
            ) {
              try {
                const fullpageScreenshot = await this.screenshotManager.capture({
                  page,
                  viewport: profile,
                  captureType: 'fullpage',
                  scanRunId,
                  signal: effectiveSignal,
                });
                screenshots.push(fullpageScreenshot);
              } catch (err) {
                if (effectiveSignal?.aborted) {
                  throw err;
                }
                // Ignore non-cancellation fullpage screenshot error
              }
            }
          }

          const profileFindings = [...respFindings, ...shiftFindings];

          // Attach viewport screenshot metadata to all findings discovered on this viewport
          const profileScreenshot =
            screenshots.find(s => s.captureType === 'viewport') || screenshots[0];
          if (profileScreenshot) {
            for (const f of profileFindings) {
              if (f.evidence && typeof f.evidence === 'object') {
                (f.evidence as Record<string, unknown>).screenshot = {
                  id: profileScreenshot.id,
                  fileName:
                    profileScreenshot.relativePath ||
                    `${profileScreenshot.id}.${profileScreenshot.format}`,
                  width: profileScreenshot.width,
                  height: profileScreenshot.height,
                  viewportProfile: profile.name,
                  fileSizeBytes: profileScreenshot.fileSizeBytes,
                  captureType: profileScreenshot.captureType,
                };
              }
            }
          }

          allFindings.push(...profileFindings);

          viewportResults.push({
            viewport: profile,
            targetUrl,
            responsiveMetrics: respMetrics,
            layoutStabilityMetrics: shiftMetrics,
            layoutShiftEvents: shiftEvents,
            overflowingElements,
            screenshots,
            findings: profileFindings,
            durationMs: clock() - profileStartTime,
          });
        } catch (err) {
          if (effectiveSignal?.aborted) {
            throw err;
          }

          if (err instanceof VisualAuditorTimeoutError) {
            throw err;
          }

          const now = clock();
          if (
            effectiveDeadlineAt !== undefined &&
            (now >= effectiveDeadlineAt ||
              effectiveDeadlineAt - now <= VISUAL_FINALIZATION_RESERVE_MS)
          ) {
            if (currentManagedPage) {
              await currentManagedPage.release().catch(() => {});
              currentManagedPage = null;
            }
            throw new VisualAuditorTimeoutError(
              `Scan deadline reached during visual audit of ${targetUrl} on profile ${profile.name}: ${err instanceof Error ? err.message : String(err)}`,
              {
                targetUrl,
                remainingBudgetMs: effectiveDeadlineAt - now,
                deadlineAt: effectiveDeadlineAt,
                partialReport: this.buildPartialReport(
                  targetUrl,
                  startedAt,
                  now,
                  viewportResults,
                  allFindings,
                  anyElementsLimit,
                  anyShiftEventsLimit,
                ),
              },
            );
          }

          // Individual viewport error isolation: release corrupted page so subsequent viewports start fresh
          if (currentManagedPage) {
            await currentManagedPage.release().catch(() => {});
            currentManagedPage = null;
          }

          viewportResults.push({
            viewport: profile,
            targetUrl,
            responsiveMetrics: {
              viewport: profile,
              windowInnerWidth: profile.width,
              windowInnerHeight: profile.height,
              documentScrollWidth: profile.width,
              documentScrollHeight: profile.height,
              bodyScrollWidth: profile.width,
              bodyScrollHeight: profile.height,
              hasHorizontalOverflow: false,
              maxHorizontalOverflowPx: 0,
              inspectedElementsCount: 0,
              overflowingElementsCount: 0,
            },
            layoutStabilityMetrics: {
              isSupported: false,
              totalShiftsRecorded: 0,
              rawCumulativeLayoutShift: 0,
              sessionWindowCLS: 0,
              excludedUserShiftsCount: 0,
              sessionWindowsCount: 0,
              maxSingleShiftValue: 0,
              isLimitReached: false,
            },
            layoutShiftEvents: [],
            overflowingElements: [],
            screenshots: [],
            findings: [],
            durationMs: clock() - profileStartTime,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      if (currentManagedPage) {
        await currentManagedPage.release().catch(() => {});
      }
    }

    const completedAt = clock();

    return this.buildPartialReport(
      targetUrl,
      startedAt,
      completedAt,
      viewportResults,
      allFindings,
      anyElementsLimit,
      anyShiftEventsLimit,
    );
  }
}
