/**
 * Central security and bounds policy constants for IPC payloads.
 * Platform-agnostic bounds suitable for both Main process and Renderer environments.
 */

export const PAYLOAD_BOUNDS_POLICY = {
  /** Maximum conservative total payload size allowed in Main Process memory (1 MB) */
  maxTotalBytes: 1024 * 1024,
  /** Maximum nesting depth for objects and arrays to prevent stack overflow */
  maxDepth: 10,
  /** Maximum number of own enumerable keys per object to prevent wide-object DoS */
  maxKeysPerObject: 256,
  /** Early O(1) upper bound on array length to prevent huge/sparse array allocation */
  maxArrayLength: 5_000,
  /** Maximum single string length (512 KB) to prevent memory exhaustion and ReDoS */
  maxStringLength: 512 * 1024,
} as const;

export type PayloadBoundsPolicy = typeof PAYLOAD_BOUNDS_POLICY;
