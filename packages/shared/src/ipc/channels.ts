/**
 * Strongly typed IPC Channels for Ultimate WordPress & Website Auditor.
 * Strict enum/const pattern ensures compile-time validation of channel names.
 */

export const IPC_CHANNELS = {
  APP_PING: 'app:ping',
  APP_GET_SYSTEM_INFO: 'app:get-system-info',
  AUDIT_VALIDATE_TARGET: 'audit:validate-target',

  // Project Management Channels
  PROJECT_CREATE: 'project:create',
  PROJECT_GET: 'project:get',
  PROJECT_LIST: 'project:list',
  PROJECT_UPDATE: 'project:update',
  PROJECT_ARCHIVE: 'project:archive',
  PROJECT_RESTORE: 'project:restore',

  // Site Management Channels
  SITE_CREATE: 'site:create',
  SITE_GET: 'site:get',
  SITE_LIST: 'site:list',
  SITE_UPDATE: 'site:update',
  SITE_ARCHIVE: 'site:archive',
  SITE_RESTORE: 'site:restore',

  // Scan Run Channels (Phase 2.3 & Batch 3.5)
  SCAN_CREATE: 'scan:create',
  SCAN_GET: 'scan:get',
  SCAN_LIST: 'scan:list',
  SCAN_CANCEL: 'scan:cancel',
  SCAN_PROGRESS: 'scan:progress',

  // Finding Channels (Phase 2.3)
  FINDING_LIST: 'finding:list',
  FINDING_GET: 'finding:get',

  // Report Channels (Phase 2.3 & Batch 3.6)
  REPORT_CREATE: 'report:create',
  REPORT_GET: 'report:get',
  REPORT_LIST: 'report:list',
  REPORT_DELETE: 'report:delete',
  REPORT_GET_CONTENT: 'report:get-content',
} as const;

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const IPC_CHANNEL_LIST: readonly IPCChannel[] = Object.freeze(Object.values(IPC_CHANNELS));

export function isIPCChannel(channel: string): channel is IPCChannel {
  return IPC_CHANNEL_LIST.includes(channel as IPCChannel);
}
