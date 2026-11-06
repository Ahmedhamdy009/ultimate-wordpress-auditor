import { describe, it, expect } from 'vitest';
import { PAYLOAD_BOUNDS_POLICY } from '../../src/ipc/policy.js';
import * as policyModule from '../../src/ipc/policy.js';

describe('IPC Policy & Payload Bounds', () => {
  it('does NOT export machine-specific PROJECT_ROOT from shared policy module', () => {
    expect('PROJECT_ROOT' in policyModule).toBe(false);
  });

  it('defines required conservative bounds in PAYLOAD_BOUNDS_POLICY', () => {
    expect(PAYLOAD_BOUNDS_POLICY.maxTotalBytes).toBe(1024 * 1024); // 1 MB
    expect(PAYLOAD_BOUNDS_POLICY.maxDepth).toBe(10);
    expect(PAYLOAD_BOUNDS_POLICY.maxKeysPerObject).toBe(256);
    expect(PAYLOAD_BOUNDS_POLICY.maxArrayLength).toBe(5_000);
    expect(PAYLOAD_BOUNDS_POLICY.maxStringLength).toBe(512 * 1024); // 512 KB
  });

  it('maintains positive numeric bounds constraints', () => {
    expect(PAYLOAD_BOUNDS_POLICY.maxTotalBytes).toBeGreaterThan(0);
    expect(PAYLOAD_BOUNDS_POLICY.maxDepth).toBeGreaterThan(0);
    expect(PAYLOAD_BOUNDS_POLICY.maxKeysPerObject).toBeGreaterThan(0);
    expect(PAYLOAD_BOUNDS_POLICY.maxArrayLength).toBeGreaterThan(0);
    expect(PAYLOAD_BOUNDS_POLICY.maxStringLength).toBeGreaterThan(0);
  });
});
