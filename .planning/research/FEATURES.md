# Feature Research

**Domain:** Animated sprite-set production (direction × state × frame) inside a local, BYOK, filesystem-backed game-art pipeline
**Researched:** 2026-10-06
**Confidence:** HIGH on the consumer contract and the app's existing seams (every claim below is cited to a file in `~/repos/image-extender` or `~/repos/dark-black`); HIGH on the external tools' data formats (cited to current vendor/engine docs); MEDIUM on the "what the model actually returns" claims — those rest on the consumer's own measured prose plus one probe that has not run yet.

This is a **subsequent** milestone: the app, the library, the CLI, the post-processing and the provider table already exist. Nothing below re-proposes an existing feature; the "already exists" column names what can be reused instead of rebuilt.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Everything in this table is either (a) already an invariant of the consumer (`dark-black`) that a producer must satisfy, or (b) an explicit non-negotiable in the milestone spec. A missing one does not degrade the product — it produces a set the game cannot read, or spends money without saying so.

| Feature | Why Expected | Complexity | Consumes | Notes |
|---------|--------------|------------|----------|-------|
| **Per-state frame count** | The consumer's grid rule `frame = row * FRAMES + col` is only valid while every row is the same width; `enemy.gd:42-53` says in prose that one odd row "SILENTLY addresses the wrong cells and no signal exists to say so". Frames-per-state is therefore a **contract**, not a preference | S | CLI (spec file), human UI (form) | Spec already carries `states[].frames` | 
| **Per-state timing: fps + loop (durations derived)** | `enemy.gd:58-61` reads `FPS_IDLE=4 / FPS_WALK=8 / FPS_WINDUP=12 / FPS_ATTACK=12` and `_advance_columns(…, loop)` wraps vs clamps; `player.gd:66-70` reads the same numbers "from manifest.json's animation block". Loop is not cosmetic: windup/attack rows must clamp on their last cell | S | CLI + UI (both write it), engine (reads it) | Emit `fps` **and** `durationsMs` **and** `loop`. The legacy pixel manifest carried all three (`assets/sprites/chaser/manifest.json` → `animation.rows.side_walk = {frames:4, fps:8, durations_ms:[125×4], loop:true}`) and `build_roster_sheets.py:452-458` still writes that shape — that is the proven format |
| **Direction ordering is a contract, order-in = order-out** | `enemy.gd:711-712` `_sector_index(dir) = round(dir.angle()/SECTOR) & 7` from +x clockwise; `build_handpainted_sheets.py:47-53` declares the row order IS that sector order (east first, clockwise). The hero is the counter-example: 4 *named* drawings `down, side, up, back` whose order is the player's own row order, "NOT the sector order" | S | CLI (spec `dirs[]`), UI (direction preset picker) | Ship two presets (`dirs8`, `dirs4`) as **named, ordered lists** and never re-sort them. Store the list verbatim in `set.json`; the engine adapter reads the list, it does not re-derive it |
| **Per-frame normalisation: trim to alpha bbox → fit into a fixed cell with margin** | `build_handpainted_sheets.py:315-337` `fit_panel()`: trim to `alpha_bbox`, scale by `min(INNER/cw, INNER/ch)` so the cell is never overflowed, paste centred. `CELL=64`, `INNER=56` (a 4 px margin). The game consumes that geometry directly | M | CLI (bridge), UI | Reuse as-is: bridge op `sprite-align` already chains `sliceImageGrid → chromaKeyToAlpha → removeFrameBorder → isolate → normalizeSpriteFrameScale → alignSpriteFramesToBaseline → centerSpriteFramesHorizontally` (`cli/native/bridge.mjs:276-321`). **Do not** enable `alignSpriteFramesToBaseline` for a direction strip — spec §7 says cross-direction baselines fight each other, and `groundAll` (`imageProcessor.ts:2666+`) plants *every* frame on one floor line, which is wrong across 8 viewing angles |
| **Magenta key with despill, and the two-rule variant** | Every generated strip is requested on flat `#FF00FF`; `enemy.gd`/`build_handpainted_sheets.py:95-127` measured that a single distance-to-field rule fails — a saturated magenta gutter and a pale panel field need *different* rules, chosen once from the field colour, and the key must stay **binary** (an alpha ramp leaves a translucent panel over the whole cell) | M (reuse), L if reimplemented | CLI + UI | The app's `chromaKeyToAlpha` (`imageProcessor.ts:1445`) with its despill is the existing implementation; the consumer's extra rules (field-colour detection, card removal, main-blob keep) are **not** in this repo and are S2's concern. Keying here only needs "clean alpha per cell" |
| **Deterministic file naming** | The consumer's current names are `{state}_f{N}_{D}dir.png` with **1-based** N (`gen_assets_teamo.py:157`), and the library's own path validator is strict: `FILE_RE = /^(raw|derived)\/[a-z0-9][a-z0-9._-]{0,118}\.[a-z0-9]{1,8}$/` (`app/lib/libraryPath.ts:19`) — no nesting, lowercase, one extension | S | CLI + UI | Keep the consumer's `_f1..fN_` 1-based convention for files and `frame` **0-based** inside `set.json` (spec §5.2). Two numbering systems in one product is a bug magnet; write the conversion in exactly one function (`planStrips` returns 0-based, the runner renders the name) |
| **Resume after failure / skip what is already on disk** | The consumer's generator already does it: `gen_assets_teamo.py:181-185` merges each run's ledger rows by `(state, frame)` into the existing `generation-ledger.json`, "a re-run replaces its row: the file was replaced too". A 16-call run that dies at strip 12 and re-pays for 12 is unacceptable | S (needs a durable per-strip record) | CLI (must), UI (nice) | `nextPending()` is already the milestone's pure core (spec §4). The cheap durable record is the `raw/` file's existence plus `set.json`'s `strips[]` `ok` flag — no database |
| **Spend preview before spending** | Explicit success criterion (spec §2.4) and the consumer's house rule (`gen_assets_teamo.py:15` "Spend is gated behind `--go`, the same discipline as the other gen_*.py tools"; dry-run branch at `:144-148`). One call is ~20 s and real money | S | CLI (`ie anim plan`), UI (confirm panel) | The plan must print **call count + per-call canvas + total**, not just "yes/no". `planStrips()` already produces everything needed; the count is `Σ states.frames` |
| **Provenance per produced asset** | Library requirement (fork spec §2.3) and the only way the game side's `generation-ledger.json` can retire. `meta.json` already carries backend/model/prompt/params/requested/returned/cost (`app/lib/libraryTypes.ts:10-27`) | S (threading, not schema) | CLI + UI, human reader | Spec §5.4 fixes the split: `set.json` = neutral engine contract, `meta.json.manifest` = the spec block only. **Cost stays single-unit** (`{usd, source} | null`) — `Provenance.cost` is a dead field on the web path today (`CONCERNS.md`), so S1 should populate it from the generate reply via the existing `extractCost` and call it enough |
| **Exact-aspect strip request (no non-uniform resize)** | The whole generation strategy: 8 cells at 8:1 is an *exact* supported ratio, so every direction gets a full square cell with no stretching (`gen_assets_teamo.py:10-13`). The app cannot currently express this: `SUPPORTED_IMAGE_ASPECT_RATIOS` (`app/api/generate/route.ts:7-18`) stops at `21:9`, has no `8:1`/`4:1`, and the size ladder in `Modals.tsx:836,853` has no 8:1 option | M | CLI + **UI must bypass the ladder** | The CLI already sends raw `width`/`height` to `/api/generate`, so `4096×512` is reachable from the CLI today. `supportedAspectRatioForSize` will pick the *nearest* listed ratio (4:1 for an 8:1 request → a silently stretched sheet) — the route's `image_config.aspect_ratio` is chat-gateway-only, but this is the single most likely silent-corruption path in S1. Probe it (spec §9.1) before relying on it |
| **Per-cell identity enumeration in the prompt** | The consumer's prompt does it literally: `gen_assets_teamo.py:100-113` — "a flat 1-row x {n}-column strip of {n} equal square cells", then `cell 1 facing east, cell 2 facing south-east, …`, then the no-touch-the-edge / pure-magenta / no-scene / no-card constraints. Measured working in the consumer at `4096×512` | S | CLI + UI (one shared `animStrip.ts`) | Ship the *same* enumeration shape. This is the one place where two implementations (CLI and UI) diverging would cost real money, hence the spec's "one pure core" rule |
| **Bilingual strings for the new mode** | Repo invariant: `app/i18n/index.ts:62-78` types zh against en, so a missing translation is a *compile error* | S | Human UI | New `app/i18n/messages/anim.ts` registered in `app/i18n/index.ts` |

