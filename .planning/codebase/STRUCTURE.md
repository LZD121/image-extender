# Codebase Structure

**Analysis Date:** 2026-10-06

## Directory Layout

```
image-extender/
├── app/                     # The Next.js app (App Router) — everything the web surface owns
│   ├── api/                 # HTTP boundary: one directory per route, handlers only
│   ├── components/          # Presentational React components (props in, events out)
│   ├── i18n/                # Message registry: one module per area + serverError mapping
│   ├── lib/                 # Model/policy layer: providers, prompts, wire contract, library
│   ├── utils/               # Browser pixel math (canvas/DOM) + pure grid math + pose rigs
│   │   └── rigs/            # One rig module per body plan
│   ├── globals.css          # Design tokens + utility classes
│   ├── layout.tsx           # Root layout; mounts I18nProvider
│   └── page.tsx             # The single client component — all studio state (3,992 lines)
├── cli/                     # Headless `ie` CLI (drives the app's own modules; never re-implements one)
│   ├── commands/            # Command modules, each exporting `default { name: spec }`
│   │   └── __tests__/       # node:test suites for command-level contracts
│   ├── lib/                 # CLI seams: args/envelope, context, HTTP server, bridge client, media
│   │   └── __tests__/
│   ├── native/              # esbuild bundling + the headless-Chromium bridge process
│   │   └── __tests__/       # bridge smoke suite (spawns Chromium; run via `npm run test:cli`)
│   └── ie.mjs               # Registry + entry point (bin: `ie`)
├── e2e/                     # Playwright + Midscene AI-driven UI tests
│   └── fixtures/assets/     # A copyable demo library; every run gets its own temp copy
├── assets/                  # $IE_ASSETS_DIR default: the on-disk asset library (git-shared)
│   └── <project>/<kind>/<slug>/{meta.json,raw/,derived/}
├── docs/                    # agent-api.md (headless contract) + superpowers specs/plans + screenshots
├── .planning/codebase/      # This GSD codebase map
├── .ie/                     # CLI runtime state + esbuild cache (gitignored)
└── *.config.*               # next / tailwind / postcss / vitest / playwright / tsconfig
```

## Directory Purposes

**`app/api/`**
- Purpose: the HTTP boundary. Each route parses, guards, dispatches, and translates a failure to `{ error }` + status.
- Contains: `route.ts` per route directory; optional `__tests__/` beside it.
- Key files: `app/api/generate/route.ts`, `app/api/extend/route.ts`, `app/api/library/[[...path]]/route.ts` (catch-all — covers both the index and deep paths), `app/api/pixel/route.ts`, `app/api/providers/route.ts`.
- Subdirectories: one per route name; `app/api/library/` and `app/api/pixel/` set `runtime = 'nodejs'`.
- Rule: route files may only export handlers and route config, so any helper worth testing goes to `app/lib/`.

**`app/lib/`**
- Purpose: everything the app decides. If two callers must agree on a fact, the fact lives here.
- Contains: `*.ts` modules, flat, plus `__tests__/`.
- Key files: `providers.ts` (gateway table), `models.ts` (curated model table + per-model timing), `imageGeneration.ts` (`IMAGE_ADAPTERS`), `llmServer.ts` (credential/endpoint resolution), `llmChat.ts`, `llmResponse.ts`, `generateRequest.ts` (wire contract), `generatePrompt.ts` (product policy, 1,061 lines), `qaRubric.ts`, `briefPrompt.ts`, `stylePrompt.ts`, `chromaPresets.ts`, `ieConfig.ts`, `gatewayProbe.ts`, `providerProbe.ts`, `studioRequest.ts`, `studioDownload.ts`, and the library family below.
- Library family: `library.ts` (the only `node:fs` user), `libraryPath.ts` (pure validation), `libraryTypes.ts` (shared shape), `libraryCollect.ts` (studio state → payload), `libraryClient.ts` (browser fetch face).

