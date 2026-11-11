import { z } from 'zod';

export const PLATFORM_TYPES = ['wordpress', 'generic_web', 'custom'] as const;
export type PlatformType = (typeof PLATFORM_TYPES)[number];

export const ENVIRONMENT_TYPES = ['production', 'staging', 'development', 'local'] as const;
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];

export const PlatformTypeSchema = z.enum(PLATFORM_TYPES);
export const EnvironmentTypeSchema = z.enum(ENVIRONMENT_TYPES);

/**
 * Validates a base URL to ensure HTTP or HTTPS protocol and reasonable length.
 */
export const SiteBaseUrlSchema = z
  .string()
  .trim()
  .min(1, 'Site base URL is required')
  .max(2048, 'URL must not exceed 2048 characters')
  .refine(
    val => {
      try {
        const parsed = new URL(val);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Site base URL must be a valid HTTP or HTTPS URL' },
  );

/**
 * Data Transfer Object representing a Site.
 */
export interface SiteDTO {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  platformType: PlatformType;
  environmentType: EnvironmentType;
  description: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export const SiteDTOSchema = z.object({
  id: z.string().uuid('Invalid site ID format'),
  projectId: z.string().uuid('Invalid project ID format'),
  name: z
    .string()
    .min(1, 'Site name is required')
    .max(100, 'Site name must not exceed 100 characters'),
  baseUrl: SiteBaseUrlSchema,
  platformType: PlatformTypeSchema,
  environmentType: EnvironmentTypeSchema,
  description: z.string().max(1000, 'Description must not exceed 1000 characters').nullable(),
  isArchived: z.boolean(),
  createdAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
  updatedAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
});

/**
 * Schema for creating a new site under an existing project.
 */
export const CreateSiteRequestSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
  name: z
    .string()
    .trim()
    .min(1, 'Site name is required')
    .max(100, 'Site name must not exceed 100 characters'),
  baseUrl: SiteBaseUrlSchema,
  platformType: PlatformTypeSchema.optional().default('wordpress'),
  environmentType: EnvironmentTypeSchema.optional().default('production'),
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

export type CreateSiteRequest = z.input<typeof CreateSiteRequestSchema>;
export type CreateSiteOutput = z.output<typeof CreateSiteRequestSchema>;

/**
 * Schema for getting a site by ID.
 */
export const GetSiteRequestSchema = z.object({
  id: z.string().uuid('Invalid site ID format'),
});

export type GetSiteRequest = z.input<typeof GetSiteRequestSchema>;

/**
 * Schema for listing sites belonging to a project with bounded pagination.
 */
export const ListSitesRequestSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
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

export type ListSitesRequest = z.input<typeof ListSitesRequestSchema>;
export type ListSitesOutput = z.output<typeof ListSitesRequestSchema>;

/**
 * Schema for updating an existing site.
 * Distinguishes omitted fields (undefined = keep existing) from null/empty values.
 */
export const UpdateSiteRequestSchema = z.object({
  id: z.string().uuid('Invalid site ID format'),
  name: z
    .string()
    .trim()
    .min(1, 'Site name cannot be empty')
    .max(100, 'Site name must not exceed 100 characters')
    .optional(),
  baseUrl: SiteBaseUrlSchema.optional(),
  platformType: PlatformTypeSchema.optional(),
  environmentType: EnvironmentTypeSchema.optional(),
  description: z
    .union([z.string().trim().max(1000, 'Description must not exceed 1000 characters'), z.null()])
    .optional()
    .transform(val => {
      if (val === undefined) return undefined;
      if (val === null || val === '') return null;
      return val;
    }),
});

export type UpdateSiteRequest = z.input<typeof UpdateSiteRequestSchema>;
export type UpdateSiteOutput = z.output<typeof UpdateSiteRequestSchema>;

/**
 * Schema for archiving a site.
 */
export const ArchiveSiteRequestSchema = z.object({
  id: z.string().uuid('Invalid site ID format'),
});

export type ArchiveSiteRequest = z.input<typeof ArchiveSiteRequestSchema>;

/**
 * Schema for restoring an archived site.
 */
export const RestoreSiteRequestSchema = z.object({
  id: z.string().uuid('Invalid site ID format'),
});

export type RestoreSiteRequest = z.input<typeof RestoreSiteRequestSchema>;

/**
 * Paginated site list response DTO.
 */
export interface SiteListResponseDTO {
  items: SiteDTO[];
  total: number;
  limit: number;
  offset: number;
}

export const SiteListResponseDTOSchema = z.object({
  items: z.array(SiteDTOSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0),
});

/**
 * Convenient aliases for Preload and Renderer DTO contracts.
 */
export type CreateSiteDTO = CreateSiteRequest;
export type GetSiteDTO = GetSiteRequest;
export type ListSitesQueryDTO = ListSitesRequest;
export type UpdateSiteDTO = UpdateSiteRequest;
export type ArchiveSiteDTO = ArchiveSiteRequest;
export type RestoreSiteDTO = RestoreSiteRequest;
export type SitePlatformType = PlatformType;
export type SiteEnvironmentType = EnvironmentType;
