# Headless API & CLI for agents

Everything the image-extender web app can do, driven from a shell. Two surfaces:

- **`ie`** — the in-repo CLI (`npm run ie`, or `node cli/ie.mjs`). Wraps the HTTP
  routes, the app's own pixel code, the asset library and the pixel-art grid.
- **HTTP** — the same nine `/api/*` routes, unchanged and usable with `curl`.

Both go through the app's real code: the dev server for generation (prompt
engineering, provider config) and the app's own `app/utils/*` modules for every
pixel transform, run in headless Chromium. No algorithm is reimplemented here.

---

## 1. Quick start

```bash
npm install                       # once
node cli/ie.mjs doctor --json     # every prerequisite, one object
node cli/ie.mjs serve             # starts `next dev` (any command does this itself)

# first asset, no config needed if OPENROUTER_API_KEY is in the env
node cli/ie.mjs tiles "mossy grey dungeon stone" --out ./out/tiles --review \
  --library demo/tiles/mossy --json

node cli/ie.mjs library list --json
```

`ie status` says which server and config file the CLI is using; `ie help` lists
commands; `ie help <command>` documents one.

---

## 2. Output contract

`--json` is machine mode. Exactly one object on stdout, nothing else:

```jsonc
{ "ok": true,  "summary": "…", "written": ["/abs/out.png"], … }        // exit 0
{ "ok": false, "error": { "code": "usage", "message": "…", "detail": … } } // exit 1, 2 = usage
```

- Progress notes go to **stderr**, so stdout stays parseable even without `--json`.
- Without `--json` the CLI prints `summary`, then each written path, then the
  remaining fields as JSON.
- Exit codes: `0` ok · `1` runtime failure · `2` usage error (nothing was run).
- Every command's payload carries `written` (files it created) and, for studio
  runs, a `manifest` object with params, provider, model, cost and timings.

Global flags (valid on any command): `--json`, `--base-url <url>`, `--profile <id>`,
`--model <id>`, `--port <n>`.

---

## 3. Config file — providers, keys, models

Generation goes through a **profile**: one JSON entry naming the gateway, its
base URL, where its credential comes from, and the model each route should use.
The server resolves it; the CLI only ever sends `{"profile": "<id>"}`.

Resolution order for the file:

1. `$IE_CONFIG` (must exist when set — the CLI says so instead of degrading)
2. `<cwd>/.ie/config.json`
3. `~/.config/image-extender/config.json`
4. none → legacy env behavior (`OPENROUTER_API_KEY`, `IE_MAGPIE_BASE_URL`)

```jsonc
{
  "defaultProfile": "local",              // optional; used when a request names nothing
  "profiles": {
    "local": {                            // id: ^[a-z0-9][a-z0-9-]{0,31}$
      "provider": "magpie",               // "openrouter" | "magpie" (generic) | "apimart"
      "baseUrl": "http://127.0.0.1:3425/v1",  // magpie only; openrouter's base is fixed
      "apiKeyEnv": "MAGPIE_API_KEY",      // env var NAME holding the key (preferred)
      "apiKey": "",                       // inline alternative — allowed, warned about
      "imageModel": "teamo-router/gemini-3.1-flash-image",
      "qaModel": "commandcode/Qwen/Qwen3.7-Plus"
    }
  },
  "pixel": { "apiKeyEnv": "PIXELLAB_API_KEY", "apiKey": "" }   // for /api/pixel
}
```

Rules that are enforced (a file that loads is a file the server accepts):

- Unknown fields are rejected with the field name; a bad profile id, an unknown
  provider, a non-URL `baseUrl`, a bad env-var name, or a `defaultProfile` that
  names no profile are all hard errors.
- `baseUrl` is only valid for `provider: "magpie"` (that is the generic
  OpenAI-compatible gateway). `openrouter` keeps its fixed base.
- Keys resolve as: **request `apiKey`** → profile (`apiKeyEnv` env var, else
  inline) → the provider's own env var (`OPENROUTER_API_KEY` / `MAGPIE_API_KEY`).
