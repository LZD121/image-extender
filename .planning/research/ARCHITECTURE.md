# Architecture Research

**Domain:** Animated sprite-set production (direction × state × frame) added to an existing Next.js + headless-CLI game-art pipeline
**Researched:** 2026-10-06
**Confidence:** HIGH on the in-repo seams (read first-hand, line-cited); MEDIUM on the strip-geometry findings (measured from the consumer's own committed output, n=3 actors); LOW/HIGH split on engine output (S2, out of scope — verified against current Godot 4.7 docs only)

---

## Standard Architecture

### System Overview

The feature is **two pure modules + two runtime adapters over four existing seams**. Nothing else is new. The diagram below is the whole shape; every box that already exists in the repo is marked `[exists]`.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  SPECIFICATION (pure, no I/O)                                        [new]   │
│  ┌───────────────────────────┐   ┌──────────────────────────────────────┐   │
│  │ app/lib/animSet.ts        │   │ app/lib/animStrip.ts                 │   │
│  │  validateAnimSetSpec()    │◀──│  buildStripPrompt(spec,state,frame)  │   │
│  │  planStrips(spec)         │   │  stripSize(spec)  = cell × dirs.len  │   │
│  │  buildSetJson(spec,strips)│   │  DIR_ORDER (order == contract)       │   │
│  │  nextPending(plan, ledger)│   │  frameFile() / dirIndex()            │   │
│  └───────────┬───────────────┘   └──────────────────────────────────────┘   │
│              │  pure, vitest `node` env, zero DOM / HTTP / fs               │
├──────────────┴───────────────────────────────────────────────────────────────┤
│  RUNNERS (environment-bound; thin; call the pure core + existing seams)      │
│  ┌────────────────────────────────┐  ┌───────────────────────────────────┐  │
│  │ cli/commands/anim.mjs   [new]  │  │ app/components/AnimStudio.tsx[new]│  │
│  │  ctx.api    → /api/generate    │  │  studioRequest → /api/generate    │  │
│  │  ctx.bridge → strip-frames[new]│  │  imageProcessor (in-page, same fn)│  │
│  │  ctx.modules→ library, animSet │  │  libraryClient → /api/library     │  │
│  │  fs        → raw/, derived/    │  │  (no fs — the route owns disk)    │  │
│  └───────────┬────────────────────┘  └───────────────┬───────────────────┘  │
├──────────────┴───────────────────────────────────────┴──────────────────────┤
│  SEAMS — EXISTING, MUST NOT BE DUPLICATED                                    │
│  ┌──────────────────────────┐  ┌──────────────────────────────────────────┐ │
│  │ A. provider/model table  │  │ B. post-processing ops                   │ │
│  │ providers.ts   [exists]  │  │ cli/native/bridge.mjs     [exists]       │ │
│  │ imageGeneration.ts       │  │ app/utils/imageProcessor.ts [exists]     │ │
│  │  IMAGE_ADAPTERS [exists] │  │  ── add ONE op: 'strip-frames'   [new]   │ │
│  │ llmServer.ts   [exists]  │  │  ── everything else: reuse, no copy      │ │
│  │ /api/generate  [exists]  │  │                                          │ │
│  └──────────────────────────┘  └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────┤
│  PERSISTENCE                                                                 │
│  ┌────────────────────────┐  ┌───────────────────────────────────────────┐  │
│  │ <out>/  (CLI working    │  │ library: <project>/animations/<actor>/    │  │
│  │  directory, resumable)  │─▶│  derived/*.png + set.json + meta.json     │  │
│  │  set.json raw/ derived/ │  │  lib/library.ts  [exists]                 │  │
│  └────────────────────────┘  └───────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                              ▼ S2 (next milestone, out of scope)
        set.json ──▶ atlas assembly (rows = dir × state, cols = frame)
                    ──▶ Godot-native output (.tres SpriteFrames / sheet PNG)
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `app/lib/animSet.ts` `[new]` | `AnimSetSpec` validation, `planStrips()`, `buildSetJson()`, `nextPending()` resume decision, duration algebra (`durationsMs` from `fps`) | Pure TS module, no imports outside `animStrip.ts`. Mirrors `app/lib/generateRequest.ts`'s "name the contract once" role |
| `app/lib/animStrip.ts` `[new]` | Strip prompt text (per-cell direction enumeration, in-cell containment, flat-magenta field), cell↔direction mapping, size algebra `width = cell × dirs.length` | Pure TS, no imports at all. Sibling of `app/lib/generatePrompt.ts` (the existing prompt-policy home) |
| `cli/commands/anim.mjs` `[new]` | `ie anim plan` / `ie anim run`. Owns the per-strip ledger file, retry/backoff, `--go` gate, `--redo`, `--keep-going`, raw/derived writes, final `set.json` converge | Command module exporting `default { anim: spec }`; registered in `COMMAND_MODULES`. Uses `ctx.api` / `ctx.bridge` / `ctx.modules` — the same three seams as `cli/commands/studio.mjs` |
| `app/components/AnimStudio.tsx` `[new]` | Spec form → plan confirmation (the spend gate) → per-strip progress → frame gallery → `Save to library` | Presentational + local state, props in / events out, like `ParallaxStudio`. Mounted as a `Mode` branch in `app/page.tsx` |
| `cli/native/bridge.mjs` op `'strip-frames'` `[new op]` | One strip → N normalised per-direction cell PNGs | A new `case` inside the existing `PAGE_PROGRAM` switch, composing the **existing** `IE.*` functions. Not a new file, not a new browser |
| `app/lib/libraryTypes.ts` `[modified]` | `ASSET_KINDS += 'animations'` | One token added to a `as const` tuple |
| `app/lib/libraryCollect.ts` `[modified]` | A `mode: 'anim'` branch in `CollectorInput`, and `BACKEND_LABELS` widened | Discriminated-union member; missing it is a compile error |
| `app/i18n/messages/anim.ts` `[new]` | en + zh strings for the 7th studio | `Namespace` module, registered in `app/i18n/index.ts` |

### Recommended Project Structure

```
app/
├── lib/
│   ├── animSet.ts              # pure spec/plan/set.json/resume          [new]
│   ├── animStrip.ts            # pure prompt + cell↔direction + size     [new]
│   ├── __tests__/
│   │   ├── animSet.test.ts                                              [new]
│   │   └── animStrip.test.ts                                            [new]
│   ├── libraryTypes.ts         # ASSET_KINDS += 'animations'          [edit]
│   └── libraryCollect.ts       # CollectorInput += mode:'anim'        [edit]
├── components/
│   └── AnimStudio.tsx                                                   [new]
├── i18n/
│   ├── messages/anim.ts                                                 [new]
│   └── index.ts                # register the namespace               [edit]
├── utils/
│   └── imageProcessor.ts       # UNTOUCHED (see Anti-Pattern 1)
├── page.tsx                    # one more Mode render branch          [edit]
cli/
├── commands/anim.mjs                                                    [new]
├── commands/__tests__/anim.test.mjs      # plan/resume, stubbed ctx     [new]
└── native/bridge.mjs           # + one `case 'strip-frames'`          [edit]
```

### Structure Rationale

- **Two pure modules, not one.** `animStrip.ts` is prompt text + geometry; `animSet.ts` is spec/plan/artifact bookkeeping. They change for different reasons and are tested by different tables. The repo already splits this way (`generatePrompt.ts` vs `generateRequest.ts`), and `generatePrompt.ts`'s own header states the motive: prompt rules that lived in a route "could only be exercised by POSTing through HTTP" (`.planning/codebase/ARCHITECTURE.md`, `app/lib/generatePrompt.ts:1-13`).
- **The CLI runner writes the working directory; the library is a separate, later step.** The consumer's own tool does exactly this (`gen_assets_teamo.py` writes `assets/handpainted/sprites/<actor>/`, then `build_handpainted_sheets.py` reads it), and it is why an interrupted run is resumable without the library being involved.
- **No new `app/api/**` route.** The spec's own §11 lists `/api/generate` and `/api/library` as "不动" (untouched) — and both already carry the needed capability (`app/api/generate/route.ts:7-31,160`; `app/api/library/[[...path]]/route.ts:88-143`).

---

## Architectural Patterns

### Pattern 1: Pure core, two runners (the repo's existing testability lever)

**What:** All decisions (spec validation, plan construction, prompt text, artifact JSON, resume state machine) live in DOM-free, `fetch`-free, `node:fs`-free modules. Both surfaces call them. Environment-bound work is a thin adapter: the CLI binds `fetch`→dev server, canvas→headless Chromium, disk→`node:fs`; the UI binds the same three to `fetch`→same-origin routes, canvas→in-page, disk→the library route.

**When to use:** Whenever a feature must exist on both the CLI and the UI with identical output. This is the repo's stated invariant ("One home per fact", "CLI 复用 app 模块而非重写后处理" — `.planning/PROJECT.md` Key Decisions).

**Trade-offs:** The pure layer cannot do progressive side effects, so the *ledger* must be a data structure the runner owns and the core only reads/writes as plain objects. That is a feature, not a cost: it makes resume logic unit-testable without a temp directory.

**Why this split is what makes the feature testable here** — three runners, three jobs, no overlap:

| Runner | Command | What it proves | Why it is the right one |
|---|---|---|---|
| vitest (`environment: 'node'`) | `npm test` | Spec validation table, size algebra, prompt contains the per-cell direction enumeration + containment + flat-magenta clauses, `durationsMs` from `fps`, `nextPending` state machine (skip ok / redo / failed) | `vitest.config.ts:9-16` includes `app/**/__tests__/**` and `cli/**/__tests__/**`, **excludes** `cli/native/__tests__/**`. No DOM, no Chromium, milliseconds. The CLI's *decision* code is testable here too when the runner is fed a fake `ctx` — `cli/commands/__tests__/library.test.mjs:32-54` is the exact precedent (it builds "the subset of the CLI context `library.mjs` uses") |
| `node --test` | `npm run test:cli` | The new `strip-frames` op composes the real `IE.*` functions on real PNG bytes and writes N PNGs of exactly `cell×cell` | `cli/native/__tests__/bridge.smoke.test.mjs` is "the regression net for the ops the studio commands compose, so a broken bundle, a missing export or a changed option name fails before an agent spends money" (`:5-8`). It already synthesises a magenta sheet with `sharp` (`:22-48`) and counts opaque/transparent pixels (`:51-60`) — both helpers apply verbatim to a 1×N strip |
| Playwright + Midscene | `npm run test:ai` | The 7th studio mounts once, the plan gate refuses before confirmation, a saved set is visible after a reload | `e2e/studio-library.spec.ts:49-57` guards exactly this class of defect ("a panel mounted twice, a click that silently does nothing"). `playwright.config.ts:28-38` gives every run its own `IE_ASSETS_DIR`, so the asset write is safe |

**Example:**

```ts
// app/lib/animSet.ts — no imports, so nothing about it needs a browser or a server.
export type StripPlan = {
  state: string
  /** 0-based, matching set.json. The runner renders 1-based file names. */
  frame: number
  index: number
  prompt: string
  width: number
  height: number
}

