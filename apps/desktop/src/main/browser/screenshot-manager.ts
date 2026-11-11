import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Page, Locator } from 'playwright-core';
import { getScreenshotsDirectory } from '../reports/paths.js';
import { redactUrl } from './redactor.js';
import type {
  ScreenshotCaptureType,
  ScreenshotFormat,
  ScreenshotManagerOptions,
  ScreenshotMetadata,
  ViewportProfile,
} from './visual-types.js';

export const DEFAULT_MAX_SCREENSHOTS_PER_AUDIT = 20;
export const DEFAULT_MAX_INDIVIDUAL_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const DEFAULT_MAX_TOTAL_STORAGE_BYTES = 50 * 1024 * 1024; // 50 MB
export const DEFAULT_MAX_SCREENSHOT_WIDTH = 4096;
export const DEFAULT_MAX_SCREENSHOT_HEIGHT = 16384;
export const DEFAULT_SCREENSHOT_TIMEOUT_MS = 10_000;

export interface AuditQuotaUsage {
  storedBytes: number;
  screenshotsCount: number;
}

export class ScreenshotManager {
  private readonly storageDir: string;
  private readonly maxScreenshots: number;
  private readonly maxIndividualBytes: number;
  private readonly maxTotalBytes: number;
  private readonly maxWidth: number;
  private readonly maxHeight: number;
  private readonly captureTimeoutMs: number;
  private readonly defaultFormat: ScreenshotFormat;
  private readonly jpegQuality: number;

  /**
   * Per-audit quota tracking map: scanRunId -> { storedBytes, screenshotsCount }.
   * Guarantees that quotas are isolated per audit run.
   */
  private readonly auditQuotas = new Map<string, AuditQuotaUsage>();

  /**
   * Per-audit mutex promise chain to prevent concurrent quota races.
   */
  private readonly auditLocks = new Map<string, Promise<unknown>>();

