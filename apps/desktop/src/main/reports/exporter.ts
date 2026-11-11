import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { IPCError, IPC_ERROR_CODES } from '@auditor/shared';
import {
  ensureReportsDirectory,
  resolveSafeReportPath,
  generateUniqueReportFilePath,
  type ReportPathOptions,
} from './paths.js';

export interface SaveReportOptions {
  readonly filename: string;
  readonly directory?: string;
  readonly overwrite?: boolean;
}

export interface SaveReportResult {
  readonly storagePath: string;
  readonly bytesWritten: number;
}

const MAX_READ_BYTES = 20 * 1024 * 1024; // 20 MB max file read limit

/**
 * Persists report content to the application-managed reports directory atomically.
 * Process:
 * 1. Validates directory confinement (path traversal guard).
 * 2. Writes to a temporary file (`.tmp-<uuid>`) in the reports directory.
 * 3. Resolves collision / unique filename if overwrite is false.
 * 4. Atomically promotes temp file via fs.renameSync.
 * 5. Validates file existence and byte size.
 */
export function saveReportToFile(
  content: string,
  options: SaveReportOptions,
): SaveReportResult {
  const dir = ensureReportsDirectory(options.directory);

  let targetPath: string;
  if (options.overwrite) {
    targetPath = resolveSafeReportPath(options.filename, dir);
  } else {
    targetPath = generateUniqueReportFilePath(options.filename, dir);
  }

  const tempFilename = `.tmp-${crypto.randomUUID()}`;
  const tempPath = path.join(dir, tempFilename);

  try {
    // Write atomically to temporary file first
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', flush: true });

    // Atomically promote temp file to target path
    fs.renameSync(tempPath, targetPath);

    const stats = fs.statSync(targetPath);
    if (stats.size === 0 && content.length > 0) {
      throw new Error('Report file created with zero bytes');
    }

    return {
      storagePath: targetPath,
      bytesWritten: stats.size,
    };
  } catch (err: unknown) {
    // Clean up temporary file if write or rename failed
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Best-effort cleanup
    }

    const code = (err as { code?: string })?.code;
    if (code === 'ENOSPC') {
      throw new IPCError(
        'Insufficient disk space to save audit report',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new IPCError(
        'Filesystem permission denied when saving audit report',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }

    if (err instanceof IPCError) throw err;
    throw new IPCError(
      `Failed to export report file: ${err instanceof Error ? err.message : String(err)}`,
      IPC_ERROR_CODES.INTERNAL_ERROR,
    );
  }
}

/**
 * Safely reads a generated report file's contents for in-application viewing.
 * Strictly verifies directory confinement and bounds memory reading.
 */
export function readReportFile(storagePath: string, directory?: string): string {
  const safePath = resolveSafeReportPath(storagePath, directory);

  if (!fs.existsSync(safePath)) {
    throw new IPCError(
      `Report file not found on disk at '${safePath}'`,
      IPC_ERROR_CODES.REPORT_NOT_FOUND,
    );
  }

  const stat = fs.statSync(safePath);
  if (stat.size > MAX_READ_BYTES) {
    throw new IPCError(
      `Report file exceeds maximum allowable read size (${stat.size} bytes > ${MAX_READ_BYTES} bytes)`,
      IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
    );
  }

  try {
    return fs.readFileSync(safePath, 'utf8');
  } catch (err) {
    throw new IPCError(
      `Failed to read report file: ${err instanceof Error ? err.message : String(err)}`,
      IPC_ERROR_CODES.INTERNAL_ERROR,
    );
  }
}

/**
 * Safely removes a generated report file from disk.
 * Strictly enforces directory confinement.
 */
export function deleteReportFile(storagePath: string, directory?: string): boolean {
  try {
    const safePath = resolveSafeReportPath(storagePath, directory);
    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Cleans up any leftover temporary export files (.tmp-*) in the reports directory.
 * Useful during startup reconciliation to prevent orphaned temporary files.
 */
export function cleanupTemporaryReportFiles(directory?: string | ReportPathOptions): number {
  try {
    const dir = ensureReportsDirectory(directory);
    const files = fs.readdirSync(dir);
    let cleaned = 0;
    for (const file of files) {
      if (file.startsWith('.tmp-')) {
        try {
          fs.unlinkSync(path.join(dir, file));
          cleaned++;
        } catch {
          // Best effort
        }
      }
    }
    return cleaned;
  } catch {
    return 0;
  }
}

export interface ReportReconciliationResult {
  readonly scannedFiles: number;
  readonly activeReports: number;
  readonly tempFilesCleaned: number;
  readonly orphanFilesDeleted: number;
  readonly errors: readonly string[];
}

/**
 * Reconciles the reports directory against the active database records:
 * 1. Cleans up any leftover temporary export files (.tmp-*).
 * 2. Compares physical files in reports directory against active database storage_path records.
 * 3. Safely deletes unreferenced orphan report files from previous crashes or failed deletions.
 * 4. NEVER deletes files outside reportsDir, never deletes active database reports.
 */
export function reconcileReportsStorage(
  activeStoragePaths: ReadonlySet<string>,
  directory?: string | ReportPathOptions,
): ReportReconciliationResult {
  const dir = ensureReportsDirectory(directory);
  let scannedFiles = 0;
  let tempFilesCleaned = 0;
  let orphanFilesDeleted = 0;
  const errors: string[] = [];

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return {
      scannedFiles: 0,
      activeReports: activeStoragePaths.size,
      tempFilesCleaned: 0,
      orphanFilesDeleted: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  // Normalize active paths set for reliable case-insensitive path matching on Windows
  const normalizedActive = new Set<string>();
  for (const p of activeStoragePaths) {
    normalizedActive.add(path.resolve(p).toLowerCase());
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    scannedFiles++;
    const filename = entry.name;
    const fullPath = path.join(dir, filename);

    // 1. Temporary files from interrupted writes
    if (filename.startsWith('.tmp-')) {
      try {
        fs.unlinkSync(fullPath);
        tempFilesCleaned++;
      } catch (err) {
        errors.push(
          `Failed cleaning temp file '${filename}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    // 2. Check if this is an authorized report format file (.html, .json, .pdf, .csv)
    const ext = path.extname(filename).toLowerCase();
    if (!['.html', '.json', '.pdf', '.csv'].includes(ext)) {
      // Don't touch unrecognized files
      continue;
    }

    // 3. Check if file is referenced by an active report in the database
    const normalizedTarget = path.resolve(fullPath).toLowerCase();
    if (normalizedActive.has(normalizedTarget)) {
      // Referenced by active report - DO NOT DELETE
      continue;
    }

    // 4. File is an orphaned report deliverable in reportsDir with no database reference
    try {
      const safePath = resolveSafeReportPath(fullPath, dir);
      fs.unlinkSync(safePath);
      orphanFilesDeleted++;
    } catch (err) {
      errors.push(
        `Failed deleting orphan report '${filename}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    scannedFiles,
    activeReports: activeStoragePaths.size,
    tempFilesCleaned,
    orphanFilesDeleted,
    errors,
  };
}
