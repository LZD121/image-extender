import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { GET, POST, DELETE } from '../[[...path]]/route'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function req(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), init as never)
}

/** Next always passes the segment array separately — the test must too. */
const ctx = (path?: string[]) => ({ params: { path } })

const meta = {
  schemaVersion: 1 as const,
  type: 'tile-set',
  project: 'dungeon',
  kind: 'tiles' as const,
  slug: 'mossy-stone',
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  manifest: { type: 'tile-set' },
  files: { sheet: 'raw/sheet.png', derived: ['derived/body.png'] },
  provenance: {
    backend: 'openrouter', model: 'm', prompt: null, sceneBrief: null, artStyle: null,
    params: {}, requested: null, returned: null, cost: null, toolVersion: 'web',
  },
}

const save = (extra: Record<string, unknown> = {}) =>
  req('/api/library', {
    method: 'POST',
    body: JSON.stringify({ project: 'dungeon', kind: 'tiles', slug: 'mossy-stone', meta, files: { 'derived/body.png': PNG }, ...extra }),
  })

describe('/api/library', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ie-lib-api-'))
    process.env.IE_ASSETS_DIR = root
    process.env.IE_BACKEND_LABEL = 'apimart'
  })

  afterEach(async () => {
    delete process.env.IE_ASSETS_DIR
    delete process.env.IE_BACKEND_LABEL
    await rm(root, { recursive: true, force: true })
  })

  it('starts empty', async () => {
    const res = await GET(req('/api/library'), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ projects: [], warnings: [] })
  })

  it('saves, indexes, serves meta and serves the PNG', async () => {
    expect((await POST(save())).status).toBe(201)

    const index = await (await GET(req('/api/library'), ctx())).json()
    expect(index.projects[0].kinds[0].assets[0].slug).toBe('mossy-stone')

    const metaRes = await GET(req('/api/library/dungeon/tiles/mossy-stone'), ctx(['dungeon', 'tiles', 'mossy-stone']))
    expect(metaRes.status).toBe(200)
    expect((await metaRes.json()).provenance.backend).toBe('apimart')

    const fileRes = await GET(
      req('/api/library/dungeon/tiles/mossy-stone?file=derived/body.png'),
      ctx(['dungeon', 'tiles', 'mossy-stone'])
    )
    expect(fileRes.status).toBe(200)
    expect(fileRes.headers.get('content-type')).toBe('image/png')
    const bytes = Buffer.from(await fileRes.arrayBuffer())
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  })

  it('rejects a deep path when the caller forgot to pass ctx', async () => {
    await POST(save())
    const res = await GET(req('/api/library/dungeon/tiles/mossy-stone'))
    expect(res.status).toBe(400)
  })

  it('never lets the client choose the recorded backend', async () => {
    delete process.env.IE_BACKEND_LABEL
    const forged = { ...meta, provenance: { ...meta.provenance, backend: 'forged' } }
    expect((await POST(req('/api/library', {
      method: 'POST',
      body: JSON.stringify({ project: 'dungeon', kind: 'tiles', slug: 'mossy-stone', meta: forged, files: { 'derived/body.png': PNG } }),
    }))).status).toBe(201)

    const metaRes = await GET(req('/api/library/dungeon/tiles/mossy-stone'), ctx(['dungeon', 'tiles', 'mossy-stone']))
    expect((await metaRes.json()).provenance.backend).toBe('openrouter')
  })

  it('rejects invalid names and traversal with 400 and writes nothing', async () => {
    const bodies = [
      { project: '../etc', kind: 'tiles', slug: 'x' },
      { project: 'dungeon', kind: 'nope', slug: 'x' },
      { project: 'dungeon', kind: 'tiles', slug: 'x', files: { '../meta.json': PNG } },
    ]
    for (const b of bodies) {
      const res = await POST(save(b))
      expect(res.status, JSON.stringify(b)).toBe(400)
    }
    const index = await (await GET(req('/api/library'), ctx())).json()
    expect(index.projects).toEqual([])
  })

  it('returns 409 on a duplicate and 200 with overwrite', async () => {
    expect((await POST(save())).status).toBe(201)
    expect((await POST(save())).status).toBe(409)
    expect((await POST(save({ overwrite: true }))).status).toBe(200)
  })

  it('returns 500 when the asset root is not usable', async () => {
    process.env.IE_ASSETS_DIR = '/dev/null/nope'
    const res = await POST(save())
    expect(res.status).toBe(500)
  })

  it('404s an unknown asset and deletes an existing one', async () => {
    expect((await GET(req('/api/library/dungeon/tiles/nope'), ctx(['dungeon', 'tiles', 'nope']))).status).toBe(404)
    await POST(save())
    expect((await DELETE(req('/api/library/dungeon/tiles/mossy-stone'), ctx(['dungeon', 'tiles', 'mossy-stone']))).status).toBe(204)
    expect((await GET(req('/api/library/dungeon/tiles/mossy-stone'), ctx(['dungeon', 'tiles', 'mossy-stone']))).status).toBe(404)
  })
})
