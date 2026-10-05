'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  assetFileUrl,
  deleteAsset,
  fetchIndex,
  saveAsset,
  LibraryRequestError,
} from '@/app/lib/libraryClient'
import type { AssetKind, AssetMeta, LibraryIndex } from '@/app/lib/libraryTypes'
import { slugify, type CollectedAsset } from '@/app/lib/libraryCollect'

export type LibraryPanelProps = {
  /** What the current studio would save, or null when there is nothing. */
  pending: (() => Promise<CollectedAsset | null>) | null
  /** Default project name, remembered across sessions. */
  project: string
  onProjectChange: (project: string) => void
  /** Load a stored PNG back into the active studio. */
  onLoad: (url: string) => void
  /** Report a saved asset id so the studio can mark it as stored. */
  onSaved?: (id: string) => void
}

const KIND_LABEL: Record<AssetKind, string> = {
  tiles: 'Tiles',
  sprites: 'Sprites',
  props: 'Props',
  parallax: 'Parallax',
  extend: 'Extender',
}

/**
 * Asset library browser. A consumer of /api/library that holds no asset state
 * of its own beyond the index it just fetched.
 */
export default function LibraryPanel({
  pending,
  project,
  onProjectChange,
  onLoad,
  onSaved,
}: LibraryPanelProps) {
  const [index, setIndex] = useState<LibraryIndex | null>(null)
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [dialog, setDialog] = useState<{ kind: AssetKind; slug: string } | null>(null)
  const [conflict, setConflict] = useState(false)

  const refresh = useCallback(async () => {
    if (!pending) return
    try {
      setIndex(await fetchIndex())
      setError('')
    } catch (err) {
      setIndex(null)
      setError(err instanceof LibraryRequestError ? err.message : 'asset library unavailable')
    }
  }, [pending])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const beginSave = async () => {
    setConflict(false)
    const collected = pending ? await pending() : null
    if (!collected) {
      setStatus('Nothing to save yet — generate something first.')
      return
    }
    setStatus('')
    setDialog({ kind: collected.kind, slug: slugify(collected.provenance.prompt || collected.kind) })
  }

  const commitSave = async (overwrite: boolean) => {
    if (!dialog) return
    const collected = pending ? await pending() : null
    if (!collected) return
    const now = new Date().toISOString()
    const meta: AssetMeta = {
      schemaVersion: 1,
      type: typeof collected.manifest?.type === 'string' ? collected.manifest.type : `${collected.kind}-set`,
      project,
      kind: collected.kind,
      slug: dialog.slug,
      createdAt: now,
      updatedAt: now,
      manifest: collected.manifest,
      files: {
        sheet: Object.keys(collected.files).find((f) => f.startsWith('raw/')) ?? null,
        derived: Object.keys(collected.files)
          .filter((f) => f.startsWith('derived/'))
          .sort(),
      },
      // `backend` and `toolVersion` are completed server-side; these values are
      // placeholders the route overwrites.
      provenance: { ...collected.provenance, backend: 'openrouter', toolVersion: 'web' },
    }
    setStatus('Saving…')
    setError('')
    try {
      const res = await saveAsset({
        project,
        kind: collected.kind,
        slug: dialog.slug,
        meta,
        files: collected.files,
        overwrite,
      })
      onSaved?.(res.path)
      setStatus(`Saved ${res.path}`)
      setDialog(null)
      setConflict(false)
      await refresh()
    } catch (err) {
      if (err instanceof LibraryRequestError && err.status === 409) {
        setConflict(true)
        setError(`“${dialog.slug}” already exists in ${project}.`)
        return
      }
      setError(err instanceof Error ? err.message : 'save failed')
    }
  }

  const remove = async (kind: AssetKind, slug: string) => {
    try {
      await deleteAsset(project, kind, slug)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium">Asset library</span>
        <input
          aria-label="project"
          value={project}
          onChange={(e) => onProjectChange(slugify(e.target.value))}
          className="w-28 rounded bg-white/5 px-2 py-0.5 text-xs"
        />
        <button
          type="button"
          onClick={() => void beginSave()}
          disabled={!pending}
          className="rounded bg-white/10 px-2 py-0.5 text-xs disabled:opacity-40"
        >
          Save to library
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded bg-white/5 px-2 py-0.5 text-xs"
        >
          Refresh
        </button>
      </div>

      {status && <p className="text-xs text-white/60">{status}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {dialog && (
        <div className="my-2 rounded border border-white/10 p-2">
          <label className="text-xs">
            Slug
            <input
              aria-label="slug"
              value={dialog.slug}
              onChange={(e) => setDialog({ ...dialog, slug: slugify(e.target.value) })}
              className="ml-2 rounded bg-white/5 px-2 py-0.5"
            />
          </label>
          <div className="mt-2 flex gap-2">
            {conflict ? (
              <>
                <button
                  type="button"
                  className="rounded bg-amber-500/20 px-2 py-0.5 text-xs"
                  onClick={() => void commitSave(true)}
                >
                  Overwrite
                </button>
                <button
                  type="button"
                  className="rounded bg-white/5 px-2 py-0.5 text-xs"
                  onClick={() => setDialog({ ...dialog, slug: slugify(`${dialog.slug}-v2`) })}
                >
                  Save as {slugify(`${dialog.slug}-v2`)}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="rounded bg-white/10 px-2 py-0.5 text-xs"
                onClick={() => void commitSave(false)}
              >
                Save
              </button>
            )}
            <button
              type="button"
              className="rounded bg-white/5 px-2 py-0.5 text-xs"
              onClick={() => {
                setDialog(null)
                setConflict(false)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {index?.projects.map((p) => (
        <div key={p.name} className="mt-2">
          <div className="text-xs uppercase tracking-wide text-white/40">{p.name}</div>
          {p.kinds.map((k) => (
            <div key={k.name} className="mt-1">
              <div className="text-xs text-white/60">{KIND_LABEL[k.name]}</div>
              <ul className="flex flex-wrap gap-2">
                {k.assets.map((a) => (
                  <li key={a.slug} className="flex items-center gap-1 rounded bg-white/5 p-1">
                    {a.derived[0] && (
                      // eslint-disable-next-line @next/next/no-img-element -- same-origin route, no Next image loader needed
                      <img
                        src={assetFileUrl(p.name, k.name, a.slug, a.derived[0])}
                        alt={a.slug}
                        width={40}
                        height={40}
                        className="h-10 w-10 object-contain"
                      />
                    )}
                    <button
                      type="button"
                      className="text-xs"
                      onClick={() =>
                        a.derived[0] && onLoad(assetFileUrl(p.name, k.name, a.slug, a.derived[0]))
                      }
                    >
                      {a.slug}
                    </button>
                    <button
                      type="button"
                      aria-label={`delete ${a.slug}`}
                      className="text-xs text-white/40 hover:text-red-400"
                      onClick={() => void remove(k.name, a.slug)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}

      {index && index.warnings.length > 0 && (
        <p className="mt-2 text-xs text-amber-400">{index.warnings.join('; ')}</p>
      )}
    </div>
  )
}
