'use client'
// app/lib/useTileStudio.ts
/**
 * The tile-set studio: its state and its orchestration, behind one hook.
 *
 * Why it exists: the studio's sixteen handlers and five pieces of state used to
 * sit in `app/page.tsx`, a client module that every studio shares — so a change
 * to tile generation meant reading a 3,600-line component, and the tile state
 * could only be exercised by rendering the whole app. What stays in the page is
 * the JSX (the composition root's job) and the wiring of a studio's dependencies
 * into this hook.
 *
 * The reverse pipeline it drives: one AI call paints a 4×4 sheet, `tileFinish`
 * aligns/slices/keys/reconciles it (that composition lives in
 * `app/utils/tileFinish.ts`), the QA art director reviews the assembled preview
 * and up to two repaints follow, and the keep-best rule means a critic can only
 * ever improve on the first generation.
 */
import { useRef, useState } from 'react'
import { useI18n } from '@/app/lib/i18n'
import { toWire } from '@/app/lib/generateRequest'
import { skipsArtDirectorReview } from '@/app/lib/models'
import { buildTileSetManifest } from '@/app/lib/sheetManifest'
import { studioRequest } from '@/app/lib/studioRequest'
import { downloadText, downloadUrl, downloadZip, type ZipEntry } from '@/app/lib/studioDownload'
import {
  CORNER_GRAFTS,
  ENABLE_CORNER_RECONCILE,
  TILESET_ATLAS_EXTRUDE_PX,
  TILESET_BY_ROLE,
  TILESET_PADDED_SHEET_H,
  TILESET_PADDED_SHEET_W,
  TILESET_PADDED_STRIDE,
  TILESET_SHEET_H,
  TILESET_SHEET_W,
  TILESET_TILE_SIZE,
  TILE_TEMPLATE_CELL,
  TILE_TEMPLATE_H,
  TILE_TEMPLATE_W,
  buildTileSheetGuideDataUrl,
  createEmptyTileSet,
  rebuildCornerTile,
  type TileSetRole,
  type TileSetSlot,
} from '@/app/lib/tileset'
import type { ProviderId } from '@/app/lib/providers'
import {
  buildTilePreviewComposite,
  buildTileSheetAtlas,
  finishTileCell,
  finishTileSheet,
} from '@/app/utils/tileFinish'

