import {
  IPCError,
  IPC_ERROR_CODES,
  type ArchiveProjectRequest,
  type ArchiveProjectResultDTO,
  type CreateProjectRequest,
  type GetProjectRequest,
  type ListProjectsRequest,
  type ProjectDTO,
  type ProjectListResponseDTO,
  type RestoreProjectRequest,
  type UpdateProjectRequest,
} from '@auditor/shared';
import type { ProjectRepository } from '../db/repositories/project.repository.js';

export interface IProjectService {
  createProject(request: CreateProjectRequest): ProjectDTO;
  getProjectById(request: GetProjectRequest): ProjectDTO;
  listProjects(request?: ListProjectsRequest): ProjectListResponseDTO;
  updateProject(request: UpdateProjectRequest): ProjectDTO;
  archiveProject(request: ArchiveProjectRequest): ArchiveProjectResultDTO;
  restoreProject(request: RestoreProjectRequest): ProjectDTO;
}

/**
 * Domain Service for Project business rules, lifecycle management, and validation.
 * Mediates between IPC handlers and database repository without exposing raw database handles.
 */
export class ProjectService implements IProjectService {
  private readonly repository: ProjectRepository;

  constructor(repository: ProjectRepository) {
    this.repository = repository;
  }

  /**
   * Creates a new project.
   * Business Rules:
   * - Name must not be empty after trimming.
   * - Active project with the same name (case-insensitive) must not exist.
   */
  public createProject(request: CreateProjectRequest): ProjectDTO {
    const trimmedName = request.name.trim();
    if (trimmedName.length === 0) {
      throw new IPCError('Project name cannot be empty', IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
    }

    if (this.repository.isNameTaken(trimmedName)) {
      throw new IPCError(
        `A project named '${trimmedName}' already exists`,
        IPC_ERROR_CODES.PROJECT_NAME_EXISTS,
      );
    }

    try {
      return this.repository.create({
        name: trimmedName,
        description: request.description ?? null,
      });
    } catch (err) {
      if (err instanceof IPCError) {
        throw err;
      }
      if (err instanceof Error && err.message.includes('ERR_PROJECT_NAME_EXISTS')) {
        throw new IPCError(
          `A project named '${trimmedName}' already exists`,
          IPC_ERROR_CODES.PROJECT_NAME_EXISTS,
        );
      }
      throw new IPCError('Failed to create project in database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Retrieves a project by ID including active site count.
   * Throws ERR_PROJECT_NOT_FOUND if no matching record exists.
   */
  public getProjectById(request: GetProjectRequest): ProjectDTO {
    const project = this.repository.getById(request.id);
    if (!project) {
      throw new IPCError(
        `Project with ID '${request.id}' not found`,
        IPC_ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }
    return project;
  }

  /**
   * Lists projects with bounded pagination and optional search filter.
   */
  public listProjects(request?: ListProjectsRequest): ProjectListResponseDTO {
    try {
      return this.repository.list({
        includeArchived: request?.includeArchived ?? false,
        search: request?.search,
        limit: request?.limit ?? 50,
        offset: request?.offset ?? 0,
      });
    } catch {
      throw new IPCError(
        'Failed to retrieve projects list from database',
        IPC_ERROR_CODES.DATABASE_ERROR,
      );
    }
  }

  /**
   * Updates an existing project's name and/or description.
   * Business Rules:
   * - Target project must exist.
   * - If name is changed, new name must not conflict with an existing active project.
   */
  public updateProject(request: UpdateProjectRequest): ProjectDTO {
    const existing = this.repository.getById(request.id);
    if (!existing) {
      throw new IPCError(
        `Project with ID '${request.id}' not found`,
        IPC_ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }

    if (request.name !== undefined) {
      const trimmedName = request.name.trim();
      if (trimmedName.length === 0) {
        throw new IPCError(
          'Project name cannot be empty',
          IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
        );
      }
      if (!existing.isArchived && this.repository.isNameTaken(trimmedName, request.id)) {
        throw new IPCError(
          `An active project named '${trimmedName}' already exists`,
          IPC_ERROR_CODES.PROJECT_NAME_EXISTS,
        );
      }
    }

    try {
      return this.repository.update(request.id, {
        name: request.name,
        description: request.description,
      });
    } catch (err) {
      if (err instanceof IPCError) {
        throw err;
      }
      if (err instanceof Error && err.message.includes('ERR_PROJECT_NAME_EXISTS')) {
        throw new IPCError(
          'An active project with this name already exists',
          IPC_ERROR_CODES.PROJECT_NAME_EXISTS,
        );
      }
      throw new IPCError('Failed to update project in database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Archives a project and cascades archival to its active child sites in a single atomic transaction.
   * Business Rules:
   * - Target project must exist.
   * - Cascades soft-delete to active child sites only.
   */
  public archiveProject(request: ArchiveProjectRequest): ArchiveProjectResultDTO {
    const existing = this.repository.getById(request.id);
    if (!existing) {
      throw new IPCError(
        `Project with ID '${request.id}' not found`,
        IPC_ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }

    try {
      return this.repository.archive(request.id);
    } catch (err) {
      if (err instanceof IPCError) {
        throw err;
      }
      throw new IPCError(
        'Failed to archive project and child sites',
        IPC_ERROR_CODES.DATABASE_ERROR,
      );
    }
  }

  /**
   * Restores an archived project.
   * Business Rules:
   * - Target project must exist.
   * - Restoring must not violate active project name uniqueness.
   * - Child sites are NOT restored automatically.
   */
  public restoreProject(request: RestoreProjectRequest): ProjectDTO {
    const existing = this.repository.getById(request.id);
    if (!existing) {
      throw new IPCError(
        `Project with ID '${request.id}' not found`,
        IPC_ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }

    if (!existing.isArchived) {
      return existing;
    }

    if (this.repository.isNameTaken(existing.name, request.id)) {
      throw new IPCError(
        `Cannot restore project. An active project named '${existing.name}' already exists`,
        IPC_ERROR_CODES.PROJECT_NAME_EXISTS,
      );
    }

    try {
      return this.repository.restore(request.id);
    } catch (err) {
      if (err instanceof IPCError) {
        throw err;
      }
      if (err instanceof Error && err.message.includes('ERR_PROJECT_NAME_EXISTS')) {
        throw new IPCError(
          `Cannot restore project. An active project named '${existing.name}' already exists`,
          IPC_ERROR_CODES.PROJECT_NAME_EXISTS,
        );
      }
      throw new IPCError('Failed to restore project in database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }
}
