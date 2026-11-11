/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { mockExposeInMainWorld, mockIpcInvoke, initialExposeCalls } = vi.hoisted(() => {
  const calls: Array<[string, unknown]> = [];
  const exposeFn = vi.fn((key: string, api: unknown) => {
    calls.push([key, api]);
  });
  return {
    initialExposeCalls: calls,
    mockExposeInMainWorld: exposeFn,
    mockIpcInvoke: vi.fn(),
  };
});

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mockIpcInvoke,
  },
}));

import * as preloadModule from '../../src/preload/index.js';
import {
  createElectronAPI,
  safeInvoke,
  isValidIPCResultEnvelope,
  FALLBACK_TRANSPORT_ERROR,
  type ElectronAPI as PreloadElectronAPI,
  electronAPI,
} from '../../src/preload/index.js';
import type { ElectronAPI as CanonicalElectronAPI } from '../../src/common/ipc/contracts.js';
import type { ElectronAPI as RendererElectronAPI } from '../../src/renderer/src/env.js';
import {
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  SAFE_IPC_ERROR_MESSAGES,
  AppPingRequestSchema,
} from '@auditor/shared';

/**
 * Compile-time exact type equality assertion helper.
 */
type AssertExact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

describe('Secure Preload Bridge (window.electronAPI)', () => {
  let mockInvoker: ReturnType<typeof vi.fn>;
  let api: CanonicalElectronAPI;

  beforeEach(() => {
    mockInvoker = vi.fn();
    api = createElectronAPI(mockInvoker);
  });

  describe('A. Canonical ElectronAPI Type & Contract Hygiene', () => {
    it('ensures Preload, Renderer, and Common IPC share the exact same canonical ElectronAPI type', () => {
      const preloadMatchesCanonical: AssertExact<PreloadElectronAPI, CanonicalElectronAPI> = true;
      const rendererMatchesCanonical: AssertExact<RendererElectronAPI, CanonicalElectronAPI> = true;
      const windowMatchesCanonical: AssertExact<Window['electronAPI'], CanonicalElectronAPI> = true;

      expect(preloadMatchesCanonical).toBe(true);
      expect(rendererMatchesCanonical).toBe(true);
      expect(windowMatchesCanonical).toBe(true);
    });

    it('declares ElectronAPI interface exclusively in src/common/ipc/contracts.ts without duplication or any', () => {
      const desktopRoot = path.resolve(import.meta.dirname, '../..');
      const contractsSource = fs.readFileSync(
        path.join(desktopRoot, 'src/common/ipc/contracts.ts'),
        'utf-8',
      );
      const preloadSource = fs.readFileSync(
        path.join(desktopRoot, 'src/preload/index.ts'),
        'utf-8',
      );
      const rendererEnvSource = fs.readFileSync(
        path.join(desktopRoot, 'src/renderer/src/env.d.ts'),
        'utf-8',
      );

      // Canonical definition exists in common/ipc/contracts.ts
      expect(contractsSource).toMatch(/export\s+interface\s+ElectronAPI\b/);

      // No duplicate interface declarations in preload or renderer env.d.ts
      expect(preloadSource).not.toMatch(/interface\s+ElectronAPI\b/);
      expect(rendererEnvSource).not.toMatch(/interface\s+ElectronAPI\b/);

      // Both preload and renderer import ElectronAPI via `import type`
      expect(preloadSource).toMatch(/import\s+type\s+\{\s*ElectronAPI\s*\}\s+from/);
      expect(rendererEnvSource).toMatch(/import\s+type\s+\{\s*ElectronAPI\s*\}\s+from/);

      // Global Window declaration remains in env.d.ts
      expect(rendererEnvSource).toMatch(/interface\s+Window\b/);
      expect(rendererEnvSource).toMatch(/readonly\s+electronAPI:\s*ElectronAPI;/);

      // No `any` type used in any of the three files
      expect(contractsSource).not.toMatch(/:\s*any\b|<any>|as\s+any\b/);
      expect(preloadSource).not.toMatch(/:\s*any\b|<any>|as\s+any\b/);
      expect(rendererEnvSource).not.toMatch(/:\s*any\b|<any>|as\s+any\b/);
    });
  });

  describe('API Surface & Exposure Invariants', () => {
    it('exposes exactly the 15 approved functions', () => {
      const keys = Object.keys(api);
      const expectedMethods = [
        'ping',
        'getSystemInfo',
        'validateTarget',
        'createProject',
        'getProject',
        'listProjects',
        'updateProject',
        'archiveProject',
        'restoreProject',
        'createSite',
        'getSite',
        'listSites',
        'updateSite',
        'archiveSite',
        'restoreSite',
        'createScanRun',
        'getScanRun',
        'listScanRuns',
        'cancelScanRun',
        'getScanProgress',
        'listFindings',
        'getFinding',
        'createReport',
        'getReport',
        'listReports',
        'deleteReport',
        'getReportContent',
      ].sort();
      expect(keys.sort()).toEqual(expectedMethods);
      expect(keys).toHaveLength(27);

      for (const key of keys) {
        expect(typeof (api as Record<string, unknown>)[key]).toBe('function');
      }
    });

    it('freezes the exposed API object to prevent prototype tampering or extension', () => {
      expect(Object.isFrozen(api)).toBe(true);
      expect(Object.isFrozen(electronAPI)).toBe(true);

      // Attempting to add or mutate properties in strict mode or via Object.defineProperty must fail
      expect(() => {
        (api as any).newMethod = vi.fn();
      }).toThrow();
    });

    it('does not expose raw ipcRenderer, ipcMain, or EventEmitter instances', () => {
      expect((api as any).ipcRenderer).toBeUndefined();
      expect((api as any).ipcMain).toBeUndefined();
      expect((api as any).send).toBeUndefined();
      expect((api as any).invoke).toBeUndefined();
      expect((api as any).on).toBeUndefined();
      expect((api as any).once).toBeUndefined();
      expect((api as any).addListener).toBeUndefined();
      expect((api as any).removeListener).toBeUndefined();
      expect((api as any).removeAllListeners).toBeUndefined();
      expect((api as any).emit).toBeUndefined();
      expect((api as any).postMessage).toBeUndefined();
    });

    it('does not expose Node.js runtime globals or capabilities', () => {
      expect((api as any).process).toBeUndefined();
      expect((api as any).require).toBeUndefined();
      expect((api as any).Buffer).toBeUndefined();
      expect((api as any).fs).toBeUndefined();
      expect((api as any).child_process).toBeUndefined();
      expect((api as any).path).toBeUndefined();
    });

    it('does not export any public re-exposure helper or test bypass from preload module', () => {
      expect('exposeElectronAPI' in preloadModule).toBe(false);
      expect('initializePreloadBridge' in preloadModule).toBe(false);
    });
  });

  describe('D. Channel Isolation & Approved API Contract', () => {
    it('ping() accepts no Renderer argument and sends valid internal payload required by app:ping schema', async () => {
      expect(api.ping.length).toBe(0);

      mockInvoker.mockResolvedValueOnce({
        success: true,
        data: { pong: true, serverTimestamp: 100 },
      });

      const res = await api.ping();
      expect(mockInvoker).toHaveBeenCalledTimes(1);

      const [calledChannel, calledPayload] = mockInvoker.mock.calls[0]!;
      expect(calledChannel).toBe(IPC_CHANNELS.APP_PING);
      expect(calledPayload).toEqual({});

      // Prove the internal payload sent by preload satisfies AppPingRequestSchema
      const schemaCheck = AppPingRequestSchema.safeParse(calledPayload);
      expect(schemaCheck.success).toBe(true);
      expect(res.success).toBe(true);
    });

    it('ping() ignores any unexpected runtime arguments supplied by untrusted Renderer callers', async () => {
      mockInvoker.mockResolvedValueOnce({
        success: true,
        data: { pong: true, serverTimestamp: 100 },
      });

      const untrustedPing = api.ping as unknown as (arg: unknown) => Promise<unknown>;
      await untrustedPing({ timestamp: 99999, injected: 'malicious' });

      expect(mockInvoker).toHaveBeenCalledTimes(1);
      expect(mockInvoker).toHaveBeenCalledWith(IPC_CHANNELS.APP_PING, {});
    });

    it('getSystemInfo() invokes strictly IPC_CHANNELS.APP_GET_SYSTEM_INFO with empty payload', async () => {
      mockInvoker.mockResolvedValueOnce({
        success: true,
        data: {
          appVersion: '0.1.0',
          electronVersion: '35.0.0',
          chromeVersion: '134.0.0.0',
          nodeVersion: '22.0.0',
          platform: 'win32',
          arch: 'x64',
        },
      });

      const res = await api.getSystemInfo();
      expect(mockInvoker).toHaveBeenCalledTimes(1);
      expect(mockInvoker).toHaveBeenCalledWith(IPC_CHANNELS.APP_GET_SYSTEM_INFO, {});
      expect(res.success).toBe(true);
    });

    it('validateTarget(request) invokes strictly IPC_CHANNELS.AUDIT_VALIDATE_TARGET with exact request', async () => {
      mockInvoker.mockResolvedValueOnce({
        success: true,
        data: { valid: true, normalizedUrl: 'https://example.com' },
      });

      const requestPayload = {
        targetUrl: 'https://example.com',
        allowedScope: ['example.com'],
        options: { allowAnyPort: false },
      };

      const res = await api.validateTarget(requestPayload);
      expect(mockInvoker).toHaveBeenCalledTimes(1);
      expect(mockInvoker).toHaveBeenCalledWith(IPC_CHANNELS.AUDIT_VALIDATE_TARGET, requestPayload);
      expect(res.success).toBe(true);
    });

    it('prohibits arbitrary channel selection: renderer has no channel parameter in any exposed API', () => {
      expect(api.ping.length).toBe(0);
      expect(api.getSystemInfo.length).toBe(0);
      expect(api.validateTarget.length).toBe(1);
    });
  });

  describe('C. Complete IPCResult Envelope Validation & Safe Error Handling', () => {
    it('preserves valid success IPCResult envelopes from Main Process without transformation', async () => {
      const successEnvelope = {
        success: true as const,
        data: { pong: true as const, serverTimestamp: 12345 },
      };
      mockInvoker.mockResolvedValueOnce(successEnvelope);

      const res = await api.ping();
      expect(res).toBe(successEnvelope);
      expect(res).toEqual(successEnvelope);
    });

    it('preserves valid failure IPCResult envelopes (with and without details) from Main Process', async () => {
      const errorEnvelope = {
        success: false as const,
        error: {
          code: IPC_ERROR_CODES.RATE_LIMIT_EXCEEDED,
          message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.RATE_LIMIT_EXCEEDED],
        },
      };
      mockInvoker.mockResolvedValueOnce(errorEnvelope);

      const res = await api.ping();
      expect(res).toBe(errorEnvelope);
      expect(res).toEqual(errorEnvelope);

      const validationErrorEnvelope = {
        success: false as const,
        error: {
          code: IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
          message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED],
          details: [
            {
              path: 'targetUrl',
              code: 'invalid_format',
              message: 'String format does not match expected pattern',
            },
          ],
        },
      };
      mockInvoker.mockResolvedValueOnce(validationErrorEnvelope);

      const res2 = await api.validateTarget({ targetUrl: 'bad' });
      expect(res2).toBe(validationErrorEnvelope);
      expect(res2).toEqual(validationErrorEnvelope);
    });

    it('rejects malformed success envelopes missing data or having invalid data', async () => {
      const malformedSuccessCases: unknown[] = [
        { success: true },
        { success: true, data: undefined },
        { success: true, data: null },
        { success: true, data: 'primitive-string' },
        { success: true, data: 123 },
        { success: true, data: [1, 2, 3] },
        { success: true, data: new Error('Raw error in data') },
        { success: true, data: { pong: true }, extra: 'unexpected' },
        { success: true, data: { pong: true }, error: FALLBACK_TRANSPORT_ERROR },
      ];

      for (const malformed of malformedSuccessCases) {
        expect(isValidIPCResultEnvelope(malformed)).toBe(false);
        mockInvoker.mockResolvedValueOnce(malformed);
        const res = await api.ping();
        expect(res).toEqual({
          success: false,
          error: FALLBACK_TRANSPORT_ERROR,
        });
      }
    });

    it('rejects malformed failure envelopes missing error or having invalid error structure', async () => {
      const malformedFailureCases: unknown[] = [
        { success: false },
        { success: false, error: undefined },
        { success: false, error: null },
        { success: false, error: 'raw string error' },
        { success: false, error: new Error('raw Error instance') },
        { success: false, error: {} },
        { success: false, error: { code: IPC_ERROR_CODES.INTERNAL_ERROR } },
        {
          success: false,
          error: { message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR] },
        },
        // Unapproved error code
        {
          success: false,
          error: { code: 'ERR_UNKNOWN_CUSTOM_CODE', message: 'Some error' },
        },
        // Untrusted / leaked error message not matching SAFE_IPC_ERROR_MESSAGES[code]
        {
          success: false,
          error: {
            code: IPC_ERROR_CODES.INTERNAL_ERROR,
            message: 'Database crash at D:\\secret\\config.json',
          },
        },
        // Extra leaked property (stack trace) on error object
        {
          success: false,
          error: {
            code: IPC_ERROR_CODES.INTERNAL_ERROR,
            message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR],
            stack: 'Error: leaked stack trace\n    at main.ts:10:5',
          },
        },
        // Invalid details structure (not an array)
        {
          success: false,
          error: {
            code: IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
            message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED],
            details: 'invalid-details',
          },
        },
        // Invalid detail item (untrusted message in detail)
        {
          success: false,
          error: {
            code: IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
            message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED],
            details: [
              {
                path: 'targetUrl',
                code: 'invalid_type',
                message: 'Leaked input value: https://admin:secret@internal.corp',
              },
            ],
          },
        },
        // Ambiguous envelope containing both error and data
        {
          success: false,
          error: FALLBACK_TRANSPORT_ERROR,
          data: { pong: true },
        },
      ];

      for (const malformed of malformedFailureCases) {
        expect(isValidIPCResultEnvelope(malformed)).toBe(false);
        mockInvoker.mockResolvedValueOnce(malformed);
        const res = await api.ping();
        expect(res).toEqual({
          success: false,
          error: FALLBACK_TRANSPORT_ERROR,
        });
      }
    });

    it('rejects envelopes with getter/accessor properties without executing getters', async () => {
      let getterCalled = false;
      const maliciousEnvelope = {};
      Object.defineProperty(maliciousEnvelope, 'success', {
        enumerable: true,
        get() {
          getterCalled = true;
          return true;
        },
      });
      Object.defineProperty(maliciousEnvelope, 'data', {
        enumerable: true,
        value: { pong: true },
      });

      mockInvoker.mockResolvedValueOnce(maliciousEnvelope);
      const res = await api.ping();
      expect(getterCalled).toBe(false);
      expect(res).toEqual({
        success: false,
        error: FALLBACK_TRANSPORT_ERROR,
      });
    });

    describe('error.details array structural hardening', () => {
      const validDetailItem = Object.freeze({
        path: 'targetUrl',
        code: 'invalid_format',
        message: 'String format does not match expected pattern',
      });

      const wrapDetailsEnvelope = (details: unknown) => ({
        success: false as const,
        error: {
          code: IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
          message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED],
          details,
        },
      });

      it('1. accepts a normal valid details array', async () => {
        const envelope = wrapDetailsEnvelope([validDetailItem]);
        expect(isValidIPCResultEnvelope(envelope)).toBe(true);

        mockInvoker.mockResolvedValueOnce(envelope);
        const res = await api.ping();
        expect(res).toBe(envelope);
      });

      it('2. rejects a sparse details array (including hole + custom property with matching key count)', async () => {
        // Sparse array with a hole at index 1
        const sparseWithHole = new Array(2);
        sparseWithHole[0] = validDetailItem;
        expect(isValidIPCResultEnvelope(wrapDetailsEnvelope(sparseWithHole))).toBe(false);

        // Sparse array of length 1 where index 0 is missing but a custom property makes ownKeys.length === 2
        const sparseWithCustom = new Array(1);
        (sparseWithCustom as any).customProp = validDetailItem;
        expect(isValidIPCResultEnvelope(wrapDetailsEnvelope(sparseWithCustom))).toBe(false);

        mockInvoker.mockResolvedValueOnce(wrapDetailsEnvelope(sparseWithHole));
        const res = await api.ping();
        expect(res).toEqual({
          success: false,
          error: FALLBACK_TRANSPORT_ERROR,
        });
      });

      it('3. rejects a details array with an enumerable custom property', async () => {
        const detailsWithEnumerableProp = [validDetailItem];
        (detailsWithEnumerableProp as any).extraLeakedField = 'secret-value';

        const envelope = wrapDetailsEnvelope(detailsWithEnumerableProp);
        expect(isValidIPCResultEnvelope(envelope)).toBe(false);

        mockInvoker.mockResolvedValueOnce(envelope);
        const res = await api.ping();
        expect(res).toEqual({
          success: false,
          error: FALLBACK_TRANSPORT_ERROR,
        });
      });

      it('4. rejects a details array with a non-enumerable custom property', async () => {
        const detailsWithHiddenProp = [validDetailItem];
        Object.defineProperty(detailsWithHiddenProp, 'hiddenSecret', {
          value: 'internal-token',
          enumerable: false,
          writable: false,
          configurable: false,
        });

        const envelope = wrapDetailsEnvelope(detailsWithHiddenProp);
        expect(isValidIPCResultEnvelope(envelope)).toBe(false);

        mockInvoker.mockResolvedValueOnce(envelope);
        const res = await api.ping();
        expect(res).toEqual({
          success: false,
          error: FALLBACK_TRANSPORT_ERROR,
        });
      });

      it('5. rejects a details array with a Symbol property', async () => {
        const detailsWithSymbol = [validDetailItem];
        (detailsWithSymbol as any)[Symbol('hiddenSymbol')] = 'symbol-payload';

        const envelope = wrapDetailsEnvelope(detailsWithSymbol);
        expect(isValidIPCResultEnvelope(envelope)).toBe(false);

        mockInvoker.mockResolvedValueOnce(envelope);
        const res = await api.ping();
        expect(res).toEqual({
          success: false,
          error: FALLBACK_TRANSPORT_ERROR,
        });
      });

      it('6. rejects a details array with an accessor property without executing its getter', async () => {
        let indexGetterCalled = false;
        const detailsWithIndexGetter: unknown[] = [];
        Object.defineProperty(detailsWithIndexGetter, '0', {
          enumerable: true,
          get() {
            indexGetterCalled = true;
            return validDetailItem;
          },
        });
        expect(detailsWithIndexGetter.length).toBe(1);

        const envelope1 = wrapDetailsEnvelope(detailsWithIndexGetter);
        expect(isValidIPCResultEnvelope(envelope1)).toBe(false);
        expect(indexGetterCalled).toBe(false);

        let customGetterCalled = false;
        const detailsWithCustomGetter = [validDetailItem];
        Object.defineProperty(detailsWithCustomGetter, 'customGetter', {
          enumerable: true,
          get() {
            customGetterCalled = true;
            return 'leaked';
          },
        });

        const envelope2 = wrapDetailsEnvelope(detailsWithCustomGetter);
        expect(isValidIPCResultEnvelope(envelope2)).toBe(false);
        expect(customGetterCalled).toBe(false);

        mockInvoker.mockResolvedValueOnce(envelope1);
        const res = await api.ping();
        expect(indexGetterCalled).toBe(false);
        expect(res).toEqual({
          success: false,
          error: FALLBACK_TRANSPORT_ERROR,
        });
      });

      it('7. rejects a details array with an unexpected prototype', async () => {
        class SubclassedArray extends Array {}
        const subclassedDetails = new SubclassedArray(validDetailItem);

        const envelope1 = wrapDetailsEnvelope(subclassedDetails);
        expect(isValidIPCResultEnvelope(envelope1)).toBe(false);

        const mutatedProtoDetails = [validDetailItem];
        Object.setPrototypeOf(mutatedProtoDetails, Object.prototype);
        const envelope2 = wrapDetailsEnvelope(mutatedProtoDetails);
        expect(isValidIPCResultEnvelope(envelope2)).toBe(false);

        mockInvoker.mockResolvedValueOnce(envelope1);
        const res = await api.ping();
        expect(res).toEqual({
          success: false,
          error: FALLBACK_TRANSPORT_ERROR,
        });
      });

      it('8. safely rejects a Proxy details array that throws during inspection', async () => {
        const throwingProxyDetails = new Proxy([validDetailItem], {
          ownKeys() {
            throw new Error('Malicious Proxy ownKeys trap');
          },
          getOwnPropertyDescriptor() {
            throw new Error('Malicious Proxy descriptor trap');
          },
        });

        const envelope = wrapDetailsEnvelope(throwingProxyDetails);
        expect(isValidIPCResultEnvelope(envelope)).toBe(false);

        mockInvoker.mockResolvedValueOnce(envelope);
        const res = await api.ping();
        expect(res).toEqual({
          success: false,
          error: FALLBACK_TRANSPORT_ERROR,
        });
      });
    });

    it('catches unexpected transport-level rejections and returns sanitized IPC failure result', async () => {
      mockInvoker.mockRejectedValueOnce(
        new Error(
          'IPC transport failed: D:\\secret\\keys\\master.pem not accessible. Internal V8 stack trace at ipcRenderer.ts:42',
        ),
      );

      const res = await api.ping();
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toEqual(FALLBACK_TRANSPORT_ERROR);
        expect(res.error.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
        expect(res.error.message).toBe(SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR]);
      }

      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain('master.pem');
      expect(serialized).not.toContain('D:\\secret');
      expect(serialized).not.toContain('ipcRenderer.ts');
    });

    it('sanitizes unexpected string rejections and non-object responses safely', async () => {
      mockInvoker.mockRejectedValueOnce('Raw string transport crash');
      const res1 = await api.getSystemInfo();
      expect(res1).toEqual({
        success: false,
        error: FALLBACK_TRANSPORT_ERROR,
      });

      mockInvoker.mockResolvedValueOnce(null);
      const res2 = await api.getSystemInfo();
      expect(res2).toEqual({
        success: false,
        error: FALLBACK_TRANSPORT_ERROR,
      });

      mockInvoker.mockResolvedValueOnce({ unexpected: 'payload without success boolean' });
      const res3 = await safeInvoke(mockInvoker, IPC_CHANNELS.APP_PING, {});
      expect(res3).toEqual({
        success: false,
        error: FALLBACK_TRANSPORT_ERROR,
      });
    });
  });

  describe('B. contextBridge Single-Execution & Fail-Closed Registration', () => {
    it('verifies production preload entry point called contextBridge.exposeInMainWorld exactly once on initial load', () => {
      expect(initialExposeCalls).toHaveLength(1);
      expect(initialExposeCalls[0]![0]).toBe('electronAPI');
      expect(initialExposeCalls[0]![1]).toBe(electronAPI);
      expect(Object.isFrozen(initialExposeCalls[0]![1])).toBe(true);
    });

    it('prevents duplicate exposure attempts on the same contextBridge instance (fails closed)', async () => {
      const freshExposeSpy = vi.fn();
      const sharedBridgeInstance = {
        exposeInMainWorld: freshExposeSpy,
      };

      vi.resetModules();
      vi.doMock('electron', () => ({
        contextBridge: sharedBridgeInstance,
        ipcRenderer: { invoke: mockIpcInvoke },
      }));

      // First evaluation succeeds and exposes once
      const firstLoad = await import('../../src/preload/index.js');
      expect(freshExposeSpy).toHaveBeenCalledTimes(1);
      expect(freshExposeSpy).toHaveBeenCalledWith('electronAPI', firstLoad.electronAPI);

      // Second evaluation against the same contextBridge instance is rejected before calling exposeInMainWorld
      vi.resetModules();
      vi.doMock('electron', () => ({
        contextBridge: sharedBridgeInstance,
        ipcRenderer: { invoke: mockIpcInvoke },
      }));

      await expect(import('../../src/preload/index.js')).rejects.toThrow(/already been exposed/i);
      expect(freshExposeSpy).toHaveBeenCalledTimes(1);
    });

    it('fails closed when contextBridge is missing (undefined or null)', async () => {
      vi.resetModules();
      vi.doMock('electron', () => ({
        contextBridge: undefined,
        ipcRenderer: { invoke: mockIpcInvoke },
      }));

      await expect(import('../../src/preload/index.js')).rejects.toThrow(
        /contextBridge\.exposeInMainWorld is unavailable/i,
      );

      vi.resetModules();
      vi.doMock('electron', () => ({
        contextBridge: null,
        ipcRenderer: { invoke: mockIpcInvoke },
      }));

      await expect(import('../../src/preload/index.js')).rejects.toThrow(
        /contextBridge\.exposeInMainWorld is unavailable/i,
      );
    });

    it('fails closed when contextBridge.exposeInMainWorld is missing or not a function', async () => {
      vi.resetModules();
      vi.doMock('electron', () => ({
        contextBridge: {},
        ipcRenderer: { invoke: mockIpcInvoke },
      }));

      await expect(import('../../src/preload/index.js')).rejects.toThrow(
        /contextBridge\.exposeInMainWorld is unavailable/i,
      );

      vi.resetModules();
      vi.doMock('electron', () => ({
        contextBridge: { exposeInMainWorld: 'invalid' },
        ipcRenderer: { invoke: mockIpcInvoke },
      }));

      await expect(import('../../src/preload/index.js')).rejects.toThrow(
        /contextBridge\.exposeInMainWorld is unavailable/i,
      );
    });

    it('verifies default production electronAPI uses ipcRenderer.invoke', async () => {
      mockIpcInvoke.mockResolvedValueOnce({
        success: true,
        data: { pong: true, serverTimestamp: 200 },
      });

      const res = await electronAPI.ping();
      expect(mockIpcInvoke).toHaveBeenCalledWith(IPC_CHANNELS.APP_PING, {});
      expect(res.success).toBe(true);
    });
  });

  describe('E. Database IPC Operations on Preload API (Phase 2.2)', () => {
    it('createProject() invokes IPC_CHANNELS.PROJECT_CREATE with payload', async () => {
      const mockProject = {
        id: 'p-1',
        name: 'Test Project',
        description: null,
        isArchived: false,
        createdAt: 100,
        updatedAt: 100,
        archivedAt: null,
      };
      mockInvoker.mockResolvedValueOnce({ success: true, data: mockProject });

      const res = await api.createProject({ name: 'Test Project' });
      expect(mockInvoker).toHaveBeenCalledWith(IPC_CHANNELS.PROJECT_CREATE, {
        name: 'Test Project',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.id).toBe('p-1');
      }
    });

    it('listProjects() invokes IPC_CHANNELS.PROJECT_LIST with empty object default if omitted', async () => {
      mockInvoker.mockResolvedValueOnce({
        success: true,
        data: { items: [], total: 0, hasMore: false },
      });

      const res = await api.listProjects();
      expect(mockInvoker).toHaveBeenCalledWith(IPC_CHANNELS.PROJECT_LIST, {});
      expect(res.success).toBe(true);
    });

    it('createSite() invokes IPC_CHANNELS.SITE_CREATE with payload', async () => {
      const mockSite = {
        id: 's-1',
        projectId: 'p-1',
        name: 'Main Site',
        baseUrl: 'https://site.com/',
        platformType: 'wordpress',
        environmentType: 'production',
        isArchived: false,
        createdAt: 100,
        updatedAt: 100,
        archivedAt: null,
      };
      mockInvoker.mockResolvedValueOnce({ success: true, data: mockSite });

      const res = await api.createSite({
        projectId: 'p-1',
        name: 'Main Site',
        baseUrl: 'https://site.com',
      });
      expect(mockInvoker).toHaveBeenCalledWith(IPC_CHANNELS.SITE_CREATE, {
        projectId: 'p-1',
        name: 'Main Site',
        baseUrl: 'https://site.com',
      });
      expect(res.success).toBe(true);
    });

    it('listSites() invokes IPC_CHANNELS.SITE_LIST with query or empty object', async () => {
      mockInvoker.mockResolvedValueOnce({
        success: true,
        data: { items: [], total: 0, hasMore: false },
      });

      const res = await api.listSites({ projectId: 'p-1' });
      expect(mockInvoker).toHaveBeenCalledWith(IPC_CHANNELS.SITE_LIST, { projectId: 'p-1' });
      expect(res.success).toBe(true);
    });

    it('archiveProject and restoreProject invoke their respective channels', async () => {
      mockInvoker.mockResolvedValueOnce({
        success: true,
        data: { id: 'p-1', isArchived: true, archivedSitesCount: 2 },
      });

      const archiveRes = await api.archiveProject({ id: 'p-1' });
      expect(mockInvoker).toHaveBeenCalledWith(IPC_CHANNELS.PROJECT_ARCHIVE, { id: 'p-1' });
      expect(archiveRes.success).toBe(true);

      mockInvoker.mockResolvedValueOnce({
        success: true,
        data: {
          id: 'p-1',
          name: 'P1',
          description: null,
          isArchived: false,
          createdAt: 100,
          updatedAt: 200,
          archivedAt: null,
        },
      });

      const restoreRes = await api.restoreProject({ id: 'p-1' });
      expect(mockInvoker).toHaveBeenCalledWith(IPC_CHANNELS.PROJECT_RESTORE, { id: 'p-1' });
      expect(restoreRes.success).toBe(true);
    });

    it('safely handles bridge invocation rejection without leaking raw exceptions', async () => {
      mockInvoker.mockRejectedValueOnce(new Error('Fatal IPC channel disconnect'));

      const res = await api.createProject({ name: 'Failing Project' });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toEqual(FALLBACK_TRANSPORT_ERROR);
      }
    });
  });
});
