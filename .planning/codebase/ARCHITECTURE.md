# Architecture

**Analysis Date:** 2026-10-06

## Pattern Overview

**Overall:** Layered Next.js App Router app — a thin HTTP boundary over a pure model/policy layer, with browser-only canvas post-processing — plus a headless CLI that **reuses those same modules** (bundled) instead of re-implementing them.

**Key Characteristics:**
- **One page owns the client.** `app/page.tsx` (3,992 lines) holds every studio's state and orchestration; `app/components/*` are presentational and receive props/handlers.
- **One home per fact.** The gateway table, the `/api/generate` wire contract, prompt policy, and the library disk layout each live in exactly one module. A duplicated table is treated as a bug (see `app/lib/chromaPresets.ts:5-9`).
- **Routes validate and dispatch; they do not decide.** All prompt text and prompt composition moved out of `app/api/**` into `app/lib/*Prompt.ts` (see `app/lib/generatePrompt.ts:1-13`, `app/lib/extendPrompt.ts:1-8`).
- **Pixel math is browser code.** `app/utils/**` uses `Image`/`canvas` and is therefore only runnable in a DOM — the CLI runs it in headless Chromium via an esbuild IIFE bundle (`cli/native/bundle.mjs:18`, `:52`).
- **BYOK, no server state** except one local directory: the asset library on disk. Keys live in browser `localStorage` (`app/lib/app.ts:43-64`) or env vars (`app/lib/llmServer.ts:91`).
- **Bilingual by construction.** `app/i18n/**` types the Chinese map against the English key set, so a missing translation fails `tsc` (`app/i18n/index.ts:62-78`).

## Layers

**Route layer (`app/api/**`):**
- Purpose: HTTP boundary. Parse the body, guard required fields, resolve model/gateway, call the lib layer, translate the outcome to `{ error }` + status.
- Contains: route handlers and route-level config only — `export const runtime`/`dynamic` (`app/api/library/[[...path]]/route.ts:7-9`), `POST`/`GET`/`DELETE` functions.
- Depends on: `app/lib/**` only. It never imports React, never contains prompt text, never touches `node:fs` directly.
- Used by: the browser studios and the CLI's HTTP client.
- Constraint: a Next route file may only export handlers and route config — that is why `extractCost` lives in `app/lib/generateCost.ts:11-14`.

**Model / policy layer (`app/lib/**`):**
- Purpose: everything the app *decides* — provider/gateway facts, credential resolution, the wire contract, prompt composition, QA rubrics, studio data shapes, and the library's disk layout.
- Contains: `providers.ts`, `models.ts`, `imageGeneration.ts`, `llmServer.ts`, `llmChat.ts`, `generateRequest.ts`, `generatePrompt.ts` (1,061 lines of product policy), `qaRubric.ts`, `briefPrompt.ts`, `stylePrompt.ts`, `tileset.ts`, `sprite.ts`, `props.ts`, `bodyPlans.ts`, `parallax.ts`, `library*.ts`.
- Depends on: Node built-ins, `fetch`, and each other. `library.ts` is the only module allowed to import `node:fs`.
- Used by: routes, `app/page.tsx`, `app/components/**`, and the CLI (bundled for Node).

**Browser post-processing layer (`app/utils/**`):**
- Purpose: the pixel work that hides seams and makes engine-ready sheets — Poisson blending, chroma key, slicing, tileability, corner reconciliation, sprite pose maps, frame alignment.
- Contains: `imageProcessor.ts` (3,430 lines, ~35 exported functions: `expandCanvas:3`, `applyFullContextResult:683`, `chromaKeyToAlpha:1445`, `sliceImageGrid:2070`, `alignSpriteFramesToBaseline:2601`, `normalizeSpriteFrameScale:2804`), `pixelGrid.ts` (pure, no DOM), `poseRig.ts` + `rigs/{biped,quadruped,serpent,flyer,blob}.ts`.
- Depends on: DOM canvas APIs, `app/lib/chromaPresets`, `app/utils/rigCore`.
- Used by: `app/page.tsx` directly, and the CLI via the browser bundle (`cli/native/bundle.mjs:18` names exactly four entry modules).

