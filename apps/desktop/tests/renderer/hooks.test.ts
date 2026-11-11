import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderTestHook } from '../helpers/react-test-harness.js';
import { useIpcCall } from '../../src/renderer/src/hooks/useIpcCall.js';
import { useSystemInfo } from '../../src/renderer/src/hooks/useSystemInfo.js';
import { usePing } from '../../src/renderer/src/hooks/usePing.js';
import {
  useTargetValidator,
  DEBOUNCE_CANCELLED_RESULT,
} from '../../src/renderer/src/hooks/useTargetValidator.js';
import {
  IPC_ERROR_CODES,
  SAFE_IPC_ERROR_MESSAGES,
  type IPCResult,
  type AppSystemInfoResponse,
  type AuditValidateTargetResponse,
} from '@auditor/shared';

describe('Phase 1.2.5.1 — Typed React IPC Hooks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).electronAPI;
  });

  describe('useIpcCall', () => {
    it('initializes with loading: false, data: null, error: null', async () => {
      const mockIpc = vi.fn();
      const harness = await renderTestHook(() => useIpcCall(mockIpc));
      await harness.mount();

      expect(harness.result.current.loading).toBe(false);
      expect(harness.result.current.data).toBe(null);
      expect(harness.result.current.error).toBe(null);

      await harness.unmount();
    });

    it('handles successful IPCResult transitions', async () => {
      const mockResponse: IPCResult<string> = { success: true, data: 'audit-result-123' };
      const mockIpc = vi.fn().mockResolvedValue(mockResponse);

      const harness = await renderTestHook(() => useIpcCall(mockIpc));
      await harness.mount();

      await harness.act(async () => {
        await harness.result.current.execute('test-req');
      });

      expect(harness.result.current.loading).toBe(false);
      expect(harness.result.current.data).toBe('audit-result-123');
      expect(harness.result.current.error).toBe(null);

      await harness.unmount();
    });

    it('handles application-level IPC error envelopes (success: false)', async () => {
      const mockErrorResponse: IPCResult<string> = {
        success: false,
        error: {
          code: IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
          message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED],
        },
      };
      const mockIpc = vi.fn().mockResolvedValue(mockErrorResponse);

      const harness = await renderTestHook(() => useIpcCall(mockIpc));
      await harness.mount();

      await harness.act(async () => {
        await harness.result.current.execute('invalid-req');
      });

      expect(harness.result.current.loading).toBe(false);
      expect(harness.result.current.data).toBe(null);
      expect(harness.result.current.error?.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);

      await harness.unmount();
    });

    it('safely catches thrown transport failures without crashing', async () => {
      const mockIpc = vi.fn().mockRejectedValue(new Error('Channel disconnected'));

      const harness = await renderTestHook(() => useIpcCall(mockIpc));
      await harness.mount();

      await harness.act(async () => {
        await harness.result.current.execute('req');
      });

      expect(harness.result.current.loading).toBe(false);
      expect(harness.result.current.data).toBe(null);
      expect(harness.result.current.error?.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);

      await harness.unmount();
    });

    it('guarantees unmount safety: does not update state if unmounted during in-flight call', async () => {
      let resolvePromise!: (val: IPCResult<string>) => void;
      const inFlightPromise = new Promise<IPCResult<string>>(resolve => {
        resolvePromise = resolve;
      });
      const mockIpc = vi.fn().mockReturnValue(inFlightPromise);

      const harness = await renderTestHook(() => useIpcCall(mockIpc));
      await harness.mount();

      let executePromise!: Promise<unknown>;
      await harness.act(async () => {
        executePromise = harness.result.current.execute('test');
      });

      // Unmount while request is still pending in Main
      await harness.unmount();

      // Resolve the background IPC call
      await harness.act(async () => {
        resolvePromise({ success: true, data: 'resolved-after-unmount' });
        await executePromise;
      });

      // Verified: state was not updated post-unmount
      expect(harness.result.current.data).toBe(null);
    });

    it('guarantees stale response protection: discards out-of-order previous responses', async () => {
      let resolveFirst!: (val: IPCResult<string>) => void;
      let resolveSecond!: (val: IPCResult<string>) => void;

      const firstPromise = new Promise<IPCResult<string>>(resolve => {
        resolveFirst = resolve;
      });
      const secondPromise = new Promise<IPCResult<string>>(resolve => {
        resolveSecond = resolve;
      });

      const mockIpc = vi
        .fn()
        .mockImplementationOnce(() => firstPromise)
        .mockImplementationOnce(() => secondPromise);

      const harness = await renderTestHook(() => useIpcCall(mockIpc));
      await harness.mount();

      let p1!: Promise<unknown>;
      let p2!: Promise<unknown>;

      // Request 1 starts
      await harness.act(async () => {
        p1 = harness.result.current.execute('req-1');
      });

      // Request 2 starts immediately after
      await harness.act(async () => {
        p2 = harness.result.current.execute('req-2');
      });

      // Request 2 finishes FIRST
      await harness.act(async () => {
        resolveSecond({ success: true, data: 'response-2' });
        await p2;
      });

      expect(harness.result.current.data).toBe('response-2');

      // Request 1 finishes LATER (stale)
      await harness.act(async () => {
        resolveFirst({ success: true, data: 'stale-response-1' });
        await p1;
      });

      // Must NOT be overwritten by the stale earlier response!
      expect(harness.result.current.data).toBe('response-2');

      await harness.unmount();
    });

    it('reset() invalidates pending requests and clears state', async () => {
      let resolvePending!: (val: IPCResult<string>) => void;
      const pendingPromise = new Promise<IPCResult<string>>(resolve => {
        resolvePending = resolve;
      });
      const mockIpc = vi.fn().mockReturnValue(pendingPromise);

      const harness = await renderTestHook(() => useIpcCall(mockIpc));
      await harness.mount();

      let execPromise!: Promise<unknown>;
      await harness.act(async () => {
        execPromise = harness.result.current.execute('req');
      });

      await harness.act(async () => {
        harness.result.current.reset();
      });

      expect(harness.result.current.loading).toBe(false);
      expect(harness.result.current.data).toBe(null);

      // Now resolve late
      await harness.act(async () => {
        resolvePending({ success: true, data: 'late-data' });
        await execPromise;
      });

      // Remains null because reset() invalidated it
      expect(harness.result.current.data).toBe(null);

      await harness.unmount();
    });

    it('preserves execute referential stability across renders while invoking latest callback', async () => {
      const firstIpc = vi.fn().mockResolvedValue({ success: true, data: 'first' });
      const secondIpc = vi.fn().mockResolvedValue({ success: true, data: 'second' });

      let currentFn = firstIpc;
      const harness = await renderTestHook(() => useIpcCall(currentFn));
      await harness.mount();

      const initialExecute = harness.result.current.execute;

      // Mutate callback and trigger component rerender
      currentFn = secondIpc;
      await harness.rerender();

      // Referential stability: execute function identity must NOT change
      expect(harness.result.current.execute).toBe(initialExecute);

      // Invocations route to latest callback without stale closure
      await harness.act(async () => {
        await harness.result.current.execute('test');
      });

      expect(secondIpc).toHaveBeenCalledTimes(1);
      expect(firstIpc).not.toHaveBeenCalled();
      expect(harness.result.current.data).toBe('second');

      await harness.unmount();
    });
  });

  describe('useSystemInfo', () => {
    it('retrieves system metadata on mount via window.electronAPI.getSystemInfo', async () => {
      const mockData: AppSystemInfoResponse = {
        appVersion: '0.1.0',
        electronVersion: '44.10.2',
        chromeVersion: '130.0.6723.137',
        nodeVersion: '22.11.0',
        platform: 'win32',
        arch: 'x64',
      };

      const getSystemInfoMock = vi.fn().mockResolvedValue({ success: true, data: mockData });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = {
        getSystemInfo: getSystemInfoMock,
      };

      const harness = await renderTestHook(() => useSystemInfo());
      await harness.mount();

      expect(harness.result.current.loading).toBe(false);
      expect(harness.result.current.systemInfo).toEqual(mockData);
      expect(harness.result.current.error).toBe(null);
      expect(getSystemInfoMock).toHaveBeenCalledTimes(1);

      await harness.unmount();
    });

    it('gracefully handles missing electronAPI bridge with safe error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).electronAPI;

      const harness = await renderTestHook(() => useSystemInfo());
      await harness.mount();

      expect(harness.result.current.loading).toBe(false);
      expect(harness.result.current.systemInfo).toBe(null);
      expect(harness.result.current.error?.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
      expect(harness.result.current.error?.message).toContain('not available');

      await harness.unmount();
    });

    it('reload() refetches system info', async () => {
      const mockData: AppSystemInfoResponse = {
        appVersion: '0.1.0',
        electronVersion: '44.10.2',
        chromeVersion: '130.0.6723.137',
        nodeVersion: '22.11.0',
        platform: 'win32',
        arch: 'x64',
      };

      const getSystemInfoMock = vi.fn().mockResolvedValue({ success: true, data: mockData });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = {
        getSystemInfo: getSystemInfoMock,
      };

      const harness = await renderTestHook(() => useSystemInfo());
      await harness.mount();

      expect(getSystemInfoMock).toHaveBeenCalledTimes(1);

      await harness.act(async () => {
        harness.result.current.reload();
      });

      expect(getSystemInfoMock).toHaveBeenCalledTimes(2);

      await harness.unmount();
    });
  });

  describe('usePing', () => {
    it('performs initial ping on mount and measures round-trip latency', async () => {
      const pingMock = vi.fn().mockResolvedValue({
        success: true,
        data: { pong: true, serverTimestamp: 1700000000 },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = { ping: pingMock };

      const harness = await renderTestHook(() => usePing({ enabled: true, intervalMs: 5000 }));
      await harness.mount();

      expect(harness.result.current.connected).toBe(true);
      expect(harness.result.current.lastPongTimestamp).toBe(1700000000);
      expect(typeof harness.result.current.latencyMs).toBe('number');
      expect(harness.result.current.error).toBe(null);
      expect(pingMock).toHaveBeenCalledTimes(1);

      await harness.unmount();
    });

    it('clears interval timer on unmount', async () => {
      vi.useFakeTimers();
      try {
        const pingMock = vi.fn().mockResolvedValue({
          success: true,
          data: { pong: true, serverTimestamp: 1000 },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).electronAPI = { ping: pingMock };

        const harness = await renderTestHook(() => usePing({ enabled: true, intervalMs: 2000 }));
        await harness.mount();

        expect(pingMock).toHaveBeenCalledTimes(1);

        // Advance time by 2000ms
        await harness.act(async () => {
          vi.advanceTimersByTime(2000);
        });
        expect(pingMock).toHaveBeenCalledTimes(2);

        // Unmount
        await harness.unmount();

        // Advance time further — no new calls should happen
        await harness.act(async () => {
          vi.advanceTimersByTime(4000);
        });
        expect(pingMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('protects against overlapping ping calls when in-flight', async () => {
      vi.useFakeTimers();
      try {
        let resolvePing!: (val: unknown) => void;
        const slowPingPromise = new Promise(resolve => {
          resolvePing = resolve;
        });
        const pingMock = vi.fn().mockReturnValue(slowPingPromise);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).electronAPI = { ping: pingMock };

        const harness = await renderTestHook(() => usePing({ enabled: true, intervalMs: 2000 }));
        await harness.mount();

        expect(pingMock).toHaveBeenCalledTimes(1);

        // Interval fires while first ping is still in flight
        await harness.act(async () => {
          vi.advanceTimersByTime(2000);
        });

        // Overlapping ping must be skipped
        expect(pingMock).toHaveBeenCalledTimes(1);

        // Resolve first ping
        await harness.act(async () => {
          resolvePing({ success: true, data: { pong: true, serverTimestamp: 1000 } });
        });

        // Next interval fires after resolution
        await harness.act(async () => {
          vi.advanceTimersByTime(2000);
        });

        expect(pingMock).toHaveBeenCalledTimes(2);

        await harness.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('handles ping failure and marks disconnected', async () => {
      const pingMock = vi.fn().mockResolvedValue({
        success: false,
        error: { code: IPC_ERROR_CODES.INTERNAL_ERROR, message: 'Dispatcher error' },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = { ping: pingMock };

      const harness = await renderTestHook(() => usePing({ enabled: true }));
      await harness.mount();

      expect(harness.result.current.connected).toBe(false);
      expect(harness.result.current.latencyMs).toBe(null);
      expect(harness.result.current.error?.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);

      await harness.unmount();
    });

    it('pauses periodic pings when document is hidden and resumes immediately when visible', async () => {
      vi.useFakeTimers();
      try {
        const pingMock = vi.fn().mockResolvedValue({
          success: true,
          data: { pong: true, serverTimestamp: 2000 },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).electronAPI = { ping: pingMock };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (document as any).visibilityState = 'visible';

        const harness = await renderTestHook(() => usePing({ enabled: true, intervalMs: 2000 }));
        await harness.mount();

        // 1 initial ping on mount
        expect(pingMock).toHaveBeenCalledTimes(1);

        // Hide the window
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (document as any).visibilityState = 'hidden';

        // Advance timers by 4000ms while hidden
        await harness.act(async () => {
          vi.advanceTimersByTime(4000);
        });

        // Periodic ticks skipped while hidden
        expect(pingMock).toHaveBeenCalledTimes(1);

        // Restore visibility
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (document as any).visibilityState = 'visible';
        await harness.act(async () => {
          document.dispatchEvent({ type: 'visibilitychange' });
        });

        // Immediate ping triggered on visibility restoration
        expect(pingMock).toHaveBeenCalledTimes(2);

        await harness.unmount();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('useTargetValidator', () => {
    it('strictly preserves semantic distinction between valid and inScope', async () => {
      // 1. Valid syntax, but OUT OF SCOPE
      const outOfScopeResponse: AuditValidateTargetResponse = {
        valid: true,
        normalizedUrl: 'https://unauthorized-domain.com/',
        inScope: false,
      };

      const validateMock = vi.fn().mockResolvedValue({
        success: true,
        data: outOfScopeResponse,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = { validateTarget: validateMock };

      const harness = await renderTestHook(() => useTargetValidator());
      await harness.mount();

      await harness.act(async () => {
        await harness.result.current.validate('https://unauthorized-domain.com', [
          'https://example.com',
        ]);
      });

      expect(harness.result.current.isValid).toBe(true);
      expect(harness.result.current.isInScope).toBe(false);
      expect(harness.result.current.normalizedUrl).toBe('https://unauthorized-domain.com/');

      // 2. Invalid syntax
      const invalidSyntaxResponse: AuditValidateTargetResponse = {
        valid: false,
        error: 'ERR_INVALID_PORT',
      };
      validateMock.mockResolvedValueOnce({ success: true, data: invalidSyntaxResponse });

      await harness.act(async () => {
        await harness.result.current.validate('https://example.com:99999');
      });

      expect(harness.result.current.isValid).toBe(false);
      expect(harness.result.current.isInScope).toBe(null);
      expect(harness.result.current.validationError).toBe('ERR_INVALID_PORT');

      // 3. Valid AND in scope
      const inScopeResponse: AuditValidateTargetResponse = {
        valid: true,
        normalizedUrl: 'https://example.com/',
        inScope: true,
      };
      validateMock.mockResolvedValueOnce({ success: true, data: inScopeResponse });

      await harness.act(async () => {
        await harness.result.current.validate('https://example.com', ['https://example.com']);
      });

      expect(harness.result.current.isValid).toBe(true);
      expect(harness.result.current.isInScope).toBe(true);

      await harness.unmount();
    });

    it('discards stale response when user types multiple targets rapidly', async () => {
      let resolveFirst!: (val: unknown) => void;
      let resolveSecond!: (val: unknown) => void;

      const firstPromise = new Promise(resolve => {
        resolveFirst = resolve;
      });
      const secondPromise = new Promise(resolve => {
        resolveSecond = resolve;
      });

      const validateMock = vi
        .fn()
        .mockImplementationOnce(() => firstPromise)
        .mockImplementationOnce(() => secondPromise);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = { validateTarget: validateMock };

      const harness = await renderTestHook(() => useTargetValidator());
      await harness.mount();

      let p1!: Promise<unknown>;
      let p2!: Promise<unknown>;

      // Trigger first query
      await harness.act(async () => {
        p1 = harness.result.current.validate('https://query1.com');
      });

      // Trigger second query immediately
      await harness.act(async () => {
        p2 = harness.result.current.validate('https://query2.com');
      });

      // Second query completes first
      await harness.act(async () => {
        resolveSecond({
          success: true,
          data: { valid: true, normalizedUrl: 'https://query2.com/', inScope: true },
        });
        await p2;
      });

      expect(harness.result.current.normalizedUrl).toBe('https://query2.com/');

      // First query completes late
      await harness.act(async () => {
        resolveFirst({
          success: true,
          data: { valid: true, normalizedUrl: 'https://query1.com/', inScope: false },
        });
        await p1;
      });

      // Must remain query2!
      expect(harness.result.current.normalizedUrl).toBe('https://query2.com/');

      await harness.unmount();
    });

    it('resets state without IPC dispatch on empty or whitespace target', async () => {
      const validateMock = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = { validateTarget: validateMock };

      const harness = await renderTestHook(() => useTargetValidator());
      await harness.mount();

      await harness.act(async () => {
        const res = await harness.result.current.validate('   ');
        expect(res).toBe(null);
      });

      expect(validateMock).not.toHaveBeenCalled();
      expect(harness.result.current.isValid).toBe(null);
      expect(harness.result.current.result).toBe(null);

      await harness.unmount();
    });

    it('respects debounceMs option', async () => {
      vi.useFakeTimers();
      try {
        const validateMock = vi.fn().mockResolvedValue({
          success: true,
          data: { valid: true, normalizedUrl: 'https://debounced.com/' },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).electronAPI = { validateTarget: validateMock };

        const harness = await renderTestHook(() => useTargetValidator({ debounceMs: 300 }));
        await harness.mount();

        let valPromise!: Promise<unknown>;
        await harness.act(async () => {
          valPromise = harness.result.current.validate('https://debounced.com');
        });

        // Before 300ms: not yet called
        expect(validateMock).not.toHaveBeenCalled();

        // Advance by 300ms
        await harness.act(async () => {
          vi.advanceTimersByTime(300);
          await valPromise;
        });

        expect(validateMock).toHaveBeenCalledTimes(1);

        await harness.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('resolves superseded debounced calls with DEBOUNCE_CANCELLED_RESULT', async () => {
      vi.useFakeTimers();
      try {
        const validateMock = vi.fn().mockResolvedValue({
          success: true,
          data: { valid: true, normalizedUrl: 'https://final.com/' },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).electronAPI = { validateTarget: validateMock };

        const harness = await renderTestHook(() => useTargetValidator({ debounceMs: 300 }));
        await harness.mount();

        let promise1!: Promise<unknown>;
        let promise2!: Promise<unknown>;

        await harness.act(async () => {
          promise1 = harness.result.current.validate('https://first.com');
        });

        // Advance 100ms (less than 300ms)
        vi.advanceTimersByTime(100);

        // Dispatch second validation call before first timer expires
        await harness.act(async () => {
          promise2 = harness.result.current.validate('https://second.com');
        });

        // First promise was superseded and resolved with DEBOUNCE_CANCELLED_RESULT
        const res1 = await promise1;
        expect(res1).toEqual(DEBOUNCE_CANCELLED_RESULT);

        // Advance 300ms to allow second call to execute
        await harness.act(async () => {
          vi.advanceTimersByTime(300);
          await promise2;
        });

        expect(validateMock).toHaveBeenCalledTimes(1);
        expect(harness.result.current.isValid).toBe(true);

        await harness.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('resolves pending debounced calls with DEBOUNCE_CANCELLED_RESULT on unmount', async () => {
      vi.useFakeTimers();
      try {
        const validateMock = vi.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).electronAPI = { validateTarget: validateMock };

        const harness = await renderTestHook(() => useTargetValidator({ debounceMs: 300 }));
        await harness.mount();

        let promise!: Promise<unknown>;
        await harness.act(async () => {
          promise = harness.result.current.validate('https://unmount-test.com');
        });

        // Unmount while debounce timer is still pending
        await harness.unmount();

        // The pending promise must settle with DEBOUNCE_CANCELLED_RESULT rather than hanging
        const res = await promise;
        expect(res).toEqual(DEBOUNCE_CANCELLED_RESULT);
        expect(validateMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
