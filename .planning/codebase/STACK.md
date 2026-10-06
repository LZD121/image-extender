# Technology Stack

**Analysis Date:** 2026-10-06

## Languages

**Primary:**
- TypeScript 5.9.3 (locked in `package-lock.json`; declared `^5.2.2` in `package.json`) — the whole web app: `app/**/*.ts(x)`, `app/lib/*` (pure logic), `app/api/**/route.ts`, `app/utils/*` (canvas pixel pipelines), `app/components/*` (studios).

**Secondary:**
- JavaScript (ESM `.mjs`) — the headless CLI: `cli/ie.mjs` and `cli/**/*.mjs` run under plain `node`, importing `next/dist/bin/next` and app modules through a bundled bridge.
- JavaScript (CJS) — config only: `next.config.js`.
- Browser runtime — every pixel transform (chroma key, slicing, tileability, Poisson blend, corner reconcile, pose rigs) executes in a real canvas inside Chromium, both in the browser and headlessly via `cli/native/bridge.mjs`.

## Runtime

**Environment:**
- Node.js **>= 18** — enforced by the CLI doctor, not `package.json` (`cli/commands/core.mjs:91-92`: `major >= 18`). There is no `engines` field and no `.nvmrc`; dev machine runs v24.21.0.
- No serverless/edge runtime assumption: filesystem-backed routes declare `export const runtime = 'nodejs'` (`app/api/pixel/route.ts:15`, `app/api/library/[[...path]]/route.ts:8`).
- Browser runtime required for pixel math (headless Chromium via `playwright-core`).

**Package Manager:**
- npm 11.x (`package-lock.json`, `lockfileVersion: 3` present and authoritative — check versions there, not the `^` ranges in `package.json`).
- No workspaces, no monorepo tooling: one package, one lockfile.

## Frameworks

**Core:**
- Next.js 14.2.33 App Router — UI + the nine `/api/*` routes; `next.config.js:2-4` sets only `reactStrictMode: true`.
- React 18.3.1 / react-dom 18.3.1 — all studios; client-only app (`app/` holds the pages, `app/components/*` the studios).
- Tailwind CSS 3.4.18 (+ autoprefixer, postcss) — styling; no component library, icons are inline SVG (`app/components/icons.tsx`).

**Testing:**
- Vitest 2.1.9 — unit/contract layer, `environment: 'node'`, includes `app/**/__tests__/**/*.test.ts` and `cli/**/__tests__/**/*.test.mjs` (`vitest.config.ts:9-17`). Run: `npm test`.
- Playwright 1.63.0 + `@midscene/web` 1.14.0 — AI-driven E2E, one spec (`e2e/studio-library.spec.ts`) against a real dev server on port 3311, one worker, 120 s timeout (`playwright.config.ts:36-56`). Run: `npm run test:ai`.
- `node --test` — the Chromium-launching bridge smoke suite, deliberately outside vitest (`cli/native/__tests__/bridge.smoke.test.mjs`, `npm run test:cli`).

**Build/Dev:**
- `next dev` / `next build` / `next start` (`package.json:32-34`); the CLI starts and owns its own dev server on port 4317+ (`cli/lib/server.mjs:16-18`, state in `.ie/server.json`).
- esbuild 0.28.2 — bundles `app/utils/*` + `app/lib/*` into one IIFE for the headless bridge (`cli/native/bundle.mjs`, cache in `.ie/cache`).
- TypeScript config: `tsconfig.json` — `target: es5` (Next transpiles down), `strict: true`, `moduleResolution: bundler`, `allowJs`, path alias `@/* → ./*` (mirrored in `vitest.config.ts:5-8`).

## Key Dependencies

