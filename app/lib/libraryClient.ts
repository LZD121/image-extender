import type { AssetMeta, LibraryIndex } from '@/app/lib/libraryTypes'

/**
 * Browser-side wrapper around /api/library. The UI never builds a URL by hand
 * and never touches the filesystem.
 *
 * Named `LibraryRequestError` on purpose: `app/lib/library.ts` already exports
 * a `LibraryError` for the server-side fs layer, and they mean different
 * things (an HTTP outcome vs a typed fs failure).
 */
export class LibraryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'LibraryRequestError'
  }
}

async function toError(res: Response): Promise<LibraryRequestError> {
  let message = `HTTP ${res.status}`
  try {
    const body = await res.json()
    if (body?.error) message = body.error
  } catch {
    /* keep the status text */
  }
  return new LibraryRequestError(message, res.status)
}

export async function fetchIndex(): Promise<LibraryIndex> {
  const res = await fetch('/api/library', { cache: 'no-store' })
  if (!res.ok) throw await toError(res)
  return res.json()
}

/** Same-origin URL for a stored file — safe to draw into a canvas. */
export function assetFileUrl(project: string, kind: string, slug: string, rel: string): string {
  return `/api/library/${project}/${kind}/${slug}?file=${encodeURIComponent(rel)}`
}

export async function saveAsset(payload: {
  project: string
  kind: string
  slug: string
  meta: AssetMeta
  files: Record<string, string>
  overwrite?: boolean
}): Promise<{ path: string; written: string[] }> {
  const res = await fetch('/api/library', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw await toError(res)
  return res.json()
}

export async function deleteAsset(project: string, kind: string, slug: string): Promise<void> {
  const res = await fetch(`/api/library/${project}/${kind}/${slug}`, { method: 'DELETE' })
  if (!res.ok) throw await toError(res)
}