**`app/utils/`**
- Purpose: pixel work. Browser-first: most functions load an `Image` and draw to a canvas.
- Contains: `imageProcessor.ts` (3,430 lines, the whole blending/keying/slicing/alignment toolbox), `pixelGrid.ts` (pure buffer math — no DOM, node-testable), `poseRig.ts` (rig dispatch), `rigCore.ts` (shared primitives).
- Subdirectories: `rigs/` — `biped.ts`, `quadruped.ts`, `serpent.ts`, `flyer.ts`, `blob.ts`, dispatched by `RIGS` in `app/utils/poseRig.ts:38`.
- Note: `pixelGrid.ts` is what `ie pixel` finalizes vendor output with, so it must stay DOM-free.

**`app/components/`**
- Purpose: presentation only. A component receives state and handlers; it owns no business state.
- Contains: `*.tsx`, PascalCase, one primary export per file (extras like `StudioCountPill` share the file that owns them).
- Key files: `TopBar.tsx` (mode pill, language switcher), `Workspace.tsx` (`EdgeHandle` + canvas frame), `CommandBar.tsx` (prompt + art style + scene brief), `StudioActionBar.tsx` (the bar every studio wears), `VariantSelector.tsx`, `Modals.tsx` (Settings drawer, API-key modal, generate modal, error toast), `LibraryPanel.tsx`, `icons.tsx`.
- Studios: `ParallaxStudio.tsx`, `TileStudio.tsx`, `SpriteStudio.tsx`, `PropStudio.tsx`, `PixelStudio.tsx`.

**`app/i18n/`**
- Purpose: the message registry and the route-error → key mapping.
- Contains: `index.ts` (locales, flattened `messages`, `MessageKey`), `types.ts` (`Namespace` — kept separate to break the registry ↔ message-module cycle), `serverErrors.ts` (exact + fuzzy English → key).
- Subdirectories: `messages/` — one module per area: `app`, `common`, `errors`, `shell`, `modals`, `extender`, `parallax`, `sprite`, `tile`, `props`, `pixel`; `__tests__/`.
- Rule: a key lives in exactly one area module; keys are flat dotted strings (`shell.topbar.newImage`).

**`cli/`**
- Purpose: the same capabilities without a browser.
- Key files: `cli/ie.mjs` (registry, global flags, envelope rendering), `cli/lib/args.mjs` (`UsageError`/`CliError` + strict `parseArgs`), `cli/lib/context.mjs` (the `ctx.api` / `ctx.bridge` / `ctx.modules` seams), `cli/lib/server.mjs` (`ensureServer`, the HTTP client, `.ie/server.json`), `cli/lib/bridge.mjs` (spawn the bridge process), `cli/lib/media.mjs` (data-URL ↔ file, manifest writing, `sharp` sizing), `cli/native/bundle.mjs` (esbuild; browser IIFE for `window.IE`, ESM for Node), `cli/native/bridge.mjs` (headless Chromium + `PAGE_PROGRAM`), `cli/native/deps.mjs` (repo-root resolution, Chromium discovery).
- Subdirectories: `commands/` (`core`, `prim`, `studio`, `pixel`, `library`, `config`).

**`e2e/`**
- Purpose: AI-driven UI tests for the class of defect unit tests cannot see (a panel mounted twice, a click that does nothing).
- Contains: `studio-library.spec.ts`, `fixture.ts` (Playwright `test` extended with Midscene fixtures), `fixtures/assets/` seed library.
- Note: `playwright.config.ts:31-32` copies the fixture library to a fresh temp dir per run, so a test can never touch the repo's real `assets/`.

**`assets/`**
- Purpose: the on-disk asset library, keyed by convention `<project>/<kind>/<slug>/`.
- Contains: `meta.json` + `raw/` (model output, gitignored) + `derived/` (final artifacts, versioned and git-shared).
- Source: written by `app/lib/library.ts` and nothing else.
- Committed: `derived/` and `meta.json` yes; `raw/` no (`.gitignore:50-51`).

## Key File Locations

