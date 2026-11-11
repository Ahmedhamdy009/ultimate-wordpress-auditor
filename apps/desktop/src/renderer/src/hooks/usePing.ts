import { useState, useEffect, useRef, useCallback } from 'react';
import { IPC_ERROR_CODES, SAFE_IPC_ERROR_MESSAGES, type IPCSerializedError } from '@auditor/shared';

export interface UsePingOptions {
  readonly enabled?: boolean;
  readonly intervalMs?: number;
}

export interface UsePingReturn {
  readonly connected: boolean;
  readonly latencyMs: number | null;
  readonly lastPongTimestamp: number | null;
  readonly error: IPCSerializedError | null;
  readonly pinging: boolean;
  readonly pingNow: () => Promise<void>;
}

const BRIDGE_UNAVAILABLE_ERROR: Readonly<IPCSerializedError> = Object.freeze({
  code: IPC_ERROR_CODES.INTERNAL_ERROR,
  message: 'Electron IPC bridge (window.electronAPI) is not available',
});

const PING_FAILURE_ERROR: Readonly<IPCSerializedError> = Object.freeze({
  code: IPC_ERROR_CODES.INTERNAL_ERROR,
  message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR],
});

/**
 * Custom React hook for monitoring IPC connectivity and round-trip latency.
 *
 * Guarantees:
 * 1. Initial connectivity verification on mount.
 * 2. Accurate round-trip latency measurement using performance.now().
 * 3. Protection against overlapping requests: Skips tick if a ping is currently in-flight.
 * 4. Safe interval cleanup on unmount or when disabled.
 * 5. Strict unmount safety: Discards in-flight responses if unmounted.
 */
export function usePing(options: UsePingOptions = {}): UsePingReturn {
  const { enabled = true, intervalMs = 10000 } = options;

  const [connected, setConnected] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastPongTimestamp, setLastPongTimestamp] = useState<number | null>(null);
  const [error, setError] = useState<IPCSerializedError | null>(null);
  const [pinging, setPinging] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);
  const inFlightRef = useRef<boolean>(false);
  const pingIdRef = useRef<number>(0);

  const pingNow = useCallback(async (): Promise<void> => {
    // Overlapping request protection: avoid concurrent pings flooding IPC
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    const currentId = (pingIdRef.current += 1);

    if (isMountedRef.current) {
      setPinging(true);
    }

    if (typeof window === 'undefined' || !window.electronAPI?.ping) {
      inFlightRef.current = false;
      if (isMountedRef.current && currentId === pingIdRef.current) {
        setConnected(false);
        setLatencyMs(null);
        setError(BRIDGE_UNAVAILABLE_ERROR);
        setPinging(false);
      }
      return;
    }

    const start = performance.now();

    try {
      const result = await window.electronAPI.ping();
      const elapsed = Math.round(performance.now() - start);

      if (!isMountedRef.current || currentId !== pingIdRef.current) {
        return;
      }

      if (result.success && result.data.pong === true) {
        setConnected(true);
        setLatencyMs(elapsed);
        setLastPongTimestamp(result.data.serverTimestamp);
        setError(null);
      } else {
        setConnected(false);
        setLatencyMs(null);
        setError(result.success ? PING_FAILURE_ERROR : result.error);
      }
    } catch {
      if (!isMountedRef.current || currentId !== pingIdRef.current) {
        return;
      }
      setConnected(false);
      setLatencyMs(null);
      setError(PING_FAILURE_ERROR);
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current && currentId === pingIdRef.current) {
        setPinging(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      return () => {
        isMountedRef.current = false;
      };
    }

    // Run initial ping
    void pingNow();

    // Set bounded periodic heartbeat (minimum 1000ms to prevent excessive IPC traffic)
    const safeInterval = Math.max(intervalMs, 1000);
    const intervalTimer = setInterval(() => {
      // Pause periodic polling if window/document is hidden to prevent unnecessary wakeups
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      void pingNow();
    }, safeInterval);

    // Resume heartbeat immediately when returning from hidden state
    const handleVisibilityChange = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void pingNow();
      }
    };

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalTimer);
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [enabled, intervalMs, pingNow]);

  return {
    connected,
    latencyMs,
    lastPongTimestamp,
    error,
    pinging,
    pingNow,
  };
}
