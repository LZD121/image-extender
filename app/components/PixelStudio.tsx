// app/components/PixelStudio.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  PIXEL_VIEWS,
  PIXEL_TEMPLATES,
  PIXEL_STILL_PRESETS,
  PIXEL_CHARACTER_PRESETS,
  PIXEL_BLOCK_STORAGE,
  PIXEL_CELL_STORAGE,
  fetchBalance,
  pixellab,
  proxiedImageUrl,
  readPixelKey,
  readStoredNumber,
  writePixelKey,
  writeStoredNumber,
  type PixelBalance,
  type PixelTemplate,
  type PixelView,
} from '@/app/lib/pixel'
import {
  DEFAULT_BLOCK,
  DEFAULT_CELL,
  DEFAULT_FIGURE_BAND,
  analyzeGrid,
  cropToCell,
  decimateByMode,
  type GridAnalysis,
  type PixelBuffer,
} from '@/app/utils/pixelGrid'
import { Icons } from '@/app/components/icons'
import LibraryPanel from '@/app/components/LibraryPanel'
import type { CollectedAsset } from '@/app/lib/libraryCollect'
import { LIBRARY_PROJECT_STORAGE } from '@/app/lib/app'

type SubMode = 'stills' | 'character'
type StillKind = 'tiles' | 'props'

type Candidate = {
  id: string
  label: string
  /** Raw vendor output — the thing before the lattice is imposed. */
  sourceUrl: string
  analysis: GridAnalysis | null
  /** Decimated + crop-to-cell result. Null until `process` finishes. */
  processedUrl: string | null
  figure: { width: number; height: number } | null
  warnings: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared inline styles — the same tokens the other five studios spell out at
// each call site. Hoisted here because the pixel studio uses them repeatedly.
// ─────────────────────────────────────────────────────────────────────────────

const CARD = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--border-strong)',
  boxShadow: '0 8px 24px -8px rgba(0,0,0,0.5)',
} as const

const NUMBER_FIELD = {
  width: 76,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
} as const

const SELECT_FIELD = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
} as const

const SECTION_LABEL = 'text-[11px] font-medium uppercase tracking-wider'

const EMPTY_CELL_BG =
  'repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.025) 6px 12px)'

