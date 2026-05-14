import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['lib/**/*.{spec,test}.ts', 'components/**/*.{spec,test}.ts'],
    // E2E specs live under tests/e2e/ and are run by Playwright. Keep
    // them out of the unit-test scan.
    exclude: ['node_modules/**', 'tests/**', '.next/**'],
  },
});
