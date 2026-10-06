<!-- GSD:project-start source:PROJECT.md -->

## Project

**Image Extender — 游戏美术生产管线（fork）**

`boona13/image-extender` 的 fork：把一个 BYOK、无状态、跑在浏览器里的 AI 图像工作室，改造成**面向独立游戏的美术生产管线**——产物落成磁盘资产库（可 git 共享、可追溯每个资产的 prompt/参数/成本）、多生成网关（OpenRouter / Magpie / APIMart / PixelLab）、中英双语 UI、以及可被脚本与 agent 驱动的无头 CLI（`ie`）。第一个真实消费者是同一作者的 Godot 4.7 项目 `dark-black`，当前要补的能力是**动画集生产**（方向 × 状态 × 帧）。

**Core Value:** **一个规格产出一整套能直接进游戏的资产**（帧文件 + 计时 + provenance），使游戏侧那些一次性脚本永远退役。

### Constraints

- **Tech stack**：复用现有 provider 表与 `/api/generate` 的 wire 形状（不新增 kind、不新增路由）；后处理复用 `app/utils/imageProcessor.ts` 的导出，新增**一个** bridge op 做薄组合，不在服务端重写
- **Compatibility**：既有 studio 的 ZIP/manifest 导出逐字节不变；`AssetMeta` 保持 `schemaVersion: 1`
- **Compatibility**：方向顺序即契约（消费端按运行时 sector 顺序把行映射到方向）
- **Dependencies**：本机无法 spawn 具名 `gsd-*` agent（走 generic-agent workaround）；headless 像素引擎需要 Chromium（`npx playwright install chromium-headless-shell`）
- **Security**：BYOK 键只留在浏览器 `localStorage` 或 provider profile 的 `apiKeyEnv`；库只接受 `raw/`、`derived/` 下的文件名；威胁模型限于"自己误操作"（不做 symlink/realpath 加固）

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript 5.9.3 (locked in `package-lock.json`; declared `^5.2.2` in `package.json`) — the whole web app: `app/**/*.ts(x)`, `app/lib/*` (pure logic), `app/api/**/route.ts`, `app/utils/*` (canvas pixel pipelines), `app/components/*` (studios).
- JavaScript (ESM `.mjs`) — the headless CLI: `cli/ie.mjs` and `cli/**/*.mjs` run under plain `node`, importing `next/dist/bin/next` and app modules through a bundled bridge.
- JavaScript (CJS) — config only: `next.config.js`.
- Browser runtime — every pixel transform (chroma key, slicing, tileability, Poisson blend, corner reconcile, pose rigs) executes in a real canvas inside Chromium, both in the browser and headlessly via `cli/native/bridge.mjs`.

## Runtime

- Node.js **>= 18** — enforced by the CLI doctor, not `package.json` (`cli/commands/core.mjs:91-92`: `major >= 18`). There is no `engines` field and no `.nvmrc`; dev machine runs v24.21.0.
- No serverless/edge runtime assumption: filesystem-backed routes declare `export const runtime = 'nodejs'` (`app/api/pixel/route.ts:15`, `app/api/library/[[...path]]/route.ts:8`).
- Browser runtime required for pixel math (headless Chromium via `playwright-core`).
- npm 11.x (`package-lock.json`, `lockfileVersion: 3` present and authoritative — check versions there, not the `^` ranges in `package.json`).
- No workspaces, no monorepo tooling: one package, one lockfile.

## Frameworks

