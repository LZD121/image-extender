# Stack Research

**Domain:** AI-driven 2D game-art pipeline — exact-aspect image-model calls in, engine-ready animated sprite sets out
**Researched:** 2026-10-06
**Confidence:** HIGH on the Godot 4.7 consumption formats (every structure below was produced or read back by Godot 4.7.2 on this machine, not recalled); HIGH on the provider aspect-ratio sets (live probes against `openrouter.ai/api/v1/images/models`, APIMart docs, Google docs); HIGH on the app's existing send path (read from source); MEDIUM on what Teamo actually returns for an 8:1 request (inferred from 40 committed strips + 2 ledgered successful magpie image calls, no fresh spend).

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Godot `SpriteFrames` + `AtlasTexture` (`.tres`) | 4.7.2 stable (`ed1daf0bf`) | The engine-delivery artifact for an animated set | It is the only Godot-native animated-texture resource, it carries per-animation `speed` + `loop_mode` + per-frame relative `duration`, and it serialises to a plain text `.tres` that a generator can write byte-deterministically. Structure verified by generating one headlessly (§ Sources, probe P3) |
| `AtlasTexture(atlas, region, filter_clip)` | 4.7 | One cell of a sheet as a drawable `Texture2D` | `region` is the exact rect; `filter_clip = true` stops neighbour bleed at cell edges — the failure mode a strip has *by construction* (cells are adjacent). This is the mechanism to reach for instead of padding the sheet |
| Godot `Sprite2D` with `hframes`/`vframes`/`frame` | 4.7 | The consumer's current runtime path | `dark-black/scripts/actors/enemy.gd:108,193` and `player.gd` both drive `Sprite2D.frame` directly off a single sheet. Any S2 artifact that keeps this shape needs no runtime change at all |
| `gemini-3.1-flash-image` **native** `response_format.aspect_ratio` | Gemini 3.1 Flash Image (`image_config`) | The one image channel that natively expresses 8:1 and 4:1 | Google's own table lists both `8:1` and `4:1` as first-class ratios at every tier (probe P1). The app's route cannot currently *say* 8:1 because its local list stops at 21:9 — that is a local table, not a vendor limit |
| APIMart `gpt-image-2-official` exact-pixel `size` | `size: "3840x480"`-style strings | The only channel in the app's provider table that takes **pixel dimensions** rather than a ratio | Vendor docs: *"Pixel dimensions can also be passed directly, such as `1881x836` / `887x1774`"*; the repo already probes this (`apimartServer.ts:27` `EXACT_PIXEL_MODEL`, and the skill bridge's `APIMART_EXACT_PIXELS`). The exact-pixel path is capped at **3840 per edge**, so an 8:1 strip through it is 3840×480, not 4096×512 |
| Node ESM CLI (`ie`) + esbuild browser bundle | Node ≥ 18, esbuild 0.28.2 | The automation surface for a whole set | Already exists and already bypasses the route's ratio ladder (`cli/native/bridge.mjs`, `app/lib/*` bundled twice). This milestone adds commands to it; it does not need a new runtime |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `jszip` | 3.10.1 (installed) | ZIP + manifest export of a produced set | Only for the human-facing "download this set" door. The library already writes to disk through `library.ts`; a ZIP is not the transport for the engine |
| `sharp` | 0.34.5 (in tree, **unused by app code**) | Server-side PNG dimensions/ops if ever needed | Do not reach for it. Dimensions are already read in-DOM by `getImageDimensions` (`imageProcessor.ts:1344`), and `library.ts` is the only module allowed to touch the filesystem |
| Godot `ResourceSaver.save` + `AtlasTexture` construction in a headless `--script` run | 4.7 | Emitting and *verifying* `.tres` from a script | Use for the S2 writer and for the producer's own gate. Verified: a `SceneTree` script build of `SpriteFrames` (`add_animation` → `set_animation_speed`/`set_animation_loop_mode` → `add_frame(AtlasTexture)`) saved cleanly with `ResourceSaver.save` and reloaded the same frame count. Godot generates the file itself, so the app never hand-authors `.tres` syntax |
| `nklbdev/godot-4-aseprite-importers` (community) | Godot 4.x | Importing an Aseprite JSON atlas if one appears | Only if a human ever hands-draws frames in Aseprite. Not needed to *emit* anything — see the manifest table |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `godot --headless --path <proj> --script <file.gd>` | Generate/read `.tres`, read back project settings, assert atlas geometry | Worked for every probe below; ~0.2–0.5 s per run. `--import` is a **separate**, slower pass (~2 s) that also rewrites `.import` files |
| `godot --headless --path <proj> --import` | Force a reimport after dropping PNGs into a project | Also the way to confirm which importer name a file chose (it rewrites `[remap] importer=…`) |
| `curl https://openrouter.ai/api/v1/images/models` | Read a gateway's *declared* per-endpoint aspect-ratio set | No auth needed — returned JSON in probe P1. `…/images/models/<id>/endpoints` gives the definitive per-provider subset |
| `dark-black`'s `tools/build_handpainted_sheets.py:158` `panel_boxes()` | Locate the real cell grid in a returned strip | The reference implementation of "the model does not honour the grid" (probe P5). Reuse the idea, not necessarily the code |

