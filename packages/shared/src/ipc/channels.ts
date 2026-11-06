/**
 * Strongly typed IPC Channels for Ultimate WordPress & Website Auditor.
 * Strict enum/const pattern ensures compile-time validation of channel names.
 */

export const IPC_CHANNELS = {
  APP_PING: 'app:ping',
  APP_GET_SYSTEM_INFO: 'app:get-system-info',
  AUDIT_VALIDATE_TARGET: 'audit:validate-target',
} as const;

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const IPC_CHANNEL_LIST: readonly IPCChannel[] = Object.freeze(Object.values(IPC_CHANNELS));

export function isIPCChannel(channel: string): channel is IPCChannel {
  return IPC_CHANNEL_LIST.includes(channel as IPCChannel);
}
