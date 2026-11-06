import { z } from 'zod';
import { PAYLOAD_BOUNDS_POLICY } from './policy.js';

/**
 * 1. app:ping
 * Lightweight ping-pong channel for latency measurement and IPC link healthcheck.
 */
export const AppPingRequestSchema = z
  .object({
    timestamp: z.number().int().nonnegative().optional(),
  })
  .strict();

export type AppPingRequest = z.infer<typeof AppPingRequestSchema>;

export const AppPingResponseSchema = z
  .object({
    pong: z.literal(true),
    clientTimestamp: z.number().int().nonnegative().optional(),
    serverTimestamp: z.number().int().nonnegative(),
  })
  .strict();

export type AppPingResponse = z.infer<typeof AppPingResponseSchema>;

/**
 * 2. app:get-system-info
 * Retrieves runtime environment, OS metadata, and runtime version identifiers.
 * Strictly adheres to approved architecture fields: appVersion, electronVersion,
 * chromeVersion, nodeVersion, platform, and arch.
 */
export const AppSystemInfoRequestSchema = z.object({}).strict();

export type AppSystemInfoRequest = z.infer<typeof AppSystemInfoRequestSchema>;

export const AppSystemInfoResponseSchema = z
  .object({
    appVersion: z.string().min(1).max(64),
    electronVersion: z.string().min(1).max(64),
    chromeVersion: z.string().min(1).max(64),
    nodeVersion: z.string().min(1).max(64),
    platform: z.enum(['win32', 'darwin', 'linux']),
    arch: z.string().min(1).max(64),
  })
  .strict();

export type AppSystemInfoResponse = z.infer<typeof AppSystemInfoResponseSchema>;

/**
 * 3. audit:validate-target
 * Validates candidate scan targets against domain, protocol, port, and credential rules.
 */
export const AuditValidateTargetRequestSchema = z
  .object({
    targetUrl: z.string().min(1).max(PAYLOAD_BOUNDS_POLICY.maxStringLength),
    allowedScope: z
      .array(z.string().min(1).max(2048))
      .max(PAYLOAD_BOUNDS_POLICY.maxArrayLength)
      .optional(),
    options: z
      .object({
        allowAnyPort: z.boolean().optional(),
        allowedPorts: z.array(z.number().int().min(1).max(65535)).max(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AuditValidateTargetRequest = z.infer<typeof AuditValidateTargetRequestSchema>;

export const AuditValidateTargetResponseSchema = z
  .object({
    valid: z.boolean(),
    normalizedUrl: z.string().optional(),
    error: z.string().optional(),
    inScope: z.boolean().optional(),
  })
  .strict();

export type AuditValidateTargetResponse = z.infer<typeof AuditValidateTargetResponseSchema>;
