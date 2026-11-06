import { describe, it, expect } from 'vitest';
import {
  AppPingRequestSchema,
  AppPingResponseSchema,
  AppSystemInfoRequestSchema,
  AppSystemInfoResponseSchema,
  AuditValidateTargetRequestSchema,
  AuditValidateTargetResponseSchema,
} from '../../src/ipc/schemas.js';

describe('IPC Zod Schemas Validation', () => {
  describe('app:ping Schemas', () => {
    it('accepts valid ping request with or without timestamp', () => {
      const withTimestamp = AppPingRequestSchema.safeParse({ timestamp: 1700000000 });
      expect(withTimestamp.success).toBe(true);
      if (withTimestamp.success) {
        expect(withTimestamp.data.timestamp).toBe(1700000000);
      }

      const emptyPing = AppPingRequestSchema.safeParse({});
      expect(emptyPing.success).toBe(true);
    });

    it('rejects invalid ping request values and unknown properties', () => {
      expect(AppPingRequestSchema.safeParse({ timestamp: -1 }).success).toBe(false);
      expect(AppPingRequestSchema.safeParse({ timestamp: 12.34 }).success).toBe(false);
      expect(AppPingRequestSchema.safeParse({ timestamp: '1700000' }).success).toBe(false);
      expect(
        AppPingRequestSchema.safeParse({ timestamp: 100, extraKey: 'forbidden' }).success,
      ).toBe(false);
    });

    it('accepts valid ping response', () => {
      const res = AppPingResponseSchema.safeParse({
        pong: true,
        clientTimestamp: 100,
        serverTimestamp: 200,
      });
      expect(res.success).toBe(true);
    });

    it('rejects invalid ping response', () => {
      expect(AppPingResponseSchema.safeParse({ pong: false, serverTimestamp: 200 }).success).toBe(
        false,
      );
      expect(AppPingResponseSchema.safeParse({ pong: true }).success).toBe(false);
      expect(AppPingResponseSchema.safeParse({ pong: true, serverTimestamp: -1 }).success).toBe(
        false,
      );
      expect(
        AppPingResponseSchema.safeParse({ pong: true, serverTimestamp: 200, extra: true }).success,
      ).toBe(false);
    });
  });

  describe('app:get-system-info Schemas', () => {
    it('accepts empty object request', () => {
      expect(AppSystemInfoRequestSchema.safeParse({}).success).toBe(true);
    });

    it('rejects non-empty request in strict mode', () => {
      expect(AppSystemInfoRequestSchema.safeParse({ unexpected: true }).success).toBe(false);
      expect(AppSystemInfoRequestSchema.safeParse(null).success).toBe(false);
      expect(AppSystemInfoRequestSchema.safeParse('string').success).toBe(false);
    });

    it('accepts valid system info response matching approved architecture', () => {
      const validResponse = {
        appVersion: '1.0.0',
        electronVersion: '44.10.2',
        chromeVersion: '134.0.0.0',
        nodeVersion: '22.12.0',
        platform: 'win32' as const,
        arch: 'x64',
      };
      const res = AppSystemInfoResponseSchema.safeParse(validResponse);
      expect(res.success).toBe(true);
    });

    it('rejects unexpected fields like isPackaged or version in strict mode', () => {
      expect(
        AppSystemInfoResponseSchema.safeParse({
          appVersion: '1.0.0',
          electronVersion: '44.10.2',
          chromeVersion: '134.0.0.0',
          nodeVersion: '22.12.0',
          platform: 'win32' as const,
          arch: 'x64',
          isPackaged: true, // not in approved contract
        }).success,
      ).toBe(false);

      expect(
        AppSystemInfoResponseSchema.safeParse({
          version: '1.0.0', // must use appVersion
          electronVersion: '44.10.2',
          chromeVersion: '134.0.0.0',
          nodeVersion: '22.12.0',
          platform: 'win32' as const,
          arch: 'x64',
        }).success,
      ).toBe(false);
    });

    it('rejects invalid platform or missing fields', () => {
      expect(
        AppSystemInfoResponseSchema.safeParse({
          platform: 'freebsd',
          arch: 'x64',
          appVersion: '1.0.0',
          electronVersion: '44.10.2',
          nodeVersion: '22.12.0',
          chromeVersion: '134.0.0.0',
        }).success,
      ).toBe(false);

      expect(
        AppSystemInfoResponseSchema.safeParse({
          platform: 'win32',
          arch: 'x64',
        }).success,
      ).toBe(false);
    });
  });

  describe('audit:validate-target Schemas', () => {
    it('accepts valid target URL and options', () => {
      const req = {
        targetUrl: 'https://example.com/wp-admin',
        allowedScope: ['example.com'],
        options: {
          allowAnyPort: false,
          allowedPorts: [443, 8443],
        },
      };
      const res = AuditValidateTargetRequestSchema.safeParse(req);
      expect(res.success).toBe(true);
    });

    it('rejects empty or excessively long target URL', () => {
      expect(AuditValidateTargetRequestSchema.safeParse({ targetUrl: '' }).success).toBe(false);
      expect(
        AuditValidateTargetRequestSchema.safeParse({
          targetUrl: 'a'.repeat(512 * 1024 + 1),
        }).success,
      ).toBe(false);
    });

    it('rejects invalid ports in options', () => {
      expect(
        AuditValidateTargetRequestSchema.safeParse({
          targetUrl: 'https://example.com',
          options: {
            allowedPorts: [0], // < 1
          },
        }).success,
      ).toBe(false);

      expect(
        AuditValidateTargetRequestSchema.safeParse({
          targetUrl: 'https://example.com',
          options: {
            allowedPorts: [70000], // > 65535
          },
        }).success,
      ).toBe(false);
    });

    it('accepts valid validate-target response', () => {
      const validRes = {
        valid: true,
        normalizedUrl: 'https://example.com',
        inScope: true,
      };
      expect(AuditValidateTargetResponseSchema.safeParse(validRes).success).toBe(true);

      const invalidRes = {
        valid: false,
        error: 'Target URL contains embedded credentials which are forbidden',
      };
      expect(AuditValidateTargetResponseSchema.safeParse(invalidRes).success).toBe(true);
    });
  });
});
