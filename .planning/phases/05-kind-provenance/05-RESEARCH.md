# Phase 5 — Research

**Phase:** 05-kind-provenance
**Researcher role:** `gsd-phase-researcher` (ran on `commandcode/Qwen/Qwen3.7-Plus` — the configured `opencode-go/deepseek-v4-flash` route returns 403 on this machine; default inherited route is 429-quota-blocked)
**Date:** 2026-10-08
**Stance:** read-only; every claim cites `file:line` plus the command that produced it; anything not directly observed is marked `[INFERENCE]`.

---

## 1. The payload limit

### Findings

The library route enforces **two** caps, both on the base64 *character count* of the JSON body, and both are checked **after** `await request.json()` has buffered the whole request:

- **Per-file cap** `MAX_FILE_CHARS = Math.ceil((40 * 1024 * 1024 * 4) / 3) + 256` ≈ **55.9 M chars** ≈ 40 MiB decoded. `app/api/library/[[...path]]/route.ts:12`, applied at `:111`.
- **Total cap** `MAX_TOTAL_CHARS = Math.ceil((200 * 1024 * 1024 * 4) / 3) + 1024` ≈ **279.6 M chars** ≈ 200 MiB decoded. `app/api/library/[[...path]]/route.ts:15`, applied at `:113-114` (`return bad('payload too large', 413)`).

There is **no** Next.js-level override: `next.config.ts` is empty (the grep for `bodyParser|maxBodySize|bodySize|maxDuration` in `next.config*` returned nothing), and the route file declares only `runtime: 'nodejs'` and `dynamic: 'force-dynamic'` (`route.ts:7-8`). The Next.js default body limit (1 MiB for App Router) is therefore in force — but the route's own arithmetic is what the spec and the codebase quote, so the operational ceiling is the 279.6 M chars figure.

Command:
```
grep -n "bodyParser\|maxBodySize\|body-size\|bodySize\|maxDuration\|size.limit\|api.bodyParser" next.config* app/api/library
# (no output)
```

### Arithmetic for a 16-strip set

Measured on the consumer's real output (`.planning/research/PITFALLS.md:22`, `ARCHITECTURE.md:290`, `STACK.md:465`):

- One 8-direction raw strip = `11712×1408`, **17,055,535 bytes** (≈ 17 MB).
- 16 raws = **272.9 MB decoded** → base64 = **363.8 M chars**.
- 363.8 M chars > 279.6 M chars `MAX_TOTAL_CHARS` → **413**, and only *after* `await request.json()` has buffered the body (spec §5.4 / `route.ts:97`).

The per-file cap is also breached: 17 MB → 22.7 M base64 chars, well under the 55.9 M per-file cap, so a single raw *would* pass the per-file check. The rejection is the **total** cap.

For the **derived-only** shape this phase actually ships (`derived/*.png` + `set.json` + `meta.json`): measured derived frames are ~441 KB each (`ARCHITECTURE.md:290`); 128 frames ≈ **54 MB decoded** ≈ **72 M base64 chars**, plus a few KB for `set.json`/`meta.json`. That is ~26% of the total cap — comfortably inside.

### Pitfalls

- The 413 is a *post-buffer* rejection. A client that sends 16 raws pays the network cost and the server pays the parse cost before the 413 fires. That is exactly the failure mode D-48 wants to make structural rather than runtime-policed.
- Next.js's own default body limit (1 MiB) is not configured away; the route's 279.6 M figure is what the codebase actually quotes and what the spec's R5 cites. Treat the Next.js default as a latent hazard only if a future deploy changes the route's `runtime`/config — not as a current blocker.

### Assumptions / Open questions

