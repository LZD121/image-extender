# Codebase Concerns

**Analysis Date:** 2026-10-06

Ordered by impact: what breaks a user, then what silently corrupts recorded facts, then what blocks a maintainer.

## Tech Debt

**`app/page.tsx` — one 3,992-line component owns every studio:**
- Issue: `Home()` is the only client component; every studio's state, orchestration and export plumbing lives inline in it.
- Files: `app/page.tsx:33` (`export default function Home()`), `:670` `runExtend`, `:1358` `handleGenerateTileSet` (215 lines), `:2383` `runSpriteSheetPass` (153), `:2035` `handleAddPropBatch` (146).
- Evidence of size: 54 `useState`, 15 `useCallback`, 12 `useEffect`, 7 `useRef`, 71 canvas/`toDataURL` call sites, 32 imported lines pulling ~120 named exports from `app/lib/*` and `app/utils/*`.
- Why: each studio was added mode-by-mode; the extraction plan was executed only in part (see next item).
- Impact: any studio change re-reads a 4k-line file; state added for one mode can collide with another (`mode === 'parallax' && activeLayer` guards are scattered, `app/page.tsx:3960-3985`).
- Fix approach: the manifest/export cluster is the cheapest first cut — `buildTileSetManifest` (`app/page.tsx:1706`), `buildPropManifest` (`:1951`), `buildSpriteManifest` (`:3092`) are pure state→JSON functions with exactly one caller each, i.e. the same shape as the already-extracted `app/lib/libraryCollect.ts`. Move them to `app/lib/manifest*.ts` and let the CLI import them instead of re-deriving layout from constants.

**In-flight refactor is merged, but three of its seven candidates were explicitly deferred:**
- Issue: `.omp/plans/DEEPEN_IMAGE_EXTENDERS_GATEWAY_PLAN.md` (untracked but on disk) names four candidates executed and three left out: "2 image-generation dispatch, 5 studio chrome/export plumbing, 7 CLI-imports-app-constants … stay out".
- Evidence: `feat/deepen-modules` (`f4a1290`) is an ancestor of `main` (`ffbf230`) — the branch is fully merged, so nothing is pending there. `worktree/brave-field-78d0`, `worktree/green-meadow-2aeb` are likewise already-merged refs with no worktrees left (`git worktree list` shows only the main checkout).
- Impact: candidate 5 is exactly the `page.tsx` export cluster above; candidates 2/7 explain why `app/lib/imageGeneration.ts:150-154` still has an adapter table while the CLI re-bundles app modules through esbuild (`cli/native/bundle.mjs:63`).
- Fix approach: treat the plan as the backlog, not as a running process; re-open it as GSD phases rather than keeping an untracked `.omp/plans/` document as the source of truth.

**Provenance `backend` means two different things depending on who wrote the asset:**
- Issue: the HTTP path stamps `backend` from a two-value allow-list; the CLI path writes it straight to disk without that route.
- Files: `app/lib/libraryCollect.ts:20` (`BACKEND_LABELS = ['openrouter','pixellab']`), `app/api/library/[[...path]]/route.ts:33-35` (unknown value → `'openrouter'`), `:128` (`IE_BACKEND_LABEL || pickBackendLabel(...)`), `cli/commands/studio.mjs:47-55` (`resolvedBackend` returns `profile.provider`), `:91-107` (`saveToLibrary` calls `lib.saveAsset` directly, bypassing the route), `cli/commands/library.mjs:166` (hardcodes `backend: 'openrouter'`).
- Why: `BACKEND_LABELS` was widened for the pixel line (`docs/superpowers/plans/2026-10-05-pixel-art-line.md:1685-1689`) but the provider table already had three ids — `PROVIDER_IDS = ['openrouter','magpie','apimart']` (`app/lib/providers.ts:11`, `:42`).
- Impact: an APIMart or Magpie generation saved through the web UI records `backend: "openrouter"` — the falsifiable version of the library spec's success criterion "后端可追溯" (`docs/superpowers/specs/2026-10-05-fork-design.md:34`). A CLI-saved asset of the same generation can record `"apimart"`. Two readers of `meta.json` cannot tell which convention they are reading.
- Fix approach: one enum — `type BackendLabel = ProviderId | 'pixellab'` in `app/lib/libraryTypes.ts`, derived in `libraryCollect.ts`, used by both the route allow-list and the CLI. Do not invent a second table.

