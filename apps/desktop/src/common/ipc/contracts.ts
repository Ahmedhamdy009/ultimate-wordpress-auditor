import type {
  IPCResult,
  AppPingResponse,
  AppSystemInfoResponse,
  AuditValidateTargetRequest,
  AuditValidateTargetResponse,
} from '@auditor/shared';

/**
 * Canonical strongly typed interface for the secure Electron Preload-to-Renderer bridge.
 * Shared across Preload and Renderer via type-only imports without circular runtime dependencies.
 */
export interface ElectronAPI {
  readonly ping: () => Promise<IPCResult<AppPingResponse>>;
  readonly getSystemInfo: () => Promise<IPCResult<AppSystemInfoResponse>>;
  readonly validateTarget: (
    request: AuditValidateTargetRequest,
  ) => Promise<IPCResult<AuditValidateTargetResponse>>;
}

/**
 * Standard typed IPC response envelope.
 * Masks internal errors and stack traces from the renderer.
 */
export type IpcResult<T> = IPCResult<T>;

export interface SystemInfoData {
  platform: string;
  arch: string;
  version: string;
}

export interface PingData {
  pong: boolean;
  timestamp: number;
}

export interface ValidateTargetResultData {
  valid: boolean;
  normalized?: string;
  reason?: string;
}