export function planStrips(spec: AnimSetSpec): StripPlan[] {
  const { width, height } = stripSize(spec) // (cell × dirs.length, cell)
  const plan: StripPlan[] = []
  for (const state of spec.states) {
    for (let frame = 0; frame < state.frames; frame++) {
      plan.push({
        state: state.name,
        frame, // 0-based; the runner renders 1-based file names
        index: plan.length,
        prompt: buildStripPrompt(spec, state, frame),
        width,
        height,
      })
    }
  }
  return plan
}
```

```ts
// The runner supplies the environment. Nothing in animSet.ts knows which one it got.
const plan = planStrips(spec)
for (const strip of nextPending(plan, ledger, { redo })) {
  const res = await ctx.api('generate', { prompt: strip.prompt, width: strip.width, height: strip.height, ...ctx.llmFields() })
  writeDataUrl(await toDataUrl(res.imageUrl), rawPath(strip))
}
```

---

### Pattern 2: One op per pipeline *stage*, batched into one browser

**What:** The bridge's job spec is `{ op, opts, inputs, out|outDir }`, and one `runJobs([...])` call launches Chromium once and replays every job in that page (`cli/native/bridge.mjs:444-468`: "Launching Chromium (~1s) per op is the dominant cost of a studio pass"). Studio commands already batch by stage: `cli/commands/studio.mjs:167-173` sends N `expand-canvas` jobs in one call, then does the paid calls, then one more batch for blending.

**When to use:** The anim run. Per strip there are exactly two browser stages: (a) slice the returned strip into N cells, (b) normalise them. `'sprite-align'` proves both can ride in one op — its body is a five-step chain (`cli/native/bridge.mjs:276-328`) precisely because round trips, not functions, are the cost.

**Trade-offs:** A composite op hides intermediate artefacts. Mitigate by having the op return per-cell `meta` (count, per-cell alpha census, whether the panel fit moved), so a failure is diagnosable from the envelope rather than by re-running. `'sprite-align'` sets this precedent: it returns `duplicateFrames`, `targetSize`, `sizes`, `scales`, `baseline`, `detectedBottoms`, `baselineShifts`, `centroidsX`.

**Example (shape, not the algorithm):**

```js
// cli/native/bridge.mjs — a new case in the existing switch, not a new file.
case 'strip-frames': {
  const n = opts.dirs.length            // one row of N cells = N directions
  const cell = opts.cell
  // NOT `IE.sliceImageGrid` alone: see Anti-Pattern 1. Fit the panel grid first,
  // then reuse the app's own key / isolate / scale / centre passes per cell.
  const frames = []                      // one data URL per direction, in opts.dirs order
  out.files = Object.fromEntries(frames.map((u, i) => [`frame_${i}.png`, u]))
  out.meta = { count: frames.length, ... }
  break
}
```

---

### Pattern 3: Namespaced working directory + converge-at-the-end artifact

**What:** The run owns a directory it can be interrupted in: `raw/<state>_f<N>_<D>dir.png` is written **immediately** after each paid call, `derived/<state>_f<N>_<dir>.png` immediately after each slice, and `set.json` is rewritten at the end from the accumulated ledger. `--redo` re-runs strips; the default skips any strip whose raw file exists and whose ledger row says `ok: true`.

**When to use:** Any multi-call, money-spending, interruptible loop. The consumer's tool already does this (`gen_assets_teamo.py:155-185`: a ledger row per call, merged into a prior `generation-ledger.json` by `(state, frame)` key, written after every run).

**Trade-offs:** The working directory is not the library and is not atomic. That is correct: a partial set is a normal state during production, and the *library* write stays atomic because it goes through `lib.saveAsset`'s temp-dir-then-rename (`app/lib/library.ts:86-111`). Do not try to make the working directory atomic; do make the final library save atomic (it already is).

**Cost-accounting units:** one unit, `usd`, and it will usually be `null`. `extractCost` reads only OpenRouter's `usage.cost` (`app/lib/generateCost.ts`), and the transport for this feature is a chat-completions gateway (magpie → `viaChat`, `app/lib/imageGeneration.ts:150-154`), so `cost` stays `null` — which is honest and matches the consumer (its ledger has `seconds` and no money at all: `assets/handpainted/sprites/chaser/generation-ledger.json` rows carry `state/frame/dirs/file/ok/seconds/prompt`). The real accounting unit is the recorded `usage`: `params: { dirs, states, frames, cell, calls, cells, seconds }`. Define **`calls` = Σ `states.frames`** (paid calls) and **`cells` = Σ `states.frames × dirs.length`** (derived frames). Both are derivable from the spec, so the synthesizer should pin the definitions in one sentence rather than leaving a reader to guess.

---

## Data Flow

### `ie anim run --go` (the CLI path)

```
spec.json / inline flags
    ↓
