'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CommandBar } from '@/app/components/CommandBar'
import { EmptyState } from '@/app/components/EmptyState'
import { ApiKeyModal, ErrorToast, GenerateModal, SettingsDrawer } from '@/app/components/Modals'
import { ParallaxStudio } from '@/app/components/ParallaxStudio'
import { PixelStudio } from '@/app/components/PixelStudio'
import { PropStudio } from '@/app/components/PropStudio'
import LibraryPanel from '@/app/components/LibraryPanel'
import { collectStudioAsset } from '@/app/lib/libraryCollect'
import { SpriteStudio } from '@/app/components/SpriteStudio'
import { TileStudio } from '@/app/components/TileStudio'
import { TopBar } from '@/app/components/TopBar'
import { ResultActions, VariantSelector } from '@/app/components/VariantSelector'
import { Workspace } from '@/app/components/Workspace'
import { Candidate, Direction, EXTENSION_PERCENT, LIBRARY_PROJECT_STORAGE, Mode, STORAGE_MODE, STORAGE_MODEL, STORAGE_PROVIDER, STORAGE_QA_MODEL, apiKeyStorageKey } from '@/app/lib/app'
import { useI18n } from '@/app/lib/i18n'
import { DEFAULT_MODEL, getModelConfig } from '@/app/lib/models'
import { toWire, type GenerateRequest } from '@/app/lib/generateRequest'
import { studioRequest } from '@/app/lib/studioRequest'
import { DEFAULT_PROVIDER, PROVIDERS, isProviderId, type ProviderId } from '@/app/lib/providers'
import { LAYER_ORDER, type LayerRole } from '@/app/lib/layerRoles'
import { WORKFLOW_ORDER, createDefaultLayers, getWorkflowPrerequisite } from '@/app/lib/parallax'
import { PROP_BATCH, resolvePropNames } from '@/app/lib/props'
import { SPRITE_ANIMATIONS, createEmptySpriteSheet } from '@/app/lib/sprite'
import { createEmptyTileSet } from '@/app/lib/tileset'
import { applyFullContextResult, chromaKeyToAlpha, createChunkedExtension, createFullContextExtension, isAiExtensionUnfilled, measureSeamResidual, stitchExtendedChunk } from '@/app/utils/imageProcessor'
import { buildPropManifest, buildTileSetManifest } from '@/app/lib/sheetManifest'
import { useTileStudio } from '@/app/lib/useTileStudio'
import { usePropStudio } from '@/app/lib/usePropStudio'
import { useSpriteStudio } from '@/app/lib/useSpriteStudio'
import { useParallaxStudio } from '@/app/lib/useParallaxStudio'
import { downloadUrl } from '@/app/lib/studioDownload'

