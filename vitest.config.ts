import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json "paths": { "@/*": ["./*"] }
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['app/**/__tests__/**/*.test.ts'],
  },
})
