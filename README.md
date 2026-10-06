# Image Extender

> Seamlessly extend any image in any direction with AI — then build whole 2D
> game art sets (parallax backgrounds, autotiles, sprite animations, and
> decoration props) from the same studio.

A small open-source web app for AI outpainting **and** 2D game-art generation.
Powered by Google's Gemini image models via [OpenRouter](https://openrouter.ai),
with a Poisson-blending pipeline that hides the seam between original and
AI-generated pixels, plus purpose-built pipelines for tiles, sprites, and props.

Bring your own OpenRouter API key — it stays in your browser, never on the
server.

![A 1024² portrait shot extended into a cinematic wide-angle scene with no visible seam](docs/screenshots/after.png)

## Before / After

A single 1024 × 1024 phone-style portrait → a wide 16:9 cinematic frame, in
a few clicks. Same colors, same lighting, same wet-pavement reflections —
just much, much more of them.

| Before · 1024 × 1024 | After · extended L+R into a cinematic wide |
| --- | --- |
| ![Square portrait shot of a person in a yellow jacket on a neon-lit Brooklyn corner](docs/screenshots/before.png) | ![The same scene extended sideways into a wide cinematic frame](docs/screenshots/after.png) |

## Five modes — Extender + Parallax + Tiles + Sprites + Props

The app ships as a tiny studio with five workspaces, switchable from the pill
in the top bar:

- **Extender** (default) — outpaint any image in any of four directions, with a
  best-of-3 seam-quality variant picker.
- **Parallax Studio** — build a real, multi-layer sidescroller background from
  scratch: separate **Sky / Far / Mid / Near** layers, role-aware AI prompts,
  chroma-keyed transparent layers, a live multi-layer scrolling preview,
  auto-extend to a target width, tileable-loop healing, and one-click ZIP export
  with a JSON manifest.
- **Tile Studio** — a 13-tile autotile set for 2D platformers (body + 4 edges
  + 4 outer corners + 4 inner corners) generated in **one** AI call as a 4×4
  sprite-sheet, with deterministic corner reconciliation and an AI "art
  director" QA/repaint loop. Palette and texture detail stay locked across the
  whole set.
- **Sprite Studio** — character & creature animations as a single AI-call sheet.
  Pick a **body plan** (humanoid, quadruped, serpent/fish, flyer/bird, or blob),
  pick an animation, describe the creature, and get a keyframe sheet back with a
  live animation player and engine-ready export. Each body plan drives its own
  anatomy-specific pose-guide rig and animation set.
- **Props Studio** — an open-ended, ever-growing library of standalone
  transparent **decoration sprites** (the kind games layer on top of the tile
  map) generated 8 at a time, driven by a two-call "art director → painter"
  pipeline that keeps the set varied and never repetitive.

### Parallax Studio
![Parallax Studio — Sky / Far / Mid / Near depth layers with a live multi-layer scrolling preview and ZIP export](docs/screenshots/mode-parallax.png)

### Tile Studio
![Tile Studio — a 13-tile autotile set generated in one call, with a live "how tiles fit together" platform preview](docs/screenshots/mode-tiles.png)

### Props Studio
![Props Studio — an open-ended decoration library of transparent scatter sprites grown 8 at a time](docs/screenshots/mode-props.png)

### Sprite Studio
![Sprite Studio — a character walk-cycle keyframe sheet with a live looping animation player](docs/screenshots/mode-sprite.png)

## Features

- **Click an edge → extend in that direction.** Spatial controls on the image,
  no dialog-tree UX.
- **Best-of-3 variant picker.** Every extension generates up to 3 candidates,
  sorted by seam quality. Cycle through them with `← →` and pick the one
  you like before accepting.
- **Poisson-blended seams.** Uses gradient-domain image editing (Pérez et al.
  2003) with mask-grow + replicate-padded Gauss-Seidel iterations to make the
  AI-original boundary mathematically invisible.
- **Pre-correction for low-frequency color drift.** Bulk-shifts the AI output
  toward the original's color at the seam before blending, which fixes the
  "the sky got slightly bluer" failure mode common to outpainting.
- **Optional prompt + art style.** Leave the prompt blank for pure scene
  continuation, or add specific instructions like *"add an alien moon
  rising on the horizon"*.
- **Custom art styles.** 40+ styles from cinematic and oil painting to
  Studio Ghibli, cyberpunk, vaporwave, etc.
- **Bilingual UI (English / 中文).** Every surface, including API-route errors,
  follows the language picked in the top bar; the choice persists locally.
- **BYOK (Bring Your Own Key).** Your OpenRouter key is stored only in your
  browser's `localStorage`. The server proxies your requests to OpenRouter
  but never logs or persists the key.
- **Model picker.** Switch between Gemini 3 Pro Image (Nano Banana Pro),
  Gemini 3 Flash Image (Nano Banana 2), and Gemini 2.5 Flash Image (Nano
  Banana) from Settings — each with tuned best-of-N and timing.
