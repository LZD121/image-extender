# Pitfalls Research

**Domain:** Adding direction × state × frame animation-set generation to an existing AI-art pipeline (image-extender fork → Godot 4.7 consumer `dark-black`)
**Researched:** 2026-10-06
**Confidence:** HIGH on every failure that has already happened (cited to a committed artifact, a measured number, or an engine/route source line). MEDIUM on the ones that are reachable-but-unexercised (the magpie 8:1 passthrough, cost shapes on the magpie path). Each recommendation carries its own HIGH/MEDIUM/LOW; unverified claims are marked `[INFERENCE]`.

This is a **subsequent** milestone: the provider table, `/api/generate`, the post-processing chain, the library and the CLI all exist. Nothing below proposes rebuilding them — every pitfall is about the *new* seam (exact-aspect multi-cell strips, per-frame identity, per-strip resume, atlas consumption) or about reusing an existing helper whose default is wrong for this workload.

Measured evidence gathered for this document (all from the two repos on this machine, 2026-10-06):

| Measurement | Value | How |
|---|---|---|
| Requested vs **returned** 8-direction strip | request `4096×512` (8.000:1) → returned `11712×1408` (**8.318:1**) | `PIL` on `dark-black/assets/handpainted/sprites/{chaser,lunger}/*_8dir.png` |
| Same, 4-direction hero strip | request `2048×512` (4.000:1) → returned `4128×1024` (4.031:1) | same |
| Actual panel spacing inside the returned strip | centres 1390–1506 px apart vs uniform cell **1464 px** | per-column magenta-cast profile of `chaser/idle_f1_8dir.png` |
| Uniform-slice damage | **23 of 32** strips have ≥1 of their 7 cut lines landing on creature pixels; **68 of 224** cut lines total | same profile over all 32 chaser+lunger strips |
| Cross-frame identity drift | mean \|ΔRGB\| **5.9** (chaser) / **7.0** (lunger) per channel, max **74** | mean colour of opaque pixels, frame 1 vs frames 2–4 of one direction row |
| Per-frame vertical jitter after the consumer's own fit | stdev of content height within a 4-frame row up to **3.77 px** on a 64 px cell | alpha bbox over all 128 cells of `sprite-sheet-alpha.png` |
| Shipped atlas margin | min **3 px** (bottom/right), **4 px** nominal | alpha bbox, 128 cells |
| Committed ledger anomaly | chaser `generation-ledger.json` has **17 rows for 16 strips**; `("idle",1)` twice | `json` parse of the committed file |
| Raw strip weight | 16–17 MB each; `assets/handpainted/` **571 MB**; `.godot/imported` **487 MB** incl. 64 imported raw strips | `du` / `ls .godot/imported` |
| Library payload ceiling | 16 raws as base64 = **363.8 M chars** vs `MAX_TOTAL_CHARS` **279.6 M** | arithmetic over the measured 17,055,535-byte strip + `route.ts:16` |

---

## Critical Pitfalls

### Pitfall 1: The app's own aspect table silently downgrades an 8:1 strip — and then the slice force-rescales it back

**What goes wrong:**
`/api/generate` does not send `width`/`height` as a canvas; it sends a *nearest supported ratio* derived from them:

```ts
// app/api/generate/route.ts:7-18, :25-34, :160
const SUPPORTED_IMAGE_ASPECT_RATIOS = ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9'] as const
...
image_config: { aspect_ratio: supportedAspectRatioForSize(width, height) }
```

`8:1` and `4:1` are not in that list. Computed against the real list, **`4096×512` and `2048×512` both resolve to `21:9`** (verified numerically; 8.000 → 21:9 by log-error, 4.000 → 21:9 too). The APIMart adapter has its own table and resolves `8:1` to **`3:1`** (`APIMART_RATIOS` stops at `3:1`; `app/lib/apimartServer.ts:35-51`). So on every path except a raw `width`/`height`-preserving transport, the model is asked for a **2.33:1 or 3:1 canvas while the runner intends to cut 8 equal cells out of it**.

Then the post-processor hides the evidence by *making it fit*:

```ts
// app/utils/imageProcessor.ts:2082-2095
// Normalize to the expected sheet size first so slicing always lands
// on clean cell boundaries, even when the model returns a slightly
// different resolution.
sheetCtx.imageSmoothingQuality = 'high'
sheetCtx.drawImage(img, 0, 0, sheetW, sheetH)   // sheetW = cols*cellSize, sheetH = rows*cellSize
```

A 21:9 reply is resampled into an 8:1 grid: **~3.4× horizontal squash, per direction cell**. Every cell is present, the count assertion (`cells.length === dirs.length`) is green, and the art is destroyed.

**Why it happens:**
The route's aspect list was written for the square/2:1 sprite-and-tile studios (`route.ts:155-159` explains it was added because a missing `image_config` came back square). An N-cell strip is the first workload whose *only* valid ratio is the extreme one, and the list is a closed constant with a nearest-neighbour pick rather than a validation. Nothing in the route can fail, so nothing does.

**How to avoid:**
- The runner must **assert** the geometry it asked for rather than trusting `width`/`height`: compare `returned` (derived from the actual bytes) against `requested` and treat an aspect error above a small tolerance as `ok:false` for that strip. `returned` already exists as a provenance field (`app/lib/libraryCollect.ts:100-101`, populated for the CLI at `cli/commands/studio.mjs:236,395`) — S1 must populate it **for animations too**.
- Make the downgrade impossible rather than merely detected: the anim runner should not go through `supportedAspectRatioForSize` at all. Either (a) the probe (spec §9.1) proves magpie/Teamo passthrough, in which case the transport must carry the exact `width`/`height` and the route must be taught that an N:1 request has an exact ratio, or (b) the runner talks to the Teamo-direct adapter — but the *assertion* stays either way. Never let the 21:9 answer be silently sliced.
- `sliceImageGrid` has no bound on how far it will resample. The anim path MUST NOT call it blind; it needs a pre-check (`Math.abs(returned.aspect - requested.aspect) < tol`) or a fitted-grid slicer (Pitfall 3).

**Warning signs:**
- `set.json` `strips[].requested` says `4096x512` and `strips[].returned` says anything whose ratio is not ~8.0 — `11712x1408` (ratio 8.32) is the *good* case measured today.
- A direction cell looks horizontally compressed when compared against the raw strip.
- The first probe strip (spec §9.1) comes back at 21:9 or 3:1 while `width=4096 height=512` was sent.

**Phase to address:** **Phase 1 (probe + exact-ratio transport)** — this is the one risk the spec already gates the whole milestone on (`spec §9.1`). The *assertion* belongs to Phase 3 (runner), because a transport that works today can regress silently.

**Confidence:** HIGH that the downgrade happens on the app-list path (the two arithmetic substitutions are deterministic and were computed against the shipped constants). MEDIUM that magpie honours `image_config` at all — `[INFERENCE]`, unexercised.

---

### Pitfall 2: The model does not honour the requested cell width, so a uniform slice bleeds neighbours

**What goes wrong:**
The prompt says "a flat 1-row x 8-column strip of 8 equal square cells" and the request says `4096×512`. The model lays out 8 creatures, but **not on a 1464 px pitch**. Measured on the shipped `chaser/idle_f1_8dir.png`: creature centres at 740, 2129, 3617, 5122, 6596, 8078, 9520, 11008 → spacings **1390, 1488, 1506, 1474, 1482, 1442, 1488** (mean ≈ 1467, but the deviation is the point). Over the full 32-strip corpus, **68 of 224 uniform cut lines land on creature pixels**, and **23 of 32 strips** have at least one. The last direction is off by roughly a third of a cell, so a `W//n` crop takes a limb from each neighbour. The 4-direction hero strip is the counter-example and shows why this is not obvious: its measured spacings are 1032/1030/1031 on a 1032 px uniform cell — a clean grid.

**Why it happens:**
Diffusion models lay content out by *visual rhythm*, not by pixel arithmetic. The exact-aspect trick (`gen_assets_teamo.py:10-13`: "8 cells at 8:1 is an EXACT [ratio], so each direction gets a full square cell with no non-uniform resize") buys the correct canvas, not the correct division. This is *already known and documented* by the consumer — `build_handpainted_sheets.py:158-184` searches for `(spacing, phase)` over ±8 % of the uniform cell and warns when the fitted pitch differs by more than 2 %; the measured note there reads "panels are ~1400 px apart on a 1464 px grid… by the eighth direction the offset is a third of a panel".

