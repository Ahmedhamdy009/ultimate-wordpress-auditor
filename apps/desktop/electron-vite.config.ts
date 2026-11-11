import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error Internal build script without bundled type exports
import { copyBuildAssets } from '../../scripts/copy-build-assets.mjs';

/**
 * Strict production-only Meta CSP injection plugin.
 * Strictly active during 'build'; completely disabled in development ('serve') to preserve Vite HMR.
 */
export function injectProductionMetaCsp(): Plugin {
  return {
    name: 'production-meta-csp-inject',
    apply: 'build',
    transformIndexHtml() {
      const strictProdCsp =
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'";
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: strictProdCsp,
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

/**
 * Production Asset Copy Plugin.
 * Automatically copies native SQLite binaries (Electron ABI 149) and branding resources
 * into out/main/ upon successful production bundle completion.
 */
export function copyBuildAssetsPlugin(): Plugin {
  return {
    name: 'production-asset-copy-plugin',
    apply: 'build',
    closeBundle() {
      copyBuildAssets({ silent: false });
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@auditor/shared'] }), copyBuildAssetsPlugin()],
    ssr: {
      noExternal: ['@auditor/shared'],
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          cli: resolve(import.meta.dirname, 'src/main/cli/bin.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@auditor/shared'] })],
    ssr: {
      noExternal: ['@auditor/shared'],
    },
    build: {
      rolldownOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
      rollupOptions: {
        treeshake: {
          moduleSideEffects: id => id.replace(/\\/g, '/').endsWith('src/preload/index.ts'),
        },
        input: {
          index: resolve(import.meta.dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react(), injectProductionMetaCsp()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
