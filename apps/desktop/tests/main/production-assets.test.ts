import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPLICATION_ID,
  APPLICATION_NAME,
  resolveAppIconPath,
} from '../../src/main/config/paths.js';
import {
  handleStartupError,
  sanitizeErrorMessage,
  setupGlobalProcessErrorHandlers,
} from '../../src/main/config/startup-error.js';
import { resolveNativeBindingPath } from '../../src/main/db/connection.js';
import { copyBuildAssets } from '../../../../scripts/copy-build-assets.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(SCRIPT_DIR, '../..');
const PROJECT_DIR = path.resolve(DESKTOP_ROOT, '../..');
const OUT_MAIN_DIR = path.join(DESKTOP_ROOT, 'out', 'main');

describe('Batch 5.1 — Production Asset Pipeline & Main Process Bundling', () => {
  describe('1. Main Process Production Bundle Inspection', () => {
    it('produces out/main/index.js without unresolved workspace @auditor/shared imports', () => {
      const bundlePath = path.join(OUT_MAIN_DIR, 'index.js');
      expect(fs.existsSync(bundlePath)).toBe(true);

      const content = fs.readFileSync(bundlePath, 'utf-8');

      // Must NOT contain external import or require of @auditor/shared
      const externalImportPattern =
        /from\s+["']@auditor\/shared["']|require\(["']@auditor\/shared["']\)/;
      expect(content).not.toMatch(externalImportPattern);

      // Must directly contain bundled domain functions / schemas
      expect(content).toContain('validateScanTarget');
      expect(content).toContain('PAYLOAD_BOUNDS_POLICY');
      expect(content).toContain('IPC_CHANNELS');
    });

    it('produces out/main/cli.js without unresolved workspace @auditor/shared imports', () => {
      const cliPath = path.join(OUT_MAIN_DIR, 'cli.js');
      expect(fs.existsSync(cliPath)).toBe(true);

      const content = fs.readFileSync(cliPath, 'utf-8');
      const externalImportPattern =
        /from\s+["']@auditor\/shared["']|require\(["']@auditor\/shared["']\)/;
      expect(content).not.toMatch(externalImportPattern);
    });
  });

  describe('2. Native SQLite Addon Pipeline & Assets', () => {
    it('copies and verifies native SQLite binaries in out/main/native', () => {
      const result = copyBuildAssets({ silent: true });
      expect(result.success).toBe(true);

      const electronBin = path.join(
        OUT_MAIN_DIR,
        'native',
        'electron-v149-win32-x64',
        'better_sqlite3.node',
      );
      const nodeBin = path.join(
        OUT_MAIN_DIR,
        'native',
        'node-v137-win32-x64',
        'better_sqlite3.node',
      );

      expect(fs.existsSync(electronBin)).toBe(true);
      expect(fs.statSync(electronBin).size).toBeGreaterThan(1000000);

      expect(fs.existsSync(nodeBin)).toBe(true);
      expect(fs.statSync(nodeBin).size).toBeGreaterThan(1000000);
    });

    it('resolves native addon relative to out/main without relying on D:/ahmed', () => {
      const resolved = resolveNativeBindingPath(OUT_MAIN_DIR);
      if (process.versions.electron) {
        expect(resolved).toBeDefined();
        expect(resolved).toContain('electron-v');
      } else {
        // Under host Node, resolves either custom host binary or lets loader handle it
        if (resolved) {
          expect(resolved).toContain('node-v');
          expect(fs.existsSync(resolved)).toBe(true);
        }
      }
    });

    it('strictly fails closed in Electron runtime when ABI binary is missing', () => {
      const dummyDir = path.join(PROJECT_DIR, '.tmp', 'empty-native-test');
      fs.mkdirSync(dummyDir, { recursive: true });

      try {
        expect(() =>
          resolveNativeBindingPath({
            customBaseDir: dummyDir,
            isElectron: true,
            targetDirName: 'electron-v999-win32-x64',
          }),
        ).toThrow(
          /ERR_NATIVE_SQLITE_BINDING_MISSING: No compatible SQLite native addon found for Electron/,
        );
      } finally {
        fs.rmSync(dummyDir, { recursive: true, force: true });
      }
    });
  });

  describe('3. Windows Application Identity & Icons', () => {
    it('defines standard Windows application identifier', () => {
      expect(APPLICATION_ID).toBe('com.auditor.desktop');
      expect(APPLICATION_NAME).toBe('ultimate-wordpress-and-website-auditor');
    });

    it('resolves valid application icon in resources', () => {
      const iconPath = resolveAppIconPath();
      expect(iconPath).toBeDefined();
      expect(fs.existsSync(iconPath!)).toBe(true);
      expect(iconPath!.endsWith('.ico') || iconPath!.endsWith('.png')).toBe(true);
    });

    it('verifies icon.ico contains 7 multi-resolution frames (16 to 256)', () => {
      const icoPath = path.join(DESKTOP_ROOT, 'resources', 'icon.ico');
      expect(fs.existsSync(icoPath)).toBe(true);

      const buffer = fs.readFileSync(icoPath);
      // ICO Header: 2 bytes reserved (0), 2 bytes type (1=icon), 2 bytes count
      const reserved = buffer.readUInt16LE(0);
      const type = buffer.readUInt16LE(2);
      const count = buffer.readUInt16LE(4);

      expect(reserved).toBe(0);
      expect(type).toBe(1);
      expect(count).toBe(7);

      const expectedDimensions = [16, 24, 32, 48, 64, 128, 256];
      const foundDimensions: number[] = [];

      for (let i = 0; i < count; i++) {
        const offset = 6 + i * 16;
        let width = buffer.readUInt8(offset);
        let height = buffer.readUInt8(offset + 1);
        if (width === 0) width = 256;
        if (height === 0) height = 256;
        const bpp = buffer.readUInt16LE(offset + 6);

        expect(bpp).toBe(32); // RGBA
        expect(width).toBe(height);
        foundDimensions.push(width);
      }

      expect(foundDimensions.sort((a, b) => a - b)).toEqual(expectedDimensions);
    });

    it('verifies icon resources are mirrored in out/main/resources and out/resources', () => {
      const mainIco = path.join(OUT_MAIN_DIR, 'resources', 'icon.ico');
      const outIco = path.join(DESKTOP_ROOT, 'out', 'resources', 'icon.ico');

      expect(fs.existsSync(mainIco)).toBe(true);
      expect(fs.existsSync(outIco)).toBe(true);
      expect(fs.statSync(mainIco).size).toBe(fs.statSync(outIco).size);
    });
  });

  describe('4. Startup Error Reporting & Sanitization', () => {
    it('redacts sensitive secrets, passwords, bearer tokens, and credentials', () => {
      const rawError = new Error(
        'Database connection failed to postgres://admin:super_secret_pw123@db.internal:5432/auditor?token=secret_token_abc&auth=my_auth_key',
      );
      rawError.stack =
        'Error: Bearer abcdef1234567890_super_token\n' +
        '  at Object.<anonymous> (connection.ts:42:15)\n' +
        '  api_key="sk-live-998877665544332211"';

      const sanitized = sanitizeErrorMessage(rawError);

      expect(sanitized).not.toContain('super_secret_pw123');
      expect(sanitized).not.toContain('secret_token_abc');
      expect(sanitized).not.toContain('abcdef1234567890_super_token');
      expect(sanitized).not.toContain('sk-live-998877665544332211');

      expect(sanitized).toContain('[REDACTED_CREDENTIALS]');
      expect(sanitized).toContain('[REDACTED_QUERY]');
      expect(sanitized).toContain('[REDACTED_TOKEN]');
      expect(sanitized).toContain('[REDACTED_SECRET]');
    });

    it('writes sanitized error to persistent startup-error.log and invokes dialog safely', () => {
      const testLogDir = path.join(PROJECT_DIR, '.tmp', 'startup-error-test');
      fs.mkdirSync(testLogDir, { recursive: true });

      const mockDialog = {
        showErrorBox: vi.fn(),
      };

      const result = handleStartupError(new Error('Fatal SQLite initialization error'), {
        logDir: testLogDir,
        dialogApi: mockDialog,
        source: 'testRunner',
      });

      expect(result.logged).toBe(true);
      expect(result.dialogShown).toBe(true);
      expect(result.logPath).toBeDefined();
      expect(fs.existsSync(result.logPath!)).toBe(true);

      const logContent = fs.readFileSync(result.logPath!, 'utf-8');
      expect(logContent).toContain('SOURCE: testRunner');
      expect(logContent).toContain('Fatal SQLite initialization error');

      expect(mockDialog.showErrorBox).toHaveBeenCalledTimes(1);
      const [title, content] = mockDialog.showErrorBox.mock.calls[0];
      expect(title).toContain('Startup Error');
      expect(content).toContain('Fatal SQLite initialization error');
      expect(content).toContain(result.logPath);

      // Clean up test log directory
      fs.rmSync(testLogDir, { recursive: true, force: true });
    });

    it('fails closed and does not throw if filesystem writing fails', () => {
      const testLogDir = path.join(PROJECT_DIR, '.tmp', 'startup-error-fail-closed-test');
      const mockFailingFs = {
        mkdirSync: vi.fn(() => {
          throw new Error('EACCES: permission denied');
        }),
        appendFileSync: vi.fn(),
      };
      const mockDialog = {
        showErrorBox: vi.fn(),
      };

      // Must NOT throw
      const result = handleStartupError(new Error('Test error with failing fs'), {
        logDir: testLogDir,
        fsApi: mockFailingFs as unknown as typeof fs,
        dialogApi: mockDialog,
      });

      expect(result.logged).toBe(false);
      expect(result.dialogShown).toBe(true);
      expect(mockDialog.showErrorBox).toHaveBeenCalledTimes(1);
    });

    it('attaches global process error handlers idempotently and triggers cleanup on fatal exception without polluting AppData logs', () => {
      const mockCleanup = vi.fn();
      const mockFatalExit = vi.fn();
      const isolatedLogDir = path.join(PROJECT_DIR, '.tmp', 'startup-error-global-handler-test');
      const prodLogPath = path.join(
        process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
        'ultimate-wordpress-and-website-auditor',
        'logs',
        'startup-error.log',
      );
      const beforeProdMtime = fs.existsSync(prodLogPath) ? fs.statSync(prodLogPath).mtimeMs : null;

      try {
        setupGlobalProcessErrorHandlers({
          cleanup: mockCleanup,
          onFatalExit: mockFatalExit,
          showDialog: false,
          logDir: isolatedLogDir,
        });

        // Emitting uncaughtException should safely trigger cleanup and exit without killing test runner
        const fatalErr = new Error('Fatal unhandled runtime exception');
        process.emit('uncaughtException', fatalErr);

        expect(mockCleanup).toHaveBeenCalledTimes(1);
        expect(mockFatalExit).toHaveBeenCalledWith(1);
        const isolatedLogFile = path.join(isolatedLogDir, 'startup-error.log');
        expect(fs.existsSync(isolatedLogFile)).toBe(true);
        expect(fs.readFileSync(isolatedLogFile, 'utf8')).toContain(
          'Fatal unhandled runtime exception',
        );

        const afterProdMtime = fs.existsSync(prodLogPath) ? fs.statSync(prodLogPath).mtimeMs : null;
        expect(afterProdMtime).toBe(beforeProdMtime);
      } finally {
        fs.rmSync(isolatedLogDir, { recursive: true, force: true });
      }
    });
  });
});
