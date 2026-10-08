'use client'
import { translateServerError } from '@/app/i18n/serverErrors'

import { useCallback, useEffect, useState } from 'react'
import {
  assetFileUrl,
  deleteAsset,
  fetchIndex,
  saveAsset,
  LibraryRequestError,
} from '@/app/lib/libraryClient'
import type { AssetKind, LibraryIndex } from '@/app/lib/libraryTypes'
import { buildAssetMeta, slugify, type CollectedAsset } from '@/app/lib/libraryCollect'
import { useI18n } from '@/app/lib/i18n'

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

const KIND_KEY: Record<AssetKind, string> = {
  tiles: 'shell.library.kind.tiles',
  sprites: 'shell.library.kind.sprites',
  props: 'shell.library.kind.props',
  parallax: 'shell.library.kind.parallax',
  extend: 'shell.library.kind.extend',
  animations: 'shell.library.kind.animations',
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
  const { t } = useI18n()
  const [index, setIndex] = useState<LibraryIndex | null>(null)
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [dialog, setDialog] = useState<{ slug: string } | null>(null)
  const [conflict, setConflict] = useState(false)
  const [staged, setStaged] = useState<CollectedAsset | null>(null)

  const refresh = useCallback(async () => {
    try {
      setIndex(await fetchIndex())
      setError('')
    } catch (err) {
      setIndex(null)
      // Route errors are server-authored English; translateServerError maps the
      // app's own ones onto the active locale (unknown text passes through).
      setError(
        err instanceof LibraryRequestError
          ? translateServerError(err.message, t)
          : t('shell.library.unavailable')
      )
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const beginSave = async () => {
    setConflict(false)
    const collected = pending ? await pending() : null
    if (!collected) {
      setStatus(t('shell.library.nothingToSave'))
      return
    }
    setStaged(collected)
    setStatus('')
    setDialog({ slug: slugify(collected.provenance.prompt || collected.kind) })
  }

  const commitSave = async (overwrite: boolean, slugOverride?: string) => {
    const slug = slugOverride ?? dialog?.slug
    if (!dialog || !slug || !staged) return
    const meta = buildAssetMeta(staged, { project, slug })
    setStatus(t('shell.library.saving'))
    setError('')
    try {
      const res = await saveAsset({
        project,
        kind: staged.kind,
        slug,
        meta,
        files: staged.files,
        overwrite,
      })
      onSaved?.(res.path)
      setStatus(t('shell.library.saved', { path: res.path }))
      setDialog(null)
      setConflict(false)
      setStaged(null)
      await refresh()
    } catch (err) {
      if (err instanceof LibraryRequestError && err.status === 409) {
        setConflict(true)
        setError(t('shell.library.exists', { slug, project }))
        return
      }
      setError(err instanceof Error ? translateServerError(err.message, t) : t('shell.library.saveFailed'))
    }
  }

  const remove = async (kind: AssetKind, slug: string) => {
    try {
      await deleteAsset(project, kind, slug)
      setStaged(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? translateServerError(err.message, t) : t('shell.library.deleteFailed'))
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium">{t('shell.library.title')}</span>
        <input
          aria-label={t('shell.library.projectAria')}
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
          {t('shell.library.save')}
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded bg-white/5 px-2 py-0.5 text-xs"
        >
          {t('shell.library.refresh')}
        </button>
      </div>

      {status && <p className="text-xs text-white/60">{status}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {dialog && (
        <div className="my-2 rounded border border-white/10 p-2">
          <label className="text-xs">
            {t('shell.library.slug')}
            <input
              aria-label={t('shell.library.slugAria')}
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
                  {t('shell.library.overwrite')}
                </button>
                <button
                  type="button"
                  className="rounded bg-white/5 px-2 py-0.5 text-xs"
                  onClick={() => void commitSave(false, slugify(`${dialog.slug}-v2`))}
                >
                  {t('shell.library.saveAs', { slug: slugify(`${dialog.slug}-v2`) })}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="rounded bg-white/10 px-2 py-0.5 text-xs"
                onClick={() => void commitSave(false)}
              >
                {t('common.action.save')}
              </button>
            )}
            <button
              type="button"
              className="rounded bg-white/5 px-2 py-0.5 text-xs"
              onClick={() => {
                setDialog(null)
                setConflict(false)
                setStaged(null)
              }}
            >
              {t('common.action.cancel')}
            </button>
          </div>
        </div>
      )}

      {index?.projects.map((p) => (
        <div key={p.name} className="mt-2">
          <div className="text-xs uppercase tracking-wide text-white/40">{p.name}</div>
          {p.kinds.map((k) => (
            <div key={k.name} className="mt-1">
              <div className="text-xs text-white/60">{t(KIND_KEY[k.name])}</div>
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
                      aria-label={t('shell.library.deleteAria', { slug: a.slug })}
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