- **Keyboard-first.** Arrow keys to extend, `←`/`→` to cycle variants,
  `Enter` to accept, `R` to regenerate, `Esc` to discard.
- **Generate from scratch.** Don't have a base image? Generate one with a
  text prompt first, then extend.
- **Shared scene brief.** One auto-generated "scene brief" (setting, time of
  day, palette, mood) is distilled from your prompt and reused across Parallax,
  Tiles, Sprites, and Props so every asset in a project feels like one world.

### Parallax Studio (for game designers)

- **4 real depth layers.** Sky (back, opaque), Far (distant silhouettes), Mid
  (mid-ground), Near (foreground props). Pick a card on the left, edit just
  that layer in the canvas — the same extend pipeline as Extender, but the
  studio knows what each layer is for.
- **Role-aware AI prompts.** When you generate or extend a layer, the model
  is told its role and asked to produce only that depth band. Far / Mid / Near
  come back rendered against a flat magenta key (`#FF00FF`) which the client
  replaces with real alpha — so each layer composites cleanly over the sky.
- **Live multi-layer preview.** Stacked, GPU-accelerated `repeat-x` scroll for
  every populated layer, each at its own adjustable speed (Sky drifts slow,
  Near runs fast). Tweak per-layer speed sliders and feel the depth in real
  time before exporting.
- **Locked horizontal extension.** Only `←` and `→` are exposed — vertical
  extends would warp the game height, so they're suppressed.
- **Auto-extend to target width.** Pick a target (e.g. 7680px = 4 × 1080p
  screens) and walk away. The studio repeatedly extends the active layer
  right, auto-accepts the best variant, re-applies chroma-keying, and stops
  when the target width is reached. Click `Stop` to interrupt.
- **Tileable loop point.** Game engines tile parallax backgrounds with
  `repeat-x`. The `Tileable` button does the standard "offset by half / heal
  the new middle seam / offset back" pass so the texture loops invisibly. It
  also **auto-runs at the end of auto-extend** so the default exported result
  Just Works.
- **Harmonize seams.** A separate optional pass for the *other* common problem:
  each AI extend introduces a tiny color/brightness shift, and over many
  extensions those shifts pile up into vertical "panel banding". The
  `Harmonize` button runs a column-mean smoothing that kills the banding while
  preserving fine detail.
- **Width presets.** Quick-pick common targets (3840 / 5120 / 7680 / 10240 /
  15360 px) corresponding to multiples of 720p / 1080p screens.
- **One-click ZIP export.** Bundle all populated layers as PNGs (with alpha
  preserved) plus a `parallax.json` manifest listing depth order, scroll
  speeds, and dimensions — drop the ZIP into Unity / Godot / Phaser and wire
  it straight into your parallax controller.

### Tile Studio (2D platformer autotiles)

- **Whole 13-tile set in one AI call.** Body + 4 straight edges + 4 outer
  (convex) corners + 4 inner (concave) corners are generated together as one
  4×4 sheet, so palette, texture scale, and lighting are **locked** across the
  set instead of drifting across 13 separate calls.
- **Template-guided image-to-image.** Rather than ask the model to invent an
  atlas from text, it restyles a structural reference — a rounded rectangle
  with a rectangular hole on flat magenta. Each of the 13 roles lives at a known
  cell, so the client slices them out deterministically after restyle.
- **Auto-alignment + chroma key.** The restyled output is re-fitted to the
  template silhouette (fixing the "AI painted it smaller, centered" failure),
  magenta is keyed to alpha with a tile-tuned chroma key, and edge tiles are
  made tileable along their loop axis.
- **Deterministic corner reconciliation.** Corners are the hardest tiles, so
  the app stitches them rather than trusting raw AI cells: outer corners keep
  their painted cap and get a feathered **edge graft** so the grain matches
  their straight neighbors in both directions; inner corners preserve the AI
  art and graft only the seams that touch straight edges. The result is
  seamless corners run-to-run.
- **AI "Art Director" QA/repaint loop.** After generation the set is composited
  into a platform-preview mockup and handed to a *vision* critic that judges it
  like a senior tileset artist — checking the chroma key actually keyed out
  (no opaque background blocks), edge-cap consistency, palette/lighting
  cohesion, body seamlessness, fringe, and blur. If it fails it returns a
  concise fix report that drives a repaint; if it passes it ships. The critic
  is deliberately scoped to **painter-fixable** defects (it does not nitpick the
  app-composited corner geometry).
- **Keep-best selection.** Every pass is scored and the loop commits the *best*
  candidate it saw, never just the last one — so a flaky critic + full repaint
  can only ever improve on, never regress, a clean first generation.
- **Tileable body, no visible grid.** The repeating body fill gets a stronger
  2D-seamless pass (full tonal equalization + wide seam blends), and the prompt
  forbids cell-sized panels / long streaks / hero features, so the interior
  reads as one continuous surface when repeated.
- **Live "how tiles fit together" preview** and per-tile re-roll. Regenerate a
  single tile without touching the rest; the set re-reconciles its corners
  afterward.