**`Provenance.cost` and `Provenance.requested` are dead fields on the web path:**
- Issue: the value is produced by `/api/generate` and then dropped.
- Files: `app/api/generate/route.ts:182` (returns `cost`), `app/lib/imageGeneration.ts:105` (`extractCost`), `app/lib/libraryCollect.ts:112-188` (`collectStudioAsset` has no cost input), `app/page.tsx:1985-2029` (the collector calls pass no `cost`), `app/lib/libraryCollect.ts:100` (`requested ?? null`), README.md:562 admits it: "`provenance.cost` is reserved but currently always `null`".
- Impact: the library cannot answer "what did this project cost" — one of the four stated success criteria of the asset library. `requested` is null for every web-saved asset while the CLI populates it (`cli/commands/studio.mjs:416`, `:558`, `:675`) and the Pixel studio does too (`app/components/PixelStudio.tsx:434`), so request-vs-returned drift (the failure mode the field exists for) is invisible for the five main studios.
- Fix approach: thread `cost` from the generate response into the studio's state (a single `setLastCost` beside the existing `selectedModel` state) and pass it into the collector; have each studio pass its request size. Both are field-plumbing, no new module.

**The pixel line's purity number is displayed but decides nothing, and the plan still contains the deleted gate:**
- Issue: `PURITY_THRESHOLD` and the "apply anyway" button were deleted as a tautology; three revisions are recorded as falsified.
- Files: `docs/superpowers/specs/2026-10-05-pixel-art-line-design.md:174-186` (threshold 0.95 → 0.15 → none; five measured points `0.0476 / 0.0927 / 0.1494 / 0.2305 / 0.4766`), `app/utils/pixelGrid.ts:156-165` (documented as "purely informational … cannot be a gate"), `app/components/PixelStudio.tsx:440-446` ("Purity is reported, never gated"), `cli/commands/pixel.mjs:178` (reads `analysis.grid`).
- Impact: the shipped code is right, but `docs/superpowers/plans/2026-10-05-pixel-art-line.md:704-743` still shows executable `expect(res.purity).toBeLessThan(PURITY_THRESHOLD)` code for Tasks 5/8 — a reader who runs the plan re-introduces the gate. The plan warns at lines 15-26, but the stale blocks are 900 lines below the warning. Separately, `pixel.cell.purity` is user-visible chrome (`app/i18n/messages/pixel.ts:37`, `:162`) for a number with no decision attached.
- Fix approach: mark the superseded plan blocks inline (a `> SUPERSEDED — see spec §7.3` line above each), or drop the plan from `docs/` once the design doc carries the conclusion. Then decide: label the number as diagnostic in the UI (`pixel.cell.purity` → "grid fit (diagnostic)") or delete the readout.

**No CI: nothing runs the 33 test files automatically:**
- Issue: no `.github/` directory exists; `package.json:30-41` has the scripts but nothing invokes them. No `husky`/`lint-staged` either.
- Impact: `npm test` (vitest, `app/**/__tests__` + `cli/**/__tests__`) and `npm run test:cli` (the Chromium bridge smoke, `cli/native/__tests__/bridge.smoke.test.mjs`) are opt-in. A change to `app/lib/libraryPath.ts` (the security boundary) can land with its tests red.
- Fix approach: a single workflow running `npx tsc --noEmit`, `npm test`, and `npm run test:cli`; `npm run test:ai` stays manual (it needs a live vision gateway, `playwright.config.ts:14-27`).

## Known Bugs