animSet.validateAnimSetSpec()   ── illegal → usage error, ZERO calls made
    ↓
animStrip.stripSize()           ── cell × dirs.length > 4096 → error, ZERO calls
    ↓
animSet.planStrips()            ── [{state, frame, prompt, width, height}] × Σ frames
    ↓
animSet.nextPending(plan, ledger, {redo})
    ↓ for each strip (sequential — one shared browser, one paid call at a time)
    ├─▶ ctx.api('generate', {prompt, width, height, model|profile})
    │       ↓ dev server: modelOrDefault → buildGeneratePrompt → generateImage
    │       ↓ IMAGE_ADAPTERS[provider] → viaChat (magpie) → gateway
    │   ← {imageUrl, cost, provider, model}
    ├─▶ write raw/<state>_f<N>_<D>dir.png        ← IMMEDIATELY (crash-safe resume)
    ├─▶ append ledger row {state,frame,ok,seconds,prompt,requested,returned}
    └─▶ ctx.bridge({op:'strip-frames', opts:{dirs, cell}, inputs:[raw]})
            ↓ headless Chromium, window.IE = the app's own pixel modules
        ← out.files["frame_i.png"] × N  →  write derived/<state>_f<N>_<dir>.png
    ↓
animSet.buildSetJson(spec, strips, frames) → write set.json
    ↓
`ie library save <project> animations <actor> --sheet … --derived … --meta …`
    ↓
