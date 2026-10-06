# Testing Patterns

**Analysis Date:** 2026-10-06

## Test Framework

Three suites, three runners, chosen by what the test needs. Do not merge them.

**Runner:**
- **Vitest 2.1.9** for everything fast and node-side. Config: `vitest.config.ts` (root).
- **Playwright 1.63 + `@midscene/web`** for AI-driven browser E2E. Config: `playwright.config.ts` (root).
- **`node:test`** for the headless-bridge smoke suite, run directly by node (needs Chromium).

**Assertion Library:**
- Vitest built-in `expect` (`toBe`, `toEqual`, `toContain`, `toThrow`, `toHaveLength`, `toMatch`).
- `node:assert/strict` in the bridge smoke test (`assert.equal`, `assert.ok`).
- Playwright `expect` with web-first locators (`toHaveCount`, `toHaveValue`, `toBeVisible`); Midscene's `aiAssert` is the last resort.

**Run Commands:**
```bash
npm test                 # vitest run — unit + CLI contract tests
npm run test:watch       # vitest watch mode
npx vitest run app/i18n/__tests__/messages.test.ts   # single file
npm run test:cli         # node --test cli/native/__tests__/bridge.smoke.test.mjs
npm run test:ai          # playwright test (needs .env.midscene + npx playwright install chromium)
npm run test:ai:report   # playwright show-report
npm run lint             # next lint
npx tsc --noEmit         # the real type gate (no test:coverage script exists)
```
There is no coverage script, no `--coverage` flag in any npm script, and no coverage threshold.

## Test File Organization

**Location:**
- Unit/contract tests live in `__tests__/` next to the code they cover, **never** alongside as `*.test.ts` siblings:
  - `app/lib/__tests__/library.test.ts`, `app/lib/__tests__/libraryCollect.test.ts`
  - `app/api/library/__tests__/route.test.ts`, `app/api/providers/__tests__/route.test.ts`
  - `app/i18n/__tests__/messages.test.ts`, `app/i18n/__tests__/serverErrors.test.ts`
  - `app/utils/__tests__/pixelGrid.test.ts`
- CLI tests: `cli/lib/__tests__/args.test.mjs`, `cli/commands/__tests__/library.test.mjs`.
- E2E: `e2e/studio-library.spec.ts` plus the Midscene fixture `e2e/fixture.ts`.

**Naming:**
- `<module>.test.ts` / `<module>.test.mjs` mirroring the source file name.
- Route tests are named `route.test.ts` inside the route's own `__tests__/`.
- The bridge suite is explicitly `<thing>.smoke.test.mjs`.

**Structure:**
```
app/
  lib/
    library.ts                 → app/lib/__tests__/library.test.ts
    libraryCollect.ts          → app/lib/__tests__/libraryCollect.test.ts
  api/
    library/[[...path]]/route.ts → app/api/library/__tests__/route.test.ts
  utils/
    pixelGrid.ts               → app/utils/__tests__/pixelGrid.test.ts
cli/
  lib/args.mjs                 → cli/lib/__tests__/args.test.mjs
  commands/library.mjs         → cli/commands/__tests__/library.test.mjs
  native/bridge.mjs            → cli/native/__tests__/bridge.smoke.test.mjs   (excluded from vitest)
e2e/
  studio-library.spec.ts        (playwright + midscene)
```

Vitest's scope is explicit and worth preserving (`vitest.config.ts`):
```ts
include: ['app/**/__tests__/**/*.test.ts', 'cli/**/__tests__/**/*.test.mjs'],
exclude: ['**/node_modules/**', 'cli/native/__tests__/**'],
```
The bridge suite is excluded because it launches Chromium; `npm run test:cli` runs it instead.

## Test Structure

**Suite Organization:**
```ts
import { describe, expect, it } from 'vitest'
import { buildAssetMeta, collectStudioAsset, slugify } from '@/app/lib/libraryCollect'

describe('slugify', () => {
  it('lower-cases, collapses and truncates', () => {
    expect(slugify('Mossy Grey Dungeon Stone!')).toBe('mossy-grey-dungeon-stone')
    expect(slugify('   ')).toBe('asset')
    expect(slugify('a'.repeat(90))).toHaveLength(64)
  })
})
```
(`app/lib/__tests__/libraryCollect.test.ts:6-13`)

