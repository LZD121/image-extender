# External Integrations

**Analysis Date:** 2026-10-06

## APIs & External Services

**Image / LLM gateways (the core integration):**
- OpenRouter — hosted image + vision model gateway; the deployment default (`DEFAULT_PROVIDER` in `app/lib/providers.ts:47`).
  - SDK/Client: none — hand-rolled `fetch` in `app/lib/llmChat.ts:24` (chat/completions) through the resolved target from `app/lib/llmServer.ts`.
  - Base URL: `https://openrouter.ai/api/v1` (`app/lib/providers.ts:57`). No env override.
  - Auth: **BYOK by default** — the user's key lives in browser `localStorage` under `extender:api_key` (`app/lib/app.ts:43`); the browser sends it in the request body and the server only proxies it. Server-side fallback: `OPENROUTER_API_KEY` (`.env.example:8`), read via `providerKey()` (`app/lib/llmServer.ts:38-42`). Browser key always wins.
  - Extra headers: `HTTP-Referer` (defaults `http://localhost:3000`) and `X-Title` (`app/lib/llmServer.ts:114-115`).
  - Models: curated table in `app/lib/models.ts:42` (Gemini image family; per-model `maxAttempts` / ETA).
- Magpie gateway — a local **generic OpenAI-compatible** gateway (`http://127.0.0.1:3425/v1`, `MAGPIE_DEFAULT_BASE_URL` in `app/lib/providers.ts:45`).
  - Auth: normally none (`keyRequired: false`, `app/lib/providers.ts:70`). Optional `MAGPIE_API_KEY` (`.env.example:20`) or a key typed in Settings (stored under `extender:api_key:magpie` — `apiKeyStorageKey()`, `app/lib/app.ts:62-64`).
  - Base URL override: `IE_MAGPIE_BASE_URL` (`.env.example:16`), consumed in `app/lib/llmServer.ts` (`serverProvider()`); profile `baseUrl` is the other route to it (`app/lib/ieConfig.ts`, `PROFILE_KEYS` at line 27).
  - Verified models are pinned in `VERIFIED_MODELS` (`app/lib/providers.ts:127-131`) because a gateway's `/models` list is what it *has*, not what works.
  - Probing: `app/lib/gatewayProbe.ts` (15 s timeout, `PROBE_TIMEOUT_MS:10`) hits `<baseUrl>/models`; used by `POST /api/providers` and by `ie config test` (which probes directly when a profile names its own baseUrl).
- APIMart — third gateway, and the only **async task API** (submit → poll → inline the expiring result URL).
  - Base URL: `https://api.apimart.ai/v1` (`app/lib/providers.ts:81`); auth via `APIMART_API_KEY` (`.env.example:25`) or a Settings key (`extender:api_key:apimart`).
  - Client: `app/lib/apimartServer.ts` — `POST /v1/images/generations`, poll every 2.5 s up to 6 min (`POLL_EVERY_MS`/`POLL_LIMIT_MS:18-19`), then fetch the result URL and inline it as a data URL (`inlineResult()`), including its reported cost.
  - Size negotiation is vendor-specific and lives only here: exact pixels for `gpt-image-2-official` / dall-e (multiples of 16, max edge 3840) vs a ratio + `1k|2k|4k` tier (`apimartSize()`, `APIMART_RATIOS`).
  - Chat/vision also runs here, so the art-director passes can target it.
- PixelLab v2 — pixel-art generator, wired only through the relay route `POST/GET /api/pixel`.
  - Base: `https://api.pixellab.ai/v2` (`app/lib/pixel.ts:46`); ops `pixflux`, `character`, `characterStatus`, `balance`.
  - Auth: header `x-pixellab-key` (`PIXEL_KEY_HEADER`, `app/lib/pixel.ts:47`). BYOK in the browser under `extender:pixelKey` (`PIXEL_KEY_STORAGE`, `app/lib/pixel.ts:57`, read/written by `readPixelKey`/`writePixelKey`); for the CLI the chain is `--key-env <ENV>` → config `pixel.apiKeyEnv` → config `pixel.apiKey` → `PIXELLAB_API_KEY` (`cli/commands/pixel.mjs`).
  - Responses (including 401/402/422/429/529, which are bodyless) are relayed verbatim — never re-shaped (`app/api/pixel/route.ts:27-35`).

**QA / vision "art director" routes (same gateway, separate model slot):**
- `POST /api/tile-review` and `POST /api/sprite-review` — a vision model critiques an assembled tileset / sprite sheet and returns `{ ok, issues, fix }`.
  - Model slot: `extender:qaModel` in the browser (`STORAGE_QA_MODEL`, `app/lib/app.ts:55`), or the profile's `qaModel` (`app/lib/ieConfig.ts:27`); default per provider in `PROVIDERS` (`app/lib/providers.ts:53-90`).
  - Fail-open contract: any failure to get a review counts as approval (documented in `docs/agent-api.md`).
- `POST /api/scene-brief` and `POST /api/prop-brief` — text/reasoning passes (scene brief distillation, prop idea generation) on the same chat surface.

**No other third-party services:** no payments, no email/SMS, no analytics, no error tracking, no auth provider, no OAuth.

## Data Storage

**Databases:**
- None. There is no server-side persistence layer of any kind.

