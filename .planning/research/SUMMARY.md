# Project Research Summary

**Project:** Image Extender fork — game-art production pipeline (`~/repos/image-extender`)
**Domain:** AI-driven 2D game-art production (BYOK image generation → post-processing → filesystem asset library → engine-ready assets), consumed by a Godot 4.7 project
**Milestone:** Animated sprite-set production, direction × state × frame
**Researched:** 2026-10-06
**Confidence:** HIGH

## Executive Summary

This is a **subsequent** milestone on an app that already exists end to end: the provider table, `/api/generate`, the browser post-processing chain, the headless-Chromium bridge, the atomic asset library and the `ie` CLI are all shipped and measured. Nothing in the research proposes rebuilding them. The unit of work is **two new pure TypeScript modules plus two thin runners** (a CLI command and a 7th studio component) over four existing seams, and the milestone's product claim is narrow and testable: one spec produces a whole (direction × state × frame) set that a game can consume, with the spend and the provenance visible before and after.

Experts build this class of feature the way this repo already does: all decisions (spec validation, plan construction, strip prompt, artifact JSON, resume state machine, panel-geometry algebra) live in DOM-free, `fetch`-free, `fs`-free modules that both surfaces call; environment-bound work is a thin binding of the same three seams (HTTP → dev server vs same-origin route; canvas → headless Chromium vs in-page; disk → `node:fs` vs the library route). The consumer's own Python generator already proves the *generation* technique — one strip per (state, frame) with N cells = N directions, at an exact supported aspect so no cell is non-uniformly resized — and the research confirms that technique is correct and should be copied rather than invented. What the consumer does *not* have, and this milestone does, is a neutral machine-readable contract (`set.json`), a spend gate with a printed call sheet, resumable per-strip execution, and provenance.

The risks are real and mostly *measured on already-shipped artifacts* rather than hypothetical, which is why the confidence is high. The dominant risk is not the model's art quality: it is that **every size and geometry signal on the current path is approximate**. `/api/generate` reduces `width`/`height` to the nearest entry of a 10-value aspect list that has no 8:1 or 4:1, so an 8-cell strip request becomes a 21:9 (or APIMart's 3:1) canvas; the model returns `11712×1408` for a requested `4096×512`; the shipped slicer resamples to make a wrong-ratio reply *fit* rather than fail; and a uniform cut on a near-uniform grid still lands 68 of 224 cut lines on creature pixels. The mitigation is uniform across all of it: **measure, record `requested` vs `returned` from the actual bytes, and assert geometry instead of counting cells** — a count assertion is vacuously true for exactly the failure that matters.

## Key Findings

### Recommended Stack

Everything needed is already installed; the milestone adds no dependency. The engine-delivery target is a Godot-native `SpriteFrames` `.tres` built from `AtlasTexture(atlas, region, filter_clip=true)` cells — a structure that was **emitted and read back by a headless Godot 4.7.2 run on this machine**, not recalled — with the current runtime path (`Sprite2D` + `hframes`/`vframes`/`frame`) left intact for the first consumer. The one channel that natively expresses 8:1 and 4:1 is `gemini-3.1-flash-image`'s `response_format.aspect_ratio`; the one channel that takes exact pixels is APIMart's `gpt-image-2-official` `size`, **capped at 3840 per edge**, so an 8:1 strip through it is `3840×480`, not `4096×512`. See `STACK.md` for the verified `.tres` shape, the `.import` defaults, and the per-format interop table.

**Core technologies:**
- Pure TS modules `animSet.ts` / `animStrip.ts`: spec → plan → prompt → `set.json` — the whole decision surface, unit-testable with no browser, no network, no disk
- Existing `cli/native/bridge.mjs` + `app/utils/imageProcessor.ts`: the post-processing chain — reused, never re-derived; the only new item is **one** op (`strip-frames`) that composes the existing `IE.*` exports
- Existing `/api/generate` + `IMAGE_ADAPTERS`: the transport — untouched; both runners send `{prompt, width, height, model|profile}` and let the existing plain-generate path add the style directive and the size sentence
- Existing `lib.saveAsset` / `POST /api/library`: the atomic persistence — the library write stays atomic, the working directory deliberately does not
- Godot 4.7 `SpriteFrames` + `AtlasTexture` (S2, out of scope): the engine contract `set.json` must be able to feed without any Godot vocabulary leaking backwards into the producer

