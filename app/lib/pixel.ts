// app/lib/pixel.ts
/**
 * Everything the fork knows about pixel-art generators.
 *
 * Round 1 has exactly one implementation (`pixellab`). The `PixelGenerator`
 * type is a seam, not a framework: a second engine is a new module, not a
 * refactor. The types mirror the vendor's REST v2 shapes only where the UI
 * needs them.
 */

export const PIXEL_OPS = ['pixflux', 'character', 'characterStatus', 'balance', 'image'] as const
export type PixelOp = (typeof PIXEL_OPS)[number]

export function isPixelOp(value: unknown): value is PixelOp {
  return typeof value === 'string' && (PIXEL_OPS as readonly string[]).includes(value)
}

/** `image_size` bounds, verified against api.pixellab.ai/v2/openapi.json. */
export const PIXFLUX_MIN = 16
export const PIXFLUX_MAX = 400
export const V3_MIN = 32
export const V3_MAX = 256

/** Standard mode drives a fixed skeleton: the template beats the prompt. */
export const PIXEL_TEMPLATES = ['mannequin', 'bear', 'cat', 'dog', 'horse', 'lion'] as const
export type PixelTemplate = (typeof PIXEL_TEMPLATES)[number]

export const PIXEL_VIEWS = ['low top-down', 'high top-down', 'side'] as const
export type PixelView = (typeof PIXEL_VIEWS)[number]

export const PIXELLAB_BASE = 'https://api.pixellab.ai/v2'
export const PIXEL_KEY_HEADER = 'x-pixellab-key'

/**
 * Hosts the `image` op may proxy. Rotation URLs are served from
 * `backblaze.pixellab.ai` (verified live 2026-10-05 — the proxy returned 200
 * for a real rotation), which the bare-domain suffix rule below already
 * covers. Keep the suffix rather than pinning one bucket host.
 */
export const PIXEL_IMAGE_HOSTS = ['api.pixellab.ai', 'pixellab.ai']

export const PIXEL_KEY_STORAGE = 'extender:pixelKey'
export const PIXEL_PROJECT_STORAGE = 'extender:libraryProject'
export const PIXEL_BLOCK_STORAGE = 'extender:pixelBlock'
export const PIXEL_CELL_STORAGE = 'extender:pixelCell'

/** Browser-only key storage. Never sent anywhere except the proxy header. */
export function readPixelKey(): string {
  try {
    return localStorage.getItem(PIXEL_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function writePixelKey(key: string): void {
  try {
    localStorage.setItem(PIXEL_KEY_STORAGE, key)
  } catch {
    /* private mode: the key just does not persist */
  }
}

export function readStoredNumber(storageKey: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(storageKey)
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

export function writeStoredNumber(storageKey: string, value: number): void {
  try {
    localStorage.setItem(storageKey, String(value))
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Generator seam
// ---------------------------------------------------------------------------

export type PixfluxRequest = {
  description: string
  width: number
  height: number
  noBackground: boolean
  /** Optional palette reference image (data URL). */
  colorImage?: string | null
  seed?: number | null
}

export type CharacterRequest = {
  description: string
  template: PixelTemplate
  view: PixelView
  /** Square output size, V3_MIN..V3_MAX. Non-square results are padded by the vendor. */
  size: number
  seed?: number | null
}

export type PixelRotationUrls = {
  south: string
  west: string
  east: string
  north: string
  'south-east'?: string | null
  'north-east'?: string | null
  'south-west'?: string | null
  'north-west'?: string | null
}

export type PixelJob = {
  status: 'pending' | 'completed' | 'failed'
  /** Empty until status is 'completed'. */
  images: string[]
  /** e.g. "48x48" — measured, not requested. */
  size: string | null
}

export type PixelUsage = { usd: number | null; generations: number | null }

export type PixelGenerator = {
  id: 'pixellab'
  generateImage(req: PixfluxRequest, key: string): Promise<{ dataUrl: string; usage: PixelUsage | null }>
  createCharacter(req: CharacterRequest, key: string): Promise<{ characterId: string }>
  pollCharacter(id: string, key: string): Promise<PixelJob>
}

// ---------------------------------------------------------------------------
// The one implementation
// ---------------------------------------------------------------------------

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  return text.trim() || `HTTP ${res.status}`
}

async function proxy<T>(op: PixelOp, key: string, init: { body?: unknown; query?: string }): Promise<T> {
  const url = `/api/pixel?op=${op}${init.query ?? ''}`
  const res = await fetch(url, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: {
      [PIXEL_KEY_HEADER]: key,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as T
}

/** The vendor returns either a bare base64 blob or a full data URL. */
function toDataUrl(base64: string): string {
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`
}

export const pixellab: PixelGenerator = {
  id: 'pixellab',

  async generateImage(req: PixfluxRequest, key: string) {
    const data = await proxy<{ image: { base64: string }; usage?: { usd?: number | null; generations?: number | null } }>(
      'pixflux',
      key,
      {
        body: {
          description: req.description,
          width: req.width,
          height: req.height,
          no_background: req.noBackground,
          ...(req.colorImage ? { color_image: req.colorImage } : {}),
          ...(req.seed === null || req.seed === undefined ? {} : { seed: req.seed }),
        },
      },
    )
    return {
      dataUrl: toDataUrl(data.image.base64),
      usage: data.usage ? { usd: data.usage.usd ?? null, generations: data.usage.generations ?? null } : null,
    }
  },

  async createCharacter(req: CharacterRequest, key: string) {
    const data = await proxy<{ character_id: string }>('character', key, {
      body: {
        description: req.description,
        template_id: req.template,
        view: req.view,
        image_size: { width: req.size, height: req.size },
        no_background: true,
        ...(req.seed === null || req.seed === undefined ? {} : { seed: req.seed }),
      },
    })
    return { characterId: data.character_id }
  },

  async pollCharacter(id: string, key: string) {
    const data = await proxy<{
      status: 'pending' | 'completed' | 'failed'
      rotation_urls: PixelRotationUrls | null
      size: { width: number; height: number } | null
    }>('characterStatus', key, { query: `&id=${encodeURIComponent(id)}` })
    const urls = data.rotation_urls
    const images = urls
      ? [urls.south, urls['south-east'], urls.east, urls['north-east'], urls.north, urls['north-west'], urls.west, urls['south-west']]
          .filter((u): u is string => typeof u === 'string' && u.length > 0)
      : []
    return {
      status: data.status,
      images,
      size: data.size ? `${data.size.width}x${data.size.height}` : null,
    }
  },
}

export type PixelBalance = { usd: number; generations: number | null; total: number | null; plan: string | null }

export async function fetchBalance(key: string): Promise<PixelBalance> {
  const data = await proxy<{
    credits?: { usd?: number }
    subscription?: { generations?: number; total?: number; plan?: string }
  }>('balance', key, {})
  return {
    usd: data.credits?.usd ?? 0,
    generations: data.subscription?.generations ?? null,
    total: data.subscription?.total ?? null,
    plan: data.subscription?.plan ?? null,
  }
}

/** Same-origin URL that may be drawn into a canvas without tainting it. */
export function proxiedImageUrl(url: string): string {
  return `/api/pixel?op=image&url=${encodeURIComponent(url)}`
}
