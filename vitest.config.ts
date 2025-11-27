import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.{test,spec}.ts'],
    reporters: process.env.CI ? ['default'] : ['default'],
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@shared': resolve(rootDir, 'shared'),
      '@server': resolve(rootDir, 'server/src'),
    },
  },
});
