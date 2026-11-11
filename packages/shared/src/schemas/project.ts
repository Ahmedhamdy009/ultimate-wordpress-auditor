import { z } from 'zod';

/**
 * Data Transfer Object representing a Project.
 */
export interface ProjectDTO {
  id: string;
  name: string;
  description: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  siteCount?: number;
}

/**
 * Schema for ProjectDTO validation.
 */
export const ProjectDTOSchema = z.object({
  id: z.string().uuid('Invalid project ID format'),
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(100, 'Project name must not exceed 100 characters'),
  description: z.string().max(1000, 'Description must not exceed 1000 characters').nullable(),
  isArchived: z.boolean(),
  createdAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
  updatedAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
  siteCount: z.number().int().min(0).optional(),
});

/**
 * Schema for creating a new project.
 */
export const CreateProjectRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Project name is required')
    .max(100, 'Project name must not exceed 100 characters'),
  description: z
    .string()
    .trim()
    .max(1000, 'Description must not exceed 1000 characters')
    .nullable()
    .optional()
    .transform(val => {
      if (val === undefined || val === null || val === '') {
        return null;
      }
      return val;
    }),
});

export type CreateProjectRequest = z.input<typeof CreateProjectRequestSchema>;
export type CreateProjectOutput = z.output<typeof CreateProjectRequestSchema>;

/**
 * Schema for retrieving a project by ID.
 */
export const GetProjectRequestSchema = z.object({
  id: z.string().uuid('Invalid project ID format'),
});

export type GetProjectRequest = z.input<typeof GetProjectRequestSchema>;

/**
 * Schema for listing projects with bounded pagination and optional filtering.
 */
export const ListProjectsRequestSchema = z.object({
  includeArchived: z.boolean().optional().default(false),
  search: z
    .string()
    .trim()
    .max(100, 'Search query must not exceed 100 characters')
    .optional()
    .transform(val => (val && val.length > 0 ? val : undefined)),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type ListProjectsRequest = z.input<typeof ListProjectsRequestSchema>;
export type ListProjectsOutput = z.output<typeof ListProjectsRequestSchema>;

/**
 * Schema for updating an existing project.
 * Distinguishes omitted field (undefined = do not update) from null or empty string (normalized to null).
 */
export const UpdateProjectRequestSchema = z.object({
  id: z.string().uuid('Invalid project ID format'),
  name: z
    .string()
    .trim()
    .min(1, 'Project name must not be empty')
    .max(100, 'Project name must not exceed 100 characters')
    .optional(),
  description: z
    .union([z.string().trim().max(1000, 'Description must not exceed 1000 characters'), z.null()])
    .optional()
    .transform(val => {
      if (val === undefined) return undefined;
      if (val === null || val === '') return null;
      return val;
    }),
});

export type UpdateProjectRequest = z.input<typeof UpdateProjectRequestSchema>;
export type UpdateProjectOutput = z.output<typeof UpdateProjectRequestSchema>;

/**
 * Schema for archiving a project.
 */
export const ArchiveProjectRequestSchema = z.object({
  id: z.string().uuid('Invalid project ID format'),
});

export type ArchiveProjectRequest = z.input<typeof ArchiveProjectRequestSchema>;

/**
 * Schema for restoring an archived project.
 */
export const RestoreProjectRequestSchema = z.object({
  id: z.string().uuid('Invalid project ID format'),
});

export type RestoreProjectRequest = z.input<typeof RestoreProjectRequestSchema>;

/**
 * Paginated project list response DTO.
 */
export interface ProjectListResponseDTO {
  items: ProjectDTO[];
  total: number;
  limit: number;
  offset: number;
}

export const ProjectListResponseDTOSchema = z.object({
  items: z.array(ProjectDTOSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0),
});

/**
 * Result of archiving a project, reporting cascade count.
 */
export interface ArchiveProjectResultDTO {
  archivedProjectId: string;
  archivedSiteCount: number;
}

export const ArchiveProjectResultDTOSchema = z.object({
  archivedProjectId: z.string().uuid(),
  archivedSiteCount: z.number().int().min(0),
});

/**
 * Convenient aliases for Preload and Renderer DTO contracts.
 */
export type CreateProjectDTO = CreateProjectRequest;
export type GetProjectDTO = GetProjectRequest;
export type ListProjectsQueryDTO = ListProjectsRequest;
export type UpdateProjectDTO = UpdateProjectRequest;
export type ArchiveProjectDTO = ArchiveProjectRequest;
export type RestoreProjectDTO = RestoreProjectRequest;