**Entry Points:**
- `app/page.tsx:33` — the single client component; every studio's state and handlers.
- `app/layout.tsx:18` — root layout, mounts `I18nProvider`.
- `app/api/<name>/route.ts` — the nine HTTP routes.
- `cli/ie.mjs` — the `ie` CLI (bin declared in `package.json:5-7`).
- `cli/native/bridge.mjs` — the headless-Chromium post-processing process.

**Configuration:**
- `package.json:30-41` — scripts: `dev`, `build`, `test` (vitest), `test:ai` (playwright), `test:cli` (bridge smoke), `ie`.
- `tsconfig.json:20-24` — the `@/*` alias every import uses.
- `vitest.config.ts:11-16` — test include/exclude (the bridge suite is deliberately excluded).
- `playwright.config.ts` — per-run temp asset dir, port 3311, Midscene env loading.
- `next.config.js`, `tailwind.config.js`, `postcss.config.js` — framework config.
- `.env.example` — `IE_*` and provider keys; `.env.midscene.example` for the AI suite.
- `app/lib/ieConfig.ts` — the CLI's runtime config resolution (`$IE_CONFIG` → `<cwd>/.ie/config.json` → `~/.config/image-extender/config.json`).

**Core Logic:**
- `app/lib/providers.ts`, `app/lib/models.ts`, `app/lib/imageGeneration.ts`, `app/lib/generateRequest.ts` — seam A (gateway/model/request facts).
- `app/lib/library*.ts` — seam B (the asset library, in its five pieces).
- `app/lib/generatePrompt.ts`, `app/lib/extendPrompt.ts`, `app/lib/briefPrompt.ts`, `app/lib/qaRubric.ts`, `app/lib/stylePrompt.ts` — prompt policy.
- `app/utils/imageProcessor.ts`, `app/utils/pixelGrid.ts`, `app/utils/poseRig.ts` — pixel math.
- `cli/commands/*.mjs` — the CLI surfaces.

**Testing:**
- Colocated: `app/**/__tests__/**/*.test.ts`, `cli/**/__tests__/**/*.test.mjs` (vitest).
- Chromium smoke: `cli/native/__tests__/bridge.smoke.test.mjs` (`node --test`, via `npm run test:cli`).
- UI: `e2e/studio-library.spec.ts` (Playwright + Midscene).
- Note: `app/api/extend/__tests__/` exists but is empty — the extend route is covered through `app/lib/__tests__/extendPrompt.test.ts`.

**Documentation:**
- `docs/agent-api.md` — the headless contract: every route's body/response, the CLI reference, config file format, env vars. Accurate and current; treat it as the spec for anything agent-facing.
- `docs/superpowers/specs/` — design specs (fork design, pixel-art line, animation-set production); `docs/superpowers/plans/` — their implementation plans.
- `README.md` — user-facing feature tour.
- `docs/screenshots/` — the README's images (context, not code).

## Naming Conventions

**Files:**
- `app/lib/*.ts` — camelCase, single concept, no directory nesting: `providers.ts`, `tileset.ts`, `libraryPath.ts`. A family shares a prefix (`library.ts`, `libraryPath.ts`, `libraryTypes.ts`, `libraryClient.ts`).
- `*-Prompt.ts` / `*Prompt.ts` — modules that own prompt text for a route.
- `app/components/*.tsx` — PascalCase, named after the main export; a studio ends in `Studio.tsx`.
- `app/utils/*.ts` — camelCase (`imageProcessor.ts`, `poseRig.ts`); one file per rig under `rigs/`.
- `app/i18n/messages/<area>.ts` — lowercase area name matching the key prefix.
- `cli/commands/<noun>.mjs` — lowercase noun, often shorter than the concept it names (`prim` = the primitives with no server or cost).
- `cli/lib/<name>.mjs` — lowercase role name: `args`, `context`, `server`, `bridge`, `media`.
- `__tests__/<module>.test.ts` / `.test.mjs` — mirrors the module's basename.
- Route handlers: always `route.ts` inside `app/api/<name>/` (Next convention); catch-all is `[[...path]]/route.ts`.

