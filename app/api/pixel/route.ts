import { NextRequest, NextResponse } from 'next/server'
import {
  isPixelOp,
  PIXEL_IMAGE_HOSTS,
  PIXEL_KEY_HEADER,
  PIXELLAB_BASE,
  PIXFLUX_MAX,
  PIXFLUX_MIN,
  PIXEL_TEMPLATES,
  PIXEL_VIEWS,
  V3_MAX,
  V3_MIN,
} from '@/app/lib/pixel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CHARACTER_ID = /^[A-Za-z0-9_-]{1,64}$/

const json = (body: unknown, status: number) => NextResponse.json(body, { status })

function pickKey(request: NextRequest): string | null {
  const key = request.headers.get(PIXEL_KEY_HEADER)
  return key && key.trim().length > 0 ? key.trim() : null
}

/** The vendor has no error-body contract (401/402/422/429/529 are bodyless):
 *  pass the status and the raw text through, never invent a shape. */
async function relay(res: Response): Promise<NextResponse> {
  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  })
}

type IntResult = { ok: true; value: number | null } | { ok: false }

/** `undefined` means "not provided" (null); anything malformed is a rejection. */
function integerOrNull(value: unknown, min: number, max: number): IntResult {
  if (value === undefined) return { ok: true, value: null }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return { ok: false }
  return { ok: true, value }
}

function buildPixflux(input: Record<string, unknown>): { ok: true; body: unknown } | { ok: false; error: string } {
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!description) return { ok: false, error: 'description is required' }
  const width = integerOrNull(input.width, PIXFLUX_MIN, PIXFLUX_MAX)
  const height = integerOrNull(input.height, PIXFLUX_MIN, PIXFLUX_MAX)
  if (!width.ok || !height.ok) {
    return { ok: false, error: `width/height must be integers in ${PIXFLUX_MIN}..${PIXFLUX_MAX}` }
  }
  return {
    ok: true,
    body: {
      description,
      ...(width.value === null || height.value === null ? {} : { image_size: { width: width.value, height: height.value } }),
      ...(typeof input.no_background === 'boolean' ? { no_background: input.no_background } : {}),
      ...(typeof input.color_image === 'string' ? { color_image: input.color_image } : {}),
      ...(typeof input.seed === 'number' && Number.isInteger(input.seed) ? { seed: input.seed } : {}),
    },
  }
}

function buildCharacter(input: Record<string, unknown>): { ok: true; body: unknown } | { ok: false; error: string } {
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!description) return { ok: false, error: 'description is required' }
  const size = integerOrNull(input.image_size, V3_MIN, V3_MAX)
  if (!size.ok) return { ok: false, error: `image_size must be an integer in ${V3_MIN}..${V3_MAX}` }
  const template = input.template_id
  if (template !== undefined && !(PIXEL_TEMPLATES as readonly unknown[]).includes(template)) {
    return { ok: false, error: `template_id must be one of ${PIXEL_TEMPLATES.join(', ')}` }
  }
  const view = input.view
  if (view !== undefined && !(PIXEL_VIEWS as readonly unknown[]).includes(view)) {
    return { ok: false, error: `view must be one of ${PIXEL_VIEWS.join(', ')}` }
  }
  return {
    ok: true,
    body: {
      description,
      no_background: true,
      ...(size.value === null ? {} : { image_size: { width: size.value, height: size.value } }),
      ...(template === undefined ? {} : { template_id: template }),
      ...(view === undefined ? {} : { view }),
      ...(typeof input.seed === 'number' && Number.isInteger(input.seed) ? { seed: input.seed } : {}),
    },
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const key = pickKey(request)
  if (!key) return json({ error: `missing ${PIXEL_KEY_HEADER}` }, 401)

  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  // The browser client puts the op in the query string for every call, POSTs
  // included; accept both so the two halves cannot drift apart again.
  const op = request.nextUrl.searchParams.get('op') ?? payload.op
  if (!isPixelOp(op) || (op !== 'pixflux' && op !== 'character')) {
    return json({ error: 'unknown op' }, 400)
  }

  const built = op === 'pixflux' ? buildPixflux(payload) : buildCharacter(payload)
  if (!built.ok) return json({ error: built.error }, 400)

  const path = op === 'pixflux' ? '/create-image-pixflux' : '/create-character-v3'
  const res = await fetch(`${PIXELLAB_BASE}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(built.body),
  })
  return relay(res)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const op = request.nextUrl.searchParams.get('op')
  if (!isPixelOp(op) || op === 'pixflux' || op === 'character') {
    return json({ error: 'unknown op' }, 400)
  }

  // The `image` op must work without our header: it is consumed by <img> and
  // by canvas loads, neither of which can send `x-pixellab-key`. It never
  // calls the vendor with the key anyway — the host allow-list below is the
  // real boundary, and the CDN URLs are public.
  if (op !== 'image') {
    const key = pickKey(request)
    if (!key) return json({ error: `missing ${PIXEL_KEY_HEADER}` }, 401)

    if (op === 'characterStatus') {
      const id = request.nextUrl.searchParams.get('id') ?? ''
      if (!CHARACTER_ID.test(id)) return json({ error: 'invalid character id' }, 400)
      const res = await fetch(`${PIXELLAB_BASE}/characters/${id}`, {
        headers: { authorization: `Bearer ${key}` },
        cache: 'no-store',
      })
      return relay(res)
    }

    const res = await fetch(`${PIXELLAB_BASE}/balance`, {
      headers: { authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    return relay(res)
  }

  // op === 'image': same-origin proxy so a canvas can read the pixels.
  const raw = request.nextUrl.searchParams.get('url') ?? ''
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return json({ error: 'invalid url' }, 400)
  }
  if (target.protocol !== 'https:') return json({ error: 'https only' }, 400)
  const allowed = PIXEL_IMAGE_HOSTS.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`))
  if (!allowed) return json({ error: `host ${target.hostname} is not a vendor host` }, 403)

  const res = await fetch(target.toString(), { cache: 'no-store' })
  if (!res.ok) return json({ error: `upstream ${res.status}` }, 502)
  return new NextResponse(await res.arrayBuffer(), {
    status: 200,
    headers: { 'content-type': res.headers.get('content-type') ?? 'image/png' },
  })
}