- Next.js 14.2.33 App Router — UI + the nine `/api/*` routes; `next.config.js:2-4` sets only `reactStrictMode: true`.
- React 18.3.1 / react-dom 18.3.1 — all studios; client-only app (`app/` holds the pages, `app/components/*` the studios).
- Tailwind CSS 3.4.18 (+ autoprefixer, postcss) — styling; no component library, icons are inline SVG (`app/components/icons.tsx`).
- Vitest 2.1.9 — unit/contract layer, `environment: 'node'`, includes `app/**/__tests__/**/*.test.ts` and `cli/**/__tests__/**/*.test.mjs` (`vitest.config.ts:9-17`). Run: `npm test`.
- Playwright 1.63.0 + `@midscene/web` 1.14.0 — AI-driven E2E, one spec (`e2e/studio-library.spec.ts`) against a real dev server on port 3311, one worker, 120 s timeout (`playwright.config.ts:36-56`). Run: `npm run test:ai`.
- `node --test` — the Chromium-launching bridge smoke suite, deliberately outside vitest (`cli/native/__tests__/bridge.smoke.test.mjs`, `npm run test:cli`).
- `next dev` / `next build` / `next start` (`package.json:32-34`); the CLI starts and owns its own dev server on port 4317+ (`cli/lib/server.mjs:16-18`, state in `.ie/server.json`).
- esbuild 0.28.2 — bundles `app/utils/*` + `app/lib/*` into one IIFE for the headless bridge (`cli/native/bundle.mjs`, cache in `.ie/cache`).
- TypeScript config: `tsconfig.json` — `target: es5` (Next transpiles down), `strict: true`, `moduleResolution: bundler`, `allowJs`, path alias `@/* → ./*` (mirrored in `vitest.config.ts:5-8`).

## Key Dependencies

- `next` 14.2.33 — framework and the API-route surface every studio and the `ie` CLI call.
- `react` / `react-dom` 18.3.1 — the five studios are client components; no SSR data layer.
- `playwright-core` 1.63.0 — not just a test dep: it is the *runtime* for the headless pixel engine (`cli/native/bridge.mjs:9`).
- `esbuild` 0.28.2 — runtime dependency of the CLI bridge (bundles app modules for the browser page).
- `jszip` 3.10.1 — the only production dependency beyond Next/React; client-side ZIP export of parallax layers, tile atlases and sprite sheets (`app/lib/studioDownload.ts:11`).
- `@midscene/web` 1.14.0 — vision-model UI localization in the E2E suite; also registers the Playwright reporter (`playwright.config.ts:43`).
- `tailwindcss` 3.4.18 + `postcss` + `autoprefixer` — styling pipeline.
- `sharp` 0.35.5 — devDependency present in the tree; not imported by app code (image processing is canvas-based).
- Node built-ins only for I/O: `node:fs/promises` is the sole filesystem owner, and it lives in exactly one module (`app/lib/library.ts:1,18-22`).

## Configuration

- `.env.example` → `.env.local` (gitignored, `.gitignore:17-22`). All keys optional: `OPENROUTER_API_KEY`, `IE_MAGPIE_BASE_URL`, `MAGPIE_API_KEY`, `APIMART_API_KEY`, `IE_ASSETS_DIR`, `IE_BACKEND_LABEL` (`.env.example:8-33`).
- Gateway/credential/model selection is primarily a **config file**, not env: `$IE_CONFIG` → `<cwd>/.ie/config.json` → `~/.config/image-extender/config.json` (`app/lib/ieConfig.ts:10-11,67-71`). Profiles name a provider, base URL, `apiKeyEnv` (env var *name*), image and QA model.
- Browser state is `localStorage`; server keys are a documented fallback only (`.env.example:1-4`).
- `next.config.js` — nothing but `reactStrictMode`.
- `tsconfig.json` — strict, `@/*` alias, `noEmit` (typecheck only; Next owns the build).
- `vitest.config.ts`, `playwright.config.ts` — separate suites by design; Playwright injects `IE_ASSETS_DIR` pointing at a per-run temp copy of `e2e/fixtures/assets` so tests can never touch real assets (`playwright.config.ts:29-32,55`).
- `.env.midscene` (gitignored) supplies `MIDSCENE_MODEL_BASE_URL`, `MIDSCENE_MODEL_API_KEY`, `MIDSCENE_MODEL_NAME`, `MIDSCENE_MODEL_FAMILY`; template at `.env.midscene.example`.