## Installation

```bash
# Nothing new for the app side. Existing deps already cover the milestone:
npm ls next react playwright-core esbuild jszip   # all present in package-lock.json

# The headless post-processing engine still needs Chromium once:
npx playwright install chromium-headless-shell

# Godot side (consumer only, already installed here):
godot --version    # 4.7.2.stable.official.ed1daf0bf
```

`sharp` is in the tree but imported by nothing (`grep -rn "sharp" app/ cli/` returns only the substring "sharp" inside prose). Adding a dependency for this milestone is not warranted.

## Target Formats (verified by running Godot 4.7.2)

**Packed atlas + `Sprite2D` grid** (what ships today, zero runtime change):
- One PNG. `Sprite2D.hframes` = columns, `Sprite2D.vframes` = rows, `Sprite2D.frame` = `row * hframes + col`. `dark-black/scenes/actors/enemy.tscn` writes `hframes = 4, vframes = 32` and `enemy.gd:193` re-derives `vframes` at runtime from the atlas's existence — the pair is the silent-failure surface the file's header warns about.
- `centered` stays `true` (the art is not on a pixel grid); no `region_enabled`, no `AtlasTexture`.

**`SpriteFrames` `.tres`** (the engine-native animation resource; exact shape emitted by headless Godot):
```
[gd_resource type="SpriteFrames" format=3]

[ext_resource type="Texture2D" path="res://…/sprite-sheet-alpha.png" id="1_xxxxx"]

[sub_resource type="AtlasTexture" id="AtlasTexture_aaaaa"]
atlas = ExtResource("1_xxxxx")
region = Rect2(0, 0, 64, 64)
filter_clip = true
…one per cell…

[resource]
animations = [{
"frames": [{"duration": 1.0, "texture": SubResource("AtlasTexture_aaaaa")}, …],
"loop": 1,
"name": &"idle_east",
"speed": 4.0
}, …]
```
- `loop` is a `SpriteFrames.LoopMode` int (`0` NONE, `1` LINEAR, `2` PINGPONG) — **not** a bool, despite the deprecated `set_animation_loop()`.
- `duration` is **relative**; `absolute = duration / (speed * playing_speed)`. Emit `1.0` and put the real rate in `speed`.
- `clear_all()` (or `add_animation`) leaves a `default` animation behind; `get_animation_names()` sorts alphabetically, so name animations as `<state>_<dir>` if per-direction clips are wanted, or `<state>` if the adapter prefers one clip per state with per-direction sheets.
- `AtlasTexture.atlas` may itself be another `AtlasTexture` (documented), which is how a cell of a packed mega-atlas stays composable. `margin` is a small-adjustment rect that **resizes the drawn texture** when its size is non-zero — leave it `Rect2(0,0,0,0)` unless deliberately shrinking a cell. `filter_clip = true` is the anti-bleed switch for adjacent cells.

