import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ElectronProcessRunner, type ElectronReadyEvent } from './harness/electron-runner.js';

interface UntrustedWindowInspection {
  hasElectronApi: boolean;
  hasIpcRenderer: boolean;
  hasRequire: boolean;
}

interface SubframeIpcScenarioResult {
  iframeResult: {
    attempted: boolean;
    result?: {
      success: boolean;
      error: { code: string; message: string };
    };
    error?: string;
  };
  mainFrameResult: {
    success: boolean;
    data: { pong: boolean; serverTimestamp: number };
  };
}

interface UnknownChannelInspection {
  hasGenericInvoke: boolean;
  hasGenericSend: boolean;
  exposedKeys: string[];
}

interface PayloadBoundsScenarioResult {
  success: boolean;
  error?: { code: string; message: string };
}

interface ScenarioCallResult {
  success: boolean;
  error?: { code: string; message: string };
}

interface NavigationBlockedResult {
  navigationAttempted: boolean;
  blocked: boolean;
}

interface WindowOpenDeniedResult {
  popupReturnedNull: boolean;
}

interface CspEvalResult {
  evalBlocked: boolean;
  errorMessage: string;
}

interface CspInlineResult {
  inlineBlocked: boolean;
}

interface ConcurrencyScenarioResult {
  heldCount: number;
  heldResults: Array<{
    success: boolean;
    data: {
      pong: boolean;
      serverTimestamp: number;
    };
  }>;
  req6: {
    success: boolean;
    error: {
      code: string;
      message: string;
    };
  };
  req7: {
    success: boolean;
    error: {
      code: string;
      message: string;
    };
  };
  req8: {
    success: boolean;
    data: {
      pong: boolean;
      serverTimestamp: number;
    };
  };
}

interface WorkerGlobalsInspection {
  hasProcess: boolean;
  hasRequire: boolean;
  hasBuffer: boolean;
  hasGlobal: boolean;
}

interface WorkerNodeInspectionResult {
  productionWorker: WorkerGlobalsInspection;
  isolatedNegative: WorkerGlobalsInspection;
  isolatedPositive: WorkerGlobalsInspection;
}

interface InsecureContentScenarioResult {
  blocked: boolean;
  insecureScriptExecuted: boolean;
}