## Platform Requirements

- macOS or Linux (the Chromium auto-discovery looks in `~/Library/Caches/ms-playwright` and `~/.cache/ms-playwright`, `cli/native/deps.mjs:34-37`).
- Chromium must be installed once: `npx playwright install chromium-headless-shell` (`cli/native/deps.mjs:25`); override with `$IE_CHROMIUM`.
- No Docker, no database, no queue: the only external prerequisite is a gateway (OpenRouter key, or a local OpenAI-compatible server at `http://127.0.0.1:3425/v1`).
- `node cli/ie.mjs doctor --json` is the single prerequisite check (node, deps, Chromium, bundle, config, credentials, server, assets).
- Plain Next.js deployment (any Node host; `.vercel` is gitignored at `.gitignore:47-48`, i.e. Vercel-friendly but not coupled). No Vercel-specific APIs are used.
- Filesystem-backed routes need a writable dir for the asset library (`assetsRoot()`, `app/lib/library.ts:41-43`) — a read-only or ephemeral filesystem breaks `/api/library` and pixel saving, while pure generation routes keep working.
- BYOK is the shipping model: a public deployment serves no credential of its own unless `OPENROUTER_API_KEY` is set server-side.
- Distributed as a CLI too: `bin.ie → cli/ie.mjs` (`package.json:5-7`); the CLI resolves its deps and state from the checkout, never the caller's cwd (`cli/native/deps.mjs:15-23`).

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- `camelCase.ts` for every module in `app/lib/` (`generatePrompt.ts`, `libraryCollect.ts`, `chromaPresets.ts`). No kebab-case, no `index.ts` barrels — each module is imported by full path.
- `PascalCase.tsx` for React components in `app/components/` (`LibraryPanel.tsx`, `ParallaxStudio.tsx`).
- Next.js route files are the framework's convention: `app/api/<name>/route.ts`, catch-all as `app/api/library/[[...path]]/route.ts`.
- CLI uses `.mjs` (plain ESM, no build step): `cli/ie.mjs`, `cli/commands/library.mjs`, `cli/lib/args.mjs`.
- Tests: `*.test.ts` inside a sibling `__tests__/` directory; CLI tests `*.test.mjs` (`cli/lib/__tests__/args.test.mjs`); E2E specs `e2e/*.spec.ts`.
- `camelCase`, no prefix for async; verb-first (`buildGeneratePrompt`, `saveAsset`, `collectStudioAsset`, `resolveAssetDir`).
- Predicate helpers are `isX(value): value is X` type guards: `isLocale` (`app/i18n/index.ts`), `isValidKind`/`isValidName`/`isValidRelPath` (`app/lib/libraryPath.ts`), `isPixelOp` (`app/lib/pixel.ts`).
- Route handlers export the HTTP verb itself: `export async function POST(request: NextRequest)` (`app/api/library/[[...path]]/route.ts:87`).
- Test helpers are local, unprefixed factory functions (`meta()`, `req()`, `ctx()`) inside the `__tests__` file.
- `camelCase` locals; `SCREAMING_SNAKE_CASE` for module constants: `MAX_FILE_CHARS`, `UNUSABLE_FS_CODES` (`app/api/library/[[...path]]/route.ts:15,22`), `DATA_URL_RE`, `ORPHAN_RE` (`app/lib/library.ts:21,23`), `PIXFLUX_MIN` (`app/lib/pixel.ts:17`), `EXTENSION_PERCENT` (`app/lib/app.ts:35`).
- Storage/UI keys are namespaced strings with a `extender:` prefix: `STORAGE_KEY = 'extender:api_key'`, `LOCALE_STORAGE_KEY = 'extender:locale'`, `STORAGE_MODE = 'extender:mode'`.
- No underscore-prefixed private members; module privacy is achieved by not exporting.
- `PascalCase`, no `I` prefix: `AssetMeta`, `LibraryIndex`, `Provenance` (`app/lib/libraryTypes.ts`), `CollectedAsset`, `CollectorInput` (`app/lib/libraryCollect.ts`).
- Union sets are `as const` tuples with a derived type: `export const ASSET_KINDS = ['tiles','sprites',...] as const; export type AssetKind = (typeof ASSET_KINDS)[number]` (`app/lib/libraryTypes.ts:7`). Same pattern for `PIXEL_OPS`, `PIXEL_VIEWS`, `PROVIDER_IDS`.
- Discriminated unions over booleans; the `never` assignment in `default:` is the exhaustiveness guard (`app/lib/libraryCollect.ts:9`).
- Error-code unions are `SCREAMING_SNAKE` string literals: `type LibraryErrorCode = 'EEXISTS' | 'ENOTFOUND'` (`app/lib/library.ts:32`).

