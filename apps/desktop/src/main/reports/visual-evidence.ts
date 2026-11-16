import fs from 'node:fs';
import path from 'node:path';
import type { FindingDTO } from '@auditor/shared';
import { getScreenshotsDirectory, type ReportPathOptions } from './paths.js';
import { redactUrl } from '../browser/redactor.js';

export const MAX_EMBEDDED_SCREENSHOT_BYTES = 2 * 1024 * 1024; // 2 MB raw image limit
export const MAX_TOTAL_EMBEDDED_EVIDENCE_BYTES = 14 * 1024 * 1024; // ~14 MB data-URI budget inside HTML (< 20 MB MAX_READ_BYTES)

export interface ReportVisualEvidenceEntry {
  readonly fileName: string;
  readonly byteLength: number;
  readonly embedded: boolean;
  readonly mimeType?: string;
  readonly dataUri?: string;
  readonly omittedReason?: string;
  readonly pageUrl?: string;
  readonly viewport?: string;
  readonly viewportCategory?: string;
  readonly width?: number;
  readonly height?: number;
  readonly captureType?: string;
  readonly status?: string;
}

export interface ResolveVisualEvidenceOptions {
  readonly screenshotsDir?: string | ReportPathOptions;
  readonly maxSingleImageBytes?: number;
  readonly maxTotalEmbeddedBytes?: number;
  readonly pageScreenshots?: readonly Record<string, unknown>[];
}

const MIME_BY_EXT: Readonly<Record<string, string>> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
});

/**
 * Computes a deterministic lookup key for a finding's `evidence.screenshot` object.
 */
export function getScreenshotEvidenceKey(screenshot: Record<string, unknown>): string | null {
  const fileName =
    typeof screenshot.fileName === 'string' && screenshot.fileName.trim().length > 0
      ? screenshot.fileName.trim()
      : null;
  if (fileName) {
    return fileName;
  }
  const relativePath =
    typeof screenshot.relativePath === 'string' && screenshot.relativePath.trim().length > 0
      ? screenshot.relativePath.trim()
      : null;
  if (relativePath) {
    return relativePath;
  }
  const id =
    typeof screenshot.id === 'string' && screenshot.id.trim().length > 0
      ? screenshot.id.trim()
      : null;
  const format =
    typeof screenshot.format === 'string' && screenshot.format.trim().length > 0
      ? screenshot.format.trim()
      : 'png';
  return id ? `${id}.${format}` : null;
}

/**
 * Safely resolves local screenshot files referenced by finding evidence into bounded base64 data URIs
 * confined strictly to the screenshots storage directory, obeying strict HTML CSP (`img-src 'self' data:`).
 */