**`.import` sidecars** (committed to the consumer's repo — 11 are tracked in `dark-black`):
- The consumer's committed sheets are plain `importer="texture"`, `type="CompressedTexture2D"`, `compress/mode=0` (Lossless), `mipmaps/generate=false`, `detect_3d/compress_to=1`, `process/fix_alpha_border=true`, `process/premult_alpha=false`.
- Filtering is **not** in `.import` in Godot 4: it is `rendering/textures/canvas_textures/default_texture_filter` (project setting, `1` = Linear here) overridable per `CanvasItem.texture_filter` / per `TileSetAtlasSource`. Mipmaps matter only when the sheet is drawn smaller than 1:1 — this project draws 64 px cells at `scale 0.5` on a `canvas_items` stretch, so mipmaps stay off.
- `pivot` is not a texture property: 2D pivots are `Sprite2D.offset` / `centered` and, for pixel art, `rendering/2d/snap/snap_2d_transforms_to_pixel` + `snap_2d_vertices_to_pixel` (both `false` here, deliberately).
- Adding a PNG to a project and running `--import` also rewrites the `[remap]` block, so a generator that drops files *and* wants a specific importer must write the `.import` itself rather than let the editor choose.

**Per-frame PNG folder vs packed atlas:**
| | Per-frame folder | Packed atlas |
|---|---|---|
| Files in the Godot project | N source PNGs + N `.import` + N `.godot/imported/*.ctex` | 1 + 1 + 1 |
| Runtime work | N `Texture2D` loads, N draw setups | 1 texture, index arithmetic |
| `SpriteFrames` | direct — one `add_frame(texture)` per file, no regions needed | needs one `AtlasTexture` per cell |
| Human review / regeneration | good: one frame = one file, `--redo idle:3` maps to it | poor: fixing one cell means repacking |
| Disk (measured) | 16–17 MB per 11712×1408 strip → 571 MB for 3 actors, **gitignored** | 746 KB for a 256×2048 chaser atlas, **committed** |
| Verdict | the pipeline's intermediate (`derived/<state>_f<N>_<dir>.png`) | the engine contract |

The two are not alternatives at different quality levels — they are different stages. Emit frames for provenance and repair, pack for the engine. Which is exactly the split S1/S2 already assumes.

## Manifest & Atlas Interop Formats

| Format | What it is | Interop value here | Trade-off |
|---|---|---|---|
| **The consumer's `sprite-sheet-alpha.json`** | `{characterId, atlas, cell, columns, rows, layout, dirs[], states[], animation{columns}, frame_layout{sheetWidth,sheetHeight,cellWidth,cellHeight,rows{<dir>_<state>:[{x,y,w,h}×N]}}}` | **The right thing to emit.** `check_enemy.gd:1428-1443` asserts precisely these keys and the exact row order, so a generated manifest either satisfies an existing gate or is a red one | Bespoke and Godot-flavoured. Only correct for this consumer; do not put it in `set.json` |
| **Aseprite JSON** | `frames:[{filename, frame{x,y,w,h}, rotated, trimmed, spriteSourceSize, sourceSize, duration}]` + `meta{image, format, size, scale, loop, frameTags}`. Ships in **array** or **hash** form and importers must know which | High leverage *if* frames ever come from Aseprite, and it is the de-facto cross-tool standard (Phaser, Godot add-ons, Unity importers all read it). `frameTags` is what names animations | Nothing in this pipeline can produce `frameTags` (they are Aseprite's own), and Godot has **no** built-in reader. Emitting it would be a second manifest with no consumer. Note `duration` here is **absolute milliseconds**, the opposite of `SpriteFrames`'s relative value |
| **TexturePacker JSON** | `frames` keyed by name with `frame`/`rotated`/`trimmed`/`spriteSourceSize`/`sourceSize`/`pivot`, plus `meta` | Same class as Aseprite; `pivot` is the one field Godot 2D has no home for (pivots live on the node, not the texture) | Not producible by this pipeline; not readable by Godot without an add-on |
| **Phaser atlas JSON** | The Aseprite/TexturePacker shapes, loaded via `load.atlas` (named frames) vs `load.spritesheet` (uniform integers). "spritesheet = uniform cells, atlas = arbitrary rects" | Irrelevant to a Godot consumer; relevant only if a web build ever appears | Adds a format with no consumer |
| **Tiled `.tsx` / `.tmx` (+ Wang sets)** | XML tileset: `tilewidth/height`, `spacing`, `margin`, `image trans="#FF00FF"`, per-tile `<animation><frame tileid duration>`; Wang is per-edge/corner terrain | Only for terrain, and the consumer's terrains are not the milestone. Note `trans` is Tiled's built-in **colour key** — the same magenta idea this pipeline uses, which is a nice corroboration that colour-keying is a standard interchange | Wang/terrain models *tile adjacency*, not character direction×state×frame. Wrong axis |
| **Godot `TileSet` + `TileSetAtlasSource`** | `texture_region_size`, `margins`, `separation`, `use_texture_padding` (1 px internal padding "avoids a common artifact where lines appear between tiles"), plus per-tile animation (`set_tile_animation_frames_count/columns/speed/separation`) | The *padding* idea is worth stealing for a character atlas if cells ever touch. Per-tile animation is for animated terrain decorations | A tilemap resource for a TileMapLayer, not a character animator. Do not route character sets through it |
| **`set.json` (this milestone's own contract)** | `{schemaVersion, kind:"animation-set", actor, dirs[], cell, states[{name,frames,fps,durationsMs,loop}], strips[], frames[]}` — no Godot vocabulary | The only cross-boundary artifact S2 may read. It already carries everything an adapter needs: ordered `dirs`, per-state timing and loop, cell size, and the frame-file list | Nothing — this is the recommendation, and it is already specified |

**One consequence worth stating:** because a strip is laid out *one direction per column*, a per-direction clip and a per-frame row are the same data. `SpriteFrames` animation names should therefore be `<state>_<dir>` if the adapter wants eight clips per state, or `<state>` if it wants one clip and swaps sheets per direction. Pick one and encode it in the adapter, not in `set.json`.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Keep one strip per (state, frame), N cells = N directions | One grid call per (state) → all frames × all directions | Never for this consumer: 8 dirs × 4 frames needs 8:4 = **2:1**, which the app's route list lacks entirely and which collapses to 21:9 (`supportedAspectRatioForSize(2048,1024)` → `21:9`, computed). A non-uniform resize of a 2:1 canvas into 8×4 square cells is exactly what `gen_assets_teamo.py:10-13` says was rejected |
| `SpriteFrames` `.tres` (AnimatedSprite2D) | Keep `Sprite2D` + `hframes`/`vframes` + a manifest JSON | Keep the current shape for as long as the consumer's gates read `sprite-sheet-alpha.json` and `enemy.gd` owns `frame = row * FRAMES + col`. `SpriteFrames` is the *better* engine-native target, but `AnimationPlayer`-free `Sprite2D.frame` addressing is what ships today |
| Per-direction frame PNGs + `set.json` (the neutral S1 contract) | Emit a packed atlas directly from the producer | Emit the atlas in **S2**, not S1: packing is engine-format knowledge, and the spec deliberately keeps `set.json` free of Godot vocabulary |
| Aseprite-JSON-shaped manifest (`frames[]` with `frame{x,y,w,h}`) | Bespoke manifest | Only if the artifact is meant to be *interoperable* with other tools. For a private consumer, the bespoke manifest the consumer already reads (`sprite-sheet-alpha.json`: `frame_layout.rows`, `cellWidth`, `sheetWidth`) is better — its gate asserts exactly those keys (`check_enemy.gd:1428-1443`) |
| `Sprite2D.region_rect` + `region_enabled` for a variable-cell sheet | `hframes`/`vframes` | Use `region_rect` when the grid is irregular. With a ruled 4×32 grid, `hframes`/`vframes` is simpler and is what the consumer uses. **Note:** `Sprite2D.region_enabled`/`region_rect` and `AtlasTexture` are two different mechanisms for the same idea — do not mix them on one node |
| Tiled `.tsx` + Wang sets for terrain | Godot `TileSet` + `TileSetAtlasSource` | Only for tilemaps. Animations are **not** the use case: `TileSetAtlasSource` has tile *animations* (`set_tile_animation_frames_count`, `…_columns`, `…_speed`, `…_separation`), which is a per-tile decoration idiom, not a character animation system |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Sending `4096×512` through `/api/generate` **unchanged** today | The chat adapter `viaChat` (`imageGeneration.ts:81-110`) never sends `width`/`height` — the *only* size signal on that path is `extra.image_config.aspect_ratio`, computed by `supportedAspectRatioForSize` (`app/api/generate/route.ts:7-34`). Its list tops out at `21:9`, so 4096×512 (8:1) and 2048×512 (4:1) **both** resolve to `21:9` — computed, not guessed. The model receives "8 equal square cells" in the text and a 2.33:1 canvas, i.e. the silently stretched sheet | Widen the ratio set to include `4:1`/`8:1` (and `1:4`/`1:8`) — a local table, not a vendor limit — **and** send `extra.size: "4096x512"` on the OpenRouter image path, whose docs make explicit pixels authoritative |
| `magpie` → `/v1/images/generations` for this milestone | Measured live 2026-10-06 22:04 and 22:11: three calls to `teamo-router/gemini-3.1-flash-image` and `teamo-router/gpt-image-2.5-flare` returned **504 at 15002/15003/12010/12032 ms** — a hard ~15 s ceiling. `~/.config/magpie/usage.jsonl` records only **2** successful image generations ever (both `gpt-image-2.5-flare`, 28 883 ms and 34 985 ms — above that ceiling, i.e. served by a different path). A 4096×512 strip takes 20–70 s (`dark-black`'s ledger: 32.7–70.6 s per strip). The milestone's risk #1 will most likely fail on **timeout**, not on ratio | Probe it once, record the 504, then use the documented fallback: Teamo direct (the skill bridge already does this — `toGeminiRequest` with native `generateContent` and `imageConfig.aspectRatio` derived from the caller's pixels), or APIMart's async task API |
| `gpt-image-2-official` exact pixels for a **4096**-wide strip | The cap is **3840 per edge**, not 4096. The repo's own comment says it plainly: `cli/native/bridge.mjs:107` "gpt-image-2-official's pixel string is capped at 3840px per edge (a 4096 tile sheet is rejected)". `apimartServer.ts:28` `MAX_EXACT_EDGE = 3840` is the same fact. A 4096×512 request silently degrades to a ratio + tier, and APIMart's ratio set has no 8:1 (it stops at `3:1`) | Either request `3840×480` (8:1, inside the cap — `EXACT_PIXEL_STEP = 16` divides both) or accept ratio+tier on that model. Do not assume "exact pixels" is available because the model family name says so |
| Godot's `TextureAtlas` importer for a ready-made sheet | Measured: the importer name is `"texture_atlas"` (a first attempt with `importer="atlas"` was rewritten back to `"texture"` by `--import`; a second with `"texture_atlas"` was accepted and rewrote `dest_files` to a `.res`). Its actual job is the opposite of what a game needs: it reads **many source files** and *packs* them into a new atlas PNG (`resource_importer_texture_atlas.cpp:312` `new_atlas->save_png(p_group_file)`), with `atlas_file` naming the companion **source** sheet. It is an editor-side packing tool | Ship the sheet as a normal texture (`importer="texture"`) and address cells with `hframes`/`vframes` (`Sprite2D`) or `AtlasTexture.region` (`SpriteFrames`) — the consumer's committed `.import` files are plain `importer="texture"` |
| `AnimatedTexture` for cell animation | Godot's `AtlasTexture` page states it explicitly: "**AtlasTexture** cannot be used in an **AnimatedTexture**, and will not tile properly in nodes such as … **Sprite2D**". One `AnimatedTexture` cannot animate a region | `SpriteFrames` + `AnimatedSprite2D`, or `Sprite2D.frame` driven by hand (what the consumer does) |
| Per-frame PNG **folders** as the shipping delivery format | Every frame becomes its own source file, its own `.import`, its own `.godot/imported/*.ctex` and its own draw setup. `dark-black` commits **571 MB** of raw strips and has them gitignored (`assets/handpainted/sprites/*/*_[0-9]dir.png`) precisely because they are not build inputs a clone needs; the shipped artifact is one 256×2048 atlas (746 KB). A per-frame folder is a legitimate *intermediate*, never the engine contract | Emit per-direction frames in `derived/` (S1, human-reviewable, provenance) and pack the atlas in S2. Keep `set.json` as the only cross-boundary contract |
| base64 in the JSON that crosses to the engine | It bloats every read, defeats `git` diffing of metadata, and duplicates bytes that already exist as files. The library's *wire* uses data URLs (that is the existing `/api/library` shape and it stays), but the on-disk manifests (`meta.json`, `sprite-sheet-alpha.json`, `set.json`) reference filenames only | File names + relative paths, as both existing manifests already do |
| Runtime/on-demand generation inside the engine | `dark-black/tools/build_frame_atlas.py:4-12` has a section literally titled "WHY IT IS AN ASSET AND NOT A RUNTIME GENERATOR" — the project already deleted one. It would put a network dependency, an API key and non-determinism inside a shipping game whose `check_enemy.gd` asserts atlas geometry from a manifest | Generate offline into the library, commit the result. The library *is* the runtime's asset directory |
| In-engine texture assembly (stitching cells into an atlas at load) | Same non-determinism, plus the assembly would have to be re-verified by a gate that can only run in the editor. The consumer's gate reads pixels off disk (`_sheet_pixels`) and compares against a manifest, which is only possible because assembly happened offline | Assemble offline; the engine loads one texture and computes an index |
| One API call per frame when one strip suffices | An 8-direction, 4-frame, 4-state monster is **16** strip calls, not 128. Splitting further multiplies cost, latency and cross-frame drift, and buys nothing — the strip *is* the direction axis | `Σ states.frames` calls; the plan must print that number before spending |
| Per-cell separate calls for *directions* | The direction order is the consumer's runtime sector order and is a **contract** (`enemy.gd:711` `round(angle/SECTOR) & 7`). Separate calls cannot even guarantee which direction the model draws, let alone the order | One cell-per-direction strip with the direction enumerated in the prompt, exactly as `gen_assets_teamo.py:100-113` does |
| `alignSpriteFramesToBaseline` on a direction strip | A shared ground line across eight *different* camera angles makes the top-down and bottom-up cells fight; the consumer's `fit_panel()` instead trims each cell to its own alpha bbox and re-seats it in a fixed inner box | `sliceImageGrid` → `chromaKeyToAlpha` → `removeFrameBorder`/`isolate` → `normalizeSpriteFrameScale` → `centerSpriteFramesHorizontally`, i.e. the existing `sprite-align` chain with `airborne` semantics, not the baseline path |
| Assuming the model honoured the requested size **or** the grid | Measured on all 40 committed strips: the requested `4096×512` (8:1, square cells) came back **11712×1408** (8.318:1, cells **1464×1408 = 1.0398:1**, i.e. not square); the requested `2048×512` came back **4128×1024** (4.031:1, cells 1032×1024). Widths divide evenly by the cell count (40/40), but the *ratio* and the *cell aspect* do not match the ask | Record `requested`/`returned` (the library already has both fields) and make normalisation scale-free: trim to alpha bbox → fit into the fixed cell. Never derive a cell size from the returned width alone |
| Assuming the returned cell grid is uniform | The consumer's own prose: "idle 那一遍 8 个 panel 实际间距 ≈1400 px，而请求是 1464 px；到第 8 向偏移已近三分之一格" — a uniform `W//8` crop clipped a neighbour's limb in 5 of 8 directions. My re-measurement of all 40 strips: fitted spacing sat **within 2.25 %** of `W/N` (mean 0.91 %), and **1 of 40** strips warned that panels were 1431 px apart against a 1464 px uniform assumption | Search for (spacing, phase) as `panel_boxes()` does — or, better for this producer, keep a wide magenta gutter in the *prompt* and verify the gutter is actually empty before trusting a uniform slice |

## Stack Patterns by Variant

**If the target is Godot (this milestone's first consumer):**
- Emit `set.json` (neutral) in S1 and a `.tres` `SpriteFrames` + one atlas PNG in S2, generated by a headless `--script` run rather than hand-written.
- Because Godot can generate its own resource (verified: two headless runs produced valid `SpriteFrames` with 4 and 16 `AtlasTexture` sub-resources), the writer never has to guess `.tres` syntax, and the same script doubles as the verification gate.
- Keep `Sprite2D` + `hframes`/`vframes` for the *current* runtime and treat `SpriteFrames` as the improvement — the consumer's `enemy.tscn` already carries `hframes = 4, vframes = 32`, and swapping the node type would invalidate `check_enemy.gd`'s `get_node("Visual/Anim")` assertions.

**If the art is hand-painted (this milestone):**
- Project setting `rendering/textures/canvas_textures/default_texture_filter = 1` (**Linear**) and `snap_2d_transforms_to_pixel = false` — the consumer's `gen_project_settings.gd:27,29` sets exactly this and says why ("Fractional scale + Linear + no transform snap because the art is hand-painted, not pixel art"). Confirmed by reading the values back through `ProjectSettings.get_setting` (probe P4).
- Because the default is already Linear, per-texture filter tuning is unnecessary; do **not** "fix" it to Nearest.

**If the art is pixel art (the retired era, or `pixels` line):**
- The project setting number is a trap: project-setting `0` = **Nearest**, but `CanvasItem.texture_filter = 1` = **Nearest** while project-setting `1` = **Linear** (verified against `canvas_item.h:55-64` and the docs' enum). The consumer's `0`/`1` reading is the project-setting scale.
- Also set `display/window/stretch/scale_mode = integer` and prefer `viewport` stretch; keep `compress/mode = 0` (Lossless) and no mipmaps.

**If the consumer needs a whole new actor with no runtime change:**
- Match the committed shape exactly: one `sprite-sheet-alpha.png` + `sprite-sheet-alpha.json` with `frame_layout.{sheetWidth,sheetHeight,cellWidth,cellHeight,rows}` where `rows[<dir>_<state>]` is a 4-element array. `check_enemy.gd:1428-1443` asserts 64×64 cells, `sheetWidth == 4 * cellWidth`, `sheetHeight == rows * cellHeight`, and the exact row order (`east_idle, east_walk, east_windup, east_attack, south-east_idle, …`). Anything else is a red gate.

**If a second engine is added later:**
- Put the format knowledge in one adapter keyed off `set.json`'s `kind: "animation-set"`, not in the producer. `set.json` already carries `dirs`, `states[].fps/durationsMs/loop`, `cell`, and the frame file list — that is the full engine contract, and it contains no Godot words.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `SpriteFrames` `.tres` `format=3` | Godot 4.x | Measured on 4.7.2. The resource is plain text; `frames[].duration` is **relative** (`absolute = relative / (fps * speed)`), so `1.0` everywhere + `speed = fps` is the correct pair |
| `AtlasTexture.filter_clip` | Godot 4.0+ | Needed whenever cells are adjacent in the sheet. Default `false` — set it explicitly |
| `image_config.aspect_ratio` (chat path) | OpenRouter chat/completions | OpenRouter's OpenAPI schema carries `ImageConfig` (`create-a-chat-completion`, `image_config` → `ImageConfig`) and the server-tool description enumerates `aspect_ratio, quality, size, background, output_format, output_compression, moderation`. `size` is accepted there too — the app currently sends only `aspect_ratio` |
| OpenRouter explicit-pixel `size` | `/api/v1/images` (dedicated Image API) | Docs: "An explicit pixel size is authoritative. A mismatched `resolution` or `aspect_ratio` alongside it is rejected with a 400." This is a **different endpoint** from the chat path the app uses; adding it would be a second adapter, not a tweak |
| APIMart `size` exact pixels | `gpt-image-2-official`, `dall-e-*` | `EXACT_PIXEL_MODEL` in `apimartServer.ts:27`; edges must be multiples of 16 (`EXACT_PIXEL_STEP`), max edge 3840 |
| APIMart ratio set | all its image models | `APIMART_RATIOS` (`apimartServer.ts:35-51`) has **no** 8:1; its widest is `3:1`/`21:9`. The skill bridge's probed `APIMART_RATIO_SETS` adds `4:1/1:4/8:1/1:8` for `gemini-3.1-flash-image-preview` only |
| Gemini native `aspect_ratio` | `gemini-3.1-flash-image` | Includes `1:4, 1:8, 4:1, 8:1`; pixel sizes per tier are tabulated (8:1 → 1536×192 / 3072×384 / 6144×768 / 12288×1536) |
| `godot --import` importer name | Godot 4.7 | `"texture"` = plain `CompressedTexture2D`; `"texture_atlas"` = the packing importer. A wrong string is silently rewritten to `"texture"`, so the file "looks fine" while the import did the wrong thing |
| `default_texture_filter` project setting | Godot 4.x | `1` is the engine default and means **Linear**. The consumer relies on that default |
| app `tsconfig` target `es5` / Node ≥ 18 | unchanged | No new syntax needed; the new modules are plain TS/ESM |

## Sources

- Godot docs — [`SpriteFrames`](https://docs.godotengine.org/en/stable/classes/class_spriteframes.html) (methods, `LoopMode`, relative `duration` formula), [`AtlasTexture`](https://docs.godotengine.org/en/stable/classes/class_atlastexture.html) (`region`/`margin`/`filter_clip`, the `AnimatedTexture` incompatibility note), [`Sprite2D`](https://docs.godotengine.org/en/stable/classes/class_sprite2d.html) (`hframes`/`vframes`/`frame`/`frame_coords`/`region_rect`, the `centered` pixel-art note), [`TileSet`](https://docs.godotengine.org/en/stable/classes/class_tileset.html), [`TileSetAtlasSource`](https://docs.godotengine.org/en/stable/classes/class_tilesetatlassource.html), [`ResourceImporterTextureAtlas`](https://docs.godotengine.org/en/stable/classes/class_resourceimportertextureatlas.html), [`ProjectSettings`](https://docs.godotengine.org/en/stable/classes/class_projectsettings.html) (`default_texture_filter = 1`), [Importing images](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/importing_images.html) (compress modes, mipmaps, TextureAtlas description), [2D sprite animation](https://docs.godotengine.org/en/stable/tutorials/2d/2d_sprite_animation.html), [Multiple resolutions](https://docs.godotengine.org/en/stable/tutorials/rendering/multiple_resolutions.html) (`canvas_items` vs `viewport`, integer scale). HIGH
- Godot source — [`resource_importer_texture_atlas.cpp`](https://raw.githubusercontent.com/godotengine/godot/master/editor/import/resource_importer_texture_atlas.cpp) (`get_importer_name() == "texture_atlas"`, `atlas_file` option, `save_png(p_group_file)`), [`canvas_item.h`](https://raw.githubusercontent.com/godotengine/godot/master/scene/main/canvas_item.h) (`TEXTURE_FILTER_NEAREST = 1`, `TEXTURE_FILTER_LINEAR = 2` — the enum trap). HIGH
- Gemini API docs — [Nano Banana image generation](https://ai.google.dev/gemini-api/docs/image-generation) (`aspect_ratio`/`image_size` under `response_format`, the per-model ratio × resolution tables including `8:1` and `4:1`). HIGH
- OpenRouter docs — [Image Generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation.md) (`size` authoritative, mismatched params → 400; `aspect_ratio` extended set), [Create a chat completion](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion.md) (`image_config` → `ImageConfig`), [Image generation server tool](https://openrouter.ai/docs/guides/features/server-tools/image-generation.md) (enumerated `image_config` params). HIGH
- Live probes (this machine, 2026-10-06) — **P1** `curl https://openrouter.ai/api/v1/images/models`: `google/gemini-3.1-flash-image` and `google/gemini-3.1-flash-image-preview` declare `["1:1","1:4","1:8","2:3","3:2","3:4","4:1","4:3","4:5","5:4","8:1","9:16","16:9","21:9"]`; `openai/gpt-image-2` and `gpt-image-2.5-*` declare no `8:1`. `/images/models/google/gemini-3.1-flash-image/endpoints` gives the same set with `resolution` ∈ {512,1K,2K,4K} and `input_references` ≤ 14. **P2** `POST http://127.0.0.1:3425/v1/images/generations` with a valid model: 504 after ~15 s; `~/.config/magpie/usage.jsonl` shows 2 successes ever (28.9 s, 35.0 s) and 4 failures (3×504, 1×400). **P3** headless Godot 4.7.2 generated `SpriteFrames` `.tres` with 4 `AtlasTexture` frames, and a second run with 16 across 4 animations; a third run *reloaded* the file and read back `frames=4 speed=4.0 loop=1` and `AtlasTexture region=[P: (128,0), S: (64,64)] filter_clip=true` — the exact text is reproduced in Alternatives/Patterns above. **P4** `ProjectSettings.get_setting` read back from `dark-black`: `default_texture_filter = 1`, `snap_2d_transforms_to_pixel = false`, `stretch/scale_mode = "integer"`. **P5** re-ran `build_handpainted_sheets.chroma_key`+`column_profile`+`panel_boxes` over all 40 committed strips: uniform cell `W/N`, fitted spacing within 2.25 % (mean 0.91 %), 1/40 warned. **P6** PNG headers of all 40 strips: `11712×1408` (8-dir) and `4128×1024` (4-dir), widths divisible by the cell count 40/40. **P7** importer-name probe on a scratch Godot project: `importer="texture_atlas"` was accepted by `godot --import` and its `[remap]` was rewritten to a `.res` target; `importer="atlas"` was silently rewritten back to `"texture"`. HIGH for P1/P3/P4/P6/P7, HIGH for P5 as a re-measurement, MEDIUM for P2's cause (timeout vs upstream latency is not distinguishable from outside the binary).
- `dark-black` (consumer, primary record) — `tools/gen_assets_teamo.py` (strip-per-(state,frame) rationale at :10-13, prompt at :97-113, `--go` gate, ledger), `tools/build_handpainted_sheets.py` (`DIRS8` order, `CELL=64`/`INNER=56`, `panel_boxes` search, `fit_panel` trim→fit, `keep_main_blob`, `remove_card`), `docs/handpainted/P2-P3-PLAN.md:115-125` (the four measured "doing it by the doc gets it wrong" findings), `scripts/actors/enemy.gd:42-92,108,193` (`frame = row * FRAMES + col`, `HANDPAINTED_PATH`, `vframes = N_STATES * 8`, `scale 0.5`), `tools/check_enemy.gd:1428-1443` (atlas geometry gate), `tools/gen_project_settings.gd:22-31` (why Linear + no snap). HIGH
- `image-extender` (this repo) — `app/api/generate/route.ts:7-34,148-161`, `app/lib/imageGeneration.ts:74-165` (the chat adapter drops `width`/`height`), `app/lib/apimartServer.ts:27-97`, `app/lib/providers.ts:53-190`, `app/lib/libraryTypes.ts:7-51`, `app/lib/libraryPath.ts:14-36`, `cli/native/bridge.mjs:107-153,276-321`, `~/.agents/skills/image-extender/scripts/native/bridge.mjs:42-62,107-153,285-400` (`geminiAspect` includes 1:8/8:1; APIMart exact-pixel cap 3840; native `generateContent` rewrite). HIGH

### What a probe must still establish (and how)

1. **Does magpie carry an 8:1 strip at all?** One call: `POST http://127.0.0.1:3425/v1/images/generations` with `{"model":"teamo-router/gemini-3.1-flash-image","prompt":"…strip…","size":"8:1"}`. Read `~/.config/magpie/usage.jsonl` afterwards (it records `status`, `ms`, `ep`) rather than trusting the HTTP code alone — the 504s above are already in that log. Expect a 504; if so the fallback is Teamo direct, and the fallback's `imageConfig.aspectRatio` must be computed from the **pixel size** (as `geminiAspect` already does), not from the app's route table.
2. **Does the returned strip honour the grid?** After the call, run the P5 measurement (`column_profile` + `panel_boxes`) on the returned PNG and compare fitted spacing against `W/N`. The committed corpus says expect ≤ 2.3 % deviation with occasional larger phase errors; anything worse means the prompt's gutter instruction is not being obeyed.
3. **Does the returned *size* match the request?** Compare IHDR against `4096×512`. The corpus says it will not (8.318:1 came back). Record both into `provenance.requested`/`returned` — the fields already exist.
4. **Does a widened ratio list actually change the canvas?** After adding `4:1`/`8:1` to `SUPPORTED_IMAGE_ASPECT_RATIOS`, assert the *returned* aspect is nearer 8 than 2.33. A cheaper proxy before spending: `curl` the gateway with a bogus ratio and read the enumerated accepted set, as `~/.agents/skills/image-extender/scripts/native/bridge.mjs:67-69` documents.
5. **Does the consumer's gate accept a generated atlas?** Generate the atlas and `.tres` headlessly, then run `godot --headless --path ~/repos/dark-black --script tools/check_enemy.gd` and confirm the ATLAS section stays green.

---

*Stack research for: AI-driven 2D game-art pipeline (exact-aspect generation → engine-ready animated sprite sets)*
*Researched: 2026-10-06*
