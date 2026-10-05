// app/components/PixelStudio.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  PIXEL_VIEWS,
  PIXEL_TEMPLATES,
  PIXEL_BLOCK_STORAGE,
  PIXEL_CELL_STORAGE,
  PIXEL_PROJECT_STORAGE,
  fetchBalance,
  pixellab,
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
  type GridAnalysis,
  type PixelBuffer,
} from '@/app/utils/pixelGrid'
// Task 8 会往这一行补 analyzeGrid / cropToCell / decimateByMode —— 本任务还不使用它们，先不要提前 import。

type SubMode = 'stills' | 'character'
type StillKind = 'tiles' | 'props'

type Candidate = {
  id: string
  label: string
  sourceUrl: string
  analysis: GridAnalysis | null
  processedUrl: string | null
  figure: { width: number; height: number } | null
  warnings: string[]
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
  const [showProcessed, setShowProcessed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setKey(readPixelKey())
  }, [])

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
      setCandidates((prev) => [
        { id: `${Date.now()}`, label: description.slice(0, 40), sourceUrl: dataUrl, analysis: null, processedUrl: null, figure: null, warnings: [] },
        ...prev,
      ])
      void refreshBalance()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generation failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="password"
          value={key}
          onChange={(e) => rememberKey(e.target.value)}
          placeholder="PixelLab API key"
          className="w-64 rounded bg-white/5 px-2 py-1 text-xs"
        />
        <button type="button" onClick={() => void refreshBalance()} className="rounded bg-white/10 px-2 py-1 text-xs">
          Check balance
        </button>
        {balance && (
          <span className="text-xs text-white/60">
            {balance.plan ?? 'no plan'} · {balance.generations ?? '—'} / {balance.total ?? '—'} generations · ${balance.usd}
          </span>
        )}
      </div>

      <div className="flex gap-2 text-xs">
        {(['stills', 'character'] as SubMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSub(m)}
            className={`rounded px-2 py-1 ${sub === m ? 'bg-white/20' : 'bg-white/5'}`}
          >
            {m === 'stills' ? 'Tiles & props' : 'Character'}
          </button>
        ))}
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="mossy cobblestone, top-down, 12 colours"
        className="h-20 w-full rounded bg-white/5 px-2 py-1 text-xs"
      />

      {sub === 'stills' ? (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <select value={stillKind} onChange={(e) => setStillKind(e.target.value as StillKind)} className="rounded bg-white/5 px-2 py-1">
            <option value="tiles">Tiles</option>
            <option value="props">Props</option>
          </select>
          <label>
            W{' '}
            <input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} className="w-16 rounded bg-white/5 px-1" />
          </label>
          <label>
            H{' '}
            <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} className="w-16 rounded bg-white/5 px-1" />
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={noBackground} onChange={(e) => setNoBackground(e.target.checked)} />
            no background
          </label>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <select value={template} onChange={(e) => setTemplate(e.target.value as PixelTemplate)} className="rounded bg-white/5 px-2 py-1">
            {PIXEL_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={view} onChange={(e) => setView(e.target.value as PixelView)} className="rounded bg-white/5 px-2 py-1">
            {PIXEL_VIEWS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <label>
            size{' '}
            <input type="number" value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-16 rounded bg-white/5 px-1" />
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label>
          block{' '}
          <input type="number" value={block} onChange={(e) => setBlock(Math.max(1, Number(e.target.value)))} className="w-14 rounded bg-white/5 px-1" />
        </label>
        <label>
          cell{' '}
          <input type="number" value={cell} onChange={(e) => setCell(Math.max(8, Number(e.target.value)))} className="w-14 rounded bg-white/5 px-1" />
        </label>
        <button type="button" onClick={() => void submit()} disabled={busy !== null} className="rounded bg-white/10 px-3 py-1">
          {busy ?? 'Generate'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {candidates.map((c) => (
          <div key={c.id} className="rounded border border-white/10 p-2">
            <img src={showProcessed[c.id] && c.processedUrl ? c.processedUrl : c.sourceUrl} alt={c.label} className="w-full [image-rendering:pixelated]" />
            <p className="mt-1 truncate text-[10px] text-white/60">{c.label}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-white/40">
        Figure band {DEFAULT_FIGURE_BAND.min}-{DEFAULT_FIGURE_BAND.max}px on a {cell}px cell.
      </p>
    </div>
  )
}
