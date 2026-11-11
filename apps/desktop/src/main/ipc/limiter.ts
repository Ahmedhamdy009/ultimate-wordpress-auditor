import { IPC_CHANNELS, type IPCChannel } from '@auditor/shared';

export interface ChannelPolicyLimits {
  readonly maxRequestsPerSecond: number;
  readonly maxConcurrency: number;
  readonly maxPayloadBytes: number;
}

/**
 * Approved per-channel rate, concurrency, and payload budget specifications.
 */
export const CHANNEL_LIMITS: Readonly<Record<IPCChannel, ChannelPolicyLimits>> = Object.freeze({
  [IPC_CHANNELS.APP_PING]: Object.freeze({
    maxRequestsPerSecond: 30,
    maxConcurrency: 5,
    maxPayloadBytes: 1024, // 1 KB
  }),
  [IPC_CHANNELS.APP_GET_SYSTEM_INFO]: Object.freeze({
    maxRequestsPerSecond: 5,
    maxConcurrency: 2,
    maxPayloadBytes: 1024, // 1 KB
  }),
  [IPC_CHANNELS.AUDIT_VALIDATE_TARGET]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 3,
    maxPayloadBytes: 8192, // 8 KB
  }),

  // Project Management Channels
  [IPC_CHANNELS.PROJECT_CREATE]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 16384, // 16 KB
  }),
  [IPC_CHANNELS.PROJECT_GET]: Object.freeze({
    maxRequestsPerSecond: 20,
    maxConcurrency: 5,
    maxPayloadBytes: 2048, // 2 KB
  }),
  [IPC_CHANNELS.PROJECT_LIST]: Object.freeze({
    maxRequestsPerSecond: 20,
    maxConcurrency: 5,
    maxPayloadBytes: 8192, // 8 KB
  }),
  [IPC_CHANNELS.PROJECT_UPDATE]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 16384, // 16 KB
  }),
  [IPC_CHANNELS.PROJECT_ARCHIVE]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 2048, // 2 KB
  }),
  [IPC_CHANNELS.PROJECT_RESTORE]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 2048, // 2 KB
  }),

  // Site Management Channels
  [IPC_CHANNELS.SITE_CREATE]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 16384, // 16 KB
  }),
  [IPC_CHANNELS.SITE_GET]: Object.freeze({
    maxRequestsPerSecond: 20,
    maxConcurrency: 5,
    maxPayloadBytes: 2048, // 2 KB
  }),
  [IPC_CHANNELS.SITE_LIST]: Object.freeze({
    maxRequestsPerSecond: 20,
    maxConcurrency: 5,
    maxPayloadBytes: 8192, // 8 KB
  }),
  [IPC_CHANNELS.SITE_UPDATE]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 16384, // 16 KB
  }),
  [IPC_CHANNELS.SITE_ARCHIVE]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 2048, // 2 KB
  }),
  [IPC_CHANNELS.SITE_RESTORE]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 2048, // 2 KB
  }),

  // Scan Run Channels (Phase 2.3)
  [IPC_CHANNELS.SCAN_CREATE]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 16384, // 16 KB
  }),
  [IPC_CHANNELS.SCAN_GET]: Object.freeze({
    maxRequestsPerSecond: 20,
    maxConcurrency: 5,
    maxPayloadBytes: 2048, // 2 KB
  }),
  [IPC_CHANNELS.SCAN_LIST]: Object.freeze({
    maxRequestsPerSecond: 20,
    maxConcurrency: 5,
    maxPayloadBytes: 8192, // 8 KB
  }),
  [IPC_CHANNELS.SCAN_CANCEL]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 2048, // 2 KB
  }),
  [IPC_CHANNELS.SCAN_PROGRESS]: Object.freeze({
    maxRequestsPerSecond: 30,
    maxConcurrency: 5,
    maxPayloadBytes: 2048, // 2 KB
  }),

  // Finding Channels (Phase 2.3)
  [IPC_CHANNELS.FINDING_LIST]: Object.freeze({
    maxRequestsPerSecond: 20,
    maxConcurrency: 5,
    maxPayloadBytes: 8192, // 8 KB
  }),
  [IPC_CHANNELS.FINDING_GET]: Object.freeze({
    maxRequestsPerSecond: 30,
    maxConcurrency: 5,
    maxPayloadBytes: 2048, // 2 KB
  }),

  // Report Channels (Phase 2.3)
  [IPC_CHANNELS.REPORT_CREATE]: Object.freeze({
    maxRequestsPerSecond: 5,
    maxConcurrency: 2,
    maxPayloadBytes: 32768, // 32 KB
  }),
  [IPC_CHANNELS.REPORT_GET]: Object.freeze({
    maxRequestsPerSecond: 20,
    maxConcurrency: 5,
    maxPayloadBytes: 2048, // 2 KB
  }),
  [IPC_CHANNELS.REPORT_LIST]: Object.freeze({
    maxRequestsPerSecond: 20,
    maxConcurrency: 5,
    maxPayloadBytes: 8192, // 8 KB
  }),
  [IPC_CHANNELS.REPORT_DELETE]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 2048, // 2 KB
  }),
  [IPC_CHANNELS.REPORT_GET_CONTENT]: Object.freeze({
    maxRequestsPerSecond: 10,
    maxConcurrency: 2,
    maxPayloadBytes: 2048, // 2 KB
  }),
});

