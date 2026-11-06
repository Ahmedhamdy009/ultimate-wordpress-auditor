import { describe, it, expect } from 'vitest';
import { ChannelRateLimiter } from '../../src/main/ipc/limiter.js';
import { IPC_CHANNELS } from '@auditor/shared';

describe('ChannelRateLimiter & Concurrency Tracker', () => {
  it('enforces 30 requests/second limit on app:ping within a 1-second window', () => {
    const limiter = new ChannelRateLimiter();
    const webContentsId = 1;
    const channel = IPC_CHANNELS.APP_PING;
    const baseTime = 1_000_000;

    // First 30 requests within 1 second succeed
    for (let i = 0; i < 30; i++) {
      const allowed = limiter.checkRateLimit(webContentsId, channel, baseTime + i * 10);
      expect(allowed).toBe(true);
    }

    // 31st request at 500ms fails
    const blocked = limiter.checkRateLimit(webContentsId, channel, baseTime + 500);
    expect(blocked).toBe(false);

    // After 1000ms window expires, new requests are allowed
    const afterWindow = limiter.checkRateLimit(webContentsId, channel, baseTime + 1001);
    expect(afterWindow).toBe(true);
  });

  it('enforces 5 requests/second limit on app:get-system-info', () => {
    const limiter = new ChannelRateLimiter();
    const webContentsId = 1;
    const channel = IPC_CHANNELS.APP_GET_SYSTEM_INFO;
    const baseTime = 2_000_000;

    for (let i = 0; i < 5; i++) {
      expect(limiter.checkRateLimit(webContentsId, channel, baseTime + i * 20)).toBe(true);
    }

    expect(limiter.checkRateLimit(webContentsId, channel, baseTime + 200)).toBe(false);
  });

  it('guarantees channel isolation: saturating app:ping does not affect app:get-system-info', () => {
    const limiter = new ChannelRateLimiter();
    const webContentsId = 1;
    const baseTime = 3_000_000;

    // Saturate app:ping
    for (let i = 0; i < 30; i++) {
      limiter.checkRateLimit(webContentsId, IPC_CHANNELS.APP_PING, baseTime);
    }
    expect(limiter.checkRateLimit(webContentsId, IPC_CHANNELS.APP_PING, baseTime)).toBe(false);

    // app:get-system-info must remain completely unaffected
    expect(limiter.checkRateLimit(webContentsId, IPC_CHANNELS.APP_GET_SYSTEM_INFO, baseTime)).toBe(
      true,
    );
  });

  it('guarantees webContents isolation: saturating webContents 1 does not affect webContents 2', () => {
    const limiter = new ChannelRateLimiter();
    const baseTime = 4_000_000;

    for (let i = 0; i < 30; i++) {
      limiter.checkRateLimit(1, IPC_CHANNELS.APP_PING, baseTime);
    }
    expect(limiter.checkRateLimit(1, IPC_CHANNELS.APP_PING, baseTime)).toBe(false);

    // WebContents 2 has independent rate limits
    expect(limiter.checkRateLimit(2, IPC_CHANNELS.APP_PING, baseTime)).toBe(true);
  });

  it('enforces concurrency limits and guarantees exactly-once slot release', () => {
    const limiter = new ChannelRateLimiter();
    const webContentsId = 1;
    const channel = IPC_CHANNELS.APP_PING; // maxConcurrency = 5

    const leases = [];
    for (let i = 0; i < 5; i++) {
      const lease = limiter.acquireConcurrency(webContentsId, channel);
      expect(lease.acquired).toBe(true);
      leases.push(lease);
    }

    // 6th concurrent request is rejected
    const blockedLease = limiter.acquireConcurrency(webContentsId, channel);
    expect(blockedLease.acquired).toBe(false);

    // Release one slot
    leases[0].release();

    // Now a new slot can be acquired
    const newLease = limiter.acquireConcurrency(webContentsId, channel);
    expect(newLease.acquired).toBe(true);

    // Release multiple times on same lease (idempotence verification)
    leases[0].release();
    leases[0].release();

    // Cannot acquire extra slots beyond what was actually released
    const extraBlocked = limiter.acquireConcurrency(webContentsId, channel);
    expect(extraBlocked.acquired).toBe(false);
  });

  it('cleans up all records for a webContents on destruction', () => {
    const limiter = new ChannelRateLimiter();
    const baseTime = 5_000_000;

    limiter.checkRateLimit(1, IPC_CHANNELS.APP_PING, baseTime);
    const lease = limiter.acquireConcurrency(1, IPC_CHANNELS.APP_PING);
    expect(lease.acquired).toBe(true);

    limiter.cleanup(1);

    // After cleanup, concurrency tracking is reset
    const newLease = limiter.acquireConcurrency(1, IPC_CHANNELS.APP_PING);
    expect(newLease.acquired).toBe(true);
  });
});
