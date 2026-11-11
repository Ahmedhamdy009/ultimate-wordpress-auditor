import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { prepareElectronTestApp } from './fixture.js';

const req = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, '../../../../../');
const defaultElectronPath: string = (() => {
  try {
    return req('electron');
  } catch {
    return path.resolve(
      projectRoot,
      'node_modules/.pnpm/electron@44.10.2/node_modules/electron/dist/electron.exe',
    );
  }
})();

export interface RuntimeVersions {
  readonly electron: string;
  readonly node: string;
  readonly chrome: string;
  readonly v8: string;
}

export interface StoragePaths {
  readonly userData: string;
  readonly sessionData: string;
  readonly crashDumps: string;
  readonly logs: string;
  readonly temp: string;
}

export interface ElectronReadyEvent {
  readonly appName?: string;
  readonly versions: RuntimeVersions;
  readonly storagePaths: StoragePaths;
}

export class ElectronProcessRunner {
  private child: ChildProcess | null = null;
  private server: net.Server | null = null;
  private socket: net.Socket | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (val: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private requestCounter = 0;
  private stdoutLines: string[] = [];
  private stderrLines: string[] = [];

  private readonly isolatedUserDataDir: string | null = null;

  constructor(
    private readonly appDir: string = path.resolve(
      projectRoot,
      `.tmp/electron-runtime-app-${process.pid}-${Math.random().toString(36).slice(2, 7)}`,
    ),
    private readonly electronPath: string = defaultElectronPath,
    private readonly extraEnv?: Record<string, string>,
  ) {
    if (!extraEnv?.AUDITOR_USER_DATA_DIR && !process.env.AUDITOR_USER_DATA_DIR) {
      this.isolatedUserDataDir = path.join(
        projectRoot,
        '.tmp',
        'userData',
        path.basename(this.appDir),
      );
    }
  }

  public async start(timeoutMs: number = 20000): Promise<ElectronReadyEvent> {
    if (this.child) {
      throw new Error('Electron process is already running');
    }

    // 1. Ensure test application fixture is prepared with latest build artifacts
    prepareElectronTestApp(this.appDir);

    // 2. Start loopback TCP server on 127.0.0.1
    return new Promise((resolve, reject) => {
      let startupTimer: NodeJS.Timeout;

      this.server = net.createServer(clientSocket => {
        this.socket = clientSocket;

        let buffer = '';
        clientSocket.on('data', data => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let message: {
              type?: string;
              id?: string;
              versions?: RuntimeVersions;
              storagePaths?: StoragePaths;
              success?: boolean;
              data?: unknown;
              error?: { message?: string } | string;
            };
            try {
              message = JSON.parse(trimmed);
            } catch {
              continue;
            }

            if (message.type === 'ERROR') {
              clearTimeout(startupTimer);
              this.forceKill();
              const errMsg =
                typeof message.error === 'string'
                  ? message.error
                  : message.error?.message || 'Electron startup error';
              reject(new Error(`Electron startup error: ${errMsg}`));
              return;
            }

            if (message.type === 'READY' && message.versions && message.storagePaths) {
              clearTimeout(startupTimer);
              resolve({
                appName: message.appName,
                versions: message.versions,
                storagePaths: message.storagePaths,
              });
              return;
            }

            if (message.type === 'RESULT' && message.id) {
              const pending = this.pendingRequests.get(message.id);
              if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(message.id);
                if (message.success) {
                  pending.resolve(message.data);
                } else {
                  const errMsg =
                    typeof message.error === 'string'
                      ? message.error
                      : message.error?.message || 'Electron scenario execution failed';
                  pending.reject(new Error(errMsg));
                }
              }
            }
          }
        });

        clientSocket.on('error', err => {
          console.error('[ElectronProcessRunner] Client socket error:', err);
        });
      });

      this.server.listen(0, '127.0.0.1', () => {
        const port = (this.server?.address() as net.AddressInfo).port;

        startupTimer = setTimeout(() => {
          this.forceKill();
          reject(
            new Error(
              `Electron process failed to signal READY within ${timeoutMs}ms.\n` +
                `Stdout:\n${this.stdoutLines.join('\n')}\n` +
                `Stderr:\n${this.stderrLines.join('\n')}`,
            ),
          );
        }, timeoutMs);

        try {
          this.child = spawn(this.electronPath, [this.appDir], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              ...process.env,
              PROJECT_ROOT: projectRoot,
              TEST_IPC_PORT: String(port),
              ELECTRON_ENABLE_LOGGING: '1',
              NODE_ENV: 'test',
              ...(this.isolatedUserDataDir
                ? { AUDITOR_USER_DATA_DIR: this.isolatedUserDataDir }
                : {}),
              ...(this.extraEnv ?? {}),
            },
          });

          this.child.stdout?.on('data', chunk => {
            this.stdoutLines.push(chunk.toString());
          });

          this.child.stderr?.on('data', chunk => {
            this.stderrLines.push(chunk.toString());
          });

          this.child.on('error', err => {
            clearTimeout(startupTimer);
            reject(err);
          });

          this.child.on('exit', (code, signal) => {
            clearTimeout(startupTimer);
            for (const { reject: reqReject, timer } of this.pendingRequests.values()) {
              clearTimeout(timer);
              reqReject(
                new Error(
                  `Electron child process exited unexpectedly with code ${code} (${signal})`,
                ),
              );
            }
            this.pendingRequests.clear();
          });
        } catch (err) {
          clearTimeout(startupTimer);
          reject(err);
        }
      });
    });
  }

  public async executeScenario<T = unknown>(
    scenario: string,
    params?: unknown,
    timeoutMs: number = 10000,
  ): Promise<T> {
    if (!this.socket || this.socket.destroyed || !this.child || this.child.killed) {
      throw new Error('Electron child process is not running or socket is disconnected');
    }

    const id = String(++this.requestCounter);
    const command =
      JSON.stringify({
        id,
        type: 'RUN_SCENARIO',
        scenario,
        params,
      }) + '\n';

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Scenario '${scenario}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject, timer });
      this.socket!.write(command);
    });
  }

  private terminateProcessTree(child: ChildProcess): void {
    const pid = child.pid;
    if (process.platform === 'win32' && pid) {
      try {
        // Kill Electron and all Chromium child processes (/T) so sessionData handles are released immediately
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 3000,
        });
        return;
      } catch {
        // Fall through to child.kill if taskkill already found no process
      }
    }
    try {
      child.kill('SIGKILL');
    } catch {
      // Process may have already exited
    }
  }

  private cleanupAppDir(): void {
    try {
      if (fs.existsSync(this.appDir)) {
        fs.rmSync(this.appDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    } catch {
      // Best-effort cleanup of temp Electron app dir
    }
    try {
      if (this.isolatedUserDataDir && fs.existsSync(this.isolatedUserDataDir)) {
        fs.rmSync(this.isolatedUserDataDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    } catch {
      // Best-effort cleanup of isolated test userData directory
    }
  }

  public async stop(timeoutMs: number = 3000): Promise<{ exitCode: number | null }> {
    const child = this.child;
    const server = this.server;
    const socket = this.socket;

    this.child = null;
    this.server = null;
    this.socket = null;

    if (!child) {
      server?.close();
      this.cleanupAppDir();
      return { exitCode: 0 };
    }

    if (child.exitCode !== null) {
      server?.close();
      this.cleanupAppDir();
      return { exitCode: child.exitCode };
    }

    return new Promise(resolve => {
      let isResolved = false;

      const finish = (code: number | null) => {
        if (!isResolved) {
          isResolved = true;
          socket?.destroy();
          server?.close();
          this.cleanupAppDir();
          resolve({ exitCode: code });
        }
      };

      const fallbackTimer = setTimeout(() => {
        this.terminateProcessTree(child);
        setTimeout(() => finish(child.exitCode), 200);
      }, timeoutMs);

      child.once('exit', code => {
        clearTimeout(fallbackTimer);
        finish(code);
      });

      // Attempt graceful shutdown command over socket
      try {
        if (socket && !socket.destroyed) {
          socket.write(JSON.stringify({ type: 'SHUTDOWN' }) + '\n');
        } else {
          this.terminateProcessTree(child);
        }
      } catch {
        this.terminateProcessTree(child);
      }
    });
  }

  public forceKill(): void {
    if (this.child) {
      this.terminateProcessTree(this.child);
      this.child = null;
    }
    this.socket?.destroy();
    this.socket = null;
    this.server?.close();
    this.server = null;
    this.cleanupAppDir();
  }

  public getStdout(): string[] {
    return [...this.stdoutLines];
  }

  public getStderr(): string[] {
    return [...this.stderrLines];
  }
}
