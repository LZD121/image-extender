import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '../route'
import { PIXEL_KEY_HEADER } from '@/app/lib/pixel'

function post(body: unknown, key: string | null = 'k') {
  const headers = key === null ? {} : { [PIXEL_KEY_HEADER]: key }
  return new NextRequest(new URL('/api/pixel', 'http://localhost:3000'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  } as never)
}

function get(query: string, key: string | null = 'k') {
  const headers = key === null ? {} : { [PIXEL_KEY_HEADER]: key }
  return new NextRequest(new URL(`/api/pixel?${query}`, 'http://localhost:3000'), { headers } as never)
}

describe('/api/pixel', () => {
  it('rejects a missing key before doing anything else', async () => {
    const res = await POST(post({ op: 'pixflux', description: 'x' }, null))
    expect(res.status).toBe(401)
  })

  it('rejects an op that is not on the allow-list', async () => {
    for (const op of ['/v2/balance', '../x', 'balance?', 'nope', '']) {
      const res = await POST(post({ op, description: 'x' }))
      expect(res.status).toBe(400)
    }
  })

  it('rejects a GET op that is not on the allow-list', async () => {
    const res = await GET(get('op=create-image-pixflux'))
    expect(res.status).toBe(400)
  })

  it('rejects a pixflux body with no description, without calling the vendor', async () => {
    const res = await POST(post({ op: 'pixflux' }))
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('description')
  })

  it('rejects an out-of-range size', async () => {
    const res = await POST(post({ op: 'pixflux', description: 'x', width: 8, height: 8 }))
    expect(res.status).toBe(400)
  })

  it('refuses to proxy an image from a host that is not the vendor', async () => {
    const res = await GET(get('op=image&url=' + encodeURIComponent('https://evil.example/x.png')))
    expect(res.status).toBe(403)
  })

  it('refuses a non-https image url', async () => {
    const res = await GET(get('op=image&url=' + encodeURIComponent('http://api.pixellab.ai/x.png')))
    expect(res.status).toBe(400)
  })

  it('validates the characterStatus id', async () => {
    const res = await GET(get('op=characterStatus&id=../../etc/passwd'))
    expect(res.status).toBe(400)
  })
})