export default function Home() {
  const { t } = useI18n()

  // Image state
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [originalFileName, setOriginalFileName] = useState('extended')
  /**
   * Candidates returned by the most recent extension. Sorted by seam quality
   * (best first). Length is 0 when there's no active result, 1+ otherwise.
   */
  const [extendedCandidates, setExtendedCandidates] = useState<Candidate[]>([])
  /** Which candidate the user is currently previewing. */
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0)
  /**
   * Dimensions per candidate. Indexed alongside `extendedCandidates`; written
   * lazily as each image loads (they're all the same size in practice but
   * computed individually so we never display stale dims during cycling).
   */
  const [candidateDims, setCandidateDims] = useState<Array<{ width: number; height: number } | null>>([])
  const [currentImageDimensions, setCurrentImageDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  const [imageBeforeExtension, setImageBeforeExtension] = useState<string | null>(null)
  const [lastExtensionParams, setLastExtensionParams] = useState<{
    direction: Direction
    customPrompt: string
    artStyle: string
    /** Parallax layer this extension was made on (sky/far/mid/near). Carried
     * so regenerate replays the same role. */
    layerRole?: LayerRole
  } | null>(null)

  // Operation state
  const [loading, setLoading] = useState(false)
  const [activeDirection, setActiveDirection] = useState<Direction | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Live progress message shown in the loading pill (e.g. "Attempt 1/3 · 24s"). */
  const [progressMsg, setProgressMsg] = useState<string | null>(null)

  // Form state
  const [customPrompt, setCustomPrompt] = useState('')
  const [artStyle, setArtStyle] = useState('none')
  const [debugMode, setDebugMode] = useState(false)

  // Mode: which top-level tool the user is in. Persisted to localStorage so a
  // game designer doesn't have to re-pick parallax every visit.
  const [mode, setModeState] = useState<Mode>('extender')

  /** Shared art direction for all parallax layers — auto-derived from the
   * first Near layer generation prompt, editable before Mid / Far / Sky.
   * Also reused by Tile mode so generated material textures match the
   * existing project palette/lighting/style. */
  const [sceneBrief, setSceneBrief] = useState('')
  const [sceneBriefLoading, setSceneBriefLoading] = useState(false)

  // Modal/drawer state
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [generateWidth, setGenerateWidth] = useState(1024)
  const [generateHeight, setGenerateHeight] = useState(1024)
  const [generating, setGenerating] = useState(false)

  // BYOK: API key + model are persisted to localStorage. We start in a
  // "hydrating" state so we don't flash the modal before reading storage.
  const [apiKey, setApiKey] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL)
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER)
  /** Vision model for the QA routes — an image model cannot review a sheet. */
  const [qaModel, setQaModel] = useState<string>(PROVIDERS[DEFAULT_PROVIDER].qaModel)
  const [libraryProject, setLibraryProject] = useState<string>('default')
  const [hydrated, setHydrated] = useState(false)
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  // Required-mode means the user can't dismiss the modal (first run, no key
  // anywhere). Optional-mode is used when editing an existing key from settings.
  const [apiKeyRequired, setApiKeyRequired] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Hydrate from localStorage on mount, and decide whether to show the modal.
  useEffect(() => {
    try {
      const m = localStorage.getItem(STORAGE_MODEL) || ''
      const savedProvider = localStorage.getItem(STORAGE_PROVIDER) || ''
      const nextProvider: ProviderId = isProviderId(savedProvider) ? savedProvider : DEFAULT_PROVIDER
      // A key belongs to one gateway: an OpenRouter key means nothing to magpie.
      const k = localStorage.getItem(apiKeyStorageKey(nextProvider)) || ''
      setProvider(nextProvider)
      setQaModel(localStorage.getItem(STORAGE_QA_MODEL) || PROVIDERS[nextProvider].qaModel)
      const savedMode = localStorage.getItem(STORAGE_MODE) || ''
      setApiKey(k)
      setLibraryProject(localStorage.getItem(LIBRARY_PROJECT_STORAGE) || 'default')
      if (m) setSelectedModel(m)
      if (
        savedMode === 'parallax' ||
        savedMode === 'extender' ||
        savedMode === 'tile' ||
        savedMode === 'sprite' ||
        savedMode === 'props' ||
        savedMode === 'pixel'
      ) {
        setModeState(savedMode)
      }
      if (!k && PROVIDERS[nextProvider].keyRequired) {
        setApiKeyRequired(true)
        setShowApiKeyModal(true)
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — show modal anyway.
      setApiKeyRequired(true)
      setShowApiKeyModal(true)
    } finally {
      setHydrated(true)
    }
  }, [])

  /** Persist mode + reset parallax-specific transient state on change. */
  const setMode = useCallback((next: Mode) => {
    setModeState(next)
    try {
      localStorage.setItem(STORAGE_MODE, next)
    } catch {}
  }, [])

  // Persist key + model changes. A key belongs to the gateway it was entered
  // for, so it is written to that gateway's slot.
  useEffect(() => {
    if (!hydrated) return
    try {
      const slot = apiKeyStorageKey(provider)
      if (apiKey) localStorage.setItem(slot, apiKey)
      else localStorage.removeItem(slot)
    } catch {}
  }, [apiKey, provider, hydrated])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_MODEL, selectedModel)
    } catch {}
  }, [selectedModel, hydrated])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_PROVIDER, provider)
    } catch {}
  }, [provider, hydrated])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_QA_MODEL, qaModel)
    } catch {}
  }, [qaModel, hydrated])

  // Persist the library project name so all six studios share one folder.
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(LIBRARY_PROJECT_STORAGE, libraryProject)
    } catch {}
  }, [libraryProject, hydrated])

  // PixelStudio owns the same key while it is mounted (it reads and writes the
  // project name itself), so re-read on every mode change. Without this, a
  // rename made in pixel mode is invisible here and the next save silently
  // lands in the old project directory.
  useEffect(() => {
    if (!hydrated) return
    try {
      setLibraryProject(localStorage.getItem(LIBRARY_PROJECT_STORAGE) || 'default')
    } catch {}
  }, [mode, hydrated])

  const handleSaveApiKey = (key: string) => {
    setApiKey(key)
    setShowApiKeyModal(false)
    setApiKeyRequired(false)
  }

  /**
   * Everything provider-scoped switches together: a model id and a key both
   * mean nothing on the other gateway, so this loads that gateway's key and
   * resets both model settings to its defaults.
   */
  const handleSelectProvider = (next: ProviderId) => {
    setProvider(next)
    setSelectedModel(PROVIDERS[next].imageModel)
    setQaModel(PROVIDERS[next].qaModel)
    try {
      setApiKey(localStorage.getItem(apiKeyStorageKey(next)) || '')
    } catch {
      setApiKey('')
    }
  }

  const handleSkipApiKey = () => {
    // User has env-set key on server; let them proceed without a client key.
    setShowApiKeyModal(false)
    setApiKeyRequired(false)
  }

  const handleClearApiKey = () => {
    setApiKey('')
  }

  const handleEditApiKey = () => {
    setApiKeyRequired(false)
    setShowApiKeyModal(true)
  }

  const ensureCanGenerate = (): boolean => {
    // If no key and we're in required mode, re-open the modal instead of
    // making a request that would fail with 401.
    if (!apiKey && apiKeyRequired) {
      setShowApiKeyModal(true)
      return false
    }
    return true
  }

  // ── Generate from scratch ──────────────────────────────────────────────────

  /** One policy for every request that needs a key: flag it, then offer it. */
  const onNeedsKey = useCallback(() => {
    setApiKeyRequired(true)
    setShowApiKeyModal(true)
  }, [])

  // The tile studio: state and orchestration live in one module; the page just
  // supplies the settings and the shell callbacks it needs.
  const {
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
  } = useTileStudio({
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
  })
  // The props studio: state and orchestration live in one module; the page just
  // supplies the settings and the shell callbacks it needs.
  const {
    propItems,
    setPropItems,
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
  } = usePropStudio({
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
  })
  const deriveSceneBrief = useCallback(
    async (anchorPrompt: string) => {
      if (!anchorPrompt.trim()) return
      setSceneBriefLoading(true)
      try {
        const data = await studioRequest<{ sceneBrief?: string }>(
          '/api/scene-brief',
          {
            anchorPrompt: anchorPrompt.trim(),
            artStyle: artStyle !== 'none' ? artStyle : undefined,
            apiKey: apiKey || undefined,
            provider,
            model: qaModel,
          },
          { fallbackMessage: t('extender.error.sceneDirection') }
        )
        if (typeof data.sceneBrief === 'string' && data.sceneBrief.trim()) {
          setSceneBrief(data.sceneBrief.trim())
        }
      } catch (err) {
        // Non-fatal — user can type the brief manually.
        console.warn('Scene brief derivation failed:', err)
      } finally {
        setSceneBriefLoading(false)
      }
    },
    [apiKey, artStyle, qaModel, provider, t]
  )

  const handleGenerateImage = async () => {
    if (!generatePrompt.trim()) {
      setError(t('extender.error.describeImage'))
      return
    }
    if (!ensureCanGenerate()) return
    setGenerating(true)
    setError(null)
    try {
      const layerRole =
        mode === 'parallax' ? activeLayer?.role : undefined
      const wire = {
        prompt: generatePrompt,
        width: generateWidth,
        height: generateHeight,
        artStyle: artStyle !== 'none' ? artStyle : undefined,
        apiKey: apiKey || undefined,
        provider,
        model: selectedModel,
        sceneBrief:
          mode === 'parallax' &&
          layerRole &&
          layerRole !== WORKFLOW_ORDER[0] &&
          sceneBrief.trim()
            ? sceneBrief.trim()
            : undefined,
      }
      const request: GenerateRequest = layerRole
        ? { ...wire, kind: 'parallax', layerRole }
        : { ...wire, kind: 'plain' }
      const data = await studioRequest<{ imageUrl?: string }>('/api/generate', toWire(request), {
        on401: onNeedsKey,
        fallbackMessage: t('extender.error.generateImage'),
      })
      if (!data.imageUrl) throw new Error(t('extender.error.noImage'))
      const anchorPromptUsed = generatePrompt.trim()
      if (mode === 'parallax') {
        // Route into the active layer (with chroma-keying for non-sky roles).
        await applyImageToActiveLayer(data.imageUrl, { fromUpload: false })
        setOriginalFileName(`parallax_${activeLayer?.role ?? 'layer'}.png`)
        if (layerRole === WORKFLOW_ORDER[0] && anchorPromptUsed) {
          void deriveSceneBrief(anchorPromptUsed)
        }
      } else {
        loadDataUrlAsImage(data.imageUrl, 'generated.png')
      }
      setShowGenerateModal(false)
      setGeneratePrompt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extender.error.generateImage'))
    } finally {
      setGenerating(false)
    }
  }

  // ── Extend ─────────────────────────────────────────────────────────────────

  const runExtend = useCallback(
    async (
      direction: Direction,
      sourceImage: string,
      promptText: string,
      style: string,
      /**
       * Parallax layer role hint. When provided and non-sky, the API call
       * passes the role so the model keeps the magenta key intact, and we
       * apply chroma-keying to the blended result before storing it as the
       * displayable candidate image. The pre-keying source is preserved on
       * the candidate so the next extend can feed magenta back to the model.
       */
      layerRole?: LayerRole
    ) => {
      if (!currentImageDimensions) {
        throw new Error(t('extender.error.dimensions'))
      }

      const isKeyedLayer = !!layerRole && layerRole !== 'sky'

      const callExtendApi = async (
        expandedCanvas: string,
        body: Record<string, unknown>
      ) => {
        const data = await studioRequest<{ imageUrl?: string }>(
          '/api/extend',
          {
            expandedCanvas,
            direction,
            extensionAmount: EXTENSION_PERCENT,
            customPrompt: promptText.trim() || undefined,
            artStyle: style !== 'none' ? style : undefined,
            apiKey: apiKey || undefined,
            provider,
            model: selectedModel,
            layerRole,
            sceneBrief:
              mode === 'parallax' && sceneBrief.trim()
                ? sceneBrief.trim()
                : undefined,
            ...body,
          },
          { on401: onNeedsKey, fallbackMessage: t('extender.error.extendImage') }
        )
        return data.imageUrl as string
      }

      /** Convert a raw blended image into a displayable candidate, applying
       * chroma-key alpha for keyed parallax layers. */
      const finalizeCandidate = async (
        blended: string,
        score: number,
        attempt: number
      ): Promise<Candidate> => {
        if (isKeyedLayer) {
          const keyed = await chromaKeyToAlpha(blended)
          return { imageUrl: keyed, rawImageUrl: blended, score, attempt }
        }
        return { imageUrl: blended, score, attempt }
      }

      const isHorizontal = direction === 'left' || direction === 'right'
      const modelCfg = getModelConfig(selectedModel)

      if (isHorizontal) {
        const maxAttempts = Math.max(1, modelCfg.maxAttempts)
        // Collect every candidate so the user can cycle through them and pick.
        // We no longer early-break on a "good enough" score — the user said
        // they want to see all 3 and decide themselves.
        const candidates: Candidate[] = []

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const attemptStart = Date.now()
          // Tick a live elapsed-seconds counter inside the AI call so the UI
          // doesn't feel frozen during long requests.
          const tickHandle = setInterval(() => {
            const elapsed = Math.floor((Date.now() - attemptStart) / 1000)
            const label = maxAttempts > 1
              ? t('extender.progress.variant', {
                  step: attempt + 1,
                  total: maxAttempts,
                  seconds: elapsed,
                })
              : t('extender.progress.generating', { seconds: elapsed })
            setProgressMsg(label)
          }, 1000)

          try {
            const fullResult = await createFullContextExtension(
              sourceImage,
              direction,
              EXTENSION_PERCENT
            )
            const imageUrl = await callExtendApi(fullResult.fullImageWithBlankArea, {
              useFullContext: true,
              extensionInfo: fullResult.extensionInfo,
              attempt,
            })
            if (await isAiExtensionUnfilled(imageUrl, fullResult.extensionInfo)) {
              continue
            }
            const blended = await applyFullContextResult(
              imageUrl,
              fullResult.extensionInfo,
              sourceImage
            )
            const score = await measureSeamResidual(
              blended,
              fullResult.extensionInfo,
              sourceImage
            )
            if (debugMode) {
              // eslint-disable-next-line no-console
              console.log(
                `🔬 Variant ${attempt + 1} seam residual: ${score.toFixed(2)}`
              )
            }
            candidates.push(await finalizeCandidate(blended, score, attempt + 1))
          } finally {
            clearInterval(tickHandle)
          }
        }

        if (candidates.length === 0) {
          throw new Error(
            maxAttempts > 1
              ? t('extender.error.unfilledMany', { count: maxAttempts })
              : t('extender.error.unfilledOne')
          )
        }
        // Sort best (lowest seam residual) first so the user lands on the
        // cleanest blend by default but can cycle to alternatives.
        candidates.sort((a, b) => a.score - b.score)
        return candidates
      } else {
        const attemptStart = Date.now()
        const tickHandle = setInterval(() => {
          const elapsed = Math.floor((Date.now() - attemptStart) / 1000)
          setProgressMsg(t('extender.progress.generating', { seconds: elapsed }))
        }, 1000)
        try {
          const result = await createChunkedExtension(
            sourceImage,
            direction,
            EXTENSION_PERCENT,
            40
          )
          const imageUrl = await callExtendApi(result.chunkToExtend, {
            chunkInfo: result.chunkInfo,
            useFullContext: false,
          })
          const stitched = await stitchExtendedChunk(sourceImage, imageUrl, result.chunkInfo, debugMode)
          // Vertical path produces a single variant. Wrap it so the caller
          // can treat horizontal + vertical results uniformly.
          return [{ imageUrl: stitched, score: 0, attempt: 1 }]
        } finally {
          clearInterval(tickHandle)
        }
      }
    },
    [currentImageDimensions, debugMode, apiKey, provider, selectedModel, mode, sceneBrief, t]
  )

  /**
   * Resolve which image (and which layer role, if any) the next extension
   * should operate on. In parallax mode the source is the active layer's
   * raw (un-keyed) image so the AI sees the magenta key consistently; in
   * extender mode it's just the global selectedImage.
   */
  const resolveExtendSource = (): {
    sourceImage: string | null
    layerRole?: LayerRole
  } => {
    if (mode === 'parallax') {
      const layer = activeLayer
      if (!layer || !layer.imageUrl) return { sourceImage: null }
      return {
        sourceImage: layer.rawImageUrl ?? layer.imageUrl,
        layerRole: layer.role,
      }
    }
    return { sourceImage: selectedImage }
  }

  const handleExtend = async (direction: Direction) => {
    if (loading) return
    if (!ensureCanGenerate()) return
    const { sourceImage, layerRole } = resolveExtendSource()
    if (!sourceImage) return
    setError(null)
    setLoading(true)
    setProgressMsg(
      t('extender.progress.extending', {
        direction: t(`common.direction.${direction}`),
      })
    )
    setActiveDirection(direction)
    setImageBeforeExtension(sourceImage)
    setLastExtensionParams({ direction, customPrompt, artStyle, layerRole })

    try {
      const candidates = await runExtend(
        direction,
        sourceImage,
        customPrompt,
        artStyle,
        layerRole
      )
      adoptCandidates(candidates)
    } catch (err) {
      const e = err as Error & { status?: number }
      setError(e.message || t('extender.error.occurred'))
      setActiveDirection(null)
    } finally {
      setLoading(false)
      setProgressMsg(null)
    }
  }

  const handleRegenerate = async () => {
    if (!lastExtensionParams || !imageBeforeExtension || loading) return
    if (!ensureCanGenerate()) return
    setError(null)
    setLoading(true)
    setProgressMsg(
      t('extender.progress.regenerating', {
        direction: t(`common.direction.${lastExtensionParams.direction}`),
      })
    )
    try {
      const candidates = await runExtend(
        lastExtensionParams.direction,
        imageBeforeExtension,
        lastExtensionParams.customPrompt,
        lastExtensionParams.artStyle,
        lastExtensionParams.layerRole
      )
      adoptCandidates(candidates)
    } catch (err) {
      const e = err as Error & { status?: number }
      setError(e.message || t('extender.error.occurred'))
    } finally {
      setLoading(false)
      setProgressMsg(null)
    }
  }

  const cycleVariant = (delta: 1 | -1) => {
    if (extendedCandidates.length <= 1) return
    setSelectedCandidateIdx((prev) => {
      const n = extendedCandidates.length
      return (prev + delta + n) % n
    })
  }

  /** The candidate the user is currently viewing (null when no result). */
  const activeCandidate: Candidate | null =
    extendedCandidates.length > 0
      ? extendedCandidates[Math.min(selectedCandidateIdx, extendedCandidates.length - 1)]
      : null

  const handleAccept = () => {
    if (!activeCandidate) return
    const accepted = activeCandidate.imageUrl

    if (mode === 'parallax' && activeLayer) {
      // In parallax mode, accept writes back to the active layer (display +
      // raw + dims) rather than touching the global selectedImage.
      const dims = candidateDims[selectedCandidateIdx]
      patchActiveLayer({
        imageUrl: accepted,
        rawImageUrl: activeCandidate.rawImageUrl ?? accepted,
        width: dims?.width ?? activeLayer.width,
        height: dims?.height ?? activeLayer.height,
      })
    } else {
      setSelectedImage(accepted)
      const img = new Image()
      img.onload = () => {
        setCurrentImageDimensions({ width: img.width, height: img.height })
      }
      img.src = accepted
    }
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
  }

  const handleDiscard = () => {
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
  }

  const handleDownload = () => {
    if (!activeCandidate) return
    const baseName = originalFileName.replace(/\.[^/.]+$/, '') || 'extended'
    // Tag the filename with the variant index when there are multiple, so
    // batch-downloading different cycles doesn't overwrite the same file.
    const variantTag = extendedCandidates.length > 1
      ? `_v${selectedCandidateIdx + 1}`
      : ''
    downloadUrl(activeCandidate.imageUrl, `${baseName}_extended${variantTag}.png`)
  }

  const handleNewImage = () => {
    setSelectedImage(null)
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setCurrentImageDimensions(null)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
    setError(null)
    setCustomPrompt('')
    setParallaxTargetWidth(null)
    // Parallax: blow away every populated layer when the user picks "New".
    if (mode === 'parallax') {
      setParallaxLayers(createDefaultLayers())
      setParallaxActiveIdx(LAYER_ORDER.indexOf(WORKFLOW_ORDER[0]))
      setSceneBrief('')
      setSceneBriefLoading(false)
    }
    // Tile-set: clear all 13 tiles + prompt; sceneBrief stays so the user
    // can keep iterating sets within the same project.
    if (mode === 'tile') {
      setTileSet(createEmptyTileSet())
      setTilePrompt('')
      setTileProgressMsg(null)
      tileStopRef.current = false
    }
    // Props: clear all decoration sprites + prompt; sceneBrief stays so the
    // props can keep matching the rest of the project.
    if (mode === 'props') {
      setPropItems([])
      setPropPrompt('')
      setPropProgressMsg(null)
      propStopRef.current = false
    }
    // Sprite: wipe frames + prompt + anchor; sceneBrief is kept so the
    // user can keep iterating sprites within the same project / scene.
    if (mode === 'sprite') {
      setSpriteSheet(createEmptySpriteSheet(spriteAnim))
      setSpriteAnchor(null)
      setSpritePrompt('')
      setSpriteFps(SPRITE_ANIMATIONS[spriteAnim].defaultFps)
      setSpriteProgressMsg(null)
      spriteStopRef.current = false
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /**
   * Snapshot of what the current studio would hand to the library. Reads the
   * same state the ZIP exporters read; never mutates it. Deliberately NOT
   * memoised: the builders it calls (buildTileSheetDataUrl, buildPropManifest,
   * …) are re-created every render, so a useCallback here would either be
   * invalidated on every render or close over stale state (sceneBrief lives
   * inside buildPropManifest). Pixel mode renders its own panel inside
   * PixelStudio, so it is not handled here.
   */
  const collectPendingLibraryAsset = async () => {
    if (mode === 'tile') {
      return collectStudioAsset({
        mode: 'tile',
        prompt: tilePrompt.trim() || null,
        model: selectedModel,
        tileSet: tileSet.map((s) => ({ role: s.role, imageUrl: s.imageUrl })),
        tileSheetDataUrl: await buildTileSheetDataUrl(),
        manifest: buildTileSetManifest({ prompt: tilePrompt, sceneBrief, artStyle, presentRoles: tileSet.filter((s) => s.imageUrl).map((s) => s.role) }),
      })
    }
    if (mode === 'props') {
      const populated = propItems.filter((p) => p.imageUrl)
      return collectStudioAsset({
        mode: 'props',
        prompt: propPrompt.trim() || null,
        model: selectedModel,
        propItems: populated.map((p) => ({ id: p.id, name: p.name ?? '', imageUrl: p.imageUrl })),
        propFiles: resolvePropNames(populated).map((n) => n.file),
        propAtlasDataUrl: await buildPropAtlasDataUrl(),
        manifest: buildPropManifest({ prompt: propPrompt, sceneBrief, items: propItems }),
      })
    }
    if (mode === 'sprite') {
      return collectStudioAsset({
        mode: 'sprite',
        prompt: spritePrompt.trim() || null,
        model: selectedModel,
        frames: spriteSheet.frames
          .filter((f) => f.imageUrl && !f.disabled)
          .map((f) => ({ imageUrl: f.imageUrl })),
        manifest: null,
      })
    }
    return collectStudioAsset({
      mode: mode === 'parallax' ? 'parallax' : 'extender',
      prompt: null,
      model: selectedModel,
      imageUrl: activeCandidate?.imageUrl ?? selectedImage,
      dimensions: activeCandidate
        ? candidateDims[selectedCandidateIdx] ?? null
        : currentImageDimensions,
      manifest: null,
    })
  }

  // The sprite studio: same shape — the two-pass anchor → sheet pipeline and
  // the deterministic repaint loop live in the module, the page keeps the JSX.
  const {
    spriteBodyPlan,
    spriteAnim,
    spriteSheet,
    setSpriteSheet,
    spriteGeneratedAnims,
    spriteAnchor,
    setSpriteAnchor,
    spritePrompt,
    setSpritePrompt,
    spriteFps,
    setSpriteFps,
    spriteGenerating,
    spriteProgressMsg,
    setSpriteProgressMsg,
    spriteStopRef,
    handleSelectSpriteAnim,
    handleSelectBodyPlan,
    handleGenerateSpriteSheet,
    handleRerollSpriteCharacter,
    handleUploadSpriteCharacter,
    handleRemoveUploadedCharacter,
    handleStopSpriteSheet,
    handleToggleSpriteFrame,
    handleClearSpriteSheet,
    handleDownloadSpriteSheet,
    handleDownloadSpriteZip,
  } = useSpriteStudio({
    apiKey,
    provider,
    model: selectedModel,
    artStyle,
    sceneBrief,
    debugMode,
    setError,
    ensureCanGenerate,
    onNeedsKey,
  })
  // The parallax studio: layer state, the auto-extend loop, the harmonize /
  // tileable passes and the exporters live in one module. It is called after
  // the extend pipeline and the layer mirror state it reads, and every name it
  // returns below keeps the identifier it had in the page.
  const {
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
  } = useParallaxStudio({
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
  })

  // ── Image loaders ──────────────────────────────────────────────────────────

  const loadDataUrlAsImage = useCallback(
    (dataUrl: string, filename = 'image.png') => {
      setSelectedImage(dataUrl)
      setExtendedCandidates([])
      setCandidateDims([])
      setSelectedCandidateIdx(0)
      setError(null)
      setOriginalFileName(filename)
      const img = new Image()
      img.onload = () => {
        setCurrentImageDimensions({ width: img.width, height: img.height })
      }
      img.src = dataUrl
    },
    []
  )

  /**
   * Adopts a fresh set of candidates: stores them, resets selection to the
   * top (best-blend) variant, and kicks off async dimension reads for each so
   * the meta row stays accurate as the user cycles.
   */
  const adoptCandidates = useCallback((candidates: Candidate[]) => {
    setExtendedCandidates(candidates)
    setSelectedCandidateIdx(0)
    setCandidateDims(new Array(candidates.length).fill(null))
    candidates.forEach((c, idx) => {
      const img = new Image()
      img.onload = () => {
        setCandidateDims((prev) => {
          const next = prev.slice()
          next[idx] = { width: img.width, height: img.height }
          return next
        })
      }
      img.src = c.imageUrl
    })
  }, [])

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string
        if (mode === 'parallax') {
          // Parallax uploads target the active layer, not the global image.
          // We trust user-supplied alpha (PNG with transparency works as-is).
          try {
            await applyImageToActiveLayer(dataUrl, { fromUpload: true })
            setOriginalFileName(file.name)
            setError(null)
          } catch (err) {
            setError(
              err instanceof Error ? err.message : t('extender.error.loadImage')
            )
          }
        } else if (mode === 'tile') {
          // Tile-set mode is generate-only — uploads aren't supported because
          // each tile has a strict role + magenta layout that an arbitrary
          // upload can't match. Surface a clear hint instead of silently
          // ignoring the dropped file.
          setError(t('extender.error.tilePromptOnly'))
        } else if (mode === 'sprite') {
          // Sprite mode is also generate-only — animation sheets need
          // strict 4×2 keyframe staging on a magenta key that an arbitrary
          // upload can't match.
          setError(t('extender.error.spritePromptOnly'))
        } else {
          loadDataUrlAsImage(dataUrl, file.name)
        }
      }
      reader.readAsDataURL(file)
    },
    [mode, applyImageToActiveLayer, loadDataUrlAsImage, t]
  )

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }


  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      // In parallax mode the active "image" is the active layer; in extender
      // mode it's the global selectedImage.
      const sourceAvailable =
        mode === 'parallax' ? !!activeLayer?.imageUrl : !!selectedImage
      if (!sourceAvailable || loading || parallaxAutoExtending) return
      if (activeCandidate) {
        if (e.key === 'Enter') handleAccept()
        else if (e.key === 'Escape') handleDiscard()
        else if (e.key === 'r' || e.key === 'R') handleRegenerate()
        else if (e.key === 'ArrowLeft' && extendedCandidates.length > 1) {
          e.preventDefault()
          cycleVariant(-1)
        } else if (e.key === 'ArrowRight' && extendedCandidates.length > 1) {
          e.preventDefault()
          cycleVariant(1)
        }
        return
      }
      // In parallax mode, only horizontal extends are meaningful — up/down
      // would warp the locked game height. Silently ignore them so users
      // don't accidentally break their parallax aspect ratio.
      const mapping: Record<string, Direction> = mode === 'parallax'
        ? { ArrowLeft: 'left', ArrowRight: 'right' }
        : {
            ArrowUp: 'up',
            ArrowDown: 'down',
            ArrowLeft: 'left',
            ArrowRight: 'right',
          }
      const dir = mapping[e.key]
      if (dir) {
        e.preventDefault()
        handleExtend(dir)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedImage,
    loading,
    activeCandidate,
    extendedCandidates.length,
    customPrompt,
    artStyle,
    mode,
    parallaxAutoExtending,
    activeLayer,
  ])

  // ── Render ─────────────────────────────────────────────────────────────────

  const displayImage = activeCandidate?.imageUrl ?? selectedImage
  const displayDimensions = activeCandidate
    ? candidateDims[selectedCandidateIdx] ?? null
    : currentImageDimensions
  const isResult = !!activeCandidate
  const variantCount = extendedCandidates.length

  const isParallax = mode === 'parallax'
  const isTile = mode === 'tile'
  const isSprite = mode === 'sprite'
  const isProps = mode === 'props'
  const isPixel = mode === 'pixel'

  const variantSelectorEl =
    isResult && variantCount > 1 ? (
      <VariantSelector
        index={selectedCandidateIdx}
        total={variantCount}
        isBest={selectedCandidateIdx === 0}
        score={debugMode ? activeCandidate?.score : undefined}
        onPrev={() => cycleVariant(-1)}
        onNext={() => cycleVariant(1)}
      />
    ) : undefined

  const resultActionsEl = isResult ? (
    <ResultActions
      onAccept={handleAccept}
      onRegenerate={handleRegenerate}
      onDiscard={handleDiscard}
      onDownload={handleDownload}
      loading={loading}
    />
  ) : undefined

  // Parallax mode: the studio's "edit target" is the active layer's image.
  // We compute the display image / dimensions for the active layer (or the
  // current candidate when reviewing) so the rest of the render can stay
  // mode-agnostic where possible.
  const parallaxActiveImage = isParallax
    ? activeCandidate?.imageUrl ?? activeLayer?.imageUrl ?? null
    : null
  const parallaxActiveDims = isParallax
    ? activeCandidate
      ? candidateDims[selectedCandidateIdx] ??
        (activeLayer && activeLayer.width && activeLayer.height
          ? { width: activeLayer.width, height: activeLayer.height }
          : null)
      : activeLayer && activeLayer.width && activeLayer.height
        ? { width: activeLayer.width, height: activeLayer.height }
        : null
    : null

  // Whether ANY layer in parallax mode has been populated. Drives the TopBar
  // "New image" affordance — there's no point offering to discard if the
  // project is already empty.
  const hasAnyParallaxImage = parallaxLayers.some((l) => !!l.imageUrl)
  const hasAnchorLayer = parallaxLayers.some(
    (l) => l.role === WORKFLOW_ORDER[0] && !!l.imageUrl
  )
  const showSceneDirection =
    isParallax &&
    (hasAnchorLayer || !!sceneBrief.trim() || sceneBriefLoading)

  return (
    <main className="relative flex min-h-screen flex-col">
      <TopBar
        hasImage={
          isParallax
            ? hasAnyParallaxImage
            : isTile
              ? tileSet.some((s) => s.hasImage)
              : isProps
                ? propItems.some((p) => !!p.imageUrl)
                : isSprite
                  ? spriteSheet.frames.some((f) => !!f.imageUrl)
                  : isPixel
                    ? false
                    : !!selectedImage
        }
        mode={mode}
        setMode={setMode}
        onNewImage={handleNewImage}
        onShowSettings={() => setShowSettings(true)}
      />

      {isProps ? (
        <PropStudio
          items={propItems}
          batchSize={PROP_BATCH}
          prompt={propPrompt}
          setPrompt={setPropPrompt}
          artStyle={artStyle}
          setArtStyle={setArtStyle}
          generating={propSetGenerating}
          progressMessage={propProgressMsg}
          sceneBrief={sceneBrief}
          setSceneBrief={setSceneBrief}
          sceneBriefLoading={sceneBriefLoading}
          onAddMore={handleAddPropBatch}
          onStop={handleStopPropSet}
          onRegenerate={handleRegenerateProp}
          onDelete={handleDeleteProp}
          onClearAll={handleClearPropSet}
          onDownloadSheet={handleDownloadPropSheet}
          onDownloadZip={handleDownloadPropZip}
        />
      ) : isSprite ? (
        <SpriteStudio
          sheet={spriteSheet}
          anchor={spriteAnchor}
          bodyPlan={spriteBodyPlan}
          setBodyPlan={handleSelectBodyPlan}
          selectedAnim={spriteAnim}
          setSelectedAnim={handleSelectSpriteAnim}
          generatedAnims={spriteGeneratedAnims}
          prompt={spritePrompt}
          setPrompt={setSpritePrompt}
          fps={spriteFps}
          setFps={setSpriteFps}
          artStyle={artStyle}
          setArtStyle={setArtStyle}
          generating={spriteGenerating}
          progressMessage={spriteProgressMsg}
          onGenerate={() => handleGenerateSpriteSheet()}
          onRerollCharacter={handleRerollSpriteCharacter}
          onUploadCharacter={handleUploadSpriteCharacter}
          onRemoveUploadedCharacter={handleRemoveUploadedCharacter}
          onStop={handleStopSpriteSheet}
          onClear={handleClearSpriteSheet}
          onDownloadSheet={handleDownloadSpriteSheet}
          onDownloadZip={handleDownloadSpriteZip}
          onToggleFrame={handleToggleSpriteFrame}
        />
      ) : isTile ? (
        <TileStudio
          tileSet={tileSet}
          prompt={tilePrompt}
          setPrompt={setTilePrompt}
          artStyle={artStyle}
          setArtStyle={setArtStyle}
          generating={tileSetGenerating}
          progressMessage={tileProgressMsg}
          sceneBrief={sceneBrief}
          setSceneBrief={setSceneBrief}
          sceneBriefLoading={sceneBriefLoading}
          onGenerateAll={handleGenerateTileSet}
          onStop={handleStopTileSet}
          onRegenerate={handleRegenerateTile}
          onClearAll={handleClearTileSet}
          onDownloadSheet={handleDownloadTileSheet}
          onDownloadZip={handleDownloadTileSetZip}
        />
      ) : isParallax ? (
        <ParallaxStudio
          layers={parallaxLayers}
          activeIdx={parallaxActiveIdx}
          setActiveIdx={setParallaxActiveIdx}
          onClearLayer={clearLayer}
          onScrollSpeedChange={setLayerScrollSpeed}
          activeImage={parallaxActiveImage}
          activeDimensions={parallaxActiveDims}
          onExtend={(d) => handleExtend(d)}
          activeDirection={activeDirection}
          loading={loading}
          progressMessage={progressMsg}
          isResult={isResult}
          resultMessage={
            isResult
              ? variantCount > 1
                ? t('extender.result.cycleVariants')
                : t('extender.result.ready')
              : undefined
          }
          variantSelector={variantSelectorEl}
          resultActions={resultActionsEl}
          targetWidth={parallaxTargetWidth}
          setTargetWidth={setParallaxTargetWidth}
          onAutoExtend={handleAutoExtend}
          onStopAutoExtend={handleStopAutoExtend}
          autoExtending={parallaxAutoExtending}
          onMakeTileable={handleMakeActiveLayerTileable}
          onHarmonize={handleHarmonizeActiveLayer}
          onDownloadActiveLayerPng={handleDownloadFull}
          onExportZip={handleExportZip}
          onPickFile={() => fileInputRef.current?.click()}
          onGenerate={openGenerateModal}
          onDropFile={handleFile}
        />
      ) : isPixel ? (
        <PixelStudio />
      ) : !displayImage ? (
        <EmptyState
          mode={mode}
          onPickFile={() => fileInputRef.current?.click()}
          onGenerate={openGenerateModal}
          onDropFile={handleFile}
        />
      ) : (
        <Workspace
          image={displayImage}
          dimensions={displayDimensions}
          onExtend={handleExtend}
          activeDirection={activeDirection}
          loading={loading}
          progressMessage={progressMsg}
          isResult={isResult}
          resultMessage={
            isResult
              ? variantCount > 1
                ? t('extender.result.cycleVariants')
                : t('extender.result.ready')
              : undefined
          }
          variantSelector={variantSelectorEl}
          resultActions={resultActionsEl}
        />
      )}

      {/* Asset library: pixel mode embeds its own panel inside PixelStudio. */}
      {!isPixel && (
        <div className="mx-auto w-full max-w-5xl px-4 pb-4">
          <LibraryPanel
            pending={collectPendingLibraryAsset}
            project={libraryProject}
            onProjectChange={setLibraryProject}
            onLoad={(url) => {
              // Tile, sprite and props render dedicated studios that never read
              // the global image, so loading into them would be a silent no-op
              // (their own upload buttons refuse the same way).
              if (mode === 'tile' || mode === 'sprite' || mode === 'props') {
                setError(t('extender.error.switchToExtender'))
                return
              }
              // Parallax loads into its active layer; Extender takes the global
              // image, the same path uploads take. Pixel never reaches this gate.
              if (mode === 'parallax') void applyImageToActiveLayer(url, { fromUpload: true })
              else loadDataUrlAsImage(url, 'from-library.png')
            }}
          />
        </div>
      )}

      {/* Command bar: extender mode shows it once an image exists; parallax
          mode shows it whenever the active layer has an image so users can
          tweak the prompt while iterating. Tile, Props, and Sprite modes have
          their own action bars built into the studio. */}
      {!isTile &&
        !isSprite &&
        !isProps &&
        ((isParallax && !!activeLayer?.imageUrl) ||
          (!isParallax && !!selectedImage)) &&
        !isResult &&
        !parallaxAutoExtending && (
          <CommandBar
            prompt={customPrompt}
            setPrompt={setCustomPrompt}
            artStyle={artStyle}
            setArtStyle={setArtStyle}
            loading={loading}
            hint={
              isParallax
                ? artStyle !== 'none'
                  ? t('extender.command.hintStyleParallax', {
                      style: t(
                        `common.artStyle.${artStyle}`,
                        undefined,
                        t('common.artStyle.fallback')
                      ),
                      layer: t(`common.layer.${activeLayer!.role}.short`),
                    })
                  : t('extender.command.hintParallax', {
                      layer: t(`common.layer.${activeLayer!.role}.short`),
                    })
                : artStyle !== 'none'
                  ? t('extender.command.hintStyle', {
                      style: t(
                        `common.artStyle.${artStyle}`,
                        undefined,
                        t('common.artStyle.fallback')
                      ),
                    })
                  : undefined
            }
            sceneBrief={showSceneDirection ? sceneBrief : undefined}
            setSceneBrief={showSceneDirection ? setSceneBrief : undefined}
            sceneBriefLoading={sceneBriefLoading}
          />
        )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />

      <SettingsDrawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        debugMode={debugMode}
        setDebugMode={setDebugMode}
        onGenerate={openGenerateModal}
        apiKey={apiKey}
        onEditApiKey={handleEditApiKey}
        onClearApiKey={handleClearApiKey}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        provider={provider}
        onSelectProvider={handleSelectProvider}
        qaModel={qaModel}
        setQaModel={setQaModel}
      />

      <ApiKeyModal
        open={showApiKeyModal}
        initialValue={apiKey}
        required={apiKeyRequired}
        onSave={handleSaveApiKey}
        onSkip={apiKeyRequired ? handleSkipApiKey : undefined}
        onClose={() => setShowApiKeyModal(false)}
        provider={PROVIDERS[provider]}
      />

      <GenerateModal
        open={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        prompt={generatePrompt}
        setPrompt={setGeneratePrompt}
        width={generateWidth}
        setWidth={setGenerateWidth}
        height={generateHeight}
        setHeight={setGenerateHeight}
        artStyle={artStyle}
        setArtStyle={setArtStyle}
        generating={generating}
        onGenerate={handleGenerateImage}
        workflowNote={
          mode === 'parallax' && activeLayer && !activeLayer.imageUrl
            ? (() => {
                const prereq = getWorkflowPrerequisite(
                  parallaxLayers,
                  activeLayer.role
                )
                if (!prereq) return null
                return t('extender.tip.layerPrerequisite', {
                  layer: t(`common.layer.${prereq.role}.label`),
                })
              })()
            : null
        }
        showSceneBrief={
          mode === 'parallax' &&
          !!activeLayer &&
          activeLayer.role !== WORKFLOW_ORDER[0]
        }
        sceneBrief={sceneBrief}
        setSceneBrief={setSceneBrief}
        sceneBriefLoading={sceneBriefLoading}
        layerLabel={
          mode === 'parallax' && activeLayer
            ? t(`common.layer.${activeLayer.role}.short`)
            : undefined
        }
      />

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
    </main>
  )
}
