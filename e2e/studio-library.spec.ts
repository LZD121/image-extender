import { expect, type Page } from '@playwright/test'
import { test } from './fixture'

/**
 * Guards the asset library's UI wiring — the class of defect that per-layer
 * unit tests cannot see: a panel mounted twice, a click that silently does
 * nothing, two copies of one state.
 *
 * Structural facts are asserted with plain locators (fast, free, exact). The
 * vision model is used only where a selector cannot express the check.
 */

const MODE_KEY = 'extender:mode'
const API_KEY_KEY = 'extender:api_key'
const PROJECT_KEY = 'extender:libraryProject'

const MODES = [
  { value: 'extender', label: 'Extender' },
  { value: 'parallax', label: 'Parallax' },
  { value: 'tile', label: 'Tiles' },
  { value: 'props', label: 'Props' },
  { value: 'sprite', label: 'Sprite' },
  { value: 'pixel', label: 'Pixel' },
] as const

/**
 * Put the app into a known state before any script runs.
 *
 * A key is seeded by default: with no stored key the app opens its BYOK modal
 * on mount (app/page.tsx: `if (!k) { setApiKeyRequired(true); setShowApiKeyModal(true) }`),
 * which overlays the page and swallows every click.
 */
async function seed(page: Page, mode: string, opts: { project?: string; apiKey?: string } = {}) {
  const initScript = ([modeKey, projectKey, apiKeyKey, m, p, k]: string[]) => {
    localStorage.setItem(modeKey, m)
    localStorage.setItem(projectKey, p)
    if (k) localStorage.setItem(apiKeyKey, k)
  }
  await page.addInitScript(initScript, [
    MODE_KEY,
    PROJECT_KEY,
    API_KEY_KEY,
    mode,
    opts.project ?? 'demo',
    opts.apiKey ?? 'e2e-dummy-key',
  ])
}

test.describe('asset library panel is mounted once in every studio', () => {
  for (const { value, label } of MODES) {
    test(`${label} mode mounts exactly one panel`, async ({ page }) => {
      await seed(page, value)
      await page.goto('/')
      await expect(page.getByLabel('project')).toHaveCount(1)
    })
  }
})

test('loading a library asset from tile mode refuses instead of silently doing nothing', async ({
  page,
}) => {
  await seed(page, 'tile')
  await page.goto('/')

  const asset = page.getByRole('button', { name: 'sample', exact: true })
  await expect(asset).toBeVisible()
  await asset.click()

  // The tile studio renders its own grid and never reads the global image, so
  // the panel must say so rather than appear to work.
  // Assert the message itself: `role="alert"` alone also matches Next's route
  // announcer (`#__next-route-announcer__`), which is always empty.
  await expect(
    page.getByText('Switch to Extender or Parallax to open a library asset.')
  ).toBeVisible()
})

test('a project rename made in pixel mode is visible after switching back', async ({ page }) => {
  await seed(page, 'pixel')
  await page.goto('/')

  await page.getByLabel('project').fill('renamed')
  await page.getByLabel('project').blur()

  await page.getByRole('tab', { name: 'Extender' }).click()

  // Regression: page.tsx used to read the shared key only once at mount, so a
  // rename made in the pixel studio left this side stale (and the next save
  // landed in the old project directory).
  await expect(page.getByLabel('project')).toHaveValue('renamed')
})

test('a keyless first run opens the BYOK prompt', async ({ page }) => {
  await seed(page, 'extender', { apiKey: '' })
  await page.goto('/')

  await expect(page.getByText('Add your OpenRouter key')).toBeVisible()
})

test('the generate dialog will not run until a prompt is entered', async ({ page }) => {
  // NOT the keyless path: the client refuses to send a request without a key
  // (`ensureCanGenerate`), so the server's "key missing" branch is unreachable
  // from the UI. What is reachable — and worth pinning — is this dialog rule.
  await seed(page, 'extender')
  await page.goto('/')

  await page.getByRole('button', { name: /generate/i }).first().click()

  const prompt = page.getByPlaceholder(/A wide mountain valley/)
  await expect(prompt).toBeVisible()

  const generate = page.getByRole('button', { name: 'Generate', exact: true }).last()
  await expect(generate).toBeDisabled()

  await prompt.fill('a mossy stone wall')
  await expect(generate).toBeEnabled()
})

test('the panel lists the stored asset with a thumbnail', async ({ page, aiAssert }) => {
  await seed(page, 'extender')
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'sample', exact: true })).toBeVisible()

  await aiAssert(
    'The "Asset library" panel lists an item named "sample", and a small thumbnail image is displayed next to it'
  )
})
