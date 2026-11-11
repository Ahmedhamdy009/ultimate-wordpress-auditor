import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS, IPC_CHANNEL_LIST, isIPCChannel } from '../../src/ipc/channels.js';

describe('IPC Channels Specification', () => {
  it('defines the core canonical channel identifiers, project/site channels, and scan/finding/report channels', () => {
    expect(IPC_CHANNELS.APP_PING).toBe('app:ping');
    expect(IPC_CHANNELS.APP_GET_SYSTEM_INFO).toBe('app:get-system-info');
    expect(IPC_CHANNELS.AUDIT_VALIDATE_TARGET).toBe('audit:validate-target');

    expect(IPC_CHANNELS.PROJECT_CREATE).toBe('project:create');
    expect(IPC_CHANNELS.PROJECT_GET).toBe('project:get');
    expect(IPC_CHANNELS.PROJECT_LIST).toBe('project:list');
    expect(IPC_CHANNELS.PROJECT_UPDATE).toBe('project:update');
    expect(IPC_CHANNELS.PROJECT_ARCHIVE).toBe('project:archive');
    expect(IPC_CHANNELS.PROJECT_RESTORE).toBe('project:restore');

    expect(IPC_CHANNELS.SITE_CREATE).toBe('site:create');
    expect(IPC_CHANNELS.SITE_GET).toBe('site:get');
    expect(IPC_CHANNELS.SITE_LIST).toBe('site:list');
    expect(IPC_CHANNELS.SITE_UPDATE).toBe('site:update');
    expect(IPC_CHANNELS.SITE_ARCHIVE).toBe('site:archive');
    expect(IPC_CHANNELS.SITE_RESTORE).toBe('site:restore');

    expect(IPC_CHANNELS.SCAN_CREATE).toBe('scan:create');
    expect(IPC_CHANNELS.SCAN_GET).toBe('scan:get');
    expect(IPC_CHANNELS.SCAN_LIST).toBe('scan:list');
    expect(IPC_CHANNELS.SCAN_CANCEL).toBe('scan:cancel');
    expect(IPC_CHANNELS.SCAN_PROGRESS).toBe('scan:progress');

    expect(IPC_CHANNELS.FINDING_LIST).toBe('finding:list');
    expect(IPC_CHANNELS.FINDING_GET).toBe('finding:get');

    expect(IPC_CHANNELS.REPORT_CREATE).toBe('report:create');
    expect(IPC_CHANNELS.REPORT_GET).toBe('report:get');
    expect(IPC_CHANNELS.REPORT_LIST).toBe('report:list');
    expect(IPC_CHANNELS.REPORT_DELETE).toBe('report:delete');
    expect(IPC_CHANNELS.REPORT_GET_CONTENT).toBe('report:get-content');
  });

  it('provides an immutable frozen list of channels containing exactly 27 channels', () => {
    expect(Object.isFrozen(IPC_CHANNEL_LIST)).toBe(true);
    expect(IPC_CHANNEL_LIST.length).toBe(27);
    expect(IPC_CHANNEL_LIST).toContain('app:ping');
    expect(IPC_CHANNEL_LIST).toContain('project:create');
    expect(IPC_CHANNEL_LIST).toContain('site:create');
    expect(IPC_CHANNEL_LIST).toContain('scan:create');
    expect(IPC_CHANNEL_LIST).toContain('scan:progress');
    expect(IPC_CHANNEL_LIST).toContain('finding:list');
    expect(IPC_CHANNEL_LIST).toContain('report:create');
    expect(IPC_CHANNEL_LIST).toContain('report:delete');
    expect(IPC_CHANNEL_LIST).toContain('report:get-content');
  });

  it('validates genuine channels with isIPCChannel type guard', () => {
    expect(isIPCChannel('app:ping')).toBe(true);
    expect(isIPCChannel('app:get-system-info')).toBe(true);
    expect(isIPCChannel('audit:validate-target')).toBe(true);
    expect(isIPCChannel('project:create')).toBe(true);
    expect(isIPCChannel('site:create')).toBe(true);
  });

  it('rejects unauthorized or unknown channel strings', () => {
    expect(isIPCChannel('')).toBe(false);
    expect(isIPCChannel('unknown:channel')).toBe(false);
    expect(isIPCChannel('app:ping:extra')).toBe(false);
    expect(isIPCChannel('app:undefined')).toBe(false);
    expect(isIPCChannel('__proto__')).toBe(false);
  });
});
