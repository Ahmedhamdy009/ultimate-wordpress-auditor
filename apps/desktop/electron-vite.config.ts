import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
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
      rollupOptions: {
        treeshake: {
          moduleSideEffects: id => id.replace(/\\/g, '/').endsWith('src/preload/index.ts'),
        },
        input: {
          index: resolve(import.meta.dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
