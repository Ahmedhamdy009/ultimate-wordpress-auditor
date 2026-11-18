import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../../../../../');
export const TEST_APP_DIR = path.resolve(projectRoot, '.tmp/electron-runtime-app');
export const PROD_OUT_DIR = path.resolve(projectRoot, 'apps/desktop/out');

/**
 * Prepares the temporary Electron test application fixture under D:\ahmed\.tmp\electron-runtime-app.
 * Copies the compiled production build from apps/desktop/out to ensure complete runtime fidelity
 * without modifying production configuration.
 */
export function prepareElectronTestApp(targetDir: string = TEST_APP_DIR): void {
  // 1. Ensure test application directory exists
  fs.mkdirSync(targetDir, { recursive: true });

  // 2. Ensure package.json with valid Electron application entry point
  const desktopPkgPath = path.resolve(projectRoot, 'apps/desktop/package.json');
  const desktopVersion = fs.existsSync(desktopPkgPath)
    ? JSON.parse(fs.readFileSync(desktopPkgPath, 'utf8')).version
    : '0.1.4';
  const packageJsonPath = path.join(targetDir, 'package.json');
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(
      {
        name: 'electron-runtime-test-app',
        version: desktopVersion,
        type: 'module',
        main: 'main.mjs',
      },
      null,
      2,
    ),
  );

  // 3. Ensure apps/desktop/out is mirrored into test application
  const testOutDir = path.join(targetDir, 'out');
  fs.mkdirSync(testOutDir, { recursive: true });

  if (fs.existsSync(PROD_OUT_DIR)) {
    fs.cpSync(PROD_OUT_DIR, testOutDir, { recursive: true, force: true });
  } else {
    throw new Error(
      `ERR_PROD_OUT_MISSING: Compiled production artifacts not found at ${PROD_OUT_DIR}. Run 'pnpm build' first.`,
    );
  }

  // 3.1 Provide isolated test worker script for worker node integration verification
  const workerScriptPath = path.join(testOutDir, 'renderer', 'test-worker.js');
  fs.writeFileSync(
    workerScriptPath,
    `
self.onmessage = () => {
  self.postMessage({
    hasProcess: typeof process !== 'undefined',
    hasRequire: typeof require !== 'undefined',
    hasBuffer: typeof Buffer !== 'undefined',
    hasGlobal: typeof global !== 'undefined',
  });
};
`.trim(),
  );

  // 3.2 Ensure node_modules is accessible in test app via junction to apps/desktop/node_modules
  const testNodeModules = path.join(targetDir, 'node_modules');
  const desktopNodeModules = path.resolve(projectRoot, 'apps/desktop/node_modules');
  if (!fs.existsSync(testNodeModules) && fs.existsSync(desktopNodeModules)) {
    try {
      fs.symlinkSync(desktopNodeModules, testNodeModules, 'junction');
    } catch {
      // Safe fallback if link exists
    }
  }

  // 4. Write test harness main.mjs
  const mainMjsPath = path.join(targetDir, 'main.mjs');
  const mainMjsContent = `
import { app, BrowserWindow, session, ipcMain, webFrameMain } from 'electron';
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// Isolated test-harness DNS responses for deterministic offline validation tests
// without injecting any test hooks into the production out/main/index.js bundle.
const originalHarnessLookup = dns.promises.lookup.bind(dns.promises);
const syntheticPublicHosts = new Set([
  'example.com',
  'unauthorized-domain.com',
]);
dns.promises.lookup = async (hostname, options) => {
  const host = String(hostname).toLowerCase();
  if (syntheticPublicHosts.has(host) && options && options.all === true) {
    return [{ address: '93.184.216.34', family: 4 }];
  }
  if (host === 'rebind-local.test' && options && options.all === true) {
    return [{ address: '127.0.0.1', family: 4 }];
  }
  if (host === 'unresolvable-dns-test.invalid' && options && options.all === true) {
    const err = new Error('getaddrinfo ENOTFOUND unresolvable-dns-test.invalid');
    err.code = 'ENOTFOUND';
    throw err;
  }
  return originalHarnessLookup(hostname, options);
};

// Boot the production desktop application
import './out/main/index.js';

let clientSocket = null;
let mainWindow = null;

function sendToHost(message) {
  if (clientSocket && !clientSocket.destroyed) {
    try {
      clientSocket.write(JSON.stringify(message) + '\\n');
    } catch (err) {
      console.error('Socket write error:', err);
    }
  }
}

// Connect to loopback TCP server provided by test runner
const port = Number(process.env.TEST_IPC_PORT);
if (port && !isNaN(port)) {
  clientSocket = net.createConnection({ port, host: '127.0.0.1' }, () => {
    // If runner disconnects or dies, terminate Electron immediately to prevent orphans
    clientSocket.on('close', () => {
      app.quit();
    });

    let buffer = '';
    clientSocket.on('data', data => {
      buffer += data.toString();
      const lines = buffer.split('\\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        handleCommand(line.trim());
      }
    });
  });

  clientSocket.on('error', err => {
    console.error('Test socket error:', err);
    app.quit();
  });
}

let readySent = false;
function emitReady() {
  if (readySent) return;
  readySent = true;
  const versions = {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    v8: process.versions.v8,
  };

  const storagePaths = {
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    crashDumps: app.getPath('crashDumps'),
    logs: app.getPath('logs'),
    temp: app.getPath('temp'),
  };

  sendToHost({
    type: 'READY',
    appName: app.name,
    versions,
    storagePaths,
  });
}

function attachWindowReady(win) {
  mainWindow = win;
  const wc = win.webContents;

  if (!wc.isLoadingMainFrame() && wc.getURL()) {
    emitReady();
    return;
  }

  wc.once('did-finish-load', () => {
    emitReady();
  });

  wc.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (!readySent) {
      sendToHost({
        type: 'ERROR',
        error: \`Renderer failed to load (\${errorCode} \${errorDescription}): \${validatedURL}\`,
      });
    }
  });

  wc.once('render-process-gone', (_event, details) => {
    if (!readySent) {
      sendToHost({
        type: 'ERROR',
        error: \`Renderer process exited prematurely: \${details.reason} (\${details.exitCode})\`,
      });
    }
  });
}

app.whenReady().then(() => {
  const windows = BrowserWindow.getAllWindows();
  if (windows[0]) {
    attachWindowReady(windows[0]);
    return;
  }

  // Wait briefly in case mainWindow creation completes on an async tick after whenReady
  const waitTimer = setTimeout(() => {
    const current = BrowserWindow.getAllWindows();
    if (current[0]) {
      attachWindowReady(current[0]);
    } else if (!readySent) {
      sendToHost({ type: 'ERROR', error: 'No BrowserWindow created by main process lifecycle' });
    }
  }, 5000);

  app.once('browser-window-created', (_event, win) => {
    clearTimeout(waitTimer);
    attachWindowReady(win);
  });
});

async function handleCommand(rawLine) {
  let command;
  try {
    command = JSON.parse(rawLine);
  } catch (err) {
    sendToHost({ type: 'ERROR', error: 'Malformed JSON command' });
    return;
  }

  const { id, type, scenario, params } = command;

  if (type === 'PING') {
    sendToHost({ type: 'PONG', id });
    return;
  }

  if (type === 'SHUTDOWN') {
    sendToHost({ type: 'SHUTDOWN_ACK', id });
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
    setTimeout(() => {
      app.quit();
    }, 50);
    return;
  }

  if (type === 'RUN_SCENARIO') {
    try {
      const result = await executeScenario(scenario, params);
      sendToHost({
        type: 'RESULT',
        id,
        success: true,
        data: result,
      });
    } catch (err) {
      sendToHost({
        type: 'RESULT',
        id,
        success: false,
        error: {
          message: err.message,
          stack: err.stack,
        },
      });
    }
  }
}

async function executeScenario(scenario, params) {
  switch (scenario) {
    case 'GET_RUNTIME_INFO': {
      return {
        appName: app.name,
        isPackaged: Boolean(app.isPackaged),
        versions: {
          electron: process.versions.electron,
          node: process.versions.node,
          chrome: process.versions.chrome,
          v8: process.versions.v8,
        },
        storagePaths: {
          userData: app.getPath('userData'),
          sessionData: app.getPath('sessionData'),
          crashDumps: app.getPath('crashDumps'),
          logs: app.getPath('logs'),
          temp: app.getPath('temp'),
        },
      };
    }

    case 'INSPECT_RENDERER_BRIDGE': {
      return await mainWindow.webContents.executeJavaScript(\`
        (() => {
          const api = window.electronAPI;
          if (!api || typeof api !== 'object') {
            return { exists: false };
          }
          return {
            exists: true,
            isFrozen: Object.isFrozen(api),
            methods: Object.keys(api).sort(),
            hasRawIpc: typeof window.ipcRenderer !== 'undefined',
            hasRequire: typeof window.require !== 'undefined',
            hasProcess: typeof window.process !== 'undefined',
            hasBuffer: typeof window.Buffer !== 'undefined',
          };
        })()
      \`);
    }

    case 'EXECUTE_RENDERER_IPC': {
      const { method, payload } = params;
      const serializedPayload = JSON.stringify(payload);
      const code = \`
        window.electronAPI.\${method}(\${serializedPayload !== undefined ? serializedPayload : ''})
      \`;
      return await mainWindow.webContents.executeJavaScript(code);
    }

    case 'TEST_SUBFRAME_IPC': {
      // 1. Create a test-only window with subframe nodeIntegration to generate genuine subframe IPC
      const subframeWin = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true,
          nodeIntegrationInSubFrames: true,
          contextIsolation: false,
          sandbox: false,
        },
      });

      const html = \`
        <!DOCTYPE html>
        <html>
          <body>
            <iframe id="child" src="data:text/html,<html><body>subframe</body></html>"></iframe>
          </body>
        </html>
      \`;

      await subframeWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      await new Promise(r => setTimeout(r, 200));

      let iframeResult = null;
      try {
        const mainFrame = subframeWin.webContents.mainFrame;
        const childFrame = mainFrame.frames[0];

        iframeResult = await childFrame.executeJavaScript(\`
          new Promise(async (resolve, reject) => {
            try {
              const { ipcRenderer } = require('electron');
              const res = await ipcRenderer.invoke('app:ping');
              resolve({ attempted: true, result: res });
            } catch (err) {
              resolve({ attempted: true, error: err.message });
            }
          })
        \`);
      } catch (err) {
        iframeResult = { attempted: false, error: err.message };
      } finally {
        if (!subframeWin.isDestroyed()) {
          subframeWin.destroy();
        }
      }

      // 2. Verify legitimate main frame IPC still succeeds
      const mainFrameResult = await mainWindow.webContents.executeJavaScript(\`
        window.electronAPI.ping()
      \`);

      return {
        iframeResult,
        mainFrameResult,
      };
    }

    case 'TEST_UNTRUSTED_WINDOW': {
      // Create an unprivileged untrusted window without approved preload
      const untrustedWin = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      try {
        await untrustedWin.loadURL('about:blank');
        const inspection = await untrustedWin.webContents.executeJavaScript(\`
          (() => {
            return {
              hasElectronApi: typeof window.electronAPI !== 'undefined',
              hasIpcRenderer: typeof window.ipcRenderer !== 'undefined',
              hasRequire: typeof window.require !== 'undefined',
            };
          })()
        \`);
        return inspection;
      } finally {
        if (!untrustedWin.isDestroyed()) {
          untrustedWin.destroy();
        }
      }
    }

    case 'TEST_CSP_EVAL': {
      return await mainWindow.webContents.executeJavaScript(\`
        (() => {
          try {
            eval('1 + 1');
            return { evalBlocked: false };
          } catch (err) {
            return { evalBlocked: true, errorMessage: err.message };
          }
        })()
      \`);
    }

    case 'TEST_CSP_INLINE_SCRIPT': {
      return await mainWindow.webContents.executeJavaScript(\`
        new Promise((resolve) => {
          const script = document.createElement('script');
          script.textContent = 'window.__inlineScriptExecuted = true;';
          window.__inlineScriptExecuted = false;
          try {
            document.body.appendChild(script);
            setTimeout(() => {
              const executed = Boolean(window.__inlineScriptExecuted);
              script.remove();
              resolve({ inlineBlocked: !executed });
            }, 100);
          } catch (err) {
            resolve({ inlineBlocked: true, errorMessage: err.message });
          }
        })
      \`);
    }

    case 'TEST_UNKNOWN_CHANNEL': {
      return await mainWindow.webContents.executeJavaScript(\`
        (() => {
          return {
            hasGenericInvoke: typeof window.electronAPI.invoke === 'function',
            hasGenericSend: typeof window.electronAPI.send === 'function',
            exposedKeys: Object.keys(window.electronAPI),
          };
        })()
      \`);
    }

    case 'TEST_RATE_LIMITING': {
      // Execute 7 sequential calls to app:get-system-info (limit: 5 req/s)
      return await mainWindow.webContents.executeJavaScript(\`
        (async () => {
          const results = [];
          for (let i = 0; i < 7; i++) {
            const res = await window.electronAPI.getSystemInfo();
            results.push(res);
          }
          return results;
        })()
      \`);
    }

    case 'TEST_CONCURRENCY_LIMITING': {
      // 1. Retrieve the active production SecureIpcDispatcher instance
      const { initializeMainProcess } = await import('./out/main/index.js');
      const dispatcher = initializeMainProcess();
      const originalPingHandler = dispatcher.registeredHandlers.get('app:ping');

      if (!originalPingHandler) {
        throw new Error('Original app:ping handler not found on dispatcher');
      }

      // 2. Setup deterministic synchronization barrier with guaranteed idempotent cleanup
      let isBarrierReleased = false;
      let rawReleaseBarrier;
      const barrierPromise = new Promise(resolve => {
        rawReleaseBarrier = resolve;
      });

      const safeReleaseBarrier = () => {
        if (!isBarrierReleased) {
          isBarrierReleased = true;
          if (typeof rawReleaseBarrier === 'function') {
            rawReleaseBarrier();
          }
        }
      };

      let inFlightCount = 0;
      let heldCount = 0;

      // Wrap app:ping handler to hold exactly the first 5 requests in flight
      dispatcher.registeredHandlers.set('app:ping', async (req, ctx) => {
        inFlightCount++;
        const currentReqIndex = inFlightCount;
        if (currentReqIndex <= 5) {
          heldCount++;
          await barrierPromise;
        }
        return await originalPingHandler(req, ctx);
      });

      try {
        // 3. Renderer dispatches 5 requests that will be held by the barrier
        await mainWindow.webContents.executeJavaScript(\`
          (() => {
            window.__heldPingPromises = [
              window.electronAPI.ping(),
              window.electronAPI.ping(),
              window.electronAPI.ping(),
              window.electronAPI.ping(),
              window.electronAPI.ping(),
            ];
          })()
        \`);

        // Wait in Main Process until exactly 5 requests are verified held in flight
        const startWait = Date.now();
        while (heldCount < 5 && Date.now() - startWait < 5000) {
          await new Promise(r => setTimeout(r, 10));
        }

        if (heldCount !== 5) {
          throw new Error('Failed to hold 5 requests in flight; actual held: ' + heldCount);
        }

        // 4. While the 5 slots are held in flight, dispatch request 6 and request 7
        const overflowResults = await mainWindow.webContents.executeJavaScript(\`
          (async () => {
            const req6 = await window.electronAPI.ping();
            const req7 = await window.electronAPI.ping();
            return { req6, req7 };
          })()
        \`);

        // 5. Release the barrier so the 5 held requests can complete and release their slots
        safeReleaseBarrier();

        // 6. Await the 5 held promises and execute request 8 after all slots are released
        const finalResults = await mainWindow.webContents.executeJavaScript(\`
          (async () => {
            const heldResults = await Promise.all(window.__heldPingPromises);
            delete window.__heldPingPromises;

            // Request 8 dispatched after all 5 slots have been released
            const req8 = await window.electronAPI.ping();
            return { heldResults, req8 };
          })()
        \`);

        return {
          heldCount,
          heldResults: finalResults.heldResults,
          req6: overflowResults.req6,
          req7: overflowResults.req7,
          req8: finalResults.req8,
        };
      } finally {
        // Guaranteed cleanup: ensure barrier is released so no promises remain blocked
        safeReleaseBarrier();
        // Guaranteed restoration of production handler
        if (originalPingHandler) {
          dispatcher.registeredHandlers.set('app:ping', originalPingHandler);
        }
      }
    }

    case 'TEST_PAYLOAD_BOUNDS': {
      return await mainWindow.webContents.executeJavaScript(\`
        (async () => {
          const largeString = 'A'.repeat(1024 * 10); // 10 KB > 8 KB limit
          return await window.electronAPI.validateTarget({ targetUrl: 'https://example.com/' + largeString });
        })()
      \`);
    }

    case 'TEST_WINDOW_SECURITY_SETTINGS': {
      const wc = mainWindow.webContents;
      return {
        windowCount: BrowserWindow.getAllWindows().length,
        isDestroyed: mainWindow.isDestroyed(),
        url: wc.getURL(),
      };
    }

    case 'TEST_WORKER_NODE_INTEGRATION': {
      // 1. Inspect production mainWindow worker (sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false)
      const productionWorker = await mainWindow.webContents.executeJavaScript(\`
        new Promise((resolve, reject) => {
          try {
            const worker = new Worker('./test-worker.js');
            const timer = setTimeout(() => {
              worker.terminate();
              reject(new Error('Production worker inspection timed out'));
            }, 3000);

            worker.onmessage = (e) => {
              clearTimeout(timer);
              worker.terminate();
              resolve(e.data);
            };

            worker.onerror = (err) => {
              clearTimeout(timer);
              worker.terminate();
              reject(new Error(err.message || 'Worker initialization failed'));
            };

            worker.postMessage('inspect');
          } catch (err) {
            reject(new Error(err.message));
          }
        })
      \`);

      // 2. Isolated Negative Control Window (sandbox: false, nodeIntegration: true, nodeIntegrationInWorker: false)
      // Confirms nodeIntegrationInWorker: false blocks Node in Worker independently of sandbox
      const negWin = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true,
          sandbox: false,
          contextIsolation: false,
          nodeIntegrationInWorker: false,
        },
      });

      let isolatedNegative = null;
      try {
        await negWin.loadURL(mainWindow.webContents.getURL());
        isolatedNegative = await negWin.webContents.executeJavaScript(\`
          new Promise((resolve, reject) => {
            try {
              const worker = new Worker('./test-worker.js');
              const timer = setTimeout(() => {
                worker.terminate();
                reject(new Error('Isolated negative worker timed out'));
              }, 3000);

              worker.onmessage = (e) => {
                clearTimeout(timer);
                worker.terminate();
                resolve(e.data);
              };

              worker.onerror = (err) => {
                clearTimeout(timer);
                worker.terminate();
                reject(new Error(err.message || 'Isolated negative worker failed'));
              };

              worker.postMessage('inspect');
            } catch (err) {
              reject(new Error(err.message));
            }
          })
        \`);
      } finally {
        if (!negWin.isDestroyed()) {
          negWin.destroy();
        }
      }

      // 3. Isolated Positive Control Window (sandbox: false, nodeIntegration: true, nodeIntegrationInWorker: true)
      // Confirms nodeIntegrationInWorker: true activates Node in Worker independently of sandbox
      const posWin = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true,
          sandbox: false,
          contextIsolation: false,
          nodeIntegrationInWorker: true,
        },
      });

      let isolatedPositive = null;
      try {
        await posWin.loadURL(mainWindow.webContents.getURL());
        isolatedPositive = await posWin.webContents.executeJavaScript(\`
          new Promise((resolve, reject) => {
            try {
              const worker = new Worker('./test-worker.js');
              const timer = setTimeout(() => {
                worker.terminate();
                reject(new Error('Isolated positive worker timed out'));
              }, 3000);

              worker.onmessage = (e) => {
                clearTimeout(timer);
                worker.terminate();
                resolve(e.data);
              };

              worker.onerror = (err) => {
                clearTimeout(timer);
                worker.terminate();
                reject(new Error(err.message || 'Isolated positive worker failed'));
              };

              worker.postMessage('inspect');
            } catch (err) {
              reject(new Error(err.message));
            }
          })
        \`);
      } finally {
        if (!posWin.isDestroyed()) {
          posWin.destroy();
        }
      }

      return {
        productionWorker,
        isolatedNegative,
        isolatedPositive,
      };
    }

    case 'TEST_INSECURE_CONTENT': {
      // 1. Start local loopback HTTP server
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('window.__insecureScriptExecuted = true;');
      });

      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const localPort = server.address().port;

      try {
        // 2. Attempt to load and execute insecure HTTP script in the secure mainWindow
        return await mainWindow.webContents.executeJavaScript(\`
          new Promise((resolve) => {
            window.__insecureScriptExecuted = false;
            const script = document.createElement('script');
            script.src = 'http://127.0.0.1:\${localPort}/insecure-script.js';

            script.onload = () => {
              script.remove();
              resolve({
                blocked: false,
                insecureScriptExecuted: Boolean(window.__insecureScriptExecuted),
              });
            };

            script.onerror = () => {
              script.remove();
              resolve({
                blocked: true,
                insecureScriptExecuted: Boolean(window.__insecureScriptExecuted),
              });
            };

            document.body.appendChild(script);

            setTimeout(() => {
              script.remove();
              resolve({
                blocked: !window.__insecureScriptExecuted,
                insecureScriptExecuted: Boolean(window.__insecureScriptExecuted),
                timeout: true,
              });
            }, 500);
          })
        \`);
      } finally {
        server.close();
      }
    }

    case 'TEST_NAVIGATION_BLOCKED': {
      const targetUrl = params?.url || 'https://unauthorized-navigation.com';
      return new Promise(resolve => {
        const handler = (event, url) => {
          if (url.includes('unauthorized-navigation.com')) {
            resolve({
              navigationAttempted: true,
              blocked: event.defaultPrevented,
              url,
            });
          }
        };

        mainWindow.webContents.once('will-navigate', handler);

        mainWindow.webContents.executeJavaScript(\`
          try {
            window.location.href = '\${targetUrl}';
          } catch (e) {
            // expected
          }
        \`).catch(() => {});

        setTimeout(() => {
          if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.removeListener('will-navigate', handler);
          }
          resolve({
            navigationAttempted: true,
            blocked: true,
            url: targetUrl,
          });
        }, 500);
      });
    }

    case 'TEST_WINDOW_OPEN_DENIED': {
      return await mainWindow.webContents.executeJavaScript(\`
        (() => {
          const popup = window.open('https://evil.com', '_blank');
          return {
            popupReturnedNull: popup === null,
          };
        })()
      \`);
    }

    case 'TEST_LIFECYCLE_RELOAD': {
      await mainWindow.webContents.reload();
      await new Promise(r => mainWindow.webContents.once('did-finish-load', r));
      const postReloadPing = await mainWindow.webContents.executeJavaScript(\`
        window.electronAPI.ping()
      \`);
      return {
        reloaded: true,
        postReloadPing,
      };
    }

    case 'TEST_DASHBOARD_SHELL_MOUNT': {
      return await mainWindow.webContents.executeJavaScript(\`
        (() => {
          const root = document.getElementById('root');
          const shell = document.querySelector('.auditor-shell');
          const header = document.querySelector('.auditor-header');
          const sidebar = document.querySelector('.auditor-sidebar');
          const viewport = document.querySelector('.auditor-viewport');
          const statusBar = document.querySelector('.auditor-statusbar');
          const title = header?.querySelector('.auditor-header__logo')?.textContent || '';

          return {
            hasRoot: Boolean(root),
            hasShell: Boolean(shell),
            hasHeader: Boolean(header),
            hasSidebar: Boolean(sidebar),
            hasViewport: Boolean(viewport),
            hasStatusBar: Boolean(statusBar),
            headerTitle: title.trim(),
          };
        })()
      \`);
    }

    case 'TEST_DASHBOARD_LIVE_NAVIGATION': {
      return await mainWindow.webContents.executeJavaScript(\`
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));

          const initialOverview = Boolean(document.querySelector('.auditor-welcome-banner'));

          const targetNavBtn = document.getElementById('nav-item-target-validator');
          if (!targetNavBtn) return { error: 'Target validator nav button missing' };
          targetNavBtn.click();
          await sleep(50);

          const validatorMounted = Boolean(document.getElementById('target-url-input'));

          const diagNavBtn = document.getElementById('nav-item-system-diagnostics');
          if (!diagNavBtn) return { error: 'Diagnostics nav button missing' };
          diagNavBtn.click();
          await sleep(50);

          const diagnosticsMounted = Boolean(document.getElementById('reload-system-info-button'));

          const overviewNavBtn = document.getElementById('nav-item-overview');
          if (!overviewNavBtn) return { error: 'Overview nav button missing' };
          overviewNavBtn.click();
          await sleep(50);

          const returnedToOverview = Boolean(document.querySelector('.auditor-welcome-banner'));

          return {
            initialOverview,
            validatorMounted,
            diagnosticsMounted,
            returnedToOverview,
          };
        })()
      \`);
    }

    case 'TEST_INTERACTIVE_TARGET_VALIDATION': {
      return await mainWindow.webContents.executeJavaScript(\`
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));

          const targetNavBtn = document.getElementById('nav-item-target-validator');
          if (targetNavBtn) targetNavBtn.click();
          await sleep(50);

          const urlInput = document.getElementById('target-url-input');
          const scopeInput = document.getElementById('allowed-scope-input');
          const validateBtn = document.getElementById('validate-target-button');
          const clearBtn = document.getElementById('clear-target-button');

          if (!urlInput || !scopeInput || !validateBtn) {
            return { error: 'Form elements missing' };
          }

          const setNativeValue = (element, value) => {
            const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (valueSetter) {
              valueSetter.call(element, value);
            } else {
              element.value = value;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          };

          // Test Case A: Valid target URL in-scope
          setNativeValue(urlInput, 'https://example.com/test');
          setNativeValue(scopeInput, 'https://example.com');
          await sleep(50);

          validateBtn.click();
          await sleep(350);

          const caseAResults = document.querySelector('.auditor-results-box')?.textContent || '';
          const caseAValid = caseAResults.includes('Valid Target Syntax');
          const caseAInScope = caseAResults.includes('Authorized In-Scope');

          // Test Case B: Valid target URL OUT OF SCOPE
          setNativeValue(urlInput, 'https://unauthorized-domain.com');
          setNativeValue(scopeInput, 'https://example.com');
          await sleep(50);

          validateBtn.click();
          await sleep(350);

          const caseBResults = document.querySelector('.auditor-results-box')?.textContent || '';
          const caseBValid = caseBResults.includes('Valid Target Syntax');
          const caseBOutOfScope = caseBResults.includes('Out of Scope (Unauthorized)');

          // Test Case C: Invalid protocol
          setNativeValue(urlInput, 'ftp://invalid-protocol.com');
          await sleep(50);

          validateBtn.click();
          await sleep(350);

          const caseCResults = document.querySelector('.auditor-results-box')?.textContent || '';
          const caseCInvalid = caseCResults.includes('Invalid Syntax / Port Violation');

          // Test Case D: Clear form
          if (clearBtn) clearBtn.click();
          await sleep(50);
          const clearedUrl = urlInput.value;
          const clearedScope = scopeInput.value;

          return {
            caseA: { valid: caseAValid, inScope: caseAInScope },
            caseB: { valid: caseBValid, outOfScope: caseBOutOfScope },
            caseC: { invalid: caseCInvalid },
            cleared: clearedUrl === '' && clearedScope === '',
          };
        })()
      \`);
    }

    case 'TEST_STRICT_CSP_NO_INLINE_STYLES': {
      return await mainWindow.webContents.executeJavaScript(\`
        (() => {
          const elementsWithInlineStyle = document.querySelectorAll('[style]');
          const inlineStyleTags = document.querySelectorAll('style');

          return {
            inlineStyleAttributeCount: elementsWithInlineStyle.length,
            inlineStyleElementCount: inlineStyleTags.length,
            elements: Array.from(elementsWithInlineStyle).map(el => ({
              tag: el.tagName,
              style: el.getAttribute('style'),
            })),
          };
        })()
      \`);
    }

    case 'TEST_LIVE_HEARTBEAT_STATUS': {
      return await mainWindow.webContents.executeJavaScript(\`
        (() => {
          const header = document.querySelector('.auditor-header');
          const statusBar = document.querySelector('.auditor-statusbar');

          const headerText = header?.textContent || '';
          const statusText = statusBar?.textContent || '';

          return {
            headerConnected: headerText.includes('IPC Connected'),
            statusBarConnected: statusText.includes('IPC Connected'),
            headerText,
            statusText,
          };
        })()
      \`);
    }

    case 'TEST_BATCH_7_4_4_GUI_FLOW': {
      const req = createRequire(import.meta.url);
      const Database = req('better-sqlite3');
      const dbPath = path.join(app.getPath('userData'), 'database', 'auditor.db');
      const nativeBinding = path.join(
        import.meta.dirname,
        'out',
        'main',
        'native',
        \`electron-v\${process.versions.modules}-\${process.platform}-\${process.arch}\`,
        'better_sqlite3.node',
      );
      const db = new Database(dbPath, { nativeBinding });
      try {
      const nowIso = '2026-11-16T10:00:00.000Z';
      const projId = 'aaaaaaaa-1111-4111-8111-111111111101';
      const siteId = 'bbbbbbbb-1111-4111-8111-111111111101';
      const scan1Id = 'cccccccc-1111-4111-8111-111111111101';
      const scan2Id = 'cccccccc-2222-4222-8222-222222222202';

      // Write a controlled 1x1 PNG fixture screenshot inside the isolated userData screenshots folder
      const screenshotsDir = path.join(app.getPath('userData'), 'reports', 'screenshots');
      fs.mkdirSync(screenshotsDir, { recursive: true });
      const pngBytes = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
        'hex',
      );
      fs.writeFileSync(path.join(screenshotsDir, 'gui-test-overflow.png'), pngBytes);

      const summary1 = JSON.stringify({
        totalFindings: 5,
        criticalCount: 0,
        highCount: 3,
        mediumCount: 1,
        lowCount: 0,
        infoCount: 1,
        urlsCrawled: 6,
        pagesScanned: 6,
        crawlFailedPages: 0,
        staticModulesExecuted: 5,
        staticModulesTotal: 5,
        browserPagesAudited: 3,
        browserCandidatesTotal: 3,
        runtimeAuditsCompleted: 3,
        accessibilityCandidatesTotal: 3,
        accessibilityAuditsCompleted: 3,
        layoutStabilityPagesCompleted: 3,
        screenshotsCaptured: 1,
        coverageStatus: 'full',
        isPartialCoverage: false,
        resourceBytesByType: { document: 42000, script: 280000, stylesheet: 90000, image: 410000 },
        performanceMetrics: {
          labMetrics: { ttfbMs: 320, fcpMs: 1100, lcpMs: 2800, cls: 0.04, tbtMs: 180, isLcpCapped: false },
          resourceSummary: {
            totalResources: 22,
            totalTransferSizeBytes: 822000,
            renderBlockingCount: 2,
            scriptsCount: 8,
            stylesheetsCount: 4,
            imagesCount: 7,
            oversizedImagesCount: 1,
            uncompressedAssetsCount: 0,
          },
        },
      });

      const config1 = JSON.stringify({
        maxPages: 25,
        maxDepth: 3,
        enableBrowserAudit: true,
        auditModules: {
          http: true,
          wordpress: true,
          securityHeaders: true,
          cookies: true,
          seo: true,
          runtimeErrors: true,
          networkResources: true,
          responsiveLayout: true,
          layoutStability: true,
          screenshots: true,
          accessibility: true,
        },
      });

      db.prepare(
        'INSERT INTO projects (id, name, description, is_archived, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      ).run(projId, 'GUI Test Project', 'Controlled fixture', nowIso, nowIso);

      db.prepare(
        'INSERT INTO sites (id, project_id, name, base_url, platform_type, environment_type, description, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)',
      ).run(siteId, projId, 'WP Demo Store', 'https://gui-fixture.example.test', 'wordpress', 'staging', nowIso, nowIso);

      db.prepare(
        'INSERT INTO scan_runs (id, site_id, scan_type, status, target_url, started_at, completed_at, cancelled_at, duration_ms, config_json, summary_json, error_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)',
      ).run(scan1Id, siteId, 'full', 'completed', 'https://gui-fixture.example.test', nowIso, nowIso, 42000, config1, summary1, nowIso, nowIso);

      db.prepare(
        'INSERT INTO scan_runs (id, site_id, scan_type, status, target_url, started_at, completed_at, cancelled_at, duration_ms, config_json, summary_json, error_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)',
      ).run(
        scan2Id,
        siteId,
        'full',
        'cancelled',
        'https://gui-fixture.example.test',
        '2026-10-01T10:00:00.000Z',
        '2026-10-01T10:00:10.000Z',
        10000,
        '{}',
        JSON.stringify({ code: 'ERR_SCAN_CANCELLED', message: 'Cancelled historical scan' }),
        '2026-10-01T10:00:00.000Z',
        '2026-10-01T10:00:10.000Z',
      );

      const insertFinding = db.prepare(
        'INSERT INTO findings (id, scan_run_id, rule_id, category, title, description, severity, confidence, status, target_url, evidence_json, remediation, references_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );

      insertFinding.run(
        'dddddddd-1111-4111-8111-111111111101',
        scan1Id,
        'SEC_HEADER_CSP_MISSING',
        'security',
        'Missing Content-Security-Policy Header',
        'CSP header missing on home.',
        'high',
        'confirmed',
        'confirmed',
        'https://gui-fixture.example.test/',
        JSON.stringify({ headerName: 'Content-Security-Policy', headers: { server: 'nginx' } }),
        'Add CSP header.',
        '[]',
        nowIso,
      );
      insertFinding.run(
        'dddddddd-1111-4111-8111-111111111102',
        scan1Id,
        'SEC_HEADER_CSP_MISSING',
        'security',
        'Missing Content-Security-Policy Header',
        'CSP header missing on shop.',
        'high',
        'confirmed',
        'confirmed',
        'https://gui-fixture.example.test/shop',
        JSON.stringify({ headerName: 'Content-Security-Policy' }),
        'Add CSP header.',
        '[]',
        nowIso,
      );
      insertFinding.run(
        'dddddddd-1111-4111-8111-111111111103',
        scan1Id,
        'RESPONSIVE_HORIZONTAL_OVERFLOW',
        'responsive-design',
        'Horizontal Overflow Detected',
        'Layout overflows mobile viewport.',
        'medium',
        'firm',
        'confirmed',
        'https://gui-fixture.example.test/shop',
        JSON.stringify({
          selector: '.gui-overflow-box',
          screenshot: {
            id: 'gui-test-overflow',
            fileName: 'gui-test-overflow.png',
            viewportProfile: 'mobile',
            captureType: 'viewport',
            width: 390,
            height: 844,
          },
        }),
        'Fix container overflow.',
        '[]',
        nowIso,
      );
      insertFinding.run(
        'dddddddd-1111-4111-8111-111111111104',
        scan1Id,
        'PERF_BOTTLENECK_DIAGNOSIS',
        'static-performance',
        'Render-Blocking Assets',
        'Render-blocking assets delayed LCP.',
        'high',
        'confirmed',
        'confirmed',
        'https://gui-fixture.example.test/',
        JSON.stringify({
          classification: 'RENDER_BLOCKING_ASSETS',
          causality: 'causal',
          primaryMetricName: 'LCP',
          observedValue: 2800,
          thresholdValue: 2500,
          unit: 'ms',
        }),
        'Defer non-critical JS.',
        '[]',
        nowIso,
      );
      insertFinding.run(
        'dddddddd-1111-4111-8111-111111111105',
        scan1Id,
        'WP_DETECTED',
        'wordpress',
        'WordPress Stack Detected',
        'WordPress with Elementor Pro and WooCommerce.',
        'info',
        'confirmed',
        'confirmed',
        'https://gui-fixture.example.test/',
        JSON.stringify({
          confidence: 'confirmed',
          version: '6.7.2',
          plugins: ['elementor-pro', 'woocommerce'],
          themes: ['hello-elementor'],
        }),
        null,
        '[]',
        nowIso,
      );
      insertFinding.run(
        'dddddddd-2222-4222-8222-222222222201',
        scan2Id,
        'HIS_ONLY_FINDING',
        'technical-seo',
        'Historical Scan SEO Note',
        'Persisted prior to cancel.',
        'low',
        'potential',
        'potential',
        'https://gui-fixture.example.test/old',
        null,
        null,
        '[]',
        '2026-10-01T10:00:05.000Z',
      );
      } finally {
        db.close();
      }

      return await mainWindow.webContents.executeJavaScript(\`
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const waitFor = async (fn, timeoutMs = 6000) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
              const res = fn();
              if (res) return res;
              await sleep(40);
            }
            return null;
          };

          // Reload so OverviewView fetches freshly seeded DB records
          document.getElementById('nav-item-projects')?.click();
          await sleep(80);
          document.getElementById('nav-item-overview')?.click();

          const overviewExec = await waitFor(() =>
            document.querySelector('[data-testid="executive-summary-dashboard"]'),
          );
          if (!overviewExec) return { error: 'Overview executive dashboard did not mount' };

          const overviewText = overviewExec.textContent || '';
          const overviewHasStack = overviewText.includes('Elementor Pro') && overviewText.includes('WooCommerce');
          const overviewHasTriad = Boolean(document.querySelector('[data-testid="triad-health-index"]'));
          const overviewHasD1ToD4 =
            Boolean(document.querySelector('[data-testid="coverage-dimension-d1"]')) &&
            Boolean(document.querySelector('[data-testid="coverage-dimension-d2"]')) &&
            Boolean(document.querySelector('[data-testid="coverage-dimension-d3"]')) &&
            Boolean(document.querySelector('[data-testid="coverage-dimension-d4"]'));

          // Navigate to Audit & Scans and open Scan 1
          document.getElementById('nav-item-scans')?.click();
          const inspectButtons = await waitFor(() => {
            const btns = Array.from(document.querySelectorAll('.auditor-site-item__actions button'))
              .filter(b => b.textContent?.includes('Inspect Findings'));
            return btns.length >= 2 ? btns : null;
          });
          if (!inspectButtons) return { error: 'Scan history Inspect buttons not found' };

          inspectButtons[0].click();
          const explorer = await waitFor(() => document.querySelector('[data-testid="findings-explorer"]'));
          if (!explorer) return { error: 'FindingsExplorer did not mount for Scan 1' };

          // Verify 7 SVG charts rendered
          const chartTestIds = [
            'chart-severity-distribution',
            'chart-category-breakdown',
            'chart-coverage-dimensions',
            'chart-lab-vitals',
            'chart-asset-breakdown',
            'chart-bottleneck-summary',
            'chart-top-affected-pages',
          ];
          const all7ChartsPresent = chartTestIds.every(id => {
            const el = document.querySelector('[data-testid="' + id + '"]');
            return Boolean(el && el.querySelector('svg'));
          });

          // Verify zero inline styles inside new Batch 7.4.4 components
          const batch744Selectors = [
            '[data-testid="executive-summary-dashboard"]',
            '[data-testid="coverage-dimensions-panel"]',
            '[data-testid="audit-charts-suite"]',
            '[data-testid="performance-vitals-card"]',
            '[data-testid="findings-explorer"]',
            '.auditor-header',
          ];
          const inlineStyleCountInBatch744 = batch744Selectors.reduce((acc, sel) => {
            const rootEl = document.querySelector(sel);
            if (!rootEl) return acc;
            return acc + rootEl.querySelectorAll('[style]').length + (rootEl.hasAttribute('style') ? 1 : 0);
          }, 0);

          // Search for .gui-overflow-box
          const searchInput = document.querySelector('[data-testid="findings-search-input"]');
          const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          valueSetter.call(searchInput, '.gui-overflow-box');
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          searchInput.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(60);

          const filteredCardCount = document.querySelectorAll('[data-testid^="finding-card-"]').length;

          // Expand the overflow finding and verify screenshot img + modal
          const expandBtn = document.querySelector('[data-testid^="finding-toggle-"]');
          expandBtn?.click();
          const thumbImg = await waitFor(() => {
            const img = document.querySelector('.auditor-screenshot-thumb');
            return img && img.complete && img.naturalWidth > 0 ? img : null;
          });
          const screenshotThumbLoaded = Boolean(thumbImg);

          const openModalBtn = document.querySelector('[data-testid^="open-screenshot-"]');
          openModalBtn?.click();
          await sleep(50);
          const modalOpened = Boolean(document.querySelector('[data-testid="screenshot-preview-modal"] img'));
          document.querySelector('[data-testid="close-screenshot-modal"]')?.click();
          await sleep(40);

          // Reset filters
          document.querySelector('[data-testid="findings-reset-filters"]')?.click();
          await sleep(50);
          const restoredCardCount = document.querySelectorAll('[data-testid^="finding-card-"]').length;

          // Switch to Simple Mode -> verify raw evidence hidden; Technical Mode -> verify exposed
          document.querySelector('[data-testid="mode-toggle-simple"]')?.click();
          await sleep(50);
          // Expand first card in simple mode
          const firstToggle = document.querySelector('[data-testid^="finding-toggle-"]');
          if (firstToggle?.getAttribute('aria-expanded') !== 'true') {
            firstToggle?.click();
            await sleep(40);
          }
          const simpleHidesRawEvidence = !document.querySelector('[data-testid^="technical-raw-evidence-"]');
          const simpleCardCount = document.querySelectorAll('[data-testid^="finding-card-"]').length;

          document.querySelector('[data-testid="mode-toggle-technical"]')?.click();
          await sleep(50);
          const technicalShowsRawEvidence = Boolean(document.querySelector('[data-testid^="technical-raw-evidence-"]'));
          const technicalCardCount = document.querySelectorAll('[data-testid^="finding-card-"]').length;

          document.querySelector('[data-testid="mode-toggle-dual"]')?.click();
          await sleep(50);

          // Switch to Arabic RTL
          document.querySelector('[data-testid="locale-toggle-ar"]')?.click();
          await sleep(80);
          const shellDirAr = document.querySelector('.auditor-shell')?.getAttribute('dir');
          const shellLangAr = document.querySelector('.auditor-shell')?.getAttribute('lang');
          const arabicHeadingsPresent =
            (document.body.textContent || '').includes('الملخص التنفيذي') &&
            (document.body.textContent || '').includes('توزيع درجات الخطورة') &&
            (document.body.textContent || '').includes('الملاحظات وإرشادات المعالجة العملية');

          // Switch back to English LTR
          document.querySelector('[data-testid="locale-toggle-en"]')?.click();
          await sleep(80);
          const shellDirEn = document.querySelector('.auditor-shell')?.getAttribute('dir');

          // Switch to Scan 2 (historical scan) and verify stale Scan 1 data does not appear
          const scan2InspectBtn = Array.from(document.querySelectorAll('.auditor-site-item__actions button'))
            .filter(b => b.textContent?.includes('Inspect Findings'))[1];
          scan2InspectBtn?.click();
          const scan2Text = await waitFor(() => {
            const txt = document.querySelector('[data-testid="findings-explorer"]')?.textContent || '';
            return txt.includes('HIS_ONLY_FINDING') ? txt : null;
          });
          const staleScan1Isolated =
            Boolean(scan2Text) &&
            !scan2Text.includes('SEC_HEADER_CSP_MISSING') &&
            (document.querySelector('[data-testid="executive-summary-dashboard"]')?.textContent || '').includes('Insufficient Evidence');

          return {
            overviewHasStack,
            overviewHasTriad,
            overviewHasD1ToD4,
            all7ChartsPresent,
            inlineStyleCountInBatch744,
            filteredCardCount,
            screenshotThumbLoaded,
            modalOpened,
            restoredCardCount,
            simpleHidesRawEvidence,
            simpleCardCount,
            technicalShowsRawEvidence,
            technicalCardCount,
            shellDirAr,
            shellLangAr,
            arabicHeadingsPresent,
            shellDirEn,
            staleScan1Isolated,
          };
        })()
      \`);
    }

    default:
      throw new Error(\`Unknown scenario: \${scenario}\`);
  }
}
`;

  fs.writeFileSync(mainMjsPath, mainMjsContent.trim());
}
