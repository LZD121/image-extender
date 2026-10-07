'use client'
// app/lib/useParallaxStudio.ts
/**
 * The parallax studio: its layer state, its orchestration and its exporters,
 * behind one hook.
 *
 * Why it exists: the studio's twelve handlers and five pieces of state used to
 * sit in `app/page.tsx`, a client module that every studio shares — so a change
 * to the auto-extend loop meant reading a 3,600-line component. What stays in
 * the page is the JSX (the composition root's job) and the wiring of the
 * studio's shared settings into this hook.
 *
 * What it owns: the four depth bands (near / mid / far / sky) and their images.
 * Keyed layers are stored twice — a chroma-keyed transparent copy for display
 * and the raw magenta source the extend pipeline must be fed — so an extension
 * never eats the key color. The auto-extend loop walks the active layer toward
 * a target width one best variant at a time, then closes the horizontal seam so
 * the texture tiles.
 *
 * The shared art direction (`sceneBrief`) stays in the page because the tile and
 * props generators read the same brief; the page passes it in, never derived
 * here. The extension pipeline (`runExtend` / `resolveExtendSource`) is likewise
 * the page's, since extender mode uses it without a layer.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/app/lib/i18n'
import type { Candidate, Direction, Mode } from '@/app/lib/app'
import { LAYER_ORDER, type LayerRole } from '@/app/lib/layerRoles'
import {
  LAYER_ROLES,
  PARALLAX_MAX_AUTO_STEPS,
  ParallaxLayer,
  WORKFLOW_ORDER,
  createDefaultLayers,
  getRecommendedLayerIndex,
} from '@/app/lib/parallax'
import { downloadUrl, downloadZip, type ZipEntry } from '@/app/lib/studioDownload'
import {
  chromaKeyToAlpha,
  getImageDimensions,
  harmonizeHorizontalSeams,
  makeHorizontallyTileable,
} from '@/app/utils/imageProcessor'

/** What the parallax studio needs from the shell it lives in. */
export type ParallaxStudioOptions = {
  /** Which top-level tool the page is in; only 'parallax' is this hook's own. */
  mode: Mode
  /** Shared art direction; owned by the page because every studio reads it. */
  sceneBrief: string
  /** The command-bar prompt and style the extension runs with. */
  customPrompt: string
  artStyle: string
  /** The global extender canvas, used when mode is not 'parallax'. */
  selectedImage: string | null
  setSelectedImage: (image: string | null) => void
  originalFileName: string
  currentImageDimensions: { width: number; height: number } | null
  setCurrentImageDimensions: (dims: { width: number; height: number } | null) => void
  /** The candidate the user is reviewing, if any (page-level state). */
  activeCandidate: Candidate | null
  candidateDims: Array<{ width: number; height: number } | null>
  selectedCandidateIdx: number
  loading: boolean
  setLoading: (value: boolean) => void
  /** Surface a failure in the app's error banner. */
  setError: (message: string | null) => void
  setProgressMsg: (message: string | null) => void
  setActiveDirection: (direction: Direction | null) => void
  setExtendedCandidates: (candidates: Candidate[]) => void
  setCandidateDims: (dims: Array<{ width: number; height: number } | null>) => void
  setSelectedCandidateIdx: (index: number) => void
  setImageBeforeExtension: (image: string | null) => void
  setLastExtensionParams: (params: {
    direction: Direction
    customPrompt: string
    artStyle: string
    layerRole?: LayerRole
  } | null) => void
  setShowGenerateModal: (open: boolean) => void
  generatePrompt: string
  setGeneratePrompt: (prompt: string) => void
  setGenerateWidth: (width: number) => void
  setGenerateHeight: (height: number) => void
  /** The page's extension pipeline, run once per auto-extend step. */
  runExtend: (
    direction: Direction,
    sourceImage: string,
    promptText: string,
    style: string,
    layerRole?: LayerRole
  ) => Promise<Candidate[]>
  /** Which image (and which layer role) the next extension should act on. */
  resolveExtendSource: () => { sourceImage: string | null; layerRole?: LayerRole }
  /** Ask the user for a key when one is needed; false when they decline. */
  ensureCanGenerate: () => boolean
}