- **Engine-ready atlas export.** Export the padded atlas (with a 2px duplicated
  **extrude** border around every tile to stop filtering/sub-pixel bleed in
  Unity / Godot / Phaser / Tiled) plus per-tile PNGs and a manifest.
- **14 material presets** — lush meadow, mossy stone, red brick, snowy peak,
  oak planks, desert sandstone, volcanic rock, glow cave, crystal ice, jungle
  floor, autumn earth, marble & gold, obsidian, coral reef — each a rich
  palette/surface description you can edit.

### Sprite Studio (character animations)

- **Two-pass anchor → sheet workflow.** Naive single-call multi-panel
  generation flickers — the character drifts between cells, frames come out at
  different scales, palettes shift. We adopt the consensus approach from the AI
  sprite community:
  - **Pass 1 — Lock character.** Generates a single neutral standing reference
    image of the character on a flat magenta key.
  - **Pass 2 — Paint sheet.** Generates the keyframe sheet with the anchor
    attached as a reference: *"the attached image is the canonical character —
    every cell must match it exactly."* This is the single biggest lever for
    cross-frame identity preservation.
  - The anchor **persists across animation switches**, so the same character can
    be re-used for idle → walk → run → jump → attack without re-rolling
    identity. A `Re-roll character` button discards the anchor for a fresh one.
- **Five body plans.** A humanoid skeleton can't drive a galloping wolf, a
  slithering eel, a flapping bird, or a bouncing slime — so Sprite mode branches
  on anatomy. Pick a **body plan** and the studio swaps in the matching pose rig,
  animation set, starter creatures, and QA expectations, while reusing the same
  anchor → sheet → align → export pipeline:
  - **Humanoid** (biped) — knights, mages, goblins, bosses.
  - **Quadruped** — wolves, big cats, horses, hounds, plus everyday animals
    (dog, cat, cow, deer, bear, fox, pig, goat).
  - **Serpent / Fish** — snakes, eels, and marine life (shark, clownfish,
    pufferfish, anglerfish, swordfish, dolphin, sea serpent, piranha).
  - **Flyer / Bird** — birds, bats, wyverns, fairies, phoenix.
  - **Blob** — slimes, oozes, elementals, ghosts (pure squash & stretch).
- **Anatomy-specific pose-guide rigs.** Each body plan ships a deterministic,
  code-generated pose-guide sheet (a "ControlNet-style" mannequin) drawn fresh
  for the chosen action and fed in as structural reference. Rigs use near/far
  value separation + dark outlines so overlapping limbs stay readable, and they
  render real anatomy — a quadruped spine + 4 legs with a head-bob gait, a
  serpent spine wave with an open-jaw strike, filled bird **wing membranes**
  with a proper flap/dive, and blob squash-&-stretch arcs.
- **Deterministic twin detector.** A pixel-analysis pass scans each cell's alpha
  for two creatures in one frame (a common multi-panel failure), including a
  morphological-opening step that splits *fused* duplicates, and forces a
  repaint when it finds them. Sprite generation leans on these deterministic
  checks rather than a vision critic, so it isn't blocked waiting on a QA model.
- **Scale normalization.** The model redraws the creature at a slightly
  different size in every cell, so the silhouette "breathes" during playback.
  A pass measures each frame's tight silhouette (bbox diagonal), takes the
  median as the intended scale, and rescales each frame toward it — within a
  tolerance + clamp so genuine pose extension (a run reach, an attack lunge)
  keeps its shape.
- **Baseline & horizontal alignment.** Frames are foot-baseline aligned to one
  shared in-cell floor and horizontally centered so playback doesn't bounce or
  slide. Grounded gaits (idle / walk / **run**) plant *every* frame on the floor
  line; only truly ballistic actions (jump, pounce) keep their airborne lift via
  a rigid shift, so a galloping run can't split into a high row and a low row.
- **Per-body-plan animation sets.** Humanoid: idle / walk / run / jump / attack /
  hurt / death. Quadruped: idle / walk / run / jump / pounce / hurt / death /
  sleep. Serpent: idle / slither / strike / coil / hurt / death. Flyer: idle /
  flap / glide / dive / hurt / death. Blob: idle / hop / bounce / lunge / hurt /
  death — each with tuned choreography and a sensible default FPS.
- **Live animation player.** Looping / one-shot playback at the anim's native
  FPS with play/pause and a frame scrubber; the FPS slider tunes the feel before
  exporting.
- **Creature preset chips.** One-click archetypes per body plan seed the prompt
  (humanoid knight/ninja/wizard…, quadruped wolf/bear/cat…, marine shark/koi…,
  flyer hawk/wyvern…, blob slime/ooze…).
- **Engine-ready export.** Download the grid sheet, a horizontal strip
  (preferred by Phaser / Unity 2D / Godot / Defold), or a ZIP with both sheets,
  one PNG per frame, and a `manifest.json` listing FPS, loop flag, frame size,
  and per-frame grid + strip coordinates.

