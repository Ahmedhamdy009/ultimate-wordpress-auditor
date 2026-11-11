import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  ReportDTO,
  CreateReportDTO,
  ListReportsQueryDTO,
  ReportContentDTO,
  IPCSerializedError,
} from '@auditor/shared';

export interface UseReportsReturn {
  readonly reports: readonly ReportDTO[];
  readonly loading: boolean;
  readonly error: IPCSerializedError | null;
  readonly loadReports: (query?: ListReportsQueryDTO) => Promise<void>;
  readonly createReport: (data: CreateReportDTO) => Promise<ReportDTO | null>;
  readonly deleteReport: (id: string) => Promise<boolean>;
  readonly getReportContent: (id: string) => Promise<ReportContentDTO | null>;
  readonly clearError: () => void;
}

function getElectronAPI() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (typeof window !== 'undefined' && window.electronAPI) || (globalThis as any).electronAPI;
}

export function useReports(initialQuery?: ListReportsQueryDTO): UseReportsReturn {
  const [reports, setReports] = useState<readonly ReportDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<IPCSerializedError | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const requestIdRef = useRef<number>(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const loadReports = useCallback(
    async (query?: ListReportsQueryDTO) => {
      const api = getElectronAPI();
      if (!api) return;
      const currentId = ++requestIdRef.current;
      setLoading(true);
      setError(null);

      try {
        const res = await api.listReports(query ?? initialQuery);

        if (!isMountedRef.current || currentId !== requestIdRef.current) return;

        if (res.success) {
          setReports(res.data.items);
        } else {
          setError(res.error);
        }
      } catch {
        if (isMountedRef.current && currentId === requestIdRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'An unexpected transport error occurred while loading reports.',
          });
        }
      } finally {
        if (isMountedRef.current && currentId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [initialQuery],
  );

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const createReport = useCallback(
    async (data: CreateReportDTO): Promise<ReportDTO | null> => {
      const api = getElectronAPI();
      if (!api) return null;
      setLoading(true);
      setError(null);

      try {
        const res = await api.createReport(data);
        if (!isMountedRef.current) return null;

        if (res.success) {
          await loadReports();
          return res.data;
        } else {
          setError(res.error);
          return null;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'An unexpected error occurred while generating report.',
          });
        }
        return null;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadReports],
  );

  const deleteReport = useCallback(
    async (id: string): Promise<boolean> => {
      const api = getElectronAPI();
      if (!api) return false;
      setLoading(true);
      setError(null);

      try {
        const res = await api.deleteReport({ id });
        if (!isMountedRef.current) return false;

        if (res.success) {
          await loadReports();
          return true;
        } else {
          setError(res.error);
          return false;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'An unexpected error occurred while deleting report.',
          });
        }
        return false;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadReports],
  );

  const getReportContent = useCallback(async (id: string): Promise<ReportContentDTO | null> => {
    const api = getElectronAPI();
    if (!api) return null;
    setError(null);

    try {
      const res = await api.getReportContent({ id });
      if (!isMountedRef.current) return null;

      if (res.success) {
        return res.data;
      } else {
        setError(res.error);
        return null;
      }
    } catch {
      if (isMountedRef.current) {
        setError({
          code: 'ERR_INTERNAL_ERROR',
          message: 'An unexpected error occurred while reading report content.',
        });
      }
      return null;
    }
  }, []);

  return {
    reports,
    loading,
    error,
    loadReports,
    createReport,
    deleteReport,
    getReportContent,
    clearError,
  };
}