**Patterns:**
- Test names are behavioural sentences: `'a project rename made in pixel mode is visible after switching back'`, `'rejects an unknown flag with the usage line attached'` (E2E and `cli/lib/__tests__/args.test.mjs`). Name the defect being pinned where the test exists because of one.
- `beforeEach`/`afterEach` are used, never `beforeAll`, and env keys are saved/restored, not blindly deleted:
```ts
const savedEnv = process.env.IE_ASSETS_DIR
afterEach(async () => {
  if (savedEnv === undefined) delete process.env.IE_ASSETS_DIR
  else process.env.IE_ASSETS_DIR = savedEnv
  await rm(root, { recursive: true, force: true })
})
```
(`cli/commands/__tests__/library.test.mjs:23-33`; same shape in `app/api/library/__tests__/route.test.ts:56-61` with `IE_ASSETS_DIR` + `IE_BACKEND_LABEL`.)
- Arrange/act/assert is implied by blank-line grouping, not labelled comments.
- One behaviour focus per `it`, multiple `expect`s fine.

## Mocking

**Framework:**
- Vitest `vi.fn()` for global fetch; `vi.mocked` where a module is mocked.

**Patterns:**
```ts
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; /* + env restores */ })

/** Stub the gateway and record the URL it was asked for. */
function stubGateway(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = []
  globalThis.fetch = vi.fn(async (url: unknown) => {
    calls.push(String(url))
    return handler(String(url))
  }) as unknown as typeof fetch
  return calls
}
```
(`app/api/providers/__tests__/route.test.ts:6-34`) — the spy records URLs so assertions can check *which* gateway endpoint was hit, not just the response.

**What to Mock:**
- `globalThis.fetch` — every outbound call to an image/LLM gateway. Never hit a real provider in a unit test.
- Env vars (`IE_ASSETS_DIR`, `IE_BACKEND_LABEL`, `IE_MAGPIE_BASE_URL`, `OPENROUTER_API_KEY`) — set in `beforeEach`, restored in `afterEach`.
- The filesystem — tests `mkdtemp()` into `node:os`'s `tmpdir()`, never the repo's real `assets/`.

**What NOT to Mock:**
- Internal modules. Route tests import the real handler and the real lib behind it (`import { GET, POST, DELETE } from '../[[...path]]/route'` and `import { readMeta } from '@/app/lib/library'`), exercising the full in-process path.
- Pure functions and the real on-disk library — `cli/commands/__tests__/library.test.mjs` runs the actual command module against a real temp directory.

## Fixtures and Factories

**Test Data:**
- Local factory functions at the top of the test file, with a default plus overrides:
```ts
function meta(slug = 'mossy-stone'): AssetMeta { return { schemaVersion: 1, type: 'tile-set', /* … */ } }
```
(`app/lib/__tests__/library.test.ts:19`) and `const meta = { … }` with a `save(extra)` builder in the route test (`app/api/library/__tests__/route.test.ts:36`).
- Synthetic pixel buffers are built in-test rather than checked in:
```ts
function makeBuffer(width, height, fill = TRANSPARENT): PixelBuffer { /* … */ }
function offsetLattice(): PixelBuffer { /* 8x8, logical 2x2 lattice at (1,1) */ }
```
(`app/utils/__tests__/pixelGrid.test.ts:4,19`)
- Shared binary fixtures live under `e2e/fixtures/assets/**` and are reused by unit + CLI + E2E tests, e.g. `e2e/fixtures/assets/demo/tiles/sample/derived/body.png` (`cli/native/__tests__/bridge.smoke.test.mjs:17`).
- A 1×1 PNG data URL is inlined as a constant (`const PNG = 'data:image/png;base64,iVBORw0KGgo…'`) rather than stored as a file.

**Location:**
- Factories stay in the test file; only binary fixtures are shared, under `e2e/fixtures/`.

## Coverage

**Requirements:**
- No numeric target and no enforcement. Coverage is deliberately not the gate.

**Configuration:**
- None. `vitest.config.ts` sets only `environment: 'node'`, the `@` alias and the include/exclude globs.

**The de facto gate is instead:**
- `tsc` (`noEmit`, `strict`): a missing translation or an unhandled union member fails the build (`app/i18n/index.ts:60`, `app/lib/libraryCollect.ts:9`).
- `npm test` must be green before a commit; `docs/` and plans assume it.

