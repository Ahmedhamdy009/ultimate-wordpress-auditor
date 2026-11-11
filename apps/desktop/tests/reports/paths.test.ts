import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  getReportsDirectory,
  ensureReportsDirectory,
  getScreenshotsDirectory,
  ensureScreenshotsDirectory,
  sanitizeReportFilename,
  resolveSafeReportPath,
  generateUniqueReportFilePath,
} from '../../src/main/reports/paths.js';
import { getProductionUserDataDirectory } from '../../src/main/db/paths.js';

describe('Report Path & Filesystem Confinement', () => {
  const testReportsDir = path.resolve('D:/ahmed/.tmp/test-reports-paths');

  beforeEach(() => {
    fs.mkdirSync(testReportsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testReportsDir)) {
        fs.rmSync(testReportsDir, { recursive: true, force: true });
      }
    } catch {
      // Best effort cleanup
    }
  });

  describe('getReportsDirectory & ensureReportsDirectory', () => {
    it('defaults to D:\\ahmed\\reports when no custom dir is given', () => {
      const defaultDir = getReportsDirectory();
      expect(defaultDir).toBe(path.resolve('D:/ahmed/reports'));
    });

    it('resolves to production user data directory when isDev is false', () => {
      const prodDir = getReportsDirectory({ isDev: false });
      const expectedProdDir = path.join(getProductionUserDataDirectory(), 'reports');
      expect(prodDir).toBe(expectedProdDir);
      expect(prodDir).not.toContain('Program Files');
    });

    it('strictly preserves D:\\ahmed\\reports when isDev is true', () => {
      const devDir = getReportsDirectory({ isDev: true });
      expect(devDir).toBe(path.resolve('D:/ahmed/reports'));
    });

    it('respects custom directory and ensures it exists', () => {
      const customSub = path.join(testReportsDir, 'nested-reports');
      expect(fs.existsSync(customSub)).toBe(false);
      ensureReportsDirectory(customSub);
      expect(fs.existsSync(customSub)).toBe(true);
    });
  });

  describe('getScreenshotsDirectory & ensureScreenshotsDirectory', () => {
    it('defaults to D:\\ahmed\\reports\\screenshots in development', () => {
      const defaultDir = getScreenshotsDirectory();
      expect(defaultDir).toBe(path.resolve('D:/ahmed/reports/screenshots'));
    });

    it('resolves to production user data directory when isDev is false and never contains D:\\ahmed', () => {
      const prodDir = getScreenshotsDirectory({ isDev: false });
      const expectedProdDir = path.join(getProductionUserDataDirectory(), 'reports', 'screenshots');
      expect(prodDir).toBe(expectedProdDir);
      expect(prodDir.toLowerCase()).not.toContain('d:\\ahmed');
    });

    it('respects custom directory and ensures screenshots directory exists', () => {
      const customScreenshots = path.join(testReportsDir, 'nested-screenshots');
      expect(fs.existsSync(customScreenshots)).toBe(false);
      ensureScreenshotsDirectory(customScreenshots);
      expect(fs.existsSync(customScreenshots)).toBe(true);
    });
  });

  describe('sanitizeReportFilename', () => {
    it('sanitizes titles with spaces and special characters', () => {
      const filename = sanitizeReportFilename('My WordPress Audit! <v1.0>', 'html');
      expect(filename).toBe('My-WordPress-Audit!-v1.0.html');
      expect(filename).not.toContain('<');
      expect(filename).not.toContain('>');
      expect(filename).not.toContain(' ');
    });

    it('removes directory traversal tokens (../)', () => {
      const filename = sanitizeReportFilename('../../etc/passwd', 'json');
      expect(filename).not.toContain('/');
      expect(filename).not.toContain('\\');
      expect(filename.endsWith('.json')).toBe(true);
    });

    it('appends suffix cleanly when provided', () => {
      const filename = sanitizeReportFilename('Audit Report', 'html', 'run-123');
      expect(filename).toBe('Audit-Report-run-123.html');
    });

    it('falls back to default name when input title is empty or only special chars', () => {
      const filename = sanitizeReportFilename('   < > : " / \\ | ? *   ', 'html');
      expect(filename).toBe('audit-report.html');
    });

    it('rejects invalid or empty format extensions', () => {
      expect(() => sanitizeReportFilename('Report', '')).toThrow();
    });

    it('truncates excessively long titles to safe lengths', () => {
      const veryLong = 'A'.repeat(200);
      const filename = sanitizeReportFilename(veryLong, 'html');
      expect(filename.length).toBeLessThan(100);
    });
  });

  describe('resolveSafeReportPath & Path Traversal Prevention', () => {
    it('resolves safe relative filenames inside the reports directory', () => {
      const safe = resolveSafeReportPath('report-1.html', testReportsDir);
      expect(safe).toBe(path.join(testReportsDir, 'report-1.html'));
    });

    it('allows absolute paths that reside strictly inside the reports directory', () => {
      const inside = path.join(testReportsDir, 'subfolder', 'report.json');
      const safe = resolveSafeReportPath(inside, testReportsDir);
      expect(safe).toBe(inside);
    });

    it('rejects directory traversal attempts using ../', () => {
      expect(() => {
        resolveSafeReportPath('../outside.html', testReportsDir);
      }).toThrow('Path traversal rejected');
    });

    it('rejects absolute paths targeting external drives or directories', () => {
      expect(() => {
        resolveSafeReportPath('C:\\Windows\\System32\\cmd.exe', testReportsDir);
      }).toThrow('Path traversal rejected');
    });

    it('rejects junction/symlink escapes targeting files outside the reports directory', () => {
      // Create external directory and file
      const externalDir = path.resolve('D:/ahmed/.tmp/test-external-secret');
      fs.mkdirSync(externalDir, { recursive: true });
      const secretFile = path.join(externalDir, 'secret.txt');
      fs.writeFileSync(secretFile, 'super-secret', 'utf8');

      // Create a junction inside testReportsDir pointing to externalDir
      const junctionDir = path.join(testReportsDir, 'evil-junction');
      try {
        fs.symlinkSync(externalDir, junctionDir, 'junction');
        const escapedPath = path.join(junctionDir, 'secret.txt');

        expect(() => {
          resolveSafeReportPath(escapedPath, testReportsDir);
        }).toThrow(/Symlink escape rejected/);
      } catch (err: unknown) {
        // If system policies prevent junction creation, skip smoothly
        if ((err as { code?: string })?.code === 'EPERM') {
          return;
        }
        throw err;
      } finally {
        try {
          if (fs.existsSync(junctionDir)) fs.unlinkSync(junctionDir);
          if (fs.existsSync(externalDir)) fs.rmSync(externalDir, { recursive: true, force: true });
        } catch {
          // Cleanup
        }
      }
    });
  });

  describe('generateUniqueReportFilePath', () => {
    it('returns target filename if no collision exists', () => {
      const path1 = generateUniqueReportFilePath('report.html', testReportsDir);
      expect(path1).toBe(path.join(testReportsDir, 'report.html'));
    });

    it('generates unique collision-free paths when target already exists', () => {
      const existing = path.join(testReportsDir, 'report.html');
      fs.writeFileSync(existing, 'existing-content', 'utf8');

      const path2 = generateUniqueReportFilePath('report.html', testReportsDir);
      expect(path2).toBe(path.join(testReportsDir, 'report-1.html'));

      fs.writeFileSync(path2, 'content-2', 'utf8');
      const path3 = generateUniqueReportFilePath('report.html', testReportsDir);
      expect(path3).toBe(path.join(testReportsDir, 'report-2.html'));
    });
  });
});