### Props Studio (scatter decoration)

- **Open-ended, growing library.** Instead of a fixed sheet of dictated items,
  the model freely invents decoration props for your biome. Each "add more"
  press paints another batch of **8** props in one AI call and **appends** them
  — the library grows without bound and never re-rolls what already exists.
- **Two-call "art director → painter" pipeline.** Call #1 is a *text/reasoning*
  model acting as art director: given the biome and the categories already in
  the library, it invents the next batch of brand-new, distinct prop ideas
  (deliberately reaching across plants, minerals, bones, debris, totems,
  containers, creature traces, light sources, etc.). Call #2 is the image model,
  which paints exactly what the director decided. Splitting *ideation* from
  *rendering* is what stops the "same lanterns/pots/nests loop."
- **Cheap text de-duplication.** Each prop reports a one-word category that's
  tallied and fed back as a text budget hint, so new batches avoid look-alikes
  without ever shipping the whole library back as images.
- **Style-locked across batches.** A small montage of existing props is attached
  as a visual style anchor so palette / lighting / rendering stay consistent as
  the library grows.
- **Curate freely.** Re-roll or delete any single prop; everything is generated
  on transparency.
- **8 biome presets** — forest glade, glowing cave, desert oasis, snowy peaks,
  volcanic, jungle ruins, misty swamp, candy land — these set palette/mood only,
  never specific items, so the model stays free to invent.
- **Descriptive names in the manifest.** Because the art director already named
  each prop (the kind it decided to paint), the export uses that instead of
  anonymous `prop_001`: the manifest carries a human `name` per prop and the
  files are named after it (`lantern.png`, `mushroom.png`, with `_02`/`_03`
  suffixes on repeats), so the atlas is self-documenting in your engine.
- **Atlas + ZIP export.** Export the whole library as a packed transparent atlas
  PNG with a JSON manifest, or a ZIP of individual transparent PNGs + atlas +
  manifest.

## The AI "Art Director" QA pattern

Tiles and Props share a two-call reasoning-vs-rendering pattern that
consistently beats a single blind generation:

- **Props** run it *forward*: a reasoning model decides **what** to make, then
  the image model renders it.
- **Tiles** run it *in reverse*: the image model generates first, then a vision
  model reviews the composited result and, if needed, sends a concise fix report
  back for a repaint — with keep-best selection so the loop can only improve the
  output. (The review is auto-skipped on slow models like GPT image to avoid
  multi-minute blind waits.)
- **Sprites** lean on **deterministic** post-process checks instead of a vision
  critic — scale normalization, baseline grounding, horizontal centering, and a
  pixel-level twin/spillover detector that forces a repaint on duplicates. This
  keeps sprite generation fast and predictable rather than blocked on a QA model.

Critics are scoped to defects the painter can actually fix, run at low
temperature for consistency, and fail-open (a flaky critic never blocks you).

## How extension works

```
┌─────────────┐   1. expand canvas with        ┌───────────────────┐
│  original   │ ──  light-gray blank area ──▶  │  expanded canvas  │
└─────────────┘     in chosen direction        └─────────┬─────────┘
                                                         │
                                                         ▼
                                              ┌─────────────────────┐
                                              │  Gemini outpaints   │
                                              │  the blank region   │
                                              └─────────┬───────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────────┐
                                              │  pre-correct color  │
                                              │  drift at seam      │
                                              └─────────┬───────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────────┐
                                              │  Poisson blend with │
                                              │  grown mask         │
                                              └─────────┬───────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────────┐
                                              │  measure seam       │
                                              │  residual, repeat   │
                                              │  ×3, sort, present  │
                                              └─────────────────────┘
```

For horizontal extensions we run the pipeline up to 3 times in parallel
attempts (each at a different temperature), measure the seam residual of
each blended result, and present the candidates sorted best-blend first.
You're free to cycle and pick a different one if you prefer the AI's
content choices over the cleanest seam.

Vertical extensions use a different chunked path that's deterministic
enough that 1 attempt usually suffices.

## Quick start

