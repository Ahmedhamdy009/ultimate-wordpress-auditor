/**
 * Centralized IPC channel allowlist.
 * Shared between Main and Preload environments without circular dependencies.
 */
export const ALLOWED_IPC_CHANNELS = {
  PING: 'app:ping',
  GET_SYSTEM_INFO: 'app:get-system-info',
  VALIDATE_TARGET: 'audit:validate-target',
} as const;

export type IpcChannel = (typeof ALLOWED_IPC_CHANNELS)[keyof typeof ALLOWED_IPC_CHANNELS];