## Code Style

- No Prettier config and no `.editorconfig` — style is enforced by consistency, not tooling. Match the surrounding file.
- 2-space indentation, single quotes, **no semicolons**, trailing commas in multiline literals.
- Lines run long where a prompt string or a table needs it; there is no enforced column limit.
- Section dividers inside long modules use box-drawing comments: `// ─────────` (`app/lib/app.ts:38`).
- Files carrying client-only React state start with `'use client'` (`app/page.tsx:1`, `app/lib/i18n.tsx:1`).
- `npm run lint` → `next lint`. There is no standalone `eslintrc`/`eslint.config.js` in the repo; the only other static check is `tsc` via `tsconfig.json` (`"strict": true`, `"noEmit": true`).
- Keep the compiler green: a missing zh translation or an unhandled union member is a **compile error**, and that is intended (`app/i18n/index.ts:60`, `app/lib/libraryCollect.ts:9`).

## Import Organization

- No blank lines between import statements; one block per module, then a blank line before the module docblock body.
- `type` specifiers are inlined with `import { X, type Y }`, not a separate statement.
- `@/*` → repo root, defined in both `tsconfig.json` (`"paths": { "@/*": ["./*"] }`) and mirrored in `vitest.config.ts`. Import as `@/app/lib/...`, never `../../lib/...` — the one exception is Next's catch-all route test (`../[[...path]]/route`).

## Error Handling

- Throw `Error` in pure/lib code; catch and translate to HTTP only at the route boundary. Routes wrap the body in `try/catch` and map error type → status code (`app/api/library/[[...path]]/route.ts:129`).
- Typed domain errors carry a machine-readable `code` and keep the human message in `super()`:
- Client-side wrappers use a **distinctly named** error so the two layers cannot be confused: `LibraryRequestError extends Error` carrying `readonly status: number` (`app/lib/libraryClient.ts:12`). The comment states why the name differs from the server's `LibraryError`.
- Routes return errors through one helper rather than building `NextResponse.json` by hand:
- Error shapes on the wire are always `{ error: string }`; fs-failure codes that mean "library unusable" are collected in a set and mapped to 500, everything else to 400 (`UNUSABLE_FS_CODES`, `app/api/library/[[...path]]/route.ts:22,136-141`).
- Validate the whole payload **before** side effects (`app/lib/library.ts:80`: decode every data URL before touching disk).
- The CLI has a parallel contract: `CliError` / `UsageError` with `USAGE_EXIT`, and `okEnvelope`/`errorEnvelope` result shapes (`cli/lib/args.mjs`, asserted in `cli/lib/__tests__/args.test.mjs`).

## Logging

- No logging library. `console` only, and only in scripts/dev paths. There is no `lib/logger.ts` and no structured-logging convention to match.
- Server routes do not log; they return an error body. Provenance and cost are **stamped into data** (`meta.json` `provenance`, `app/lib/libraryTypes.ts:12`) rather than logged.
- Agent-facing feedback goes through the CLI's JSON envelope, not stdout prose.

## Comments