### Differentiators (Competitive Advantage)

These are where this pipeline can beat "one more AI image tool". Each one is anchored to something the *consumer* measurably needs, not to a feature checklist.

| Feature | Value Proposition | Complexity | Consumes | Notes |
|---------|-------------------|------------|----------|-------|
| **Identity anchoring across frames (first frame → reference image for the rest)** | The consumer's v11 pipeline has **no** identity mechanism: `gen_assets_teamo.py` sends text only, and the spec §9.2 concedes "逐帧独立生成会有跨帧漂移" as a known fact. The app already owns the whole mechanism — an anchor pass, a pose guide, and a **fixed reference order** the prompt labels by index (`app/api/generate/route.ts:93-123`, `spriteIdentityImage` at `:106-112`) — and `generatePrompt.ts:238-245` records that this is "by far the strongest known technique for keeping the character on-model across 8 frames" | M | CLI + UI (a per-set flag) | Spec §12 defers it to keep S1 small, and that is the right call — but note *why* it is cheap later: `/api/generate` already accepts `spriteIdentityImage` whenever `kind === 'spriteSheet'`, so the work is a wire field (a neutral `referenceImage`) plus plan-time ordering, not a new capability |
| **Per-frame regeneration without redoing the set** | A 16-call set where one frame's creature crosses a cell edge should cost **one** call to fix. The consumer's tool already has the seam (`--limit` stops after N for a probe, `gen_assets_teamo.py:129,140-141`) and the ledger merge makes a re-run idempotent | S | CLI (`--redo` with a frame filter), UI (regenerate this cell) | The plan/resume split already gives 90% of this for free. The extra is a selector: `--redo idle:3`. Highest value-per-line feature on the list |
| **Palette locking / extraction from an existing corpus** | The consumer measured this and it is not a nice-to-have: `gen_monsters_8dir.py:242-299` samples the *two committed creature sheets*, quantises to 3 bits/channel, lays the top 14 colours out in proportion to their measured share, and sends the strip as the provider's `color_image`. The docstring records the failure they replaced: locking to the contract's 7 UI anchors turned every quadruped into a near-black blob (`panther dark_share 0.925` vs chaser's `0.664–0.883`). The app already has the receiving end (`PixelRequest.colorImage`, `app/lib/pixel.ts:105-106,188`) but only on the **PixelLab** route (`app/api/pixel/route.ts:60`) — there is no equivalent for the chat/image path | M | CLI (corpus path), UI (later: "use existing set as palette") | The extraction itself is **deterministic and offline** (no provider call, fixed bytes on a clean clone) which makes it a pure, unit-testable function. The *transport* is the open question: chat gateways here attach references as content parts, so a palette image rides the same pipe as an identity anchor |
| **Library asset = one animation set, with `set.json` inside it** | The existing library is already "one asset = a directory of `raw/` + `derived/` + `meta.json`" (`app/lib/library.ts:65-118`), so a set becomes a first-class, git-shareable, provenance-carrying object with **no new storage concept**. That is the project's Core Value made concrete: "一个规格产出一整套能直接进游戏的资产" | S | CLI + UI | New `AssetKind = 'animations'` in `ASSET_KINDS` (`app/lib/libraryTypes.ts:7`) — the route's `isValidKind`, the panel grouping and the collector's exhaustive union all follow, and a missed branch is a compile error (`libraryCollect.ts:9-12`) |
| **Plan is a first-class artefact (`ie anim plan` prints the exact call sheet)** | Turns "spend discipline" into something a *script or agent* can consume before it commits. The consumer's dry run prints only filenames (`gen_assets_teamo.py:144-148`); a plan that also states `width×height`, prompt length and `calls` is what lets an agent decide | S | CLI (agent-facing), UI (renders the same array) | `okEnvelope` + the plan array is already the CLI's shape. This is the feature that makes the CLI the *primary* surface and the UI a convenience |
| **Cost/usage rollup in `provenance.params` (`calls/cells/seconds`)** | The consumer's ledger records exactly `{state, frame, dirs, file, ok, seconds, prompt}` per strip (`gen_assets_teamo.py:169-170`) and nothing aggregates it. `cells` (frames × dirs) is the number that maps to every provider's real billing unit (PixelLab bills generations per direction per frame — see the competitor table) | S | CLI + UI, human reader | Deliberately **not** a schema change: spec §5.4 keeps `schemaVersion: 1` and puts usage in `provenance.params`. Correct call — a second cost unit is the second adapter's problem |
| **Engine-native export (Godot `SpriteFrames`/`.tres`, or a sheet + manifest)** | Explicitly the **next** milestone (PROJECT.md Out of Scope; spec §3), but its shape constrains S1 and so belongs in this landscape: Godot 4.7 offers `set_animation_speed(fps)` + `set_animation_loop_mode(LOOP_NONE/LINEAR/PINGPONG)` + per-frame **relative** durations, and its own editor imports from a sheet with rows/columns (`2d_sprite_animation.html`). The consumer today consumes a **raster atlas + a JSON manifest** and drives `Sprite2D.frame` by hand | L | CLI (a `dark-black`-shaped adapter), engine | Two viable S2 targets, and they are not equivalent: (a) keep the consumer's "one sheet per actor + manifest" and generate the manifest from `set.json`; (b) emit `SpriteFrames`/`.tres`. Option (a) is what `enemy.gd:191-198` already loads; option (b) is cleaner for engines but changes the consumer. **S1's job is only to not foreclose either** — `set.json` must carry cell size, the ordered dir list, per-state fps/loop and a per-(state,dir,frame) file mapping, which it does |
| **Frame-gallery preview / playback in the UI** | The consumer's `build_handpainted_sheets.py:344-358` writes `_preview/<actor>.png` and `<actor>_dirs.png` (one row per sector, one column per state, frame 1 only; zoomed ×4) precisely because "a 32-row sheet is 8 screens tall and nobody reads it". The app already has a playback harness with scrubbing, fps and loop (`SpriteStudio.tsx:35-66,184-201`) | M | Human UI | Reuse the existing player rather than inventing a second timeline. The *differentiating* half is the **direction-matrix** view (the consumer's `_dirs.png`): it is the only artefact that shows the direction axis is eight real drawings rather than one mirrored sprite |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **A full animation editor in the browser (per-frame drawing, tweening, layer stack)** | "Aseprite but in the app" is the first thing anyone asks for once frames exist | It is a second product with a second persistence model, and it competes with the one thing this pipeline is for — *generation*. The repo has one 3,992-line client component already (`CONCERNS.md`); an editor would be the largest thing in it, and its output would be frames the generator did not make, which breaks the "one spec → one set" story | The frames are PNG files in a directory. Edit one in any real tool, regenerate just that frame (`--redo state:frame`), or accept the model's output. The app stays a producer, never a paint program |
| **Timeline scrubbing UI as a first-class surface** | Feels like table stakes by analogy with Aseprite | A scrub bar is useless without the player it drives, and the player is 60 lines (`SpriteStudio.tsx`). Spending a phase on a timeline widget buys nothing the gallery + the existing player does not already give, and every pixel of it is UI-only code that no CLI/agent can use | Keep the existing play/scrub controls; add the **direction matrix** view (the consumer's proven review artefact) and stop there |
| **Runtime/on-demand asset generation in the engine** | "The game could just ask for the sprite when it needs it" | The consumer is a Godot project with a committed, versioned art directory and a GDScript gate (`tools/check_enemy.gd`) that asserts atlas dimensions against a manifest. A runtime generator puts an API key, a network dependency and non-determinism inside the shipping game — and the project already deleted one runtime art generator for exactly this reason (`build_frame_atlas.py:4-12`: "WHY IT IS AN ASSET AND NOT A RUNTIME GENERATOR") | Generate offline into the library, commit the result. The library **is** the runtime's asset directory, by design (`assetsRoot()`, `app/lib/library.ts:41`) |
| **Multi-user collaboration (shared library, locks, per-user attribution)** | "The team should be able to build sets together" | The library's entire threat model is "self-inflicted mistakes" and its sharing mechanism is git (`app/lib/libraryPath.ts:8-11`; fork spec §2.2). Concurrency needs a lock protocol that does not exist anywhere in the repo, and the CLI writes through `saveAsset` with an atomic temp-dir rename (`library.ts:96-111`) — two writers of one slug is a corrupt asset today | Git branches. The `EEXISTS` → 409 → overwrite/`-v2`/cancel flow already covers the real collision (same slug, two machines) |
| **Cloud asset hosting / a server-side asset instance** | "So other machines can pull the art" | Fork spec §2.5 forbids it, PROJECT.md repeats it, and it would replace a working mechanism (a git repo) with a service to operate. The cost is also already measured: a 100-asset library is 0.5–1 GB (fork spec §1) | `git pull`. The `assets/` directory is the transport |
| **A batch scheduler / queue for many sets** | Natural once one set takes 16 calls × ~20 s | The provider is the bottleneck and BYOK keys are per-user; a queue adds state, retries and a UI for something a shell loop expresses in three lines. The consumer's own tool has no queue | `ie anim run --spec a.json && ie anim run --spec b.json`. Resume already makes a rerun cheap |
| **An 8-direction **single** generation (one call → all directions for all frames)** | Fewer calls, less drift | The consumer measured why not: the API has no 2:1 ratio, so a 4×2 grid needs a non-uniform resize (`gen_assets_teamo.py:10-13`), and `build_handpainted_sheets.py` exists precisely because "the model draws each creature larger than its cell and touching the cell edges" — i.e. even a well-formed multi-cell sheet needs per-cell repair | One strip per (state, frame), N cells = N directions. That IS the technique, not a limitation |
| **Auto-animating in place (retiming a generated set to a target duration)** | "Just make it play at 12 fps" | Timing is a *design* value the consumer reads from the manifest and asserts against (`check_enemy.gd:54` ties the ACTIVE window to `1.0/fps_attack`). A producer that retimes silently would move combat frames | Emit `fps`/`durationsMs` exactly as specified; the consumer's manifest already carries them and the game treats them as data |
| **A "one-click 8-direction" button that hides the plan** | Feels friendlier | Every hidden decision (dir order, cell size, frames/state, call count) is a contract the engine will assert. The whole spec is built around the plan being visible before the spend | The plan panel *is* the one-click flow: one button renders it, a second confirms it. Two clicks, zero surprises |

---

## Feature Dependencies

```
[Exact-aspect strip request (probe: 8:1 passthrough)]
    └──requires──> [Provider/model allow-list already routes the image model]   ← EXISTS (app/lib/providers.ts)

[AnimSetSpec validation]
    └──requires──> [Dir list is an ordered, named preset]                ← EXISTS as conventions (DIRS8/DIRS4)

[planStrips()  (calls = Σ frames)]
    ├──requires──> [AnimSetSpec validation]
    └──requires──> [Per-state frames/fps/loop fields]

[Strip prompt assembly (cell↔dir enumeration + magenta + no-touch)]
    ├──requires──> [planStrips()]
    └──requires──> [Dir list is an ordered, named preset]

[Spend preview (CLI dry run / UI confirm)]
    ├──requires──> [planStrips()]            (the call count IS the plan length)

[Per-strip generation → raw/]
    ├──requires──> [Exact-aspect strip request]
    ├──requires──> [Strip prompt assembly]
    └──requires──> [Spend preview]           (the --go gate)

[Post-process → derived/ (slice → key → trim/fit → centre)]
    ├──requires──> [Per-strip generation → raw/]
    └──requires──> [Post-processing chain]   ← EXISTS (bridge sprite-align / imageProcessor)

[set.json]
    ├──requires──> [Per-strip generation → raw/]   (strips[] ok/seconds/requested/returned)
    └──requires──> [Post-process → derived/]       (frames[] file mapping)

[Resume after failure]
    ├──requires──> [set.json]                 (the durable per-strip record)
    └──requires──> [Deterministic file naming] (existence of raw/<name> is the skip test)

[Per-frame regeneration (--redo state:frame)]
    ├──requires──> [Resume after failure]     (same state machine, narrower selection)
    └──enhances──> [Identity anchoring]       (a single-frame fix is what anchoring makes unnecessary)

[Library asset (kind: animations)]
    └──requires──> [set.json] + [Post-process → derived/]

[Provenance (calls/cells/seconds, requested vs returned)]
    └──requires──> [Library asset]            (it lives in meta.json)

[Cost rollup]
    ├──requires──> [Provenance]               (params.usage)
    └──enhances──> [Spend preview]            (actual vs planned, per set)

[Identity anchoring across frames]
    ├──requires──> [Per-strip generation → raw/]        (frame 0 must exist before it can be a reference)
    ├──requires──> [Neutral reference field on the wire] (today gated to kind === 'spriteSheet')
    └──enhances──> [Palette locking]                    (both are reference-image conditioning)

[Palette extraction from an existing corpus]
    ├──requires──> [A committed corpus to sample]        (the consumer's sheets, or the local library)
    └──enhances──> [Identity anchoring]                  (same transport, different payload)

[Frame gallery + direction matrix preview]
    └──requires──> [Post-process → derived/]

[Engine-native export (S2)]
    ├──requires──> [set.json]                 (cell, ordered dirs, fps/loop, frame file map)
    └──conflicts──> (nothing in S1 — see note)

[Runtime asset generation in-engine] ──conflicts──> [Deterministic, committed art + gates]
[Full browser animation editor]      ──conflicts──> [One spec → one set provenance story]
```

### Dependency Notes

- **Exact-aspect strip request requires the provider probe first:** `width = cell × dirs.length` reaching the model unmodified is the *whole* technique. `app/api/generate/route.ts:160` sends a *nearest-listed* `aspect_ratio` (`SUPPORTED_IMAGE_ASPECT_RATIOS` tops out at `21:9`), so an 8:1 request may be silently coerced. Spec §9.1 schedules the probe before implementation; do not skip it, and record the returned dimensions (`returned` in `strips[]`) so a future regression is visible.
- **Plan requires validation:** a bad spec must fail *before* the plan is shown, so the plan is always a spendable artefact (`gen_assets_teamo.py:142` prints the job count before the `--go` branch).
- **Resume requires deterministic naming AND `set.json`:** existence of `raw/<state>_f<N>_<D>dir.png` is the cheapest skip test, and the file name is the only key that survives a crash. This is why the file-name convention is table stakes rather than cosmetic.
- **Identity anchoring requires frame 0 first:** any "reference the first frame" design makes strip ordering load-bearing. Keep the plan ordered `state-major, frame-minor` (`gen_assets_teamo.py:139` `jobs = [(st, f) for st in states for f in range(frames)]`) so the reference always exists when a later strip is built.
- **Palette locking and identity anchoring share a transport:** both are a reference image attached to the generate call. The app's chat path attaches `content` parts in a **fixed order the prompt labels by index** (`route.ts:93-123`) — adding a second reference means adding a second label to the prompt, not a second mechanism.
- **Frame gallery requires post-processing:** there is no useful review of a set before cells are keyed and fitted; the raw strips are 8:1 and unreadable as animation.
- **Engine export requires `set.json` and nothing else:** S2's adapter must be able to build either a per-actor sheet (consumer's shape: rows = dir × state, cols = frames; `build_handpainted_sheets.py:418-440`) or a `SpriteFrames` resource **from `set.json` alone**. Any fact S2 needs that is not in `set.json` is an S1 bug.
- **No conflicts inside S1.** The anti-features conflict with *later ambitions*, not with this milestone; listing them here is what keeps them from being re-litigated in S2.

