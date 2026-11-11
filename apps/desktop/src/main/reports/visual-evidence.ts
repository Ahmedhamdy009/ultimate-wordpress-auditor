import fs from 'node:fs';
import path from 'node:path';
import type { FindingDTO } from '@auditor/shared';
import { getScreenshotsDirectory, type ReportPathOptions } from './paths.js';

export const MAX_EMBEDDED_SCREENSHOT_BYTES = 2 * 1024 * 1024; // 2 MB raw image limit
export const MAX_TOTAL_EMBEDDED_EVIDENCE_BYTES = 14 * 1024 * 1024; // ~14 MB data-URI budget inside HTML (< 20 MB MAX_READ_BYTES)

export interface ReportVisualEvidenceEntry {
  readonly fileName: string;
  readonly byteLength: number;
  readonly embedded: boolean;
  readonly mimeType?: string;
  readonly dataUri?: string;
  readonly omittedReason?: string;
}

export interface ResolveVisualEvidenceOptions {
  readonly screenshotsDir?: string | ReportPathOptions;
  readonly maxSingleImageBytes?: number;
  readonly maxTotalEmbeddedBytes?: number;
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
  const id =
    typeof screenshot.id === 'string' && screenshot.id.trim().length > 0
      ? screenshot.id.trim()
      : null;
  return id ? `${id}.png` : null;
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

  for (const finding of findings) {
    const ev =
      finding.evidence && typeof finding.evidence === 'object'
        ? (finding.evidence as Record<string, unknown>)
        : null;
    const sc =
      ev?.screenshot && typeof ev.screenshot === 'object'
        ? (ev.screenshot as Record<string, unknown>)
        : null;
    if (!sc) {
      continue;
    }

    const key = getScreenshotEvidenceKey(sc);
    if (!key || Object.hasOwn(entries, key)) {
      continue;
    }

    if (path.isAbsolute(key) || key.includes('..')) {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
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
        omittedReason: 'Visual preview omitted: path traversal outside screenshots directory rejected.',
      };
      continue;
    }

    if (!fs.existsSync(resolved)) {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
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
        omittedReason: 'Visual preview unavailable: screenshot file unreadable.',
      };
      continue;
    }

    if (!stat.isFile() || stat.size <= 0) {
      entries[key] = {
        fileName: key,
        byteLength: 0,
        embedded: false,
        omittedReason: 'Visual preview unavailable: screenshot file is empty.',
      };
      continue;
    }

    if (stat.size > maxSingleBytes) {
      entries[key] = {
        fileName: key,
        byteLength: stat.size,
        embedded: false,
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
    };
  }

  return Object.freeze(entries);
}
