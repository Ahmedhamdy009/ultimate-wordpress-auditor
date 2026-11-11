import {
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  IPCError,
  type ArchiveProjectResultDTO,
  type ProjectDTO,
  type ProjectListResponseDTO,
  type SiteDTO,
  type SiteListResponseDTO,
} from '@auditor/shared';
import type { IpcChannelHandler, SecureIpcDispatcher } from './dispatcher.js';
import type { IProjectService } from '../services/project.service.js';
import type { ISiteService } from '../services/site.service.js';

// --- Project Handler Factories ---

export function createProjectCreateHandler(
  service: IProjectService,
): IpcChannelHandler<typeof IPC_CHANNELS.PROJECT_CREATE> {
  return async (request, context): Promise<ProjectDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.createProject(request);
  };
}

export function createProjectGetHandler(
  service: IProjectService,
): IpcChannelHandler<typeof IPC_CHANNELS.PROJECT_GET> {
  return async (request, context): Promise<ProjectDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.getProjectById(request);
  };
}

export function createProjectListHandler(
  service: IProjectService,
): IpcChannelHandler<typeof IPC_CHANNELS.PROJECT_LIST> {
  return async (request, context): Promise<ProjectListResponseDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.listProjects(request);
  };
}

export function createProjectUpdateHandler(
  service: IProjectService,
): IpcChannelHandler<typeof IPC_CHANNELS.PROJECT_UPDATE> {
  return async (request, context): Promise<ProjectDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.updateProject(request);
  };
}

export function createProjectArchiveHandler(
  service: IProjectService,
): IpcChannelHandler<typeof IPC_CHANNELS.PROJECT_ARCHIVE> {
  return async (request, context): Promise<ArchiveProjectResultDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.archiveProject(request);
  };
}

export function createProjectRestoreHandler(
  service: IProjectService,
): IpcChannelHandler<typeof IPC_CHANNELS.PROJECT_RESTORE> {
  return async (request, context): Promise<ProjectDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.restoreProject(request);
  };
}

// --- Site Handler Factories ---

export function createSiteCreateHandler(
  service: ISiteService,
): IpcChannelHandler<typeof IPC_CHANNELS.SITE_CREATE> {
  return async (request, context): Promise<SiteDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.createSite(request);
  };
}

export function createSiteGetHandler(
  service: ISiteService,
): IpcChannelHandler<typeof IPC_CHANNELS.SITE_GET> {
  return async (request, context): Promise<SiteDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.getSiteById(request);
  };
}

export function createSiteListHandler(
  service: ISiteService,
): IpcChannelHandler<typeof IPC_CHANNELS.SITE_LIST> {
  return async (request, context): Promise<SiteListResponseDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.listSitesByProject(request);
  };
}

export function createSiteUpdateHandler(
  service: ISiteService,
): IpcChannelHandler<typeof IPC_CHANNELS.SITE_UPDATE> {
  return async (request, context): Promise<SiteDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.updateSite(request);
  };
}

export function createSiteArchiveHandler(
  service: ISiteService,
): IpcChannelHandler<typeof IPC_CHANNELS.SITE_ARCHIVE> {
  return async (request, context): Promise<SiteDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.archiveSite(request);
  };
}

export function createSiteRestoreHandler(
  service: ISiteService,
): IpcChannelHandler<typeof IPC_CHANNELS.SITE_RESTORE> {
  return async (request, context): Promise<SiteDTO> => {
    if (context.signal.aborted) {
      throw new IPCError(
        'Request was aborted before handler execution',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    return service.restoreSite(request);
  };
}

export interface DatabaseIpcHandlersDependencies {
  readonly projectService: IProjectService;
  readonly siteService: ISiteService;
}

/**
 * Registers all 12 approved Phase 2.2 project and site IPC handlers onto the dispatcher.
 */
export function registerDatabaseIpcHandlers(
  dispatcher: SecureIpcDispatcher,
  deps: DatabaseIpcHandlersDependencies,
): void {
  // Project Handlers
  dispatcher.registerHandler(
    IPC_CHANNELS.PROJECT_CREATE,
    createProjectCreateHandler(deps.projectService),
  );
  dispatcher.registerHandler(
    IPC_CHANNELS.PROJECT_GET,
    createProjectGetHandler(deps.projectService),
  );
  dispatcher.registerHandler(
    IPC_CHANNELS.PROJECT_LIST,
    createProjectListHandler(deps.projectService),
  );
  dispatcher.registerHandler(
    IPC_CHANNELS.PROJECT_UPDATE,
    createProjectUpdateHandler(deps.projectService),
  );
  dispatcher.registerHandler(
    IPC_CHANNELS.PROJECT_ARCHIVE,
    createProjectArchiveHandler(deps.projectService),
  );
  dispatcher.registerHandler(
    IPC_CHANNELS.PROJECT_RESTORE,
    createProjectRestoreHandler(deps.projectService),
  );

  // Site Handlers
  dispatcher.registerHandler(IPC_CHANNELS.SITE_CREATE, createSiteCreateHandler(deps.siteService));
  dispatcher.registerHandler(IPC_CHANNELS.SITE_GET, createSiteGetHandler(deps.siteService));
  dispatcher.registerHandler(IPC_CHANNELS.SITE_LIST, createSiteListHandler(deps.siteService));
  dispatcher.registerHandler(IPC_CHANNELS.SITE_UPDATE, createSiteUpdateHandler(deps.siteService));
  dispatcher.registerHandler(IPC_CHANNELS.SITE_ARCHIVE, createSiteArchiveHandler(deps.siteService));
  dispatcher.registerHandler(IPC_CHANNELS.SITE_RESTORE, createSiteRestoreHandler(deps.siteService));
}