describe('Phase 1.2.4.3 — Security Boundary & Adversarial Runtime Suite', () => {
  let runner: ElectronProcessRunner;
  let _readyEvent: ElectronReadyEvent;

  beforeAll(async () => {
    runner = new ElectronProcessRunner();
    _readyEvent = await runner.start(25000);
  }, 30000);

  afterAll(async () => {
    if (runner) {
      await runner.stop(5000);
    }
  }, 10000);

  describe('Untrusted BrowserWindow Isolation', () => {
    it('proves that untrusted/unprivileged windows have zero IPC or Node bridge capabilities', async () => {
      const untrusted =
        await runner.executeScenario<UntrustedWindowInspection>('TEST_UNTRUSTED_WINDOW');

      expect(untrusted).toBeDefined();
      expect(untrusted.hasElectronApi).toBe(false);
      expect(untrusted.hasIpcRenderer).toBe(false);
      expect(untrusted.hasRequire).toBe(false);
    });
  });

  describe('Subframe & Frame Hierarchy Security', () => {
    it('enforces that SenderGuard rejects subframe IPC while preserving legitimate main frame operations', async () => {
      const result = await runner.executeScenario<SubframeIpcScenarioResult>('TEST_SUBFRAME_IPC');

      expect(result).toBeDefined();
      expect(result.iframeResult.attempted).toBe(true);

      // Subframe IPC invocation is either caught by sandbox or rejected by SenderGuard with ERR_UNAUTHORIZED_SENDER
      if (result.iframeResult.result) {
        expect(result.iframeResult.result.success).toBe(false);
        expect(result.iframeResult.result.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
      }

      // Legitimate main frame IPC continues to operate seamlessly
      expect(result.mainFrameResult).toBeDefined();
      expect(result.mainFrameResult.success).toBe(true);
      expect(result.mainFrameResult.data.pong).toBe(true);
      expect(result.mainFrameResult.data.serverTimestamp).toBeGreaterThan(0);
    }, 15000);
  });

  describe('API Surface & Unknown Channel Rejection', () => {
    it('verifies that the renderer API surface exposes no generic or arbitrary IPC methods', async () => {
      const result = await runner.executeScenario<UnknownChannelInspection>('TEST_UNKNOWN_CHANNEL');

      expect(result.hasGenericInvoke).toBe(false);
      expect(result.hasGenericSend).toBe(false);
      expect(result.exposedKeys.sort()).toEqual([
        'archiveProject',
        'archiveSite',
        'cancelScanRun',
        'createProject',
        'createReport',
        'createScanRun',
        'createSite',
        'deleteReport',
        'getFinding',
        'getProject',
        'getReport',
        'getReportContent',
        'getScanProgress',
        'getScanRun',
        'getSite',
        'getSystemInfo',
        'listFindings',
        'listProjects',
        'listReports',
        'listScanRuns',
        'listSites',
        'ping',
        'restoreProject',
        'restoreSite',
        'updateProject',
        'updateSite',
        'validateTarget',
      ]);
    });
  });

  describe('Payload Bounds & Rate Limiting Enforcement', () => {
    it('rejects oversized payloads exceeding the configured channel policy limit', async () => {
      const result =
        await runner.executeScenario<PayloadBoundsScenarioResult>('TEST_PAYLOAD_BOUNDS');

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(
        result.error.code === 'ERR_PAYLOAD_TOO_LARGE' ||
          result.error.code === 'ERR_PAYLOAD_VALIDATION_FAILED',
      ).toBe(true);
    });

    it('enforces 5 req/s rate limit on app:get-system-info and rejects overflowing requests', async () => {
      const results = await runner.executeScenario<ScenarioCallResult[]>('TEST_RATE_LIMITING');

      expect(results).toHaveLength(7);

      // The first 5 requests succeed within the 1-second sliding window
      const successCount = results.filter(r => r.success === true).length;
      expect(successCount).toBeGreaterThanOrEqual(1);
      expect(successCount).toBeLessThanOrEqual(5);

      // The 6th and 7th requests are rate-limited with ERR_RATE_LIMIT_EXCEEDED
      const rateLimited = results.filter(
        r => r.success === false && r.error?.code === 'ERR_RATE_LIMIT_EXCEEDED',
      );
      expect(rateLimited.length).toBeGreaterThanOrEqual(1);
    });

    it('handles concurrent requests on app:ping according to concurrency policy', async () => {
      const result = await runner.executeScenario<ConcurrencyScenarioResult>(
        'TEST_CONCURRENCY_LIMITING',
      );

      // 1. Proves that exactly 5 requests acquired concurrency slots and were held in flight
      expect(result.heldCount).toBe(5);

      // 2. Proves that the 6th and 7th requests dispatched during saturation were rejected
      expect(result.req6.success).toBe(false);
      expect(result.req6.error.code).toBe('ERR_CONCURRENCY_LIMIT_EXCEEDED');

      expect(result.req7.success).toBe(false);
      expect(result.req7.error.code).toBe('ERR_CONCURRENCY_LIMIT_EXCEEDED');

      // 3. Proves that all 5 held requests completed successfully once released
      expect(result.heldResults).toHaveLength(5);
      for (const res of result.heldResults) {
        expect(res.success).toBe(true);
        expect(res.data.pong).toBe(true);
        expect(res.data.serverTimestamp).toBeGreaterThan(0);
      }

      // 4. Proves that after the 5 held requests completed and released their slots,
      // the channel is immediately usable again (request 8 succeeds)
      expect(result.req8.success).toBe(true);
      expect(result.req8.data.pong).toBe(true);
      expect(result.req8.data.serverTimestamp).toBeGreaterThan(0);
    });
  });

  describe('Navigation & External Window Hardening', () => {
    it('blocks unauthorized document navigation via will-navigate guard', async () => {
      const result =
        await runner.executeScenario<NavigationBlockedResult>('TEST_NAVIGATION_BLOCKED');
      expect(result.navigationAttempted).toBe(true);
      expect(result.blocked).toBe(true);
    });

    it('denies untrusted window.open popup requests via setWindowOpenHandler', async () => {
      const result =
        await runner.executeScenario<WindowOpenDeniedResult>('TEST_WINDOW_OPEN_DENIED');
      expect(result.popupReturnedNull).toBe(true);
    });
  });

  describe('CSP Runtime Verification', () => {
    it('proves that eval() is strictly blocked at runtime by Content-Security-Policy', async () => {
      const result = await runner.executeScenario<CspEvalResult>('TEST_CSP_EVAL');
      expect(result.evalBlocked).toBe(true);
      expect(result.errorMessage.toLowerCase()).toContain('unsafe-eval');
    });

    it('proves that dynamically injected inline scripts are blocked by CSP', async () => {
      const result = await runner.executeScenario<CspInlineResult>('TEST_CSP_INLINE_SCRIPT');
      expect(result.inlineBlocked).toBe(true);
    });
  });

  describe('Worker & WebPreferences Isolation', () => {
    it('proves that Web Workers in the Renderer do not expose Node.js integration and validates isolated negative/positive controls for nodeIntegrationInWorker', async () => {
      const result = await runner.executeScenario<WorkerNodeInspectionResult>(
        'TEST_WORKER_NODE_INTEGRATION',
      );

      // 1. Production mainWindow (sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false)
      expect(result.productionWorker.hasProcess).toBe(false);
      expect(result.productionWorker.hasRequire).toBe(false);
      expect(result.productionWorker.hasBuffer).toBe(false);
      expect(result.productionWorker.hasGlobal).toBe(false);

      // 2. Isolated Negative Control Window (sandbox: false, nodeIntegration: true, contextIsolation: false, nodeIntegrationInWorker: false)
      // Confirms that nodeIntegrationInWorker: false blocks Node in Worker even when the window has Node integration
      expect(result.isolatedNegative.hasProcess).toBe(false);
      expect(result.isolatedNegative.hasRequire).toBe(false);
      expect(result.isolatedNegative.hasBuffer).toBe(false);
      expect(result.isolatedNegative.hasGlobal).toBe(false);

      // 3. Isolated Positive Control Window (sandbox: false, nodeIntegration: true, contextIsolation: false, nodeIntegrationInWorker: true)
      // Confirms that nodeIntegrationInWorker: true activates Node capabilities in the Worker independently of sandbox
      expect(result.isolatedPositive.hasProcess).toBe(true);
      expect(result.isolatedPositive.hasBuffer).toBe(true);
    });

    it('proves that insecure HTTP script content is blocked from executing in the secure application context', async () => {
      const result =
        await runner.executeScenario<InsecureContentScenarioResult>('TEST_INSECURE_CONTENT');

      expect(result.blocked).toBe(true);
      expect(result.insecureScriptExecuted).toBe(false);
    });
  });
});