- Every `app/lib/*.ts` module opens with a block docblock stating *why the module exists* and what it owns. This is the repo's strongest convention — rationale and history, not a restatement of the code:
- Comments record measured decisions with their evidence, and name the prior bug when a move fixed one: "The table used to be inlined in `app/api/generate/route.ts`, where three of the four prompt branches reassigned `fullPrompt` and silently dropped it." (`app/lib/stylePrompt.ts:12`).
- Explain *why*/*where it came from* at the point of surprise: `// Decode everything BEFORE touching the disk so a bad payload cannot leave a stray temp directory behind.` (`app/lib/library.ts:81`).
- Deliberate simplifications are marked `ponytail:` with the rationale, e.g. `// ponytail: the body below is the route's text moved verbatim, so it sits one indent deeper than this file's style` (`app/lib/generatePrompt.ts:26`).
- One-line `/** … */` on exported types, fields and functions where the name is not self-evident (`app/lib/libraryTypes.ts` documents nearly every field of `Provenance`).
- No `@param`/`@returns` tag style; prose sentences instead.
- A file that is moved/extracted keeps a header line naming its origin, e.g. `// app/lib/chromaPresets.ts` then the docblock (`app/lib/chromaPresets.ts:1-2`).
- None in shipped source. Deferred work is either done, deleted, or recorded in `docs/superpowers/plans/*.md`; there is no `TODO(username)` convention.

## Function Design

- Pure policy modules keep functions short and single-purpose (`slugify`, `resolveAssetDir`, `purityAt`).
- The route is allowed to be a long linear validator, and `app/page.tsx` (~4k lines) is a known, tolerated god-component — new pure logic is extracted **out** of it rather than growing it (see `app/lib/libraryCollect.ts`, `app/lib/studioDownload.ts`).
- Small positional signatures; optional behaviour goes in a trailing options object: `saveAsset(project, kind, slug, meta, files, opts: { overwrite?: boolean } = {})` (`app/lib/library.ts:70`).
- React/prompt builders take one body object and destructure inside (`buildGeneratePrompt(body: PromptBody)`).
- Pure functions are deterministic: "Pure: same body in, same prompt out. No framework, no network, no env." (`app/lib/generatePrompt.ts`).
- Return early with guard clauses for validation; return `null` (not throw) for "this mode has nothing to collect" (`collectStudioAsset` returns `CollectedAsset | null`).
- Prefer returning plain buffers/plain objects over DOM/canvas handles so a function is node-testable (`app/utils/pixelGrid.ts:4`).

## Module Design

- Named exports only. No default exports except React page/components (`export default function Home()`, `app/page.tsx:36`).
- Constants are exported alongside their derived types so `isX` guards and tables stay in one module.
- No `index.ts` re-export barrels; every consumer imports the concrete module path. The one aggregation point is `app/i18n/index.ts`, which composes the message modules and exports the registry — and even that is deliberate, documented, and single-level.
- Every shared table/fact has exactly one module. Duplicating a value into a second file is treated as a bug: `ART_STYLE_PROMPTS` and `styleDirective()` exist only in `app/lib/stylePrompt.ts`; chroma tunings only in `app/lib/chromaPresets.ts` (whose docblock names the three surfaces that used to each carry a private copy); the on-disk layout only in `app/lib/library.ts`; the gateway table only in `app/lib/providers.ts`.
- Cross-layer field shapes live in a dedicated types module so a rename cannot drift: `app/lib/libraryTypes.ts` is imported by server, route, client and UI.
- Where a fact *is* intentionally duplicated, the comment says why: "Deliberately duplicates a few lines from the existing ZIP exporters rather than refactoring them: the exporters' byte-for-byte output is a tested invariant" (`app/lib/libraryCollect.ts:14`).

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## Pattern Overview