/** What the tile studio needs from the shell it lives in. */
export type TileStudioOptions = {
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

export function useTileStudio({
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
}: TileStudioOptions) {
  const { t } = useI18n()
  // Whether the vision critic runs at all is a property of the model, not of
  // the caller — so it is derived here rather than threaded in.
  const skipArtDirectorReview = skipsArtDirectorReview(selectedModel)
  // Tile-set state. A 13-slot autotile set for 2D platformer tile-maps:
  // body + 4 edges + 4 outer corners + 4 inner corners. Each non-body tile
  // is generated against magenta and chroma-keyed to alpha so the user can
  // drop tiles over any background. Generated text-only with role-specific
  // magenta-layout instructions; consistency comes from a shared prompt +
  // sceneBrief across calls.
  const [tileSet, setTileSet] = useState<TileSetSlot[]>(() => createEmptyTileSet())
  const [tilePrompt, setTilePrompt] = useState('')
  const [tileSetGenerating, setTileSetGenerating] = useState(false)
  const [tileProgressMsg, setTileProgressMsg] = useState<string | null>(null)
  const tileStopRef = useRef(false)

  /** Mutate a single tile slot in the set. */
  const patchTileSlot = (
    role: TileSetRole,
    patch: Partial<TileSetSlot>
  ) => {
    setTileSet((prev) =>
      prev.map((s) => (s.role === role ? { ...s, ...patch } : s))
    )
  }

  /** Generate a single tile slot. Returns the resolved image URL (already
   * post-processed) so callers can chain or assign as needed. Throws on
   * failure so the caller can surface error state. */
  const generateOneTile = async (role: TileSetRole): Promise<string> => {
    const spec = TILESET_BY_ROLE[role]
    const roleLabel = (
      t(`common.tileRole.${role}.label`, undefined, spec.label)
    ).toLowerCase()
    setTileProgressMsg(
      t('extender.progress.generatingPhase', { label: roleLabel })
    )
    patchTileSlot(role, { generating: true })

    try {
      const tileGuideImage = buildTileSheetGuideDataUrl()
      const data = await studioRequest<{ imageUrl?: string }>(
        '/api/generate',
        toWire({
          kind: 'tileMode',
          prompt: tilePrompt,
          width: TILESET_TILE_SIZE,
          height: TILESET_TILE_SIZE,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          apiKey: apiKey || undefined,
          provider,
          model: selectedModel,
          tileRole: role,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        }),
        { on401: onNeedsKey, fallbackMessage: t('extender.error.tileRole', { label: roleLabel }) }
      )
      if (!data.imageUrl) throw new Error(t('extender.error.noImage'))

      setTileProgressMsg(
        t('extender.progress.processingPhase', { label: roleLabel })
      )
      const processed = await finishTileCell(role, data.imageUrl)

      // Keep corners reconciled with their edge neighbors after a single
      // regen (the generate-all path reconciles the whole set at once). We
      // read neighbor URLs from current state.
      const neighborUrls: Partial<Record<TileSetRole, string>> = {}
      tileSet.forEach((s) => {
        if (s.imageUrl && s.role !== role) neighborUrls[s.role] = s.imageUrl
      })

      const isCorner = !!CORNER_GRAFTS[role]
      if (ENABLE_CORNER_RECONCILE && isCorner) {
        // A corner was regenerated → rebuild it against current neighbors
        // (inner corners are assembled from neighbors; outer corners grafted).
        let finalUrl = processed
        try {
          finalUrl = await rebuildCornerTile(role, processed, neighborUrls)
        } catch {
          /* fall back to the raw corner */
        }
        patchTileSlot(role, {
          imageUrl: finalUrl,
          hasImage: true,
          generating: false,
        })
        return finalUrl
      }

      patchTileSlot(role, {
        imageUrl: processed,
        hasImage: true,
        generating: false,
      })

      // An edge/body was regenerated → rebuild every corner so their shared
      // borders (and assembled inner corners) track the new tile.
      const affectsCorners =
        role === 'top' ||
        role === 'bottom' ||
        role === 'left' ||
        role === 'right' ||
        role === 'body'
      if (affectsCorners && ENABLE_CORNER_RECONCILE) {
        const updatedNeighbors = { ...neighborUrls, [role]: processed }
        await Promise.all(
          (Object.keys(CORNER_GRAFTS) as TileSetRole[]).map(async (cRole) => {
            const cUrl = tileSet.find((s) => s.role === cRole)?.imageUrl
            if (!cUrl) return
            try {
              const rebuilt = await rebuildCornerTile(
                cRole,
                cUrl,
                updatedNeighbors
              )
              patchTileSlot(cRole, { imageUrl: rebuilt })
            } catch {
              /* leave the corner as-is on failure */
            }
          })
        )
      }

      return processed
    } catch (err) {
      patchTileSlot(role, { generating: false })
      throw err
    }
  }

  /** Review half of the reverse pipeline — hand the assembled preview + sheet
   * to the QA art director. Returns null (≈ approve) on any failure so a flaky
   * critic never blocks the user. */
  const fetchTileReview = async (
    previewImage: string,
    sheetImage: string | null
  ): Promise<{ ok: boolean; issues: string[]; fix: string } | null> => {
    try {
      const data = await studioRequest<{ ok?: boolean; issues?: string[]; fix?: string }>(
        '/api/tile-review',
        {
          prompt: tilePrompt,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
          apiKey: apiKey || undefined,
          provider,
          model: qaModel,
          previewImage,
          sheetImage: sheetImage || undefined,
        },
        { on401: onNeedsKey }
      )
      if (typeof data?.ok !== 'boolean') return null
      return { ok: data.ok, issues: data.issues ?? [], fix: data.fix ?? '' }
    } catch {
      return null
    }
  }

  /** Generate the full 13-tile set in ONE AI call as a 4×4 sprite-sheet, then
   * slice + post-process each cell. This is the consistency win: all tiles come
   * out of the same diffusion pass so palette, texture detail, and lighting are
   * locked across the set. The per-tile path (used by `handleRegenerateTile`)
   * is retained as an escape hatch for individual failures. */
  const handleGenerateTileSet = async () => {
    if (tileSetGenerating) return
    if (!tilePrompt.trim()) {
      setError(t('extender.error.describeMaterial'))
      return
    }
    if (!ensureCanGenerate()) return
    setError(null)
    tileStopRef.current = false
    setTileSetGenerating(true)
    const startedAt = Date.now()
    // Up to this many extra repaint passes after the first generation, each
    // driven by the QA art director's fix report.
    const MAX_TILE_REVIEW_PASSES = 2

    // Mark every slot as "generating" up front so the UI shows the whole
    // set spinning during the single AI call (vs. one cell at a time).
    setTileSet((prev) => prev.map((s) => ({ ...s, generating: true })))

    // Tick a live elapsed-seconds counter so the user sees progress during
    // the long single call (sheet generation typically takes 30-90s).
    let phase = t('extender.phase.generatingSheet')
    const tickHandle = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setTileProgressMsg(t('extender.progress.phase', { phase, seconds: elapsed }))
    }, 1000)

    // One full generate → align → slice → process → reconcile pass. Returns
    // the reconciled role→url map, or null if stopped. `fixNotes` carries the
    // QA report into the regeneration prompt on retry passes.
    const renderSheetOnce = async (
      fixNotes?: string
    ): Promise<Partial<Record<TileSetRole, string>> | null> => {
      const tileGuideImage = buildTileSheetGuideDataUrl()
      const data = await studioRequest<{ imageUrl?: string }>(
        '/api/generate',
        toWire({
          kind: 'tileSheet',
          prompt: tilePrompt,
          width: TILE_TEMPLATE_W,
          height: TILE_TEMPLATE_H,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          apiKey: apiKey || undefined,
          provider,
          model: selectedModel,
          tileGuideImage,
          tileFixNotes: fixNotes,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        }),
        { on401: onNeedsKey, fallbackMessage: t('extender.error.tileSheet') }
      )
      if (!data.imageUrl) throw new Error(t('extender.error.noImage'))
      if (tileStopRef.current) return null

      const finished = await finishTileSheet(data.imageUrl, {
        cell: TILE_TEMPLATE_CELL,
        onStep: (step) => {
          phase =
            step === 'align'
              ? t('extender.phase.aligning')
              : step === 'slice'
                ? t('extender.phase.slicing')
                : step === 'finish'
                  ? t('extender.phase.processingTiles')
                  : t('extender.phase.reconciling')
        },
        shouldContinue: () => !tileStopRef.current,
      })
      if (!finished) return null
      return finished.byRole
    }

    // `reviewing` keeps each populated cell's spinner overlay on while the art
    // director inspects the result (so the sheet visibly shows "still working"
    // during review / repaint), then clears it once the verdict is final.
    const applyMap = (
      map: Partial<Record<TileSetRole, string>>,
      reviewing: boolean
    ) =>
      setTileSet((prev) =>
        prev.map((slot) => {
          const url = map[slot.role] ?? null
          return {
            role: slot.role,
            imageUrl: url,
            hasImage: !!url,
            generating: reviewing && !!url,
          }
        })
      )

    try {
      let fixNotes: string | undefined
      // Track the BEST candidate across passes and commit that one at the end —
      // never just the last pass. A repaint fully re-rolls every flat tile (and
      // the corners are composited deterministically afterwards), so a critic
      // that rejects a clean first generation can otherwise replace it with a
      // drifted, uglier sheet. Keep-best makes the review loop strictly safe:
      // it can only ever improve on, never regress, the first generation.
      // score: -1 = critic approved (best possible); otherwise the number of
      // issues raised (fewer = better). Strictly-better comparison means TIES
      // keep the EARLIER pass — and the first, un-nudged generation is the one
      // least likely to have drifted.
      let best: {
        map: Partial<Record<TileSetRole, string>>
        score: number
      } | null = null

      for (let pass = 0; pass <= MAX_TILE_REVIEW_PASSES; pass++) {
        phase =
          pass === 0
            ? t('extender.phase.generatingSheet')
            : t('extender.phase.repaintingSheet', { pass: pass + 1 })
        const reconciled = await renderSheetOnce(fixNotes)
        if (tileStopRef.current || !reconciled) return

        // Show the attempt but KEEP each tile's spinner on to signal that the
        // art director is still reviewing the sheet.
        applyMap(reconciled, true)

        if (skipArtDirectorReview) {
          if (debugMode) {
            // eslint-disable-next-line no-console
            console.log('🧱 Skipping art director review for GPT image model')
          }
          best = { map: reconciled, score: -1 }
          break
        }

        phase = t('extender.progress.reviewing')
        setTileProgressMsg(t('extender.progress.reviewing'))
        const [previewImage, sheetImage] = await Promise.all([
          buildTilePreviewComposite(reconciled),
          buildTileSheetAtlas(reconciled),
        ])
        if (tileStopRef.current) return

        // No preview → can't review; treat as a neutral candidate.
        const review = previewImage
          ? await fetchTileReview(previewImage, sheetImage)
          : null
        if (tileStopRef.current) return

        // null (critic unavailable/parse error) is treated as approved so a
        // flaky critic never blocks the user.
        const approved = !review || review.ok
        const score = approved ? -1 : review.issues?.length || 1
        if (!best || score < best.score) best = { map: reconciled, score }

        if (approved) {
          if (debugMode && review) {
            // eslint-disable-next-line no-console
            console.log('🧱 QA approved the tileset')
          }
          break
        }

        // Rejected — stop if there's nothing actionable or we're out of budget;
        // otherwise carry the fix report into the next repaint.
        fixNotes = review.fix || review.issues.join('; ')
        if (!fixNotes || pass === MAX_TILE_REVIEW_PASSES) break

        if (debugMode) {
          // eslint-disable-next-line no-console
          console.log('🧱 QA rejected, repainting with notes:', fixNotes)
        }
        // Leave the spinners on — they now signal the repaint in progress.
        setTileProgressMsg(t('extender.progress.repainting'))
      }

      // Commit the best candidate we saw (spinners off) — preferring the best,
      // not the last, is what stops the review loop from turning a clean first
      // generation into one with corner artifacts.
      if (best) applyMap(best.map, false)
    } catch (err) {
      // Wipe the "generating" flags on failure so the UI stops spinning.
      setTileSet((prev) => prev.map((s) => ({ ...s, generating: false })))
      setError(
        err instanceof Error ? err.message : t('extender.error.tileSheet')
      )
    } finally {
      clearInterval(tickHandle)
      setTileSetGenerating(false)
      setTileProgressMsg(null)
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      // eslint-disable-next-line no-console
      if (debugMode) console.log(`🧱 Tile-set generated in ${elapsed}s`)
    }
  }

  const handleStopTileSet = () => {
    tileStopRef.current = true
  }

  /** Regenerate a single tile in the set without touching the others. */
  const handleRegenerateTile = async (role: TileSetRole) => {
    if (tileSetGenerating) return
    if (!tilePrompt.trim()) {
      setError(t('extender.error.describeMaterialFirst'))
      return
    }
    if (!ensureCanGenerate()) return
    setError(null)
    setTileSetGenerating(true)
    try {
      await generateOneTile(role)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extender.error.regenerateTile'))
    } finally {
      setTileSetGenerating(false)
      setTileProgressMsg(null)
    }
  }

  const handleClearTileSet = () => {
    setTileSet(createEmptyTileSet())
    setTilePrompt('')
    setTileProgressMsg(null)
    tileStopRef.current = false
    setError(null)
  }

  /** Render the 4x4 sprite-sheet PNG (4096x4096) by drawing each populated
   * tile into its grid cell. Empty cells stay transparent. */
  const buildTileSheetDataUrl = async (): Promise<string | null> => {
    const populated = tileSet.filter((s) => s.imageUrl)
    if (populated.length === 0) return null

    const canvas = document.createElement('canvas')
    canvas.width = TILESET_SHEET_W
    canvas.height = TILESET_SHEET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false

    await Promise.all(
      populated.map(
        (slot) =>
          new Promise<void>((resolve, reject) => {
            if (!slot.imageUrl) {
              resolve()
              return
            }
            const spec = TILESET_BY_ROLE[slot.role]
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(
                img,
                spec.col * TILESET_TILE_SIZE,
                spec.row * TILESET_TILE_SIZE,
                TILESET_TILE_SIZE,
                TILESET_TILE_SIZE
              )
              resolve()
            }
            img.onerror = () => reject(new Error(t('extender.error.loadTile', { role: spec.role })))
            img.src = slot.imageUrl
          })
      )
    )

    return canvas.toDataURL('image/png')
  }

  /** Render an engine atlas with a 2px duplicated border around each tile.
   * Importers should use the inner 512x512 region for each tile and leave
   * the extruded pixels as atlas padding. */
  const buildPaddedTileSheetDataUrl = async (): Promise<string | null> => {
    const populated = tileSet.filter((s) => s.imageUrl)
    if (populated.length === 0) return null

    const canvas = document.createElement('canvas')
    canvas.width = TILESET_PADDED_SHEET_W
    canvas.height = TILESET_PADDED_SHEET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false

    await Promise.all(
      populated.map(
        (slot) =>
          new Promise<void>((resolve, reject) => {
            if (!slot.imageUrl) {
              resolve()
              return
            }
            const spec = TILESET_BY_ROLE[slot.role]
            const img = new Image()
            img.onload = () => {
              const x = spec.col * TILESET_PADDED_STRIDE
              const y = spec.row * TILESET_PADDED_STRIDE
              const p = TILESET_ATLAS_EXTRUDE_PX

              ctx.drawImage(img, x + p, y + p, TILESET_TILE_SIZE, TILESET_TILE_SIZE)

              // Edges.
              ctx.drawImage(img, 0, 0, TILESET_TILE_SIZE, 1, x + p, y, TILESET_TILE_SIZE, p)
              ctx.drawImage(img, 0, TILESET_TILE_SIZE - 1, TILESET_TILE_SIZE, 1, x + p, y + p + TILESET_TILE_SIZE, TILESET_TILE_SIZE, p)
              ctx.drawImage(img, 0, 0, 1, TILESET_TILE_SIZE, x, y + p, p, TILESET_TILE_SIZE)
              ctx.drawImage(img, TILESET_TILE_SIZE - 1, 0, 1, TILESET_TILE_SIZE, x + p + TILESET_TILE_SIZE, y + p, p, TILESET_TILE_SIZE)

              // Corners.
              ctx.drawImage(img, 0, 0, 1, 1, x, y, p, p)
              ctx.drawImage(img, TILESET_TILE_SIZE - 1, 0, 1, 1, x + p + TILESET_TILE_SIZE, y, p, p)
              ctx.drawImage(img, 0, TILESET_TILE_SIZE - 1, 1, 1, x, y + p + TILESET_TILE_SIZE, p, p)
              ctx.drawImage(img, TILESET_TILE_SIZE - 1, TILESET_TILE_SIZE - 1, 1, 1, x + p + TILESET_TILE_SIZE, y + p + TILESET_TILE_SIZE, p, p)

              resolve()
            }
            img.onerror = () => reject(new Error(t('extender.error.loadTile', { role: spec.role })))
            img.src = slot.imageUrl
          })
      )
    )

    return canvas.toDataURL('image/png')
  }

  const handleDownloadTileSheet = async () => {
    try {
      const sheet = await buildTileSheetDataUrl()
      if (!sheet) {
        setError(t('extender.error.tileFirstSheet'))
        return
      }
      const baseName = (tilePrompt.trim().slice(0, 24) || 'tileset').replace(
        /[^a-z0-9]+/gi,
        '_'
      )
      downloadUrl(sheet, `${baseName}_sheet_${TILESET_SHEET_W}x${TILESET_SHEET_H}.png`)

      const paddedSheet = await buildPaddedTileSheetDataUrl()
      if (paddedSheet) {
        downloadUrl(paddedSheet, `${baseName}_sheet_padded_${TILESET_PADDED_SHEET_W}x${TILESET_PADDED_SHEET_H}.png`)
      }

      // Also offer the manifest as a sidecar JSON in a second click.
      downloadText(JSON.stringify(buildTileSetManifest({ prompt: tilePrompt, sceneBrief, artStyle, presentRoles: tileSet.filter((s) => s.imageUrl).map((s) => s.role) }), null, 2), `${baseName}_manifest.json`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extender.error.exportSheet'))
    }
  }

  const handleDownloadTileSetZip = async () => {
    try {
      const populated = tileSet.filter((s) => s.imageUrl)
      if (populated.length === 0) {
        setError(t('extender.error.tileFirstZip'))
        return
      }
      // Drop each tile in as its own PNG, plus the combined sheet, the padded
      // sheet, and the manifest with its grid layout.
      const entries: ZipEntry[] = populated.map((slot) => ({
        name: `${TILESET_BY_ROLE[slot.role].fileName}.png`,
        dataUrl: slot.imageUrl as string,
      }))
      const sheet = await buildTileSheetDataUrl()
      if (sheet) entries.push({ name: 'sheet.png', dataUrl: sheet })
      const paddedSheet = await buildPaddedTileSheetDataUrl()
      if (paddedSheet) entries.push({ name: 'sheet_padded.png', dataUrl: paddedSheet })
      entries.push({ name: 'manifest.json', text: JSON.stringify(buildTileSetManifest({ prompt: tilePrompt, sceneBrief, artStyle, presentRoles: tileSet.filter((s) => s.imageUrl).map((s) => s.role) }), null, 2) })

      const baseName = (tilePrompt.trim().slice(0, 24) || 'tileset').replace(
        /[^a-z0-9]+/gi,
        '_'
      )
      await downloadZip(`${baseName}_tileset.zip`, entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extender.error.exportZip'))
    }
  }

  return {
    tileSet,
    setTileSet,
    tilePrompt,
    setTilePrompt,
    tileSetGenerating,
    tileProgressMsg,
    setTileProgressMsg,
    tileStopRef,
    handleGenerateTileSet,
    handleStopTileSet,
    handleRegenerateTile,
    handleClearTileSet,
    buildTileSheetDataUrl,
    handleDownloadTileSheet,
    handleDownloadTileSetZip,
  }
}