- `[INFERENCE]` I did not run a real POST with 363.8 M chars to confirm the 413 fires at the route's check and not earlier at a reverse proxy. The arithmetic is reproduced verbatim from `.planning/research/PITFALLS.md:22` and `ARCHITECTURE.md:290`, which both describe the same measurement.
- `[INFERENCE]` `set.json` for a 16-strip set is a few KB (the spec's example at `docs/superpowers/specs/2026-10-06-animation-set-production-design.md:140-159` is ~1 KB of JSON). No live `set.json` exists in the repo to weigh (the `find . -name "set.json"` search returned nothing outside `node_modules`).

---

## 2. Multi-file atomicity of `saveAsset`

### Findings

`saveAsset` (`app/lib/library.ts:65-117`) writes into a **sibling temp directory**, then does a single atomic `rename`:

1. `:78-81` — every `rel` key is validated with `isValidRelPath` **before** any disk I/O.
2. `:84` — every data URL is decoded into memory **before** any disk I/O ("so a bad payload cannot leave a stray temp directory behind").
3. `:86` — `tmp = <dir>.tmp-<pid>-<ts>` (a sibling of the final dir, not inside it).
4. `:88-94` — `mkdir tmp` + per-file `mkdir -p` + `writeFile`. Each file lands in `tmp/<rel>`.
5. `:95` — `meta.json` is written **inside** `tmp/`.
6. `:99-111` — overwrite path: existing `dir` is renamed to `<dir>.old-<pid>-<ts>`, then `tmp → dir`, then the `.old` is removed. If the `tmp → dir` rename fails and a move happened, the `.old` is restored (`:107-109`).
7. `:112-114` — any throw in the try-block removes `tmp` recursively.

The on-disk invariant: at any moment, `<root>/<project>/<kind>/<slug>/` is either the **old** asset, the **new** asset, or absent (only during the `tmp → dir` rename window, which is atomic on the same filesystem). A crash mid-write leaves either the old asset untouched or the new asset fully in place; the `.tmp-*` sibling is the only possible leftover, and `listAssets` reports it via `ORPHAN_RE` (`library.ts:26`, `:162-166`) rather than listing it as an asset.

### What this means for a 16-file set

`saveAsset` does not know or care how many files are in `files`: it iterates `Object.entries(files)` and writes them all into the same `tmp/`. A set with 16 `derived/*.png` + `set.json` (as a file entry) + `meta.json` (written at `:95`) is **the same code path** as today's 1–2 file kinds. There is no per-kind branching and no transaction log.

Partial-failure modes:
- **Bad data URL** (corrupt base64, wrong prefix): caught at `:84` before any disk I/O → no leftover.
- **Disk full / write error mid-loop**: the `catch` at `:112-114` removes `tmp/` recursively. The existing asset (if any) is untouched because the `dir → .old` rename at `:102` has not happened yet.
- **Rename `tmp → dir` fails after `dir → .old` succeeded**: `:107-109` restores the `.old`.
- **Process killed between `:102` and `:106`**: the old asset is at `.old-*`, the new one is at `.tmp-*`, the canonical path is absent. `listAssets` reports both as orphans (`:162-166`).

### Pitfalls

- `set.json` is **not** currently a file entry in `files` — today's kinds only put `raw/*` and `derived/*` in `files`, and `meta.json` is synthesised by `saveAsset` itself at `:95`. For the new `animations` kind, `set.json` must be added to the `files` map by the caller (CLI or collector); `isValidRelPath` (`libraryPath.ts:16`) only accepts `raw|derived/<file>` today, so `set.json` at the top level of the asset dir **will be rejected** by the existing regex. This is a real trap — see §7.
- The `meta.json` write at `:95` is unconditional and overwrites any `meta.json` that might have been in `files`. That is fine today because no caller puts `meta.json` in `files`; it would be a silent bug if a future caller did.

### Assumptions / Open questions

- None on this question — the code path is fully observed.

---

## 3. The index / listing / read / delete path

### Findings

**`saveAsset`** (`app/lib/library.ts:65-117`) — covered in §2. The route handler at `app/api/library/[[...path]]/route.ts:87-144` validates the payload, re-stamps `provenance.backend` from `IE_BACKEND_LABEL` env or the client's value via `pickBackendLabel` (`:32-34`, `:129`), forces `schemaVersion: 1` (`:120`), and maps `EEXISTS` → 409 (`:137`).

**`listAssets`** (`app/lib/library.ts:144-190`) walks `<root>/<project>/<kind>/<slug>/meta.json`. The kind loop at `:155` iterates `ASSET_KINDS` — so adding `'animations'` to `ASSET_KINDS` (`libraryTypes.ts:8`) is **necessary and sufficient** for the new kind to be indexed. No per-kind branching elsewhere in the walker. The `ORPHAN_RE` at `:26` catches `.tmp-*` and `.old-*` siblings and reports them in `warnings` rather than listing them.

**`readMeta` / `readAssetFile`** (`library.ts:119-131`) — pure path resolution + read; kind-agnostic.

**`deleteAsset`** (`library.ts:133-137`) — `rm(dir, { recursive: true, force: true })`. Kind-agnostic; removes the entire `<root>/<project>/<kind>/<slug>/` tree in one call. For a 16-file set this is the same cost as for a 1-file asset.

**Route GET** (`route.ts:43-85`) — serves the index (`/api/library`) or a single file (`?file=<rel>`). The file path is validated by `isValidRelPath` (`:39` → `libraryPath.ts:26-28`).

**Route DELETE** (`route.ts:146-155`) — parses `<project>/<kind>/<slug>`, calls `deleteAsset`, maps "not found" to 404.

**`libraryClient.ts`** (`app/lib/libraryClient.ts`) — browser-side wrapper; `saveAsset` (`:43-58`) POSTs JSON, `fetchIndex` (`:32-36`) GETs the index, `deleteAsset` (`:60-63`) DELETEs. Kind-agnostic.

**`LibraryPanel.tsx`** (`app/components/LibraryPanel.tsx`) — the kind→i18n mapping at `:28-34` is a **literal `Record<AssetKind, string>`**:

```ts
const KIND_KEY: Record<AssetKind, string> = {
  tiles: 'shell.library.kind.tiles',
  sprites: 'shell.library.kind.sprites',
  props: 'shell.library.kind.props',
  parallax: 'shell.library.kind.parallax',
  extend: 'shell.library.kind.extend',
}
```

Adding `'animations'` to `AssetKind` without adding a key here is a **TypeScript compile error** (the `Record` is exhaustive). The i18n keys themselves live in `app/i18n/messages/shell.ts`: en at `:73-77`, zh at `:145-149`. Both en and zh must add `shell.library.kind.animations` — zh missing is a compile error per the project invariant (`05-CONTEXT.md:19`, D-41).

### What a new kind must satisfy

1. `ASSET_KINDS` (`libraryTypes.ts:8`) gains `'animations'`.
2. `KIND_KEY` in `LibraryPanel.tsx:28-34` gains `animations: 'shell.library.kind.animations'`.
3. `app/i18n/messages/shell.ts` gains the key in both en and zh blocks.
4. The collector / CLI must produce a `files` map whose keys all pass `isValidRelPath` (`libraryPath.ts:16`) — i.e. every key must be `raw/<name>` or `derived/<name>` with a 1–8 char extension. **`set.json` at the top level will fail this check.** See §7.
5. `meta.json` is written by `saveAsset` itself; the caller supplies the `AssetMeta` object.

### Pitfalls

- The `Record<AssetKind, …>` exhaustiveness is the safety net D-41 relies on. If a future refactor changes it to `Partial<Record<…>>`, the compile-time guarantee disappears.
- `listAssets` only lists a kind if it has at least one asset (`:185`: `if (assets.length) kinds.push(...)`). An empty `animations/` directory is invisible — not a bug, but worth knowing when debugging a fresh install.

### Assumptions / Open questions

- None on this question.

---

## 4. The collector contract

### Findings

`app/lib/libraryCollect.ts`:

- **`StudioFacts`** (`:26-31`) — the non-guessable facts: `backend: BackendLabel`, optional `requested`, optional `cost: ReportedCost | null`. The docblock at `:19-25` is explicit: "the label used to default to `openrouter` inside the collector, which is how an APIMart save came to record the wrong producer."
- **`CollectedAsset`** (`:33-39`) — the output shape: `kind`, `files: Record<string, string>`, `manifest: Record<string, unknown> | null`, `provenance: Omit<Provenance, 'toolVersion'> & { backend: BackendLabel }`.
- **`StudioPayload`** (`:42-75`) — discriminated union on `mode`: `'tile' | 'props' | 'sprite' | 'extender' | 'parallax'`. The `default` branch at `:199-203` assigns to `never` so adding a mode without handling it is a compile error.
- **`CollectorInput = StudioFacts & StudioPayload`** (`:77`).
- **`buildProvenance`** (`:95-117`) — the one place the provenance shape is authored. Every field is written; absent values become `null` (not `undefined`), so a reader never has to distinguish "absent" from "null".
- **`collectStudioAsset`** (`:129-205`) — the switch. Each branch builds `files` (a `rel → dataUrl` map), picks a `kind`, and fills `provenance.params` with mode-specific counters.
- **`buildAssetMeta`** (`:212-239`) — assembles the on-disk `AssetMeta`. `files.sheet` is derived from the first `raw/` entry (`:230`); `files.derived` is the sorted list of `derived/` entries (`:231-233`). `toolVersion` defaults to `'web'` (`:237`); the CLI overwrites it with `IE_VERSION` (`cli/commands/library.mjs:178`).

### What an `animations` branch must produce

Following the existing pattern, an `animations` branch would:

- Take a `mode: 'animations'` discriminant (or a sibling function with the same signature — D-49 allows either).
- Build `files` with keys like `derived/<state>_f<N>_<dir>.png` (the Phase 2 naming function, per D-42) plus `derived/set.json` (or `set.json` at the top level — see §7 for the trap).
- Set `kind: 'animations'`.
- Fill `provenance.params` with `{ dirs, states, frames, cell, calls, cells, seconds }` per D-47 / LIB-06.
- Set `manifest` to the spec block only (D-46 / LIB-05) — no frame list.

### Browser-studio assumptions in the existing contract

The existing `StudioPayload` variants all assume a **browser studio**:

- `tileSheetDataUrl`, `propAtlasDataUrl`, `imageUrl` — all `dataUrl` strings, i.e. the UI has the image in memory.
- `frames: { imageUrl: string | null }[]` — the UI's per-frame result.
- `prompt`, `model` — the UI's form state.

A CLI-driven set does not have these. It has `set.json` on disk, which contains:

- `backend.provider` / `backend.model` (`app/lib/animSet.ts:380`) — the honest source for `provenance.backend` / `provenance.model` (D-43).
- `strips[].prompt` — the per-strip prompt; the first strip's prompt is the natural choice for `provenance.prompt`.
- `totals.calls` / `totals.cells` / `totals.seconds` — the honest source for `provenance.params.calls/cells/seconds` (D-47).
- `states[].frames` — the per-state frame count; `sum(states.frames)` is `provenance.params.frames`.
- `cell` — `provenance.params.cell`.
- `dirs.order.length` — `provenance.params.dirs`.
- `states.length` — `provenance.params.states`.

The CLI must read `set.json` and synthesize a `CollectorInput` (or call a sibling function directly) — it cannot use the browser-studio shape verbatim.

### Pitfalls

- `buildProvenance` defaults absent values to `null` (`:109-115`). If the CLI passes `cost: undefined` (because `set.json` has no cost field), `buildProvenance` will write `cost: null` — which is the correct D-45 shape. But if the CLI accidentally passes `cost: { usd: 0, source: 'openrouter' }` as a default, it will write a fabricated cost. The CLI must pass `cost: null` or omit it entirely.
- The existing `base` helper at `:120-127` passes `input.requested` and `input.cost` but not `input.returned`. For a set asset, `returned` is not a single canvas size but a per-strip fact already in `set.json.strips[].returned`. The collector branch must decide how to represent this — `[INFERENCE]` the natural choice is `provenance.returned = null` (or a summary like `"11712x1408"` from the first strip) and let the per-strip facts live in `set.json`.

### Assumptions / Open questions

- `[INFERENCE]` The existing collector does not have an `animations` branch, so the exact shape of the `CollectorInput` variant is not observable. The description above is derived from the existing variants and the `set.json` shape at `app/lib/animSet.ts:310-387`.
- `[INFERENCE]` Whether the collector should be a new `mode: 'animations'` branch or a sibling function is a design choice D-49 leaves to the planner. Both are feasible; the compile-time exhaustiveness guard works either way.

---

## 5. `ie library save` today

### Findings

`cli/commands/library.mjs:135-204`:

- `:136` — parses `project`, `kind`, `slug` from positional args via `assetIds(ctx, lib)`.
- `:137-143` — parses `--derived <a.png,b.png>` into a list; requires at least one of `--sheet` or `--derived`.
- `:145-156` — builds the `files` map: `raw/<basename>` from `--sheet`, `derived/<basename>` from each `--derived` entry. Checks for duplicate basenames (`:154`).
- `:157` — validates every `rel` with `checkRel` (which calls `isValidRelPath`).
- **`:162` — `const backendLabel = ctx.flags.backend ?? 'openrouter'`** — the hardcoded default LIB-04 wants removed.
- `:163-165` — validates the label with `lib.isBackendLabel` (which checks against `BACKEND_LABELS`, the one-source-of-truth list at `libraryTypes.ts:25`).
- `:166-176` — calls `lib.buildAssetMeta({ kind, files, manifest: null, provenance: await ctx.provenance({ backend: backendLabel, model: '' }) }, { project, slug })`.
  - **`:173` — `model: ''`** — the model is passed as an empty string. This is because the CLI has no model fact to supply (the operator is importing files they already have, not running a generation), so the provenance's `model` field is a hole. The route's `pickBackendLabel` (`route.ts:32-34`) does the same for `backend` when the client's value is unknown, but for `model` there is no server-side override — the empty string is what gets written.
- `:177` — `--type` overrides `meta.type`.
- `:178` — `meta.provenance.toolVersion = IE_VERSION` (stamps the CLI version, overwriting the `'web'` default from `buildAssetMeta`).
- `:179-191` — `--meta <json>` merges extra fields into `meta` (e.g. `{"manifest":{"type":"dungeon-set"}}`).
- `:193-195` — calls `lib.saveAsset(project, kind, slug, meta, files, { overwrite })`.

### `ctx.provenance` (`cli/lib/context.mjs:43-46`)

```js
async provenance(fields) {
  const { buildProvenance } = await ctx.modules('librarycollect', ['app/lib/libraryCollect'])
  return buildProvenance(fields)
}
```

It is a thin wrapper around `buildProvenance` (`app/lib/libraryCollect.ts:95-117`). The CLI supplies `fields` (at minimum `{ backend, model }`), and `buildProvenance` fills in the rest with `null` defaults.

### What must change for a set-driven save

1. **`:162` — remove the `'openrouter'` default.** D-44 / LIB-04. The CLI must either:
   - Read `backend.provider` from `set.json` (D-43), or
   - Require `--backend <label>` and fail with `ctx.fail('bad_backend', …)` if absent (the shape D-44 describes).
2. **`:173` — `model: ''` must become the real model.** D-43. The CLI must read `backend.model` from `set.json` (which per CR-03 / `04-04-SUMMARY.md:43` is the actual request model, including `--model` overrides).
3. **The `files` map must include `set.json`.** D-42 / LIB-02. The CLI must add `set.json` (and only `derived/*.png` + `set.json`, never `raw/`) to the `files` map. But `isValidRelPath` (`libraryPath.ts:16`) only accepts `raw|derived/<file>` — so `set.json` must either go into `derived/set.json` or the regex must be widened. See §7.
4. **`provenance.params` must be filled from `set.json`.** D-47 / LIB-06. The CLI must read `totals.calls/cells/seconds` and compute `dirs/states/frames/cell` from the spec block.
5. **`manifest` must be the spec block only.** D-46 / LIB-05. The CLI must extract `actor/dirs/cell/states` from `set.json` and pass it as `manifest` (currently `:170` passes `null`).
6. **`cost` must come from the gateway, not a default.** D-45 / LIB-03. `[INFERENCE]` `set.json` does not currently have a `cost` field (the `SetJson` type at `app/lib/animSet.ts:310-327` has no `cost` field), so the CLI must pass `cost: null` unless a future phase adds cost tracking to the ledger.

### Pitfalls

- The `model: ''` at `:173` is a latent bug: any asset saved by the CLI today has an empty `model` field. This is acceptable for the existing kinds (the operator is importing files, not running a generation), but for a set asset the model is a first-class fact (D-43) and must be read from `set.json`.
- The `?? 'openrouter'` at `:162` is the exact lie LIB-04 wants fixed. The docblock at `:159-161` even acknowledges it: "The default keeps the value every existing script already records." That is the historical reason, not a justification.

### Assumptions / Open questions

- `[INFERENCE]` Whether `set.json` should carry a `cost` field is not decided in the locked CONTEXT. D-45 says "cost 报才记" (record only if reported), and the `SetJson` type has no `cost` field today. The natural interpretation is that the CLI passes `cost: null` unless the gateway reported a cost during the run, which would require `ie anim run` to record it in `set.json` — a change not in Phase 5's scope.

---

## 6. The cost shape

### Findings

**`ReportedCost`** (`app/lib/libraryTypes.ts:17`):

```ts
export type ReportedCost = { usd: number; source: string }
```

Two fields: `usd` (the amount) and `source` (the gateway that reported it). The `source` field is a string, not a `BackendLabel` — so there is no compile-time guarantee that `source === backend`.

**Where cost is actually reported:**

- **OpenRouter (magpie chat path)** — `app/lib/generateCost.ts:12-18`: `extractCost(data)` reads `data.usage.cost` (OpenRouter's chat-completions response shape) and returns `{ usd: cost, source: 'openrouter' }` if it is a finite number, else `null`. The docblock at `:3-10` is explicit: "Only OpenRouter's `usage.cost` is understood; anything else yields null so the library records 'unknown' rather than a fabricated number."
- **APIMart** — `app/lib/imageGeneration.ts:137`: `cost: result.cost == null ? null : { usd: result.cost, source: 'apimart' }`. The APIMart adapter returns the cost as a number, and the adapter wraps it with `source: 'apimart'`.
- **PixelLab** — not in the image generation path today. `[INFERENCE]` PixelLab is a separate MCP tool, not a gateway in the `/api/generate` path, so it does not report cost through `ReportedCost`.

**Where cost flows:**

1. `app/lib/imageGeneration.ts:105,137` — the adapter returns `cost: ReportedCost | null`.
2. `app/api/generate/route.ts:122` — the route passes `cost: image.cost` to the client.
3. `app/lib/usePropStudio.ts:290,408`, `useTileStudio.ts:125,283`, `useSpriteStudio.ts:207,262` — the studio hooks receive `cost` from the `/api/generate` response and store it in `lastCost` state.
4. The studio hooks pass `cost` to the collector via `StudioFacts.cost` (`libraryCollect.ts:30`).
5. `buildProvenance` (`libraryCollect.ts:115`) writes `cost: opts.cost ?? null`.

**D-45's assertion** (`05-CONTEXT.md:25`): "`cost` 遵守'报才记'：`ReportedCost | null`，且当 `cost !== null` 时断言 `cost.source === backend`（LIB-03）；`null` 是**合法值**，不是'缺字段'。"

The assertion `cost.source === backend` is **not currently enforced**. The `ReportedCost.source` field is a string, and the `backend` field is a `BackendLabel`. A mismatch (e.g. `cost.source === 'openrouter'` but `backend === 'apimart'`) would compile and run without error. The assertion must be added in Phase 5.

### Pitfalls

- The `source` field is a string, not a `BackendLabel`. If Phase 5 tightens it to `BackendLabel`, the APIMart adapter's `source: 'apimart'` must be checked against `BACKEND_LABELS` (`libraryTypes.ts:25`) — and it is present (`'apimart'` is in `PROVIDER_IDS`, which `BACKEND_LABELS` extends).
- The `extractCost` function at `generateCost.ts:12` hardcodes `source: 'openrouter'`. If the magpie chat path is used with a different upstream (e.g. Teamo via magpie profile), the `source` would still be `'openrouter'` — which is the label of the gateway, not the upstream. This is correct per D-43 (the `backend` is the gateway, not the upstream model).

### Assumptions / Open questions

- `[INFERENCE]` Whether `set.json` should carry a `cost` field is not decided. The `SetJson` type at `app/lib/animSet.ts:310-327` has no `cost` field. If Phase 5 wants to assert `cost.source === backend` for a set asset, the CLI must know the cost — which means either (a) `ie anim run` records it in `set.json`, or (b) the CLI passes `cost: null` and the assertion is vacuously true. The locked CONTEXT does not specify.

---

## 7. Traps for a 16-file, JSON-bearing kind

### `libraryPath.ts` validation

`isValidRelPath` (`app/lib/libraryPath.ts:16`):

```ts
const FILE_RE = /^(raw|derived)\/[a-z0-9][a-z0-9._-]{0,118}\.[a-z0-9]{1,8}$/
```

**Only `raw/<file>` or `derived/<file>` are accepted.** A top-level `set.json` will fail this check. The CLI or collector must either:

- Put `set.json` inside `derived/` (e.g. `derived/set.json`), or
- Widen the regex to accept `set.json` at the top level.

D-42 (`05-CONTEXT.md:20`) says the payload is "`derived/*.png` + `set.json` + `meta.json`". The phrase "`derived/*.png` + `set.json`" suggests `set.json` is at the top level, not inside `derived/`. But the existing regex does not allow that. **This is a real trap that must be resolved in Phase 5.**

Command:
```
grep -n "FILE_RE\|isValidRelPath" app/lib/libraryPath.ts
# 16:const FILE_RE = /^(raw|derived)\/[a-z0-9][a-z0-9._-]{0,118}\.[a-z0-9]{1,8}$/
# 26-28: export function isValidRelPath …
```

### The `409 EEXISTS` conflict flow

`saveAsset` (`library.ts:74-76`) throws `LibraryError('EEXISTS')` if the asset exists and `overwrite` is false. The route handler (`route.ts:137`) maps this to 409. The UI (`LibraryPanel.tsx:109`) catches 409 and shows a three-way dialog (overwrite / rename / cancel).

For a 16-file set, the conflict flow is the same as for a 1-file asset: the entire `<root>/<project>/<kind>/<slug>/` dir is the unit of conflict. The overwrite path (`library.ts:99-111`) moves the old dir aside, promotes the new one, and deletes the old. A crash mid-overwrite leaves either the old or the new asset, never both (see §2).

### `libraryCollect.ts`'s duplicated-lines note

The docblock at `app/lib/libraryCollect.ts:14-16`:

> Deliberately duplicates a few lines from the existing ZIP exporters rather than refactoring them: the exporters' byte-for-byte output is a tested invariant, and sharing a collector would put it at risk for no gain.

This is a warning: the collector's `files` map is built from scratch in each branch, not by reusing the ZIP exporters' logic. An `animations` branch must do the same — build the `files` map from the `set.json` facts, not by calling a shared helper.

### `AssetMeta.schemaVersion` reader

`schemaVersion: 1` is a literal in the type (`libraryTypes.ts:52`). The route handler forces it at `route.ts:120`; the CLI forces it at `library.mjs:190`. The `listAssets` walker does not check `schemaVersion` — it only checks that `slug` and `type` are strings (`library.ts:172-173`). A future `schemaVersion: 2` would be silently accepted by the walker.

### `manifest` field's current consumers

The `manifest` field is `Record<string, unknown> | null` (`libraryTypes.ts:60`). The docblock at `:59` says: "Verbatim output of the existing manifest builders (`buildPropManifest()`, …)."

The manifest is **written to `meta.json`** by `buildAssetMeta` (`libraryCollect.ts:228`) and **read back** by `listAssets` (which ignores it) and by any consumer that reads `meta.json` directly. The library itself never interprets the manifest — it is opaque data for the consumer.

For the `animations` kind, D-46 (`05-CONTEXT.md:28`) says `manifest` should contain the spec block only (actor/dirs/cell/states), not the frame list. The frame list is in `set.json`, and putting it in both places would create two sources of truth that can drift.

### Pitfalls

- **`set.json` placement** is the critical trap. The existing `isValidRelPath` regex does not accept a top-level `set.json`. Phase 5 must either (a) put `set.json` inside `derived/`, or (b) widen the regex. Option (a) is simpler and does not change the validation logic; option (b) requires updating the regex and the `ORPHAN_RE` logic (to avoid treating `set.json` as an orphan).
- **The `files.sheet` field** in `AssetMeta` (`libraryTypes.ts:61`) is derived from the first `raw/` entry (`libraryCollect.ts:230`). For an `animations` asset with no `raw/` files, `files.sheet` will be `null`. This is correct (D-42: raw never enters the payload), but the UI may need to handle `files.sheet === null` gracefully.
- **The `files.derived` field** (`libraryTypes.ts:61`) is the sorted list of `derived/` entries (`libraryCollect.ts:231-233`). For an `animations` asset, this will be the list of frame PNGs. If `set.json` is placed inside `derived/`, it will be included in this list — which may or may not be desirable.

### Assumptions / Open questions

- `[INFERENCE]` Whether `set.json` should be inside `derived/` or at the top level is not decided in the locked CONTEXT. The phrase "`derived/*.png` + `set.json`" in D-42 suggests top-level, but the existing regex does not allow that. The planner must resolve this trap.
- `[INFERENCE]` Whether the UI handles `files.sheet === null` gracefully is not observable from the code alone. The `LibraryPanel.tsx` code does not explicitly check for `files.sheet`, so it may assume a sheet is always present. This is a potential UI bug for the `animations` kind.

---

## Summary of measured facts

1. **Payload ceiling**: 279.6 M chars (200 MiB decoded) total, 55.9 M chars (40 MiB decoded) per file. 16 raws = 363.8 M chars → 413. Measured on consumer's real output: one raw = 17,055,535 bytes.
2. **`saveAsset` atomicity**: temp+rename pattern; 16 files is the same code path as 1 file; no per-kind branching.
3. **`set.json` placement trap**: `isValidRelPath` only accepts `raw|derived/<file>`; top-level `set.json` will be rejected.

## Summary of observed (not measured) facts

1. **`ie library save` hardcoded backend**: `cli/commands/library.mjs:162` — `ctx.flags.backend ?? 'openrouter'`.
2. **`model: ''` in CLI save**: `cli/commands/library.mjs:173` — the model is passed as empty string.
3. **`ReportedCost` shape**: `{ usd: number; source: string }` — `source` is a string, not a `BackendLabel`.
4. **Cost reporting**: only OpenRouter (`usage.cost`) and APIMart (adapter-wrapped) report cost; everything else is `null`.

## What I could not determine

- `[INFERENCE]` Whether `set.json` should carry a `cost` field is not decided in the locked CONTEXT. The `SetJson` type has no `cost` field today.
- `[INFERENCE]` Whether `set.json` should be inside `derived/` or at the top level is not decided. The existing regex does not allow top-level; the CONTEXT's phrasing suggests top-level.
- `[INFERENCE]` Whether the UI handles `files.sheet === null` gracefully is not observable from the code alone.
- I did not run a real POST with 363.8 M chars to confirm the 413 fires at the route's check.