export interface ConcurrencyLease {
  readonly acquired: boolean;
  readonly release: () => void;
}

/**
 * Sliding-window rate limiter and concurrency tracker for IPC channels.
 * Maintains strict per-channel, per-webContents isolation so that traffic on
 * one channel cannot corrupt, starve, or exhaust rate limits on another.
 */
export class ChannelRateLimiter {
  /**
   * Tracks request timestamps in a 1-second sliding window.
   * Key: `${webContentsId}:${channel}`
   */
  private readonly rateWindows = new Map<string, number[]>();

  /**
   * Tracks active concurrent in-flight requests.
   * Key: `${webContentsId}:${channel}`
   */
  private readonly activeConcurrency = new Map<string, number>();

  private buildKey(webContentsId: number, channel: IPCChannel): string {
    return `${webContentsId}:${channel}`;
  }

  /**
   * Evaluates if a request is permitted under the channel's 1-second sliding window rate limit.
   * If permitted, records the timestamp and returns true. If exceeded, returns false.
   */
  public checkRateLimit(
    webContentsId: number,
    channel: IPCChannel,
    now: number = Date.now(),
  ): boolean {
    const limits = CHANNEL_LIMITS[channel];
    if (!limits) {
      return false; // Fail-closed for unknown channels
    }

    const key = this.buildKey(webContentsId, channel);
    const windowStart = now - 1000;

    let timestamps = this.rateWindows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.rateWindows.set(key, timestamps);
    }

    // Prune timestamps older than 1 second
    const recentTimestamps = timestamps.filter(ts => ts > windowStart);

    if (recentTimestamps.length >= limits.maxRequestsPerSecond) {
      this.rateWindows.set(key, recentTimestamps);
      return false;
    }

    recentTimestamps.push(now);
    this.rateWindows.set(key, recentTimestamps);
    return true;
  }

  /**
   * Attempts to acquire a concurrency slot for an in-flight request.
   * Returns a lease with an idempotent release() function guaranteed to release exactly once.
   */
  public acquireConcurrency(webContentsId: number, channel: IPCChannel): ConcurrencyLease {
    const limits = CHANNEL_LIMITS[channel];
    if (!limits) {
      return { acquired: false, release: () => {} };
    }

    const key = this.buildKey(webContentsId, channel);
    const current = this.activeConcurrency.get(key) ?? 0;

    if (current >= limits.maxConcurrency) {
      return { acquired: false, release: () => {} };
    }

    this.activeConcurrency.set(key, current + 1);

    let released = false;
    const release = () => {
      if (released) {
        return; // Idempotent: guaranteed release exactly once
      }
      released = true;
      const count = this.activeConcurrency.get(key) ?? 0;
      if (count <= 1) {
        this.activeConcurrency.delete(key);
      } else {
        this.activeConcurrency.set(key, count - 1);
      }
    };

    return { acquired: true, release };
  }

  /**
   * Cleans up all rate-limiting and concurrency records for a given WebContents.
   * Called automatically when the WebContents is destroyed.
   */
  public cleanup(webContentsId: number): void {
    const prefix = `${webContentsId}:`;
    for (const key of this.rateWindows.keys()) {
      if (key.startsWith(prefix)) {
        this.rateWindows.delete(key);
      }
    }
    for (const key of this.activeConcurrency.keys()) {
      if (key.startsWith(prefix)) {
        this.activeConcurrency.delete(key);
      }
    }
  }

  /**
   * Clears all tracking state during dispatcher teardown.
   */
  public resetAll(): void {
    this.rateWindows.clear();
    this.activeConcurrency.clear();
  }
}