**Client layer (`app/page.tsx`, `app/components/**`):**
- Purpose: state, orchestration, presentation.
- Contains: `Home()` (the single client component, `app/page.tsx:33`), studio components (`ParallaxStudio`, `TileStudio`, `SpriteStudio`, `PropStudio`, `PixelStudio`), shell (`TopBar`, `Workspace`, `CommandBar`, `StudioActionBar`, `VariantSelector`, `Modals`, `LibraryPanel`, `icons`).
- Depends on: `app/lib/**`, `app/utils/**`, `app/i18n` + `app/lib/i18n.tsx`.
- Used by: `app/layout.tsx:26` (wrapped in `I18nProvider`).

**i18n layer (`app/i18n/**`, `app/lib/i18n.tsx`):**
- Purpose: the message registry and its React provider. One module per area under `app/i18n/messages/`, flattened in `app/i18n/index.ts:48-80`.
- Depends on: nothing (types in `app/i18n/types.ts` exist to break the only import cycle — see its header).
- Used by: every component through `useI18n()`; `app/i18n/serverErrors.ts` maps route-error strings back onto keys.

**CLI layer (`cli/**`):**
- Purpose: drive the app from a shell with no agent babysitting.
- Contains: a command registry (`cli/ie.mjs:23-30`), command modules, and three seams (`cli/lib/context.mjs:6-9`): `ctx.api` (HTTP to the dev server), `ctx.bridge` (app pixel code in headless Chromium), `ctx.modules` (app modules bundled for Node).
- Depends on: the app's own modules by *bundling* them (`cli/native/bundle.mjs:63`) — never by re-implementing an algorithm.
- Used by: agents, scripts, and `npm run ie` (`package.json:31`).

```
app/api/**  ──imports──▶  app/lib/**  ──imports──▶  node: built-ins / fetch
     ▲                        ▲
     │ fetch                  │ imports
app/page.tsx ──imports──▶ app/lib/**, app/utils/** (DOM canvas)
     ▲                                   ▲
     │ HTTP                              │ browserBundle() IIFE in headless Chromium
cli/ie.mjs ──ctx.api──▶ routes      cli/native/bridge.mjs
          └──ctx.modules──▶ nodeBundle() of app/lib/** (library, pixelGrid, models)
```

## Data Flow

**Generation, end to end (`/api/generate`):**

1. User acts in a studio; `app/page.tsx` builds a `GenerateRequest` and names the kind once (`toWire`, `app/lib/generateRequest.ts:76`).
2. `studioRequest()` POSTs it and turns any non-2xx into an `ApiError` carrying the status, routing 401 to the caller's key-modal policy (`app/lib/studioRequest.ts:16-39`).
3. `app/api/generate/route.ts:36` parses the body, guards `prompt/width/height` (`:54`), then **re-derives** the kind from the wire flags (`generateKind`, `:63`) — the same function the client used in reverse.
4. `modelOrDefault({ kind: 'image' })` resolves the model: request → profile (`app/lib/ieConfig.ts`) → provider default (`app/lib/llmServer.ts:139-148`).
5. `buildGeneratePrompt({ ...body, prompt })` turns the body into the model prompt — pure, per-kind, testable without HTTP (`app/lib/generatePrompt.ts`).
6. Reference images are attached as `image_url` content parts in a fixed order the prompt labels by index (`app/api/generate/route.ts:93-123`).
7. `generateImage()` resolves credentials **once** and dispatches through `IMAGE_ADAPTERS` (`app/lib/imageGeneration.ts:150-165`): `viaChat` for openrouter/magpie (`:81`), `viaApimart` for the async task API (`:116`, `app/lib/apimartServer.ts`).
8. The reply carries `imageUrl` (data URL or remote link), `cost`, `provider`, `model`, and the assistant text; prop modes additionally regex out `ITEMS:` names (`:169-177`).
9. Client post-processing runs in the browser: chroma key → slice → reconcile/align (`app/utils/imageProcessor.ts`), scored against the seam where relevant.
10. Output leaves by one of two doors: **ZIP/PNG export** through `app/lib/studioDownload.ts` (`downloadUrl`/`downloadText`/`downloadZip`), or **library save** through `libraryClient.saveAsset` → `POST /api/library`.