export function resolveReportVisualEvidence(
  findings: readonly FindingDTO[],
  options?: ResolveVisualEvidenceOptions,
): Readonly<Record<string, ReportVisualEvidenceEntry>> {
  const baseDir = path.resolve(getScreenshotsDirectory(options?.screenshotsDir));
  const realBaseDir = fs.existsSync(baseDir) ? fs.realpathSync(baseDir) : baseDir;
  const maxSingleBytes = options?.maxSingleImageBytes ?? MAX_EMBEDDED_SCREENSHOT_BYTES;
  const maxTotalBytes = options?.maxTotalEmbeddedBytes ?? MAX_TOTAL_EMBEDDED_EVIDENCE_BYTES;

  const entries: Record<string, ReportVisualEvidenceEntry> = {};
  const dataUriByResolvedPath = new Map<string, { mimeType: string; dataUri: string; rawBytes: number }>();
  let totalEmbeddedChars = 0;

  const candidateRecords: Record<string, unknown>[] = [];
  for (const finding of findings) {
    const ev =
      finding.evidence && typeof finding.evidence === 'object'
        ? (finding.evidence as Record<string, unknown>)
        : null;
    if (ev?.screenshot && typeof ev.screenshot === 'object') {
      candidateRecords.push({
        ...(ev.screenshot as Record<string, unknown>),
        pageUrl:
          typeof (ev.screenshot as Record<string, unknown>).pageUrl === 'string'
            ? (ev.screenshot as Record<string, unknown>).pageUrl
            : finding.targetUrl,
      });
    }
  }
  if (Array.isArray(options?.pageScreenshots)) {
    for (const rec of options.pageScreenshots) {
      if (rec && typeof rec === 'object') {
        candidateRecords.push(rec);
      }
    }
  }

  for (const sc of candidateRecords) {
    const key = getScreenshotEvidenceKey(sc);
    if (!key || Object.hasOwn(entries, key)) {
      continue;
    }

    const rawPageUrl =
      typeof sc.pageUrl === 'string' && sc.pageUrl.trim() ? sc.pageUrl.trim() : undefined;
    const pageUrl = rawPageUrl ? redactUrl(rawPageUrl) : undefined;
    const viewport =
      typeof sc.viewportProfile === 'string' && sc.viewportProfile.trim()
        ? sc.viewportProfile.trim()
        : typeof sc.viewport === 'string' && sc.viewport.trim()
          ? sc.viewport.trim()
          : typeof sc.viewportName === 'string' && sc.viewportName.trim()
            ? sc.viewportName.trim()
            : undefined;
    const viewportCategory =
      typeof sc.viewportCategory === 'string' && sc.viewportCategory.trim()
        ? sc.viewportCategory.trim()
        : undefined;
    const width =
      typeof sc.width === 'number' && Number.isFinite(sc.width) && sc.width > 0
        ? Math.round(sc.width)
        : undefined;
    const height =
      typeof sc.height === 'number' && Number.isFinite(sc.height) && sc.height > 0
        ? Math.round(sc.height)
        : undefined;
    const captureType =
      typeof sc.captureType === 'string' && sc.captureType.trim()
        ? sc.captureType.trim()
        : undefined;
    const status =
      typeof sc.status === 'string' && sc.status.trim() ? sc.status.trim() : undefined;

    const meta = {
      ...(pageUrl ? { pageUrl } : {}),
      ...(viewport ? { viewport } : {}),
      ...(viewportCategory ? { viewportCategory } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(captureType ? { captureType } : {}),
      ...(status ? { status } : {}),
    };

    if (status && status !== 'captured') {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
        ...meta,
        omittedReason: `Visual preview unavailable: screenshot status is ${status}.`,
      };
      continue;
    }

    if (path.isAbsolute(key) || key.includes('..')) {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
        ...meta,
        omittedReason: 'Visual preview omitted: invalid or non-confined screenshot path.',
      };
      continue;
    }

    const ext = path.extname(key).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
        ...meta,
        omittedReason: `Visual preview omitted: unsupported image format (${ext || 'unknown'}).`,
      };
      continue;
    }

    const resolved = path.resolve(baseDir, key);
    const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : `${baseDir}${path.sep}`;
    if (resolved === baseDir || !resolved.startsWith(baseWithSep)) {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
        ...meta,
        omittedReason: 'Visual preview omitted: path traversal outside screenshots directory rejected.',
      };
      continue;
    }

    if (!fs.existsSync(resolved)) {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
        ...meta,
        omittedReason: 'Visual preview unavailable: screenshot file missing on disk.',
      };
      continue;
    }

    let realResolved: string;
    try {
      realResolved = fs.realpathSync(resolved);
    } catch {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
        ...meta,
        omittedReason: 'Visual preview unavailable: could not resolve screenshot path.',
      };
      continue;
    }

    const realBaseWithSep = realBaseDir.endsWith(path.sep)
      ? realBaseDir
      : `${realBaseDir}${path.sep}`;
    if (realResolved === realBaseDir || !realResolved.startsWith(realBaseWithSep)) {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
        ...meta,
        omittedReason: 'Visual preview omitted: symlink escape outside screenshots directory rejected.',
      };
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(realResolved);
    } catch {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
        ...meta,
        omittedReason: 'Visual preview unavailable: screenshot file unreadable.',
      };
      continue;
    }

    if (!stat.isFile() || stat.size <= 0) {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
        ...meta,
        omittedReason: 'Visual preview unavailable: screenshot file is empty.',
      };
      continue;
    }

    if (stat.size > maxSingleBytes) {
      entries[key] = {
        fileName: key,
        byteLength: stat.size,
        embedded: false,
        ...meta,
        omittedReason: `Visual preview omitted: screenshot size (${Math.round(stat.size / 1024)} KB) exceeds per-image embed cap (${Math.round(maxSingleBytes / 1024)} KB).`,
      };
      continue;
    }

    let cached = dataUriByResolvedPath.get(realResolved);
    if (!cached) {
      try {
        const buffer = fs.readFileSync(realResolved);
        const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;
        cached = { mimeType, dataUri, rawBytes: buffer.length };
        dataUriByResolvedPath.set(realResolved, cached);
      } catch {
        entries[key] = {
          fileName: key,
          byteLength: stat.size,
          embedded: false,
          ...meta,
          omittedReason: 'Visual preview unavailable: failed to read screenshot bytes.',
        };
        continue;
      }
    }

    if (totalEmbeddedChars + cached.dataUri.length > maxTotalBytes) {
      entries[key] = {
        fileName: key,
        byteLength: cached.rawBytes,
        embedded: false,
        ...meta,
        omittedReason: 'Visual preview omitted: HTML visual embed size budget exceeded.',
      };
      continue;
    }

    totalEmbeddedChars += cached.dataUri.length;
    entries[key] = {
      fileName: key,
      byteLength: cached.rawBytes,
      embedded: true,
      mimeType: cached.mimeType,
      dataUri: cached.dataUri,
      ...meta,
    };
  }

  return Object.freeze(entries);
}