**How to avoid:**
- Do not assume the grid. Either fit it (the consumer's `panel_boxes()` search: choose the `(spacing, phase)` whose cut lines land on empty columns) or trim each cell to its own blob (`trim_to_blob()`: walk out from the panel centre to the first empty column on each side).
- If the milestone's post-processing is "reuse `sliceImageGrid`" (spec §7.4 names the bridge `sprite-align` op), then slicing stays uniform and the *fix* must be somewhere else: either the prompt gets a gutter big enough to absorb a third-of-a-cell drift (it does not, per Pitfall 4/6), or the runner accepts uniform slicing and the **probe** must measure whether the drift is within the gutter. Make this decision explicitly — "reuse the browser slice" and "the model does not honour the grid" are in direct tension.
- Minimum viable detection: per-strip, compute the column profile of the keyed-out gutter and assert that each cut line sits on a mostly-empty column. That single assertion catches all 68 measured bad cuts.

**Warning signs:**
- A cell in `derived/` has content touching its left or right edge.
- A direction looks like it has an extra limb — or a second small creature (Pitfall 8).
- The `cell i facing dirs[i]` enumeration in the prompt produces 8 plausible cells, but the *number of distinct creatures per cell* is not 8 when you count connected components.

**Phase to address:** **Phase 3 (generate + post-process)** — with a numeric probe in **Phase 1**, because if the probe shows drift outside the gutter, the whole "reuse `sliceImageGrid`" plan for this workload is wrong and Phase 3 changes shape.

**Confidence:** HIGH — measured on the shipped corpus of the exact pipeline this milestone replaces.

---

### Pitfall 3: Slicing at the wrong cell size is silent — the failure is *a different picture*, not an error

**What goes wrong:**
`sliceImageGrid(imageDataUrl, { cols, rows, cellSize })` first resamples the source to `cols*cellSize × rows*cellSize` and then cuts on an exact grid. Three distinct wrong-cell-size failures all produce a **successfully returned array of the right length**:

1. `cellSize` ≠ the intended output cell → every frame is a differently-scaled drawing. (`512` for the anim spec's `cell`, vs the consumer's `CELL=64`; both are "right" but they must be paired with the right downstream scale — see Pitfall 16.)
2. `cols` ≠ the strip's real column count (e.g. a 4-direction hero strip sliced with `cols: 8`) → 8 half-cells, each with a slice of a creature at the seam.
3. The model returned a canvas whose ratio is not `cols:rows` (Pitfall 1) → the resample distorts instead of failing.

**Why it happens:**
The API is by design forgiving — its own comment says it exists so cuts "always land on clean cell boundaries, even when the model returns a slightly different resolution" (`imageProcessor.ts:2081-2084`). That forgivingness was written for a 4×4 tile sheet where ±8 px is a rounding error. For a 8×1 strip of 512 px cells it is a 3.4× distortion channel.

**How to avoid:**
- Assert `returned.width / returned.height ≈ cols / rows` **before** slicing, and fail the strip (keep the raw, mark `ok:false`) rather than slicing.
- Make the slice parameters derived, never restated: `cols = dirs.length`, `rows = 1`, `cell = spec.cell` must come from `planStrips(spec)` output, so CLI and UI cannot disagree (this is the spec's whole `animStrip.ts` rationale).
- Unit-test the algebra (`planStrips` returns the same `width`/`height` the runner sends) and integration-test the short path with a stub gateway at a deliberately-wrong size, asserting `ok:false`.

**Warning signs:**
- A strip "succeeds" but its cells look stretched or its creatures are split at cell boundaries.
- `set.json` `strips[].returned` aspect ≠ `strips[].width / strips[].height`.
- A cell's alpha bbox touches the cell edge on both sides.

**Phase to address:** **Phase 2** (pure algebra + validation) and **Phase 3** (the guard before the slice).

**Confidence:** HIGH (code path read in full; the forgiving resample is explicit and unconditional).

---

### Pitfall 4: The creature touches or crosses the cell edge — the prompt asks, reality refuses

**What goes wrong:**
The consumer's prompt already contains the strongest form of the instruction (`gen_assets_teamo.py:107-108`): "Keep the creature COMPLETELY INSIDE its own cell with a wide magenta gutter on all sides - nothing may touch a cell edge or cross into a neighbouring cell." The model still draws it larger than the cell, and on wide poses (the windup raising its front legs) it crosses the gutter. The consumer's builder exists *because of this*: `trim_to_blob()` exists "because a box holding two creatures is what puts a second, smaller spider in the cell" (`build_handpainted_sheets.py:187-193`), and `keep_main_blob()` exists to delete the detached fragment of a neighbour's limb (`:203-210`).

**Why it happens:**
The instruction is a constraint on composition, and composition constraints lose to the model's prior about how a creature is drawn at scale. There is no penalty the model can feel; the only enforcement is post-hoc.

**How to avoid:**
- Budget for enforcement, not for compliance. Whichever post-processing path the milestone takes, it must include (a) trimming per cell to the connected component containing the cell centre, and (b) a report of how often that was needed. The app already owns the primitive: `isolatePrimarySpriteComponent` (`app/utils/imageProcessor.ts:3132`), reachable through the bridge's `sprite-align` op for non-biped body plans (`cli/native/bridge.mjs:292-299`).
- Detect and *count* rather than silently fix. The consumer's `CARD_REMOVED` counter (`build_handpainted_sheets.py:43-45`) and its `suspect` list (`:373-386`, `card_shaped()`: a real pose fills 0.60–0.80 of its bbox; a card fills >0.92) are the shape to copy: a pass that cannot prove it did work is a gate that can never fail.
- Also budget for the model painting a *card/plate* behind the creature — the same corpus shows the model draws one "on some strips in some directions only" (`:261-267`). It is opaque and pale so the key cannot remove it; the cell ships as a rectangle with a figure in it.

**Warning signs:**
- Content in the corner pixels of a `derived/` frame.
- `isolatePrimarySpriteComponent` returning more than one large component.
- A frame whose bbox fill ratio exceeds ~0.9 (the card signature).

**Phase to address:** **Phase 3** (enforce + count). The *report field* exists in Phase 2's `set.json` (`ok`, plus a per-cell flag) so the UI can surface it in Phase 6.

**Confidence:** HIGH (measured + documented in the consumer's own code).

---

### Pitfall 5: The prompt's direction order is honoured approximately — and nothing but a human can tell

**What goes wrong:**
The contract is `cell i faces dirs[i]`, with `dirs` = the runtime's sector order (east, south-east, south, south-west, west, north-west, north, north-east — `gen_assets_teamo.py:37-40`; `enemy.gd:711-712` `round(angle / (TAU/8)) & 7` from +x, y-down). The model is *told* the mapping per cell, and it usually lands. When it does not, the failure is a set that is **structurally perfect and semantically wrong**: every cell carries a creature, the grid is right, and south-west is drawn as west. Worse, the two likeliest errors — a permutation and a **mirror** — are invisible to every structural assertion you can write.

**Why it happens:**
Two things push against it. (a) The list is a *text* enumeration inside a long prompt; the model has to keep eight bindings straight while also solving "same creature, different pose". (b) The consumer's own hero path is a mirror (`player.gd:595-603`: `Dir.LEFT` reuses the side rows and sets `_visual.scale.x = -1`), so a model that has learned "left is a flipped right" from human sprite sheets will happily mirror. That is exactly why the consumer's manifest names the hero's four directions `down, side, up, back` and warns: "NOT the sector order -- naming them DIRS8[:4] would label the side drawing 'south-west' in the manifest" (`build_handpainted_sheets.py:50-53`).

**How to avoid:**
- Keep the enumeration literal and enumerated (one line per cell, index-bearing) exactly as the consumer's `build_prompt()` does — a single "the cells face the 8 compass directions in order" sentence is not the same prompt.
- Make the *contract* machine-readable and testable in the one place it can be: `set.json` stores `dirs` **verbatim** and `frames[]` carries `index` + `dir`; the engine adapter (S2) reads the list, never re-derives it.
- Build the human-review artefact the consumer already proved necessary: `_preview/<actor>_dirs.png` — one row per sector, one column per state, frame 1 only, ×2 zoom. The consumer's own note says a 32-row sheet is "8 screens tall and nobody reads it" (`build_handpainted_sheets.py:344-358`). Copy this into the UI's frame gallery as the *direction matrix* view.
- Cheap structural tripwire: mirrored sequences are detectable as a **horizontal-symmetry anomaly** — compare cell *i* against the mirror of cell *j*; a set where several pairs are near-mirror-identical is a strong hint a permutation or mirror happened. `[INFERENCE]` — this is a proposed probe, not a measured one.

**Warning signs:**
- Two directions look like mirror copies of each other.
- The direction-matrix preview reads clock-wise in a different order than east→NE.
- `north`/`south` rows show identical silhouettes (top-down creatures seen from directly above and below are similar; the model may collapse them).

**Phase to address:** **Phase 2** (the enumeration is `animStrip.ts`'s job, and its test must assert all N mappings are present and in order) + **Phase 6** (the direction-matrix review view).

**Confidence:** MEDIUM-HIGH. The order contract is HIGH (read from both sides). The frequency of the model getting it wrong is unmeasured — it is not machine-checkable today, which is itself the finding.

---

### Pitfall 6: The background is neither flat nor reliably magenta

**What goes wrong:**
Every prompt asks for "a perfectly flat pure magenta #FF00FF background". Measured on the consumer's roster: **one pass came back `FF07F6` (magenta cast 237), the next `DFC7D2` (cast 12 — almost pink-white)**, and the magenta field itself carries a gradient, drifting up to 100 channels from its own mean. Additionally the model paints a **saturated magenta gutter between panels that differs in colour from the pale field inside each panel** (gutter cast 160+ vs interior) and runs the full cell height — so a naive bounding box is the whole cell height for every direction.

Consequences, in order of nastiness:
1. A key that assumes "is this pixel magenta" (`cast >= 80`) leaves the pale `DFC7D2` field **fully opaque**: every cell ships as a solid rectangle and the creature is invisible on the magenta plate.
2. A key that uses "distance from the sampled field colour" with a *soft alpha ramp* turns the entire field translucent → every cell gets a pink wash instead of transparency.
3. The vertical magenta gutter participates in every bbox measurement (Pitfall 11/12).

**Why it happens:**
The model treats the background as *imagery*, not as a keying surface. Two runs of the same prompt produce different backdrop colours; there is no setting that fixes it. This is measured, written down in the consumer's keying docstring (`build_handpainted_sheets.py:70-92`) and in its P2 findings (`docs/handpainted/P2-P3-PLAN.md:122`).

**How to avoid:**
- Key on a **measured** field colour, not a constant: sample the border ring of the cell, take the modal quantised colour, decide *once* whether the field is magenta-ish (`min(r,b) - g > 20`), and pick the rule from that.
- Keep the mask **binary**. The consumer's docstring is explicit: "An alpha ramp keyed on distance leaves a translucent panel over the whole cell -- the same error in the other direction" (`:104-106`).
- The app's `chromaKeyToAlpha` (`imageProcessor.ts:1445`, presets in `app/lib/chromaPresets.ts`) is the reusable implementation, but note its defaults are calibrated for *parallax/props*, not for a pale-field strip: `default: { castThreshold: 80, castSoftness: 30 }` with a **soft ramp** is precisely rule (2) above. The bridge exposes the preset by name (`cli/native/bridge.mjs:156`); for the anim path the honest options are the `tile` preset (aggressive, `castThreshold: 40`) *plus* a field-colour decision the app does not currently make. Decide this in Phase 3 and record which preset was used in `set.json`.
- Do not treat "the whole cell came back opaque" as a success. That is the signature of rule (1): assert that each sliced cell has a *background* fraction above some floor.

**Warning signs:**
- `derived/` frames are squares of magenta with a creature in them.
- The keyed frame's alpha histogram has a large mass at ~200 alpha (a ramp) rather than two spikes at 0/255.
- `chromaKeyToAlpha` output looks right in the browser preview (light background) but wrong composited on dark.

**Phase to address:** **Phase 3** (keying is post-processing), with the *decision* recorded in the spec: which preset, which fallback, and the binary-mask assertion.

**Confidence:** HIGH (the two backdrop colours are measured quotes from the consumer's own code; the preset defaults are read from source).

---

### Pitfall 7: Alpha and edge artefacts after keying — halo, despill drift, and the painted cell border

**What goes wrong:**
Four distinct artefacts, each with a different tell:
1. **Magenta halo**: a fully-opaque edge pixel that is still pink. The app's key despills *every* pixel with cast > 0 (`imageProcessor.ts:1512-1520`), which is the fix — but the anim strip's creature sits on a magenta field at 512 px cells, so the anti-aliased boundary is wide and any pixel the key classifies as opaque keeps its hue shifted.
2. **Pale fringe**: with a soft ramp, a 1–2 px translucent rind survives around the silhouette; when composited on a dark dungeon floor it reads as a light outline.
3. **Painted cell border**: the model draws faint cell-divider lines or a panel frame despite the prompt forbidding it ("no grid lines, no cell borders, no labels", `gen_assets_teamo.py:111`). These lines are not magenta, so keying keeps them and every frame ships with a dark square outline. The app has a dedicated pass for this: `removeFrameBorder` (`imageProcessor.ts:2914`, coverage 0.7 of an edge). The consumer has the *other* failure mode documented: the model sometimes draws a pale **plate** behind the creature that the border pass cannot touch (`build_handpainted_sheets.py:261-267`).
4. **Border pass false positive**: `removeFrameBorder` clears any row/column opaque across ≥70 % of the edge. A creature that genuinely spans the cell (a long low quadruped at a 512 px cell, or a horizontally-lying serpent) can trip it and lose a real row of pixels.

**How to avoid:**
- Run the border pass, but **count its effect** and record it. `cli/native/bridge.mjs` counts `borderFailed` only in the `prop-sheet` op (`:172`) — the `sprite-align` op catches the throw and says nothing (`:287-291`). Add the count on the anim path or use `chroma` per cell and call the pass explicitly.
- Assert on the *result*, not on the pass: after keying+border, each cell's alpha bbox must be strictly inside the cell with ≥1 px of margin (Pitfall 12), and the corner pixels must be transparent.
- Prefer the strip-level, binary, field-aware key (Pitfall 6) over the soft-ramp preset; the ramp is what produces the rind.

**Warning signs:**
- A 1 px light rind around every frame in the direction matrix preview.
- A frame that is 2 px smaller than its siblings in both dimensions (border-pass false positive).
- Frames that look like they sit on a dark rectangle.

**Phase to address:** **Phase 3.**

**Confidence:** HIGH for the code paths and the consumer's plate/border notes; MEDIUM for how often `removeFrameBorder` false-positives on a 512 px cell — `[INFERENCE]`, unmeasured at that cell size.

---

### Pitfall 8: Cross-frame identity drift, one cell holding two creatures, and frame-count mismatch

**What goes wrong:**
Three per-cell-content failures that all survive every structural assertion:

1. **Identity drift.** Each strip is an independent generation (`Σ states.frames` calls), so nothing ties frame 2's creature to frame 1's. Measured on the shipped atlas: mean \|ΔRGB\| per channel **5.9** (chaser) and **7.0** (lunger) between frame 1 and frames 2–4 of the *same* direction, max **74**. The spec concedes this ("逐帧独立生成会有跨帧漂移", spec §9.3) and defers the identity anchor to §12.
2. **Two creatures in one cell.** A neighbour's limb crosses the gutter and survives as a detached fragment — at 64 px it "reads as a second creature standing next to the first" (`build_handpainted_sheets.py:203-210`). The app can detect it: `duplicateFlag` in the bridge (`cli/native/bridge.mjs:127-144`) flags a frame whose alpha profile has a second mass ≥45 % of the first, and reports the indices as `duplicateFrames`. **That detection is only wired into the `sprite-align` op**, which the spec's plan does not necessarily use.
3. **Frame count mismatch.** `enemy.gd:42-53` states the consequence in prose: the grid rule `frame = row * FRAMES + col` is valid only while every row is the same width, and "the moment one row has a different count the grid SILENTLY addresses the wrong cells and no signal exists to say so". `FRAMES := 4` is a constant in three places (`enemy.gd:51`, `player.gd:58`, `enemy.tscn vframes`) and asserted today **only at `check_enemy.gd:1084`** — note that `player.gd:63` cites `tools/check_timeline.gd` for the same assertion, but that gate was **deleted** (`player.gd:128,233` say so), so the comment is stale and only one gate stands between a per-state frame count and a silently mis-addressed grid. A set that produces 3 frames for `attack` and 4 for `idle` is not "mostly fine" — it is silently wrong from that row onward.

**Why it happens:**
(1) is the model's nature; (2) is the composition failure of Pitfall 4; (3) is a *producer* decision (the spec allows per-state `frames`) that collides with a *consumer* constant. The consumer's own generator does not have this problem because it hard-codes `frames: 4` per actor.

**How to avoid:**
- Uniform frame count: either the spec forbids a per-state frame count for the first consumer, or the engine adapter must write `vframes`/`FRAMES` from the set rather than from a constant. Decide in Phase 2 (`animSet.ts` validation: "all states must have the same `frames`" as a first-consumer constraint) and record it in `set.json` so S2 can honour it.
- Wire the duplicate-mass detector into the anim path (it is a pure alpha-profile test, already written) and surface `duplicateFrames` per strip in `set.json`.
- Cheap, honest cross-frame report: record the per-frame alpha-bbox aspect and the mean opaque colour in `set.json` (`strips[]`/`frames[]`) so a drift is *visible as data*, even when nothing fails. The consumer's ledger records `seconds` and `prompt` and nothing about the picture — that is why the drift was only discovered by eye.
- Do not build the identity anchor in S1 (spec §12 is right), but do not make it impossible either: the reference-image order the route expects is fixed and documented (`route.ts:93-123` — IMAGE 1 identity, IMAGE 2 pose), so a later `spriteIdentityImage`-equivalent is a wire field, not a redesign.

**Warning signs:**
- A direction row's frames look like four different creatures (visible in the direction matrix preview).
- `duplicateFrames` non-empty.
- A state's frames ≠ the other states' frames.
- `attack_f3` shows a different armour colour from `attack_f1`.

**Phase to address:** **Phase 2** (frame-count validation + `set.json` fields) and **Phase 3** (duplicate detection, drift metrics).

**Confidence:** HIGH on drift (measured), HIGH on the frame-count consequence (consumer code says so in prose), HIGH on the duplicate detector's existence and location.

---

### Pitfall 9: Non-integer scaling softens the art before it ever reaches the engine

**What goes wrong:**
Two resamples happen between the model and the shipped cell, and neither is integer-scaled in general:

- `sliceImageGrid` resamples the whole strip (`cols*cellSize × rows*cellSize`) with `imageSmoothingQuality = 'high'` — measured target: 11712×1408 → 4096×512, i.e. **×0.3497 in X and ×0.3636 in Y** (non-uniform, because the returned ratio is 8.318 not 8.000).
- `normalizeSpriteFrameScale` rescales each cell to the median bbox diagonal, clamped to ±18 %, with `imageSmoothingEnabled = true` and a **silhouette-centre pivot** (`imageProcessor.ts:2820-2862`).

The consumer's equivalent resample is careful about exactly this: `fit_panel` composites the crop over the sampled field colour *first*, because "a straight RGBA resize averages the keyed-out backdrop's RGB (still magenta, alpha 0) into every edge pixel and paints a coloured halo round the sprite" (`build_handpainted_sheets.py:326-333`). It also chooses `Image.BOX` when shrinking and `LANCZOS` when growing, and resizes the alpha channel separately from the RGB. A straight RGBA `drawImage` does none of that.

**Why it happens:**
The browser post-processing chain was built for props and pixel art where a fractional resample is either invisible or irrelevant (the pixel line *decimates* by block rather than scale, `app/utils/pixelGrid.ts`). For hand-painted art going into a 64 px cell, the resample is the main visual-quality decision and it is currently an unexamined side effect.

**How to avoid:**
- Give the anim path a chosen, stated scale policy: request a canvas whose cells are an integer multiple of the output cell (e.g. `cell = 512 → 64` is exactly 1/8), and pick aspect tolerance such that the X and Y factors are equal. With `cell = 512` and a *correct* 8:1 reply the factors are equal; with the 8.318 reply they are not.
- If a per-cell rescale is needed, composite over the measured field colour before resampling (the consumer's trick), and keep the alpha channel out of the colour average.
- Consider not calling `normalizeSpriteFrameScale` at all for direction strips: it equalises size *across directions of the same frame*, which is what "same creature, different angle" needs — but it does it by rescaling drawings that a perspective change legitimately sizes differently (a south-facing and a north-facing view of the same creature are not the same bbox). `[INFERENCE]` on whether it helps or hurts here; the safe first move is to run it off and compare the direction matrix.

**Warning signs:**
- Edges look soft/painterly where the source strip is crisp.
- A coloured rim on the silhouette (the magenta-averaging failure).
- Directions of one state have visibly different creature sizes beyond the perspective difference.

**Phase to address:** **Phase 3** (a stated scale policy + one measured comparison in the E2E).

**Confidence:** MEDIUM-HIGH. The code paths are HIGH; which policy is *right* is a judgement to be measured — flagged as such.

---

### Pitfall 10: Trimming differently per frame makes the animation jitter

**What goes wrong:**
Each frame is trimmed to its own alpha bbox and then re-seated. If the fit metric differs frame to frame, the creature appears to bob or breathe in a way that was not drawn. Measured on the *shipped* consumer atlas: within a single 4-frame direction row, the content height's stdev reaches **3.77 px on a 64 px cell** (row 9: heights 57, 48, 56, 57), and the shipped minimum margin is 3 px on a 64 px cell with `INNER=56` — i.e. the current pipeline already has ~6 % frame-to-frame size jitter, and it is invisible in any structural check.

**Why it happens:**
`fit_panel` scales by `min(INNER/cw, INNER/ch)` — a **max-dimension** fit — so a pose that is wide but short lands at a different apparent height than a pose that is tall but narrow. That is a deliberate choice (never overflow the cell) with a known cost. `normalizeSpriteFrameScale` uses the bbox **diagonal** as the metric (a different, better pose-stable choice, `imageProcessor.ts:2826`) and clamps to ±18 %, which bounds the jitter but does not eliminate it.

**How to avoid:**
- Pick the size metric once and use it for every frame in a set — and prefer a *pose-stable* one (diagonal, or height-with-clamp) over max-dimension.
- Anchor the vertical placement to the shared floor, not to each frame's own bbox centre, **but only if the directions agree on where the floor is** (see Pitfall 11).
- Measure it: emit the per-frame bbox into `set.json` and assert the stdev within a (state, direction) row is below a threshold. This is the one animation-quality failure that *is* machine-checkable, so it should be.

**Warning signs:**
- Playback (or the direction matrix) shows a pulse unrelated to the requested motion.
- Per-frame bbox heights within one row vary by >2 px on a 64 px cell.

**Phase to address:** **Phase 3**, asserted in the E2E (**Phase 7**).

**Confidence:** HIGH on the measurement; MEDIUM on the acceptable threshold at 512 px cells (`[INFERENCE]` — the 64 px measurement does not transfer directly).

---

### Pitfall 11: Baseline alignment fights the direction axis — and the bridge op the spec names always runs it

**What goes wrong:**
Two independent statements in the milestone spec and the consumer conflict with the code the spec says to reuse:

- Spec §7: "**不做基线对齐**（不用 `alignSpriteFramesToBaseline`）：跨 8 个方向做统一基线会让俯视/仰视格互相打架" — do not baseline-align, because a shared baseline makes top-down and bottom-up cells fight each other.
- The consumer agrees: its fit is "trim to the creature's own alpha bbox → seat it in a fixed inner box", not a shared baseline (`build_handpainted_sheets.py:315-337`).
- But `cli/native/bridge.mjs`'s `sprite-align` op — the op the spec names in §7.4 — **unconditionally** runs `normalizeSpriteFrameScale` → `alignSpriteFramesToBaseline` → `centerSpriteFramesHorizontally` with `targetBaseline: cell * 0.9` (`:304-309`). There is no flag to skip it.

So "reuse the bridge op" and "no baseline alignment" cannot both be true without either changing the op or not using it. Worse, if the op *is* used, the top-down and bottom-up directions get their bottoms planted on a common line, and the creature silently shrinks or stretches to obey it — `shiftCellVertical` translates the whole cell (clipping at the edges, `imageProcessor.ts:2411-2423`), so content pushed past the cell edge is **lost**, not wrapped.

**Why it happens:**
The op was authored for the *sprite* studio, where one animation of one character is aligned for a side-view platformer. The direction axis is new, and `groundAll`'s own doc says it is for "idle / walk / attack / hurt / death" in a side view (`imageProcessor.ts:2349-2354`).

**How to avoid:**
- For the anim path, do **not** call `sprite-align` as a unit. Compose the ops the runner actually wants: `slice` (or a fitted slicer) → `chroma` (with the chosen preset) → `removeFrameBorder` → centring. The bridge already exposes `slice` and `chroma` separately (`:155-160`, `:179-184`); the extra is the trim/fit step, which the app owns as `normalizeSpriteFrameScale`/`centerSpriteFramesHorizontally` but the bridge does not expose without the baseline pass.
- If a new composite op is added (e.g. `anim-cells`), its *name* should say what it does and it should carry `align: false` by default for this use — and its unit test must assert that a deliberately high-riding frame is **not** moved.
- Whatever is chosen, the *contract* the consumer needs is documented in its manifest as geometry the engine reads; S2 derives it from `set.json`, so an alignment choice that is not recorded in `set.json` is a choice the engine cannot reproduce.

**Warning signs:**
- A direction's creature is vertically clipped at the cell edge.
- Top-down and bottom-up cells show creatures at implausibly different apparent sizes.
- The alignment diagnostics (`detectedBottoms`, `baselineShifts`) show large shifts — the op returns them, so this is free to assert on.

**Phase to address:** **Phase 3** — this is a *design decision that must be made before the runner is written*, because it determines whether `sprite-align` is reusable at all for this workload.

**Confidence:** HIGH (the conflict is a direct read of `bridge.mjs:304-309` against spec §7).

---

### Pitfall 12: A silent no-op in a post-processing step is indistinguishable from success

**What goes wrong:**
The `sprite-align` op wraps two of its three steps in empty catches:

```js
// cli/native/bridge.mjs:286-299
let u = await IE.chromaKeyToAlpha(cell)
try { u = await IE.removeFrameBorder(u) } catch (e) { /* keep the un-cropped frame */ }
if (opts.bodyPlan && opts.bodyPlan !== 'biped') {
  try { u = await IE.isolatePrimarySpriteComponent(u, { enableSplit }) } catch (e) { /* keep the original frame */ }
}
```

A throw from either pass yields a *valid* image, a successful op, `ok: true` in the result, and no counter. By contrast, `prop-sheet` counts exactly this (`out.meta.borderFailed`, `:172`) and the consumer's builder counts its card removal and prints it (`CARD_REMOVED`, `build_handpainted_sheets.py:43-45,456`). The gap is a gate that can never fail: "the border pass ran" is asserted by nothing.

This is the repo's own recorded failure shape, in a different place: `enemy.gd:255-260` — "add_animation_library has been measured returning OK with an empty library (01-REVIEW C1's false-green shape)".

**Why it happens:**
A pipeline of image transforms is naturally written as "best effort per step", because each step is heuristic. The cost is that the *pipeline's* success signal stops meaning anything, and the only way to notice is to look at the picture.

**How to avoid:**
- Every optional step in the anim path gets a counter or a boolean in the result, and `set.json` records it per strip (`{ slice: 'fitted'|'uniform', chroma: 'tile', border: 2, isolate: 1 }`). A zero where a non-zero is expected is then visible in the artefact itself.
- Do not let a step's failure set `ok: true` silently. Define which steps are *required* (slicing, keying) and which are *best-effort* (border, isolate), and record both.
- Test the no-op: an integration test that feeds a cell with no border and one with a border must produce different recorded counts.
- Note the same shape elsewhere in the milestone's own plan: "cells == dirs" is a *count* assertion which is vacuously true for a 21:9 reply sliced into 8 columns (Pitfall 1). Prefer assertions on geometry over assertions on counts.

**Warning signs:**
- `borderFailed`/similar counters absent from the anim result.
- A run where every post-processing counter is 0 — either the passes are no-ops or they are not being counted.

**Phase to address:** **Phase 3** (counters) and **Phase 2** (`set.json` field shape).

**Confidence:** HIGH (code read; the consumer's counters prove the intended pattern).

---

### Pitfall 13: Resume-on-file-existence over a non-atomic writer means a crashed frame is skipped forever

**What goes wrong:**
The spec's resume rule is "已完成的 strip 已落盘，重跑时跳过" (§8) — completed strips are on disk, so a rerun skips them. That is correct only if "on disk" implies "complete". The CLI's writer is not atomic:

```js
// cli/lib/media.mjs — writeDataUrl
mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
writeFileSync(outPath, Buffer.from(dataUrl.slice(m[0].length), 'base64'))
```

A crash, a full disk or a Ctrl-C mid-write leaves a **truncated PNG at the final path**. On the next run, `nextPending` sees the file and skips it; the strip is never re-fetched. The result is a set with a corrupt frame that no assertion on file *presence* can catch. (The library writer is careful about exactly this — temp dir + atomic rename, `app/lib/library.ts:96-111` — and `cli/commands/config.mjs:71-86` does the same for the config file. The image writer is the one that is not.)

A second, subtler version: a strip that completed the network call but failed post-processing. If "done" is defined by the `raw/` file existing, the derived frames are never produced and the strip is never retried.

**Why it happens:**
File existence is the cheapest possible durable record and the consumer's generator uses it too — but the consumer writes its `raw` via a Python `write_bytes` after the response is fully in memory, and its ledger row is written *after* the file. The failure window is the same, it has just not been hit yet.

**How to avoid:**
- Atomic writes for every artefact: temp file in the same directory, `renameSync` into place. Two lines, and the pattern already exists in the repo twice.
- Define "done" from the **record**, not from the file: `nextPending` should require a `strips[]` entry with `ok:true` **and** the raw file **and** (for a derived-frame set) the expected derived count. `set.json` is written progressively? Then it must be written atomically too, or the record must live in a small append-only journal written atomically per strip.
- Validate on skip: when skipping a strip, verify the raw decodes (`sharp(file).metadata()` — already available as `cli/lib/media.mjs:imageSize`) before trusting it. A decode failure means re-fetch.

**Warning signs:**
- A `raw/` file that `sharp` cannot open, or whose dimensions equal `0×0`.
- A completed run whose derived count ≠ Σ over states.dirs.
- `set.json` listing a strip with `ok:true` and no `derived/` frames for it.

**Phase to address:** **Phase 2** (`nextPending`'s definition) and **Phase 3** (atomic writer).

**Confidence:** HIGH (the non-atomic writer and the atomic ones are both readable in the same repo).

---

### Pitfall 14: Double-spend on re-runs — and a committed ledger that already shows it

**What goes wrong:**
A rerun either (a) refuses to re-generate anything already present (no recovery from a bad-but-complete frame), or (b) re-generates everything (full double spend). And the *ledger* can double-count independently of the spend: the consumer's committed `assets/handpainted/sprites/chaser/generation-ledger.json` holds **17 rows for 16 strips**, with `("idle", 1)` appearing twice at 33.5 s and 66.0 s. The cause is visible in git history: the original writer appended (`git show e503ae1:tools/gen_assets_teamo.py` → `led.write_text(json.dumps(prev + ledger, indent=2))`); the current version merges by `(state, frame)` (`gen_assets_teamo.py:181-185`, "a re-run replaces its row: the file was replaced too"). The stale duplicate is still committed.

**Why it happens:**
The spend is per HTTP call; the record is per file. Any mismatch between "which strips should exist" and "which calls were made" is invisible unless the record is keyed and merged deterministically. The `--redo` flag (spec §6.1) is exactly the valve, and it must be *scoped* or it re-spends the whole set.

**How to avoid:**
- One key for everything: the `(state, frame)` pair (or `strips[].index`) identifies a strip in the plan, the raw file, the `set.json` entry and the ledger. Merge by key; never append. Assert uniqueness (`new Set(keys).size === keys.length`) — that single line would have caught the committed duplicate.
- Per-frame redo, not per-set: `--redo idle:3` (or a `--only` selector). The plan/resume split gives 90 % for free; the selector is the cheap, high-value extra. This is the difference between "fix one bad frame" and "re-spend 16 calls".
- Record the **actual call count** in `provenance.params.calls` (spec §5.4), and assert it equals the number of `ok:true` strips in a clean run. A run that reports 17 calls for a 16-strip plan is stating the double-spend in its own provenance.
- Gate every spend behind the plan + explicit `--go` on the CLI and a second confirm in the UI, with the **call count and per-call canvas** printed (spec §2.4) — the consumer's dry run prints only filenames (`:144-148`), which is not enough to decide.

**Warning signs:**
- A ledger/`set.json` with fewer unique keys than rows.
- `provenance.params.calls` > `Σ states.frames`.
- A rerun that takes as long as the first run.

**Phase to address:** **Phase 2** (key + uniqueness) and **Phase 4** (flags: `--redo`, scoping, the printed plan).

**Confidence:** HIGH (the duplicate row is committed in the consumer repo and its cause is in the git history).

---

### Pitfall 15: Provenance lies about the backend, and the cost's unit and source are wrong

**What goes wrong:**
The library's provenance is the only record of what produced an asset, and right now it is falsifiable in three ways:

1. **Backend is a two-value allow-list.** `BACKEND_LABELS = ['openrouter','pixellab']` (`app/lib/libraryCollect.ts:20`), and the route's `pickBackendLabel` maps *anything else* to `'openrouter'` (`app/api/library/[[...path]]/route.ts:33-35`). The provider table has three ids (`PROVIDER_IDS = ['openrouter','magpie','apimart']`, `app/lib/providers.ts:42`). So a Magpie or APIMart generation saved from the UI records `backend: "openrouter"`. Meanwhile the CLI path writes `profile.provider` straight to disk (`cli/commands/studio.mjs:47-55,258`) and `ie library save` **hardcodes `backend: 'openrouter'`** (`cli/commands/library.mjs:166`) — and the anim milestone plans to reuse exactly that command (`spec §6.1`: "入库不新增命令：复用 `ie library save`").
2. **Cost's source is hardcoded.** `extractCost` returns `{ usd: cost, source: 'openrouter' }` unconditionally (`app/lib/generateCost.ts:11-15`), and it is the only extractor on the chat path — so a magpie call that reports `usage.cost` is recorded with `source: 'openrouter'`. APIMart's cost is read separately as a plain number and wrapped as `source: 'apimart'` (`app/lib/imageGeneration.ts:137-139`, `app/lib/apimartServer.ts:167-170`): same field, two shapes, one of them mislabelled.
3. **`cost` is a dead field on the web path.** `CONCERNS.md` records it: `collectStudioAsset` has no cost input, the collector calls pass no cost, so `provenance.cost` is always `null` for web-saved assets, while the CLI's studio commands do populate `manifest.cost` (not `provenance.cost`).

The milestone's own success criterion is "后端可追溯" (fork spec §2.3) — "backend traceable". A field that is *always* `openrouter` is worse than absent: it is confidently wrong.

**Why it happens:**
`BACKEND_LABELS` was widened for the pixel line (`pixellab`) before the provider table gained `magpie`/`apimart`; the route's allow-list and the CLI's hardcode are two independent copies of one fact. This is the repo's own "one home per fact" rule being violated, and `CONCERNS.md` already names the fix: `type BackendLabel = ProviderId | 'pixellab'` derived in `libraryCollect.ts`, used by both the route and the CLI.

**How to avoid:**
- Fix the enum as `CONCERNS.md` proposes (three lines), and make the anim path pass the *real* provider from the resolved backend, on both the CLI and the UI.
- Record the **requested** and **returned** size per strip (Pitfall 1 depends on this) and the cost **as reported by the serving gateway** with the gateway named as the source. When the gateway reports nothing, `null` — never a fabricated `openrouter`.
- Do not introduce a second cost unit in S1 (spec §5.4 is right): put `{calls, cells, seconds}` in `provenance.params` and keep `cost` as `{usd, source} | null`. But **assert** that when `cost` is non-null its `source` equals the recorded `backend` — a one-line consistency check that would today fail on the magpie path.
- Note the same class of bug for the UI: `KIND_KEY` in `LibraryPanel.tsx:28-34` is a `Record<AssetKind, string>`, so a new `animations` kind is a compile error there (good), but `ASSET_KINDS` is also consumed by `library.ts:155` and the route's `isValidKind` — adding the kind without an i18n label fails `tsc` (good) and without a collector branch fails `tsc` (good). The *labels* are the only non-compile-checked surface; add both `en` and `zh` (`shell.ts:72-78`).

**Warning signs:**
- `meta.json` shows `backend: "openrouter"` for a generation made with the Magpie gateway selected.
- `provenance.cost` non-null while `backend` is `magpie`.
- `cost.source !== backend`.

**Phase to address:** **Phase 5 (library kind + provenance)** — before the E2E, because the E2E is the acceptance evidence and it would otherwise enshrine the wrong label.

**Confidence:** HIGH (every line cited is readable; `CONCERNS.md` independently documents the same bug for the existing studios).

---

### Pitfall 16: Raw outputs bloat the repo — and Godot imports them anyway

**What goes wrong:**
The evidence, measured:
- One raw 8-direction strip is **16–17 MB** (`idle_f1_8dir.png` = 17,055,535 bytes). A 16-strip set is ~270 MB; the consumer's `assets/handpainted/` is **571 MB** on disk.
- The consumer solved it in `.gitignore` (lines 111–112) after the fact: `assets/handpainted/sprites/*/*_[0-9]dir.png` **and** its `.png.import`. The rule is not in the producer.
- Git history already carries at least one raw strip: the 2026-10-04 commits landed them before the ignore rule, and `.git` is **62 MB** with a 43.96 MiB pack.
- The library's own gitignore is *only* `assets/**/raw/` (`.gitignore:51`) — correct for the library's `raw/`, but the anim `--out` directory is wherever the spec says, and the spec's own layout (`<out>/raw/…`, `<out>/derived/…`) is only ignored if it lives under a library root.
- **Godot imports ignored files anyway.** `.godot/` is **487 MB**, including **64** imported copies of raw strips that are not in git. `.godot` is ignored, so this is not repo growth — it is *disk* growth plus a full re-import pass on every clone, and it is what happens when an asset directory is inside a Godot project's `res://` tree.

**Why it happens:**
The raw output is 8× the information the shippable frame needs (a 512 px cell holding a 64 px creature) and it is PNG-compressed photographic-ish pixels. The derived frames are ~370 KB each (`512×512 RGBA` measured 368,326 bytes), so a 16-strip set's derived set is ~100 MB — also too big to commit as a *library* asset without a policy.

**How to avoid:**
- The producer must state the policy, not inherit the consumer's: `raw/` never versioned (matching the library's existing rule), `derived/` versioned only if the cell size is engine-ready. For the first consumer (64 px cells) that means the derived set is 128 × ~10 KB and trivially committable; the S1 spec's `cell: 512` produces 128 × ~370 KB = ~47 MB per set, which is a deliberate, expensive choice.
- Decide the *delivery* cell size in S1: if the set is meant to feed a 64 px atlas, generating at 512 and shipping at 512 is 64× the bytes the engine needs and forces a second resample (Pitfall 9). Generating at 512 and shipping at 64 is one resample, done once, with a chosen filter.
- Keep the raw strips **out of the Godot project tree** — put `--out` outside `res://`, or ensure the ignore covers both the PNG and its `.import`. An ignored source file still gets imported if it sits under `res://` (verified: 64 `.import` files exist for ignored strips, and `.godot` is 487 MB).
- Enforce the payload ceiling: **16 raw strips as base64 = 363.8 M chars, above the route's `MAX_TOTAL_CHARS` of 279.6 M** (`route.ts:14-16`). A naive "save the whole set as one library asset including raws" POST fails with 413 — and only *after* `await request.json()` has buffered the body, per `CONCERNS.md`. Save `derived/` + `set.json` (and at most one raw) through the library; keep the rest on disk.

**Warning signs:**
- `git status` showing `*_8dir.png` as untracked-but-not-ignored.
- A clone that needs 500 MB of import cache for a handful of 64 px sprites.
- A library save returning 413.

**Phase to address:** **Phase 4/5** (the output-layout and library-payload decision) and **Phase 7** (the retirement step — the ignore rules must move into the producer's docs).

**Confidence:** HIGH (all sizes measured on this machine).

---

### Pitfall 17: Consumer side — filter mode, atlas bleed, pivot, row order, and per-frame PNGs

**What goes wrong:**
Five ways the produced set is *correct* and the game still renders it wrong. Each is verified against Godot 4.7 source or the consumer's committed config:

1. **Filter mode.** The consumer's project default is `textures/canvas_textures/default_texture_filter=1` (`project.godot:77`). Index `1` in the project setting maps to `Viewport::DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST` (enum order in `viewport.h:192-199`; the setting is applied via `GLOBAL_GET(...)` at `main/main.cpp:4685-4688`). So nearest is *on* today — but `CanvasItem.TEXTURE_FILTER_PARENT_NODE` is `0` and, when a `CanvasItem` resolves to parent-node with no ancestor `CanvasItem`, the engine falls back to **LINEAR** (`viewport.cpp:4053-4068`). A new node that explicitly sets filter `0`, or a future project-default change, silently puts the sprite back on bilinear. The anim set gives no protection; only `check_settings.gd:18` asserting the project key does.
2. **Atlas bleed.** `Sprite2D`'s `hframes`/`vframes` path sets `r_filter_clip_enabled = false` unconditionally (`sprite_2d.cpp:98-105`), and `AtlasTexture.filter_clip` defaults to **`false`** (Godot 4.7 `AtlasTexture` docs). So the hframes route the consumer uses has **no clip protection**: bleed prevention is entirely a function of nearest sampling, exact integer cell math, and the source sheet having no bleeding content at cell boundaries. `AtlasTexture.margin` is *not* an extrusion setting — it only changes the drawn rect ("The margin around the region. Useful for small adjustments. If the `Rect2.size` … is set, the drawn texture is resized to fit within the margin") — so a producer that adds "extrude/margin" expecting bleed protection gets a resized sprite instead.
3. **Pivot mismatch between directions.** `Sprite2D.centered` defaults to `true` and `offset` to zero, so the pivot is the **cell centre** (`sprite_2d.cpp:117-125`: `dest_offset = offset - frame_size/2` when centered). A production pipeline that trims each frame tight and packs cells of differing sizes moves that centre per frame — every direction then rotates/bobs around a different point. This is why the consumer's `fit_panel` seats every creature centred in a fixed `CELL` with a fixed `INNER` box (`build_handpainted_sheets.py:315-337`) and why the shipped atlas has a uniform 3–4 px margin on all 128 cells. Also note the windup's 3 px pose offset is applied to the **whole node** (`enemy.gd:600`, `_visual.position.y`), not to the cell — safe.
4. **Row order.** The runtime computes the row as `row = _sector_index(_face_dir) * N_STATES + state` and the frame as `row * FRAMES + _frame` (`enemy.gd:585-598`), with `_sector_index(dir) = int(round(dir.angle() / (TAU/8))) & 7` from +x (`:711-712`). `N_STATES * 8 = 32` is written into `vframes` in three places (`enemy.gd:193`, `enemy.tscn`, and asserted by `check_enemy.gd:1080-1085`). A producer that emits `dirs` in any other order — alphabetical, counter-clockwise, or `down, side, up, back` for a monster — produces a set that renders with **no error at all**: the wrong drawing per facing, forever. The consumer's builder says it outright: "row index = dir * n_states + state … direction order is the runtime's sector order" (`build_handpainted_sheets.py:47-53`).
5. **Per-frame PNGs instead of an atlas.** The runtime loads **one** texture and addresses it by `frame` (`enemy.gd:191-202`: `_anim.texture = load(atlas_path)`, `vframes` set from `_handpainted`). Shipping 128 separate `derived/*.png` means S2 must pack, and there is no packing step in S1 (spec §3 defers it). The consequence to guard now: a per-frame layout with **non-uniform cell sizes** or **tight trimming** cannot be packed later without re-establishing the pivot (point 3) — so the *derived* frames must already be uniform-size, centred, margin-consistent, or S2 inherits an unpackable set.

**Why it happens:**
Every one of these is a *consumer convention* that the producer has no way to infer. The consumer records them in prose (in `enemy.gd`'s header, in its builder's docstrings, in `check_enemy.gd`) precisely because they are silent.

**How to avoid:**
- `set.json` must carry everything the adapter needs so no convention is inferred twice: ordered `dirs`, `cell`, per-state `frames`/`fps`/`loop`, and per-frame `{state, dir, index, file}`. The engine adapter (S2) then *reads* the order rather than re-deriving it — and the producer's own test asserts `dirs` is stored verbatim.
- Derived frames: uniform pixel size, creature centred, margin ≥ 2 px on all four sides. Assert it (all frames in a set have identical dimensions **and** a non-zero alpha bbox with margin on all sides).
- Record the *delivery* cell size in `set.json` and state in the producer's docs that Godot consumes it via `hframes`/`vframes` with **nearest** filtering and **no** `AtlasTexture` (bleed protection comes from geometry, not from the engine).
- Do not emit `margin`/`extrude` fields expecting the engine to use them for bleed. If S2 ever packs with an extrusion border, that is a *new* source-sheet geometry the adapter must compute — and with `hframes`/`vframes` (which uses `texture_size / (hframes, vframes)`, `sprite_2d.cpp:109-114`) an extruded sheet changes the cell size and silently mis-addresses every frame.
- The producer can't gate the consumer, but it can emit what the consumer's gate reads. The consumer's gate is `tools/check_enemy.gd`'s ATLAS section, which validates the **manifest against the pixels** (`:1068-1075`) and asserts `hframes == 4 and vframes == 32` from an instantiated instance (`:1078-1085`). S2 should generate the manifest, not hand-write it — the milestone after this one.

**Warning signs:**
- A frame's creature is not centred in its cell (pivot will be off by the same delta every frame).
- A set whose derived frames have differing dimensions.
- The game showing the same direction for two facings (row order), or a blurry sprite (filter), or a 1 px seam at a cell boundary (bleed/geometry).
- A sprite that looks sheared or squashed (a non-uniform resample upstream — Pitfall 9).

**Phase to address:** **Phase 5** (what `set.json` must carry) and **S2 (engine delivery)** for the adapter. The **producer's** obligations — uniform derived frames, centred, margin, exact aspect — belong to **Phase 3**.

**Confidence:** HIGH. Filter mapping and `hframes` clip behaviour were read from the Godot 4.7 engine source (`viewport.h`, `viewport.cpp`, `main.cpp`, `sprite_2d.cpp`) and cross-checked against the 4.7 class docs; the consumer's conventions are read from its committed scripts and its atlas gate.

---

### Pitfall 18: Non-deterministic filenames make a rerun a different run

**What goes wrong:**
A rerun is only cheap if the same plan produces the same paths. Three places in the existing machinery are *not* deterministic for this workload:

- The library's atomic writer uses `Date.now()` and `process.pid` in its temp/backup names (`app/lib/library.ts:93,105`) — benign, because they are renamed away, but any tooling that globs `assets/**` must not treat `.tmp-`/`.old-` as assets (the library already has `ORPHAN_RE` for this, `:23`).
- The bridge's `sprite-align` writes `frame_%02d.png` (`cli/native/bridge.mjs:315`) — an index-only name that loses `(state, dir)` identity, so the runner must map indices back to directions itself; a mapping bug renames frames silently.
- The bridge's leftover-file fallback writes `cell_%02d.png` into `outDir` (`bridge.mjs` main loop) — index-only again.

And the spec's own two-numbering system is a trap by construction: `set.json` frames are **0-based** while file names are **1-based** (`spec §5.2`: "`frame` 为 0-based；运行器渲染文件名时用 1-based (`f1..fN`)"). Two conversions, in two places, is where an off-by-one becomes a *set that is internally consistent but shifted by one frame*.

**Why it happens:**
Naming is treated as presentation. For a resumable, re-verifiable pipeline it is the identity: the ledger key, the skip check, the derived-file existence check and the `set.json` entry all hang off it.

**How to avoid:**
- One pure function maps plan entry → file name. The plan carries the 0-based `frame`; the name renders `frame + 1`. Test the conversion at the boundary values (0 → `f1`, `frames-1` → `fN`) — the consumer's own convention is `{state}_f{N}_{D}dir.png` with 1-based N (`gen_assets_teamo.py:157`), and its ledger stores `frame: f + 1` (`:169`), so this exact off-by-one already exists in the wild.
- Keep the name injective over `(state, dir, frame)`: `derived/<state>_f<N>_<dir>.png` (spec §5.3) is injective only if `state` and `dir` are distinct strings after normalisation — assert it in `set.json`, and note the library's `FILE_RE` rejects uppercase and nesting (`libraryPath.ts:19`), so a state named `Windup` or a dir named `south_east` would be *silently rejected at save time* (a good failure, but it must be caught in `animSet.ts` validation, not at the library boundary after the money is spent).
- Verified against the real validator: `derived/idle_f1_east.png` → OK; `derived/attack-2_f10_south-west.png` → OK; `derived/Windup_f1_east.png` → **rejected**. A bare `set.json` path is **not** a legal library relpath (`FILE_RE` requires a `raw/` or `derived/` prefix) — `derived/set.json` is.
- Do not let a rerun with a different `--out` produce a second copy of the same set: the resume key is the plan entry, and the output root must be recorded in `set.json` so a second run to the same root is idempotent.

**Warning signs:**
- Two files whose names differ only in case or in a `-`/`_` substitution.
- A `derived/` set whose count is right but whose names don't match `set.json`.
- A save that fails with `invalid asset file path` after a full spend.

**Phase to address:** **Phase 2** (validation + the one naming function) and **Phase 4** (the runner using it).

**Confidence:** HIGH (validator behaviour verified by execution against the shipped regex).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| Reuse `sprite-align` as-is for the strip (it hardcodes baseline alignment) | Zero new post-processing code | Silently plants top-down and bottom-up cells on a common floor and can clip content; contradicts spec §7 and the consumer's own geometry | **Never** — the op's `groundAll` semantics were authored for one side-view animation; compose `slice`+`chroma` instead |
| Ship one asset per animation set but include `raw/` strips | "Everything in one place" | 16 raws ≈ 363.8 M base64 chars > the route's 279.6 M ceiling → 413; and ~270 MB on disk per set | Only when saving `derived/` + `set.json` and at most one raw (spec §5.4's shape) |
| Keep `cell: 512` as the delivered cell size | Bigger source for later re-crops | 128 × 370 KB per set to commit, plus a second resample before the engine sees it | Acceptable **only if** the set is genuinely a 512 px deliverable; otherwise deliver the engine cell |
| Single-unit cost (`usd` only) with `calls/cells/seconds` in `params` | No schema change, no second adapter's problem | Cannot compare against PixelLab's generations-based billing later | Acceptable for S1 (spec §5.4 is right); revisit with the second adapter |
| `null` cost when the gateway reports nothing | Honest | The library cannot answer "what did this cost" | Acceptable — but it must be `null`, never a fabricated `openrouter`-sourced number |
| Skip-on-file-existence resume | Two lines, no database | A truncated PNG is permanently skipped | Acceptable **only** after the writer is atomic and a decode check is added |
| Per-frame PNGs as the delivery format (delivery packing deferred to S2) | No atlas code in S1 | S2 must pack uniform, centred, margin-consistent frames or the pivot drifts | Acceptable (spec §3 defers packing) provided the derived frames are already uniform + centred |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| `/api/generate` (chat gateways) | Assume `width`/`height` is the canvas; it becomes a nearest ratio from a 10-entry list that has no 8:1/4:1 (`route.ts:7-18,160`) | Assert the returned aspect against the requested one per strip; plan for an exact-ratio transport (Phase 1 probe) |
| magpie gateway | Assume `4096×512` passes through because Teamo-direct does | Spec §9.1's probe, and record `requested` vs `returned` from the first real strip |
| APIMart adapter | Assume exact pixels | `EXACT_PIXEL_MODEL = /gpt-image-2-official|^dall-e/` only; everything else takes a ratio + tier, and `closestRatio(8.0)` = **`3:1`** (`apimartServer.ts:27,53-66,93-97`) |
| APIMart cost | Assume the chat path's `usage.cost` shape | APIMart returns a plain number (`apimartServer.ts:167-170`); the chat path's `source` is hardcoded `'openrouter'` (`generateCost.ts:13-15`) |
| The asset library | Treat a set as one asset including raws | `raw/` is gitignored (`.gitignore:51`) and the POST is capped at 279.6 M base64 chars; save the engine-relevant files |
| `ie library save` | Trust its provenance | It **hardcodes `backend: 'openrouter'`** (`cli/commands/library.mjs:166`) — pass the real backend through `--meta` or fix the enum first |
| Godot `Sprite2D` with `hframes`/`vframes` | Expect `filter_clip`/margin to protect against bleed | The hframes route disables filter clip (`sprite_2d.cpp:98-105`); protection is nearest sampling + exact geometry |
| Godot importer | Rely on importer defaults per file | `process/fix_alpha_border=true`, `mipmaps/generate=false`, `detect_3d/compress_to=1` are the defaults (verified in `resourceimportertexture` docs and the consumer's real `.import`) — a 2048-tall sheet auto-converts a VRAM-compressed copy if it is ever used in 3D |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| Library save carries the raws | 413 after a full spend; the route buffers the body before the size check | Save `derived/` + `set.json` + at most one raw | 16 raws = 363.8 M base64 chars vs the 279.6 M cap (measured) |
| Raw strips under `res://` | 487 MB `.godot`, 64 imports for gitignored files, minutes of re-import per clone | Keep `--out` outside the Godot project, or ignore both the PNG and its `.import` | Immediately — the consumer already has both |
| 128 full-size PNGs in a library panel | Each thumbnail is a full `512²` PNG with `cache-control: no-store` (`CONCERNS.md`) | Do not list derived frames as the asset's thumbnail set; add a thumb tier or serve `derived[0]` only | ~40 assets per refresh (already measured in `CONCERNS.md`) |
| Library index reads every `meta.json` serially | Slower panel | Bounded concurrency, no new cache | ~2,500 assets (measured 117.5 ms serial vs 51 ms parallel) |
| `Σ states.frames` serial calls at 20–70 s each | A 16-strip set is 9–19 minutes of wall clock; a UI run can time out | Resume + per-frame redo; never re-spend on a rerun | Any set ≥ 8 strips (the consumer's ledger: 32.7–70.6 s per strip) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---|---|---|
| A new endpoint or CLI surface that accepts a caller-supplied output path | Writes outside the asset root | Reuse `libraryPath.ts`'s validation; the anim runner's `--out` is a path but the *library* write must still go through `saveAsset` |
| Storing the gateway key in the spec file so a rerun is "self-contained" | Key in git next to the art | Keys stay in `localStorage` / the CLI config (chmod 600, `cli/commands/config.mjs:85`) / env — never in `AnimSetSpec` |
| A `set.json` (or manifest) that travels to git containing the full prompt with an embedded credential | Same | `provenance.prompt` is already a library field; keep prompts key-free (the consumer's `TEAMO_API_KEY` never enters the repo — `gen_assets_teamo.py:15-17`) |
| Trusting client-supplied `provenance.backend` | A fabricated attribution | The route already re-stamps it server-side (`route.ts:117-130`) — keep that; the bug is the *allow-list*, not the trust model |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---|---|---|
| A plan that prints only filenames | The user cannot judge the spend (the consumer's dry run does exactly this, `gen_assets_teamo.py:144-148`) | Print per-strip canvas, the call count and the output root (spec §2.4) |
| A 32-row / 128-frame gallery as the review surface | Nobody reads it (`build_handpainted_sheets.py:344-345`) | The direction matrix: one row per sector, one column per state, frame 1, zoomed; plus the existing player for one direction |
| A "regenerate set" button with no scoping | A 16-call re-spend to fix one frame | `--redo state:frame` / a per-cell regenerate control |
| Hiding the exact-aspect decision behind a size ladder | 8:1 is unreachable from the UI (`Modals.tsx:836,853` — no 8:1 entry) so the UI path always distorts | The anim mode derives `cell × dirs` internally and shows it, never exposing the ratio ladder |
| Silent post-processing no-ops | A set that "succeeded" with half-processed frames | Show per-strip counters (border removed, isolate, duplicate frames) in the run report |

## "Looks Done But Isn't" Checklist

- [ ] **Aspect ratio:** every strip's `returned` aspect is within tolerance of `requested` — verify on the *actual bytes*, not on the HTTP response or the plan.
- [ ] **Cut lines:** every cut line lands on a mostly-empty gutter column — verify with a column-profile assertion, not by eye; measured 68/224 bad cuts at uniform slicing.
- [ ] **Cell margin:** every derived frame's alpha bbox is strictly inside the cell with ≥2 px on all four sides — verify all four sides, per frame.
- [ ] **Uniformity:** all derived frames in a set have identical pixel dimensions — verify by reading every file's size.
- [ ] **Frame count:** every state has the same `frames`, and `set.json` says so — verify against the plan, not against the files (a missing file is a different bug).
- [ ] **Direction order:** `set.json`'s `dirs` is the runtime sector order, stored verbatim — verify by comparing to `gen_assets_teamo.py:39` / `enemy.gd:711-712`, not by re-deriving it.
- [ ] **Keying:** each frame's alpha histogram is bimodal (0/255), and the background fraction is above a floor — verify the histogram, not the visual.
- [ ] **Resume:** a deliberately truncated `raw/` PNG is detected and re-fetched — verify by truncating one and re-running.
- [ ] **No double spend:** `provenance.params.calls` equals the `ok:true` strip count on a clean run — verify from the artefact.
- [ ] **No duplicate keys:** the ledger/`set.json` has as many unique `(state, frame)` keys as rows — verify by set arithmetic (the consumer's committed ledger fails this: 17 rows / 16 keys).
- [ ] **Provenance:** `cost.source` (when non-null) equals `backend`, and `backend` is the gateway actually used — verify with two different gateways.
- [ ] **Raw outputs are not in git and not under `res://`** — verify with `git status` and with `git check-ignore -v`.
- [ ] **Payload ceiling:** the saved file set's base64 total is below the route's cap — verify by arithmetic before the POST, not by reading a 413.
- [ ] **Determinism:** planning twice yields byte-identical file names — verify by diffing two plans.
- [ ] **No silent no-op:** every post-processing counter is non-zero where it should be — verify by running a set that *needs* each pass.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Aspect downgrade discovered after a full run (Pitfall 1) | **HIGH** — the whole set is distorted | Re-probe with a raw `width`/`height` transport; re-run the set (money already spent is lost); add the aspect assertion so it cannot recur |
| Uniform-slice bleed (Pitfall 2) | MEDIUM | Re-slice from the retained `raw/` strips with a fitted grid — **this is the whole reason `raw/` is kept**; no new spend |
| One cell with two creatures / a card (Pitfall 4) | LOW–MEDIUM | Re-run just that strip (`--redo state:frame`), or accept the blob-isolated version; both need per-frame scoping to be cheap |
| Pale-field keying failure (Pitfall 6) | LOW | Re-key from `raw/` with a measured field colour; no spend |
| Frame-count mismatch (Pitfall 8) | MEDIUM | Re-plan with uniform frames and re-run the states that differ; or make S2 honour per-state counts (a consumer change) |
| Baseline alignment clipped content (Pitfall 11) | LOW | Re-process from `raw/` without the alignment pass; no spend |
| Truncated `raw/` silently skipped (Pitfall 13) | LOW–MEDIUM | Re-fetch that one strip; add the decode check |
| Duplicate ledger keys (Pitfall 14) | LOW | De-duplicate by `(state, frame)`; the spend is already gone — the record is the fix |
| Wrong backend/cost in provenance (Pitfall 15) | LOW | Fix the enum and re-stamp `meta.json` from `set.json`'s own record; the art is fine, only the label is wrong |
| Repo/disk bloat (Pitfall 16) | HIGH if already pushed | `.gitignore` + `git rm --cached` for new files; a rewrite is only worth it while the history is unpushed (`rewrite-unpushed-large-artifacts`) |
| Row-order mismatch found in the game (Pitfall 17) | **HIGH** if the set is already in the library and consumed | Re-derive the order in S2's adapter from `set.json`; if `set.json` was written in the wrong order, the set must be re-generated or remapped — remap the manifest, don't re-spend |

## Pitfall-to-Phase Mapping

Phases follow the milestone spec's own unit boundaries (§4/§6/§7 of `2026-10-06-animation-set-production-design.md`). They are proposed names, not a committed roadmap.

| Pitfall | Prevention Phase | Verification |
|---|---|---|
| 1. Aspect silently downgraded | Phase 1 (probe/transport) + Phase 3 (assertion) | Probe returns an 8:1-multiple canvas; `strips[].returned` ratio within tolerance of `requested` for every strip |
| 2. Model ignores the cell pitch | Phase 1 (measure) + Phase 3 (fitted cut or gutter check) | A column-profile assertion showing every cut line is a gutter column; re-run the check on a fresh probe strip |
| 3. Wrong cell size / forgiving slice | Phase 2 (algebra) + Phase 3 (guard) | Integration test: stub gateway returns a 21:9 image → the runner marks `ok:false` and keeps the raw |
| 4. Creature crosses the cell edge / card | Phase 3 | Per-cell corner transparency + bbox-fill-ratio assertion, with a counter that is non-zero on the known-bad strips |
| 5. Direction order honoured approximately | Phase 2 (enumeration in prompt; test asserts all N mappings) + Phase 6 (direction matrix view) | `animStrip` test asserts N index→dir lines in order; human review of the matrix preview for one set |
| 6. Background not flat/not magenta | Phase 3 | Bimodal alpha histogram per frame + background-fraction floor |
| 7. Keying/edge artefacts | Phase 3 | Corner pixels transparent on all frames; no 1 px rind in the ×4 preview |
| 8. Drift / two creatures / frame count | Phase 2 (uniform frame count + fields) + Phase 3 (duplicate detection, drift metrics) | `duplicateFrames` empty; per-frame bbox recorded; `frames` equal across states |
| 9. Non-integer scaling | Phase 3 | Requested vs delivered cell size recorded; X/Y resample factors equal within tolerance |
| 10. Per-frame jitter | Phase 3 (+ Phase 7 E2E) | Per-row bbox-height stdev below the chosen threshold |
| 11. Baseline alignment fights direction | Phase 3 (**decide before writing the runner**) | `sprite-align` is not called as a unit; the alignment diagnostics are either absent or asserted-empty |
| 12. Silent no-op in a post-processing step | Phase 2 (field shape) + Phase 3 (counters) | Every counter non-zero on a set that needs that pass; a no-border cell and a bordered cell produce different counts |
| 13. Partial sets after a crash | Phase 2 (`nextPending` definition) + Phase 3 (atomic writer) | Truncate a `raw/` file; re-run; assert re-fetch |
| 14. Double-spend | Phase 2 (key + uniqueness) + Phase 4 (`--redo` scoping, printed plan) | Unique key count == row count; `params.calls` == `ok:true` count |
| 15. Provenance lies / cost units | Phase 5 | Two gateway runs produce two different `backend` values; `cost.source == backend` |
| 16. Repo/disk bloat | Phase 4/5 (layout + payload) + Phase 7 (retirement docs) | `git check-ignore` on both the PNG and its `.import`; base64 total < the cap |
| 17. Consumer-side rendering | Phase 3 (uniform centred derived frames) + Phase 5 (`set.json` carries everything) + S2 | All derived frames same size, centred, ≥2 px margin; `dirs` stored verbatim; S2's adapter reads the order |
| 18. Non-deterministic names | Phase 2 (validator + one naming fn) + Phase 4 | Two plans diff clean; a state/dir name that fails `FILE_RE` is rejected before the spend |

## Sources

**Consumer ground truth (`~/repos/dark-black`, Godot 4.7.2):**
- `tools/gen_assets_teamo.py` — the strip prompt (`:97-113`), the exact-aspect rationale (`:10-13`), `DIRS8`/`DIRS4` (`:37-40`), the 1-based file name (`:157`), the `--go` gate and dry run (`:128,144-148`), the ledger merge (`:174-185`); the pre-merge append version in `git show e503ae1:tools/gen_assets_teamo.py`.
- `tools/build_handpainted_sheets.py` — `field_colour` and the two measured backdrop colours (`:70-92`), the binary-key rationale (`:95-106`), `panel_boxes` grid search and the ~1400/1464 measurement (`:158-184`), `trim_to_blob` (`:187-200`), `keep_main_blob` (`:203-243`), `remove_card` + the plate measurement (`:261-312`), `fit_panel` and the field-compositing rationale (`:315-337`), `CARD_REMOVED` (`:43-45`), `write_preview` (`:344-358`), `empty_cells` (`:361-370`), `card_shaped` (`:373-386`), the manifest (`:417-440`).
- `docs/handpainted/P2-P3-PLAN.md` — the four "follow the docs and you get it wrong" findings (`:116-126`), including the grid-drift measurement and the backdrop-colour drift.
- `scripts/actors/enemy.gd` — the ruled-grid prose (`:42-53`), `FPS_*` (`:58-61`), atlas paths and `vframes` (`:84-87,191-197`), `_refresh_frame` row formula (`:585-598`), `_sector_index` (`:711-712`), the `has_animation` false-green note (`:255-260`).
- `scripts/actors/player.gd` — the hero's 4-named-direction convention, the LEFT mirror (`:47-64,595-603`).
- `scenes/actors/enemy.tscn` — `hframes = 4 / vframes = 32`.
- `assets/handpainted/sprites/{chaser,lunger,hero}/*` — measured sizes, the atlas, the manifests, the 17-row/16-key chaser ledger, the `.import` defaults.
- `tools/check_enemy.gd` — the ATLAS section: manifest-vs-pixels (`:1068-1075`), the instance grid assertion (`:1078-1085`), the negative controls (`:1051-1066`).
- `.gitignore:105-112` — the raw-strip and `.import` ignore rules and their rationale.
- `project.godot:36-38,77` — stretch mode `canvas_items`, `scale_mode=integer`, `default_texture_filter=1`; `tools/check_settings.gd:10-22`.

**This repo (`~/repos/image-extender`):**
- `docs/superpowers/specs/2026-10-06-animation-set-production-design.md` (§5.2 numbering, §7 no-baseline decision and the `sprite-align` reuse, §8 error handling, §9 risks, §12 deferrals) and `docs/superpowers/specs/2026-10-05-fork-design.md` (§1 measured asset weights, §2 success criteria).
- `.planning/PROJECT.md`, `.planning/codebase/{ARCHITECTURE,CONCERNS,CONVENTIONS}.md`.
- `app/api/generate/route.ts:7-34,54-59,148-161` — the aspect list, `supportedAspectRatioForSize`, `image_config`, temperature policy.
- `app/lib/imageGeneration.ts:44,71-108,110-165` — `viaChat`/`viaApimart`, the cost wrapping, `IMAGE_ADAPTERS`.
- `app/lib/apimartServer.ts:22-134,167-170` — `EXACT_PIXEL_MODEL`, `APIMART_RATIOS`, `closestRatio`, the size-candidate ladder, `costOf`.
- `app/lib/generateCost.ts:11-15` — `extractCost` and its hardcoded `source`.
- `app/lib/providers.ts:11,42,53-90,127-189` — `PROVIDER_IDS`, `PROVIDERS`, `VERIFIED_MODELS`.
- `app/lib/libraryCollect.ts:20-28,79-108,165-180` — `BACKEND_LABELS`, `buildProvenance`, the collector branches.
- `app/api/library/[[...path]]/route.ts:14-16,33-35,117-130` — the payload caps, `pickBackendLabel`, the server-side re-stamp.
- `app/lib/library.ts:41-43,65-118,144-189` — `assetsRoot`, the atomic temp-dir save, `listAssets`.
- `app/lib/libraryPath.ts:14-36` — `NAME_RE`, `FILE_RE`, `assertInsideRoot` (validator behaviour verified by execution).
- `app/utils/imageProcessor.ts:1445-1530` (chroma key), `2070-2110` (`sliceImageGrid` and its rescale), `2337-2423` (`alignSpriteFramesToBaseline`, `shiftCellVertical`), `2601-2700` (`findFrameBottomY`), `2785-2870` (`normalizeSpriteFrameScale`), `2914-2960` (`removeFrameBorder`), `3132` (`isolatePrimarySpriteComponent`), `3355-3420` (`centerSpriteFramesHorizontally`).
- `app/lib/chromaPresets.ts` — the four preset tunings and their defaults.
- `cli/native/bridge.mjs:52,127-144,155-160,161-178,179-184,276-329` — `CHROMA`, `duplicateFlag`, `chroma`, `prop-sheet`'s `borderFailed`, `slot`, `sprite-align` including the two empty catches and the unconditional baseline pass.
- `cli/lib/media.mjs:17-25,58-63,74-79` — the non-atomic `writeDataUrl`, `dataUrlSize`, `writeManifest`.
- `cli/commands/studio.mjs:47-55,91-107,236-263,440-545` — backend resolution, `saveToLibrary`, `returned` recording, the sprite two-pass shape.
- `cli/commands/library.mjs:78-85,140-190` — `checkRel`, the hardcoded `backend: 'openrouter'`, the `--meta` override.
- `cli/lib/context.mjs:43-47` — `ctx.provenance` → `buildProvenance`.
- `app/i18n/messages/shell.ts:72-78`, `app/components/LibraryPanel.tsx:28-34` — the kind-label maps.
- `package.json:30-41`, `vitest.config.ts` — the test surface (`npm test`, `npm run test:cli`; no CI).

**Engine documentation, verified against current sources on 2026-10-06 (not training data):**
- Godot 4.7 `ProjectSettings` — `rendering/textures/canvas_textures/default_texture_filter` exists with default `1` — https://docs.godotengine.org/en/4.7/classes/class_projectsettings.html (the property-hint string is `"Nearest,Linear,Linear Mipmap,Nearest Mipmap"` per `core/config/project_settings.cpp`).
- Godot 4.7 `CanvasItem.TextureFilter` — `TEXTURE_FILTER_PARENT_NODE = 0`, `TEXTURE_FILTER_NEAREST = 1`, `TEXTURE_FILTER_LINEAR = 2` — https://docs.godotengine.org/en/4.7/classes/class_canvasitem.html
- Godot 4.7 engine source — `main/main.cpp:4685-4690` applies the setting via `set_default_canvas_item_texture_filter(Viewport::DefaultCanvasItemTextureFilter(texture_filter))`; `scene/main/viewport.h:192-199` gives the enum order (NEAREST = 1 in that mapping); `scene/main/viewport.cpp:4053-4068` falls back to **LINEAR** when parent-node resolution finds nothing; `scene/2d/sprite_2d.cpp:98-125` derives the cell from `texture_size / (hframes, vframes)` and sets `r_filter_clip_enabled = false` on the non-region path.
- Godot 4.7 `Sprite2D` — `hframes`/`vframes`/`frame`/`frame_coords`, `region_filter_clip_enabled`, and the centering note — https://docs.godotengine.org/en/4.7/classes/class_sprite2d.html (4.7 page read for `region_filter_clip_enabled`; the stable/latest pages agree)
- Godot 4.7 `AtlasTexture` — "`filter_clip` … If true, the area outside of the region is clipped to avoid bleeding of the surrounding texture pixels" (default `false`); "`margin` … The margin around the region. Useful for small adjustments. If the `Rect2.size` of this property is set, the drawn texture is resized to fit within the margin" — https://docs.godotengine.org/en/4.7/classes/class_atlastexture.html
- Godot 4.7 `ResourceImporterTexture` — defaults `process/fix_alpha_border = true`, `mipmaps/generate = false`, `detect_3d/compress_to = 1` — https://docs.godotengine.org/en/4.7/classes/class_resourceimportertexture.html and the consumer's real `.import`
- Godot 4.7 `SpriteFrames` (for S2) — per-frame relative `duration`, `set_animation_speed`, `set_animation_loop_mode` — https://docs.godotengine.org/en/4.7/classes/class_spriteframes.html

**Vendor documentation, verified 2026-10-06:**
- Gemini API `image_config` — supported aspect ratios include `1:8` and `8:1`; `imageSize` ∈ {`512`,`1K`,`2K`,`4K`} — https://ai.google.dev/api/generate-content (the model can honour 8:1; the app's own list cannot ask for it)
- APIMart image docs index — per-model ratio sets, `size` + `resolution`, the `task_id` submit/poll shape — https://docs.apimart.ai/llms.txt and https://docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation.md (which lists `1:8`/`8:1` for that model — the *adapter's* local ratio table is what stops at `3:1`)

**Flagged as unverified:**
- Whether `magpie → teamo-router/gemini-3.1-flash-image` honours `image_config.aspect_ratio` or the raw pixel size — **unverified**; this is spec §9.1's probe and Phase 1's whole purpose. `[INFERENCE]` that it behaves like the Teamo-direct path the consumer measured.
- Whether the chat gateways return `usage.cost` at all — `app/lib/generateCost.ts:7` says so itself. `[INFERENCE]`.
- The acceptable per-frame jitter threshold at 512 px cells — the 3.77 px measurement is at 64 px and does not transfer directly. `[INFERENCE]`.
- Whether `normalizeSpriteFrameScale` helps or hurts across directions (it equalises size across a perspective change that legitimately sizes the creature differently) — **unmeasured**; flagged for a two-run comparison in Phase 3.
- How often the model permutes or mirrors the direction order — **not machine-checkable today**, so it is unmeasured by construction. `[INFERENCE]`.

---

*Pitfalls research for: animated sprite-set production (direction × state × frame) in image-extender*
*Researched: 2026-10-06*