  constructor(options: ScreenshotManagerOptions = {}) {
    this.storageDir = path.resolve(options.storageDir ?? getScreenshotsDirectory());
    this.maxScreenshots = options.maxScreenshotsPerAudit ?? DEFAULT_MAX_SCREENSHOTS_PER_AUDIT;
    this.maxIndividualBytes = options.maxIndividualSizeBytes ?? DEFAULT_MAX_INDIVIDUAL_SIZE_BYTES;
    this.maxTotalBytes = options.maxTotalStorageBytes ?? DEFAULT_MAX_TOTAL_STORAGE_BYTES;
    this.maxWidth = options.maxWidth ?? DEFAULT_MAX_SCREENSHOT_WIDTH;
    this.maxHeight = options.maxHeight ?? DEFAULT_MAX_SCREENSHOT_HEIGHT;
    this.captureTimeoutMs = options.captureTimeoutMs ?? DEFAULT_SCREENSHOT_TIMEOUT_MS;
    this.defaultFormat = options.defaultFormat ?? 'png';
    this.jpegQuality = options.jpegQuality ?? 80;

    // Ensure screenshot directory exists safely
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  public getStorageDirectory(): string {
    return this.storageDir;
  }

  private getOrCreateAuditQuota(auditKey: string): AuditQuotaUsage {
    let usage = this.auditQuotas.get(auditKey);
    if (!usage) {
      usage = { storedBytes: 0, screenshotsCount: 0 };
      this.auditQuotas.set(auditKey, usage);
    }
    return usage;
  }

  /**
   * Serializes operations per auditKey to prevent concurrent quota race conditions.
   */
  private async withAuditLock<T>(auditKey: string, fn: () => Promise<T>): Promise<T> {
    const currentLock = this.auditLocks.get(auditKey) ?? Promise.resolve();
    let releaseLock: () => void;
    const newLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    this.auditLocks.set(
      auditKey,
      currentLock.then(() => newLock),
    );

    await currentLock;
    try {
      return await fn();
    } finally {
      releaseLock!();
      if (this.auditLocks.get(auditKey) === newLock) {
        this.auditLocks.delete(auditKey);
      }
    }
  }

  /**
   * Returns the stored bytes for a specific audit, or the sum of all audits if no key is provided.
   */
  public getTotalStoredBytes(auditKey?: string): number {
    if (auditKey) {
      return this.auditQuotas.get(auditKey)?.storedBytes ?? 0;
    }
    let sum = 0;
    for (const usage of this.auditQuotas.values()) {
      sum += usage.storedBytes;
    }
    return sum;
  }

  /**
   * Returns the screenshot count for a specific audit, or the sum of all audits if no key is provided.
   */
  public getScreenshotsCount(auditKey?: string): number {
    if (auditKey) {
      return this.auditQuotas.get(auditKey)?.screenshotsCount ?? 0;
    }
    let sum = 0;
    for (const usage of this.auditQuotas.values()) {
      sum += usage.screenshotsCount;
    }
    return sum;
  }

  /**
   * Returns the quota usage record for a specific audit.
   */
  public getAuditQuota(auditKey = 'default'): AuditQuotaUsage {
    return { ...this.getOrCreateAuditQuota(auditKey) };
  }

  /**
   * Resets the quota usage record for a specific audit.
   */
  public resetAuditQuota(auditKey = 'default'): void {
    this.auditQuotas.delete(auditKey);
  }

  /**
   * Captures a screenshot of the given page (viewport or fullpage) or element,
   * enforces pre-capture and post-capture safety controls, writes atomically, and returns metadata.
   */
  public async capture(params: {
    page: Page;
    viewport: ViewportProfile;
    captureType: ScreenshotCaptureType;
    format?: ScreenshotFormat;
    scanRunId?: string;
    findingId?: string;
    elementSelector?: string;
    locator?: Locator;
    signal?: AbortSignal;
  }): Promise<ScreenshotMetadata> {
    const auditKey = params.scanRunId || 'default';

    // 1. Pre-Capture Check: AbortSignal validation
    if (params.signal?.aborted) {
      throw new Error('Screenshot capture was aborted by caller signal.');
    }

    // 2. Pre-Capture Check: Viewport Profile Dimensions validation
    if (params.viewport.width > this.maxWidth || params.viewport.height > this.maxHeight) {
      throw new Error(
        `Requested viewport dimensions (${params.viewport.width}x${params.viewport.height}) exceed maximum allowed screenshot dimensions (${this.maxWidth}x${this.maxHeight}).`,
      );
    }

    // 3. Pre-Capture Check: Per-Audit Quota limits
    const currentUsage = this.getOrCreateAuditQuota(auditKey);
    if (currentUsage.screenshotsCount >= this.maxScreenshots) {
      throw new Error(
        `Screenshot quota exceeded: maximum allowed screenshots (${this.maxScreenshots}) reached for audit "${auditKey}".`,
      );
    }
    if (currentUsage.storedBytes >= this.maxTotalBytes) {
      throw new Error(
        `Screenshot total storage quota exceeded (${currentUsage.storedBytes} >= ${this.maxTotalBytes} bytes) for audit "${auditKey}".`,
      );
    }

    const format: ScreenshotFormat = params.format ?? this.defaultFormat;
    const isFullPage = params.captureType === 'fullpage';

    // 4. Pre-Capture Check: Full-page Document Dimension validation
    // Queries document dimensions BEFORE capture to prevent unbounded Chromium bitmap allocations
    if (isFullPage) {
      const dimensions = await params.page.evaluate<{ width: number; height: number }>(`
        ({
          width: Math.max(document.documentElement ? document.documentElement.scrollWidth : 0, window.innerWidth || 0),
          height: Math.max(document.documentElement ? document.documentElement.scrollHeight : 0, window.innerHeight || 0),
        })
      `);

      if (dimensions.width > this.maxWidth || dimensions.height > this.maxHeight) {
        throw new Error(
          `Page dimensions (${dimensions.width}x${dimensions.height}) exceed maximum allowed screenshot dimensions (${this.maxWidth}x${this.maxHeight}).`,
        );
      }
    }

    // 5. Capture Phase: bounded timeout and execution
    let buffer: Buffer;
    try {
      if (params.locator) {
        buffer = await params.locator.screenshot({
          type: format,
          quality: format === 'jpeg' ? this.jpegQuality : undefined,
          timeout: this.captureTimeoutMs,
        });
      } else {
        buffer = await params.page.screenshot({
          fullPage: isFullPage,
          type: format,
          quality: format === 'jpeg' ? this.jpegQuality : undefined,
          timeout: this.captureTimeoutMs,
        });
      }
    } catch (err) {
      throw new Error(
        `Failed to capture ${params.captureType} screenshot: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    // 6. Post-Capture Check: AbortSignal validation post-rendering
    if (params.signal?.aborted) {
      throw new Error('Screenshot capture was aborted by caller signal after rendering.');
    }

    // 7. Post-Capture Check: Individual file-size bound
    if (buffer.length > this.maxIndividualBytes) {
      throw new Error(
        `Screenshot file size (${buffer.length} bytes) exceeds maximum limit (${this.maxIndividualBytes} bytes).`,
      );
    }

    // 8. Atomic Storage & Quota Allocation (protected by per-audit mutex)
    const id = crypto.randomUUID();
    const filename = `${id}.${format}`;

    // Path traversal defense
    const filePath = path.resolve(this.storageDir, filename);
    if (!filePath.startsWith(this.storageDir + path.sep)) {
      throw new Error(
        'Path traversal detected: Target screenshot path is outside storage directory.',
      );
    }

    const relativePath = path.relative(this.storageDir, filePath);
    const tempPath = `${filePath}.tmp.${crypto.randomUUID()}`;

    await this.withAuditLock(auditKey, async () => {
      const usage = this.getOrCreateAuditQuota(auditKey);

      // Re-verify quota inside lock to prevent concurrent quota bypass
      if (usage.screenshotsCount + 1 > this.maxScreenshots) {
        throw new Error(
          `Screenshot quota exceeded: maximum allowed screenshots (${this.maxScreenshots}) reached for audit "${auditKey}".`,
        );
      }
      if (usage.storedBytes + buffer.length > this.maxTotalBytes) {
        throw new Error(
          `Screenshot total storage quota exceeded (${usage.storedBytes + buffer.length} > ${this.maxTotalBytes} bytes) for audit "${auditKey}".`,
        );
      }

      // Check cancellation immediately before disk I/O
      if (params.signal?.aborted) {
        throw new Error('Screenshot capture was aborted by caller signal before writing.');
      }

      // Write atomically via temporary file and rename
      try {
        fs.writeFileSync(tempPath, buffer);
        fs.renameSync(tempPath, filePath);
      } catch (writeErr) {
        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // Ignore cleanup failure
          }
        }
        throw new Error(
          `Failed to write screenshot file atomically: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
          { cause: writeErr },
        );
      }

      usage.storedBytes += buffer.length;
      usage.screenshotsCount += 1;
    });