## Test Types

**Unit Tests (vitest, `environment: 'node'`):**
- Scope: one pure module or one lib seam. `app/lib/__tests__/` is the bulk (30 files).
- Mocking: none for pure modules; `fetch`/env only at route tests.
- These are the millisecond suite that "runs on every save".

**Contract / Route Tests (vitest, still node):**
- Scope: call the exported route handler with a real `NextRequest` and assert status + JSON body, against a temp `IE_ASSETS_DIR`:
```ts
function req(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), init as never)
}
const ctx = (path?: string[]) => ({ params: { path } })   // Next always passes the segment array separately — the test must too.
```
(`app/api/library/__tests__/route.test.ts:17-22`)
- CLI contract tests run the real command module with the same context shape `cli/ie.mjs` builds (`cli/commands/__tests__/library.test.mjs:5`).

**Bridge Smoke Test (`node:test`, needs Chromium):**
- Scope: the app's own pixel ops driven headlessly through `bridgeBatch` from `cli/lib/bridge.mjs`, in **one** browser session (`test('bridge ops, in one browser session', …)`, `cli/native/__tests__/bridge.smoke.test.mjs:54`).
- Its purpose is stated in its header: "No network, no API keys, no cost: every op here is local image math. It is the regression net for the ops the studio commands compose, so a broken bundle, a missing export or a changed option name fails before an agent spends money."
- Assertions are numeric censuses, not snapshots: `alphaCensus()` counts opaque/transparent pixels and the tests require both to be non-zero — a vacuity guard so a chroma key that erased everything fails.

**E2E Tests (Playwright + Midscene):**
- Scope: UI wiring that per-layer unit tests cannot see — a panel mounted twice, a click that silently does nothing, two copies of one state (`e2e/studio-library.spec.ts:5`).
- Setup: `e2e/fixture.ts` extends Playwright's `test` with Midscene fixtures (`aiAssert`, `aiTap`, `agentForPage`). Model config comes from `.env.midscene` (loaded by `playwright.config.ts`; checked-in values point at a local OpenAI-compatible gateway, auth `none`) and is verifiable with `npx @midscene/cli model verify`.
- Isolation: `playwright.config.ts` copies `e2e/fixtures/assets` to a `mkdtemp` per run and passes it as `IE_ASSETS_DIR` to the dev server, "so a test that saves or deletes an asset can never touch the repository's real assets/ directory."
- Determinism: `workers: 1`, `fullyParallel: false` (they share one dev server and one asset dir); a `seed()` helper writes `localStorage` via `page.addInitScript` before any script runs, because a missing key makes the app open the BYOK modal and swallow clicks (`e2e/studio-library.spec.ts:28`).
- **Locators over AI**: structural facts use plain Playwright locators ("exact, free, instant"); `aiAssert` is reserved for what a selector cannot express — `aiAssert('The "Asset library" panel lists an item named "sample", and a small thumbnail image is displayed next to it')`.

## Common Patterns

**Async Testing:**
```ts
it('translates an exact app message', () => {
  expect(translateServerError('Missing required fields', zh)).toBe('缺少必填字段')
})
```
(`app/i18n/__tests__/serverErrors.test.ts:20`)

**Error Testing:**
```ts
expect(() => parseCommand(['a.png', '--nope'], spec)).toThrow(UsageError)
try { parseCommand(['a.png', '--nope'], spec) } catch (err) {
  expect(err.message).toMatch(/--nope/)
  expect(err.message).toContain(spec.usage)   // the usage line is part of the contract
}
```
(`cli/lib/__tests__/args.test.mjs:29-36`)

**Byte-for-byte / exact-value pinning — the repo's signature habit:**
- Export and prompt invariants are pinned as exact strings and exact key sets rather than approximated:
  - `expect(Object.keys(out?.files ?? {}).sort()).toEqual(['derived/body.png', 'raw/sheet.png'])` — the asset layout is an invariant (`app/lib/__tests__/libraryCollect.test.ts:29`).
  - `expect(buildExtendPrompt({ ...base, chunkInfo: chunk() })).toContain('exactly 1024x702 pixels')` — prompt text is pinned verbatim (`app/lib/__tests__/extendPrompt.test.ts:77`).
  - `expect(translateServerError('Missing required fields', en)).toBe('Missing required fields')` — English renders byte-identically (`app/i18n/__tests__/serverErrors.test.ts:25`).
  - The reason is recorded in source: the ZIP exporters' output is "a tested invariant", which is why `libraryCollect.ts` duplicates lines instead of sharing a collector.