### Expected Features

`FEATURES.md` classifies against a hard rule: a missing table-stakes feature either produces a set the engine cannot read or spends money without saying so. The differentiators are anchored to something the consumer measurably needs, not to a feature checklist.

**Must have (table stakes):**
- Per-state frame count, and per-state `fps` + `loop` with materialised `durationsMs` — the consumer's `frame = row * FRAMES + col` grid rule is only valid while every row is the same width; one odd row silently mis-addresses cells
- Direction ordering as a verbatim, named, ordered preset (`dirs8` = east-clockwise sector order; the hero's 4 named drawings are explicitly **not** sector order) — order-in is order-out, and the engine reads the list rather than re-deriving it
- Exact-aspect strip request with no non-uniform resize, and a hard error when `cell × dirs > 4096` rather than a silent shrink
- Deterministic 1-based file naming (`{state}_f{N}_{D}dir.png`) valid under the library's strict `FILE_RE`, with 0-based indices inside `set.json`
- Spend preview before spending: the plan prints call count + per-call canvas + output root, not "yes/no"
- Resume / stop-on-failure, per-strip provenance, and a binary magenta key with despill
- Bilingual strings for the new mode (a missing zh key is a compile error by construction)

**Should have (competitive):**
- Per-frame regeneration (`--redo state:frame`) — one call instead of 16; highest value-per-line on the list
- The **direction-matrix** review artifact (one row per sector, one column per state, frame 1, zoomed) — the only artifact that shows the direction axis is eight real drawings rather than one mirrored sprite
- Library asset = one animation set with `set.json` inside it (no new storage concept), plus a `{calls, cells, seconds}` usage rollup in `provenance.params`

**Defer (v2+):**
- Identity anchoring across frames (the repo already owns the mechanism; the wire field is the change)
- Palette locking / extraction from a committed corpus — the fix for a *measured* consumer failure, but not needed for S1
- Engine-native export (S2, the whole next milestone), PixelLab animation adapter, and retiring `gen_assets_teamo.py`
- Anti-features, recorded so they are not re-litigated: a full browser animation editor, runtime in-engine generation, cloud asset hosting, a batch queue, auto-retiming

### Architecture Approach

Two pure modules + two runners over four existing seams; **no new API route, no schema change, no second ratio table, no re-implementation of any post-processing step**. `ARCHITECTURE.md`'s build-order graph is deliberately shallow: only the geometry probe and the pure core are true prerequisites, because both answer questions the later code would otherwise hardcode. P1 (probe) and P4 (library kind) are genuinely independent and can start on day one.

**Major components:**
1. `app/lib/animStrip.ts` [new] — strip prompt text (per-cell direction enumeration, in-cell containment, flat-magenta field), cell↔direction mapping, `width = cell × dirs.length`, and the panel-fit algebra (a pure function over a column mass profile)
2. `app/lib/animSet.ts` [new] — `AnimSetSpec` validation, `planStrips()`, `buildSetJson()`, `nextPending()` resume decision, `durationsMs` algebra
3. `cli/commands/anim.mjs` [new] — `ie anim plan` / `run --go`: ledger, `--redo`/`--keep-going`, atomic raw/derived writes, final `set.json`
4. `cli/native/bridge.mjs` op `'strip-frames'` [new op] — one strip → N normalised cells, one `case` inside the existing switch composing existing `IE.*` functions
5. `AnimStudio.tsx` + `app/i18n/messages/anim.ts` + `ASSET_KINDS += 'animations'` + `CollectorInput mode:'anim'` [new/edit] — the 7th studio, the plan gate, the gallery, and the save

**The one ordering trap:** the CLI and the UI must get "how a strip becomes a frame" from the *same* place. The op is a thin composition of exported functions; the UI calls those same functions in-page. A private copy in either runner is the failure `app/lib/chromaPresets.ts` already records the repo paying for once.

### Critical Pitfalls

1. **The aspect downgrade is silent, and the slicer then hides it.** `4096×512` and `2048×512` both resolve to `21:9` against the shipped list (APIMart: `3:1`), and `sliceImageGrid` normalises the whole sheet to `cols × cellSize` before cutting — a ~3.4× horizontal squash per cell, green count assertion, destroyed art. *Avoid:* make the transport carry the exact size (probe first), and assert `returned` aspect against `requested` from the actual bytes, treating a mismatch as `ok:false`.
2. **A near-uniform grid is still visually destructive.** The reconciled measurement below: slicing on `W/N` cuts through creature pixels in 23 of 32 shipped strips even though the fitted pitch is within ~1 % of uniform. *Avoid:* fit `(spacing, phase)` or trim per cell to the blob containing the cell centre, and assert every cut line lands on a mostly-empty gutter column.
3. **`sprite-align` cannot be used as a unit.** It unconditionally runs `normalizeSpriteFrameScale → alignSpriteFramesToBaseline(targetBaseline: cell*0.9) → centerSpriteFramesHorizontally`, which plants top-down and bottom-up cells on a common floor, shrinks drawings to obey it, and *loses* content pushed past the cell edge. Spec §7 and the consumer both forbid a shared baseline. *Avoid:* compose `slice` → `chroma` → `removeFrameBorder` → centre/fit, off-baseline, and record the choice in `set.json`.
4. **A post-processing no-op is indistinguishable from success.** Two passes in the reused op sit in empty catches; a throw yields a valid image, `ok:true`, and no counter. *Avoid:* every optional step returns a counter or boolean, recorded per strip; assertions on geometry, never on counts.
5. **Resume-on-file-existence over a non-atomic writer is a permanent skip.** A truncated PNG at the final path is never re-fetched, and "raw exists" says nothing about derived frames. *Avoid:* temp-file + rename for every artifact, define "done" from the record (`ok:true` **and** raw decodes **and** expected derived count), and validate on skip.
6. **Provenance is confidently wrong as shipped.** `BACKEND_LABELS = ['openrouter','pixellab']` with a fallback that maps anything else to `openrouter`, `extractCost` hardcoding `source: 'openrouter'`, and `ie library save` hardcoding `backend: 'openrouter'` — the exact command the spec plans to reuse. *Avoid:* fix the enum to `ProviderId | 'pixellab'`, pass the real backend, keep `cost: null` when the gateway reports nothing, and assert `cost.source === backend`.

### Reconciled Contradiction: the strip panel grid

The three documents measured the same artifact at different granularities and appear to disagree. Reconciled:

- **What is measured.** `ARCHITECTURE.md` profiled the chaser strip's column mass and found panel centres at 740…11008, i.e. pitch **1325–1572 px** against a uniform `11712/8 = 1464 px`; the consumer's own docstring records the same case (`idle` pass ~1400 px on a 1464 px grid; by the 8th direction the offset is a third of a panel). `STACK.md` then fitted `(spacing, phase)` over **all 40** committed strips and found the fitted spacing within **≤ 2.25 %** of `W/N` (mean **0.91 %**), with **1 of 40** strips warning — and notes widths divide evenly by the cell count in 40/40. `PITFALLS.md` measured cut-line safety directly: **68 of 224** uniform cut lines land on creature pixels, and **23 of 32** shipped strips have at least one. All three are measurements of the same corpus; only the *metric* differs (single-strip extremes vs corpus-wide fit residual vs cut-line outcome).
- **What it costs.** A 0.91 % mean residual on a 1464 px pitch is ~13 px of accumulated drift against cells whose shipped content fills 56/64 of the cell (3–4 px margin, measured on all 128 cells). A few pixels of drift is therefore enough to put a cut line on a limb even when the grid is numerically near-uniform. Hence the two numbers are not in conflict: **the grid is near-uniform and slicing is still wrong in three quarters of the strips.** The cost is a downstream repair chain that exists for no other reason — `trim_to_blob` (a box holding two creatures is what puts a second, smaller spider in the cell) and `keep_main_blob` (delete the detached fragment of a neighbour's limb).
- **What the pipeline must therefore do.** Treat the grid as *fitted, not assumed*, at both ends: (a) fit `(spacing, phase)` — or trim each cell to the connected component containing the cell centre — as a pure function over a column mass profile, unit-testable in vitest, with only the profile extraction needing a canvas; and (b) assert, per strip, that each cut line sits on a mostly-empty gutter column. Prefer the gutter assertion over the fit quality as the gate, because it is the metric that correlates with damage. Build the fit to *detect* rather than assume (a search, not a constant) and record in `set.json` what was actually fitted, so the Phase-1 probe's answer changes a number rather than a design.

## Implications for Roadmap

The four documents converge on the same shallow dependency graph. Suggested phase structure:

### Phase 1: Transport probe and exact-size passthrough
**Rationale:** One cheap real call, and its answer is a constant that every later phase would otherwise invent. The whole technique is "the requested canvas reaches the model unmodified"; today no path can even *say* 8:1. Do this **before any paid set is run** — a full set generated on a downgraded transport is unrecoverable at HIGH cost.
**Delivers:** A recorded measurement of one real strip — returned dimensions vs request, fitted panel pitch, field colour — plus the transport decision (magpie passthrough, or the Teamo-direct fallback expressed as a `magpie` *profile* with `baseUrl` + `apiKeyEnv`, never a fourth provider) and, only if the probe shows the chat path cannot carry 8:1 by any route, the contingent widening of `SUPPORTED_IMAGE_ASPECT_RATIOS` with its recomputed blast-radius table.
**Addresses:** Exact-aspect request; the milestone's own gated risk (§9.1).
**Avoids:** Pitfall 1 (silent aspect downgrade) and the assumption underlying Pitfall 2.

### Phase 2: Pure core — `animStrip.ts` + `animSet.ts`
**Rationale:** Nothing blocks it: the prompt text and the plan algebra are decidable from the spec alone, and the probe's numbers are arguments, not dependencies. Writing it first is what makes the CLI and the UI agree by construction instead of by review.
**Delivers:** Validation (uniform frame count for the first consumer; `FILE_RE`-legal state/dir names; a single naming function with the 1-based↔0-based conversion tested at both boundary values), `planStrips()`, `stripSize()`, `buildStripPrompt()` with the N index-bearing cell→direction lines, `buildSetJson()`, `nextPending()` defined from the record rather than from file existence, and the panel-fit function over a column profile.
**Addresses:** Spec → plan; strip prompt core; deterministic naming; resume semantics; `set.json` shape.
**Avoids:** Pitfall 3 (algebra restated), 5 (enumeration not tested), 13 (`nextPending` definition), 14 (key + uniqueness), 18 (non-deterministic names).

### Phase 3: Strip → frames post-processing (`strip-frames`)
**Rationale:** The design decision in Pitfall 11 — whether the reused op is usable at all for this workload — must be made *before* the runner is written, because it determines the op's signature. The op can be written and smoke-tested against the committed `chaser` strip before the probe returns, then re-tuned to P1's constants.
**Delivers:** One new `case` composing `panel-fit → chromaKeyToAlpha (field-aware, binary) → removeFrameBorder → isolatePrimarySpriteComponent → fit/centre into the fixed cell`, with `alignSpriteFramesToBaseline` **off**, every best-effort step returning a counter, per-cell corner-transparency and bbox-margin assertions, the duplicate-mass detector wired in, a stated scale policy, and a `node --test` smoke test on real PNG bytes.
**Addresses:** Slice → key → trim/fit → centre; per-frame normalisation; the gutter assertion.
**Avoids:** Pitfalls 2, 4, 6, 7, 9, 10, 11, 12; the producer-side half of 17 (uniform, centred, ≥2 px margin).

### Phase 4: CLI runner — `ie anim plan` / `run --go`
**Rationale:** It composes Phases 2–3 plus the library kind; writing it earlier means writing the ledger, the retry policy and the artifact shape twice.
**Delivers:** The printed call sheet (per-strip canvas, call count, total, output root), the `--go` gate, atomic `raw/` (immediately after each paid call) and `derived/` writes, the ledger merged by `(state, frame)` with a uniqueness assertion, default stop-on-failure, `--keep-going`, scoped `--redo state:frame`, and the run's own provenance record.
**Uses:** `ctx.api` / `ctx.bridge` / `ctx.modules` — the same three seams as the existing studio commands.
**Avoids:** Pitfalls 13, 14, 18; the UX pitfall of a plan that prints only filenames.

### Phase 5: Library kind, provenance honesty, and the payload ceiling
**Rationale:** Must land **before** the E2E, because the E2E is the acceptance evidence and would otherwise enshrine a wrong `backend` label. The provenance fix is upstream of reusing `ie library save`, which hardcodes `backend: 'openrouter'`.
**Delivers:** `ASSET_KINDS += 'animations'` with the collector branch and both en/zh kind labels; `BackendLabel = ProviderId | 'pixellab'` derived once in `libraryCollect.ts` and used by both the route and the CLI; `cost: null` unless the serving gateway reports it, with `cost.source === backend` asserted; `meta.manifest` = the spec block only (never the frame list — a second source of truth that can drift); and the payload decision that `raw/` never ships — measured at 16 raws = **363.8 M base64 chars against a 279.6 M route cap**, a 413 available only *after* the body has been buffered. Save `derived/` + `set.json` (+ at most one raw).
**Addresses:** Library asset = one set; provenance; usage rollup.
**Avoids:** Pitfalls 15 and 16; the `--meta` wholesale-`provenance`-replacement trap.

### Phase 6: UI studio — `AnimStudio.tsx` + i18n
**Rationale:** Needs the plan type and a kind to save under; it does **not** need the bridge (its post-processing is in-page), so it can be built against a stub generate with the existing fixture strip.
**Delivers:** Spec form → plan confirm (the second spend gate) → per-strip progress → frame gallery with the direction-matrix view → Save to library; the anim mode derived from `cell × dirs` internally, never exposing the ratio ladder; and the two hardcoded mode lists (`app/i18n/__tests__/messages.test.ts:80`, `e2e/studio-library.spec.ts:17-24`) extended in the same change, because those two are the mode-existence guards that do *not* fail to compile.
**Implements:** The 7th `Mode` with the exhaustive-switch discipline.
**Avoids:** Anti-Pattern 5; the 32-row gallery as a review surface.

### Phase 7: E2E acceptance on the consumer's hero shape
**Rationale:** The milestone's stated success criterion, and it spends real money, so it runs once, last.
**Delivers:** Hero, idle + walk, 8 calls → library → survives a page refresh; the per-row bbox-stddev threshold asserted; `params.calls` reconciled against the `ok:true` count; a truncated-raw resume check; and the retirement notes that put the raw-strip ignore rules into the producer's own docs.
**Addresses:** The "Looks Done But Isn't" checklist in `PITFALLS.md`.

### Phase Ordering Rationale

- **Probe → (pure core ∥ library kind) → op → runner → library/provenance → UI → E2E.** Only the probe and the pure core are genuine prerequisites; phase 1 and the kind widening are independent of everything and can start on day one.
- **The grouping follows the seam boundaries, not the feature list.** Decisions (pure) / environment bindings (runners) / reused machinery (seams) is the repo's existing testability lever, and it is what keeps the CLI's output and the UI's gallery from diverging.
- **The expensive mistakes are ordered before the expensive spend.** Every phase that could make a set wrong (transport, grid fit, keying, frame count, resume) is upstream of the phase that runs a whole set for real.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** the probe's answer is unexercised on this machine — whether magpie honours `image_config.aspect_ratio` at all, and whether the chat gateways return `usage.cost`, are both `[INFERENCE]` today. The phase exists to falsify them on a real transport; a stub would answer the question it was created to ask.
- **Phase 3:** which scale policy and which chroma preset are *right* at 512 px cells is a judgement, not a lookup — the 64 px measurements do not transfer directly, and whether `normalizeSpriteFrameScale` helps or hurts across a legitimate perspective change is unmeasured. Plan for a two-run comparison, not a decision.
- **Phase 6:** the direction order being honoured is not machine-checkable today; the mirror/permutation tripwire is a proposed probe, not a measured one.

Phases with standard patterns (skip research-phase):
- **Phase 2:** pure TypeScript over a spec that already exists; the repo has two direct precedents (`generateRequest.ts`, `generatePrompt.ts`) and a vitest surface already wired for `app/**/__tests__/**`.
- **Phase 4:** the ledger/resume/flag shape is copied from a committed, working consumer tool and from the repo's own studio commands.
- **Phase 5:** every edit is a type widening or an enum fix, both already specified in `CONCERNS.md`.
- **Phase 7:** the acceptance script is the milestone's own §10.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | The Godot 4.7 consumption formats were produced or read back by a headless run on this machine; the provider aspect sets came from live probes against the gateway API and vendor docs; the app's send path was read from source. The one MEDIUM is what Teamo returns for an 8:1 request — inferred from 40 committed strips and 2 ledgered successful calls, no fresh spend. |
| Features | HIGH | Every claim is cited to a file in either repo; external tool formats are cited to current vendor/engine docs. MEDIUM only on "what the model actually returns", which rests on the consumer's measured prose plus a probe that has not run. |
| Architecture | HIGH on the in-repo seams (read first-hand, line-cited); MEDIUM on the strip-geometry findings (measured from the consumer's committed output, n=3 actors for the extremes, n=40 for the corpus fit); LOW/HIGH split on engine output (S2, verified against current docs only). |
| Pitfalls | HIGH | Every failure cited has already happened — a committed artifact, a measured number, or an engine/route source line. The reachable-but-unexercised ones (magpie 8:1 passthrough, cost shapes) are individually marked MEDIUM. |

**Overall confidence:** HIGH

### Gaps to Address

- **Does the chosen transport carry 8:1 at all?** One call to magpie with a strip prompt, then read the usage log rather than trusting the HTTP code (the same gateway has a hard ~15 s ceiling, and every image generation it has ever logged took 29–35 s, so the expected failure mode is **timeout, not ratio**). If it 504s, the fallback is the Teamo-direct profile, and its aspect must be computed from the **pixel size**, not from the app's route table.
- **What geometry does the returned strip actually have?** Run the column-profile + panel-fit measurement on the probe strip and compare fitted spacing against `W/N`. Anything worse than the corpus's ≤ 2.3 % means the prompt's gutter instruction is not being obeyed; either way, the fit stays a search and `set.json` records what was fitted.
- **Does a widened ratio list change the canvas?** Verify by the *returned* aspect, not by the plan. The cheaper pre-spend proxy is to query the gateway with a bogus ratio and read its enumerated accepted set.
- **Which chroma preset and scale policy suit a pale 512 px field?** The shipped `default` preset (`castThreshold: 80`, soft ramp) is exactly the failure mode measured on the consumer's corpus — one pass came back `FF07F6` (cast 237), the next `DFC7D2` (cast 12). Decide once from a measured field colour, keep the mask binary, and record which preset was used.
- **Does the consumer's gate accept a generated set?** S2's concern, but the producer can pre-check the shape it must satisfy (`sprite-sheet-alpha.json` key set and row order).
- **`cost` on the chat path.** `app/lib/generateCost.ts` says itself that it understands only OpenRouter's `usage.cost`. Plan for `null` and treat any non-null value with a matching `source` as the exception to assert.

## Sources

### Primary (HIGH confidence)
- `~/repos/dark-black` (the consumer, Godot 4.7.2) — `tools/gen_assets_teamo.py` (strip prompt, exact-aspect rationale, `DIRS8`/`DIRS4`, `--go` gate, ledger merge), `tools/build_handpainted_sheets.py` (`field_colour`, binary-key rationale, `panel_boxes` grid search, `trim_to_blob`, `keep_main_blob`, `fit_panel`, `CARD_REMOVED`, the direction-matrix preview), `docs/handpainted/P2-P3-PLAN.md` (the four measured "follow the docs and you get it wrong" findings), `scripts/actors/enemy.gd` + `player.gd` (the ruled-grid contract, `FPS_*`, `_sector_index`, the hero's named-direction convention), `tools/check_enemy.gd` (the atlas gate and its negative controls), `project.godot` + `tools/check_settings.gd` (stretch, integer scale, texture filter), `assets/handpainted/sprites/{chaser,lunger,hero}/*` (measured sizes, the 17-row/16-key ledger, the atlas margins), `.gitignore:105-112` (the after-the-fact raw-strip ignore rules)
- `~/repos/image-extender` (this repo) — `app/api/generate/route.ts` (`SUPPORTED_IMAGE_ASPECT_RATIOS`, `supportedAspectRatioForSize`, `image_config`, reference-image order), `app/lib/{imageGeneration,apimartServer,generateCost,providers,chromaPresets,library,libraryPath,libraryTypes,libraryCollect,generatePrompt,generateRequest}.ts`, `app/utils/imageProcessor.ts` (`sliceImageGrid` and its unconditional rescale, `chromaKeyToAlpha`, `removeFrameBorder`, `isolatePrimarySpriteComponent`, `normalizeSpriteFrameScale`, `alignSpriteFramesToBaseline`, `centerSpriteFramesHorizontally`), `app/api/library/[[...path]]/route.ts` (payload caps, `pickBackendLabel`, the re-stamp), `cli/native/bridge.mjs` (`CHROMA`, `duplicateFlag`, the `sprite-align` chain including its two empty catches and the unconditional baseline pass), `cli/lib/media.mjs` (the non-atomic `writeDataUrl`), `cli/commands/{studio,library}.mjs`, `docs/superpowers/specs/2026-10-06-animation-set-production-design.md`, `.planning/{PROJECT.md,codebase/*.md}`
- Godot 4.7 docs + engine source — `SpriteFrames` (relative frame duration formula, `set_animation_speed`, `set_animation_loop_mode`), `AtlasTexture` (`filter_clip` default `false`, `margin` resizes the drawn texture), `Sprite2D` (`hframes`/`vframes`/`frame`, the `centered` pivot note), `ResourceImporterTexture` defaults, `resource_importer_texture_atlas.cpp` (the importer is an editor-side *packer*), `viewport.h`/`viewport.cpp`/`main.cpp`/`sprite_2d.cpp` (the filter enum mapping, the LINEAR fallback, and `r_filter_clip_enabled = false` on the `hframes` path)
- Live probes on this machine, 2026-10-06 — `curl https://openrouter.ai/api/v1/images/models` (the declared ratio sets, incl. `8:1`/`4:1` for `gemini-3.1-flash-image`), `POST http://127.0.0.1:3425/v1/images/generations` (504 at ~15 s) with `~/.config/magpie/usage.jsonl` (2 successes ever, 29–35 s), and a headless Godot 4.7.2 run that generated, saved and reloaded a `SpriteFrames` `.tres`
- Vendor docs — Gemini `image_config` (`8:1`/`4:1` first-class; per-tier pixel sizes), OpenRouter Image Generation (`size` authoritative; mismatched params → 400) and its `ImageConfig` schema, APIMart image docs (`size` exact pixels; per-model ratio sets; the adapter's local table stops at `3:1`)

### Secondary (MEDIUM confidence)
- The consumer's measured prose for grid drift and backdrop drift (`build_handpainted_sheets.py` docstrings, `P2-P3-PLAN.md`) — measurements of a *different transport* (Teamo direct) than the one under test
- Aseprite / TexturePacker / Tiled / LDtk format docs — read for the interop table and for the two conventions worth borrowing (Aseprite's tag shape, TexturePacker's `sourceSize` + `spriteSourceSize`); no consumer exists for them in this pipeline
- PixelLab MCP tool contracts (`animate_character`, `create_character_state`) — used only to confirm that "one call = one strip for all directions" must not be the *only* modelled shape

### Tertiary (LOW confidence)
- Whether magpie `teamo-router/gemini-3.1-flash-image` honours `image_config.aspect_ratio` or a raw pixel size — `[INFERENCE]`; this is Phase 1's entire purpose
- Whether the chat gateways report `usage.cost` — `[INFERENCE]`, contradicted by the cost extractor's own header
- The acceptable per-frame jitter threshold at 512 px cells (the 3.77 px measurement is at 64 px and does not transfer)
- The mirror/permutation tripwire for direction order — a proposed probe, unmeasured because it is not machine-checkable today

---

*Research completed: 2026-10-06*
*Ready for roadmap: yes*
