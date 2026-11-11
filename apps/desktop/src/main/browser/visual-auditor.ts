import type { CreateFindingRequest } from '@auditor/shared';
import type { BrowserManager } from './manager.js';
import type {
  ScreenshotMetadata,
  ViewportAuditResult,
  ViewportProfile,
  VisualAuditReport,
  VisualAuditorOptions,
} from './visual-types.js';
import {
  DEFAULT_MAX_PROFILES,
  DEFAULT_VIEWPORT_PROFILES,
  validateViewportProfileList,
} from './viewport-profiles.js';
import { ResponsiveLayoutAnalyzer } from './responsive-analyzer.js';
import { LayoutShiftCollector } from './layout-shift-collector.js';
import { ScreenshotManager } from './screenshot-manager.js';

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

  /**
   * Audits a target URL across all configured viewport profiles sequentially.
   * Isolates failures so an error on one viewport profile does not abort remaining profiles.
   */
  public async auditUrl(targetUrl: string): Promise<VisualAuditReport> {
    const startedAt = Date.now();
    const scanRunId = this.options.scanRunId ?? '00000000-0000-0000-0000-000000000000';
    const viewportResults: ViewportAuditResult[] = [];
    const allFindings: CreateFindingRequest[] = [];

    let anyElementsLimit = false;
    let anyShiftEventsLimit = false;

    let currentManagedPage: Awaited<ReturnType<BrowserManager['acquirePage']>> | null = null;
    let currentEmulationKey = '';

    try {
      for (const profile of this.profiles) {
        if (this.options.signal?.aborted) {
          break;
        }

        const profileStartTime = Date.now();
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
              signal: this.options.signal,
            });
            currentEmulationKey = emulationKey;

            const page = currentManagedPage.page;
            await this.layoutShiftCollector.installScript(page);
            await page.goto(targetUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 30_000,
            });
          } else {
            // Instant viewport resize without network roundtrip
            await currentManagedPage.page.setViewportSize({
              width: profile.width,
              height: profile.height,
            });
          }

          const page = currentManagedPage.page;

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

          // Capture screenshots if enabled
          const screenshots: ScreenshotMetadata[] = [];
          if (this.options.captureScreenshots !== false && !page.isClosed()) {
            try {
              const viewportScreenshot = await this.screenshotManager.capture({
                page,
                viewport: profile,
                captureType: 'viewport',
                scanRunId,
                signal: this.options.signal,
              });
              screenshots.push(viewportScreenshot);
            } catch (err) {
              if (this.options.signal?.aborted) {
                throw err;
              }
              // Ignore non-cancellation screenshot capture error to preserve audit results
            }

            if (
              this.options.captureFullPageScreenshots &&
              !page.isClosed() &&
              !this.options.signal?.aborted
            ) {
              try {
                const fullpageScreenshot = await this.screenshotManager.capture({
                  page,
                  viewport: profile,
                  captureType: 'fullpage',
                  scanRunId,
                  signal: this.options.signal,
                });
                screenshots.push(fullpageScreenshot);
              } catch (err) {
                if (this.options.signal?.aborted) {
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
            durationMs: Date.now() - profileStartTime,
          });
        } catch (err) {
          if (this.options.signal?.aborted) {
            throw err;
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
            durationMs: Date.now() - profileStartTime,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      if (currentManagedPage) {
        await currentManagedPage.release().catch(() => {});
      }
    }

    const completedAt = Date.now();

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
      durationMs: completedAt - startedAt,
      limitsReached: {
        profilesLimit: this.profiles.length >= (this.options.maxProfiles ?? DEFAULT_MAX_PROFILES),
        elementsLimit: anyElementsLimit,
        shiftEventsLimit: anyShiftEventsLimit,
        screenshotCountLimit: this.screenshotManager.getScreenshotsCount() >= 20,
        screenshotStorageLimit: this.screenshotManager.getTotalStoredBytes() >= 50 * 1024 * 1024,
      },
    };
  }
}