**Extend, end to end:**

1. `expandCanvas()` grows the canvas with a blank strip and returns `extensionInfo` (`app/utils/imageProcessor.ts:3`).
2. `POST /api/extend` (`app/api/extend/route.ts:7`) validates direction (`isDirection`) and builds the outpaint prompt (`app/lib/extendPrompt.ts`).
3. The reply is the whole canvas, not the strip; `applyFullContextResult()` blends it (`:683`), `measureSeamResidual()` scores it (`:416`).
4. Horizontal extends run `maxAttempts` times and the candidates are sorted best-first; vertical extends use the single chunked path (`createChunkedExtension:784`, `stitchExtendedChunk:975`). The CLI mirrors this exactly (`cli/commands/studio.mjs:153-238`).

**CLI, end to end (`ie tiles …`):**

1. `cli/ie.mjs` splits global flags, loads the command registry, validates the config file **up front** (`:144-161`), parses argv strictly, and builds one `ctx`.
2. The command calls `ctx.api` for anything that spends money (HTTP to `next dev`, started on demand by `cli/lib/server.mjs:ensureServer`).
3. Pixel transforms go through `ctx.bridge` — a JSON job spec piped to a subprocess (`cli/lib/bridge.mjs:18`) that boots headless Chromium, injects `window.IE` from the esbuild bundle, and runs the app's own functions (`cli/native/bridge.mjs:41+`).
4. Library writes skip HTTP entirely and call the app's `app/lib/library.ts` through `ctx.modules('library', …)`, so a CLI-written asset is byte-identical to a panel-saved one (`cli/commands/library.mjs:1-10`, `cli/commands/studio.mjs:91-107`).
5. Output is one envelope: `{ ok: true, summary, written, … }`, with progress on stderr (`cli/ie.mjs:112-125`).

**State Management:**
- Client: React state in `app/page.tsx`; the small durable bits in `localStorage` — API key per provider, model, QA model, provider, mode, library project, locale, cached model lists (`app/lib/app.ts:43-76`, `app/lib/providerProbe.ts:27-30`).
- Server: stateless per request. The only persistence is the asset library directory (`app/lib/library.ts`), plus `.ie/` runtime state (server pid/port, esbuild cache) for the CLI.
- No database, no sessions, no server-side user identity.

## Key Abstractions

**Seam A — the provider/gateway table (one place per fact):**
- Purpose: every fact about a gateway and its models has exactly one owner.
- Pieces:
  - `app/lib/providers.ts:42-90` — `PROVIDER_IDS`, `PROVIDERS` (baseUrl, key env, fallback image/QA model, labels, docs). Isomorphic on purpose; the *base URL actually used* is resolved server-side (`app/lib/llmServer.ts:31-36`) so a client-supplied URL can never turn the server into an open proxy.
  - `app/lib/providers.ts:127-189` — `VERIFIED_MODELS`: what this project has actually completed a call with, per gateway, with the rejected ids recorded in prose so nobody re-probes them. `pickableModels` (`:204`) splits a gateway's reported list into verified vs. unverified.
  - `app/lib/models.ts:42-71` — the curated `MODELS` table for OpenRouter, plus `timingFor` (`:22`) which decides best-of-N and the ETA for ids the app has never seen. `getModelConfig` (`:80`) is the only reader.
  - `app/lib/imageGeneration.ts:150` — `IMAGE_ADAPTERS: Record<ProviderId, ImageAdapter>`: **a new provider does not compile until it is given an adapter here.** The capability guard that only APIMart needs travels with its adapter (`APIMART_NEEDS_FULL_CONTEXT`, `:44`).
  - `app/lib/generateRequest.ts:76`/`:86` — `toWire` out, `generateKind` in, so client and server cannot disagree about what "tileSheet" means.
  - Credential/endpoint resolution: `llmCredentials` (`app/lib/llmServer.ts:80`) orders body key → profile credential → provider env var; `requestProvider` (`:59`) orders `provider` → `profile` → config `defaultProfile` → deployment default.
- Pattern: lookup table + `Record<UnionId, X>` exhaustiveness, never a switch scattered across call sites.