```bash
git clone https://github.com/boona13/image-extender.git
cd image-extender
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first load the app
will prompt for your OpenRouter API key — paste it once, it's stored locally,
you'll never see the prompt again unless you clear it from Settings.

Get a key at [openrouter.ai/keys](https://openrouter.ai/keys). It costs
about **$0.03 per Gemini extension** (Nano Banana 2 Flash Image).

### Optional: server-side env fallback

If you'd rather not enter the key in the browser (or you're hosting a demo
where you want to provide the key for visitors), copy `.env.example` to
`.env.local` and fill in your key:

```bash
cp .env.example .env.local
# edit .env.local and add your OPENROUTER_API_KEY
```

When set, the server will use this key for any request that doesn't
include a client-provided one.

## Usage

| Action | How |
| --- | --- |
| **Switch mode** | Click `Extender` / `Parallax` / `Tiles` / `Sprite` / `Props` pill in the top bar |
| **Upload image** | Drag & drop, click the dropzone, or generate one from text |
| **Extend** | Click one of the four edge handles, or press `↑` `↓` `←` `→` (parallax mode: `←` `→` only) |
| **Cycle variants** | `←` `→` arrow keys (or chevrons in the pill below the image) |
| **Accept / Regenerate / Discard / Download** | `Enter` / `R` / `Esc` / `Download` button |
| **Pick a parallax layer** | Click a card in the left panel (Sky / Far / Mid / Near) |
| **Adjust per-layer scroll speed** | Drag the slider on each layer card — preview updates live |
| **Auto-extend (parallax)** | Set a target width, click `Auto-extend`, click `Stop` to interrupt |
| **Make tileable / Harmonize (parallax)** | `Tileable` heals the loop seam (auto-runs after auto-extend); `Harmonize` flattens cumulative drift |
| **Export project (parallax)** | Click `ZIP` → all layers + `parallax.json` manifest |
| **Generate a tile set** | Describe the material, click generate — one AI call, auto corner-reconcile + QA review |
| **Re-roll one tile** | Click the spark on a single tile cell (re-reconciles corners after) |
| **Export tile set** | Atlas (with extrude padding) + per-tile PNGs + manifest |
| **Pick a sprite body plan** | Choose `Humanoid` / `Quadruped` / `Serpent / Fish` / `Flyer / Bird` / `Blob` — swaps the rig, anim set, and presets |
| **Pick a sprite animation** | Click an animation chip (the set depends on the body plan) |
| **Lock a sprite character** | Pick a starter chip (or describe one), click `Lock character + <anim>` — runs both passes |
| **Re-roll a sprite anim / character** | `Re-roll <anim>` runs Pass 2 only (identity preserved); `Re-roll character` runs both from scratch |
| **Play / pause sprite, adjust FPS** | Play button + scrubber under the live player; drag the `FPS` slider |
| **Export sprite project** | `Sheets + manifest` for grid + strip PNGs, or `ZIP` for everything |
| **Generate props** | Pick a biome preset (or describe one), click add — paints 8 new distinct props and appends them |
| **Add more props** | Press add again — another batch of 8, deduped against the existing library |
| **Curate props** | Hover a prop to re-roll or delete it |
| **Export props** | `Atlas + manifest` for the packed transparent atlas, or `ZIP` for individual PNGs + atlas + manifest |
| **Paste the PixelLab key (Pixel mode)** | Fill `PixelLab key` in the bottom rail — BYOK, kept in this browser and sent only to the `/api/pixel` proxy |
| **Generate a pixel asset (Pixel mode)** | Pick a quick start or describe it, then `Generate tile` / `Generate prop`; the `Tiles & props` ⇄ `Character` select in the prompt bar switches the generator |
| **Generate a pixel character (Pixel mode)** | `Character` mode runs one 8-direction job (~2–5 min) and polls until it lands |
| **Impose the pixel grid (Pixel mode)** | `Block` / `Cell` set the lattice every result is re-quantised onto; `Defaults` restores block 2 / cell 32 |
| **Inspect a pixel asset (Pixel mode)** | Hover a card: flip `source` ⇄ `processed`, download the PNG, or drop it from the gallery |
| **Save a pixel asset (Pixel mode)** | `Save to library` — only processed assets are stored; the raw vendor output goes under `raw/` |

Optional custom prompt and art style live in the bottom command bar.

## Gateways

Every generation and art-director call goes to one OpenAI-compatible gateway,
chosen in **Settings → Gateway**:

| Gateway | Base URL | Key | Image calls |
| --- | --- | --- | --- |
| **OpenRouter** (default) | `https://openrouter.ai/api/v1` | `sk-or-…`, required | chat completions |
| **Magpie gateway** | `IE_MAGPIE_BASE_URL`, default `http://127.0.0.1:3425/v1` | usually none | chat completions |
| **APIMart** | `https://api.apimart.ai/v1` | `sk-…`, required | async task API |

**APIMart** is the odd one and has its own adapter (`app/lib/apimartServer.ts`):
image models are not a chat completion but `POST /images/generations` →
`GET /tasks/{id}`, so the server submits, polls (~10–20s), downloads the
finished render and **inlines it as a data URL** — the result is an expiring
cross-origin URL, and a canvas the client cannot read would break chroma
keying, slicing and Poisson blending alike. Sizes are a ratio (`2:1` exists
here and not on OpenRouter) or, on `gpt-image-2-official`, exact pixels snapped
to a multiple of 16, which is what the vendor's own rejection demands. Reference
images (tile guides, pose maps, anchors, the canvas being extended) ride along
in `image_urls`. Chat still works, so the art-director passes run here too —
with `stream: false`, because this vendor defaults to SSE.

