import { useState, useCallback, useEffect, useRef } from 'react';
import type { SiteDTO, CreateSiteDTO, UpdateSiteDTO, IPCSerializedError } from '@auditor/shared';

export interface UseSitesReturn {
  readonly sites: readonly SiteDTO[];
  readonly loading: boolean;
  readonly error: IPCSerializedError | null;
  readonly includeArchived: boolean;
  readonly setIncludeArchived: (include: boolean) => void;
  readonly loadSites: (projectId: string) => Promise<void>;
  readonly createSite: (data: CreateSiteDTO) => Promise<SiteDTO | null>;
  readonly updateSite: (data: UpdateSiteDTO) => Promise<SiteDTO | null>;
  readonly archiveSite: (id: string) => Promise<boolean>;
  readonly restoreSite: (id: string) => Promise<boolean>;
  readonly clearError: () => void;
}

export function useSites(projectId?: string): UseSitesReturn {
  const [sites, setSites] = useState<readonly SiteDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<IPCSerializedError | null>(null);
  const [includeArchived, setIncludeArchived] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);
  const requestIdRef = useRef<number>(0);
  const activeProjectIdRef = useRef<string | undefined>(projectId);
  activeProjectIdRef.current = projectId;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const loadSites = useCallback(
    async (targetProjectId: string) => {
      if (!window.electronAPI || !targetProjectId) return;
      const currentId = ++requestIdRef.current;
      setLoading(true);
      setError(null);

      try {
        const res = await window.electronAPI.listSites({
          projectId: targetProjectId,
          includeArchived,
        });

        if (!isMountedRef.current || currentId !== requestIdRef.current) return;

        if (res.success) {
          setSites(res.data.items);
        } else {
          setError(res.error);
        }
      } catch {
        if (isMountedRef.current && currentId === requestIdRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'An unexpected transport error occurred.',
          });
        }
      } finally {
        if (isMountedRef.current && currentId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [includeArchived],
  );

  useEffect(() => {
    if (projectId) {
      void loadSites(projectId);
    } else {
      setSites([]);
    }
  }, [projectId, loadSites]);

  const createSite = useCallback(
    async (data: CreateSiteDTO): Promise<SiteDTO | null> => {
      if (!window.electronAPI) return null;
      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.createSite(data);
        if (!isMountedRef.current) return null;
        if (res.success) {
          if (activeProjectIdRef.current) {
            await loadSites(activeProjectIdRef.current);
          }
          return res.data;
        } else {
          setError(res.error);
          return null;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'Failed to create site.',
          });
        }
        return null;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadSites],
  );

  const updateSite = useCallback(
    async (data: UpdateSiteDTO): Promise<SiteDTO | null> => {
      if (!window.electronAPI) return null;
      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.updateSite(data);
        if (!isMountedRef.current) return null;
        if (res.success) {
          if (activeProjectIdRef.current) {
            await loadSites(activeProjectIdRef.current);
          }
          return res.data;
        } else {
          setError(res.error);
          return null;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'Failed to update site.',
          });
        }
        return null;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadSites],
  );

  const archiveSite = useCallback(
    async (id: string): Promise<boolean> => {
      if (!window.electronAPI) return false;
      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.archiveSite({ id });
        if (!isMountedRef.current) return false;
        if (res.success) {
          if (activeProjectIdRef.current) {
            await loadSites(activeProjectIdRef.current);
          }
          return true;
        } else {
          setError(res.error);
          return false;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'Failed to archive site.',
          });
        }
        return false;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadSites],
  );

  const restoreSite = useCallback(
    async (id: string): Promise<boolean> => {
      if (!window.electronAPI) return false;
      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.restoreSite({ id });
        if (!isMountedRef.current) return false;
        if (res.success) {
          if (activeProjectIdRef.current) {
            await loadSites(activeProjectIdRef.current);
          }
          return true;
        } else {
          setError(res.error);
          return false;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'Failed to restore site.',
          });
        }
        return false;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadSites],
  );

  return {
    sites,
    loading,
    error,
    includeArchived,
    setIncludeArchived,
    loadSites,
    createSite,
    updateSite,
    archiveSite,
    restoreSite,
    clearError,
  };
}
