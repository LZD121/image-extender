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
import LibraryPanel from '@/app/components/LibraryPanel'
import type { CollectedAsset } from '@/app/lib/libraryCollect'

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
  const [project, setProject] = useState('')

  useEffect(() => {
    setKey(readPixelKey())
  }, [])

  useEffect(() => {
    try {
      setProject(localStorage.getItem(PIXEL_PROJECT_STORAGE) ?? 'default')
    } catch {
      setProject('default')
    }
  }, [])

  useEffect(() => {
    if (!project) return
    try {
      localStorage.setItem(PIXEL_PROJECT_STORAGE, project)
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
      setError('粘贴 PixelLab key。')
      return
    }
    if (!description.trim()) {
      setError('先描述这个角色。')
      return
    }
    setBusy('提交角色（8 方向，约 2–5 分钟）…')
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
          setError(`角色生成失败（character_id=${characterId}）；不会自动重试。`)
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
          setError(`轮询超时（10 分钟）。character_id=${characterId} —— 用“再查一次”继续，不要重新提交。`)
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

  /** Analyse a source image; decimate + crop when the gate passes. */
  const process = useCallback(
    async (candidate: Candidate, force = false) => {
      const apply = async (buf: PixelBuffer) => {
        const analysis = analyzeGrid(buf, block)
        const shouldApply = force || analysis.ok
        let processedUrl: string | null = null
        let figure: { width: number; height: number } | null = null
        let warnings: string[] = []
        if (shouldApply) {
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
        <button
          type="button"
          onClick={() => void (sub === 'stills' ? submit() : generateCharacter())}
          disabled={busy !== null}
          className="rounded bg-white/10 px-3 py-1"
        >
          {busy ?? (sub === 'stills' ? 'Generate' : 'Generate character (8 dirs)')}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {candidates.map((c) => (
          <div key={c.id} className="rounded border border-white/10 p-2">
            <img
              src={showProcessed[c.id] && c.processedUrl ? c.processedUrl : c.sourceUrl}
              alt={c.label}
              className="w-full [image-rendering:pixelated]"
            />
            <p className="mt-1 truncate text-[10px] text-white/60">{c.label}</p>
            {c.analysis && (
              <p className={`mt-1 text-[10px] ${c.analysis.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                block={c.analysis.block} phase=({c.analysis.ox},{c.analysis.oy}) purity={c.analysis.purity.toFixed(4)}
                {c.analysis.ok ? ' ✓' : ' ✗ 未通过格点检测'}
              </p>
            )}
            {c.figure && (
              <p className="text-[10px] text-white/40">
                figure {c.figure.width}x{c.figure.height}
              </p>
            )}
            {c.warnings.map((w) => (
              <p key={w} className="text-[10px] text-amber-400">
                {w}
              </p>
            ))}
            <div className="mt-1 flex gap-1">
              <button
                type="button"
                onClick={() => setShowProcessed((s) => ({ ...s, [c.id]: !s[c.id] }))}
                disabled={!c.processedUrl}
                className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] disabled:opacity-40"
              >
                {showProcessed[c.id] ? 'source' : 'processed'}
              </button>
              {c.analysis && !c.analysis.ok && (
                <button
                  type="button"
                  onClick={() => void process(c, true)}
                  className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px]"
                >
                  仍然施加
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-white/40">
        Figure band {DEFAULT_FIGURE_BAND.min}-{DEFAULT_FIGURE_BAND.max}px on a {cell}px cell.
      </p>

      <div className="rounded border border-white/10 p-2">
        <p className="mb-2 text-xs text-white/60">
          保存到资产库（成品才会入库；source 原图存进 raw/）
        </p>
        <LibraryPanel
          pending={async () => collect()}
          project={project}
          onProjectChange={setProject}
          onLoad={(url) => {
            // 库里存的是已完成资产：只展示，不再走一次 decimate —— 再抽一次会把图毁掉。
            setCandidates((prev) => [
              { id: `lib-${Date.now()}`, label: 'from library', sourceUrl: url, analysis: null, processedUrl: null, figure: null, warnings: [] },
              ...prev,
            ])
          }}
          onSaved={() => setCandidates([])}
        />
      </div>
    </div>
  )
}
