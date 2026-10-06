// app/lib/providers.ts
/**
 * Which OpenAI-compatible gateway the app talks to.
 *
 * The table is isomorphic (the Settings UI needs the labels and defaults), but
 * the *base URL actually used* is resolved server-side from this table plus
 * deployment env — a client-supplied URL would turn the server into a
 * fetch-anywhere proxy carrying the user's key.
 */

export type ProviderId = 'openrouter' | 'magpie' | 'apimart'

export type Provider = {
  id: ProviderId
  label: string
  /** OpenAI-compatible root, no trailing slash. */
  baseUrl: string
  /** Whether a key is needed to call this gateway. */
  keyRequired: boolean
  keyHint: string
  keyDocs: string | null
  /** Env var that can supply the key server-side (BYOK stays authoritative). */
  keyEnv: string
  /** Fallback image model until the user picks one from a live model list. */
  imageModel: string
  /** Fallback art-director (vision) model for the QA routes. */
  qaModel: string
  hint: string
}

/** A provider plus the facts only the server can know. */
export type ProviderStatus = Provider & { hasEnvKey: boolean }

/** One entry from a gateway's `/models` list. */
export type GatewayModel = {
  id: string
  /** The supplier the gateway names (`owned_by`), else the id's prefix. */
  vendor: string
  imageCapable: boolean
}

export const PROVIDER_IDS: readonly ProviderId[] = ['openrouter', 'magpie', 'apimart']

/** Magpie is a local OpenAI-compatible gateway (auth: none by default here). */
export const MAGPIE_DEFAULT_BASE_URL = 'http://127.0.0.1:3425/v1'

export const DEFAULT_PROVIDER: ProviderId = 'openrouter'

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value)
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyRequired: true,
    keyHint: 'sk-or-...',
    keyDocs: 'https://openrouter.ai/keys',
    keyEnv: 'OPENROUTER_API_KEY',
    imageModel: 'google/gemini-3.1-flash-image-preview',
    qaModel: 'google/gemini-2.0-flash-001',
    hint: 'Hosted, billed per call. Hosts the Gemini image models the studios are tuned for.',
  },
  magpie: {
    id: 'magpie',
    label: 'Magpie gateway',
    baseUrl: MAGPIE_DEFAULT_BASE_URL,
    keyRequired: false,
    keyHint: 'usually not required',
    keyDocs: null,
    keyEnv: 'MAGPIE_API_KEY',
    imageModel: 'teamo-router/gemini-3.1-flash-image',
    qaModel: 'commandcode/Qwen/Qwen3.7-Plus',
    hint: 'A local OpenAI-compatible gateway. Model ids are vendor-prefixed, and which ones actually answer depends on the gateway’s own upstream credentials — the model list shown here is whatever the gateway reports.',
  },
  apimart: {
    id: 'apimart',
    label: 'APIMart',
    baseUrl: 'https://api.apimart.ai/v1',
    keyRequired: true,
    keyHint: 'sk-...',
    keyDocs: 'https://docs.apimart.ai/llms.txt',
    keyEnv: 'APIMART_API_KEY',
    imageModel: 'gpt-image-2-official',
    qaModel: 'claude-sonnet-4-5-20250929',
    hint: 'Image models here are an async task API (submit, poll, then the server inlines the expiring result URL). Sizes are a ratio or — on gpt-image-2-official — exact pixels, and reference images ride along for tile guides and sprite sheets. Chat and vision work too, so the art-director passes run here as well.',
  },
}

/**
 * Model ids that can paint an image. Vendor lists mix chat and image models and
 * carry no capability metadata, so this is an id heuristic — it decides what
 * the picker offers first, never whether a call succeeds.
 */
const IMAGE_MODEL = /(^|[-/])(image|imagen|banana|flux|dalle|dall-e|seedream|qwen-image|hunyuan-image|gpt-image|kolors|sd3|sdxl)([-/.]|$)/i

export function looksLikeImageModel(id: string): boolean {
  return IMAGE_MODEL.test(id)
}

/** Vendor prefix of a gateway model id (`teamo-router/gemini-3.1-flash-image` → `teamo-router`). */
export function vendorOf(id: string): string {
  const slash = id.indexOf('/')
  return slash === -1 ? id : id.slice(0, slash)
}