- **One page owns the client.** `app/page.tsx` (3,992 lines) holds every studio's state and orchestration; `app/components/*` are presentational and receive props/handlers.
- **One home per fact.** The gateway table, the `/api/generate` wire contract, prompt policy, and the library disk layout each live in exactly one module. A duplicated table is treated as a bug (see `app/lib/chromaPresets.ts:5-9`).
- **Routes validate and dispatch; they do not decide.** All prompt text and prompt composition moved out of `app/api/**` into `app/lib/*Prompt.ts` (see `app/lib/generatePrompt.ts:1-13`, `app/lib/extendPrompt.ts:1-8`).
- **Pixel math is browser code.** `app/utils/**` uses `Image`/`canvas` and is therefore only runnable in a DOM — the CLI runs it in headless Chromium via an esbuild IIFE bundle (`cli/native/bundle.mjs:18`, `:52`).
- **BYOK, no server state** except one local directory: the asset library on disk. Keys live in browser `localStorage` (`app/lib/app.ts:43-64`) or env vars (`app/lib/llmServer.ts:91`).
- **Bilingual by construction.** `app/i18n/**` types the Chinese map against the English key set, so a missing translation fails `tsc` (`app/i18n/index.ts:62-78`).

## Layers

- Purpose: HTTP boundary. Parse the body, guard required fields, resolve model/gateway, call the lib layer, translate the outcome to `{ error }` + status.
- Contains: route handlers and route-level config only — `export const runtime`/`dynamic` (`app/api/library/[[...path]]/route.ts:7-9`), `POST`/`GET`/`DELETE` functions.
- Depends on: `app/lib/**` only. It never imports React, never contains prompt text, never touches `node:fs` directly.
- Used by: the browser studios and the CLI's HTTP client.
- Constraint: a Next route file may only export handlers and route config — that is why `extractCost` lives in `app/lib/generateCost.ts:11-14`.
- Purpose: everything the app *decides* — provider/gateway facts, credential resolution, the wire contract, prompt composition, QA rubrics, studio data shapes, and the library's disk layout.
- Contains: `providers.ts`, `models.ts`, `imageGeneration.ts`, `llmServer.ts`, `llmChat.ts`, `generateRequest.ts`, `generatePrompt.ts` (1,061 lines of product policy), `qaRubric.ts`, `briefPrompt.ts`, `stylePrompt.ts`, `tileset.ts`, `sprite.ts`, `props.ts`, `bodyPlans.ts`, `parallax.ts`, `library*.ts`.
- Depends on: Node built-ins, `fetch`, and each other. `library.ts` is the only module allowed to import `node:fs`.
- Used by: routes, `app/page.tsx`, `app/components/**`, and the CLI (bundled for Node).
- Purpose: the pixel work that hides seams and makes engine-ready sheets — Poisson blending, chroma key, slicing, tileability, corner reconciliation, sprite pose maps, frame alignment.
- Contains: `imageProcessor.ts` (3,430 lines, ~35 exported functions: `expandCanvas:3`, `applyFullContextResult:683`, `chromaKeyToAlpha:1445`, `sliceImageGrid:2070`, `alignSpriteFramesToBaseline:2601`, `normalizeSpriteFrameScale:2804`), `pixelGrid.ts` (pure, no DOM), `poseRig.ts` + `rigs/{biped,quadruped,serpent,flyer,blob}.ts`.
- Depends on: DOM canvas APIs, `app/lib/chromaPresets`, `app/utils/rigCore`.
- Used by: `app/page.tsx` directly, and the CLI via the browser bundle (`cli/native/bundle.mjs:18` names exactly four entry modules).
- Purpose: state, orchestration, presentation.
- Contains: `Home()` (the single client component, `app/page.tsx:33`), studio components (`ParallaxStudio`, `TileStudio`, `SpriteStudio`, `PropStudio`, `PixelStudio`), shell (`TopBar`, `Workspace`, `CommandBar`, `StudioActionBar`, `VariantSelector`, `Modals`, `LibraryPanel`, `icons`).
- Depends on: `app/lib/**`, `app/utils/**`, `app/i18n` + `app/lib/i18n.tsx`.
- Used by: `app/layout.tsx:26` (wrapped in `I18nProvider`).
- Purpose: the message registry and its React provider. One module per area under `app/i18n/messages/`, flattened in `app/i18n/index.ts:48-80`.
- Depends on: nothing (types in `app/i18n/types.ts` exist to break the only import cycle — see its header).
- Used by: every component through `useI18n()`; `app/i18n/serverErrors.ts` maps route-error strings back onto keys.
- Purpose: drive the app from a shell with no agent babysitting.
- Contains: a command registry (`cli/ie.mjs:23-30`), command modules, and three seams (`cli/lib/context.mjs:6-9`): `ctx.api` (HTTP to the dev server), `ctx.bridge` (app pixel code in headless Chromium), `ctx.modules` (app modules bundled for Node).
- Depends on: the app's own modules by *bundling* them (`cli/native/bundle.mjs:63`) — never by re-implementing an algorithm.
- Used by: agents, scripts, and `npm run ie` (`package.json:31`).