export function useParallaxStudio({
  mode,
  sceneBrief,
  customPrompt,
  artStyle,
  selectedImage,
  setSelectedImage,
  originalFileName,
  currentImageDimensions,
  setCurrentImageDimensions,
  activeCandidate,
  candidateDims,
  selectedCandidateIdx,
  loading,
  setLoading,
  setError,
  setProgressMsg,
  setActiveDirection,
  setExtendedCandidates,
  setCandidateDims,
  setSelectedCandidateIdx,
  setImageBeforeExtension,
  setLastExtensionParams,
  setShowGenerateModal,
  generatePrompt,
  setGeneratePrompt,
  setGenerateWidth,
  setGenerateHeight,
  runExtend,
  resolveExtendSource,
  ensureCanGenerate,
}: ParallaxStudioOptions) {
  const { t } = useI18n()

  // Parallax-specific state. Target width is the "auto-extend until we hit
  // this width" goal; autoExtending tracks the loop; the stop ref lets the
  // user interrupt mid-loop without React re-render races. The layers array
  // holds the per-depth-band images that compose into a real parallax scene.
  const [parallaxTargetWidth, setParallaxTargetWidth] = useState<number | null>(null)
  const [parallaxAutoExtending, setParallaxAutoExtending] = useState(false)
  const parallaxAutoStopRef = useRef(false)
  const [parallaxLayers, setParallaxLayers] = useState<ParallaxLayer[]>(() =>
    createDefaultLayers()
  )
  const [parallaxActiveIdx, setParallaxActiveIdx] = useState(() =>
    LAYER_ORDER.indexOf(WORKFLOW_ORDER[0])
  )

  // ── Parallax layer helpers ─────────────────────────────────────────────────

  /** Convenience accessor for the currently-edited parallax layer. */
  const activeLayer: ParallaxLayer | null =
    mode === 'parallax' ? parallaxLayers[parallaxActiveIdx] ?? null : null

  /**
   * Update a single field on the currently-active layer. Used by the layer
   * panel sliders and by image-loading paths that need to write back the
   * generated/extended image plus its dimensions.
   */
  const patchActiveLayer = useCallback(
    (patch: Partial<ParallaxLayer>) => {
      setParallaxLayers((prev) =>
        prev.map((l, i) => (i === parallaxActiveIdx ? { ...l, ...patch } : l))
      )
    },
    [parallaxActiveIdx]
  )

  const setLayerScrollSpeed = useCallback((idx: number, speed: number) => {
    setParallaxLayers((prev) =>
      prev.map((l, i) =>
        i === idx ? { ...l, scrollSpeed: Math.max(0, speed) } : l
      )
    )
  }, [])

  const clearLayer = useCallback((idx: number) => {
    setParallaxLayers((prev) =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              imageUrl: null,
              rawImageUrl: null,
              width: null,
              height: null,
              fromUpload: false,
            }
          : l
      )
    )
  }, [])

  /**
   * Apply a freshly-loaded image (from upload or generation) to the active
   * layer. Sky layers are stored as-is; non-sky layers are chroma-keyed for
   * display while the raw is preserved for future extension. Uploads are
   * trusted to already have correct alpha and bypass the keying pass.
   */
  const applyImageToActiveLayer = useCallback(
    async (imageUrl: string, options: { fromUpload: boolean }) => {
      const layer = parallaxLayers[parallaxActiveIdx]
      if (!layer) return
      const isKeyed = !LAYER_ROLES[layer.role].isOpaque
      const dims = await getImageDimensions(imageUrl)
      let displayImage = imageUrl
      let rawImage: string | null = imageUrl
      if (isKeyed && !options.fromUpload) {
        // Keyed layers from generation/extension: apply chroma key for
        // display, keep the raw for re-feeding into the extend pipeline.
        displayImage = await chromaKeyToAlpha(imageUrl)
        rawImage = imageUrl
      } else if (isKeyed && options.fromUpload) {
        // User-supplied alpha — trust it. raw == display.
        rawImage = imageUrl
      }
      patchActiveLayer({
        imageUrl: displayImage,
        rawImageUrl: rawImage,
        width: dims.width,
        height: dims.height,
        fromUpload: options.fromUpload,
      })
      // Nudge workflow: after filling a layer, jump to the next empty one
      // in front→back order so users naturally build Near → Mid → Far → Sky.
      const updatedLayers = parallaxLayers.map((l, i) =>
        i === parallaxActiveIdx
          ? {
              ...l,
              imageUrl: displayImage,
              rawImageUrl: rawImage,
              width: dims.width,
              height: dims.height,
              fromUpload: options.fromUpload,
            }
          : l
      )
      const nextIdx = getRecommendedLayerIndex(updatedLayers)
      if (nextIdx !== null && nextIdx !== parallaxActiveIdx) {
        setParallaxActiveIdx(nextIdx)
      }
    },
    [parallaxLayers, parallaxActiveIdx, patchActiveLayer]
  )

  // Mirror the active parallax layer's dimensions into the legacy
  // currentImageDimensions state used by the extend pipeline guard. We have
  // to depend on the dims directly (not just `parallaxActiveIdx`) so the
  // sync re-fires when generation/extension fills in dims for a previously-
  // empty layer — otherwise the guard would still see a null and throw
  // "Image dimensions not available yet."
  const activeLayerWidth =
    mode === 'parallax' ? parallaxLayers[parallaxActiveIdx]?.width ?? null : null
  const activeLayerHeight =
    mode === 'parallax' ? parallaxLayers[parallaxActiveIdx]?.height ?? null : null
  useEffect(() => {
    if (mode !== 'parallax') return
    if (activeLayerWidth && activeLayerHeight) {
      setCurrentImageDimensions({
        width: activeLayerWidth,
        height: activeLayerHeight,
      })
    } else {
      setCurrentImageDimensions(null)
    }
  }, [mode, activeLayerWidth, activeLayerHeight])

  // Switching to a different layer should wipe in-flight review state —
  // otherwise a stale candidate from layer N would render over layer M's
  // canvas. This is intentionally separate from the dim-sync effect above so
  // it only fires on actual layer switches, not on every layer mutation.
  useEffect(() => {
    if (mode !== 'parallax') return
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
  }, [mode, parallaxActiveIdx])

  // ── Parallax: extend-to-target loop, full-image download, tile export ─────

  /**
   * Auto-extend rightward, accepting the best variant each time, until the
   * image reaches `parallaxTargetWidth` (or the safety cap). Skips the
   * normal candidate-review UI — the user sets a goal and walks away.
   */
  const handleAutoExtend = async () => {
    if (loading || parallaxAutoExtending) return
    if (!ensureCanGenerate()) return
    if (!parallaxTargetWidth) return

    // Resolve the right source/role/dims based on mode. In parallax mode
    // we operate on the active layer's raw image; in extender mode on the
    // global selectedImage.
    const { sourceImage, layerRole } = resolveExtendSource()
    if (!sourceImage) return
    const startDims =
      mode === 'parallax' && activeLayer && activeLayer.width && activeLayer.height
        ? { width: activeLayer.width, height: activeLayer.height }
        : currentImageDimensions
    if (!startDims) return
    if (startDims.width >= parallaxTargetWidth) return

    setError(null)
    parallaxAutoStopRef.current = false
    setParallaxAutoExtending(true)
    setActiveDirection('right')
    setImageBeforeExtension(sourceImage)
    setLastExtensionParams({ direction: 'right', customPrompt, artStyle, layerRole })
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)

    let currentSource = sourceImage
    let currentDims = { ...startDims }
    let stepCount = 0

    try {
      while (
        currentDims.width < parallaxTargetWidth &&
        stepCount < PARALLAX_MAX_AUTO_STEPS &&
        !parallaxAutoStopRef.current
      ) {
        stepCount++
        setLoading(true)
        setProgressMsg(
          t('extender.progress.step', {
            step: stepCount,
            from: currentDims.width,
            to: parallaxTargetWidth,
          })
        )

        const candidates = await runExtend(
          'right',
          currentSource,
          customPrompt,
          artStyle,
          layerRole
        )
        if (parallaxAutoStopRef.current) break
        const best = candidates[0]

        // The next loop iteration must feed the un-keyed magenta image back
        // into the model for keyed layers; for sky / extender mode, raw and
        // display are the same.
        const nextSource = best.rawImageUrl ?? best.imageUrl
        currentSource = nextSource
        const newDims = await getImageDimensions(best.imageUrl)
        currentDims = newDims

        if (mode === 'parallax') {
          patchActiveLayer({
            imageUrl: best.imageUrl,
            rawImageUrl: nextSource,
            width: newDims.width,
            height: newDims.height,
          })
        } else {
          setSelectedImage(best.imageUrl)
          setCurrentImageDimensions(newDims)
        }
        setLoading(false)
      }
    } catch (err) {
      const e = err as Error & { status?: number }
      setError(e.message || t('extender.error.autoExtend'))
    } finally {
      setLoading(false)
      setActiveDirection(null)
      setProgressMsg(null)
      setParallaxAutoExtending(false)
      parallaxAutoStopRef.current = false
    }

    // Make the freshly-extended layer tileable so the renderer's repeat-x
    // doesn't show a hard discontinuity at the loop point. This is the most
    // common pain in parallax workflows — the AI generates a beautiful
    // continuous strip, but its left and right edges were never asked to
    // match each other, so games that tile the texture see a seam every W
    // pixels. Auto-applying here means the default output Just Works.
    // (Manual `Harmonize` is still available for the separate "panel
    // banding from cumulative AI drift" issue.)
    if (mode === 'parallax' && !parallaxAutoStopRef.current) {
      try {
        setLoading(true)
        setProgressMsg(t('extender.progress.closingLoop'))
        await makeLayerTileableByIdx(parallaxActiveIdx)
      } catch {
        // Non-fatal — leave the un-tiled result in place.
      } finally {
        setLoading(false)
        setProgressMsg(null)
      }
    }
  }

  const handleStopAutoExtend = () => {
    parallaxAutoStopRef.current = true
    setProgressMsg(t('extender.progress.stopping'))
  }

  /**
   * Open the text-to-image generator. In parallax mode, pre-fill the
   * role-specific default dimensions so the user doesn't have to think
   * about it: Sky is taller (covers the whole sky-to-horizon band), keyed
   * layers (Far / Mid / Near) are shorter (they only need to cover the
   * band their elements sit in). Same-role re-generations match the
   * existing layer's exact dimensions so a regenerate never changes
   * the canvas size. Prompt is seeded with a role-specific scaffold.
   */
  const openGenerateModal = () => {
    if (mode === 'parallax' && activeLayer) {
      const spec = LAYER_ROLES[activeLayer.role]
      // If the SAME layer already has dimensions (e.g. user is regenerating
      // after extending), keep them so the regenerate is a drop-in replacement.
      if (activeLayer.width && activeLayer.height) {
        setGenerateWidth(activeLayer.width)
        setGenerateHeight(activeLayer.height)
      } else {
        setGenerateWidth(spec.defaultWidth)
        setGenerateHeight(spec.defaultHeight)
      }
      if (!generatePrompt.trim()) {
        setGeneratePrompt(spec.defaultPrompt)
      }
    }
    setShowGenerateModal(true)
  }

  /**
   * Download the active layer's PNG (or, in extender mode, the current
   * canvas). In parallax mode this respects the layer's keyed alpha.
   */
  const handleDownloadFull = () => {
    if (mode === 'parallax') {
      const layer = activeLayer
      if (!layer || !layer.imageUrl) return
      downloadUrl(layer.imageUrl, `parallax_${layer.role}_${layer.width ?? 0}x${layer.height ?? 0}.png`)
      return
    }
    const target = activeCandidate?.imageUrl ?? selectedImage
    const dims = activeCandidate
      ? candidateDims[selectedCandidateIdx] ?? null
      : currentImageDimensions
    if (!target || !dims) return
    const baseName = originalFileName.replace(/\.[^/.]+$/, '') || 'parallax'
    downloadUrl(target, `${baseName}_${dims.width}x${dims.height}.png`)
  }

  /**
   * Export the entire parallax project as a ZIP: one PNG per populated
   * layer plus a `parallax.json` manifest describing depth order, scroll
   * speeds, and dimensions. The manifest is engine-friendly so Unity /
   * Godot / Phaser users can wire it straight into a parallax controller.
   */
  const handleExportZip = async () => {
    const populated = parallaxLayers.filter((l) => l.imageUrl)
    if (populated.length === 0) {
      setError(t('extender.error.noLayers'))
      return
    }
    setProgressMsg(t('extender.progress.packaging'))
    try {
      const entries: ZipEntry[] = []
      const manifest: {
        version: number
        createdAt: string
        sceneBrief?: string
        layers: {
          role: LayerRole
          file: string
          width: number | null
          height: number | null
          scrollSpeed: number
          opaque: boolean
        }[]
      } = {
        version: 1,
        createdAt: new Date().toISOString(),
        ...(sceneBrief.trim() ? { sceneBrief: sceneBrief.trim() } : {}),
        layers: [],
      }
      for (const layer of parallaxLayers) {
        if (!layer.imageUrl) continue
        const filename = `${layer.role}.png`
        entries.push({ name: filename, dataUrl: layer.imageUrl })
        manifest.layers.push({
          role: layer.role,
          file: filename,
          width: layer.width,
          height: layer.height,
          scrollSpeed: layer.scrollSpeed,
          opaque: LAYER_ROLES[layer.role].isOpaque,
        })
      }
      entries.push({ name: 'parallax.json', text: JSON.stringify(manifest, null, 2) })
      await downloadZip(`parallax_project_${Date.now()}.zip`, entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extender.error.buildZip'))
    } finally {
      setProgressMsg(null)
    }
  }

  /**
   * Run the horizontal-seam harmonizer on a single parallax layer (or on the
   * extender canvas) and write the result back. For sky / extender images
   * we operate on the displayable image directly. For keyed layers we have
   * to work on the un-keyed magenta source — otherwise alpha=0 regions
   * dominate the column means, the magenta itself drifts, or both. After
   * harmonizing the raw we re-apply chroma-keying for the displayable copy.
   */
  const harmonizeLayerByIdx = useCallback(
    async (idx: number, strength = 0.85) => {
      const layer = parallaxLayers[idx]
      if (!layer || !layer.imageUrl) return
      const isKeyed = !LAYER_ROLES[layer.role].isOpaque
      if (isKeyed && layer.rawImageUrl) {
        const harmonizedRaw = await harmonizeHorizontalSeams(
          layer.rawImageUrl,
          {
            strength,
            ignoreKeyColor: { r: 255, g: 0, b: 255, threshold: 80 },
          }
        )
        const harmonizedDisplay = await chromaKeyToAlpha(harmonizedRaw)
        setParallaxLayers((prev) =>
          prev.map((l, i) =>
            i === idx
              ? { ...l, imageUrl: harmonizedDisplay, rawImageUrl: harmonizedRaw }
              : l
          )
        )
      } else {
        const harmonized = await harmonizeHorizontalSeams(layer.imageUrl, {
          strength,
        })
        setParallaxLayers((prev) =>
          prev.map((l, i) =>
            i === idx
              ? { ...l, imageUrl: harmonized, rawImageUrl: harmonized }
              : l
          )
        )
      }
    },
    [parallaxLayers]
  )

  /**
   * User-triggered harmonize for the active parallax layer. Surfaces a
   * progress pill while running because the column-mean pass can take a
   * couple of seconds on long backgrounds.
   */
  const handleHarmonizeActiveLayer = async () => {
    if (mode !== 'parallax') return
    if (loading || parallaxAutoExtending) return
    const layer = parallaxLayers[parallaxActiveIdx]
    if (!layer || !layer.imageUrl) return
    setError(null)
    setLoading(true)
    setProgressMsg(t('extender.progress.harmonizing'))
    try {
      await harmonizeLayerByIdx(parallaxActiveIdx)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extender.error.harmonize'))
    } finally {
      setLoading(false)
      setProgressMsg(null)
    }
  }

  /**
   * Turn the active layer's image into a horizontally tileable texture so
   * `repeat-x` doesn't show a hard discontinuity at the loop point. For
   * keyed layers we operate on the un-keyed magenta source and re-key for
   * display (otherwise the magenta key would get tinted at the seam strip).
   */
  const makeLayerTileableByIdx = useCallback(
    async (idx: number) => {
      const layer = parallaxLayers[idx]
      if (!layer || !layer.imageUrl) return
      const isKeyed = !LAYER_ROLES[layer.role].isOpaque
      if (isKeyed && layer.rawImageUrl) {
        const tileableRaw = await makeHorizontallyTileable(
          layer.rawImageUrl,
          {
            ignoreKeyColor: { r: 255, g: 0, b: 255, threshold: 80 },
          }
        )
        const tileableDisplay = await chromaKeyToAlpha(tileableRaw)
        setParallaxLayers((prev) =>
          prev.map((l, i) =>
            i === idx
              ? { ...l, imageUrl: tileableDisplay, rawImageUrl: tileableRaw }
              : l
          )
        )
      } else {
        const tileable = await makeHorizontallyTileable(layer.imageUrl)
        setParallaxLayers((prev) =>
          prev.map((l, i) =>
            i === idx
              ? { ...l, imageUrl: tileable, rawImageUrl: tileable }
              : l
          )
        )
      }
    },
    [parallaxLayers]
  )

  const handleMakeActiveLayerTileable = async () => {
    if (mode !== 'parallax') return
    if (loading || parallaxAutoExtending) return
    const layer = parallaxLayers[parallaxActiveIdx]
    if (!layer || !layer.imageUrl) return
    setError(null)
    setLoading(true)
    setProgressMsg(t('extender.progress.tileable'))
    try {
      await makeLayerTileableByIdx(parallaxActiveIdx)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extender.error.tileable'))
    } finally {
      setLoading(false)
      setProgressMsg(null)
    }
  }

  return {
    parallaxTargetWidth,
    setParallaxTargetWidth,
    parallaxAutoExtending,
    parallaxLayers,
    setParallaxLayers,
    parallaxActiveIdx,
    setParallaxActiveIdx,
    activeLayer,
    patchActiveLayer,
    setLayerScrollSpeed,
    clearLayer,
    applyImageToActiveLayer,
    handleAutoExtend,
    handleStopAutoExtend,
    openGenerateModal,
    handleDownloadFull,
    handleExportZip,
    handleHarmonizeActiveLayer,
    handleMakeActiveLayerTileable,
  }
}
