import {
  IPCError,
  IPC_ERROR_CODES,
  type ArchiveSiteRequest,
  type CreateSiteRequest,
  type GetSiteRequest,
  type ListSitesRequest,
  type RestoreSiteRequest,
  type SiteDTO,
  type SiteListResponseDTO,
  type UpdateSiteRequest,
} from '@auditor/shared';
import type { SiteRepository } from '../db/repositories/site.repository.js';
import type { ProjectRepository } from '../db/repositories/project.repository.js';

export interface ISiteService {
  createSite(request: CreateSiteRequest): SiteDTO;
  getSiteById(request: GetSiteRequest): SiteDTO;
  listSitesByProject(request: ListSitesRequest): SiteListResponseDTO;
  updateSite(request: UpdateSiteRequest): SiteDTO;
  archiveSite(request: ArchiveSiteRequest): SiteDTO;
  restoreSite(request: RestoreSiteRequest): SiteDTO;
}

/**
 * Normalizes a candidate base URL according to RFC 3986 rules:
 * - Validates HTTP/HTTPS protocol.
 * - Standardizes scheme and hostname to lowercase.
 * - Strips default protocol ports (:80 for HTTP, :443 for HTTPS).
 * - Discards hash fragments and query parameters for base URLs.
 * - Normalizes empty pathname to '/'.
 */
export function normalizeSiteBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    throw new IPCError('Site base URL cannot be empty', IPC_ERROR_CODES.INVALID_TARGET_URL);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new IPCError(`Invalid URL format: '${trimmed}'`, IPC_ERROR_CODES.INVALID_TARGET_URL);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new IPCError(
      `Unsupported protocol '${parsed.protocol}'. Only http: and https: are permitted.`,
      IPC_ERROR_CODES.INVALID_TARGET_URL,
    );
  }

  // Remove default port numbers
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  // Discard search parameters and fragments for base website identification
  parsed.search = '';
  parsed.hash = '';

  let pathname = parsed.pathname || '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  parsed.pathname = pathname;

  return parsed.toString();
}

/**
 * Domain Service for Site business rules, URL normalization, and lifecycle management.
 */
export class SiteService implements ISiteService {
  private readonly siteRepository: SiteRepository;
  private readonly projectRepository: ProjectRepository;

  constructor(siteRepository: SiteRepository, projectRepository: ProjectRepository) {
    this.siteRepository = siteRepository;
    this.projectRepository = projectRepository;
  }

