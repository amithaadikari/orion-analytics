import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(process.cwd()), 'server-only': path.resolve(process.cwd(), 'tests/server-only.ts') } },
  test: { environment: 'node', globals: true }
});