/** A labelled number input — one shape for W/H, size, block, cell. */
function NumberField({
  label,
  value,
  min,
  max,
  title,
  onChange,
}: {
  label: string
  value: number
  min: number
  max?: number
  title: string
  onChange: (n: number) => void
}) {
  return (
    <label
      className="flex items-center gap-1.5 text-[11px]"
      style={{ color: 'var(--text-muted)' }}
      title={title}
    >
      <span className="uppercase tracking-wider">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="px-2 py-1 font-mono text-[12px]"
        style={NUMBER_FIELD}
      />
    </label>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Gallery cell — one candidate, previewing either the imposed-lattice asset or
// the raw vendor output, with download / drop on hover.
// ─────────────────────────────────────────────────────────────────────────────

function PixelCandidateCell({
  candidate,
  showSource,
  onToggleSource,
  onRemove,
}: {
  candidate: Candidate
  showSource: boolean
  onToggleSource: () => void
  onRemove: () => void
}) {
  const showingProcessed = !showSource && !!candidate.processedUrl
  const src = showingProcessed ? (candidate.processedUrl as string) : candidate.sourceUrl

  const download = () => {
    const name = candidate.label.trim().replace(/[^\w.-]+/g, '_').slice(0, 48) || 'pixel'
    const link = document.createElement('a')
    link.href = candidate.processedUrl ?? candidate.sourceUrl
    link.download = `${name}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div
      className="group flex flex-col overflow-hidden rounded-[var(--radius-md)] anim-fade"
      style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
    >
      <div className="checker relative" style={{ aspectRatio: '1 / 1' }}>
        <img
          src={src}
          alt={candidate.label}
          draggable={false}
          className="block h-full w-full [image-rendering:pixelated]"
          style={{ objectFit: 'contain' }}
        />
        <div
          className="pointer-events-none absolute left-1 top-1 rounded px-1 py-px font-mono text-[9px]"
          style={{
            background: 'rgba(0,0,0,0.45)',
            color: 'var(--text-secondary)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {candidate.analysis
            ? `block ${candidate.analysis.block} · ${candidate.figure ? `${candidate.figure.width}×${candidate.figure.height}` : 'no figure'}`
            : 'analysing…'}
        </div>
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={download}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full"
            style={{
              background: 'rgba(0,0,0,0.6)',
              color: 'var(--accent)',
              backdropFilter: 'blur(4px)',
            }}
            title="Download this asset as a PNG"
          >
            <Icons.Download size={11} />
          </button>
          <button
            onClick={onRemove}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full"
            style={{
              background: 'rgba(0,0,0,0.6)',
              color: 'var(--danger, #ff6b6b)',
              backdropFilter: 'blur(4px)',
            }}
            title="Drop this asset from the gallery"
          >
            <Icons.Trash size={11} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 px-2 py-1.5">
        <p className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }} title={candidate.label}>
          {candidate.label}
        </p>
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {candidate.analysis ? `purity ${candidate.analysis.purity.toFixed(4)}` : '—'}
          </span>
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {candidate.analysis ? `(${candidate.analysis.ox},${candidate.analysis.oy})` : ''}
          </span>
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onToggleSource}
            disabled={!candidate.processedUrl}
            className="rounded-full px-1.5 py-px font-mono text-[9px] transition-colors disabled:opacity-40"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--bg-elev)',
              color: showingProcessed ? 'var(--text-muted)' : 'var(--accent)',
            }}
            title={
              !candidate.processedUrl
                ? 'No processed version for this asset'
                : showingProcessed
                  ? 'Show the raw vendor output'
                  : 'Show the processed asset'
            }
          >
            {showingProcessed ? 'processed' : 'source'}
          </button>
        </div>
        {candidate.warnings.map((w, i) => (
          <p key={`${i}-${w}`} className="text-[10px] text-amber-400">
            {w}
          </p>
        ))}
      </div>
    </div>
  )
}

/** Browser-only glue: decode an image into a plain buffer. */
async function loadPixels(url: string): Promise<PixelBuffer> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`could not load ${url}`))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: data.data, width: data.width, height: data.height }
}

/** Browser-only glue: buffers back to a PNG data URL. */
function pixelsToDataUrl(buf: PixelBuffer): string {
  const canvas = document.createElement('canvas')
  canvas.width = buf.width
  canvas.height = buf.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  const image = new ImageData(new Uint8ClampedArray(buf.data), buf.width, buf.height)
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

export function PixelStudio() {
  const [sub, setSub] = useState<SubMode>('stills')
  const [stillKind, setStillKind] = useState<StillKind>('tiles')
  const [description, setDescription] = useState('')
  const [width, setWidth] = useState(64)
  const [height, setHeight] = useState(64)
  const [noBackground, setNoBackground] = useState(true)
  const [template, setTemplate] = useState<PixelTemplate>('mannequin')
  const [view, setView] = useState<PixelView>('high top-down')
  const [size, setSize] = useState(64)
  const [block, setBlock] = useState(() => readStoredNumber(PIXEL_BLOCK_STORAGE, DEFAULT_BLOCK))
  const [cell, setCell] = useState(() => readStoredNumber(PIXEL_CELL_STORAGE, DEFAULT_CELL))
  const [key, setKey] = useState('')
  const [balance, setBalance] = useState<PixelBalance | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSource, setShowSource] = useState<Record<string, boolean>>({})
  const [project, setProject] = useState('')

  useEffect(() => {
    setKey(readPixelKey())
  }, [])

  useEffect(() => {
    try {
      setProject(localStorage.getItem(LIBRARY_PROJECT_STORAGE) ?? 'default')
    } catch {
      setProject('default')
    }
  }, [])

  useEffect(() => {
    if (!project) return
    try {
      localStorage.setItem(LIBRARY_PROJECT_STORAGE, project)
    } catch {
      /* ignore */
    }
  }, [project])

  useEffect(() => {
    writeStoredNumber(PIXEL_BLOCK_STORAGE, block)
  }, [block])

  useEffect(() => {
    writeStoredNumber(PIXEL_CELL_STORAGE, cell)
  }, [cell])

  const rememberKey = (value: string) => {
    setKey(value)
    writePixelKey(value)
  }

  const refreshBalance = useCallback(async () => {
    if (!key) return
    try {
      setBalance(await fetchBalance(key))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'balance failed')
    }
  }, [key])

  const POLL_EVERY_MS = 5000
  const POLL_LIMIT_MS = 10 * 60 * 1000

  const generateCharacter = async () => {
    setError(null)
    if (!key) {
      setError('Paste your PixelLab key first.')
      return
    }
    if (!description.trim()) {
      setError('Describe the character first.')
      return
    }
    setBusy('Submitting the character job (8 directions, ~2–5 min)…')
    let characterId: string
    try {
      const created = await pixellab.createCharacter({ description, template, view, size, seed: null }, key)
      characterId = created.characterId
    } catch (err) {
      setError(err instanceof Error ? err.message : 'character submit failed')
      setBusy(null)
      return
    }

    const startedAt = Date.now()
    try {
      for (;;) {
        const job = await pixellab.pollCharacter(characterId, key)
        if (job.status === 'failed') {
          setError(`The character job failed (character_id=${characterId}). It is not retried automatically.`)
          return
        }
        if (job.status === 'completed' && job.images.length > 0) {
          const made: Candidate[] = job.images.map((url, i) => ({
            id: `${characterId}-${i}`,
            label: `${description.slice(0, 24)} #${i}`,
            sourceUrl: proxiedImageUrl(url),
            analysis: null,
            processedUrl: null,
            figure: null,
            warnings: [],
          }))
          setCandidates((prev) => [...made, ...prev])
          for (const candidate of made) await process(candidate)
          void refreshBalance()
          return
        }
        if (Date.now() - startedAt > POLL_LIMIT_MS) {
          setError(`Still polling after 10 minutes (character_id=${characterId}). Re-check the balance and poll again instead of resubmitting.`)
          return
        }
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, POLL_EVERY_MS)
        await promise
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'polling failed')
    } finally {
      setBusy(null)
    }
  }

  /** Only candidates with a processed image can be saved. */
  const collect = useCallback((): CollectedAsset | null => {
    const ready = candidates.filter((c) => c.processedUrl)
    if (ready.length === 0) return null
    const kind = sub === 'character' ? 'sprites' : stillKind
    const files: Record<string, string> = {}
    const first = ready[0]
    files['raw/source.png'] = first.sourceUrl
    if (sub === 'character') {
      ready.forEach((c, i) => {
        files[`derived/dir_${String(i).padStart(2, '0')}.png`] = c.processedUrl as string
      })
    } else {
      files['derived/cell.png'] = first.processedUrl as string
    }
    return {
      kind,
      files,
      manifest: null,
      provenance: {
        backend: 'pixellab',
        model: sub === 'character' ? 'create-character-v3' : 'create-image-pixflux',
        prompt: description || null,
        sceneBrief: null,
        artStyle: null,
        params: sub === 'character' ? { template, view, size } : { width, height, no_background: noBackground, block, cell },
        requested: sub === 'character' ? `${size}x${size}` : `${width}x${height}`,
        returned: first.figure ? `${first.figure.width}x${first.figure.height}` : null,
        cost: null,
      },
    }
  }, [candidates, sub, stillKind, description, template, view, size, width, height, noBackground, block, cell])

  /**
   * Analyse a source image, then impose the lattice: decimate by the detected
   * phase and crop to the cell. Purity is reported, never gated — it measures
   * how lossy the imposition is, and vendor output is 1px-grain by nature, so
   * gating on it would block most real assets.
   */
  const process = useCallback(
    async (candidate: Candidate) => {
      const apply = async (buf: PixelBuffer) => {
        const analysis = analyzeGrid(buf, block)
        let processedUrl: string | null = null
        let figure: { width: number; height: number } | null = null
        let warnings: string[] = []
        const decimated = decimateByMode(buf, analysis.block, analysis.ox, analysis.oy)
        try {
          const cropped = cropToCell(decimated, {
            cell,
            minFigureHeight: DEFAULT_FIGURE_BAND.min,
            maxFigureHeight: DEFAULT_FIGURE_BAND.max,
          })
          processedUrl = pixelsToDataUrl(cropped.image)
          figure = cropped.figure
          warnings = cropped.warnings
        } catch (err) {
          warnings = [err instanceof Error ? err.message : 'crop failed']
        }
        setCandidates((prev) =>
          prev.map((x) => (x.id === candidate.id ? { ...x, analysis, processedUrl, figure, warnings } : x)),
        )
      }
      try {
        const buf = await loadPixels(candidate.sourceUrl)
        await apply(buf)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'could not read the image')
      }
    },
    [block, cell],
  )

  const submit = async () => {
    setError(null)
    if (!key) {
      setError('Paste your PixelLab key first.')
      return
    }
    if (!description.trim()) {
      setError('Describe what to draw.')
      return
    }
    setBusy('Submitting…')
    try {
      const { dataUrl } = await pixellab.generateImage(
        { description, width, height, noBackground, seed: null },
        key,
      )
      const candidate: Candidate = {
        id: `${Date.now()}`,
        label: description.slice(0, 40),
        sourceUrl: dataUrl,
        analysis: null,
        processedUrl: null,
        figure: null,
        warnings: [],
      }
      setCandidates((prev) => [candidate, ...prev])
      await process(candidate)
      void refreshBalance()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generation failed')
    } finally {
      setBusy(null)
    }
  }

  const runGeneration = async () => {
    if (sub === 'stills') await submit()
    else await generateCharacter()
  }

  const readyCount = candidates.filter((c) => c.processedUrl).length
  const hasAny = candidates.length > 0
  const presets = sub === 'stills' ? PIXEL_STILL_PRESETS : PIXEL_CHARACTER_PRESETS
  const generateLabel =
    sub === 'stills'
      ? stillKind === 'tiles'
        ? 'Generate tile'
        : 'Generate prop'
      : 'Generate character (8 dirs)'

  return (
    <>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3 sm:px-6">
        <div className="flex items-center justify-center gap-2 text-center text-[12px]">
          <Icons.Pixel size={14} className="text-[color:var(--accent)]" />
          <span style={{ color: 'var(--text-secondary)' }}>
            Pixel mode — PixelLab paints on a real pixel grid (its own key, billed
            separately). Every result is re-imposed on the block lattice below so
            it lands on the same grid as the rest of your corpus.
          </span>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => void runGeneration()}
            disabled={busy !== null || !key || !description.trim()}
            className="btn btn-primary"
            title={
              !key
                ? 'Paste your PixelLab key first'
                : !description.trim()
                  ? 'Describe what to draw first'
                  : sub === 'stills'
                    ? 'Paint one pixel-art asset with the pixflux model'
                    : 'Paint a full 8-direction character (one job, ~2–5 minutes)'
            }
          >
            {busy ? <Icons.Spinner size={14} /> : <Icons.Sparkle size={14} />}
            {busy ?? generateLabel}
          </button>
          <button
            onClick={() => setCandidates([])}
            disabled={!hasAny || busy !== null}
            className="btn btn-ghost"
            title="Drop every asset from the gallery (nothing is saved until you save it to the library)"
          >
            <Icons.Trash size={14} />
            Clear
          </button>
          <div
            className="rounded-full border px-2.5 py-1 font-mono text-[11px]"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-elev)',
              color: hasAny ? 'var(--text-secondary)' : 'var(--text-muted)',
            }}
          >
            {readyCount}/{candidates.length} processed
          </div>
        </div>

        {error && (
          <p
            className="mx-auto w-full max-w-3xl text-[12px]"
            style={{ color: 'var(--danger)' }}
            role="alert"
          >
            {error}
          </p>
        )}

        {/* Gallery */}
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
          <div className={SECTION_LABEL} style={{ color: 'var(--text-muted)' }}>
            Asset gallery
          </div>
          {candidates.length === 0 ? (
            <div
              className="flex w-full items-center justify-center rounded-[var(--radius-lg)] px-6 py-12 text-center text-[12px]"
              style={{
                border: '1px dashed var(--border)',
                color: 'var(--text-muted)',
                background: EMPTY_CELL_BG,
              }}
            >
              Nothing generated yet. Pick a quick start or describe an asset below,
              then press “{generateLabel}”.
            </div>
          ) : (
            <div
              className="grid w-full"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}
            >
              {candidates.map((c) => (
                <PixelCandidateCell
                  key={c.id}
                  candidate={c}
                  showSource={!!showSource[c.id]}
                  onToggleSource={() => setShowSource((s) => ({ ...s, [c.id]: !s[c.id] }))}
                  onRemove={() => setCandidates((prev) => prev.filter((x) => x.id !== c.id))}
                />
              ))}
            </div>
          )}
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            The card shows the asset on the imposed lattice; hover it to flip back
            to the raw vendor output, download it, or drop it. The block badge is
            the lattice and figure size it was fitted to.
          </div>
        </div>

        {/* Bottom command rail */}
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          <div className="rounded-[var(--radius-lg)] p-3" style={CARD}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className={`${SECTION_LABEL} flex items-center gap-1.5`} style={{ color: 'var(--text-muted)' }}>
                <Icons.Key size={12} />
                PixelLab key
              </label>
              <button
                type="button"
                onClick={() => void refreshBalance()}
                disabled={!key}
                className="btn btn-ghost h-auto px-2 py-1"
                title="Ask PixelLab for the credit left on this key"
              >
                <Icons.Refresh size={12} />
                Balance
              </button>
            </div>
            <input
              type="password"
              value={key}
              onChange={(e) => rememberKey(e.target.value)}
              placeholder="PixelLab API key — stored in this browser, sent only to the proxy"
              className="field w-full font-mono text-[12px]"
            />
            {balance && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span
                  className="rounded-full border px-2.5 py-1 font-mono text-[11px]"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {balance.plan ?? 'no plan'} · {balance.generations ?? '—'}/{balance.total ?? '—'} generations
                </span>
                <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
                  ${balance.usd}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-[var(--radius-lg)] p-3" style={CARD}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className={SECTION_LABEL} style={{ color: 'var(--text-muted)' }}>
                Generator
              </label>
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {sub === 'stills' ? `${width}×${height} px` : `${size}×${size} px`}
              </span>
            </div>

            {sub === 'stills' ? (
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className="flex items-center gap-0.5 rounded-full p-0.5"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  {(['tiles', 'props'] as StillKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={stillKind === k}
                      onClick={() => setStillKind(k)}
                      className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                      style={{
                        color: stillKind === k ? '#1a1404' : 'var(--text-secondary)',
                        background: stillKind === k ? 'var(--accent)' : 'transparent',
                      }}
                      title={k === 'tiles' ? 'A tileable material cell' : 'A standalone transparent prop'}
                    >
                      {k === 'tiles' ? 'Tiles' : 'Props'}
                    </button>
                  ))}
                </div>
                <NumberField label="W" value={width} min={16} max={400} title="Requested canvas width in pixels (pixflux allows 16–400)" onChange={setWidth} />
                <NumberField label="H" value={height} min={16} max={400} title="Requested canvas height in pixels (pixflux allows 16–400)" onChange={setHeight} />
                <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }} title="Ask the vendor for alpha instead of a filled background">
                  <input type="checkbox" checked={noBackground} onChange={(e) => setNoBackground(e.target.checked)} />
                  no background
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }} title="The skeleton the generator drives — the template outweighs the prompt">
                  <span className="uppercase tracking-wider">Template</span>
                  <select
                    value={template}
                    onChange={(e) => setTemplate(e.target.value as PixelTemplate)}
                    className="select-styled px-2 py-1 text-[12px]"
                    style={SELECT_FIELD}
                  >
                    {PIXEL_TEMPLATES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }} title="Camera angle the 8 rotations are drawn from">
                  <span className="uppercase tracking-wider">View</span>
                  <select
                    value={view}
                    onChange={(e) => setView(e.target.value as PixelView)}
                    className="select-styled px-2 py-1 text-[12px]"
                    style={SELECT_FIELD}
                  >
                    {PIXEL_VIEWS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField label="Size" value={size} min={32} max={256} title="Sprite canvas per direction (v3 allows 32–256)" onChange={setSize} />
              </div>
            )}

            <div className="mt-3 pt-2.5" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <label className={SECTION_LABEL} style={{ color: 'var(--text-muted)' }}>
                  Lattice
                </label>
                <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  figure band {DEFAULT_FIGURE_BAND.min}–{DEFAULT_FIGURE_BAND.max}px on a {cell}px cell
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <NumberField
                  label="Block"
                  value={block}
                  min={1}
                  title="Block size of the corpus lattice (2 = the 2×2 convention). Imposed, not detected — the phase is what gets measured."
                  onChange={(n) => setBlock(Math.max(1, n))}
                />
                <NumberField
                  label="Cell"
                  value={cell}
                  min={8}
                  title="Output cell the cropped figure is centred in"
                  onChange={(n) => setCell(Math.max(8, n))}
                />
                <button
                  type="button"
                  onClick={() => setBlock(DEFAULT_BLOCK)}
                  disabled={block === DEFAULT_BLOCK && cell === DEFAULT_CELL}
                  className="btn btn-ghost h-auto px-2 py-1"
                  title="Back to the corpus defaults (block 2, cell 32)"
                >
                  <Icons.Refresh size={12} />
                  Defaults
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={SECTION_LABEL} style={{ color: 'var(--text-muted)' }}>
              Quick start
            </label>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => {
                const active = description.trim() === preset.prompt
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setDescription(preset.prompt)}
                    disabled={busy !== null}
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent-bg)' : 'var(--bg-elev)',
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                      cursor: busy !== null ? 'not-allowed' : 'pointer',
                      opacity: busy !== null ? 0.5 : 1,
                    }}
                    title={preset.prompt}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div
            className="flex w-full items-stretch gap-2 rounded-[var(--radius-lg)] p-1.5"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--border-strong)',
              boxShadow: '0 12px 32px -12px rgba(0,0,0,0.6)',
            }}
          >
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy !== null}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && description.trim() && !busy) {
                  e.preventDefault()
                  void runGeneration()
                }
              }}
              placeholder={
                sub === 'stills'
                  ? 'Describe the asset — or pick a quick start above'
                  : 'Describe the character — or pick a quick start above'
              }
              className="flex-1 bg-transparent px-3 py-2.5 text-[14px] focus:outline-none"
              style={{ color: 'var(--text)' }}
            />
            <div className="hidden items-center sm:flex" style={{ borderLeft: '1px solid var(--border)' }}>
              <select
                value={sub}
                onChange={(e) => setSub(e.target.value as SubMode)}
                disabled={busy !== null}
                className="select-styled cursor-pointer border-0 bg-transparent py-2 pl-3 pr-7 text-[13px] focus:outline-none"
                style={{ color: 'var(--text-secondary)' }}
                title="What kind of pixel-art asset to generate"
              >
                <option value="stills">Tiles &amp; props</option>
                <option value="character">Character</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Same placement as the other five studios: page.tsx mounts this outside
          them, so pixel mode owns its copy and keeps it here. */}
      <div className="mx-auto w-full max-w-5xl px-4 pb-4">
        <LibraryPanel
          pending={async () => collect()}
          project={project}
          onProjectChange={setProject}
          onLoad={(url) => {
            // The library stores finished assets: show them as-is. Re-decimating
            // one a second time would destroy it.
            setCandidates((prev) => [
              {
                id: `lib-${Date.now()}`,
                label: 'from library',
                sourceUrl: url,
                analysis: null,
                processedUrl: null,
                figure: null,
                warnings: [],
              },
              ...prev,
            ])
          }}
          onSaved={() => setCandidates([])}
        />
      </div>
    </>
  )
}