```

```

## Data Flow

- Client: React state in `app/page.tsx`; the small durable bits in `localStorage` — API key per provider, model, QA model, provider, mode, library project, locale, cached model lists (`app/lib/app.ts:43-76`, `app/lib/providerProbe.ts:27-30`).
- Server: stateless per request. The only persistence is the asset library directory (`app/lib/library.ts`), plus `.ie/` runtime state (server pid/port, esbuild cache) for the CLI.
- No database, no sessions, no server-side user identity.

## Key Abstractions

- Purpose: every fact about a gateway and its models has exactly one owner.
- Pieces:
- Pattern: lookup table + `Record<UnionId, X>` exhaustiveness, never a switch scattered across call sites.
- Purpose: the only persistent state the app has, with a path-traversal boundary and a crash-safe writer.
- Pieces:
- Pattern: ports/adapters. `library.ts` is the adapter over `node:fs`; the route, the browser client, the panel and the CLI are all ports onto it.
- Purpose: one union names the five-to-six workspaces and their persistence.
- Examples: `Mode = 'extender' | 'parallax' | 'tile' | 'sprite' | 'props' | 'pixel'` (`app/lib/app.ts:71`).
- Pattern: discriminated union + a render branch in `page.tsx`, not a plugin registry.
- Purpose: name the request kind once on each side of the boundary.
- Examples: `GenerateRequest`/`GenerateBody`/`toWire`/`generateKind` (`app/lib/generateRequest.ts:13-95`).
- Pattern: the wire stays a bag of flags on purpose — `docs/agent-api.md` documents that shape and raw `curl` callers send it.
- Purpose: deterministic, code-authored motion that the image model only *skins*, instead of asking a diffusion model to invent biomechanics.
- Examples: `app/utils/poseRig.ts:38` (`RIGS: Record<BodyPlanId, SpriteRig>`), `app/utils/rigs/*.ts`, `app/lib/bodyPlans.ts`.
- Pattern: dispatch table over body plans, shared primitives in `app/utils/rigCore.ts`.

## Entry Points

- Location: `app/page.tsx:33` (`Home()`), wrapped by `app/layout.tsx:18-29`.
- Triggers: the Next dev server / `next start`.
- Responsibilities: hold all studio state, orchestrate calls, build manifests, render one studio.
- Triggers: `fetch` from the browser studios, or `curl`/the CLI.
- Responsibilities: validate, resolve model + credentials, dispatch, translate the reply.
- Routes: `generate`, `extend`, `scene-brief`, `prop-brief`, `tile-review`, `sprite-review`, `providers`, `pixel`, `library`.
- Location: `cli/ie.mjs` (bin `ie`, `package.json:5-7`); per-command specs in `cli/commands/*.mjs` exported as `default { name: spec }` and collected by `COMMAND_MODULES` (`cli/ie.mjs:23-30`).
- Triggers: `ie <command>` / `npm run ie`.
- Responsibilities: resolve config once, ensure a dev server, drive routes and the bridge, write files + a manifest, optionally save to the library.
- Location: `cli/native/bridge.mjs` (spawned from `cli/lib/bridge.mjs:18`).
- Triggers: one JSON job spec on stdin.
- Responsibilities: bundle the app's pixel modules, launch headless Chromium, run the op, return one JSON result. No network, no API keys (`cli/native/bridge.mjs:12-14`).