---

## MVP Definition

### Launch With (S1 — the milestone as specified)

The set must be producible, resumable, reviewable and storable, from one spec, with the spend visible first.

- [ ] **Spec → plan (pure)** — `AnimSetSpec` validation + `planStrips()`; call count is the length. *(spec §4, §5.1, §5.2)*
- [ ] **Strip prompt core (pure)** — ordered cell↔direction enumeration, one-row exact-aspect layout, pure-magenta field, "completely inside its own cell" gutter rule, no scene/shadow/text/card. *(Reuse the consumer's measured wording, `gen_assets_teamo.py:97-113`.)*
- [ ] **Exact-aspect request (probe first)** — `4096×512` for 8 dirs, `2048×512` for 4; **error out** when `cell × dirs > 4096` rather than silently shrinking. *(spec §5.1, §8)*
- [ ] **Per-strip generation to `raw/`, immediately** — the file on disk is the resume record. *(spec §7.3)*
- [ ] **Slice → key → trim/fit → centre to `derived/`** — via the existing chain, with `alignSpriteFramesToBaseline` **off**. *(spec §7.4, §7 note)*
- [ ] **`set.json`** — `schemaVersion`, kind, actor, **ordered dirs**, cell, per-state `{frames, fps, durationsMs, loop}`, `strips[]` (`ok`, `seconds`, `requested`, `returned`, `prompt`), `frames[]` (state/dir/index/file/strip). *(spec §5.3)*
- [ ] **Resume / stop-on-failure** — default stop on a failed strip; `--keep-going` continues; `--redo` forces. *(spec §8)*
- [ ] **`ie anim plan` (dry) + `ie anim run --go`** — plan prints per-strip lines, canvas and call count. *(spec §6.1)*
- [ ] **Library save as `kind: animations`**, one set = one asset, `meta.json.manifest` = the spec block, `provenance.params` = `{dirs, states, frames, cell, calls, cells, seconds}`. *(spec §5.4)*
- [ ] **UI `anim` mode: spec form → plan confirm → progress → gallery → Save to library** *(spec §6.2)*
- [ ] **en/zh strings** for the new mode (a missing zh key is a compile error). 
- [ ] **One manual E2E on the real consumer shape** — hero, idle+walk, 8 calls → library → survives a page refresh. *(spec §10)*

Deferred inside S1's own scope if time is short: the **direction-matrix preview** (nice; the gallery alone answers "did it work").

### Add After Validation (S1.x)

- [ ] **Per-frame regeneration** (`--redo idle:3` / "regenerate this cell") — trigger: the first set where one frame is unusable. This is the single highest-value next feature; a 16-call set with one bad frame makes it obvious within a day.
- [ ] **Direction-matrix review artefact** (one row per direction, one column per state, frame 1, ×4 nearest) — trigger: the first set where a whole direction is wrong and the gallery hides it. The consumer already proved the artefact (`build_handpainted_sheets.py:344-358`).
- [ ] **Cost/usage rollup surfaced in the panel** — trigger: the second set, when "what did this project cost" becomes a real question (`CONCERNS.md` names it as an unmet library criterion).
- [ ] **A local corpus palette lock** — trigger: the first set whose palette drifts from the committed art. The extraction is deterministic and offline, so it can ship as a pure function with no provider risk.

### Future Consideration (S2+)

- [ ] **Engine-native export** (Godot first: sheet + manifest, then optionally `.tres`) — the whole next milestone; `set.json` is the interface.
- [ ] **Identity anchoring** — deferred in S1 by decision; add when cross-frame drift is the top complaint. `/api/generate` already has the reference pipeline, so the change is a neutral wire field + plan-time ordering.
- [ ] **Second backend adapter (PixelLab animations)** — `animate_character` returns **one job per direction** with a fixed or requested `frame_count` (4–16 in v3, multiples of 4 up to 40 in pixminimax) and a **per-direction, size-and-frame-count-dependent** generation cost; the neutral model must not assume "one call = one strip for all directions" as the *only* shape.
- [ ] **Retire `gen_assets_teamo.py` on the consumer side** — after the first set produced by this pipeline ships into the game.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Spec validation + `planStrips` (pure) | HIGH | LOW | P1 |
| Strip prompt assembly (pure) | HIGH | LOW | P1 |
| Exact-aspect request + the 8:1 probe | HIGH | MEDIUM | P1 |
| Post-process chain reused (off-baseline) | HIGH | LOW | P1 |
| `set.json` per spec §5.3 | HIGH | LOW | P1 |
| Resume / stop-on-failure / `--redo` | HIGH | LOW | P1 |
| Deterministic 1-based file naming | HIGH | LOW | P1 |
| `ie anim plan` / `run --go` | HIGH | MEDIUM | P1 |
| Library `kind: animations` + provenance | HIGH | MEDIUM | P1 |
| UI `anim` mode + confirm | HIGH | HIGH | P1 |
| en/zh strings | MEDIUM | LOW | P1 |
| Manual E2E on the consumer's hero shape | HIGH | LOW | P1 |
| Per-frame regeneration | HIGH | LOW | P2 |
| Direction-matrix preview | MEDIUM | MEDIUM | P2 |
| Cost/usage rollup readout | MEDIUM | LOW | P2 |
| Palette extraction from a corpus | MEDIUM | MEDIUM | P2 |
| Identity anchoring | HIGH (later) | MEDIUM | P3 |
| Engine-native export (Godot) | HIGH (S2) | HIGH | P3 (S2) |
| PixelLab animation adapter | MEDIUM | MEDIUM | P3 (S2+) |

**Priority key**
- **P1** — a missing P1 produces a set the engine cannot read or spends money silently.
- **P2** — the set works without it; it becomes the top complaint within a few sets.
- **P3** — belongs to the next milestone by explicit decision (PROJECT.md Out of Scope, spec §12).

---

## Competitor Feature Analysis

| Feature | Aseprite (hand-authored) | PixelLab (generated, per-character) | TexturePacker (packing/review) | Godot 4.7 editor (`SpriteFrames`) | Our approach |
|---|---|---|---|---|---|
| **Animation identity** | A *tag* = name + `from`/`to` frame range + `direction`, in `meta.frameTags` of the sheet JSON | A **character** (with states/rotations) plus named animation groups; one animation spans the directions chosen | none — packing only | One `SpriteFrames` animation per name; `AnimatedSprite2D` plays it | One **state**; the direction axis is the *cell* axis of the strip, and a set is the whole (state × frame) matrix — a shape neither of these has |
| **Direction handling** | none built in (layers/tags are the user's problem) | First-class: a character has 4 or 8 rotations; `animate_character` takes `directions[]` and can append to an existing group | none | none | First-class and **ordered**: 8 sector order or the hero's 4 named drawings; the order is the engine contract |
| **Timing** | Per-**frame** duration in ms (`duration` in the JSON), plus tag `direction` (forward/reverse/ping-pong) and repeat count | Frame count per animation (4–16 v3; 4–40 pixminimax); playback rate is the engine's choice | none | `set_animation_speed(fps)` + per-frame **relative** `duration` + `loop_mode` (`NONE`/`LINEAR`/`PINGPONG`) | Per-state `fps` **and** materialised `durationsMs` **and** `loop` — the consumer reads exactly these and asserts combat windows against fps |
| **Per-frame normalisation** | Manual; `--trim` on export, with `spriteSourceSize`/`sourceSize` recovering the original geometry | The vendor owns cell fitting | `Trim` / `Crop` / `CropKeepPos` modes; `spriteSourceSize` + `sourceSize` in the JSON **specifically so animation frames stay aligned** | Editor imports a sheet by rows/columns; no per-cell trim | Trim-to-alpha → fit into a fixed cell with a margin, done by the existing repo code; the *cell* is fixed so the engine's ruled grid stays valid |
| **Background removal** | N/A (authored with alpha) | Vendor renders on transparent background | N/A | N/A | Magenta key with despill, **binary** alpha; field-colour detection because one rule measurably fails |
| **Deterministic naming** | User's file names; frames are indices | Vendor-assigned ids / URLs | Sprite names in the atlas | Animation names + frame indices | `{state}_f{N}_{D}dir.png` (1-based) for files, 0-based inside `set.json` — matching the consumer's ledger keys |
| **Resume / re-run** | An editor file: nothing to resume | **Per-direction jobs** — a rate-limited call that landed 5/8 directions can be completed by calling again with `animation_group_id` and the missing `directions[]` | Re-pack | N/A | Skip what exists on disk; `--redo` a subset. The vendor's own answer (append the missing directions to the same group) validates the "set is a group, work is resumable" model |
| **Spend preview** | N/A | Documented **per-direction cost formulas** and a `get_balance` call; template mode is 1 generation/direction, custom modes scale with canvas area × frames | N/A | N/A | `ie anim plan` prints canvas + call count; UI confirms; per-strip `seconds` recorded. (PixelLab's `cells` metric is the cross-provider unit here) |
| **Provenance** | The `.aseprite` file is the record | Vendor job ids and balances | The JSON is the record | The `.tres` is the record | `set.json` (neutral) + `meta.json` (backend/model/prompt/params/cost) — the library's existing shape, unchanged |
| **Playback preview** | Onion skin (`F3`) is an **editing aid only** — it is *not* exported into the sheet JSON; the timeline scrubber is the review tool | Vendor preview pages | none | Built-in SpriteFrames preview panel | Existing in-app player (play/scrub/fps/loop) + the consumer's direction-matrix still — no timeline editor, no onion skin |
| **Identity across frames** | Human hand | The character's own rotations are the reference; `create_character_state` has `use_color_palette_from_reference`; animation jobs take a start-frame image and can interpolate to an end-frame image | N/A | N/A | Deferred: an anchor image + a pose guide already exist in the repo's sprite line and are the proven technique the consumer lacks |
| **Palette locking** | Indexed colour mode | `use_color_palette_from_reference` snaps a new state to the source character's palette | N/A | N/A | Extraction measured from a committed corpus (offline, deterministic) — the consumer already built it once in Python and it is the fix for a *measured* failure |

### What this comparison says in one line

Every comparable tool treats "an animated character" as **one animation with one playback rate**. This pipeline's consumer needs a **matrix** — directions × states × frames with a ruled grid, ordered direction rows and per-state timing — and none of the four tools above models that as a first-class object. That gap is the product.

Two borrowed conventions are worth taking verbatim:
1. **Aseprite's tag shape** (`name` + `from`/`to` + per-frame `duration` ms) is the closest thing to a lingua franca for "an animation", and `set.json`'s per-state `{frames, fps, durationsMs, loop}` is a compatible normalisation of it.
2. **TexturePacker's `sourceSize` + `spriteSourceSize`** is the documented way to keep trimmed animation frames alignable. This pipeline avoids needing it by fitting every frame into a fixed cell (the consumer's `INNER=56/CELL=64` geometry), which is the simpler contract — but if a future engine adapter ever packs tight, these two fields are the ones to emit.

---

## Sources

**Consumer ground truth (`~/repos/dark-black`, Godot 4.7):**
- `tools/gen_assets_teamo.py` — strip prompt, exact-aspect request (`4096×512` / `2048×512`), `--go` gate, `--limit` probe, per-strip ledger merge.
- `tools/build_handpainted_sheets.py` — cell geometry (`CELL=64`, `INNER=56`), trim→fit, two-rule chroma key with despill, `row = dir * n_states + state`, manifest + review artefacts.
- `scripts/actors/enemy.gd` — `ROW_*`/`N_STATES`/`FRAMES`, `FPS_*`, `_sector_index()`, `_advance_columns(loop)`, atlas paths and `vframes`.
- `scripts/actors/player.gd` — the 4-named-direction hero convention and "fps read from manifest.json's animation block".
- `assets/sprites/chaser/manifest.json`, `assets/handpainted/sprites/hero/sprite-sheet-alpha.json`, `assets/sprites/chaser/run-notes.md` — the legacy and v11 manifest shapes (`animation.rows.<state>.{frames,fps,loop,durations_ms}`; the v11 manifest carries geometry but **no** fps/loop).
- `tools/gen_monsters_8dir.py` (`palette_ref()`) — corpus palette extraction and the measured failure it replaced.
- `tools/build_frame_atlas.py` — "WHY IT IS AN ASSET AND NOT A RUNTIME GENERATOR".
- `tools/check_enemy.gd` — the gate that asserts the ruled grid from the manifest rather than trusting constants.

**This repo (`~/repos/image-extender`):**
- `docs/superpowers/specs/2026-10-06-animation-set-production-design.md`, `.planning/PROJECT.md`, `.planning/codebase/{ARCHITECTURE,CONCERNS,CONVENTIONS}.md`.
- `app/api/generate/route.ts` (aspect-ratio selection, reference-image attachment order), `app/lib/generateRequest.ts`, `app/lib/generatePrompt.ts` (anchor pass + pose guide), `app/lib/pixel.ts` (`colorImage`), `app/api/pixel/route.ts`.
- `cli/native/bridge.mjs` (`sprite-align` chain), `app/utils/imageProcessor.ts` (`chromaKeyToAlpha`, `sliceImageGrid`, `removeFrameBorder`, `normalizeSpriteFrameScale`, `alignSpriteFramesToBaseline` + `groundAll`, `centerSpriteFramesHorizontally`).
- `app/lib/libraryTypes.ts`, `app/lib/libraryPath.ts`, `app/lib/library.ts`, `app/lib/libraryCollect.ts`, `cli/commands/library.mjs`.
- `app/components/SpriteStudio.tsx` (existing player), `app/i18n/index.ts`, `app/lib/generateCost.ts`.

**External documentation (verified against current docs on 2026-10-06):**
- Aseprite — sprite sheet export / JSON (`frameTags`, per-frame `duration` in ms) — https://www.aseprite.org/docs/sprite-sheet/ , https://www.aseprite.org/docs/cli/
- Aseprite — tags and animation direction (Forward / Reverse / Ping-pong) — https://www.aseprite.org/docs/tags/
- Aseprite — frame duration — https://www.aseprite.org/docs/frame-duration/
- Aseprite — onion skinning (editing aid, not exported) — https://www.aseprite.org/docs/onion-skinning/
- Godot 4.7 — `SpriteFrames` (`add_frame` relative duration, `set_animation_speed`, `set_animation_loop_mode`: `LOOP_NONE`/`LOOP_LINEAR`/`LOOP_PINGPONG`) — https://docs.godotengine.org/en/4.7/classes/class_spriteframes.html
- Godot 4.7 — `Sprite2D` (`hframes`/`vframes`/`frame`, `region_filter_clip_enabled`) — https://docs.godotengine.org/en/4.7/classes/class_sprite2d.html
- Godot 4.7 — 2D sprite animation tutorial (import a sheet by rows/columns; `AnimationPlayer` alternative) — https://docs.godotengine.org/en/4.7/tutorials/2d/2d_sprite_animation.html
- Godot 4.7 — `TileSetAtlasSource` tile animation API (for the tile line's later engine export) — https://docs.godotengine.org/en/4.7/classes/class_tilesetatlassource.html
- TexturePacker — generic JSON hash/array, `frame`/`spriteSourceSize`/`sourceSize`, trim modes, multipack — https://www.codeandweb.com/texturepacker/documentation , https://www.codeandweb.com/texturepacker/documentation/commandline/parameters
- Tiled — JSON tile animation (`animation[]` with `tileid` + `duration` ms; one linear looping animation per tile) — https://doc.mapeditor.org/en/stable/reference/json-map-format/
- LDtk — JSON docs (no native animation field; animation is the game's job) — https://github.com/deepnight/ldtk/blob/master/docs/JSON_DOC.md
- PixelLab — MCP `animate_character` tool contract (template/v3/pixminimax/skeleton-v3 modes, per-direction jobs, `frame_count` ranges, per-direction cost formulas, `animation_group_id` for appending missing directions) — the mounted `pixellab` MCP tool schema, read 2026-10-06
- PixelLab — `create_character_state` (`use_color_palette_from_reference`) — the mounted `pixellab` MCP tool schema, read 2026-10-06
- Retro Diffusion — animation API (`rd_advanced_animation__*`, `frames_duration` ∈ {4,6,8,10,12,16}, `return_spritesheet`, 8-view rotate mode) — https://github.com/Retro-Diffusion/api-examples

**Unverified / flagged:**
- Whether `magpie → teamo-router/gemini-3.1-flash-image` passes `4096×512` through unmodified is **unverified** — the consumer measured this only on the Teamo direct route (`gen_assets_teamo.py:126` carries a `host=ip` DNS pin "the local DNS for teamorouter is hijacked"). `[INFERENCE]` until spec §9.1's probe runs.
- `Provenance.cost` being populated for chat gateways is **unverified** (`app/lib/generateCost.ts:7` says so itself). `[INFERENCE]` that a magpie/Teamo call returns `usage.cost`.
- Retro Diffusion's non-rotate spritesheet cell layout is **not documented** — the docs say to verify it from the returned dimensions. `[INFERENCE]`.

---

*Feature research for: animated sprite-set production (direction × state × frame) in image-extender*
*Researched: 2026-10-06*