/**
 * The ids this project has actually completed a call with, per gateway.
 *
 * A gateway's `/models` list is a list of what it *has*, not of what works:
 * measured 2026-10-06 against the local magpie gateway, every image id it
 * reported except one either needs an upstream key it does not hold
 * (`google/*` → "Please pass a valid API key"), is geo-blocked
 * (`antigravity/*`, `group/auto-gemini-3-1-flash-image`), or refuses
 * `/v1/chat/completions` outright (`teamo-router/gpt-image-2*` → "是图片模型，
 * 无法通过 /v1/chat/completions 调用" — those ids are teamo-router's own, and
 * APIMart resells the same three under its own provider; the gateway cannot
 * proxy either, because it only wires up chat/anthropic/responses endpoints).
 * So the pickers offer this set, and the rest of a gateway's list sits behind an
 * explicit "unverified" toggle.
 *
 * OpenRouter has no entry: its picker is the curated `MODELS` table in
 * `app/lib/models.ts`, which is verified by construction.
 */
export const VERIFIED_MODELS: Partial<Record<ProviderId, { image: string[]; qa: string[] }>> = {
  magpie: {
    image: ['teamo-router/gemini-3.1-flash-image'],
    qa: ['commandcode/Qwen/Qwen3.7-Plus'],
  },
  // Every image id APIMart reports was probed on 2026-10-06 by generating with
  // it (45 ids, ~$1 of calls): 34 answered and are listed below in measured
  // cost order, since the picker lists them in order. The 11 that did not, with
  // their own words, so nobody re-probes them:
  //   `chatgpt-image-latest`, `ltx-2.3-image-video` — "not a supported image
  //     generation model for /v1/images/generations"
  //   `dall-e-2`, `dall-e-3` — "ratio or price is not configured" (not enabled
  //     on this account)
  //   `flux-3-video` — "unsupported resolution 1k (expected hd or fhd)"; a
  //     video model with its own vocabulary
  //   `seedream-5-0-lite`, `ltx-2.3-text-image` — "The requested option isn't
  //     supported by the upstream service"
  //   `imagen-4.0-apimart` — vendor-side failure on every attempt (1k and 2k)
  //   `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5` — rate limited /
  //     "receiving a lot of requests right now" on every attempt
  // `seedream-4-5` needed a different ask rather than a retry: it refuses 1K
  // outright ("please use 2K or 4K") and answers at 2K, which is what the
  // adapter's tier escalation is for.
  apimart: {
    image: [
      'gpt-image-2-official',
      'gpt-image-2.5-flare',
      'gpt-image-2.5-sunburst',
      'gpt-image-2',
      'gpt-image-2.5-ext',
      'z-image-turbo',
      'gemini-2.5-flash-image-preview',
      'gemini-3.1-flash-lite-image-ext',
      'seedream-5-0-flash',
      'gemini-3.1-flash-image-preview',
      'grok-imagine-image',
      'seedream-4-0',
      'qwen-image-2.0',
      'qwen-image-3.0',
      'wan2.7-image',
      'seedream-4-5',
      'qwen-image-3.0-pro',
      'seedream-5-0-pro',
      'gemini-3-pro-image-preview',
      'gemini-2.5-flash-image-preview-official',
      'flux-kontext-pro',
      'flux-2-pro',
      'gemini-3.1-flash-lite-image',
      'grok-imagine-image-quality',
      'grok-imagine-image-2.0',
      'qwen-image-2.0-pro',
      'wan2.7-image-pro',
      'gemini-3.1-flash-image-preview-official',
      'flux-kontext-max',
      'flux-2-flex',
      'flux-2-max',
      'gpt-image-1.5-official',
      'gemini-3-pro-image-preview-official',
      'gpt-image-1-official',
    ],
    qa: ['claude-sonnet-4-5-20250929'],
  },
}

export type PickableModels = {
  /** The app curates this gateway's list, so there is nothing to verify. */
  curated: boolean
  verifiedImage: GatewayModel[]
  otherImage: GatewayModel[]
  verifiedQa: GatewayModel[]
  otherQa: GatewayModel[]
}

/**
 * Split a gateway's reported models into what this project has verified and
 * what it merely reports. Pure: the picker and its tests read the same answer.
 */
export function pickableModels(provider: ProviderId, reported: GatewayModel[]): PickableModels {
  const image = reported.filter((m) => m.imageCapable)
  const text = reported.filter((m) => !m.imageCapable)
  const verified = VERIFIED_MODELS[provider]
  if (!verified) {
    return { curated: true, verifiedImage: image, otherImage: [], verifiedQa: text, otherQa: [] }
  }
  const okImage = new Set(verified.image)
  const okQa = new Set(verified.qa)
  return {
    curated: false,
    verifiedImage: image.filter((m) => okImage.has(m.id)),
    otherImage: image.filter((m) => !okImage.has(m.id)),
    verifiedQa: text.filter((m) => okQa.has(m.id)),
    otherQa: text.filter((m) => !okQa.has(m.id)),
  }
}