  /**
   * Registers a new site under an existing, non-archived project.
   * Business Rules:
   * - Parent project must exist.
   * - Parent project must not be archived.
   * - Base URL must be valid HTTP/HTTPS and normalized.
   * - No active site with the same normalized URL may exist in this project.
   */
  public createSite(request: CreateSiteRequest): SiteDTO {
    const project = this.projectRepository.getById(request.projectId);
    if (!project) {
      throw new IPCError(
        `Parent project with ID '${request.projectId}' not found`,
        IPC_ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }

    if (project.isArchived) {
      throw new IPCError(
        `Cannot create site under archived project '${request.projectId}'`,
        IPC_ERROR_CODES.PARENT_PROJECT_ARCHIVED,
      );
    }

    const normalizedUrl = normalizeSiteBaseUrl(request.baseUrl);
    const trimmedName = request.name.trim();

    if (this.siteRepository.isUrlTakenInProject(request.projectId, normalizedUrl)) {
      throw new IPCError(
        `An active site with URL '${normalizedUrl}' already exists in this project`,
        IPC_ERROR_CODES.SITE_URL_EXISTS,
      );
    }

    try {
      return this.siteRepository.create({
        projectId: request.projectId,
        name: trimmedName,
        baseUrl: normalizedUrl,
        platformType: request.platformType ?? 'wordpress',
        environmentType: request.environmentType ?? 'production',
        description: request.description ?? null,
      });
    } catch (err) {
      if (err instanceof IPCError) {
        throw err;
      }
      if (err instanceof Error && err.message.includes('ERR_SITE_URL_EXISTS')) {
        throw new IPCError(
          `An active site with URL '${normalizedUrl}' already exists in this project`,
          IPC_ERROR_CODES.SITE_URL_EXISTS,
        );
      }
      throw new IPCError('Failed to register site in database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Retrieves a site by ID.
   */
  public getSiteById(request: GetSiteRequest): SiteDTO {
    const site = this.siteRepository.getById(request.id);
    if (!site) {
      throw new IPCError(`Site with ID '${request.id}' not found`, IPC_ERROR_CODES.SITE_NOT_FOUND);
    }
    return site;
  }

  /**
   * Lists sites belonging to a project with bounded pagination.
   */
  public listSitesByProject(request: ListSitesRequest): SiteListResponseDTO {
    const project = this.projectRepository.getById(request.projectId);
    if (!project) {
      throw new IPCError(
        `Project with ID '${request.projectId}' not found`,
        IPC_ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }

    try {
      return this.siteRepository.listByProject(request.projectId, {
        includeArchived: request.includeArchived ?? false,
        search: request.search,
        limit: request.limit ?? 50,
        offset: request.offset ?? 0,
      });
    } catch {
      throw new IPCError('Failed to list sites from database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Updates an existing site.
   * Business Rules:
   * - Target site must exist.
   * - If baseUrl is updated, it must be normalized and not duplicate an active site in the same project.
   */
  public updateSite(request: UpdateSiteRequest): SiteDTO {
    const existing = this.siteRepository.getById(request.id);
    if (!existing) {
      throw new IPCError(`Site with ID '${request.id}' not found`, IPC_ERROR_CODES.SITE_NOT_FOUND);
    }

    let normalizedUrl: string | undefined;
    if (request.baseUrl !== undefined) {
      normalizedUrl = normalizeSiteBaseUrl(request.baseUrl);
      if (
        !existing.isArchived &&
        this.siteRepository.isUrlTakenInProject(existing.projectId, normalizedUrl, request.id)
      ) {
        throw new IPCError(
          `An active site with URL '${normalizedUrl}' already exists in this project`,
          IPC_ERROR_CODES.SITE_URL_EXISTS,
        );
      }
    }

    try {
      return this.siteRepository.update(request.id, {
        name: request.name,
        baseUrl: normalizedUrl,
        platformType: request.platformType,
        environmentType: request.environmentType,
        description: request.description,
      });
    } catch (err) {
      if (err instanceof IPCError) {
        throw err;
      }
      if (err instanceof Error && err.message.includes('ERR_SITE_URL_EXISTS')) {
        throw new IPCError(
          'An active site with this URL already exists in this project',
          IPC_ERROR_CODES.SITE_URL_EXISTS,
        );
      }
      throw new IPCError('Failed to update site in database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Archives a site.
   */
  public archiveSite(request: ArchiveSiteRequest): SiteDTO {
    const existing = this.siteRepository.getById(request.id);
    if (!existing) {
      throw new IPCError(`Site with ID '${request.id}' not found`, IPC_ERROR_CODES.SITE_NOT_FOUND);
    }

    try {
      return this.siteRepository.archive(request.id);
    } catch {
      throw new IPCError('Failed to archive site in database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Restores an archived site.
   * Business Rules:
   * - Target site must exist.
   * - Parent project must not be archived.
   * - Restoring must not violate active URL uniqueness in the project.
   */
  public restoreSite(request: RestoreSiteRequest): SiteDTO {
    const existing = this.siteRepository.getById(request.id);
    if (!existing) {
      throw new IPCError(`Site with ID '${request.id}' not found`, IPC_ERROR_CODES.SITE_NOT_FOUND);
    }

    if (!existing.isArchived) {
      return existing;
    }

    const project = this.projectRepository.getById(existing.projectId);
    if (!project || project.isArchived) {
      throw new IPCError(
        `Cannot restore site '${request.id}' because its parent project is archived`,
        IPC_ERROR_CODES.PARENT_PROJECT_ARCHIVED,
      );
    }

    if (this.siteRepository.isUrlTakenInProject(existing.projectId, existing.baseUrl, request.id)) {
      throw new IPCError(
        `Cannot restore site. An active site with URL '${existing.baseUrl}' already exists in this project`,
        IPC_ERROR_CODES.SITE_URL_EXISTS,
      );
    }

    try {
      return this.siteRepository.restore(request.id);
    } catch (err) {
      if (err instanceof IPCError) {
        throw err;
      }
      if (err instanceof Error && err.message.includes('ERR_SITE_URL_EXISTS')) {
        throw new IPCError(
          `Cannot restore site. An active site with URL '${existing.baseUrl}' already exists in this project`,
          IPC_ERROR_CODES.SITE_URL_EXISTS,
        );
      }
      throw new IPCError('Failed to restore site in database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }
}