**`extractCost` is unverified against the live provider:**
- Symptoms: `provenance.cost` is `null` for chat-gateway generations even when the gateway reports spend.
- Trigger: generate via OpenRouter or Magpie and save to the library.
- Root cause: `app/lib/generateCost.ts:7` says so plainly — "unverified against the real provider (no key on this machine) — purely defensive". The function only understands `usage.cost`; APIMart's `cost` field is read separately in `app/lib/apimartServer.ts:167-170`.
- Workaround: cost is always `null`, so nothing downstream is wrong, only missing.
- Fix: one real call with a key, then assert the shape in `app/lib/__tests__/generateCost.test.ts` (which exists but can only test the fallback).

**Web-saved provenance silently records the wrong backend:**
- Symptoms: `assets/<p>/<kind>/<slug>/meta.json` shows `"backend": "openrouter"` for a generation that went through APIMart or Magpie.
- Trigger: Settings → Gateway → APIMart (or Magpie), generate, Save to library.
- Root cause: client-side label is not in `BACKEND_LABELS`, so `pickBackendLabel` returns the fallback (`app/api/library/[[...path]]/route.ts:34`).
- Workaround: set `IE_BACKEND_LABEL` in `.env` for the whole server session (documented at `.env.example:31-34`) — all-or-nothing, not per-asset.
- Fix: widen the allow-list to `ProviderId | 'pixellab'` as above.

## Security Considerations

**The dev server has no bind restriction, no auth, and a server-side key fallback:**
- Risk: `next dev` binds all interfaces by default and the CLI spawns it without `-H`/`--hostname` (`cli/lib/server.mjs:68-73`, `env: process.env`). On a LAN with no `middleware.ts` and no CSP (`next.config.js` is 6 lines), any peer can call `/api/library` (list, read any file under the assets root, save, delete), any `/api/generate`, and `/api/pixel` — and `app/lib/llmServer.ts:91` falls back to `process.env[provider.keyEnv]` when the request carries no key, so a peer without a key can spend the operator's OpenRouter/APIMart budget.
- Current mitigation: the design declares the local-server assumption (`docs/superpowers/specs/2026-10-05-fork-design.md:188`: "app 保持本地运行假设 … 本设计**不**提供任何远程访问加固"); the browser panel's copy tells the user the key never leaves the machine (`app/i18n/messages/modals.ts:112`).
- Recommendations: bind explicitly (`next dev -H 127.0.0.1`) in `cli/lib/server.mjs:68` and in the `dev` script; add an `Origin`/`Host` check in a `middleware.ts` for `/api/*`; make the env-key fallback opt-in via an explicit `IE_ALLOW_ENV_KEY=1` rather than always-on.

**Asset-library path validation deliberately does not resolve symlinks:**
- Risk: a symlinked directory inside `IE_ASSETS_DIR` lets library operations read/write outside the root.
- Files: `app/lib/libraryPath.ts:4-12` (states the threat model and the omission), `:31-36` (`assertInsideRoot` is a `path.resolve` prefix check only), `docs/superpowers/specs/2026-10-05-fork-design.md:185` (accepted risk for a local single-user tool).
- Current mitigation: name/kind/relpath regexes (`app/lib/libraryPath.ts:14-16`), per-asset prefix assertions in `saveAsset` (`app/lib/library.ts:91`), an explicit symlink decision that is written down rather than accidental. `libraryPath.test.ts` (101 lines) covers traversal.
- Recommendations: if the app ever listens beyond loopback, add a `realpath` comparison in `assertInsideRoot` — the change is 3 lines and removes the caveat entirely.

