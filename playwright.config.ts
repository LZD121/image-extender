import { defineConfig, devices } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * AI-driven E2E suite (Midscene + Playwright).
 *
 * Kept separate from the vitest suite: vitest tests the library/RPC layer in
 * milliseconds and runs on every save; this one boots a real dev server and
 * drives a real browser through a vision model, so it is opt-in (`npm run test:ai`).
 */

// Midscene reads its model config from process.env. Load .env.midscene if the
// shell has not already provided the values (the file holds no secret here —
// it points at a local gateway).
const envFile = path.join(__dirname, '.env.midscene')
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim()
  }
}

// Every run gets its own copy of the fixture library, so a test that saves or
// deletes an asset can never touch the repository's real assets/ directory.
const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-e2e-assets-'))
fs.cpSync(path.join(__dirname, 'e2e', 'fixtures', 'assets'), assetsDir, { recursive: true })

const PORT = 3311

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // One worker: the tests share a single dev server and asset directory.
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['@midscene/web/playwright-reporter', { type: 'merged' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The mode switcher is hidden below the `sm` breakpoint.
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { IE_ASSETS_DIR: assetsDir },
  },
})
