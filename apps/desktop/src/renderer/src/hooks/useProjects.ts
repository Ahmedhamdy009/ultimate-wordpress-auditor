import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  ProjectDTO,
  CreateProjectDTO,
  UpdateProjectDTO,
  IPCSerializedError,
} from '@auditor/shared';

export interface UseProjectsReturn {
  readonly projects: readonly ProjectDTO[];
  readonly loading: boolean;
  readonly error: IPCSerializedError | null;
  readonly includeArchived: boolean;
  readonly setIncludeArchived: (include: boolean) => void;
  readonly searchQuery: string;
  readonly setSearchQuery: (query: string) => void;
  readonly loadProjects: () => Promise<void>;
  readonly createProject: (data: CreateProjectDTO) => Promise<ProjectDTO | null>;
  readonly updateProject: (data: UpdateProjectDTO) => Promise<ProjectDTO | null>;
  readonly archiveProject: (id: string) => Promise<boolean>;
  readonly restoreProject: (id: string) => Promise<boolean>;
  readonly clearError: () => void;
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<readonly ProjectDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<IPCSerializedError | null>(null);
  const [includeArchived, setIncludeArchived] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

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

  const loadProjects = useCallback(async () => {
    if (!window.electronAPI) return;
    const currentId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const res = await window.electronAPI.listProjects({
        includeArchived,
        search: searchQuery.trim() || undefined,
      });

      if (!isMountedRef.current || currentId !== requestIdRef.current) return;

      if (res.success) {
        setProjects(res.data.items);
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
  }, [includeArchived, searchQuery]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const createProject = useCallback(
    async (data: CreateProjectDTO): Promise<ProjectDTO | null> => {
      if (!window.electronAPI) return null;
      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.createProject(data);
        if (!isMountedRef.current) return null;
        if (res.success) {
          await loadProjects();
          return res.data;
        } else {
          setError(res.error);
          return null;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'Failed to create project.',
          });
        }
        return null;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadProjects],
  );

  const updateProject = useCallback(
    async (data: UpdateProjectDTO): Promise<ProjectDTO | null> => {
      if (!window.electronAPI) return null;
      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.updateProject(data);
        if (!isMountedRef.current) return null;
        if (res.success) {
          await loadProjects();
          return res.data;
        } else {
          setError(res.error);
          return null;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'Failed to update project.',
          });
        }
        return null;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadProjects],
  );

  const archiveProject = useCallback(
    async (id: string): Promise<boolean> => {
      if (!window.electronAPI) return false;
      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.archiveProject({ id });
        if (!isMountedRef.current) return false;
        if (res.success) {
          await loadProjects();
          return true;
        } else {
          setError(res.error);
          return false;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'Failed to archive project.',
          });
        }
        return false;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadProjects],
  );

  const restoreProject = useCallback(
    async (id: string): Promise<boolean> => {
      if (!window.electronAPI) return false;
      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.restoreProject({ id });
        if (!isMountedRef.current) return false;
        if (res.success) {
          await loadProjects();
          return true;
        } else {
          setError(res.error);
          return false;
        }
      } catch {
        if (isMountedRef.current) {
          setError({
            code: 'ERR_INTERNAL_ERROR',
            message: 'Failed to restore project.',
          });
        }
        return false;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [loadProjects],
  );

  return {
    projects,
    loading,
    error,
    includeArchived,
    setIncludeArchived,
    searchQuery,
    setSearchQuery,
    loadProjects,
    createProject,
    updateProject,
    archiveProject,
    restoreProject,
    clearError,
  };
}