lib.saveAsset → temp dir → atomic rename → <project>/animations/<actor>/meta.json
```

### UI path (same decisions, different environment bindings)

```
AnimStudio form → animSet.validate → planStrips → plan panel with call count
    ↓ user confirms (irreversible spend, second gate after the CLI's --go)
per strip:
    studioRequest('/api/generate', toWire-shaped plain body)  ← SAME route, same adapter
    gallery state += {raw dataUrl}
    imageProcessor.???  ← the SAME functions the bridge bundles, in-page
    gallery state += {frames}
    ↓ Save to library
libraryClient.saveAsset → POST /api/library → lib.saveAsset  ← SAME atomic writer
```

### Key Data Flows

1. **Strip prompt → model → returned image.** The prompt is fully determined by `(spec.actor, spec.subject, spec.styleText, state.motion, frame, dirs)`. It is pure text; nothing about it needs a network. `planStrips()` returning the prompt means `ie anim plan` can print it and a test can assert on it without either surface existing.
2. **Returned strip → N derived frames.** *This is the least obvious flow and the one most likely to be built wrong.* See the "Strip geometry" box below.
3. **Run state → library asset.** `set.json` + `derived/*.png` are handed to `lib.saveAsset` as a flat `Record<rel, dataUrl>` map. `buildAssetMeta` then derives `files.sheet` (first `raw/` key) and `files.derived` (sorted `derived/` keys) itself — the caller does not classify files (`app/lib/libraryCollect.ts:212-217`).

### Strip geometry — measured, and it constrains the design

I measured the consumer's own committed strips rather than assuming the request is honoured:

| Fact | Measurement | Source |
|---|---|---|
| The returned image is **not** the requested size | requested `4096×512` (8:1) → returned **`11712×1408`** (8.318:1), identical on all three actors | `dark-black/assets/handpainted/sprites/chaser/idle_f1_8dir.png`, `…/hero/idle_f1_4dir.png` (`4128×1024`, 4.031:1) |
| Direction panels are **not** on a uniform grid | measured panel pitch varies **1325–1572 px** against a uniform `11712/8 = 1464 px`; the consumer's tool warns in the same words: "panels are ~1400 px apart on the 1464 px grid, so by the eighth direction the offset is a third of a panel and a uniform crop takes a leg from each neighbour" | measured column-profile runs; `dark-black/tools/build_handpainted_sheets.py:158-184` |
| The model draws a magenta field that is **not** pure magenta | the consumer samples the field colour from each cell's border ring because one pass came back `FF07F6` (cast 237) and the next `DFC7D2` (cast 12) | `build_handpainted_sheets.py:70-127` |
| Neighbour limbs land inside a cell | the consumer narrows each fitted panel to the run of non-empty columns containing the cell centre, then keeps only the connected blob containing that centre | `trim_to_blob` `:187-200`, `keep_main_blob` `:203-243` |

**Consequence for the architecture (HIGH confidence):** `IE.sliceImageGrid` alone is not a correct "strip → frames" step, for two independent reasons. It normalises the *whole sheet* to `cols × cellSize` before cutting (`app/utils/imageProcessor.ts:2082-2095`), so feeding it a 11712-wide strip with `cols: 8, cell: 512` first performs an 8.318→8.0 horizontal squeeze on every creature; and it then cuts on a **uniform** lattice, while the measured panel pitch is not uniform — the consumer's own docstring records the case that motivated its search: "the idle pass came back with panels ~1400 px apart on a 1464 px grid, so by the eighth direction the offset is a third of a panel and a uniform crop takes a leg from each neighbour" (`build_handpainted_sheets.py:161-165`; my own search over the committed `chaser` strip picks `t = 1453, phase = 72` against a uniform `1464`). The strip therefore needs its own **panel-grid fit** (search spacing *and* phase so cut lines land on empty columns and midpoints land on the creature), plus the per-cell passes that already exist. Place that fit in the new op and reuse everything downstream:

- fit the panel grid → `cells` (N data URLs)
- per cell: `IE.chromaKeyToAlpha(cell, CHROMA.…)` → `IE.removeFrameBorder` → `IE.isolatePrimarySpriteComponent` → `IE.normalizeSpriteFrameScale([cell])` → `IE.centerSpriteFramesHorizontally([cell])` → seat centred in a `cell × cell` box

The panel-fit itself should be a **pure function over a column mass profile** (`Float32Array | number[] → {spacing, phase}`), living where it can be unit-tested in vitest — i.e. in `animStrip.ts` (or a small sibling), with only the profile extraction needing a canvas. That is the same split `app/utils/pixelGrid.ts` already demonstrates: lattice math is pure and vitest-tested, the pixel read is not.

> **MEDIUM confidence on the exact fit parameters.** The measurements above come from three actors (`chaser`, `lunger`, `hero`) generated on 2026-10-04 by a *different* transport (Teamo direct via the agent-skill bridge). Whether the magpie→`teamo-router/gemini-3.1-flash-image` path returns the same geometry is the milestone's probe question, and it is unanswered. Build the fit to *detect* rather than assume (a search, not a constant), and assert in `set.json` what was actually fitted — that way the probe's answer changes a number, not a design.

---

## Scaling Considerations

This is a single-user, local, BYOK tool. "Scale" here means *the size of one animation set*, not users.

| Scale | Architecture Adjustments |
|---|---|
| **hero** (4 dirs × 2 states × 4 frames = 8 calls) | Nothing. `set.json` + 32 derived frames; the whole set fits in one library POST. |
| **monster** (8 dirs × 4 states × 4 frames = 16 calls, 128 derived frames) | Nothing structural — but **the payload ceiling is real**: see below. |

### Scaling Priorities

1. **First bottleneck — the library request body, and it is not close.** Measured on the consumer's real output: one 8-direction raw strip is **~17 MB** (`chaser/idle_f1_8dir.png`, 17,055,535 bytes); `chaser`'s 16 strips total **275 MB**, and 128 derived frames of a chroma-keyed 512 cell measure **~441 KB each ≈ 54 MB**. The library route caps at **40 MiB per file** (`MAX_FILE_CHARS = 40 MiB × 4/3 + 256`, `app/api/library/[[...path]]/route.ts:13`) and **200 MiB per request** (`:16`). So a set that ships its raws will be rejected with `413`, and even a derived-only set is at ~27% of the request cap before base64 overhead is counted twice (the route buffers the JSON body and then the decoded buffers). **Fix, in priority order:** (a) default the library save to `derived/` only, (b) do not store `raw/` for an anim asset unless asked, (c) if raws are wanted, shrink them first — the returned strip is a 2.86× upscale of a 4096-wide request and carries no information the 512-cell does not. `[INFERENCE]` — no request-size measurement was taken for a set-sized save; the per-file numbers are first-hand, the total is arithmetic.
2. **Second bottleneck — strip-slice wall time in one headless browser.** A 11712×1408 image is 16.5 Mpx; the consumer's own note is that the whole-strip C-speed profile "runs 85k times" in its grid search (`build_handpainted_sheets.py:151-152`). `IE.chromaKeyToAlpha` is a JS pixel loop over 66 MB of RGBA per strip (`app/utils/imageProcessor.ts:1480-1540`). N=8 cells per strip, 16 strips per monster set. Mitigations that do not change the design: batch the strips into one `runJobs` call (already the pattern), and fit the grid on a downscaled column profile rather than full resolution.

---

## Suggested Build Order

Dependencies are the arrows; **anything not on a path to the same component is parallel-safe**. The graph is deliberately shallow: only the geometry probe and the pure core are true prerequisites, because both answer questions the later code would otherwise hardcode.

```
        ┌──────────────────────────────────────┐
        │ P1  GEOMETRY PROBE                   │  blocks: P3 (its fit constants)
        │  one real strip on the chosen        │  cost: ~1 paid call
        │  transport → measure returned size,  │  output: a *measured* panel grid + field
        │  panel pitch, field colour           │          colour, recorded in a doc/comment
        └───────────────┬──────────────────────┘
                        │
        ┌───────────────┴──────────────────────┐
        │ P2  PURE CORE                        │  blocks: P3, P5, P6
        │  animStrip.ts + animSet.ts           │  testable with ZERO other work done
        │  (+ their vitest tables)             │  — no probe needed to write or test them
        └───────────────┴──────────────────────┘
                        │
                        ├──────────────────────┬───────────────────────┐
                        ▼                      ▼                       ▼
        ┌───────────────────────┐  ┌──────────────────────┐  ┌───────────────────┐
        │ P3  BRIDGE OP         │  │ P4  LIBRARY KIND     │  │ P6  UI STUDIO     │
        │  'strip-frames'       │  │  ASSET_KINDS +       │  │  AnimStudio.tsx   │
        │  + node:test smoke    │  │  CollectorInput      │  │  + anim.ts i18n   │
        │  (needs P2 for the    │  │  (needs NOTHING to   │  │  (needs P2 + P4;  │
        │   dir mapping, P1 for │  │   type-check; only   │  │   buildable       │
        │   its fit constants)  │  │   to be *correct*)   │  │   against a stub) │
        └───────────┬───────────┘  └──────────┬───────────┘  └─────────┬─────────┘
                    │                         │                        │
                    └────────────┬────────────┘                        │
                                 ▼                                     │
        ┌──────────────────────────────────────┐                       │
        │ P5  CLI RUNNER                       │                       │
        │  anim.mjs: plan/run, ledger,         │                       │
        │  --go/--redo/--keep-going, set.json  │                       │
        └───────────────┬──────────────────────┘                       │
                        │                                              │
                        ▼                                              ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │ P7  E2E ACCEPTANCE  (hero: idle+walk, 8 calls) → library → reload   │
        └──────────────────────────────────────────────────────────────────────┘
```

| # | Component | Blocked by | Why it is blocked | Parallel-safe |
|---|---|---|---|---|
| **P1** | Geometry probe | — | First, because it is cheap (one call) and its answer is a *constant* P3 would otherwise invent | with P2, P4 |
| **P2** | `animStrip.ts`, `animSet.ts` + vitest tables | — | Nothing. The prompt text and the plan algebra are decidable from the spec alone; the probe's numbers are arguments, not dependencies | with P1, P4 |
| **P3** | `'strip-frames'` bridge op + `node --test` smoke | P2 (dir↔cell mapping), P1 (fit constants) | The op's *signature* needs P2; its *fit* needs P1's measurement. It can be written and smoke-tested against the committed `chaser` strip **before** P1 returns, then re-tuned | with P4, P6 |
| **P4** | `ASSET_KINDS += 'animations'`, `CollectorInput mode:'anim'`, `BACKEND_LABELS` | — | Purely a type-level widening. Nothing about a probe or a plan gates it | with P1, P2, P3, P6 |
| **P5** | `cli/commands/anim.mjs` | P2, P3, P4 | It composes all three. Writing it earlier means writing the ledger, the retry policy and the artifact shape twice | — |
| **P6** | `AnimStudio.tsx` + `app/i18n/messages/anim.ts` | P2, P4 | Needs the plan type and a kind to save under. It does **not** need the bridge: the UI's post-processing is in-page, so it can be built and reviewed against P2 with a stub generate | with P3, P5 |
| **P7** | E2E acceptance (hero, 8 calls) | P5 (or P6) | It is the milestone's stated success criterion; it spends real money, so it runs once, last | — |

**Two phases are genuinely independent of everything else and can start on day one:** P1 (a measurement) and P4 (a type widening). Neither has a design in it.

**The one ordering trap:** P3 and P6 both need "how a strip becomes a frame", and the whole point of the reuse seam is that they must get it from *the same place*. Build P3's op as a thin composition of exported functions (see Anti-Pattern 1), then have P6 call those same functions — do not let P6 grow its own chain "because the DOM is right there".

**What can use a stub, and what cannot:**

- **P6 against a stub generate** — yes. The plan, the gallery layout, the confirm gate and the save dialog are all exercisable with a fixture strip; `e2e/fixtures/assets/demo/tiles/sample/derived/body.png` and the `bridge.smoke.test.mjs` `synthSheet()` helper already produce exactly the input this needs.
- **P5 against a stub gateway** — yes for the ledger, resume and `set.json`; the spec's own test plan says "stub 网关（仓库既有做法）" (§10). The repo's convention for that is `globalThis.fetch` replacement in vitest (`app/lib/__tests__/imageGeneration.test.ts:21-55`, `app/api/generate/__tests__/styleInjection.test.ts`), which works because the runner's only network call is `ctx.api('generate', …)`.
- **P1 against anything but the real gateway** — no. The probe's entire purpose is to falsify an assumption about a real transport; a stub would answer the question it exists to ask.

**Deliberately not in this order:** the `SUPPORTED_IMAGE_ASPECT_RATIOS` widening (Anti-Pattern 2). It is a *contingent* edit — it only becomes necessary if P1 shows the chat path cannot carry 8:1 by any route. Make it its own small phase, gated on P1's outcome, with the regression table from Anti-Pattern 2 as its verification block.

---

## Anti-Patterns

### Anti-Pattern 1: Re-implementing a post-processing step in the runner

**What people do:** Because `sliceImageGrid` does not fit the panel grid, write the fit *and* the key *and* the seat-into-box in `cli/commands/anim.mjs` (or, worse, a Python script), and let the UI call `imageProcessor` separately.

**Why it's wrong:** Two implementations of "how a strip becomes a frame" drift immediately, and the UI's gallery starts disagreeing with the CLI's files. This is the failure mode the repo has already paid for once — `app/lib/chromaPresets.ts:1-9` records that `cli/native/bridge.mjs` "used to carry a private copy that only a human could keep in step", and the fix was to bundle the owning module and read it from there.

**Do this instead:** Put the fit in the browser bundle's world (a pure function in `app/lib` or `app/utils`, exported through `browserBundle`) and give the UI the *same* function. The UI calls `imageProcessor` in-page; the CLI calls the identical exports through `window.IE`. One implementation, two callers — the CLI's stated reason for existing (`cli/ie.mjs:1-13`, `docs/agent-api.md`: "No algorithm is reimplemented here.").

### Anti-Pattern 2: A second table for "which gateway, which model, which size"

**What people do:** Because the strip needs `4096×512` and neither aspect ladder expresses 8:1, add a strip-specific ratio table in `animStrip.ts` — or, worse, a fourth `ProviderId` with its own base URL and key env.

**Why it's wrong:** `IMAGE_ADAPTERS` is `Record<ProviderId, ImageAdapter>` precisely so "a new provider does not compile until it is given an adapter here" (`app/lib/imageGeneration.ts:146-154`); `PROVIDERS`/`VERIFIED_MODELS` exist because "6 个路由各写一份 base URL，改一处漏五处" (`.planning/PROJECT.md`, Key Decisions). A strip-local ratio table is the same defect one level down.

**Do this instead:** Two separate moves, neither of which adds a table.

- *The request size* is already data, not a table: `/api/generate` derives `image_config.aspect_ratio` from `width`/`height` (`app/api/generate/route.ts:160`) using `SUPPORTED_IMAGE_ASPECT_RATIOS` (`:7-21`) — a set that tops out at `21:9`, so `4096×512` silently becomes `21:9` today. Widening that one constant to include `8:1` and `1:8` is the fix, and it is a **regression-risk edit**: I computed its blast radius and 10 of the 56 `×` 8 plain-generate ladder combinations change (`1920×720` 21:9→3:1, `512×1536` 9:16→1:3, …), while every existing studio request is unchanged (`4096×4096`→1:1, `2048×1024`→16:9, `1024×1024`→1:1, `512×512`→1:1). Recompute that table in the phase that makes the edit and assert the unchanged ones. Note also that the *magpie* path cannot express 8:1 at all today: it goes through `viaChat`, where the size only reaches the gateway as `image_config.aspect_ratio`.
- *The Teamo fallback* the spec's probe plans is a **profile**, not a provider: a `magpie` profile with `baseUrl` + `apiKeyEnv` (`app/lib/ieConfig.ts:132-139` allows `baseUrl` for `magpie` and only `magpie`) and `imageModel: 'teamo-router/gemini-3.1-flash-image'`. Zero code, and the interface the spec promises stays unchanged. Two facts from this machine that the probe phase will want: `api.teamorouter.com` currently resolves to **75.126.33.156** (the game script's `--resolve api.teamorouter.com=43.128.25.159` pin is stale), both IPs answer `200`, and the gateway reports `gemini-3.1-flash-image` plus `gpt-image-2*` among 47 models. The DNS override in the consumer's notes ("本地 DNS 被劫持") is **not** reproducing here — no `/etc/hosts` entry, and resolution succeeds.

### Anti-Pattern 3: A schema change to carry the set

**What people do:** Add `frames: N` / `durationsMs` / `dirs` as top-level `AssetMeta` fields, or add a `kind: 'animation-set'` to `AssetMeta.type` and start branching on it in the panel.

**Why it's wrong:** `AssetMeta.schemaVersion` is pinned at `1` and four consumers import the shape (`app/lib/libraryTypes.ts` header). The route re-stamps `schemaVersion: 1` on every write (`app/api/library/[[...path]]/route.ts:121`). A new field is a migration for a feature that does not need one.

**Do this instead:** Three existing slots carry everything:

| Need | Slot | Precedent |
|---|---|---|
| the set's own machine-readable contract (S2 reads it) | `set.json` stored as an asset file | The library treats any `raw/`/`derived/` file as opaque bytes; `set.json` lives beside `meta.json` (the library's directory contract is `<project>/<kind>/<slug>/` and nothing more) |
| the spec, human-readable in the panel | `meta.manifest` | `docs/agent-api.md`: "`manifest` — verbatim output of the existing manifest builders" |
| per-frame list, counts, cost | `provenance.params` (`Record<string, unknown>`, `libraryTypes.ts:19`) + `provenance.requested`/`returned`/`cost` | PixelStudio already writes `params: { template, view, size }` and `requested: '1024x1024'` (`app/components/PixelStudio.tsx:429-436`) |

One caveat with a real trap in it: **`meta.manifest` must hold the spec, not the frame list.** The library route re-stamps identity from the path and `buildAssetMeta` derives `files.derived` from the payload keys, so duplicating 128 filenames inside `manifest` creates a second source of truth that can drift from the actual files. The spec's §5.4 already rules this way ("`manifest` 只放规格，`set.json` 存进资产目录").

**And one trap in `--meta`:** the CLI's `ie library save --meta` does `Object.assign(meta, extra, { project, kind, slug, schemaVersion: 1 })` (`cli/commands/library.mjs:183`) — so a `--meta` payload *can* replace `provenance` wholesale. Passing the provenance object built by `ie anim run` is a deliberate override, not a merge; it must include every field (`buildProvenance` writes all of them for exactly this reason, `app/lib/libraryCollect.ts:82-104`).

### Anti-Pattern 4: Trusting the aspect ratio, or trusting `cost`

**What people do:** Persist `requested: "4096x512"` and let `returned` be derived from the request; or record a fabricated `usd`.

**Why it's wrong:** Measured: the request is not what comes back (`4096×512` → `11712×1408`). And `extractCost` understands only OpenRouter's `usage.cost`; on the magpie chat path it will be `null` on every call. `provenance.requested`/`returned` exist precisely for "models do not always honour the request" (`app/lib/libraryTypes.ts:21-23`) — recording only one of them makes the field vacuous.

**Do this instead:** Record `returned` from the bytes (`cli/lib/media.mjs` already exports `imageSize(file)` and `dataUrlSize(dataUrl)` for this). Leave `cost: null`. Record `seconds` honestly — the consumer's ledger does, and it is the only per-call number the pipeline actually controls.

### Anti-Pattern 5: Adding the 7th `Mode` without the exhaustive switch

**What people do:** Add `'anim'` to `Mode`, wire the render branch, and forget one of the `Record<Mode, …>` / `Record<AssetKind, …>` tables.

**Why it's wrong:** Most of them *do* fail to compile, which is the good news. But two do not, and both are silent: `app/i18n/__tests__/messages.test.ts:80` hardcodes `['extender','parallax','tile','props','sprite','pixel']` in its data-driven key list, so a new mode's `common.mode.anim.{label,hint}` is **not** covered by the dictionary guard; and `e2e/studio-library.spec.ts:17-24` hardcodes the `MODES` array, so the new studio's "panel mounted once" check simply does not run.

**Do this instead:** Extend both lists in the same change as the mode. Derive them from `ASSET_KINDS`/`Mode` if the synthesizer prefers — but either way, treat "the mode exists" as a fact that must be visible to the tests that iterate modes, not as a literal someone must remember to add.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---|---|---|
| **Magpie gateway** (`http://127.0.0.1:3425/v1`, `app/lib/providers.ts:45`) | `PROVIDERS.magpie` → `viaChat` → `chat/completions` | `keyRequired: false`. Model ids are vendor-prefixed; `teamo-router/gemini-3.1-flash-image` is the only verified image id (`providers.ts:127-132`). **The size only reaches it as `image_config.aspect_ratio`** — the mechanism under test by the probe |
| **teamo-router** (`https://api.teamorouter.com`) | The fallback, expressed as a *profile* (`provider: 'magpie'` + `baseUrl` + `apiKeyEnv`), never a new provider | Currently resolves to `75.126.33.156`; 47 models listed, `gemini-3.1-flash-image` among them. The game's `--resolve …=43.128.25.159` pin is stale (both IPs answer `200`) |
| **OpenRouter** | Existing path, untouched | The only adapter that reports `usage.cost` |
| **APIMart** | Existing path, untouched | Its own ratio set tops out at `3:1` (`app/lib/apimartServer.ts:35-51`), so `4096×512` would become `3:1` — a *worse* fit than `21:9`. `[INFERENCE]` this is why the spec's probe targets the chat gateway |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| `AnimStudio.tsx` ↔ `app/lib/animSet.ts` | direct import (pure) | The UI must be able to render the plan *before* any spend. If the plan requires a server round trip, the spend gate is decorative |
| `cli/commands/anim.mjs` ↔ `animSet`/`animStrip` | `ctx.modules('anim', ['app/lib/animSet','app/lib/animStrip'])` | `nodeBundle` caches by mtime (`cli/native/bundle.mjs:33-35`), so an edit invalidates it. **Do not** add these to `BROWSER_IMPORTS` (`:18`) — they are pure and belong in the Node bundle |
| `cli/commands/anim.mjs` ↔ pixel code | `ctx.bridge` / `ctx.bridgeBatch` | One op per stage; the bridge launches Chromium once per call |
| `AnimStudio.tsx` ↔ pixel code | direct imports from `@/app/utils/imageProcessor` | Same functions the bridge bundles — the reuse invariant |
| both runners ↔ `/api/generate` | HTTP, existing wire shape | **No new kind.** Send `{prompt, width, height, model\|profile}` — `generateKind` resolves that to `'plain'` (`app/lib/generateRequest.ts:86-95`), whose prompt is `styleDirective(artStyle) + prompt + "IMPORTANT: Create a high-quality, detailed image at exactly WxH pixels…"` (`app/lib/generatePrompt.ts:60` and the tail at `:1056-1058`). The strip's own layout rules therefore live entirely in the `prompt` field, which is the correct place — the route adds only the style directive and the size sentence |
| both runners ↔ library | CLI: `lib.saveAsset` directly (`ctx.modules('library', …)`). UI: `POST /api/library` | **These two paths do not stamp `backend` the same way** — the route re-stamps from a two-value allow-list (`BACKEND_LABELS = ['openrouter','pixellab']`, `app/lib/libraryCollect.ts:20`; route `:33-35,128`), while the CLI writes `resolvedBackend()`'s `profile.provider` straight through (`cli/commands/studio.mjs:47-55,91-107`). A magpie-run set saved from the UI will record `backend: "openrouter"`. This is a pre-existing defect recorded in `.planning/codebase/CONCERNS.md`, and the anim feature is a *second* consumer hitting it. Either fix the enum (`type BackendLabel = ProviderId \| 'pixellab'`) in the phase that touches `libraryCollect`, or accept that the CLI and UI disagree and say so — do not add a third convention |
| `set.json` ↔ S2 | a file, read by an adapter table | Keep it engine-neutral: **no Godot vocabulary in S2's input.** Verified against current Godot 4.7 docs: `SpriteFrames` has no `set_frame_duration`; duration is *relative* and absolute time is `relative_duration / (animation_fps × abs(playing_speed))`, set via `set_frame(anim, idx, texture, duration)` / `add_frame(anim, texture, duration, at_position)` with `set_animation_speed(anim, fps)` and `set_animation_loop_mode` (`LOOP_NONE`/`LINEAR`/`PINGPONG`). `Sprite2D` uses `hframes`/`vframes`/`frame`. So `durationsMs` in `set.json` is the right neutral form and S2 converts — the consumer's runtime, by contrast, hardcodes four `FPS_*` constants and an integer frame accumulator (`dark-black/scripts/actors/enemy.gd:59-61,605-631`) and never reads the manifest for timing |

---

## Sources

**In-repo, read first-hand (line-cited):**
- `.planning/PROJECT.md`, `.planning/config.json`
- `.planning/codebase/ARCHITECTURE.md`, `STACK.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `CONCERNS.md`, `TESTING.md`, `INTEGRATIONS.md`
- `docs/superpowers/specs/2026-10-06-animation-set-production-design.md` (the milestone spec, §4 unit boundaries and §5 data model are the direct input to this document)
- `docs/agent-api.md` (the CLI/HTTP contract; "No algorithm is reimplemented here")
- `app/lib/generateRequest.ts`, `generatePrompt.ts`, `providers.ts`, `imageGeneration.ts`, `llmServer.ts`, `ieConfig.ts`, `generateCost.ts`, `models.ts`, `chromaPresets.ts`, `stylePrompt.ts`, `apimartServer.ts`, `library.ts`, `libraryPath.ts`, `libraryTypes.ts`, `libraryCollect.ts`, `libraryClient.ts`, `studioRequest.ts`
- `app/api/generate/route.ts`, `app/api/library/[[...path]]/route.ts`
- `app/utils/imageProcessor.ts` (`sliceImageGrid:2070`, `chromaKeyToAlpha:1445`, `removeFrameBorder:2914`, `isolatePrimarySpriteComponent:3132`, `normalizeSpriteFrameScale:2804`, `alignSpriteFramesToBaseline:2601`, `centerSpriteFramesHorizontally:3355`, `normalizeImageToSize:209`)
- `cli/ie.mjs`, `cli/lib/{args,context,bridge,server,media}.mjs`, `cli/commands/{studio,library,prim,core}.mjs`, `cli/native/{bridge,bundle,deps}.mjs`
- `vitest.config.ts`, `playwright.config.ts`, `package.json`, `e2e/studio-library.spec.ts`, `cli/native/__tests__/bridge.smoke.test.mjs`, `cli/commands/__tests__/library.test.mjs`
- `app/components/{LibraryPanel,TopBar,PixelStudio}.tsx`, `app/i18n/index.ts`, `app/i18n/__tests__/messages.test.ts`, `app/lib/app.ts`

**Consumer (`~/repos/dark-black`, Godot 4.7) — the ground truth for conventions:**
- `tools/gen_assets_teamo.py` (`DIRS8:39`, `STYLE:42-46`, `ACTORS:48-83`, `build_prompt:97-113`, `main:116-186`) — ledger shape, `--go` gate, `break` on first failure, size algebra `4096×512` / `2048×512`
- `tools/build_handpainted_sheets.py` (`DIRS8:48`, `DIRS4:53`, `field_colour:70-92`, `chroma_key:95-127`, `column_profile:148-155`, `panel_boxes:158-184`, `trim_to_blob:187-200`, `keep_main_blob:203-243`, `fit_panel:315-337`, `build:389-444`, `empty_cells:361-370`) — the atlas contract, the panel-grid search, the fitted-cell convention
- `scripts/actors/enemy.gd` (`N_STATES:52`, `FRAMES:52`, `ATLAS_PATH:86`, `HANDPAINTED_PATH:87`, `_ready:191-202`, `_refresh_frame:585-600`, `_advance_columns:625-631`, `_sector_index:711-712`) — the runtime row/column contract
- `tools/check_enemy.gd:1043-1128` — the atlas gate, including the synthesised negative controls that keep the grid check from being vacuously true
- `assets/handpainted/sprites/{chaser,lunger,hero}/sprite-sheet-alpha.json` — `layout: "row = dir * n_states + state, col = frame"`, `cell: 64`, `dirs`, `states`
- `assets/handpainted/sprites/chaser/generation-ledger.json` — 17 rows, `seconds` but no `usd`
- Measured with `sharp` this session: `idle_f1_8dir.png` = 11712×1408 (17,055,535 bytes); `hero/idle_f1_4dir.png` = 4128×1024; panel pitch 1325–1572 px vs uniform 1464; keyed 512 cell ≈ 441 KB

**Versioned / engine-specific, verified against current docs (not training data):**
- Godot 4.7 `SpriteFrames` — https://docs.godotengine.org/en/4.7/classes/class_spriteframes.html (relative frame duration formula; `add_frame`/`set_frame`/`set_animation_speed`/`set_animation_loop_mode`; `LoopMode.LOOP_NONE|LOOP_LINEAR|LOOP_PINGPONG`; `get_animation_loop` deprecated)
- Godot 4.7 `Sprite2D` — https://docs.godotengine.org/en/4.7/classes/class_sprite2d.html (`hframes`, `vframes`, `frame`; the `centered`/pixel-snapping note)
- Godot 4.7.2 is the current 4.7 maintenance release (2026-08-18) — https://godotengine.org/download/archive/4.7-stable/ ; the project pins `config/features=PackedStringArray("4.7")` (`dark-black/project.godot`)
- Gemini image `ImageConfig.aspectRatio` — https://ai.google.dev/api/generate-content : `8:1` and `1:8` are documented values; `8:1` is listed for Gemini 3.1 Flash Image and **not** for Gemini 3.1 Pro Image, which is why the probe targets the Flash model

---
*Architecture research for: animated sprite-set production in image-extender (S1)*
*Researched: 2026-10-06*