**`/api/pixel?op=image` is an unauthenticated open proxy for `*.pixellab.ai`:**
- Risk: no key required by design (comment at `app/api/pixel/route.ts:128-131`), no response size cap, no timeout on the upstream fetch (`app/api/pixel/route.ts:165-170`).
- Current mitigation: `https:` only, host allow-list with a dot-anchored suffix check (`app/lib/pixel.ts:55`, `route.ts:161-163`), tests cover non-vendor hosts and non-https (`app/api/pixel/__tests__/route.test.ts:58-67`).
- Recommendations: cap the proxied body (the vendor's own images are hundreds of KB) and add an `AbortSignal.timeout(...)`; both are one-liners and close the "peer on the LAN uses you as a bandwidth relay" case.

**BYOK keys live in `localStorage` and ride in request bodies:**
- Risk: any XSS on the origin exfiltrates every gateway key at once; there is no CSP to blunt it.
- Files: `app/lib/app.ts:41-64` (`extender:api_key[:provider]`), `app/lib/pixel.ts:57-76` (`extender:pixelKey`), `app/lib/llmServer.ts:84-91` (key arrives in the body or env).
- Current mitigation: keys are never persisted server-side and never logged (README.md:86-88); the CLI chmods its own config to 600 when it holds an inline key (`cli/commands/config.mjs:85`); `maskKey` (`app/lib/models.ts:81`) keeps them out of the UI text.
- Recommendations: add a CSP header (currently absent) — that is the single change that makes the localStorage trade-off defensible.

## Performance Bottlenecks

**Library thumbnails download full-size PNGs with `no-store`, every refresh:**
- Problem: the panel renders `derived[0]` directly as an `<img>` at 40×40 (`app/components/LibraryPanel.tsx:218-229`, URL from `app/lib/libraryClient.ts:37`), and the route sets `cache-control: no-store` (`app/api/library/[[...path]]/route.ts:73`).
- Measurement: shipped tile/sprite/prop cells are 512² (`app/lib/tileset.ts:43`, `app/lib/sprite.ts:27`, `app/lib/props.ts:11`); a noisy 512² PNG measured 901,111 bytes on this machine (sharp, 2026-10-06), and the fork's own sheet measurements are far larger (`docs/superpowers/specs/2026-10-05-fork-design.md:24-26`: 2880² sheet = 5.7 MB, 2048×1024 = 2.6 MB). A 40-asset panel therefore transfers tens of MB per `Refresh`.
- Cause: no thumbnail tier exists; `derived[0]` is the finished 512² asset, not a preview.
- Improvement path: add a `thumb/` subdirectory written by `saveAsset` (the layout already has `raw/` + `derived/`, `app/lib/libraryPath.ts:16`), or serve `?file=` with a `?w=` query that downscales via the already-installed `sharp`. Also give file responses a content-hash `ETag` instead of `no-store`.

**The library index reads every `meta.json` serially — measurable, but not yet a bottleneck:**
- Problem: `listAssets` awaits one `readFile`+`JSON.parse` per asset inside nested loops (`app/lib/library.ts:144-189`).
- Measurement: reproduced against generated trees on this machine (2026-10-06) — 500 assets: 23.9 ms; 2,500 assets: 117.5 ms serial vs 51.0 ms with `Promise.all` per directory. The spec's own trigger was ">500 个资产时 … 若超时，改为按 project 分页或加一层 `index.json` 缓存（**先测再优化，不预先设计**）" (`docs/superpowers/specs/2026-10-05-fork-design.md:238`).
- Cause: serial `await` in the innermost loop; the per-project/per-kind directory walk is already sequential.
- Improvement path: do not build a cache — bound concurrency (`Promise.all` per kind directory) if the list ever exceeds a few thousand assets. `app/lib/__tests__/library.test.ts:104-166` covers the corrupt/orphan paths, so the change is test-protected.

**One 200 MB library POST is buffered whole:**
- Problem: `MAX_TOTAL_CHARS` (`200 MiB` decoded) is checked *after* `await request.json()` has materialized the body (`app/api/library/[[...path]]/route.ts:14-16`, `:98`, `:114-115`; the comment admits the ordering).
- Measurement: one 4096² sheet is ~11 MB as binary ≈ 14.9 M base64 characters (`docs/superpowers/specs/2026-10-05-fork-design.md:24-26`); a 13-tile set with a raw sheet plus 13 derived files lands in the tens of MB per save, and the route holds the JSON string plus the decoded buffers simultaneously.
- Cause: single-request save, chosen deliberately (`docs/superpowers/specs/2026-10-05-fork-design.md:145`).
- Improvement path: split into "create directories → PUT one file each" if a save ever OOMs; the CLI already proves the shape works file-by-file against `lib.saveAsset` (`cli/commands/studio.mjs:91-107`).

## Fragile Areas

**`app/utils/imageProcessor.ts` — 3,430 lines, no unit test:**
- Why fragile: ~35 exported functions doing the pixel work the product is sold on (Poisson blending, chroma key, slicing, tileability, sprite alignment); nothing in `app/utils/__tests__/` except `pixelGrid.test.ts`.
- Common failures: a changed option name or export silently breaks only at generation time, after money is spent.
- Safe modification: run `npm run test:cli` first — `cli/native/__tests__/bridge.smoke.test.mjs` executes the real functions in headless Chromium and is the de-facto regression net; note it is NOT part of `npm test` (`vitest.config.ts:11-12` excludes `cli/native/__tests__`).
- Test coverage: only via the bridge smoke; no per-function assertions, no golden-image comparison.

**The CLI can only spend money through a live `next dev`:**
- Why fragile: `ensureServer` spawns `next` detached and records pid/port in `.ie/server.json` (`cli/lib/server.mjs:59-113`), then polls for readiness with a 90s deadline; a port collision walks the range (`:52-57`).
- Common failures: `server_timeout` when a stale pid file points at a dead process, or when the chosen port is taken by something that answers on `/` but not the API.
- Safe modification: pass `--base-url`/`IE_BASE_URL` to reuse a server you started yourself (documented, `docs/agent-api.md:360`); never edit `.ie/server.json` by hand.
- Test coverage: `cli/lib/__tests__/args.test.mjs` only; the server lifecycle is untested.

**Headless-Chromium bridge: environment-shaped dependency:**
- Why fragile: `findChromium` scans `~/Library/Caches/ms-playwright` and `~/.cache/ms-playwright` for five possible binary paths and picks the highest revision (`cli/native/deps.mjs:32-63`); the esbuild bundle is cached by directory mtime over all of `app/utils` + `app/lib` (`cli/native/bundle.mjs:22-40`).
- Common failures: no Playwright browser installed (`CHROMIUM_INSTALL_HINT`, `cli/native/deps.mjs:25`); a stale bundle when an mtime is preserved by a checkout/copy; a `sharp`-vs-canvas round-trip mismatch when the CLI re-encodes what the browser produced (`cli/lib/media.mjs`).
- Safe modification: after pulling, delete `.ie/cache/`; verify with `node cli/ie.mjs doctor --json` (`cli/commands/core.mjs:99-102` reports `chromium` and bundle state).
- Test coverage: `cli/native/__tests__/bridge.smoke.test.mjs` (168 lines, needs Chromium) — good coverage of the ops, but it is a separate command for a reason.

**AI e2e suite depends on a live model at a hardcoded local endpoint:**
- Why fragile: `playwright.config.ts:17-27` loads `.env.midscene` (present, gitignored, 959 bytes) and the suite drives a real vision model to localize elements; the config also creates a fresh temp `IE_ASSETS_DIR` per run (`:31-32`) and runs one worker on port 3311 with `reuseExistingServer: false` (`:41-56`).
- Common failures: Midscene needs a model *and* a matching `MIDSCENE_MODEL_FAMILY` adapter (`.env.midscene.example:12-20` names `qwen3` as the verified one) — a model swap without the family swap fails as "no element found", not as a config error. A busy port 3311 fails the run outright.
- Safe modification: verify any config with `npx @midscene/cli model verify` before blaming the app; keep structural assertions as plain locators (the suite already does, `e2e/studio-library.spec.ts:7-12`).
- Test coverage: 5 specs (`e2e/studio-library.spec.ts`), covering panel duplication, the tile-mode load refusal, cross-studio project rename, keyless first run, and the generate-dialog gate.

## Scaling Limits

**Asset library index and git repository:**
- Current capacity: 500 assets measured at 23.9 ms for a full index (this machine, 2026-10-06); `assets/` is currently empty in the working tree.
- Limit: the index stays cheap well past 2,500 assets (117.5 ms measured, serial); the real limit is repository size.
- Symptoms at limit: `git pull` becomes slow; PNG deltas are unreadable (`.gitattributes` is one line: `*.png -diff`).
- Scaling path: `raw/` is already excluded from version control (`.gitignore`, `docs/superpowers/specs/2026-10-05-fork-design.md:225`); the documented next step is git-lfs above ~500 MB (`:239`) — deliberately not taken yet.

**Single dev-server process per repo:**
- Current capacity: one `next dev` serving the browser studios, the CLI's HTTP calls and the Playwright suite.
- Limit: the e2e suite refuses to reuse an existing server (`playwright.config.ts:53`) and needs port 3311 free.
- Symptoms at limit: `server_timeout` from the CLI, or `webServer` failure in Playwright.
- Scaling path: the CLI already supports `IE_BASE_URL`; give Playwright its own port range.

## Dependencies at Risk

**`sharp` is used only by the CLI and its test, never by the app:**
- Risk: it is a native binary in `devDependencies` (`package.json:58`) with three consumers — `cli/lib/media.mjs`, `cli/commands/pixel.mjs`, `cli/native/__tests__/bridge.smoke.test.mjs`. A prebuilt-binary gap on a new platform breaks the CLI and the bridge smoke while the app keeps working, which makes it look like an app bug.
- Impact: `npm run test:cli` and pixel-command output.
- Migration plan: none needed app-side; if a platform lacks a prebuild, swap the test fixture generation for canvas-in-browser work, which the bridge already provides.

**Playwright/Midscene version drift:**
- Risk: `@playwright/test` and `playwright-core` are both pinned at `^1.63.0` (`package.json:50,56`) while `@midscene/web` is `^1.14.0` (`:49`) and ships its own Playwright reporter (`playwright.config.ts:43`). `findChromium` also depends on Playwright's cache directory layout (`cli/native/deps.mjs:35-56`).
- Impact: a Playwright major bump can break both the AI suite and the headless pixel path at once, and the cache-path scan is version-shape-sensitive.
- Migration plan: verify with `node cli/ie.mjs doctor --json` and `npm run test:ai` after any bump; `IE_CHROMIUM` is the escape hatch (`cli/native/deps.mjs:28-33`).

**OpenRouter is still the only provider with a curated model table:**
- Risk: `MODELS` (`app/lib/models.ts:44-71`) is hand-maintained and verified by construction; the other two gateways rely on probed lists (`app/lib/providers.ts:109-189`, measured 2026-10-06). An OpenRouter model rename silently degrades timing heuristics (`timingFor`, `app/lib/models.ts:26-34`) and the art-director skip rule (`skipsArtDirectorReview`, `:75-77`).
- Impact: best-of-N counts, ETAs, and whether a vision critic runs at all.
- Migration plan: extend the probe (`app/lib/providerProbe.ts`) to OpenRouter and treat the table as a curated default rather than the only source.

## Missing Critical Features

**Sprite QA is unreachable: the route exists, nothing calls it:**
- Problem: `/api/sprite-review` (79 lines) is fully wired — rubric in `app/lib/qaRubric.ts:48` (`buildSpriteReviewPrompt`), images, verdict translation — but no caller: the only references outside the route are `app/page.tsx:2709-2711` explaining the removal and `README.md:675` / `docs/agent-api.md:136` documenting it as live.
- Current workaround: sprite defects are caught by deterministic pixel checks instead (twin/spillover detector, scale normalization, baseline grounding — README.md:294-297).
- Blocks: the documented API surface is wrong for agents (`docs/agent-api.md:136`, `:191-195` advertise it with no caveat); the lib branch `buildSpriteReviewPrompt` is reachable only by hand.
- Implementation complexity: Low — either delete the route + its rubric branch + the doc rows (the honest cut, matching commit `4a8d674`), or add the toggle the comment implies ("stays reachable for anyone who wants it" today means curl only).

**No CI (see Tech Debt) blocks every other gate in this document.**

**`requested`/`cost` provenance, and the `extender`/`parallax` manifests:**
- Problem: `collectStudioAsset` passes `manifest: null` for extender and parallax (`app/page.tsx:2018`, `:2029`) while tiles/props/sprite build one; `README.md` advertises a `parallax.json` manifest for ZIP export only.
- Impact: library-loaded parallax assets carry no depth/scroll-speed metadata, so `Load` cannot restore a parallax project — it restores one image.
- Implementation complexity: Medium (the ZIP path already computes the shape; it needs to be lifted into `app/lib` and reused, same cut as the manifest tech-debt item).

## Test Coverage Gaps

**`app/utils/imageProcessor.ts` (3,430 lines):**
- What's not tested: every exported transform except through the bridge smoke's composite ops.
- Risk: a silent regression in chroma key, slicing or seam blending ships to users; the CLI catches some of it only when someone runs `npm run test:cli`.
- Priority: High
- Difficulty to test: the functions need a DOM canvas and real PNG fixtures; the bridge already provides the runner, so the gap is assertions, not infrastructure.

**Studio data modules — `app/lib/tileset.ts` (1,006 lines), `sprite.ts` (441), `bodyPlans.ts` (345), `props.ts` (168), `parallax.ts` (183):**
- What's not tested: the layout math, animation tables and preset tables are exercised only indirectly, by `app/i18n/__tests__/messages.test.ts` asserting that every id has a translation and `app/lib/__tests__/chromaPresets.test.ts` importing `TILESET_BY_ROLE`.
- Risk: a changed grid constant (`TILESET_TILE_SIZE`, `app/lib/tileset.ts:43`; `SPRITE_FRAME_SIZE`, `app/lib/sprite.ts:27`) desynchronises the manifest from the exported sheet with no failing test.
- Priority: High
- Difficulty to test: pure functions with pure inputs — this is the easiest gap in the repo to close.

**Sprite pose rigs — `app/utils/rigs/{biped,quadruped,serpent,flyer,blob}.ts` + `rigCore.ts` (1,100+ lines):**
- What's not tested: rig geometry output.
- Risk: a rig that draws overlapping limbs or a wrong gait still produces "valid" images, so failures look like model quality problems.
- Priority: Medium
- Difficulty to test: needs a headless canvas; the bridge pattern applies, and a bbox/alpha-coverage assertion would catch most regressions.

**Untested routes: `app/api/extend/route.ts` (112 lines, called from `app/page.tsx:696`), `app/api/prop-brief/route.ts` (83), `app/api/sprite-review/route.ts` (79):**
- Risk: `/api/extend` is a live user path with no test, while its sibling `/api/generate` has `styleInjection.test.ts`.
- Priority: Medium
- Difficulty to test: low — `app/api/tile-review/__tests__/tileReview.test.ts` already shows the pattern (construct a `NextRequest`, call `POST`).

**Web-path provenance correctness:**
- What's not tested: that a web save of an APIMart/Magpie generation records the true backend, or that `cost` ever arrives.
- Risk: the library's traceability claim degrades silently — exactly what happened (`route.test.ts:88-126` tests the allow-list mechanics, not the semantic).
- Priority: Medium (becomes High once the label enum is widened)
- Difficulty to test: an assertion on `buildAssetMeta` + the route's stamping is enough; no gateway needed.

---

*Concerns audit: 2026-10-06*
*Update as issues are fixed or new ones discovered*
