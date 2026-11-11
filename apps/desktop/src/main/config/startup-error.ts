import fs from 'node:fs';
import path from 'node:path';
import * as electronModule from 'electron';
import { DESKTOP_STORAGE_PATHS } from './paths.js';
import { getProductionUserDataDirectory } from '../db/paths.js';

export interface StartupErrorOptions {
  readonly showDialog?: boolean;
  readonly logDir?: string;
  readonly source?: string;
  readonly dialogApi?: {
    showErrorBox(title: string, content: string): void;
  };
  readonly fsApi?: {
    mkdirSync(p: string, opts?: fs.MakeDirectoryOptions): unknown;
    appendFileSync(p: string, data: string, encoding: BufferEncoding): void;
  };
}

export interface StartupErrorResult {
  readonly logged: boolean;
  readonly logPath?: string;
  readonly sanitizedMessage: string;
  readonly dialogShown: boolean;
}

const SENSITIVE_PATTERNS: readonly [RegExp, string][] = [
  [/(bearer\s+)[a-zA-Z0-9_.-]{10,}/gi, '$1[REDACTED_TOKEN]'],
  [
    /((?:token|key|secret|password|passwd|pwd|auth|apikey|api_key)\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    '$1[REDACTED_SECRET]',
  ],
  [/([?&](?:token|key|secret|password|auth|api_key)=)[^\s&"'`<>]+/gi, '$1[REDACTED_QUERY]'],
  [/(postgres(?:ql)?|mysql|sqlite|mongodb):\/\/[^@\s]+@/gi, '$1://[REDACTED_CREDENTIALS]@'],
];

function isErrorLike(val: unknown): val is { name?: string; message?: string; stack?: string } {
  return (
    val instanceof Error ||
    (typeof val === 'object' &&
      val !== null &&
      ('name' in val || 'message' in val || 'stack' in val))
  );
}

/**
 * Sanitizes arbitrary error messages and stack traces to ensure no sensitive
 * tokens, passwords, database credentials, or secret keys are leaked into logs or dialogs.
 */
export function sanitizeErrorMessage(input: unknown): string {
  if (input === null || input === undefined) {
    return 'Unknown error (null or undefined)';
  }

  let text = typeof input === 'string' ? input : '';
  if (!text) {
    if (isErrorLike(input)) {
      const msg = `${input.name || 'Error'}: ${input.message || ''}`;
      const stack = input.stack ? String(input.stack) : '';
      text =
        stack && input.message && stack.includes(input.message) ? stack : `${msg}\n${stack}`.trim();
    } else {
      try {
        text = JSON.stringify(input);
      } catch {
        text = String(input);
      }
    }
  }

  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    text = text.replace(pattern, replacement);
  }

  return text;
}

/**
 * Resolves the persistent startup error log directory.
 * Hierarchy:
 * 1. custom logDir from options.
 * 2. Electron app.getPath('logs') if available.
 * 3. getProductionUserDataDirectory()/logs.
 */
export function resolveStartupLogDirectory(customDir?: string): string {
  if (customDir) {
    return path.resolve(customDir);
  }

  try {
    if (Object.hasOwn(electronModule, 'app')) {
      const electronApp = (
        electronModule as unknown as {
          app?: { getPath(name: string): string; isPackaged?: boolean };
        }
      ).app;
      if (electronApp && typeof electronApp.getPath === 'function') {
        const logs = electronApp.getPath('logs');
        if (logs) {
          return path.resolve(logs);
        }
      }
    }
  } catch {
    // Outside Electron runtime
  }

  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return path.join(DESKTOP_STORAGE_PATHS.logsDir, 'test-startup-errors');
  }

  return path.join(getProductionUserDataDirectory(), 'logs');
}

/**
 * Safely handles application startup errors:
 * 1. Sanitizes error message and stack trace (stripping secrets).
 * 2. Persists structured error entry to startup-error.log (guaranteed non-fatal if fs fails).
 * 3. Displays user-facing error dialog via Electron dialog.showErrorBox().
 */
export function handleStartupError(
  error: unknown,
  options?: StartupErrorOptions,
): StartupErrorResult {
  const sanitized = sanitizeErrorMessage(error);
  const source = options?.source ?? 'startup';
  const timestamp = new Date().toISOString();

  let logPath: string | undefined;
  let logged = false;

  // Step 1: Attempt persistent logging under userData/logs
  try {
    const fsApi = options?.fsApi ?? fs;
    const logDir = resolveStartupLogDirectory(options?.logDir);
    logPath = path.join(logDir, 'startup-error.log');

    fsApi.mkdirSync(logDir, { recursive: true });

    const logEntry =
      `\n======================================================\n` +
      `[${timestamp}] SOURCE: ${source} (PID: ${process.pid}, Platform: ${process.platform}, Arch: ${process.arch})\n` +
      `ERROR DETAILS:\n${sanitized}\n` +
      `======================================================\n`;

    fsApi.appendFileSync(logPath, logEntry, 'utf-8');
    logged = true;
  } catch (fsErr) {
    // Logging failure must NEVER crash or throw
    console.error('[handleStartupError] Non-fatal log writing failure:', fsErr);
  }

  // Step 2: User-facing error dialog
  let dialogShown = false;
  const showDialog = options?.showDialog !== false;

  if (showDialog) {
    try {
      let dialogApi = options?.dialogApi;
      if (!dialogApi && Object.hasOwn(electronModule, 'dialog')) {
        dialogApi = (
          electronModule as unknown as { dialog?: { showErrorBox(t: string, c: string): void } }
        ).dialog;
      }

      if (dialogApi && typeof dialogApi.showErrorBox === 'function') {
        const firstLine = sanitized.split('\n')[0] || 'Unknown error occurred.';
        const content =
          `The application encountered an unexpected error during initialization and must shut down.\n\n` +
          `Error: ${firstLine}\n\n` +
          (logPath
            ? `Diagnostic details have been recorded in the application log file:\n${logPath}`
            : '');

        dialogApi.showErrorBox('Ultimate WordPress & Website Auditor - Startup Error', content);
        dialogShown = true;
      }
    } catch (dialogErr) {
      // Dialog failure must NEVER crash or throw
      console.error('[handleStartupError] Non-fatal dialog display failure:', dialogErr);
    }
  }

  return {
    logged,
    logPath,
    sanitizedMessage: sanitized,
    dialogShown,
  };
}

export interface GlobalErrorHandlerOptions {
  readonly onFatalExit?: (exitCode: number) => void;
  readonly cleanup?: () => void;
  readonly showDialog?: boolean;
  readonly logDir?: string;
}

let isGlobalHandlersAttached = false;
let activeErrorHandlerOptions: GlobalErrorHandlerOptions | undefined;

/**
 * Attaches global unhandled rejection and uncaught exception handlers
 * for resilient main-process error capture, secret sanitization, and deterministic fail-closed shutdown.
 * Prevents the application from continuing to execute in an undefined or corrupted state following a fatal exception.
 */
export function setupGlobalProcessErrorHandlers(options?: GlobalErrorHandlerOptions): void {
  activeErrorHandlerOptions = options;
  if (isGlobalHandlersAttached) {
    return;
  }
  isGlobalHandlersAttached = true;

  process.on('uncaughtException', (err: Error) => {
    // 1. Sanitize error, record to startup-error.log, and show user-facing dialog
    handleStartupError(err, {
      source: 'uncaughtException',
      showDialog: activeErrorHandlerOptions?.showDialog,
      logDir: activeErrorHandlerOptions?.logDir,
    });

    // 2. Perform synchronous cleanup (e.g. database checkpoint/close)
    try {
      activeErrorHandlerOptions?.cleanup?.();
    } catch (cleanupErr) {
      console.error(
        '[setupGlobalProcessErrorHandlers] Cleanup failure during fatal exit:',
        cleanupErr,
      );
    }

    // 3. Deterministic fatal exit to prevent application corruption
    const exitFn =
      activeErrorHandlerOptions?.onFatalExit ??
      ((code: number) => {
        if (typeof electronModule?.app?.exit === 'function') {
          electronModule.app.exit(code);
        } else if (typeof process?.exit === 'function') {
          process.exit(code);
        }
      });

    exitFn(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    handleStartupError(reason, {
      source: 'unhandledRejection',
      showDialog: activeErrorHandlerOptions?.showDialog,
      logDir: activeErrorHandlerOptions?.logDir,
    });
  });
}
