import { app, type IpcMainInvokeEvent, type WebContents, type WebFrameMain } from 'electron';
import { IPCSecurityError, IPC_ERROR_CODES } from '@auditor/shared';
import { WindowSecurityRegistry } from '../security/registry.js';
import { SecurityWebRequestManager } from '../security/csp.js';

export interface SenderGuardOptions {
  /**
   * Trusted environment mode strictly determined by the Main Process.
   * If provided, must match the registered Session configuration.
   */
  readonly isDev?: boolean;
  /**
   * Trusted packaging status determined by the Main Process.
   * Defaults to app.isPackaged.
   */
  readonly isPackaged?: boolean;
}

export type SenderValidationResult =
  | {
      readonly isValid: true;
      readonly webContents: WebContents;
      readonly frame: WebFrameMain;
    }
  | {
      readonly isValid: false;
      readonly error: IPCSecurityError;
    };

/**
 * Hardened IPC Sender Guard.
 * Centralized, fail-closed validation of IPC sender identity, frame hierarchy,
 * window liveness, security configuration, and renderer origin before any IPC handler executes.
 */
export class SenderGuard {
  /**
   * Strictly validates the sender of an incoming IPC invocation.
   * ALWAYS enforces mandatory fail-closed Session registration in SecurityWebRequestManager.
   */
  public static validateSender(
    event: IpcMainInvokeEvent,
    options?: SenderGuardOptions,
  ): SenderValidationResult {
    // 1. Verify event and sender existence
    if (!event || !event.sender) {
      return {
        isValid: false,
        error: new IPCSecurityError(
          'Missing event or sender WebContents',
          IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
        ),
      };
    }

    const { sender, senderFrame } = event;

    // 2. Verify sender WebContents is not destroyed
    if (sender.isDestroyed()) {
      return {
        isValid: false,
        error: new IPCSecurityError(
          'Sender WebContents is destroyed',
          IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
        ),
      };
    }

    // 3. Resolve and verify authoritative environment trust configuration from Main Process
    const targetSession = sender.session;
    const sessionConfig = targetSession
      ? SecurityWebRequestManager.getSessionConfig(targetSession)
      : undefined;

    // Fail-Closed: IPC requests MUST originate from a Session previously registered in SecurityWebRequestManager
    if (!sessionConfig) {
      return {
        isValid: false,
        error: new IPCSecurityError(
          'Sender WebContents session is not registered in SecurityWebRequestManager',
          IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
        ),
      };
    }

    // Reject conflicting environment trust configuration
    if (options?.isDev !== undefined && sessionConfig.isDev !== options.isDev) {
      return {
        isValid: false,
        error: new IPCSecurityError(
          'Conflicting session environment trust configuration',
          IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
        ),
      };
    }

    // Authoritative isDev: strictly from registered sessionConfig
    const isDev = sessionConfig.isDev;
    const isPackaged = options?.isPackaged ?? app?.isPackaged ?? false;

    // 4. Verify senderFrame exists
    if (!senderFrame) {
      return {
        isValid: false,
        error: new IPCSecurityError(
          'Missing senderFrame on IPC invocation',
          IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
        ),
      };
    }

    // 5. Verify senderFrame is the Main Frame (reject subframes / iframes)
    if (senderFrame !== sender.mainFrame) {
      return {
        isValid: false,
        error: new IPCSecurityError(
          'Sender frame is not the main frame',
          IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
        ),
      };
    }

    // 6. Verify senderFrame has no parent (reject nested frames)
    if (senderFrame.parent !== null) {
      return {
        isValid: false,
        error: new IPCSecurityError(
          'Sender frame has a parent frame',
          IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
        ),
      };
    }

    // 7. Verify WebContents registration, BrowserWindow liveness, and security snapshot
    const registryCheck = WindowSecurityRegistry.verifyLivenessAndSecurity(sender);
    if (!registryCheck.isValid) {
      return {
        isValid: false,
        error: new IPCSecurityError(
          'Sender failed WindowSecurityRegistry liveness and security verification',
          IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
        ),
      };
    }

    // 8. Verify Renderer Origin (reusing SecurityWebRequestManager.isAppRendererOrigin)
    const frameUrl = senderFrame.url;
    if (!frameUrl || typeof frameUrl !== 'string') {
      return {
        isValid: false,
        error: new IPCSecurityError(
          'Sender frame has an invalid or missing URL',
          IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
        ),
      };
    }

    const isOriginApproved = SecurityWebRequestManager.isAppRendererOrigin(
      frameUrl,
      isDev,
      isPackaged,
    );
    if (!isOriginApproved) {
      return {
        isValid: false,
        error: new IPCSecurityError(
          'Sender frame origin is not authorized',
          IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
        ),
      };
    }

    return {
      isValid: true,
      webContents: sender,
      frame: senderFrame,
    };
  }
}