**Seam B — the asset library boundary:**
- Purpose: the only persistent state the app has, with a path-traversal boundary and a crash-safe writer.
- Pieces:
  - `app/lib/libraryTypes.ts:7-51` — `ASSET_KINDS` and `AssetMeta`/`Provenance`/`LibraryIndex`. Four consumers import this shape, so a field rename cannot drift.
  - `app/lib/libraryPath.ts:14-36` — pure validation (`NAME_RE`, `FILE_RE`, `assertInsideRoot`) so the security boundary is testable without touching a disk. It deliberately does **not** resolve symlinks (documented threat model, `:8-11`).
  - `app/lib/library.ts:41-43` — `assetsRoot()`: `IE_ASSETS_DIR` or `<cwd>/assets`. `saveAsset` (`:65`) decodes everything before touching disk, writes into a sibling `.tmp-<pid>-<ts>` dir, and promotes by atomic rename with a crash-safe old-asset swap (`:96-111`); `listAssets` (`:144`) reports a corrupt `meta.json` in `warnings` and skips it.
  - `app/api/library/[[...path]]/route.ts` — HTTP face. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, 40 MiB/file and 200 MiB/request caps (`:13-16`), and the server re-stamps `provenance.backend` because the client must not be trusted for it (`:117-130`).
  - `app/lib/libraryClient.ts` — browser face (`fetchIndex`, `assetFileUrl`, `saveAsset`, `deleteAsset`). The UI never hand-builds a URL; `assetFileUrl` returns a **same-origin** URL so stored PNGs can be drawn into a canvas without tainting it (`:38-41`).
  - `app/lib/libraryCollect.ts` — pure studio-state → payload translation with an exhaustive switch (the `never` assignment in `default` is the guard, `:9-12`).
- Pattern: ports/adapters. `library.ts` is the adapter over `node:fs`; the route, the browser client, the panel and the CLI are all ports onto it.

**Studio mode registry:**
- Purpose: one union names the five-to-six workspaces and their persistence.
- Examples: `Mode = 'extender' | 'parallax' | 'tile' | 'sprite' | 'props' | 'pixel'` (`app/lib/app.ts:71`).
- Pattern: discriminated union + a render branch in `page.tsx`, not a plugin registry.

**Wire contract (`GenerateKind`):**
- Purpose: name the request kind once on each side of the boundary.
- Examples: `GenerateRequest`/`GenerateBody`/`toWire`/`generateKind` (`app/lib/generateRequest.ts:13-95`).
- Pattern: the wire stays a bag of flags on purpose — `docs/agent-api.md` documents that shape and raw `curl` callers send it.

**Pose rig:**
- Purpose: deterministic, code-authored motion that the image model only *skins*, instead of asking a diffusion model to invent biomechanics.
- Examples: `app/utils/poseRig.ts:38` (`RIGS: Record<BodyPlanId, SpriteRig>`), `app/utils/rigs/*.ts`, `app/lib/bodyPlans.ts`.
- Pattern: dispatch table over body plans, shared primitives in `app/utils/rigCore.ts`.

## Entry Points

**Web page:**
- Location: `app/page.tsx:33` (`Home()`), wrapped by `app/layout.tsx:18-29`.
- Triggers: the Next dev server / `next start`.
- Responsibilities: hold all studio state, orchestrate calls, build manifests, render one studio.

**HTTP routes (`app/api/<name>/route.ts`):**
- Triggers: `fetch` from the browser studios, or `curl`/the CLI.
- Responsibilities: validate, resolve model + credentials, dispatch, translate the reply.
- Routes: `generate`, `extend`, `scene-brief`, `prop-brief`, `tile-review`, `sprite-review`, `providers`, `pixel`, `library`.

**Headless CLI:**
- Location: `cli/ie.mjs` (bin `ie`, `package.json:5-7`); per-command specs in `cli/commands/*.mjs` exported as `default { name: spec }` and collected by `COMMAND_MODULES` (`cli/ie.mjs:23-30`).
- Triggers: `ie <command>` / `npm run ie`.
- Responsibilities: resolve config once, ensure a dev server, drive routes and the bridge, write files + a manifest, optionally save to the library.

