import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS, IPC_CHANNEL_LIST, isIPCChannel } from '../../src/ipc/channels.js';

describe('IPC Channels Specification', () => {
  it('defines the core canonical channel identifiers', () => {
    expect(IPC_CHANNELS.APP_PING).toBe('app:ping');
    expect(IPC_CHANNELS.APP_GET_SYSTEM_INFO).toBe('app:get-system-info');
    expect(IPC_CHANNELS.AUDIT_VALIDATE_TARGET).toBe('audit:validate-target');
  });

  it('provides an immutable frozen list of channels', () => {
    expect(Object.isFrozen(IPC_CHANNEL_LIST)).toBe(true);
    expect(IPC_CHANNEL_LIST).toContain('app:ping');
    expect(IPC_CHANNEL_LIST).toContain('app:get-system-info');
    expect(IPC_CHANNEL_LIST).toContain('audit:validate-target');
  });

  it('validates genuine channels with isIPCChannel type guard', () => {
    expect(isIPCChannel('app:ping')).toBe(true);
    expect(isIPCChannel('app:get-system-info')).toBe(true);
    expect(isIPCChannel('audit:validate-target')).toBe(true);
  });

  it('rejects unauthorized or unknown channel strings', () => {
    expect(isIPCChannel('')).toBe(false);
    expect(isIPCChannel('unknown:channel')).toBe(false);
    expect(isIPCChannel('app:ping:extra')).toBe(false);
    expect(isIPCChannel('app:undefined')).toBe(false);
    expect(isIPCChannel('__proto__')).toBe(false);
  });
});
