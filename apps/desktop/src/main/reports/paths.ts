import path from 'node:path';
import fs from 'node:fs';
import * as electronModule from 'electron';
import { IPCError, IPC_ERROR_CODES } from '@auditor/shared';
import { PROJECT_ROOT, resolveExplicitUserDataDirectory } from '../config/paths.js';
import { getProductionUserDataDirectory } from '../db/paths.js';

export const DEFAULT_REPORTS_DIR = path.join(PROJECT_ROOT, 'reports');

export interface ReportPathOptions {
  customDir?: string;
  isDev?: boolean;
}

/**
 * Returns the application-managed reports directory.
 * Hierarchy:
 * 1. customDir if provided (for isolated unit/integration tests).
 * 2. In packaged production (or explicit isDev: false):
 *    - Resolves to standard writable user data directory: getProductionUserDataDirectory()/reports
 *      (e.g. %APPDATA%/ultimate-wordpress-and-website-auditor/reports on Windows)
 *    - Never stores reports in the application installation directory.
 * 3. In development / testing:
 *    - Strictly preserved on Drive D: at D:\ahmed\reports (DEFAULT_REPORTS_DIR).
 */
export function getReportsDirectory(options?: string | ReportPathOptions): string {
  const customDir = typeof options === 'string' ? options : options?.customDir;
  if (customDir) {
    return path.resolve(customDir);
  }

  const explicitUserData = resolveExplicitUserDataDirectory();
  if (explicitUserData) {
    return path.join(explicitUserData, 'reports');
  }

  const isDev = typeof options === 'object' ? options?.isDev : undefined;

  if (isDev === false) {
    return path.join(getProductionUserDataDirectory(), 'reports');
  }

  try {
    if (Object.hasOwn(electronModule, 'app')) {
      const electronApp = (
        electronModule as { app?: { getPath(name: string): string; isPackaged?: boolean } }
      ).app;
      if (electronApp && typeof electronApp.getPath === 'function' && electronApp.isPackaged) {
        const userData = electronApp.getPath('userData');
        if (userData) {
          return path.join(path.resolve(userData), 'reports');
        }
      }
    }
  } catch {
    // Outside Electron runtime
  }

  return path.resolve(DEFAULT_REPORTS_DIR);
}

/**
 * Ensures the reports directory exists synchronously.
 */
export function ensureReportsDirectory(reportsDir?: string | ReportPathOptions): string {
  const dir = getReportsDirectory(reportsDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Returns the resolved screenshots storage directory.
 * Hierarchy:
 * 1. customDir if provided (for isolated unit/integration tests).
 * 2. In packaged production (or explicit isDev: false):
 *    - Resolves to: getReportsDirectory({ isDev: false })/screenshots
 *      (e.g. %APPDATA%/ultimate-wordpress-and-website-auditor/reports/screenshots on Windows)
 *    - Never depends on D:\ahmed, the source repository, or development caches.
 * 3. In development / testing:
 *    - Strictly preserved on Drive D: at D:\ahmed\reports\screenshots.
 */
export function getScreenshotsDirectory(options?: string | ReportPathOptions): string {
  const customDir = typeof options === 'string' ? options : options?.customDir;
  if (customDir) {
    return path.resolve(customDir);
  }
  return path.join(getReportsDirectory(options), 'screenshots');
}

/**
 * Ensures the screenshots directory exists synchronously.
 */
export function ensureScreenshotsDirectory(screenshotsDir?: string | ReportPathOptions): string {
  const dir = getScreenshotsDirectory(screenshotsDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Sanitizes a title/name to create a safe filesystem filename.
 * Strips path traversal sequences, illegal Windows characters, and control characters.
 */
export function sanitizeReportFilename(title: string, format: string, suffix?: string): string {
  const safeExt = format.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!safeExt) {
    throw new IPCError('Invalid report format extension', IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
  }

  // Strip illegal Windows filename characters: < > : " / \ | ? * and control chars
  let cleanTitle = (title || 'audit-report')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^[.\-]+|[.\-]+$/g, '');

  if (!cleanTitle || cleanTitle.length === 0) {
    cleanTitle = 'audit-report';
  }

  // Truncate to safe length
  if (cleanTitle.length > 80) {
    cleanTitle = cleanTitle.slice(0, 80);
  }

  const cleanSuffix = suffix ? `-${suffix.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
  return `${cleanTitle}${cleanSuffix}.${safeExt}`;
}

/**
 * Validates that a filename or path resides strictly within the application-managed reports directory.
 * Prevents directory traversal attacks (e.g. ../../windows/system32).
 */
export function resolveSafeReportPath(
  filenameOrPath: string,
  reportsDir?: string | ReportPathOptions,
): string {
  const baseDir = path.resolve(getReportsDirectory(reportsDir));
  
  // If the argument is an absolute path, verify it is inside baseDir
  // If it is a filename or relative path, resolve it against baseDir
  const resolved = path.isAbsolute(filenameOrPath)
    ? path.resolve(filenameOrPath)
    : path.resolve(baseDir, filenameOrPath);

  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : `${baseDir}${path.sep}`;

  if (resolved !== baseDir && !resolved.startsWith(baseWithSep)) {
    throw new IPCError(
      `Path traversal rejected: '${filenameOrPath}' is outside the authorized reports directory`,
      IPC_ERROR_CODES.PATH_TRAVERSAL,
    );
  }

  // Prevent symlink escape if target already exists on disk
  if (fs.existsSync(resolved)) {
    const realResolved = fs.realpathSync(resolved);
    const realBaseDir = fs.existsSync(baseDir) ? fs.realpathSync(baseDir) : baseDir;
    const realBaseWithSep = realBaseDir.endsWith(path.sep) ? realBaseDir : `${realBaseDir}${path.sep}`;
    if (realResolved !== realBaseDir && !realResolved.startsWith(realBaseWithSep)) {
      throw new IPCError(
        `Symlink escape rejected: '${filenameOrPath}' resolves outside the authorized reports directory`,
        IPC_ERROR_CODES.PATH_TRAVERSAL,
      );
    }
  }

  return resolved;
}

/**
 * Generates an unused, unique filepath inside the reports directory.
 * If target exists, increments `-1`, `-2`, etc.
 */
export function generateUniqueReportFilePath(
  baseFilename: string,
  reportsDir?: string | ReportPathOptions,
): string {
  const dir = ensureReportsDirectory(reportsDir);
  const parsed = path.parse(baseFilename);
  let candidate = path.join(dir, `${parsed.name}${parsed.ext}`);
  let counter = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${parsed.name}-${counter}${parsed.ext}`);
    counter++;
  }

  return candidate;
}
