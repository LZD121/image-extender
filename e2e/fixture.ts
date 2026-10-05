import { test as base } from '@playwright/test'
import type { PlayWrightAiFixtureType } from '@midscene/web/playwright'
import { PlaywrightAiFixture } from '@midscene/web/playwright'

/**
 * Playwright `test` extended with Midscene's fixtures (aiAssert, aiTap,
 * agentForPage, …). Midscene's model config comes from the environment and is
 * loaded by playwright.config.ts.
 */
export const test = base.extend<PlayWrightAiFixtureType>(
  PlaywrightAiFixture({
    waitForNetworkIdleTimeout: 2000,
  })
)
