import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  saveReportToFile,
  readReportFile,
  deleteReportFile,
  cleanupTemporaryReportFiles,
  reconcileReportsStorage,
} from '../../src/main/reports/exporter.js';

describe('Report Exporter & Filesystem Persistence', () => {
  const testDir = path.resolve('D:/ahmed/.tmp/test-reports-fs');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Best effort
    }
  });

  it('persists report content atomically and returns valid storage path and byte count', () => {
    const content = '<html><body><h1>Audit Report</h1></body></html>';
    const result = saveReportToFile(content, {
      filename: 'audit.html',
      directory: testDir,
    });

    expect(result.storagePath).toBe(path.join(testDir, 'audit.html'));
    expect(result.bytesWritten).toBe(Buffer.byteLength(content, 'utf8'));
    expect(fs.existsSync(result.storagePath)).toBe(true);

    const read = fs.readFileSync(result.storagePath, 'utf8');
    expect(read).toBe(content);
  });

  it('generates unique collision-free filenames when overwrite is false', () => {
    const content1 = 'report 1';
    const content2 = 'report 2';

    const res1 = saveReportToFile(content1, { filename: 'audit.html', directory: testDir });
    const res2 = saveReportToFile(content2, { filename: 'audit.html', directory: testDir });

    expect(res1.storagePath).toBe(path.join(testDir, 'audit.html'));
    expect(res2.storagePath).toBe(path.join(testDir, 'audit-1.html'));
    expect(fs.readFileSync(res1.storagePath, 'utf8')).toBe(content1);
    expect(fs.readFileSync(res2.storagePath, 'utf8')).toBe(content2);
  });

  it('overwrites target file when overwrite is true', () => {
    const res1 = saveReportToFile('v1', { filename: 'report.html', directory: testDir });
    const res2 = saveReportToFile('v2', { filename: 'report.html', directory: testDir, overwrite: true });

    expect(res1.storagePath).toBe(res2.storagePath);
    expect(fs.readFileSync(res2.storagePath, 'utf8')).toBe('v2');
  });

  it('reads generated report file content safely', () => {
    const content = JSON.stringify({ audit: true });
    const res = saveReportToFile(content, { filename: 'audit.json', directory: testDir });

    const read = readReportFile(res.storagePath, testDir);
    expect(read).toBe(content);
  });

  it('throws REPORT_NOT_FOUND when reading non-existent file', () => {
    expect(() => {
      readReportFile('does-not-exist.html', testDir);
    }).toThrow('not found');
  });

  it('deletes report file from disk safely', () => {
    const res = saveReportToFile('to delete', { filename: 'temp.html', directory: testDir });
    expect(fs.existsSync(res.storagePath)).toBe(true);

    const deleted = deleteReportFile(res.storagePath, testDir);
    expect(deleted).toBe(true);
    expect(fs.existsSync(res.storagePath)).toBe(false);

    // Deleting again returns false cleanly without error
    const secondDelete = deleteReportFile(res.storagePath, testDir);
    expect(secondDelete).toBe(false);
  });

  it('rejects path traversal attempts during export and read', () => {
    expect(() => {
      saveReportToFile('malicious', {
        filename: '../../outside.html',
        directory: testDir,
        overwrite: true,
      });
    }).toThrow('Path traversal rejected');

    expect(() => {
      readReportFile('../../windows/win.ini', testDir);
    }).toThrow('Path traversal rejected');

    expect(deleteReportFile('../../outside.html', testDir)).toBe(false);
  });

  it('cleans up orphaned temporary files (.tmp-*) safely without touching valid reports', () => {
    // Create valid report file
    const validFile = path.join(testDir, 'valid-report.html');
    fs.writeFileSync(validFile, 'valid content', 'utf8');

    // Create orphaned temp files
    const tempFile1 = path.join(testDir, '.tmp-1111-2222-3333');
    const tempFile2 = path.join(testDir, '.tmp-4444-5555-6666');
    fs.writeFileSync(tempFile1, 'interrupted export 1', 'utf8');
    fs.writeFileSync(tempFile2, 'interrupted export 2', 'utf8');

    const cleaned = cleanupTemporaryReportFiles(testDir);
    expect(cleaned).toBe(2);

    expect(fs.existsSync(tempFile1)).toBe(false);
    expect(fs.existsSync(tempFile2)).toBe(false);
    expect(fs.existsSync(validFile)).toBe(true);
  });

  it('reconciles filesystem against active storage paths, removing orphans and preserving active reports', () => {
    // 1. Active report file
    const activeFile = path.join(testDir, 'active-audit.html');
    fs.writeFileSync(activeFile, 'active report content', 'utf8');

    // 2. Orphaned report file (e.g. from crashed deletion or unlinked DB row)
    const orphanFile = path.join(testDir, 'orphan-audit.html');
    fs.writeFileSync(orphanFile, 'orphan report content', 'utf8');

    // 3. Temporary file
    const tempFile = path.join(testDir, '.tmp-interrupted-export');
    fs.writeFileSync(tempFile, 'temp content', 'utf8');

    // 4. Unrecognized non-report file
    const unrelatedFile = path.join(testDir, 'readme.md');
    fs.writeFileSync(unrelatedFile, '# Notes', 'utf8');

    const activeSet = new Set<string>([activeFile]);

    const result = reconcileReportsStorage(activeSet, testDir);

    expect(result.scannedFiles).toBe(4);
    expect(result.activeReports).toBe(1);
    expect(result.tempFilesCleaned).toBe(1);
    expect(result.orphanFilesDeleted).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Assertions on disk
    expect(fs.existsSync(activeFile)).toBe(true); // Active report preserved!
    expect(fs.existsSync(orphanFile)).toBe(false); // Orphan deleted!
    expect(fs.existsSync(tempFile)).toBe(false); // Temp file deleted!
    expect(fs.existsSync(unrelatedFile)).toBe(true); // Unrelated non-report preserved!
  });
});
