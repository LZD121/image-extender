'use client'
// app/lib/usePropStudio.ts
/**
 * The props / decoration studio: its state and its orchestration, behind one
 * hook.
 *
 * Why it exists: the studio's batch handlers and its five pieces of state used
 * to sit in `app/page.tsx`, a client module that every studio shares — so a
 * change to prop generation meant reading a 3,600-line component. What stays in
 * the page is the JSX (the composition root's job) and the wiring of the
 * studio's shared settings into this hook.
 *
 * The open-ended library it drives: each "add more" press paints a fresh batch
 * of PROP_BATCH decorations in one AI call and APPENDS them — existing props
 * are never regenerated. To keep the growing library coherent, every batch
 * (and every single re-roll) is given the current props as a style reference so
 * palette / lighting stay locked while the model invents new decorations.
 *
 * The two-call pipeline per batch: a TEXT art director picks what new props to
 * make (given the biome + everything already in the library, so the set never
 * loops the same lanterns/nests/pots), then the image model paints exactly that
 * list. The director is advisory — a failure falls back to free invention.
 */
import { useRef, useState } from 'react'
import { useI18n } from '@/app/lib/i18n'
import { toWire } from '@/app/lib/generateRequest'
import { studioRequest } from '@/app/lib/studioRequest'
import { downloadText, downloadUrl, downloadZip, type ZipEntry } from '@/app/lib/studioDownload'
import {
  PROP_BATCH,
  PROP_BATCH_COLS,
  PROP_BATCH_H,
  PROP_BATCH_ROWS,
  PROP_BATCH_W,
  PROP_TILE_SIZE,
  PropItem,
  nextPropId,
  propAtlasLayout,
  resolvePropNames,
} from '@/app/lib/props'
import type { ProviderId } from '@/app/lib/providers'
import type { ReportedCost } from '@/app/lib/libraryTypes'
import { buildPropManifest } from '@/app/lib/sheetManifest'
import { CHROMA_PRESETS } from '@/app/lib/chromaPresets'
import {
  chromaKeyToAlpha,
  removeFrameBorder,
  sliceImageGrid,
} from '@/app/utils/imageProcessor'

/** What the props studio needs from the shell it lives in. */
export type PropStudioOptions = {
  apiKey: string
  provider: ProviderId
  model: string
  qaModel: string
  artStyle: string
  sceneBrief: string
  debugMode: boolean
  /** Surface a failure in the app's error banner. */
  setError: (message: string | null) => void
  /** Ask the user for a key when one is needed; false when they decline. */
  ensureCanGenerate: () => boolean
  onNeedsKey: () => void
}