- A profile whose provider does not require a key (local magpie) needs none.

Edit it interactively (`ie config`, a TTY menu) or from a script:

```bash
ie config path                                   # the file in use / that would be created
ie config list --json                            # profiles, models, key SOURCE (never the key)
ie config set profiles.local.provider magpie
ie config set profiles.local.baseUrl http://127.0.0.1:3425/v1
ie config set defaultProfile local
ie config get profiles.local.baseUrl --json
ie config unset profiles.local.baseUrl
ie config test --profile local --json            # probe the gateway, report model counts
```

`config set/unset` validate through the same validator the server uses, write
atomically, and `chmod 600` the file when it holds an inline key. On a broken
file they refuse (never silently start from `{}` and drop the rest).

**`config test` and `via`:** the POST probe (`/api/providers`) resolves the
gateway from the *server's* environment, so a profile with a custom `baseUrl`
cannot be probed through it. `ie config test` notices that and probes the
gateway directly instead, reporting `"via": "server" | "direct"` — a `direct`
result is the profile's own gateway, not the server's.

---

## 4. HTTP routes

All model routes accept an optional `profile` (a config-file id) and `model`.
Precedence: `provider` (browser's field) → `profile` → config `defaultProfile` →
deployment default. `apiKey` always wins over any config credential.
`{ "error": "…" }` + status is the failure shape everywhere (401 = credential or
unknown profile, 400 = bad input, 5xx = upstream).

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/generate` | POST | text→image, tile sheet, sprite anchor/sheet, prop sheet |
| `/api/extend` | POST | outpaint one direction (full-context or chunked) |
| `/api/scene-brief` | POST | art director: derive a scene brief from a prompt |
| `/api/prop-brief` | POST | art director: invent N prop ideas for a biome |
| `/api/tile-review` | POST | QA critic for an assembled tileset |
| `/api/sprite-review` | POST | QA critic for a sprite sheet |
| `/api/providers` | GET / POST | provider table (keyless) / probe one gateway's `/models` |
| `/api/pixel` | POST / GET | PixelLab relay (pixflux, character / status, balance, image proxy) |
| `/api/library` | GET / POST / DELETE | asset library index, meta, file bytes, save, delete |

### /api/generate

```jsonc
{ "prompt": "mossy stone brick", "width": 4096, "height": 4096,
  "artStyle": "pixel-art",           // optional; see app/lib/stylePrompt.ts keys
  "profile": "local", "model": "…",  // optional
  "sceneBrief": "…",                 // optional art-director text
  // one mode at a time:
  "tileSheet": true, "tileGuideImage": "data:image/png;base64,…", "tileFixNotes": "…",
  "spriteAnchor": true, "spriteBodyPlan": "biped",
  "spriteSheet": true, "spriteAnim": "walk", "spriteBodyPlan": "biped",
  "spriteFrameCount": 8, "spriteGridCols": 4, "spriteGridRows": 2, "spriteFrameSize": 512,
  "spriteGuideImage": "data:…", "spritePoseGuide": true, "spriteIdentityImage": "data:…",
  "propSheet": true, "propCols": 4, "propRows": 2, "propCount": 8, "propList": ["…"],
  "layerRole": "mid"                 // parallax layers only
}
```

→ `{ "imageUrl": "data:image/png;base64,…" | "https://…", "names": ["…"], "cost": {…} }`

Sharp edges: `names[]` is only present for the prop modes. `tileSheet` requires
the generated 4096² guide image (`ie tile-guide`), otherwise the layout is
unpredictable. `imageUrl` **may be a remote URL** — download it before feeding it
back into the app's pixel code (`ie` does this for you).

### /api/extend

```jsonc
{ "expandedCanvas": "data:…", "direction": "right", "extensionAmount": 38,
  "customPrompt": "…", "attempt": 0,
  "useFullContext": true, "extensionInfo": { … }     // horizontal path
  // or
  "useFullContext": false, "chunkInfo": { … }        // vertical (up/down) path
}
```

  Its failure `detail` carries `{ via, provider, baseUrl, status?, error?, serverProbe? }`,
  so an agent can tell a route probe from a direct CLI probe at a glance.

→ `{ "imageUrl": "data:…", "chunkInfo": {…}? }`

Sharp edges: the response is the **whole extended canvas**, not the new strip —
blend it back with the app's own code (`ie extend`, or the `apply-full-context`
bridge op) before using it. `extensionInfo`/`chunkInfo` must be the exact objects
the canvas builder produced.

### QA routes

`/api/tile-review` takes `{ prompt?, previewImage, sheetImage?, … }` and
`/api/sprite-review` takes `{ prompt?, anim?, bodyPlan?, sheetImage, anchorImage?, … }`.
Both answer `{ "ok": true|false, "issues": ["…"], "fix": "…" }`. `ok: true` with
empty arrays means approved. Treat *any* failure to get an answer as an approval —
that is what the UI does, and a flaky critic must never block a generation.

### /api/providers

`GET` → `{ "defaultProvider": "openrouter", "providers": [ { id, baseUrl, keyRequired, hasEnvKey, … } ] }`
(keyless, no network). **`defaultProvider` is the deployment default**, not the
config file's `defaultProfile`; a profile overrides provider selection for the
model routes regardless. `POST { provider | apiKey | profile? }` probes that
gateway's `/models` → `{ ok, provider, baseUrl, count, imageModelCount, models[] }`.

### /api/pixel

PixelLab relay. POST `{ op: "pixflux" | "character", description, width, height | image_size, template_id?, view?, seed?, no_background? }`
and GET `?op=characterStatus&id=…`, `?op=balance`, `?op=image&url=…`.
Header `x-pixellab-key` is required for everything except `op=image`.

Sharp edges: the vendor body and status are **relayed verbatim** (401/402/422/429/529
are bodyless) — do not expect our error shape here. `character` returns a job id;
poll it with `characterStatus`. `width`/`height` are integers in 16..400,
`image_size` in 32..256.

### /api/library

- `GET /api/library` → the index `{ projects: [{ name, kinds: [{ name, assets: [...] }] }], warnings: [] }`
- `GET /api/library/<project>/<kind>/<slug>` → `meta.json`
- `GET /api/library/<project>/<kind>/<slug>?file=derived/x.png` → the bytes
- `POST /api/library { project, kind, slug, meta, files: { "derived/x.png": "data:…" }, overwrite? }`
  → `{ path, written }`, `201` when new, `200` when overwriting, `409` without `overwrite`
- `DELETE /api/library/<project>/<kind>/<slug>` → `204`

Sharp edges: `kind` ∈ `tiles | sprites | props | parallax | extend`; names/slugs
are `^[a-z0-9][a-z0-9-]{0,63}$`; file keys are `raw|derived/<file>`; a data URL
is limited to 40 MiB decoded per file and 200 MiB per request (413 beyond).
`meta.provenance.backend` is re-stamped server-side. The CLI writes assets
directly through the same module (`ie library save`) — no HTTP needed.

---

## 5. CLI reference

Server & diagnostics:

| Command | Notes |
| --- | --- |
| `ie serve [--stop] [--port n]` | start/reuse `next dev`; records pid+port in `.ie/server.json` |
| `ie status` | recorded server, reachability, config file, profiles |
| `ie doctor` | node, deps, Chromium, bundle, config, credentials, server, assets — all in one object |
| `ie call <route> [--body json] [--body-file f] [--save out.png]` | escape hatch: POST any route with a raw body; a non-2xx answer is an error (`ok:false`, the route's body in `detail`) |

Post-processing (no server, no cost):

| Command | Notes |
| --- | --- |
| `ie chroma <in> <out> [--preset default\|tile\|prop\|despill] [--role <role>]` | key flat magenta to alpha |
| `ie slice <in> <outdir> --cols N --rows N [--cell N]` | one PNG per cell |
| `ie tileable <in> <out> [--axis both\|horizontal\|vertical] [--key-magenta]` | seamless tiling |
| `ie tile-guide <out.png>` | the 8×8 template guide (4096²) |
| `ie tile-extract <sheet> <outdir> [--cell 512] [--raw]` | align + slice + key + reconcile → 13 role PNGs (+ `raw/`) |
| `ie sprite-align <sheet> <outdir> [--cols 4 --rows 2 --cell 512 --body-plan <p> --airborne --keyed]` | key, isolate, scale, baseline-align, center |
| `ie pose-guide <anchor> <out.png> [--body-plan <p> --anim <name> --cols --rows --cell]` | skeletal pose map |
| `ie expand-canvas <in> <out> --direction <d> [--amount 38]` | canvas + blank strip (for /api/extend) |

Studio (server + cost):

| Command | Notes |
| --- | --- |
| `ie extend <in> <out> --direction left\|right\|up\|down [--amount 38] [--attempts N] [--prompt t] [--style k\|none]` | horizontal = best-of-N seam blending; vertical = single chunked pass |
| `ie tiles <prompt> --out <dir> [--review] [--style k\|none]` | 4096² sheet → 13 roles; `--review` runs the QA critic with up to 2 repaints, keeping the best |
| `ie sprite <description> --out <dir> [--body-plan p] [--anim name] [--frames 8] [--style k\|none]` | anchor → pose guide → sheet → aligned frames |
| `ie props <biome> --out <dir> [--count 8] [--style k\|none]` | art director → sheet → per-cell cleanup, files named from the director's categories |

Studio commands also take `--library <project>/<slug>` (or
`<project>/<kind>/<slug>`) to save the result into the asset library, and
`--overwrite` to replace an existing asset. Without `--overwrite` the CLI stops
*before* spending an API call when the target already exists.

Asset library (no server):

| Command | Notes |
| --- | --- |
| `ie library list` | index + warnings |
| `ie library get <project> <kind> <slug>` | `meta.json` |
| `ie library file <project> <kind> <slug> <relpath> --out <file>` | one stored file |
| `ie library save <project> <kind> <slug> --sheet <raw.png> --derived <a.png,b.png> [--meta json] [--type t] [--overwrite]` | write an asset directly |
| `ie library delete <project> <kind> <slug>` | remove an asset |

Pixel (PixelLab):

| Command | Notes |
| --- | --- |
| `ie pixel pixflux --description <t> [--width N --height N] [--seed N] [--view <v>] [--out <dir>]` | still sprite |
| `ie pixel character --description <t> [--image-size N] [--template <id>] [--view <v>] [--seed N] [--out <dir>]` | character job |
| `ie pixel status --id <jobId>` | vendor job status |
| `ie pixel balance` | credit balance |

Pixel commands need a key: `--key-env <ENV>` → `pixel.apiKeyEnv` → `pixel.apiKey`
→ `PIXELLAB_API_KEY`. Vendor output is finalized locally with the app's
`pixelGrid` pipeline (auto grid analysis, decimation, per-cell crop):
`--out <dir>` writes `raw/source.png` plus `derived/cell.png` for `pixflux`, and
`derived/dir_NN.png` per rotation for `character` (which submits, polls to
completion, then finalizes). Without `--out`, nothing is written and the vendor
result comes back as JSON. A `cropToCell` failure is surfaced verbatim with the
fix (`--width/--height` where the figure fits `--image-size`).

Config: see §3.

---

## 6. Recipes

**Tileset → library, then catalog it**

```bash
ie tiles "mossy grey dungeon stone" --out ./out/tiles --review \
  --library demo/tiles/mossy --style pixel-art --json
ie library file demo tiles mossy derived/body.png --out /tmp/body.png
ie library list --json
```

**Extend with the best seam, in one call**

```bash
ie extend in.png out.png --direction right --amount 38 --attempts 3 --json
# payload.attempts[] carries each candidate's seamResidual; only the best is written
```

**Two-pass sprite with a specific body plan**

```bash
ie sprite "a moss-covered stone golem" --out ./out/golem \
  --body-plan quadruped --anim walk --frames 8 --library demo/sprites/golem --json
# payload.alignment.duplicateFrames lists frames that look torn apart
```

**Props for a biome, named by the art director**

```bash
ie props "damp underground cavern with teal bioluminescence" --out ./out/cave \
  --count 8 --library demo/props/cave --json
# payload.items[] maps each file to the category the director chose
```

**No CLI, just HTTP** (the CLI is a thin client; every step has a route)

```bash
curl -s localhost:4317/api/providers | jq -r .defaultProvider
curl -s localhost:4317/api/generate -H 'content-type: application/json' \
  -d '{"prompt":"mossy stone","width":1024,"height":1024,"profile":"local"}' \
  | jq -r '.imageUrl' | cut -c1-40
```

**PixelLab without a browser**

```bash
export PIXELLAB_API_KEY=…                       # or: ie config set pixel.apiKeyEnv PIXELLAB_API_KEY
ie pixel pixflux --description "rusty lantern" --width 64 --height 64 --out ./out/pix --json
```

---

## 7. Environment

| Variable | Effect |
| --- | --- |
| `IE_CONFIG` | config file path (must exist when set) |
| `IE_BASE_URL` | talk to an already-running server instead of spawning one |
| `IE_CHROMIUM` | Chromium/headless-shell binary for the pixel ops (wins over the cache) |
| `IE_ASSETS_DIR` | asset library root (default `<repo>/assets`) |
| `IE_MAGPIE_BASE_URL` | deployment-level magpie base URL (used when no profile sets one) |
| `OPENROUTER_API_KEY` / `MAGPIE_API_KEY` / `PIXELLAB_API_KEY` | credentials for the env fallback path |

Runtime state lives in `<repo>/.ie/` (gitignored): `server.json`, `server.log`,
`cache/` (esbuild bundles), `tmp/` (per-pass intermediates).

If Chromium is missing, `ie doctor` prints the exact install command
(`npx playwright install chromium-headless-shell`); `IE_CHROMIUM` always wins.

## 8. Backends with a different wire protocol

`apimart` is a first-class provider, not a chat gateway: image models there are an
**async task API** (submit → poll → the server downloads and inlines the expiring
result URL), so the adapter lives server-side in `app/lib/apimartServer.ts` and a
profile just names it:

```jsonc
{ "profiles": { "apimart": { "provider": "apimart", "apiKeyEnv": "APIMART_API_KEY", "imageModel": "gpt-image-2-official" } } }
```

Sharp edges that follow from that protocol:

- **Extends must use the full-context path** (`useFullContext: true`, i.e. an
  `extensionInfo`): a chunked extend has no single output size to ask for and is
  rejected with 400. `ie extend --direction up|down` is chunked, so an APIMart
  profile cannot do vertical extends.
- **Sizes are a ratio plus a 1K/2K/4K tier**, except on `gpt-image-2-official`,
  which takes exact pixels (capped at 3840 per edge). A 4096² tile sheet therefore
  comes back in the model's own scale and is normalized by the aligner — check
  `manifest.returned` rather than assuming the requested size.
- Chat and vision models work there too, so the art-director passes (`tile-review`,
  `sprite-review`, `prop-brief`, `scene-brief`) run on the same profile.

Everything else reaches a chat/completions gateway. A generic OpenAI-compatible
endpoint is expressible either as a `magpie` profile with a custom `baseUrl` or as
a new entry in `PROVIDER_IDS`.

- No second implementation of any pixel algorithm. If the app changes an option
  name or a threshold, the CLI changes with it — that is the point of driving the
  app's own modules.
- No second implementation of any pixel algorithm. If the app changes an option
  name or a threshold, the CLI changes with it — that is the point of driving the
  app's own modules.
