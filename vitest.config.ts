import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@auditor/shared': path.resolve(import.meta.dirname, './packages/shared/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.ts',
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.cache/**',
      '**/.tmp/**',
    ],
  },
});