Keys are **scoped per model** on APIMart: a key that paints images can still be
refused a text model (`403 does not have access to model …`), and the reverse.
- Discovery is automatic: opening Settings paints the last model list this
  gateway reported, then asks it again behind that. Model ids come from the
  gateway, never from a list in this repo. The status line reads
  `N models · M image (V verified) · K vendors`, with a chip per upstream
  **vendor** — the gateway's own suppliers — to filter them.
  `Check connection` forces a fresh probe.
- **Only models this project has verified are offered.** A gateway reporting a
  model is not a promise that it answers, and the two gateways fail in
  different ways, both measured:
  - **magpie**: of the 8 image ids it lists, 1 works, 4 need upstream
    credentials it does not hold (`google/*`, `antigravity/*`, `group/*`), and 3
    refuse `/v1/chat/completions` (`teamo-router/gpt-image-2*`).
  - **APIMart**: **every one of its 45 image ids was probed** by generating with
    it. 34 answer and are what the picker offers — the `gemini-*` family, flux,
    seedream, qwen, wan, z-image, grok, the gpt-image ladder. The 11 that do not:
    `chatgpt-image-latest` and `ltx-2.3-image-video` are not served by
    `/images/generations` at all, `dall-e-2`/`dall-e-3` are not enabled on the
    account, `flux-3-video` wants `hd`/`fhd` instead of a tier,
    `seedream-5-0-lite` and `ltx-2.3-text-image` are unsupported upstream,
    `imagen-4.0-apimart` fails vendor-side, and `gpt-image-1` / `-1-mini` /
    `-1.5` are rate limited. `seedream-4-5` only answers at 2K or 4K, which the
    adapter's tier escalation handles.
  The verified set is `VERIFIED_MODELS` in `app/lib/providers.ts` — measured,
  with the failures named in the comment — and everything else a gateway
  reports sits behind `Show N more (unverified)`, flagged `not verified here`
  if you pick it. The art-director select is grouped the same way. OpenRouter
  has no verified entry because its picker *is* the curated `MODELS` table,
  verified by construction.
- One fallback default per gateway is the only other hardcoded model id, and it
  is shown only before the first successful check.
- An **image model** and an **art-director model** are separate settings: the
  scene brief and the tile / sprite review passes need a model that accepts an
  image as input, which the image models do not. Each gateway carries its own
  defaults; switching gateways resets both to them, because a model id means
  nothing on the other gateway.
- The base URL never comes from the browser — a client-supplied URL would make
  the server a fetch-anywhere proxy carrying your key. It is resolved from the
  table above plus that env override.
- Gateways differ in where they put the render in a chat response: OpenRouter
  uses `message.images[]`, and a magpie → teamo-router response embeds a
  markdown `![image](data:…)` link in the text. Both are read.

The verified list is the *measured* answer to "which ids can this app actually
call", so it is deliberately small: adding an id is a manual edit after running
it, and the escape hatch keeps everything else one click away. If your gateway
holds different upstream credentials, run the model once and add it to
`VERIFIED_MODELS` — the picker then treats it as verified everywhere.

## Tech stack

