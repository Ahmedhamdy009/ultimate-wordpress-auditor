import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

interface StepResult {
  name: string;
  [key: string]: unknown;
}

interface VerificationOutput {
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  modulesAbi: string;
  timestamp: string;
  steps: StepResult[];
  success: boolean;
  error?: {
    message: string;
    stack: string;
    code?: string;
  };
}

describe('Live Electron 44 Main Process Network & Scanner Integration', () => {
  const req = createRequire(import.meta.url);
  const electronBinary = req('electron');
  const projectRoot = path.resolve(import.meta.dirname, '../../../../');
  const harnessPath = path.resolve(import.meta.dirname, 'harness', 'verify_electron_scanner.cjs');
  const resultJsonPath = path.resolve(projectRoot, '.tmp/electron_scanner_verification.json');

  beforeAll(async () => {
    // Ensure scanner-client is bundled for the Electron harness
    const vite = req('vite');
    await vite.build({
      root: path.resolve(projectRoot, 'apps/desktop'),
      build: {
        lib: {
          entry: path.resolve(projectRoot, 'apps/desktop/src/main/scanner/client/index.ts'),
          formats: ['es'],
          fileName: 'scanner-client',
        },
        outDir: path.resolve(projectRoot, '.tmp/electron-scanner-bundle'),
        emptyOutDir: true,
        rollupOptions: {
          external: [/^node:/, 'electron'],
        },
      },
      logLevel: 'silent',
    });
  }, 15000);

  it('executes SafeHttpClient SSRF guards, socket pinning, and TLS verification inside live Electron 44 Main process (ABI 149)', async () => {
    if (fs.existsSync(resultJsonPath)) {
      fs.unlinkSync(resultJsonPath);
    }

    const result = await new Promise<VerificationOutput>((resolve, reject) => {
      execFile(electronBinary, [harnessPath], { timeout: 20000 }, (error, stdout, stderr) => {
        if (error && !fs.existsSync(resultJsonPath)) {
          reject(
            new Error(
              `Electron scanner verification failed to execute: ${error.message}\nStdout: ${stdout}\nStderr: ${stderr}`,
            ),
          );
          return;
        }
        try {
          const parsed = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8')) as VerificationOutput;
          resolve(parsed);
        } catch (readErr) {
          reject(new Error(`Failed to parse verification result JSON: ${String(readErr)}`));
        }
      });
    });

    expect(result.success).toBe(true);
    expect(result.electronVersion).toBe('44.10.2');
    expect(result.modulesAbi).toBe('149');
    expect(typeof result.nodeVersion).toBe('string');
    expect(result.steps.map(s => s.name)).toEqual([
      'instantiate_client',
      'ssrf_block_loopback',
      'http_pinned_get',
      'https_tls_trusted_ca',
      'https_reject_selfsigned',
    ]);
  }, 30000);
});