**Identifiers:**
- Library ids (`project`, `kind`, `slug`, names): `^[a-z0-9][a-z0-9-]{0,63}$` (`app/lib/libraryPath.ts:14`).
- Stored file paths: `^(raw|derived)/<name>.<ext>` — one segment, extension required (`app/lib/libraryPath.ts:16`).
- Config profile ids: `^[a-z0-9][a-z0-9-]{0,31}$` (`app/lib/ieConfig.ts:24`).
- i18n keys: flat dotted, `<area>.<thing>.<thing>`; interpolated slots are `{name}`.
- localStorage keys: `extender:<thing>` (`app/lib/app.ts:43-76`), except the versioned provider-model cache `extender:providerModels:v2` (`app/lib/providerProbe.ts:30`).
- CLI flags: kebab-case, declared in each spec's `options` (`--base-url`, `--overwrite`, `--body-file`).
- CLI error codes: snake_case for the CLI's own (`bad_payload`, `config_invalid`, `bridge_failed`) and passthrough for the app's typed ones (`EEXISTS`, `ENOTFOUND`).

**Special Patterns:**
- Exhaustive registries: `Record<ProviderId, X>`, `Record<LayerRole, X>`, `Record<BodyPlanId, X>` — adding a union member is a compile error until the new entry is written.
- Route files export only handlers/config; helpers that need tests move to `app/lib/`.
- `'use client'` marks a module as browser-only. `app/lib/layerRoles.ts` exists precisely because `parallax.ts` is client-marked and a route cannot read it.
- `'use client'` is deliberately absent from pure `app/lib` modules that both React and Node import (see commit `45c1723 chore(lib): drop the meaningless 'use client' markers`).

## Where to Add New Code

**New studio (a new workspace):**
- Mode union: add to `Mode` in `app/lib/app.ts:71` and to the mode pill in `app/components/TopBar.tsx`.
- Data model: a new `app/lib/<studio>.ts` with geometry/presets/manifest builder (model `app/lib/props.ts` / `sprite.ts`).
- Prompt policy: a branch in `app/lib/generatePrompt.ts` (and a `GenerateKind` member in `app/lib/generateRequest.ts` if it needs its own wire flag).
- Component: `app/components/<Name>Studio.tsx`; state and handlers in `app/page.tsx` (new `// ── <Mode> handlers ──` section) and a render branch in the `isX`/`isProps ? …` block near `app/page.tsx:3619+`.
- Persistence: a `kind` in `ASSET_KINDS` (`app/lib/libraryTypes.ts:7`) and a branch in `collectStudioAsset` (`app/lib/libraryCollect.ts`).
- Copy: a new `app/i18n/messages/<studio>.ts` registered in `app/i18n/index.ts:14-24` and `:48-78`.

**New API route:**
- Handler: `app/api/<name>/route.ts`. Keep it to validate → `modelOrDefault` → dispatch → translate.
- Shared logic: `app/lib/<name>Prompt.ts` or the relevant existing module — never inside the route.
- If it talks to a model: go through `llmTarget`/`generateImage` so credentials and the gateway resolution stay in one place (`app/lib/llmServer.ts`, `app/lib/imageGeneration.ts`).
- Tests: `app/api/<name>/__tests__/<thing>.test.ts` for the handler contract, `app/lib/__tests__/` for the pure part.
- Docs: add the route to the table in `docs/agent-api.md` §4.

**New CLI command:**
- Registry: add the spec module to `COMMAND_MODULES` in `cli/ie.mjs:23-30`; the module's `export default { <name>: spec }` provides `summary`, `usage`, `options`, `run(ctx)`.
- Pick the right module by cost: no-server pixel work → `cli/commands/prim.mjs`; paid pipelines → `cli/commands/studio.mjs`; vendor relay → `pixel.mjs`; library → `library.mjs`; config → `config.mjs`.
- Reuse the seams: `ctx.api` for HTTP, `ctx.bridge`/`ctx.bridgeBatch` for pixel ops, `ctx.modules(name, [...imports])` for app modules bundled for Node. Never re-implement an algorithm in the CLI.
- Tests: `cli/commands/__tests__/<name>.test.mjs` (vitest) for pure logic; `cli/native/__tests__/` only if it needs Chromium.
- Docs: add a row to the CLI tables in `docs/agent-api.md` §5.