export function usePropStudio({
  apiKey,
  provider,
  model: selectedModel,
  qaModel,
  artStyle,
  sceneBrief,
  debugMode,
  setError,
  ensureCanGenerate,
  onNeedsKey,
}: PropStudioOptions) {
  const { t } = useI18n()
  // Props / decoration state — a sheet of standalone transparent decoration
  // sprites scattered on top of a tile map. Generated in one AI call (like the
  // tile set) so the whole set shares a palette; sliced + chroma-keyed client
  // side. Each prop can be re-rolled individually via a separate call.
  const [propItems, setPropItems] = useState<PropItem[]>([])
  const [propPrompt, setPropPrompt] = useState('')
  const [propSetGenerating, setPropSetGenerating] = useState(false)
  const [propProgressMsg, setPropProgressMsg] = useState<string | null>(null)
  const [lastCost, setLastCost] = useState<ReportedCost | null>(null)
  const propStopRef = useRef(false)

  // Props are colorful (flowers, crystals, mushrooms), so we use a moderate
  // chroma-key rather than the aggressive tile tuning — enough to delete the
  // flat magenta cleanly without eating saturated prop colors. removeFrameBorder
  // then wipes any neighbor bleed that crept into a cell's outer band.
  const PROP_CHROMA_KEY_OPTS = CHROMA_PRESETS.prop

  /** Magenta → alpha for one sliced prop cell, then trim cell-edge bleed. */
  const postProcessProp = async (rawCellUrl: string): Promise<string> => {
    const keyed = await chromaKeyToAlpha(rawCellUrl, PROP_CHROMA_KEY_OPTS)
    try {
      return await removeFrameBorder(keyed)
    } catch {
      return keyed
    }
  }

  /** Compose a REPRESENTATIVE sample of the existing library onto a magenta
   * grid as a STYLE REFERENCE for the next batch — the model matches its
   * palette/lighting but must paint decorations of DIFFERENT kinds. We sample
   * evenly across the WHOLE library (not just the recent batch) so the model
   * can see everything already made and avoid re-painting earlier categories.
   * Drawn on magenta (the key color) so the model reads them in the same
   * convention it must output. Returns undefined if empty. */
  const buildPropStyleRefDataUrl = async (
    items: PropItem[]
  ): Promise<string | undefined> => {
    const all = items.filter((p) => p.imageUrl)
    if (all.length === 0) return undefined
    // This image is a small STYLE ANCHOR — its only job is to lock palette /
    // lighting / rendering, which text can't convey. De-duplication is handled
    // separately by a cheap TEXT name list (see the ITEMS text line), so we keep this
    // tiny and FIXED-SIZE: a 3-col swatch of up to 9 props sampled evenly across
    // the whole library, regardless of how big the library grows.
    const CAP = 9
    let withImg: PropItem[]
    if (all.length <= CAP) {
      withImg = all
    } else {
      withImg = []
      for (let i = 0; i < CAP; i++) {
        withImg.push(all[Math.floor((i * all.length) / CAP)])
      }
    }
    const cell = 200
    const cols = Math.min(3, withImg.length)
    const rows = Math.ceil(withImg.length / cols)
    const canvas = document.createElement('canvas')
    canvas.width = cols * cell
    canvas.height = rows * cell
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.fillStyle = '#FF00FF'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    await Promise.all(
      withImg.map(
        (p, i) =>
          new Promise<void>((resolve) => {
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(img, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell)
              resolve()
            }
            img.onerror = () => resolve()
            img.src = p.imageUrl as string
          })
      )
    )
    return canvas.toDataURL('image/png')
  }

  /** Unique decoration categories already in the library (lowercase). Sent to
   * the art director as the "do not repeat" set. */
  const propCategoriesOf = (items: PropItem[]): string[] => {
    const seen = new Set<string>()
    for (const p of items) {
      const n = (p.name || '').trim().toLowerCase()
      if (n) seen.add(n)
    }
    return Array.from(seen)
  }

  /** CALL #1 of the props pipeline — ask the art-director text model for the
   * next `count` fresh decoration ideas, given everything already made. Returns
   * [] on any failure so callers fall back to free image-model invention. */
  const fetchPropIdeas = async (
    count: number,
    items: PropItem[]
  ): Promise<{ category: string; description: string }[]> => {
    try {
      const data = await studioRequest<{ ideas?: { category: string; description: string }[] }>(
        '/api/prop-brief',
        {
          prompt: propPrompt,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          apiKey: apiKey || undefined,
          provider,
          model: qaModel,
          count,
          existing: propCategoriesOf(items),
        },
        { on401: onNeedsKey }
      )
      return Array.isArray(data.ideas) ? data.ideas : []
    } catch {
      return []
    }
  }

  /** Pack the whole library into one transparent atlas (PROP_ATLAS_COLS wide). */
  const buildPropAtlasDataUrl = async (): Promise<string | null> => {
    const populated = propItems.filter((p) => p.imageUrl)
    if (populated.length === 0) return null
    const layout = propAtlasLayout(populated.length)
    const canvas = document.createElement('canvas')
    canvas.width = layout.width
    canvas.height = layout.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.clearRect(0, 0, layout.width, layout.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    await Promise.all(
      populated.map(
        (p, i) =>
          new Promise<void>((resolve) => {
            const r = layout.rect(i)
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(img, r.x, r.y, r.width, r.height)
              resolve()
            }
            img.onerror = () => resolve()
            img.src = p.imageUrl as string
          })
      )
    )
    return canvas.toDataURL('image/png')
  }

  /** Generate one batch of PROP_BATCH decorations and append them. Used for the
   * first batch AND every "add more" — the model freely invents the items. */
  const handleAddPropBatch = async () => {
    if (propSetGenerating) return
    if (!propPrompt.trim()) {
      setError(t('extender.error.describeBiome'))
      return
    }
    if (!ensureCanGenerate()) return
    setError(null)
    propStopRef.current = false
    setPropSetGenerating(true)
    const startedAt = Date.now()

    // Snapshot existing props for the style reference, then drop in BATCH
    // spinner placeholders so the user sees the new cells filling in.
    const existing = propItems.filter((p) => p.imageUrl)
    const batchIds = Array.from({ length: PROP_BATCH }, () => nextPropId())
    const batchIdSet = new Set(batchIds)
    setPropItems((prev) => [
      ...prev,
      ...batchIds.map((id) => ({ id, imageUrl: null, generating: true })),
    ])

    const propBatchStart = (seconds: number) =>
      t('extender.progress.batchProps', {
        action: existing.length
          ? t('extender.progress.adding')
          : t('extender.progress.generatingAction'),
        count: PROP_BATCH,
        seconds,
      })

    const tickHandle = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setPropProgressMsg(propBatchStart(elapsed))
    }, 1000)

    const dropBatch = () =>
      setPropItems((prev) => prev.filter((p) => !batchIdSet.has(p.id)))

    try {
      const refImage = await buildPropStyleRefDataUrl(existing)

      // CALL #1 — ART DIRECTOR. A text model decides what NEW props to make,
      // given the biome + every category already in the library. This is what
      // keeps the set from looping the same lanterns/nests/pots — a reasoning
      // model deliberately reaches for fresh kinds. Failure is non-fatal: we
      // fall back to letting the image model free-invent.
      setPropProgressMsg(t('extender.progress.planningProps'))
      const ideas = await fetchPropIdeas(PROP_BATCH, existing)
      const briefs = ideas.map((i) => i.description)
      const cats = ideas.map((i) => i.category)

      // CALL #2 — RENDER. The image model paints exactly the art director's
      // list, matched to the style anchor.
      setPropProgressMsg(propBatchStart(0))
      const data = await studioRequest<{ imageUrl?: string; cost?: ReportedCost | null }>(
        '/api/generate',
        toWire({
          kind: 'propSheet',
          prompt: propPrompt,
          width: PROP_BATCH_W,
          height: PROP_BATCH_H,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          apiKey: apiKey || undefined,
          provider,
          model: selectedModel,
          propCols: PROP_BATCH_COLS,
          propRows: PROP_BATCH_ROWS,
          propCount: PROP_BATCH,
          propRefImage: refImage,
          propList: briefs.length ? briefs : undefined,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        }),
        { on401: onNeedsKey, fallbackMessage: t('extender.error.generateProps') }
      )
      if (!data.imageUrl) throw new Error(t('extender.error.noImage'))
      setLastCost(data.cost ?? null)
      if (propStopRef.current) {
        dropBatch()
        return
      }

      setPropProgressMsg(t('extender.progress.slicing'))
      const cells = await sliceImageGrid(data.imageUrl, {
        cols: PROP_BATCH_COLS,
        rows: PROP_BATCH_ROWS,
        cellSize: PROP_TILE_SIZE,
      })
      if (propStopRef.current) {
        dropBatch()
        return
      }

      setPropProgressMsg(t('extender.progress.processing'))
      const processed = await Promise.all(
        batchIds.map(async (_id, i) => {
          const raw = cells[i]
          if (!raw) return null
          try {
            return await postProcessProp(raw)
          } catch {
            return raw
          }
        })
      )
      if (propStopRef.current) {
        dropBatch()
        return
      }

      // Fill placeholders with their result; drop any cell that came back empty.
      // The art director's category list lines up with the cells in reading
      // order, so we tag each prop with the kind the director chose.
      const urlById = new Map<string, string>()
      const nameById = new Map<string, string>()
      batchIds.forEach((id, i) => {
        const url = processed[i]
        if (url) {
          urlById.set(id, url)
          if (cats[i]) nameById.set(id, cats[i])
        }
      })
      setPropItems((prev) =>
        prev
          .map((p) =>
            batchIdSet.has(p.id)
              ? {
                  ...p,
                  imageUrl: urlById.get(p.id) ?? null,
                  name: nameById.get(p.id),
                  generating: false,
                }
              : p
          )
          .filter((p) => !(batchIdSet.has(p.id) && !p.imageUrl))
      )
    } catch (err) {
      dropBatch()
      setError(err instanceof Error ? err.message : t('extender.error.generateProps'))
    } finally {
      clearInterval(tickHandle)
      setPropSetGenerating(false)
      setPropProgressMsg(null)
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      // eslint-disable-next-line no-console
      if (debugMode) console.log(`🌿 Prop batch generated in ${elapsed}s`)
    }
  }

  const handleStopPropSet = () => {
    propStopRef.current = true
  }

  /** Re-roll a single prop in place — a new decoration matched to the rest of
   * the library's style (the other props are passed as a reference). */
  const handleRegenerateProp = async (id: string) => {
    if (propSetGenerating) return
    if (!propPrompt.trim()) {
      setError(t('extender.error.describeBiomeFirst'))
      return
    }
    if (!ensureCanGenerate()) return
    setError(null)
    setPropItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, generating: true } : p))
    )
    setPropProgressMsg(t('extender.progress.rerollProp'))
    try {
      const others = propItems.filter((p) => p.id !== id && p.imageUrl)
      const refImage = await buildPropStyleRefDataUrl(others)
      // Art director picks ONE fresh kind that isn't already in the library.
      const ideas = await fetchPropIdeas(1, others)
      const idea = ideas[0]
      const data = await studioRequest<{ imageUrl?: string; cost?: ReportedCost | null }>(
        '/api/generate',
        toWire({
          kind: 'propMode',
          prompt: propPrompt,
          width: PROP_TILE_SIZE,
          height: PROP_TILE_SIZE,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          apiKey: apiKey || undefined,
          provider,
          model: selectedModel,
          propRole: idea?.description,
          propRefImage: refImage,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        }),
        { on401: onNeedsKey, fallbackMessage: t('extender.error.rerollProp') }
      )
      if (!data.imageUrl) throw new Error(t('extender.error.noImage'))
      setLastCost(data.cost ?? null)
      setPropProgressMsg(t('extender.progress.processing'))
      const processed = await postProcessProp(data.imageUrl)
      setPropItems((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, imageUrl: processed, name: idea?.category, generating: false }
            : p
        )
      )
    } catch (err) {
      setPropItems((prev) =>
        prev.map((p) => (p.id === id ? { ...p, generating: false } : p))
      )
      setError(err instanceof Error ? err.message : t('extender.error.rerollProp'))
    } finally {
      setPropProgressMsg(null)
    }
  }

  /** Remove a single prop from the library (curation). */
  const handleDeleteProp = (id: string) => {
    setPropItems((prev) => prev.filter((p) => p.id !== id))
  }

  const handleClearPropSet = () => {
    setPropItems([])
    setPropProgressMsg(null)
    propStopRef.current = false
  }

  const handleDownloadPropSheet = async () => {
    try {
      const sheet = await buildPropAtlasDataUrl()
      if (!sheet) {
        setError(t('extender.error.propFirstAtlas'))
        return
      }
      const baseName = (propPrompt.trim().slice(0, 24) || 'props').replace(
        /[^a-z0-9]+/gi,
        '_'
      )
      downloadUrl(sheet, `${baseName}_props_atlas.png`)
      downloadText(JSON.stringify(buildPropManifest({ prompt: propPrompt, sceneBrief, items: propItems }), null, 2), `${baseName}_props_manifest.json`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extender.error.exportAtlas'))
    }
  }

  const handleDownloadPropZip = async () => {
    try {
      const populated = propItems.filter((p) => p.imageUrl)
      if (populated.length === 0) {
        setError(t('extender.error.propFirstZip'))
        return
      }
      const names = resolvePropNames(populated)
      const entries: ZipEntry[] = populated.map((p, i) => ({ name: names[i].file, dataUrl: p.imageUrl as string }))
      const sheet = await buildPropAtlasDataUrl()
      if (sheet) entries.push({ name: 'props_atlas.png', dataUrl: sheet })
      entries.push({ name: 'manifest.json', text: JSON.stringify(buildPropManifest({ prompt: propPrompt, sceneBrief, items: propItems }), null, 2) })

      const baseName = (propPrompt.trim().slice(0, 24) || 'props').replace(
        /[^a-z0-9]+/gi,
        '_'
      )
      await downloadZip(`${baseName}_props.zip`, entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extender.error.exportZip'))
    }
  }

  return {
    propItems,
    setPropItems,
    lastCost,
    propPrompt,
    setPropPrompt,
    propSetGenerating,
    propProgressMsg,
    setPropProgressMsg,
    propStopRef,
    buildPropAtlasDataUrl,
    handleAddPropBatch,
    handleStopPropSet,
    handleRegenerateProp,
    handleDeleteProp,
    handleClearPropSet,
    handleDownloadPropSheet,
    handleDownloadPropZip,
  }
}
