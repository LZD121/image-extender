import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json "paths": { "@/*": ["./*"] }
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    // App tests plus the CLI's pure/contract tests (the headless pixel path is
    // exercised separately by `npm run test:cli`, which needs Chromium).
    include: ['app/**/__tests__/**/*.test.ts', 'cli/**/__tests__/**/*.test.mjs'],
    // The bridge smoke suite is a node:test file (it launches Chromium); it runs
    // via `npm run test:cli`, not through vitest.
    exclude: ['**/node_modules/**', 'cli/native/__tests__/**'],
  },
})