**File Storage:**
- Local disk only — the asset library root is `IE_ASSETS_DIR` or `<repo>/assets` (`assetsRoot()`, `app/lib/library.ts:41-43`).
  - Layout: `<root>/<project>/<kind>/<slug>/{meta.json, raw/, derived/}`; `kind ∈ tiles | sprites | props | parallax | extend`; names/slugs `^[a-z0-9][a-z0-9-]{0,63}$` (`NAME_RE`, `app/lib/libraryPath.ts:14`), file keys `raw|derived/<file>`.
  - `app/lib/library.ts` is the **only** module in the app that touches the filesystem (stated at lines 18-22); writes go to a temp dir then atomic rename, so a crash can't leave a half-written asset.
  - HTTP surface: `app/api/library/[[...path]]/route.ts` (index, meta, file bytes, save, delete; 40 MiB per file / 200 MiB per request limits).
  - Git: only `derived/` is versioned — `assets/**/raw/` is gitignored (`.gitignore:50-51`). `.gitattributes` marks `*.png -diff` (binary files are not text-diffed).
- Browser-owned state: the uploaded/working image never leaves the page except as request bodies; there is no upload bucket.

**Caching:**
- Gateway `/models` probe cached in `localStorage` under `extender:providerModels:v2`, 10-minute TTL (`CACHE_KEY`/`CACHE_TTL_MS`, `app/lib/providerProbe.ts:27-30`).
- CLI/esbuild bundle cache and dev-server state in `.ie/` (gitignored, `.gitignore:58-60`); `.next/` for Next's own cache.

## Authentication & Identity

**Auth Provider:**
- None — there is no account system, session, or login. The app is an anonymous single-page studio.

**Credential model (BYOK):**
- Per-gateway key slots in `localStorage`: `extender:api_key` (OpenRouter, the default slot), `extender:api_key:magpie`, `extender:api_key:apimart` (`apiKeyStorageKey()`, `app/lib/app.ts:43,62-64`); PixelLab under `extender:pixelKey` (`app/lib/pixel.ts:57`).
- Precedence, resolved once per request in `app/lib/llmServer.ts`: request `apiKey` → profile (`apiKeyEnv` env var, else inline) → provider env var (`OPENROUTER_API_KEY` / `MAGPIE_API_KEY` / `APIMART_API_KEY`) → error (`docs/agent-api.md` §3).
- Config file credentials: `~/.config/image-extender/config.json` (or `$IE_CONFIG` / `.ie/config.json`), `chmod 600` when it holds an inline key; `apiKeyEnv` (an env var *name*) is the preferred form and the CLI only ever reports key *source*, never the key (`app/lib/ieConfig.ts:140-150`).
- Secrets never enter git: `.env`, `.env.local`, `.env*.local`, `.env.midscene` are all gitignored (`.gitignore:17-22,54`).

## Monitoring & Observability

**Error Tracking:**
- None. Errors surface as route JSON `{ error }` + status (401 credentials/unknown profile, 400 bad input, 5xx upstream) and never as a report to any service.

**Analytics:**
- None.

**Logs:**
- stdout/stderr of `next dev` / `next start` only. The CLI redirects its own dev server to `.ie/server.log` (`cli/lib/server.mjs:17`); CLI progress notes go to stderr so stdout stays machine-parseable (`docs/agent-api.md` §2).

## CI/CD & Deployment

**Hosting:**
- Any Node host running Next 14 — no `.github/` directory, no CI pipeline, no Dockerfile, no IaC in the repo.
- `.vercel` is gitignored (`.gitignore:47-48`) and nothing Vercel-specific is imported, so a plain `next build && next start` deployment works.
- Self-hosting caveats: `/api/library` and pixel saving need a writable `IE_ASSETS_DIR`; everything else is stateless.

**CI Pipeline:**
- None in-repo. The closest thing is the script triad `npm test` (vitest), `npm run test:cli` (node:test + Chromium), `npm run test:ai` (Playwright + Midscene).

## Environment Configuration

**Development:**
- Required env vars: none. `OPENROUTER_API_KEY` alone makes the CLI work end-to-end.
- Optional: `IE_MAGPIE_BASE_URL`, `MAGPIE_API_KEY`, `APIMART_API_KEY`, `PIXELLAB_API_KEY`, `IE_ASSETS_DIR`, `IE_BACKEND_LABEL`, `IE_CONFIG`, `IE_CHROMIUM`, `IE_BASE_URL` (CLI `--base-url` fallback, `cli/lib/server.mjs`).
- Secrets location: `.env.local` (gitignored) and/or the config JSON; BYOK keys live in the browser.
- Mock/stub services: a local Magpie gateway at `127.0.0.1:3425/v1` substitutes for every hosted gateway (auth: none) — it is what `.env.midscene.example` and the README's self-host story point at.

**Staging:**
- No environment tiers exist; deployment is single-environment.

**Production:**
- Secrets management: whatever the host provides (env vars) — the app itself has no secret store. A public deploy without `OPENROUTER_API_KEY` is fully BYOK and stores nothing.

## Webhooks & Callbacks

**Incoming:**
- None. Every route is request/response; no endpoint is designed to be called by a third party (no signature verification anywhere).

**Outgoing:**
- None. The app never calls back to a user-provided URL; the only outbound traffic is the gateway calls above plus the `GET /api/pixel?op=image` proxy — which fetches **only** from `api.pixellab.ai` / `pixellab.ai` (host allow-list `PIXEL_IMAGE_HOSTS`, `app/lib/pixel.ts:55`; enforced at `app/api/pixel/route.ts:157-160`) and never sends a key on that path.

---

*Integration audit: 2026-10-06*
*Update when adding/removing external services*