- **[Next.js 14](https://nextjs.org/)** (App Router) + React 18 + TypeScript
- **[Tailwind CSS](https://tailwindcss.com/)** for the dark studio theme
- **HTML Canvas** for all client-side image manipulation
  ([app/utils/imageProcessor.ts](app/utils/imageProcessor.ts))
- **[JSZip](https://stuk.github.io/jszip/)** for in-browser project bundling
- **An OpenAI-compatible gateway** for model access ([OpenRouter](https://openrouter.ai)
  by default, or a local magpie gateway — see **Gateways**). The defaults:
  - Image: `google/gemini-3.1-flash-image-preview` (Nano Banana 2, default),
    `google/gemini-3-pro-image-preview` (Nano Banana Pro),
    `google/gemini-2.5-flash-image` (Nano Banana), and
    `openai/gpt-5.4-image-2` (GPT-5.4 Image 2 — high fidelity, slower)
  - Reasoning / vision QA (scene brief, prop art director, tile review):
    `google/gemini-2.0-flash-001`
  - On magpie: `teamo-router/gemini-3.1-flash-image` for images and
    `commandcode/Qwen/Qwen3.7-Plus` for the vision passes (both measured —
    the `google/*` ids a gateway may list need a Google key it does not have,
    and `teamo-router/gpt-image-2*` refuses `/v1/chat/completions`)

## Asset library

Generated assets are saved to a local, git-shareable directory:

    assets/<project>/<kind>/<slug>/
      meta.json      # manifest + provenance (backend, model, params)
      raw/           # model output — gitignored
      derived/       # finished tiles / frames / atlases — versioned

- Every studio can save its result: Extender, Parallax, Tiles, Sprite, Props and
  the Pixel studio. `kind` follows the studio; the Pixel studio records
  `backend: pixellab`.
- `IE_ASSETS_DIR` overrides the location (default `<repo>/assets`).
- Sharing with a teammate is `git pull` — one directory per asset means two people
  adding assets never touch the same files, so there are no merge conflicts.
- `raw/` is deliberately not versioned: one 4096² sheet is ~11 MB and a hundred of
  them would make the repository unusable. The prompt and parameters in `meta.json`
  are enough to regenerate it.
- `provenance.cost` is reserved but currently always `null`: the value is parsed
  out of `/api/generate` responses but is not threaded into the studios' state yet.

## AI-driven UI tests (Midscene + Playwright)

```bash
npm run test:ai          # 11 specs, ~15s + model latency
npm run test:ai:report   # open the Playwright report
```

Kept separate from `npm test` (vitest: fast, layer-level, every save) because this
one boots a real dev server and drives a real Chromium through a vision model.

- **Model config**: copy `.env.midscene.example` to `.env.midscene` and point it at
  an OpenAI-compatible endpoint exposing a multimodal model with UI localization.
  Verify any config with `npx @midscene/cli model verify`. The checked-in example
  targets a local gateway and contains no secret.
- **First run** needs the browser: `npx playwright install chromium`.
- **Test data isolation**: `e2e/fixtures/assets/` is copied to a temp dir per run
  and passed as `IE_ASSETS_DIR`, so a spec that saves or deletes an asset can never
  touch the repository's own `assets/`.
- **Locators over AI**: anything structural is asserted with a normal Playwright
  locator (exact, free, instant). `aiAssert` is reserved for what a selector cannot
  express, e.g. "a thumbnail is rendered next to the item".
- **Reports**: Midscene writes `midscene_run/report/*.html` (every step, with
  screenshots), Playwright writes `playwright-report/`.

## Stylized art: which studio for which job

Two different things get called "pixel art", and only one of them is a pixel-art
generator. Measured on this fork, 2026-10-05:

| You want | Use | Why |
|---|---|---|
| **A real pixel grid** — 2×2 block purity 1.0, zero partial alpha, 13 colours | the **Pixel** studio (PixelLab) | Diffusion models *paint* a pixel look; they do not *place* pixels. Gemini scored 0.05 purity on a strict grid contract vs PixelLab's 0.84–0.87, and its output still held ~5,800 colours after a best-phase decimate |
| **A stylized look** — retro/pixel-ish or low-poly, for sprites, tiles, props, backgrounds | the other five studios with `Art style` set | Style is a look, not a lattice; general models do this well |

### Recipes that measured well

- **`low-poly`** — the strongest result by a distance. Faceted flat-shaded
  planes with crisp edges; eight-frame walk sheets came out consistent in build,
  colour and silhouette, and `sprite-align` reported no duplicate frames. It also
  produces excellent faceted backgrounds. **Start here.**
- **`pixel-art`** — reads correctly at native resolution (flat blocks, limited
  palette, hard edges), but a single-pass sheet drifted in two of eight frames.
  Use the **two-pass sprite flow** (generate the character anchor first, then the
  sheet with it attached as the identity reference); the anchored sheet was
  visibly steadier.
- **`cartoon`** — a clean third option; useful as a control when judging whether
  a style change did anything.

Judge these **by eye at native resolution**. Colour count and block-purity are
useless for stylized art: a hard-edged limited-palette render can carry *more*
distinct RGB values than a soft painterly one, because every block edge
anti-aliases.

### Caveats

- **Outpainting a hard-edged source can leave a structural seam.** Both samples
  of a 38% right extension showed a vertical discontinuity where the source's
  edge content was not continued. The Poisson blend fixes colour offsets, not
  missing structure. The UI mitigates this by generating several candidates and
  keeping the one with the lowest seam residual; a single headless `ie.py extend`
  attempt does not.
- A style only reaches the model when the prompt path carries it. That was
  broken for the sprite-sheet, tile-sheet and sprite-anchor paths until
  2026-10-05; `app/lib/stylePrompt.ts` is now the single source for every route
  that mentions a style.

## Localization

The UI ships in **English (default) and Chinese (中文)**. Pick a language with
the switcher in the top bar — the choice persists in `localStorage`
(`extender:locale`), drives `<html lang>`, and updates the document title.

No routing and no extra dependency: one React context plus one message module
per area.

| Piece | What it does |
| --- | --- |
| `app/lib/i18n.tsx` | `I18nProvider` (locale state + persistence) and the `useI18n()` / `useT()` hooks; `t(key, params?, fallback?)` interpolates `{placeholders}`. |
| `app/i18n/index.ts` | Locale list, the aggregated dictionary, and the key types. |
| `app/i18n/messages/<area>.ts` | Flat dotted keys (`shell.topbar.newImage`) with an `en` and a `zh` map — one module per surface (`common`, `shell`, `modals`, `extender`, `parallax`, `sprite`, `tile`, `props`, `pixel`, `errors`). |
| `app/i18n/messages/common.ts` | Shared vocabulary keyed by data id (`common.artStyle.<value>`, `common.layer.<role>.label`, `common.anim.<type>.hint`, `common.creature.<presetId>`, …) so a label rendered in two studios has one translation. |
| `app/i18n/serverErrors.ts` | Maps the app's own server (`{ error }`) and canvas/loader messages onto keys; unknown text (provider passthrough) is shown as-is. |

Conventions:

- The Chinese map is typed against the English key set, so a **missing
  translation fails `tsc`** instead of silently falling back.
- Labels built from data ids resolve through `common.*` with the English string
  as `fallback` — a gateway model the dictionary has never seen still renders.
- **Prompt text stays English on purpose.** Preset prompts, body-plan
  descriptions, sprite choreography and anything else sent to the model are not
  translated; only what the user reads is.
- Adding a language = add it to `LOCALES`/`LOCALE_LABELS` in `app/i18n/index.ts`
  and to every message module; `app/i18n/__tests__/messages.test.ts` fails until
  the key sets (and every data-driven key) match.

```bash
npx vitest run app/i18n/__tests__/messages.test.ts
```

## Project structure

```
app/
├── api/
│   ├── extend/route.ts        Outpainting endpoint (proxies OpenRouter)
│   ├── generate/route.ts      Text-to-image + tile-sheet + sprite-sheet prompts
│   ├── scene-brief/route.ts   Distill a shared scene brief for a project
│   ├── prop-brief/route.ts    Props "art director" — invents the next prop batch
│   ├── tile-review/route.ts   Tile QA "art director" (vision critic)
│   └── sprite-review/route.ts Sprite QA "art director" (vision critic)
├── components/                UI split by workspace
│   ├── TopBar / CommandBar / Workspace / VariantSelector / Modals / icons
│   ├── ParallaxStudio.tsx
│   ├── TileStudio.tsx         + PlatformPreview compositor
│   ├── SpriteStudio.tsx
│   └── PropStudio.tsx
├── lib/                       Domain logic & constants
│   ├── app.ts / models.ts / artStyles.ts
│   ├── parallax.ts / tileset.ts / sprite.ts / props.ts
│   └── bodyPlans.ts           Sprite body-plan registry (anims, presets, rigs)
├── i18n/                      Localization (en + zh)
│   ├── messages/              One module per surface, flat dotted keys
│   ├── serverErrors.ts        Server/canvas error text → message keys
│   └── __tests__/             Dictionary parity + data-key coverage
├── utils/
│   ├── imageProcessor.ts      Canvas: chunking, Poisson blend, chroma key,
│   │                          tileability, seam scoring, sprite align/scale
│   ├── poseRig.ts             Dispatches to the body-plan rig + measures subject
│   ├── rigCore.ts             Shared rig primitives (capsule/dot/projection…)
│   └── rigs/                  Per-body-plan pose rigs (biped, quadruped,
│                              serpent, flyer, blob)
├── globals.css                Dark "studio" design system
├── layout.tsx                 Root layout, Inter font
└── page.tsx                   App shell: state, generation pipelines, QA loops
```

## Configuration knobs

A few small values you might want to tune:

| Constant | Where | Default | Meaning |
| --- | --- | --- | --- |
| `EXTENSION_PERCENT` | `app/lib/app.ts` | `38` | How much of the current dimension each extension adds |
| `maxAttempts` | per model in `app/lib/models.ts` | `1`–`3` | Best-of-N candidates per horizontal extension |
| `MAX_TILE_REVIEW_PASSES` | `app/page.tsx` | `2` | Extra tile repaint passes the QA art director may trigger |
| `TILESET_TILE_SIZE` | `app/lib/tileset.ts` | `512` | Per-tile resolution in the 4×4 sheet |
| `TILESET_ATLAS_EXTRUDE_PX` | `app/lib/tileset.ts` | `2` | Duplicated border around each exported atlas tile |
| `PROP_BATCH` | `app/lib/props.ts` | `8` | Props painted per "add more" press |
| `GROW_PX` | `app/utils/imageProcessor.ts` | `8` | Pixels to grow the Poisson mask into the original |
| `iterations` | `app/utils/imageProcessor.ts` | `250` | Max Gauss-Seidel iterations |
| `IE_MAGPIE_BASE_URL` | env | `http://127.0.0.1:3425/v1` | Base URL of the Magpie gateway (Settings → Gateway) |
| `MAGPIE_API_KEY` | env | empty | Server-side key for that gateway (a browser key overrides it) |
| `APIMART_API_KEY` | env | empty | Server-side key for the APIMart gateway (a browser key overrides it) |

## Privacy & security

- The API key entered in the UI is stored **only** in your
  browser's `localStorage`. It is never written to the server's disk and
  never logged. The server uses it once per request to proxy the call to the
  selected gateway, then discards it.
- The server-side `OPENROUTER_API_KEY` / `MAGPIE_API_KEY` env vars are
  **optional** and act only as a fallback for requests that don't include a
  client-provided key.
- No analytics, no telemetry, no tracking.

## Acknowledgments

- Poisson image editing technique: **Pérez, Gangnet, and Blake (2003) —
  "Poisson Image Editing"**, SIGGRAPH.
- Google for the Gemini image models, OpenRouter for the unified API.

## License

[MIT](LICENSE)