**Bridge process:**
- Location: `cli/native/bridge.mjs` (spawned from `cli/lib/bridge.mjs:18`).
- Triggers: one JSON job spec on stdin.
- Responsibilities: bundle the app's pixel modules, launch headless Chromium, run the op, return one JSON result. No network, no API keys (`cli/native/bridge.mjs:12-14`).

## Error Handling

**Strategy:** typed failures at each boundary, translated outward — never a generic `catch` that loses the cause.

**Patterns:**
- **Image failures carry a reason.** `ImageFailure.reason: 'credentials' | 'size' | 'gateway' | 'no-image'` (`app/lib/imageGeneration.ts:32-39`) drives the 401/400/502 status the route returns.
- **Routes:** `try/catch` at handler level → `{ error }` + status; 401 means credential/unknown profile, 400 bad input, 4xx/5xx upstream (`docs/agent-api.md:127`). The vendor's own words are passed through for `/api/pixel` — no invented shape (`app/api/pixel/route.ts:27-32`).
- **Client:** `studioRequest` turns a non-2xx into an `ApiError` with the route's message and status; `on401` opens the key modal (`app/lib/studioRequest.ts:27-39`).
- **Library:** `LibraryError` with `code: 'EEXISTS' | 'ENOTFOUND'` maps to 409/404; fs-unusable errno codes (`EACCES`, `ENOSPC`, …) map to 500 with the reason; everything else is a 400 (`app/api/library/[...]/route.ts:18-19`, `:132-142`).
- **CLI:** `CliError`/`UsageError` → `{ ok: false, error: { code, message, detail } }`, exit 1 (runtime) or 2 (usage) (`cli/lib/args.mjs:12-29`, `cli/ie.mjs:184-189`). A bridge failure throws immediately so a command never continues on a broken image (`cli/lib/bridge.mjs:36-41`).
- **Critics fail open.** A QA route that fails to answer is treated as approval by the UI — a flaky vision model must never block a generation (`docs/agent-api.md:194-196`).
- **Degrade, don't block.** An unusable asset library reports "library unavailable" in the panel; generation keeps working.

## Cross-Cutting Concerns

**Logging:**
- `console.error` inside route handlers with the route name (`app/api/generate/route.ts:188`); no logging library.
- CLI progress goes to **stderr** so stdout stays a single parseable object (`cli/ie.mjs:10-12`, `:164-166`).

**Validation:**
- Hand-rolled guards at each boundary, no schema library: `isValidName`/`isValidRelPath`/`assertInsideRoot` (`app/lib/libraryPath.ts`), `isProviderId` (`app/lib/providers.ts:49`), `isDirection` (`app/lib/extendPrompt.ts`), `generateKind` (`app/lib/generateRequest.ts:86`), `isPixelOp` (`app/lib/pixel.ts:14`).
- The CLI's config file validator is the same one the server runs — "a file that loads is a file the server accepts" (`docs/agent-api.md:85-94`, `app/lib/ieConfig.ts`).

**Credentials / authentication:**
- BYOK only. Key precedence: request body → profile (`apiKeyEnv` env var, else inline) → provider env var (`app/lib/llmServer.ts:89-91`).
- The server never persists a key; the browser keeps one per gateway in `localStorage` (`app/lib/app.ts:57-64`).
- Path safety is the library's only "auth": a local, single-user tool with an explicit, documented threat model.

**Internationalization:**
- Every user-visible string goes through `t()`; `app/i18n/serverErrors.ts` maps app-authored English error text back onto keys, while third-party gateway text is passed through untranslated (`:8-11`).
- Locale is UI state, not routing: persisted in `localStorage`, applied to `<html lang>` and the document title (`app/lib/i18n.tsx:47-70`).

**Testing:**
- `vitest` over colocated `app/**/__tests__/**/*.test.ts` and `cli/**/__tests__/**/*.test.mjs` (`vitest.config.ts:13`), plus a separate `node:test` Chromium smoke suite for the bridge (`package.json:40`) and Playwright + Midscene E2E for UI wiring (`e2e/studio-library.spec.ts:1-11`).

---

*Architecture analysis: 2026-10-06*
*Update when major patterns change*
