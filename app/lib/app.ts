export type Direction = 'up' | 'down' | 'left' | 'right'

/**
 * One generated extension result. For horizontal extensions we produce up to
 * `maxAttempts` candidates, sort them by seam quality (lowest residual first),
 * and let the user cycle through them before accepting. Vertical extensions
 * produce a single candidate (the chunked path is deterministic enough that
 * multiple tries rarely help).
 */

export type Candidate = {
  /**
   * Fully blended, ready-to-display image data URL. For parallax keyed
   * layers, this is the alpha-keyed (transparent-magenta) version.
   */
  imageUrl: string
  /** Mean color difference at the seam — lower = cleaner blend. */
  score: number
  /** 1-indexed generation order, useful for debug logging. */
  attempt: number
  /**
   * Pre-keying source for parallax keyed layers. Stored so the next extend
   * operation can feed the un-keyed magenta image back into the AI (the
   * model continues the magenta background more reliably than transparent
   * regions). Undefined for sky layers and for extender-mode candidates.
   */
  rawImageUrl?: string
}

/**
 * Extension percent is fixed in code. 38% is the sweet spot we converged on —
 * large enough to feel useful, small enough that the AI keeps the scene
 * coherent. Iterative extensions chain naturally if the user wants more.
 */

export const EXTENSION_PERCENT = 38

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter integration — BYOK (bring your own key) for open-source friendliness
// ─────────────────────────────────────────────────────────────────────────────


export const STORAGE_KEY = 'extender:api_key'

export const STORAGE_MODEL = 'extender:model'

/** Which gateway the app talks to (`openrouter` | `magpie`). */
export const STORAGE_PROVIDER = 'extender:provider'

/**
 * The art-director (vision/text) model the QA routes run on. It is a separate
 * setting because an image model cannot review a composited tile set, and a
 * gateway's model list is not shared between providers.
 */
export const STORAGE_QA_MODEL = 'extender:qaModel'

/**
 * One key per gateway: an OpenRouter key means nothing to magpie, and the
 * Settings drawer labels the field with the gateway it belongs to. The default
 * gateway keeps the original slot so existing installs keep their key.
 */
export function apiKeyStorageKey(provider: string): string {
  return provider === 'openrouter' ? STORAGE_KEY : `${STORAGE_KEY}:${provider}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline icons — minimal SVG primitives, zero dependencies
// ─────────────────────────────────────────────────────────────────────────────


export type Mode = 'extender' | 'parallax' | 'tile' | 'sprite' | 'props' | 'pixel'

export const STORAGE_MODE = 'extender:mode'

/** localStorage key for the asset library's project name, shared by all studios. */
export const LIBRARY_PROJECT_STORAGE = 'extender:libraryProject'

/**
 * Common engine-friendly horizontal targets for sidescroller backgrounds.
 * Multiples of common 16:9 game widths so tiling lands on clean boundaries.
 */
