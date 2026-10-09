import { defineConfig } from 'vitest/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadDotEnv(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      let value = trimmed.slice(eqIdx + 1);
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

const rootEnv = loadDotEnv(resolve(__dirname, '../../.env'));
const localEnv = loadDotEnv(resolve(__dirname, '.env'));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
    // As dotenv does, a variable already set in the shell wins over the files — so a
    // run can be pointed at a scratch database (DATABASE_URL=…) instead of the dev
    // one, whose data the payroll and party suites' cleanup would otherwise delete.
    env: Object.fromEntries(
      Object.entries({ ...rootEnv, ...localEnv }).filter(([key]) => process.env[key] === undefined),
    ),
  },
});
