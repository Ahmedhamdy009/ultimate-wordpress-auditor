import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  ScanRunDTO,
  CreateScanRunDTO,
  ListScanRunsQueryDTO,
  ScanProgressDTO,
  FindingDTO,
  ListFindingsQueryDTO,
  IPCSerializedError,
} from '@auditor/shared';
import type { ElectronAPI } from '../../../common/ipc/contracts.js';

export interface UseScansOptions {
  readonly pollIntervalMs?: number;
  readonly initialSiteId?: string;
  readonly autoLoad?: boolean;
  readonly initialScans?: readonly ScanRunDTO[];
  readonly initialActiveScan?: ScanRunDTO | null;
}

export interface UseScansReturn {
  readonly scans: readonly ScanRunDTO[];
  readonly activeScan: ScanRunDTO | null;
  readonly progress: ScanProgressDTO | null;
  readonly findings: readonly FindingDTO[];
  readonly totalFindings: number;
  readonly selectedScanId: string | null;
  readonly loading: boolean;
  readonly isScanning: boolean;
  readonly findingsLoading: boolean;
  readonly error: IPCSerializedError | null;
  readonly findingsError: IPCSerializedError | null;
  readonly loadScans: (query?: ListScanRunsQueryDTO) => Promise<void>;
  readonly createScan: (request: CreateScanRunDTO) => Promise<ScanRunDTO | null>;
  readonly cancelScan: (scanId: string) => Promise<boolean>;
  readonly selectScan: (scanId: string | null) => Promise<void>;
  readonly loadFindings: (scanId: string, query?: Partial<ListFindingsQueryDTO>) => Promise<void>;
  readonly clearFindings: () => void;
  readonly clearError: () => void;
  readonly clearFindingsError: () => void;
  readonly clearActiveScan: () => void;
  readonly refreshProgress: (scanId: string) => Promise<ScanProgressDTO | null>;
}

function getElectronAPI(): ElectronAPI | undefined {
  const g = globalThis as unknown as { electronAPI?: ElectronAPI };
  return (typeof window !== 'undefined' && window.electronAPI) || g.electronAPI;
}

const DEFAULT_POLL_INTERVAL_MS = 500;

