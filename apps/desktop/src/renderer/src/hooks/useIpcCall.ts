import { useState, useRef, useEffect, useCallback } from 'react';
import {
  IPC_ERROR_CODES,
  SAFE_IPC_ERROR_MESSAGES,
  type IPCResult,
  type IPCSerializedError,
} from '@auditor/shared';

export interface UseIpcCallState<TRes> {
  readonly data: TRes | null;
  readonly error: IPCSerializedError | null;
  readonly loading: boolean;
}

export interface UseIpcCallReturn<TReq, TRes> extends UseIpcCallState<TRes> {
  readonly execute: (request: TReq) => Promise<IPCResult<TRes> | null>;
  readonly reset: () => void;
}

const FALLBACK_DISPATCH_ERROR: Readonly<IPCSerializedError> = Object.freeze({
  code: IPC_ERROR_CODES.INTERNAL_ERROR,
  message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR],
});

/**
 * Generic hardened hook for invoking asynchronous IPC contracts from the Renderer.
 *
 * Lifecycle & Concurrency Guarantees:
 * 1. Unmount Protection: Prevents React state updates after component unmount.
 *    (Note: The underlying Electron IPC request runs to completion in Main; no fake cancellation).
 * 2. Stale Response Protection: Tracks monotonic request IDs so out-of-order or late
 *    responses from previous invocations are strictly discarded.
 * 3. Transport Failure Handling: Gracefully catches rejected promises or missing ElectronAPI
 *    bridges and maps them to a safe IPCSerializedError without exposing raw exception stacks.
 * 4. IPCResult Disambiguation: Properly extracts data on success: true and error on success: false.
 */
export function useIpcCall<TReq, TRes>(
  ipcFn: (request: TReq) => Promise<IPCResult<TRes>>,
): UseIpcCallReturn<TReq, TRes> {
  const [state, setState] = useState<UseIpcCallState<TRes>>({
    data: null,
    error: null,
    loading: false,
  });

  const isMountedRef = useRef<boolean>(true);
  const activeRequestIdRef = useRef<number>(0);
  const ipcFnRef = useRef(ipcFn);
  ipcFnRef.current = ipcFn;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const reset = useCallback((): void => {
    // Invalidate any currently pending request so its response will be discarded
    activeRequestIdRef.current += 1;
    if (isMountedRef.current) {
      setState({
        data: null,
        error: null,
        loading: false,
      });
    }
  }, []);

  const execute = useCallback(async (request: TReq): Promise<IPCResult<TRes> | null> => {
    const requestId = (activeRequestIdRef.current += 1);

    if (isMountedRef.current) {
      setState(prev => ({ ...prev, loading: true }));
    }

    try {
      const result = await ipcFnRef.current(request);

      // Discard stale responses if a newer request was issued or component unmounted
      if (!isMountedRef.current || requestId !== activeRequestIdRef.current) {
        return null;
      }

      if (result.success) {
        setState({
          data: result.data,
          error: null,
          loading: false,
        });
      } else {
        setState({
          data: null,
          error: result.error,
          loading: false,
        });
      }

      return result;
    } catch {
      // Discard if stale or unmounted
      if (!isMountedRef.current || requestId !== activeRequestIdRef.current) {
        return null;
      }

      const safeErrorResult: IPCResult<TRes> = {
        success: false,
        error: FALLBACK_DISPATCH_ERROR,
      };

      setState({
        data: null,
        error: FALLBACK_DISPATCH_ERROR,
        loading: false,
      });

      return safeErrorResult;
    }
  }, []);

  return {
    ...state,
    execute,
    reset,
  };
}
