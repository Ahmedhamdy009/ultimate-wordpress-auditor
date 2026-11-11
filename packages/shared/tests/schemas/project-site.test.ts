import { describe, it, expect } from 'vitest';
import {
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  ListProjectsRequestSchema,
  ProjectDTOSchema,
  ArchiveProjectResultDTOSchema,
  CreateSiteRequestSchema,
  UpdateSiteRequestSchema,
  ListSitesRequestSchema,
  SiteDTOSchema,
  SiteBaseUrlSchema,
} from '../../src/index.js';

describe('Project and Site Shared Schemas', () => {
  describe('Project Schemas', () => {
    it('validates and trims CreateProjectRequest', () => {
      const parsed = CreateProjectRequestSchema.parse({
        name: '  My WordPress Site  ',
        description: '  A description  ',
      });
      expect(parsed.name).toBe('My WordPress Site');
      expect(parsed.description).toBe('A description');
    });

    it('normalizes empty description to null in CreateProjectRequest', () => {
      const parsed = CreateProjectRequestSchema.parse({
        name: 'My Project',
        description: '   ',
      });
      expect(parsed.description).toBeNull();

      const omitted = CreateProjectRequestSchema.parse({
        name: 'My Project',
      });
      expect(omitted.description).toBeNull();
    });

    it('rejects invalid project names', () => {
      expect(() => CreateProjectRequestSchema.parse({ name: '' })).toThrow();
      expect(() => CreateProjectRequestSchema.parse({ name: '   ' })).toThrow();
      expect(() => CreateProjectRequestSchema.parse({ name: 'a'.repeat(101) })).toThrow();
    });

    it('distinguishes omitted description from explicit null in UpdateProjectRequest', () => {
      const omitted = UpdateProjectRequestSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Updated Name',
      });
      expect(omitted.description).toBeUndefined();
      expect(omitted.name).toBe('Updated Name');

      const explicitNull = UpdateProjectRequestSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        description: null,
      });
      expect(explicitNull.description).toBeNull();
      expect(explicitNull.name).toBeUndefined();

      const emptyNormalized = UpdateProjectRequestSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        description: '   ',
      });
      expect(emptyNormalized.description).toBeNull();
    });

    it('validates ListProjectsRequest pagination defaults and bounds', () => {
      const defaulted = ListProjectsRequestSchema.parse({});
      expect(defaulted.includeArchived).toBe(false);
      expect(defaulted.limit).toBe(50);
      expect(defaulted.offset).toBe(0);

      const bounded = ListProjectsRequestSchema.parse({
        includeArchived: true,
        search: '  portal  ',
        limit: 100,
        offset: 50,
      });
      expect(bounded.includeArchived).toBe(true);
      expect(bounded.search).toBe('portal');
      expect(bounded.limit).toBe(100);
      expect(bounded.offset).toBe(50);

      expect(() => ListProjectsRequestSchema.parse({ limit: 0 })).toThrow();
      expect(() => ListProjectsRequestSchema.parse({ limit: 101 })).toThrow();
      expect(() => ListProjectsRequestSchema.parse({ offset: -1 })).toThrow();
    });

    it('validates ProjectDTO and ArchiveProjectResultDTO', () => {
      const validDto = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Project Alpha',
        description: 'Alpha desc',
        isArchived: false,
        createdAt: '2026-11-07T12:00:00.000Z',
        updatedAt: '2026-11-07T12:00:00.000Z',
        siteCount: 3,
      };
      expect(ProjectDTOSchema.parse(validDto)).toEqual(validDto);

      const archiveResult = {
        archivedProjectId: '123e4567-e89b-12d3-a456-426614174000',
        archivedSiteCount: 2,
      };
      expect(ArchiveProjectResultDTOSchema.parse(archiveResult)).toEqual(archiveResult);
    });
  });

  describe('Site Schemas', () => {
    it('validates SiteBaseUrlSchema', () => {
      expect(SiteBaseUrlSchema.parse('https://example.com')).toBe('https://example.com');
      expect(SiteBaseUrlSchema.parse('http://localhost:8080/test')).toBe(
        'http://localhost:8080/test',
      );
      expect(() => SiteBaseUrlSchema.parse('ftp://example.com')).toThrow();
      expect(() => SiteBaseUrlSchema.parse('not-a-url')).toThrow();
      expect(() => SiteBaseUrlSchema.parse('')).toThrow();
    });

    it('validates CreateSiteRequest with default platform and environment', () => {
      const parsed = CreateSiteRequestSchema.parse({
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Production Site',
        baseUrl: 'https://site.example.com',
      });
      expect(parsed.platformType).toBe('wordpress');
      expect(parsed.environmentType).toBe('production');
      expect(parsed.description).toBeNull();

      // Test explicit approved platform types: generic_web and custom
      const genericParsed = CreateSiteRequestSchema.parse({
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Generic App',
        baseUrl: 'https://app.example.com',
        platformType: 'generic_web',
      });
      expect(genericParsed.platformType).toBe('generic_web');

      const customParsed = CreateSiteRequestSchema.parse({
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Custom CMS',
        baseUrl: 'https://cms.example.com',
        platformType: 'custom',
      });
      expect(customParsed.platformType).toBe('custom');

      // Test unapproved platform type rejection
      expect(() =>
        CreateSiteRequestSchema.parse({
          projectId: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Invalid Platform',
          baseUrl: 'https://invalid.example.com',
          platformType: 'other' as unknown as 'wordpress',
        }),
      ).toThrow();
    });

    it('distinguishes omitted fields in UpdateSiteRequest', () => {
      const omitted = UpdateSiteRequestSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174001',
        baseUrl: 'https://new.example.com',
      });
      expect(omitted.name).toBeUndefined();
      expect(omitted.description).toBeUndefined();
      expect(omitted.platformType).toBeUndefined();
      expect(omitted.baseUrl).toBe('https://new.example.com');
    });

    it('validates ListSitesRequest bounded pagination defaults and project ID', () => {
      const listReq = ListSitesRequestSchema.parse({
        projectId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(listReq.includeArchived).toBe(false);
      expect(listReq.limit).toBe(50);
      expect(listReq.offset).toBe(0);
      expect(listReq.search).toBeUndefined();
    });

    it('validates SiteDTO', () => {
      const validSite = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Staging Site',
        baseUrl: 'https://staging.example.com',
        platformType: 'wordpress' as const,
        environmentType: 'staging' as const,
        description: null,
        isArchived: false,
        createdAt: '2026-11-07T12:00:00.000Z',
        updatedAt: '2026-11-07T12:00:00.000Z',
      };
      expect(SiteDTOSchema.parse(validSite)).toEqual(validSite);
    });
  });
});