export function useScans(options?: UseScansOptions): UseScansReturn {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const initialSiteId = options?.initialSiteId;
  const autoLoad = options?.autoLoad ?? true;

  const [scans, setScans] = useState<readonly ScanRunDTO[]>(options?.initialScans ?? []);
  const [activeScan, setActiveScan] = useState<ScanRunDTO | null>(
    options?.initialActiveScan ?? null,
  );
  const [progress, setProgress] = useState<ScanProgressDTO | null>(null);
  const [findings, setFindings] = useState<readonly FindingDTO[]>([]);
  const [totalFindings, setTotalFindings] = useState<number>(0);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [findingsLoading, setFindingsLoading] = useState<boolean>(false);
  const [error, setError] = useState<IPCSerializedError | null>(null);
  const [findingsError, setFindingsError] = useState<IPCSerializedError | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const loadRequestIdRef = useRef<number>(0);
  const findingsRequestIdRef = useRef<number>(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollingTimerRef.current !== null) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearFindingsError = useCallback(() => {
    setFindingsError(null);
  }, []);

  const clearActiveScan = useCallback(() => {
    if (pollingTimerRef.current !== null) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setActiveScan(null);
    setProgress(null);
  }, []);

  const clearFindings = useCallback(() => {
    setSelectedScanId(null);
    setFindings([]);
    setTotalFindings(0);
    setFindingsError(null);
  }, []);

  const loadScans = useCallback(
    async (query?: ListScanRunsQueryDTO) => {
      const api = getElectronAPI();
      if (!api) return;

      const currentId = ++loadRequestIdRef.current;
      setLoading(true);
      setError(null);

      try {
        const queryPayload: ListScanRunsQueryDTO =
          query ?? (initialSiteId ? { siteId: initialSiteId } : {});
        const res = await api.listScanRuns(queryPayload);

        if (!isMountedRef.current || currentId !== loadRequestIdRef.current) return;

        if (res.success) {
          setScans(res.data.items);
        } else {
          setError(res.error);
        }
      } catch {
        if (isMountedRef.current && currentId === loadRequestIdRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'An unexpected transport error occurred while loading scans.',
          });
        }
      } finally {
        if (isMountedRef.current && currentId === loadRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [initialSiteId],
  );

  useEffect(() => {
    if (autoLoad) {
      void loadScans();
    }
  }, [autoLoad, loadScans]);

  const loadFindings = useCallback(
    async (scanId: string, query?: Partial<ListFindingsQueryDTO>) => {
      const api = getElectronAPI();
      if (!api || !scanId) return;

      const currentId = ++findingsRequestIdRef.current;
      setFindingsLoading(true);

      try {
        const requestedLimit = query?.limit ?? 500;
        const clampedLimit = Math.max(1, Math.min(requestedLimit, 1000));
        const res = await api.listFindings({
          scanRunId: scanId,
          limit: clampedLimit,
          offset: query?.offset ?? 0,
          severity: query?.severity,
          category: query?.category,
          status: query?.status,
        });

        if (!isMountedRef.current || currentId !== findingsRequestIdRef.current) return;

        if (res.success) {
          setFindings(res.data.items);
          setTotalFindings(res.data.total);
          setSelectedScanId(scanId);
          setFindingsError(null);
        } else {
          setFindingsError(res.error);
        }
      } catch {
        if (isMountedRef.current && currentId === findingsRequestIdRef.current) {
          setFindingsError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'An unexpected transport error occurred while loading findings.',
          });
        }
      } finally {
        if (isMountedRef.current && currentId === findingsRequestIdRef.current) {
          setFindingsLoading(false);
        }
      }
    },
    [],
  );

  const selectScan = useCallback(
    async (scanId: string | null) => {
      if (!scanId) {
        clearFindings();
        return;
      }
      setSelectedScanId(scanId);
      await loadFindings(scanId);
    },
    [clearFindings, loadFindings],
  );

  const refreshProgress = useCallback(
    async (scanId: string): Promise<ScanProgressDTO | null> => {
      const api = getElectronAPI();
      if (!api || !scanId) return null;

      try {
        const res = await api.getScanProgress({ id: scanId });
        if (!isMountedRef.current) return null;

        if (res.success) {
          setProgress(res.data);

          // If the scan reached a terminal state, update active scan and refresh scans
          const isTerminal =
            res.data.status === 'completed' ||
            res.data.status === 'failed' ||
            res.data.status === 'cancelled';

          if (isTerminal) {
            setActiveScan(prev =>
              prev && prev.id === scanId ? { ...prev, status: res.data.status } : prev,
            );
            void loadScans();
          }

          return res.data;
        }
        return null;
      } catch {
        return null;
      }
    },
    [loadScans],
  );

  // Active scan progress polling effect
  useEffect(() => {
    if (!activeScan) {
      if (pollingTimerRef.current !== null) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      return;
    }

    const isTerminal =
      activeScan.status === 'completed' ||
      activeScan.status === 'failed' ||
      activeScan.status === 'cancelled';

    if (isTerminal) {
      if (pollingTimerRef.current !== null) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      return;
    }

    const currentScanId = activeScan.id;

    // Fetch initial progress immediately
    void refreshProgress(currentScanId);

    // Setup polling timer
    if (pollingTimerRef.current !== null) {
      clearInterval(pollingTimerRef.current);
    }

    pollingTimerRef.current = setInterval(() => {
      void refreshProgress(currentScanId);
    }, pollIntervalMs);

    return () => {
      if (pollingTimerRef.current !== null) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [activeScan?.id, activeScan?.status, pollIntervalMs, refreshProgress]);

  const createScan = useCallback(
    async (request: CreateScanRunDTO): Promise<ScanRunDTO | null> => {
      const api = getElectronAPI();
      if (!api) return null;

      setLoading(true);
      setError(null);

      try {
        const res = await api.createScanRun(request);
        if (!isMountedRef.current) return null;

        if (res.success) {
          setActiveScan(res.data);
          setProgress(null);
          await loadScans();
          return res.data;
        } else {
          setError(res.error);
          return null;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'An unexpected transport error occurred while creating scan run.',
          });
        }
        return null;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadScans],
  );

  const cancelScan = useCallback(
    async (scanId: string): Promise<boolean> => {
      const api = getElectronAPI();
      if (!api || !scanId) return false;

      setError(null);

      try {
        const res = await api.cancelScanRun({ id: scanId });
        if (!isMountedRef.current) return false;

        if (res.success) {
          if (activeScan?.id === scanId) {
            setActiveScan(res.data);
          }
          await refreshProgress(scanId);
          await loadScans();
          return true;
        } else {
          setError(res.error);
          return false;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'An unexpected transport error occurred while cancelling scan run.',
          });
        }
        return false;
      }
    },
    [activeScan?.id, loadScans, refreshProgress],
  );

  const isScanning = Boolean(
    activeScan && (activeScan.status === 'pending' || activeScan.status === 'running'),
  );

  return {
    scans,
    activeScan,
    progress,
    findings,
    totalFindings,
    selectedScanId,
    loading,
    isScanning,
    findingsLoading,
    error,
    findingsError,
    loadScans,
    createScan,
    cancelScan,
    selectScan,
    loadFindings,
    clearFindings,
    clearError,
    clearFindingsError,
    clearActiveScan,
    refreshProgress,
  };
}
