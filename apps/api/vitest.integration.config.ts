import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