    // 9. Compute SHA-256 and build metadata
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const rawUrl = params.page.url() || 'about:blank';
    const safeUrl = redactUrl(rawUrl);

    return {
      id,
      scanRunId: params.scanRunId,
      targetUrl: safeUrl,
      viewport: params.viewport,
      captureType: params.captureType,
      format,
      filePath,
      relativePath,
      width: params.viewport.width,
      height: params.viewport.height,
      fileSizeBytes: buffer.length,
      sha256,
      capturedAt: new Date().toISOString(),
      findingId: params.findingId,
      elementSelector: params.elementSelector,
    };
  }

  /**
   * Safely deletes a stored screenshot file and updates the associated audit's quota.
   */
  public deleteScreenshot(metadata: ScreenshotMetadata): void {
    const resolved = path.resolve(metadata.filePath);
    if (!resolved.startsWith(this.storageDir + path.sep)) {
      throw new Error('Path traversal detected: Cannot delete file outside storage directory.');
    }

    if (fs.existsSync(resolved)) {
      try {
        const stats = fs.statSync(resolved);
        fs.unlinkSync(resolved);

        const auditKey = metadata.scanRunId || 'default';
        const usage = this.auditQuotas.get(auditKey);
        if (usage) {
          usage.storedBytes = Math.max(0, usage.storedBytes - stats.size);
          usage.screenshotsCount = Math.max(0, usage.screenshotsCount - 1);
        }
      } catch {
        // Ignore deletion errors
      }
    }
  }

  /**
   * Cleans up all managed screenshot files in this manager instance.
   */
  public cleanupAll(): void {
    if (!fs.existsSync(this.storageDir)) {
      return;
    }

    try {
      const files = fs.readdirSync(this.storageDir);
      for (const file of files) {
        if (file.endsWith('.png') || file.endsWith('.jpeg') || file.includes('.tmp.')) {
          const fullPath = path.join(this.storageDir, file);
          try {
            fs.unlinkSync(fullPath);
          } catch {
            // Ignore individual delete errors
          }
        }
      }
      this.auditQuotas.clear();
    } catch {
      // Ignore directory read errors
    }
  }

  /**
   * Scans the storage directory for any lingering .tmp.* files (e.g. from interrupted writes)
   * and deletes them safely.
   */
  public cleanupAbandonedTempFiles(): number {
    if (!fs.existsSync(this.storageDir)) {
      return 0;
    }

    let cleaned = 0;
    try {
      const files = fs.readdirSync(this.storageDir);
      for (const file of files) {
        if (file.includes('.tmp.')) {
          const fullPath = path.join(this.storageDir, file);
          try {
            fs.unlinkSync(fullPath);
            cleaned++;
          } catch {
            // Ignore error
          }
        }
      }
    } catch {
      // Ignore error
    }
    return cleaned;
  }
}
