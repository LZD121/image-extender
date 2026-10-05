import { NextRequest, NextResponse } from 'next/server'
import { LibraryError, deleteAsset, listAssets, readAssetFile, readMeta, saveAsset } from '@/app/lib/library'
import { isValidKind, isValidName, isValidRelPath } from '@/app/lib/libraryPath'
import type { AssetMeta } from '@/app/lib/libraryTypes'

// fs needs the Node runtime, and the index must never be cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FILE_CHARS = 40 * 1024 * 1024 * 1.4
const MAX_BODY_CHARS = 200 * 1024 * 1024

/** fs failures that mean "the library is not usable", not "your input is bad". */
const UNUSABLE_FS_CODES: Record<string, true> = {
  ENOTDIR: true,
  EACCES: true,
  EROFS: true,
  EISDIR: true,
  ENOENT: true,
  ENOSPC: true,
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function triple(segments: string[] | undefined) {
  if (!segments || segments.length !== 3) return null
  const [project, kind, slug] = segments
  if (!isValidName(project) || !isValidKind(kind) || !isValidName(slug)) return null
  return { project, kind, slug }
}

export async function GET(request: NextRequest, ctx?: { params?: { path?: string[] } }) {
  const segments = ctx?.params?.path
  if (!segments || segments.length === 0) {
    // /api/library itself is the index; a deeper path without params is a
    // programming error, not an index request.
    if (request.nextUrl.pathname.replace(/\/$/, '') !== '/api/library') {
      return bad('missing route params')
    }
    try {
      return NextResponse.json(await listAssets())
    } catch (err) {
      return NextResponse.json(
        { error: `asset library unavailable: ${(err as Error).message}` },
        { status: 500 }
      )
    }
  }

  const ids = triple(segments)
  if (!ids) return bad('invalid asset path')

  const rel = request.nextUrl.searchParams.get('file')
  if (rel) {
    if (!isValidRelPath(rel)) return bad('invalid file')
    try {
      const bytes = await readAssetFile(ids.project, ids.kind, ids.slug, rel)
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          'content-type': CONTENT_TYPES[rel.split('.').pop() ?? 'png'] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        },
      })
    } catch {
      return bad('file not found', 404)
    }
  }

  try {
    return NextResponse.json(await readMeta(ids.project, ids.kind, ids.slug))
  } catch {
    return bad('asset not found', 404)
  }
}

export async function POST(request: NextRequest) {
  let payload: {
    project?: string
    kind?: string
    slug?: string
    meta?: AssetMeta
    files?: Record<string, string>
    overwrite?: boolean
  }
  try {
    payload = await request.json()
  } catch {
    return bad('invalid JSON body')
  }

  const { project, kind, slug, meta, files, overwrite } = payload
  if (!isValidName(project)) return bad('invalid project')
  if (!isValidKind(kind)) return bad('invalid kind')
  if (!isValidName(slug)) return bad('invalid slug')
  if (!meta || typeof meta !== 'object') return bad('missing meta')
  if (!files || typeof files !== 'object' || Object.keys(files).length === 0) return bad('missing files')
  for (const [rel, dataUrl] of Object.entries(files)) {
    if (!isValidRelPath(rel)) return bad(`invalid file path: ${rel}`)
    if (typeof dataUrl !== 'string') return bad(`invalid payload for ${rel}`)
    if (dataUrl.length > MAX_FILE_CHARS) return bad(`file too large: ${rel}`, 413)
  }
  const total = Object.values(files).reduce((n, v) => n + v.length, 0)
  if (total > MAX_BODY_CHARS) return bad('request body too large', 413)

  // The backend that actually served the generation is a server-side fact —
  // never trust the client for it.
  const stamped: AssetMeta = {
    ...meta,
    schemaVersion: 1,
    project,
    kind,
    slug,
    updatedAt: new Date().toISOString(),
    provenance: {
      ...meta.provenance,
      backend: process.env.IE_BACKEND_LABEL || 'openrouter',
    },
  }

  try {
    const written = await saveAsset(project, kind, slug, stamped, files, { overwrite })
    return NextResponse.json({ path: `${project}/${kind}/${slug}`, written }, { status: overwrite ? 200 : 201 })
  } catch (err) {
    if (err instanceof LibraryError && err.code === 'EEXISTS') return bad(err.message, 409)
    const code = (err as NodeJS.ErrnoException).code
    if (code && UNUSABLE_FS_CODES[code]) {
      return bad(`asset library unavailable: ${(err as Error).message}`, 500)
    }
    return bad((err as Error).message || 'save failed', 400)
  }
}

export async function DELETE(_request: NextRequest, ctx?: { params?: { path?: string[] } }) {
  const ids = triple(ctx?.params?.path)
  if (!ids) return bad('invalid asset path')
  try {
    await deleteAsset(ids.project, ids.kind, ids.slug)
    return new NextResponse(null, { status: 204 })
  } catch {
    return bad('asset not found', 404)
  }
}