**New library kind:**
- Add the id to `ASSET_KINDS` in `app/lib/libraryTypes.ts:7` — this is the single source; `libraryPath.ts`, the route validator and `ie library` all read it.
- Map the studio → kind in `collectStudioAsset` (`app/lib/libraryCollect.ts`), and add the CLI's kind mapping in `cli/commands/studio.mjs:31`.
- Nothing else: the disk layout, atomic write, index walk and `ie library <sub>` pick the new kind up automatically.
- Copy: add `shell.library.kind.<kind>` to `app/i18n/messages/shell.ts` (and `KIND_KEY` in `app/components/LibraryPanel.tsx:28`).

**New i18n namespace:**
- Create `app/i18n/messages/<area>.ts` exporting `const <area>: Namespace = { en: {...}, zh: {...} }` (copy the shape from `app/i18n/messages/app.ts`).
- Register it in `app/i18n/index.ts` twice: the import list (`:14-24`) and both spreads (`en` at `:48-60`, `zh` at `:66-78`). A missing zh key is a compile error by design.
- Runtime-built keys (from data ids) are covered by `app/i18n/__tests__/messages.test.ts` — extend that test if you add one.
- If a route error message is user-visible, add it to `EXACT` (or the fuzzy matcher) in `app/i18n/serverErrors.ts`.

**New provider/gateway:**
- Add the id to `ProviderId` and `PROVIDER_IDS`, and a `PROVIDERS` entry (`app/lib/providers.ts`). The compiler then demands an `IMAGE_ADAPTERS` entry (`app/lib/imageGeneration.ts:150`) — write it, or reuse `viaChat` for any OpenAI-compatible endpoint.
- Record the ids you actually verified in `VERIFIED_MODELS` (`app/lib/providers.ts:127`), with the failures in prose.

**New shared utility:**
- Pure + used by routes/lib → `app/lib/`. DOM/canvas → `app/utils/`. Presentational → `app/components/`.
- Pure pixel buffer math that must run under Node → `app/utils/pixelGrid.ts` (or a new DOM-free module) and add it to the CLI's bundle entry list if the CLI needs it.

## Special Directories

**`assets/`:**
- Purpose: the asset library — the app's only persistent state.
- Source: written exclusively by `app/lib/library.ts` (`saveAsset`), via `POST /api/library` or `ie library save`.
- Committed: partially — `derived/` and `meta.json` are shared through git; `raw/` is gitignored (`.gitignore:50-51`). `*.png -diff` in `.gitattributes` keeps image diffs out of git output.
- Root override: `IE_ASSETS_DIR` (`app/lib/library.ts:41-43`).

**`.ie/`:**
- Purpose: CLI runtime state.
- Source: `ensureServer` writes `server.json`/`server.log` (`cli/lib/server.mjs:16-17`); `cli/native/bundle.mjs` writes the esbuild cache to `.ie/cache/`.
- Committed: No (`.gitignore:58-59`).

**`.next/`, `node_modules/`, `tsconfig.tsbuildinfo`, `next-env.d.ts`:**
- Purpose: build output and installed deps. Never edit; never cite.

**`test-results/`, `midscene_run/`, `playwright-report/`:**
- Purpose: Midscene/Playwright run output (traces, reports, logs).
- Committed: No (`.gitignore:53-60`).

**`.pi-glla/`, `.serena/`, `.omp/`:**
- Purpose: local agent-tooling state, not part of the app.
- Committed: No (`.gitignore:62-65`).

---

*Structure analysis: 2026-10-06*
*Update when directory structure changes*
