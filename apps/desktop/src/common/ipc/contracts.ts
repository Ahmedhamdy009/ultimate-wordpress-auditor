/**
 * Standard typed IPC response envelope.
 * Masks internal errors and stack traces from the renderer.
 */
export type IpcResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
      };
    };

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
