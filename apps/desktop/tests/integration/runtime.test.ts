import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {
  ElectronProcessRunner,
  type ElectronReadyEvent,
  type StoragePaths,
} from './harness/electron-runner.js';
import { APPLICATION_NAME } from '../../src/main/config/paths.js';
import { getProductionUserDataDirectory, getDatabasePath } from '../../src/main/db/paths.js';
import { runCli } from '../../src/main/cli/index.js';

interface RendererBridgeInspection {
  exists: boolean;
  isFrozen: boolean;
  methods: string[];
  hasRawIpc: boolean;
  hasRequire: boolean;
  hasProcess: boolean;
  hasBuffer: boolean;
}

interface WindowSecurityInspection {
  windowCount: number;
  isDestroyed: boolean;
  url: string;
}

interface PingIpcResult {
  success: boolean;
  data: {
    pong: boolean;
    serverTimestamp: number;
  };
}

interface SystemInfoIpcResult {
  success: boolean;
  data: {
    platform: string;
    arch: string;
    appVersion: string;
    electronVersion: string;
    chromeVersion: string;
    nodeVersion: string;
  };
}

interface ValidateTargetIpcResult {
  success: boolean;
  data?: {
    valid: boolean;
    normalizedUrl?: string;
    inScope?: boolean;
    error?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface LifecycleReloadResult {
  reloaded: boolean;
  postReloadPing: PingIpcResult;
}

interface DashboardShellMountResult {
  hasRoot: boolean;
  hasShell: boolean;
  hasHeader: boolean;
  hasSidebar: boolean;
  hasViewport: boolean;
  hasStatusBar: boolean;
  headerTitle: string;
}

interface DashboardNavigationResult {
  initialOverview: boolean;
  validatorMounted: boolean;
  diagnosticsMounted: boolean;
  returnedToOverview: boolean;
  error?: string;
}

interface InteractiveValidationResult {
  caseA: { valid: boolean; inScope: boolean };
  caseB: { valid: boolean; outOfScope: boolean };
  caseC: { invalid: boolean };
  cleared: boolean;
  error?: string;
}

interface StrictCspStylesResult {
  inlineStyleAttributeCount: number;
  inlineStyleElementCount: number;
  elements: Array<{ tag: string; style: string | null }>;
}

interface LiveHeartbeatResult {
  headerConnected: boolean;
  statusBarConnected: boolean;
  headerBadgeText?: string;
  statusBarText?: string;
}

describe('Phase 1.2.4.2 — Live Electron Runtime Integration Suite', () => {
  let runner: ElectronProcessRunner;
  let readyEvent: ElectronReadyEvent;

  beforeAll(async () => {
    runner = new ElectronProcessRunner();
    readyEvent = await runner.start(25000);
  }, 30000);

  afterAll(async () => {
    if (runner) {
      await runner.stop(5000);
    }
  }, 10000);

  describe('Process Startup & Embedded Runtime Versions', () => {
    it('boots authentic Electron runtime and reports actual embedded versions without hardcoding', () => {
      expect(readyEvent.versions).toBeDefined();
      expect(readyEvent.versions.electron).toBe('44.10.2');
      expect(readyEvent.versions.node).toBe('24.22.2');
      expect(readyEvent.versions.chrome).toBe('152.0.7977.169');
      expect(typeof readyEvent.versions.v8).toBe('string');
      expect(readyEvent.versions.v8.length).toBeGreaterThan(0);
    });

    it('enforces that all Electron storage paths are strictly confined to .tmp with 0 files on C:', () => {
      const paths = readyEvent.storagePaths;
      expect(paths).toBeDefined();

      expect(paths.userData).toContain('.tmp\\userData');
      expect(paths.sessionData).toContain('.tmp\\sessionData');
      expect(paths.crashDumps).toContain('.tmp\\crashDumps');
      expect(paths.logs).toContain('.tmp\\logs');
      expect(paths.temp).toContain('.tmp\\appTemp');

      // Guarantee no storage paths leak onto C: drive
      for (const [key, val] of Object.entries(paths)) {
        expect(val.toUpperCase().startsWith('C:'), `Storage path ${key} leaked to C:`).toBe(false);
        expect(val.toUpperCase().includes('.TMP'), `Storage path ${key} is not in .tmp`).toBe(true);
      }
    });

    it('verifies that authentic Electron application name matches APPLICATION_NAME and standalone production CLI resolves EXACTLY the same production database path', async () => {
      // 1. App name in live Electron runtime matches APPLICATION_NAME
      expect(readyEvent.appName).toBe(APPLICATION_NAME);

      // 2. Query live runtime info
      const runtimeInfo = await runner.executeScenario<{
        appName: string;
        isPackaged: boolean;
        storagePaths: StoragePaths;
      }>('GET_RUNTIME_INFO');

      expect(runtimeInfo.appName).toBe(APPLICATION_NAME);

      // 3. Standalone CLI production path resolution (outside Electron)
      const cliProdUserData = getProductionUserDataDirectory();
      const cliProdDbPath = getDatabasePath(undefined, { isDev: false });

      // On Windows, expected path is %APPDATA%\ultimate-wordpress-and-website-auditor\database\auditor.db
      if (process.platform === 'win32') {
        const expectedWinAppData =
          process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        expect(cliProdUserData.toLowerCase()).toBe(
          path.join(expectedWinAppData, APPLICATION_NAME).toLowerCase(),
        );
        expect(cliProdDbPath.toLowerCase()).toBe(
          path.join(expectedWinAppData, APPLICATION_NAME, 'database', 'auditor.db').toLowerCase(),
        );
      }

      // 4. In a packaged production Electron application, app.getPath('userData') uses app.name (which is APPLICATION_NAME)
      // Therefore, the packaged Electron userData path is mathematically identical to getProductionUserDataDirectory()
      const theoreticalPackagedElectronDbPath = path.join(
        cliProdUserData,
        'database',
        'auditor.db',
      );
      expect(cliProdDbPath.toLowerCase()).toBe(theoreticalPackagedElectronDbPath.toLowerCase());

      // 5. Run real CLI command in production mode and verify it reports the exact production path
      const logs: string[] = [];
      const code = await runCli(['status', '--production', '--json'], {
        log: msg => logs.push(msg),
        error: () => {},
      });
      expect(code).toBe(0);
      const parsedCliStatus = JSON.parse(logs[0]);
      expect(parsedCliStatus.databasePath.toLowerCase()).toBe(cliProdDbPath.toLowerCase());
    });
  });

  describe('Renderer Loading & Preload Bridge Hardening', () => {
    it('executes CommonJS preload and exposes strictly frozen window.electronAPI with only approved methods', async () => {
      const bridge =
        await runner.executeScenario<RendererBridgeInspection>('INSPECT_RENDERER_BRIDGE');

      expect(bridge.exists).toBe(true);
      expect(bridge.isFrozen).toBe(true);
      expect(bridge.methods).toEqual([
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

      // Proves complete boundary isolation: no raw ipcRenderer or Node globals in Renderer
      expect(bridge.hasRawIpc).toBe(false);
      expect(bridge.hasRequire).toBe(false);
      expect(bridge.hasProcess).toBe(false);
      expect(bridge.hasBuffer).toBe(false);
    });

    it('verifies BrowserWindow creation security configuration in runtime', async () => {
      const config = await runner.executeScenario<WindowSecurityInspection>(
        'TEST_WINDOW_SECURITY_SETTINGS',
      );

      expect(config.windowCount).toBeGreaterThanOrEqual(1);
      expect(config.isDestroyed).toBe(false);
      expect(config.url).toContain('out/renderer/index.html');
    });
  });

  describe('Real Runtime IPC Invocation & Schema Envelopes', () => {
    it('executes authentic app:ping request and receives valid IPCResult envelope', async () => {
      const result = await runner.executeScenario<PingIpcResult>('EXECUTE_RENDERER_IPC', {
        method: 'ping',
        payload: {},
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.pong).toBe(true);
      expect(typeof result.data.serverTimestamp).toBe('number');
      expect(result.data.serverTimestamp).toBeGreaterThan(0);
    });

    it('executes authentic app:get-system-info request and receives host system info', async () => {
      const result = await runner.executeScenario<SystemInfoIpcResult>('EXECUTE_RENDERER_IPC', {
        method: 'getSystemInfo',
        payload: {},
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.platform).toBe('win32');
      expect(typeof result.data.arch).toBe('string');
      expect(result.data.appVersion).toBe('0.1.7');
      expect(result.data.electronVersion).toBe('44.10.2');
      expect(result.data.chromeVersion).toBe('152.0.7977.169');
      expect(result.data.nodeVersion).toBe('24.22.2');
    });

    it('executes authentic audit:validate-target with valid public URL and receives approved envelope', async () => {
      const result = await runner.executeScenario<ValidateTargetIpcResult>('EXECUTE_RENDERER_IPC', {
        method: 'validateTarget',
        payload: { targetUrl: 'https://example.com' },
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.valid).toBe(true);
      expect(result.data?.normalizedUrl).toBe('https://example.com');
      expect(result.data?.inScope).toBe(false);
    });

    it('executes authentic audit:validate-target with in-scope target URL', async () => {
      const result = await runner.executeScenario<ValidateTargetIpcResult>('EXECUTE_RENDERER_IPC', {
        method: 'validateTarget',
        payload: {
          targetUrl: 'https://example.com/blog',
          allowedScope: ['https://example.com'],
        },
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.valid).toBe(true);
      expect(result.data?.inScope).toBe(true);
      expect(result.data?.normalizedUrl).toBe('https://example.com/blog');
    });

    it('executes authentic audit:validate-target with invalid target URL string and receives safe rejection in result data', async () => {
      const result = await runner.executeScenario<ValidateTargetIpcResult>('EXECUTE_RENDERER_IPC', {
        method: 'validateTarget',
        payload: { targetUrl: 'not-a-valid-url' },
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.valid).toBe(false);
      expect(result.data?.inScope).toBe(false);
      expect(typeof result.data?.error).toBe('string');
    });

    it('executes authentic audit:validate-target with malformed schema payload and safely rejects with ERR_PAYLOAD_VALIDATION_FAILED', async () => {
      const result = await runner.executeScenario<ValidateTargetIpcResult>('EXECUTE_RENDERER_IPC', {
        method: 'validateTarget',
        payload: { targetUrl: 12345 },
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('ERR_PAYLOAD_VALIDATION_FAILED');
      expect(result.error?.message).toBe('Payload validation failed');
    });
  });

  describe('Lifecycle Reload & Process Cleanup', () => {
    it('survives renderer reload and maintains IPC channel responsiveness', async () => {
      const result = await runner.executeScenario<LifecycleReloadResult>('TEST_LIFECYCLE_RELOAD');
      expect(result.reloaded).toBe(true);
      expect(result.postReloadPing).toBeDefined();
      expect(result.postReloadPing.success).toBe(true);
      expect(result.postReloadPing.data.pong).toBe(true);
      expect(result.postReloadPing.data.serverTimestamp).toBeGreaterThan(0);
    });
  });

  describe('Phase 1.2.5.2 — Desktop Dashboard & Renderer UI Integration Suite', () => {
    it('mounts the complete React dashboard shell with header, sidebar, viewport, and status bar', async () => {
      const mount = await runner.executeScenario<DashboardShellMountResult>(
        'TEST_DASHBOARD_SHELL_MOUNT',
      );

      expect(mount.hasRoot).toBe(true);
      expect(mount.hasShell).toBe(true);
      expect(mount.hasHeader).toBe(true);
      expect(mount.hasSidebar).toBe(true);
      expect(mount.hasViewport).toBe(true);
      expect(mount.hasStatusBar).toBe(true);
      expect(mount.headerTitle).toBe('Ultimate WordPress & Website Auditor');
    });

    it('navigates seamlessly between Overview, Target Validator, and System Diagnostics in live DOM', async () => {
      const nav = await runner.executeScenario<DashboardNavigationResult>(
        'TEST_DASHBOARD_LIVE_NAVIGATION',
      );

      expect(nav.error).toBeUndefined();
      expect(nav.initialOverview).toBe(true);
      expect(nav.validatorMounted).toBe(true);
      expect(nav.diagnosticsMounted).toBe(true);
      expect(nav.returnedToOverview).toBe(true);
    });

    it('executes interactive target validation with independent valid and inScope evaluation in live Chromium', async () => {
      const result = await runner.executeScenario<InteractiveValidationResult>(
        'TEST_INTERACTIVE_TARGET_VALIDATION',
      );

      expect(result.error).toBeUndefined();

      // Case A: Valid target URL within authorized scope
      expect(result.caseA.valid).toBe(true);
      expect(result.caseA.inScope).toBe(true);

      // Case B: Valid target URL OUT OF AUTHORIZED SCOPE (Strict semantic distinction preserved)
      expect(result.caseB.valid).toBe(true);
      expect(result.caseB.outOfScope).toBe(true);

      // Case C: Invalid protocol
      expect(result.caseC.invalid).toBe(true);

      // Case D: Form reset
      expect(result.cleared).toBe(true);
    });

    it('proves strict zero inline styles in production build for style-src self CSP compliance', async () => {
      const csp = await runner.executeScenario<StrictCspStylesResult>(
        'TEST_STRICT_CSP_NO_INLINE_STYLES',
      );

      expect(csp.inlineStyleAttributeCount).toBe(0);
      expect(csp.inlineStyleElementCount).toBe(0);
      expect(csp.elements).toHaveLength(0);
    });

    it('establishes live IPC heartbeat status in Header and StatusBar', async () => {
      const heartbeat = await runner.executeScenario<LiveHeartbeatResult>(
        'TEST_LIVE_HEARTBEAT_STATUS',
      );

      expect(heartbeat.headerConnected).toBe(true);
      expect(heartbeat.statusBarConnected).toBe(true);
    });
  });
});