## Error Handling

- **Image failures carry a reason.** `ImageFailure.reason: 'credentials' | 'size' | 'gateway' | 'no-image'` (`app/lib/imageGeneration.ts:32-39`) drives the 401/400/502 status the route returns.
- **Routes:** `try/catch` at handler level → `{ error }` + status; 401 means credential/unknown profile, 400 bad input, 4xx/5xx upstream (`docs/agent-api.md:127`). The vendor's own words are passed through for `/api/pixel` — no invented shape (`app/api/pixel/route.ts:27-32`).
- **Client:** `studioRequest` turns a non-2xx into an `ApiError` with the route's message and status; `on401` opens the key modal (`app/lib/studioRequest.ts:27-39`).
- **Library:** `LibraryError` with `code: 'EEXISTS' | 'ENOTFOUND'` maps to 409/404; fs-unusable errno codes (`EACCES`, `ENOSPC`, …) map to 500 with the reason; everything else is a 400 (`app/api/library/[...]/route.ts:18-19`, `:132-142`).
- **CLI:** `CliError`/`UsageError` → `{ ok: false, error: { code, message, detail } }`, exit 1 (runtime) or 2 (usage) (`cli/lib/args.mjs:12-29`, `cli/ie.mjs:184-189`). A bridge failure throws immediately so a command never continues on a broken image (`cli/lib/bridge.mjs:36-41`).
- **Critics fail open.** A QA route that fails to answer is treated as approval by the UI — a flaky vision model must never block a generation (`docs/agent-api.md:194-196`).
- **Degrade, don't block.** An unusable asset library reports "library unavailable" in the panel; generation keeps working.

## Cross-Cutting Concerns

- `console.error` inside route handlers with the route name (`app/api/generate/route.ts:188`); no logging library.
- CLI progress goes to **stderr** so stdout stays a single parseable object (`cli/ie.mjs:10-12`, `:164-166`).
- Hand-rolled guards at each boundary, no schema library: `isValidName`/`isValidRelPath`/`assertInsideRoot` (`app/lib/libraryPath.ts`), `isProviderId` (`app/lib/providers.ts:49`), `isDirection` (`app/lib/extendPrompt.ts`), `generateKind` (`app/lib/generateRequest.ts:86`), `isPixelOp` (`app/lib/pixel.ts:14`).
- The CLI's config file validator is the same one the server runs — "a file that loads is a file the server accepts" (`docs/agent-api.md:85-94`, `app/lib/ieConfig.ts`).
- BYOK only. Key precedence: request body → profile (`apiKeyEnv` env var, else inline) → provider env var (`app/lib/llmServer.ts:89-91`).
- The server never persists a key; the browser keeps one per gateway in `localStorage` (`app/lib/app.ts:57-64`).
- Path safety is the library's only "auth": a local, single-user tool with an explicit, documented threat model.
- Every user-visible string goes through `t()`; `app/i18n/serverErrors.ts` maps app-authored English error text back onto keys, while third-party gateway text is passed through untranslated (`:8-11`).
- Locale is UI state, not routing: persisted in `localStorage`, applied to `<html lang>` and the document title (`app/lib/i18n.tsx:47-70`).
- `vitest` over colocated `app/**/__tests__/**/*.test.ts` and `cli/**/__tests__/**/*.test.mjs` (`vitest.config.ts:13`), plus a separate `node:test` Chromium smoke suite for the bridge (`package.json:40`) and Playwright + Midscene E2E for UI wiring (`e2e/studio-library.spec.ts:1-11`).

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `$gsd-debug` for investigation and bug fixing
- `$gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
