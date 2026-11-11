import { useState, useEffect, useRef, useCallback } from 'react';
import {
  IPC_ERROR_CODES,
  SAFE_IPC_ERROR_MESSAGES,
  type AppSystemInfoResponse,
  type IPCSerializedError,
} from '@auditor/shared';

export interface UseSystemInfoReturn {
  readonly systemInfo: AppSystemInfoResponse | null;
  readonly error: IPCSerializedError | null;
  readonly loading: boolean;
  readonly reload: () => void;
}

const BRIDGE_UNAVAILABLE_ERROR: Readonly<IPCSerializedError> = Object.freeze({
  code: IPC_ERROR_CODES.INTERNAL_ERROR,
  message: 'Electron IPC bridge (window.electronAPI) is not available',
});

const SYSTEM_INFO_FETCH_ERROR: Readonly<IPCSerializedError> = Object.freeze({
  code: IPC_ERROR_CODES.INTERNAL_ERROR,
  message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR],
});

/**
 * Custom React hook for retrieving approved runtime environment metadata from the Main process.
 *
 * Contract Integrity:
 * Uses ONLY the authentic fields returned by getSystemInfo:
 * - appVersion
 * - electronVersion
 * - chromeVersion
 * - nodeVersion
 * - platform
 * - arch
 *
 * Strictly does NOT invent or fabricate V8 version, storage paths, or storage confinement.
 */
export function useSystemInfo(): UseSystemInfoReturn {
  const [systemInfo, setSystemInfo] = useState<AppSystemInfoResponse | null>(null);
  const [error, setError] = useState<IPCSerializedError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const isMountedRef = useRef<boolean>(true);
  const requestIdRef = useRef<number>(0);

  const fetchSystemInfo = useCallback(async (): Promise<void> => {
    const currentId = (requestIdRef.current += 1);

    if (isMountedRef.current) {
      setLoading(true);
    }

    if (typeof window === 'undefined' || !window.electronAPI?.getSystemInfo) {
      if (isMountedRef.current && currentId === requestIdRef.current) {
        setSystemInfo(null);
        setError(BRIDGE_UNAVAILABLE_ERROR);
        setLoading(false);
      }
      return;
    }

    try {
      const result = await window.electronAPI.getSystemInfo();

      if (!isMountedRef.current || currentId !== requestIdRef.current) {
        return;
      }

      if (result.success) {
        setSystemInfo(result.data);
        setError(null);
      } else {
        setSystemInfo(null);
        setError(result.error);
      }
    } catch {
      if (!isMountedRef.current || currentId !== requestIdRef.current) {
        return;
      }
      setSystemInfo(null);
      setError(SYSTEM_INFO_FETCH_ERROR);
    } finally {
      if (isMountedRef.current && currentId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchSystemInfo();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchSystemInfo]);

  return {
    systemInfo,
    error,
    loading,
    reload: fetchSystemInfo,
  };
}