- Where a fact is pinned by value, a *vacuity guard* accompanies it. `app/i18n/__tests__/messages.test.ts` scans source files for literal `t('…')` calls with a regex, then asserts the scan found something:
```ts
it('finds the call sites it is meant to check', () => {
  // A regex that matched nothing would make the assertion above vacuous, so
  // require the converted surfaces to be present.
  expect(literalCalls.length).toBeGreaterThan(50)
  expect(literalCalls.some(({ file }) => file.endsWith('page.tsx'))).toBe(true)
})
```
  The same idea appears in `bridge.smoke.test.mjs`: `assert.ok(census.transparent > 0, …)` and `assert.ok(census.opaque > 0, …)`.

**i18n parity testing (the dictionary is tested, not trusted):**
- `app/i18n/__tests__/messages.test.ts` guards three things: every locale has the same key set (`expect(keys(zh)).toEqual(keys(en))`), no value is empty or equal to its own key, and every **runtime-built** key (`common.artStyle.${o.value}`, `common.anim.${anim}.label`, `common.creature.${p.id}`, …) actually exists — the `dataDriven` list is assembled from the lib tables (`ART_STYLE_GROUPS`, `LAYER_ROLES`, `TILESET_SLOTS`, `SPRITE_ANIMATIONS`, `BODY_PLANS`, …) so adding an id to a lib without a message fails the suite.
- `app/i18n/__tests__/serverErrors.test.ts` covers the one seam where server English becomes UI language: exact match, parameterised pattern (`'file too large: derived/body.png'` → `'文件过大：derived/body.png'`), and passthrough for third-party provider text.
- Static parity is enforced separately by the type system: `const zh: Record<keyof typeof en, string>` makes an untranslated key a compile error (`app/i18n/index.ts:60`).

**Snapshot Testing:**
- Not used. No `__snapshots__/` directory or `toMatchSnapshot` anywhere; everything is asserted explicitly, so a diff must be reviewed.

## What Is Deliberately NOT Tested

- **Real providers and real spend.** No test calls OpenRouter / APIMart / PixelLab / a live gateway. Outbound `fetch` is stubbed or the op is local image math. The bridge smoke test exists precisely so a broken op fails *before* money is spent.
- **React components and `app/page.tsx`.** There is no component/DOM unit test and no jsdom environment (vitest is `environment: 'node'`). Studio components and the ~4k-line page are covered by the Playwright suite only; that is the stated reason `e2e/studio-library.spec.ts` asserts "one panel mounted per mode" instead of unit-rendering.
- **Canvas/image ops in vitest.** `app/utils/imageProcessor.ts`, `poseRig.ts`, `rigCore.ts` and `app/lib/studioDownload.ts` have no vitest file — they need a DOM/canvas. Their pure math (`app/utils/pixelGrid.ts`) *is* unit-tested, and the browser-dependent paths are pinned by the Playwright suite and the Chromium bridge smoke test.
- **UI copy translated by vision.** `aiAssert` is used sparingly and never for anything a locator can check.
- **Coverage percentage.** No script, no threshold, no badge.

## Writing a New Test — the rules to follow

1. Put it in `__tests__/<module>.test.ts` next to the module; import via `@/`.
2. If it touches the filesystem, `mkdtemp` + set `IE_ASSETS_DIR` in `beforeEach`, restore the previous value and `rm -rf` in `afterEach`.
3. If it touches the network, stub `globalThis.fetch` and restore it; record the URLs you were called with when the endpoint choice matters.
4. Pin exact values (file key sets, prompt strings, English error text) when the output is a contract, and add a guard so the assertion cannot pass vacuously.
5. Add any new lib id to the relevant table in `app/i18n/__tests__/messages.test.ts`'s `dataDriven` list, and add the message to `app/i18n/messages/*.ts` for **both** locales.
6. Only reach for Playwright/Midscene when the check is genuinely about rendered UI; use a locator first, `aiAssert` second.

---

*Testing analysis: 2026-10-06*
*Update when test patterns change*