**Critical:**
- `next` 14.2.33 — framework and the API-route surface every studio and the `ie` CLI call.
- `react` / `react-dom` 18.3.1 — the five studios are client components; no SSR data layer.
- `playwright-core` 1.63.0 — not just a test dep: it is the *runtime* for the headless pixel engine (`cli/native/bridge.mjs:9`).
- `esbuild` 0.28.2 — runtime dependency of the CLI bridge (bundles app modules for the browser page).
- `jszip` 3.10.1 — the only production dependency beyond Next/React; client-side ZIP export of parallax layers, tile atlases and sprite sheets (`app/lib/studioDownload.ts:11`).

**Infrastructure:**
- `@midscene/web` 1.14.0 — vision-model UI localization in the E2E suite; also registers the Playwright reporter (`playwright.config.ts:43`).
- `tailwindcss` 3.4.18 + `postcss` + `autoprefixer` — styling pipeline.
- `sharp` 0.35.5 — devDependency present in the tree; not imported by app code (image processing is canvas-based).
- Node built-ins only for I/O: `node:fs/promises` is the sole filesystem owner, and it lives in exactly one module (`app/lib/library.ts:1,18-22`).

## Configuration

**Environment:**
- `.env.example` → `.env.local` (gitignored, `.gitignore:17-22`). All keys optional: `OPENROUTER_API_KEY`, `IE_MAGPIE_BASE_URL`, `MAGPIE_API_KEY`, `APIMART_API_KEY`, `IE_ASSETS_DIR`, `IE_BACKEND_LABEL` (`.env.example:8-33`).
- Gateway/credential/model selection is primarily a **config file**, not env: `$IE_CONFIG` → `<cwd>/.ie/config.json` → `~/.config/image-extender/config.json` (`app/lib/ieConfig.ts:10-11,67-71`). Profiles name a provider, base URL, `apiKeyEnv` (env var *name*), image and QA model.
- Browser state is `localStorage`; server keys are a documented fallback only (`.env.example:1-4`).

**Build:**
- `next.config.js` — nothing but `reactStrictMode`.
- `tsconfig.json` — strict, `@/*` alias, `noEmit` (typecheck only; Next owns the build).
- `vitest.config.ts`, `playwright.config.ts` — separate suites by design; Playwright injects `IE_ASSETS_DIR` pointing at a per-run temp copy of `e2e/fixtures/assets` so tests can never touch real assets (`playwright.config.ts:29-32,55`).
- `.env.midscene` (gitignored) supplies `MIDSCENE_MODEL_BASE_URL`, `MIDSCENE_MODEL_API_KEY`, `MIDSCENE_MODEL_NAME`, `MIDSCENE_MODEL_FAMILY`; template at `.env.midscene.example`.

## Platform Requirements

**Development:**
- macOS or Linux (the Chromium auto-discovery looks in `~/Library/Caches/ms-playwright` and `~/.cache/ms-playwright`, `cli/native/deps.mjs:34-37`).
- Chromium must be installed once: `npx playwright install chromium-headless-shell` (`cli/native/deps.mjs:25`); override with `$IE_CHROMIUM`.
- No Docker, no database, no queue: the only external prerequisite is a gateway (OpenRouter key, or a local OpenAI-compatible server at `http://127.0.0.1:3425/v1`).
- `node cli/ie.mjs doctor --json` is the single prerequisite check (node, deps, Chromium, bundle, config, credentials, server, assets).

**Production:**
- Plain Next.js deployment (any Node host; `.vercel` is gitignored at `.gitignore:47-48`, i.e. Vercel-friendly but not coupled). No Vercel-specific APIs are used.
- Filesystem-backed routes need a writable dir for the asset library (`assetsRoot()`, `app/lib/library.ts:41-43`) — a read-only or ephemeral filesystem breaks `/api/library` and pixel saving, while pure generation routes keep working.
- BYOK is the shipping model: a public deployment serves no credential of its own unless `OPENROUTER_API_KEY` is set server-side.
- Distributed as a CLI too: `bin.ie → cli/ie.mjs` (`package.json:5-7`); the CLI resolves its deps and state from the checkout, never the caller's cwd (`cli/native/deps.mjs:15-23`).

---

*Stack analysis: 2026-10-06*
*Update after major dependency changes*
