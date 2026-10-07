'use client'
// app/lib/useSpriteStudio.ts
/**
 * The sprite-animation studio: its state and its orchestration, behind one
 * hook.
 *
 * Why it exists: the studio's eleven handlers and ten pieces of state used to
 * sit in `app/page.tsx`, a client module that every studio shares — so a change
 * to sprite generation meant reading a 3,600-line component. What stays in the
 * page is the JSX (the composition root's job) and the wiring of the studio's
 * shared settings into this hook.
 *
 * The pipeline it drives is the two-pass anchor → sheet workflow. Pass 1 paints
 * one neutral standing reference of the character on a flat magenta key ("the
 * anchor"); pass 2 paints the 4×2 sheet with that anchor as a visual reference
 * plus a deterministic pose-map guide, which is the known fix for cross-frame
 * identity drift. The anchor PERSISTS across animation switches so the same
 * character can be re-used for idle/walk/run/jump/attack/hurt/death without
 * re-rolling identity; cached sheets are keyed by `${plan}:${anim}` so switching
 * tabs never discards generated work.
 *
 * After the sheet lands, a deterministic duplicate/spillover detector counts
 * cells whose alpha mass splits in two and drives up to MAX_SPRITE_REPAINT_PASSES
 * repaints; the vision art-director pass was removed deliberately (4a8d674).
 * A separate set of pixel-level passes (scale, baseline, horizontal centering)
 * runs client-side on the sliced cells.
 */
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/app/lib/i18n'
import { toWire } from '@/app/lib/generateRequest'
import { studioRequest } from '@/app/lib/studioRequest'
import { downloadText, downloadUrl, downloadZip, type ZipEntry } from '@/app/lib/studioDownload'
import {
  SPRITE_ANIMATIONS,
  SPRITE_FRAME_COUNT,
  SPRITE_FRAME_SIZE,
  SPRITE_GRID_COLS,
  SPRITE_GRID_ROWS,
  SPRITE_SHEET_H,
  SPRITE_SHEET_W,
  SPRITE_STRIP_H,
  SPRITE_STRIP_W,
  SpriteAnimType,
  SpriteSheet,
  createEmptySpriteSheet,
} from '@/app/lib/sprite'
import type { ProviderId } from '@/app/lib/providers'
import type { ReportedCost } from '@/app/lib/libraryTypes'
import { BODY_PLANS, BodyPlan, isAirborneAnim } from '@/app/lib/bodyPlans'
import { buildSpriteManifest } from '@/app/lib/sheetManifest'
import { SubjectBounds, drawPoseGuideSheet, measureSubjectBounds } from '@/app/utils/poseRig'
import {
  alignSpriteFramesToBaseline,
  centerSpriteFramesHorizontally,
  chromaKeyToAlpha,
  isolatePrimarySpriteComponent,
  normalizeSpriteFrameScale,
  removeFrameBorder,
  removeUploadedBackground,
  sliceImageGrid,
} from '@/app/utils/imageProcessor'

/** What the sprite studio needs from the shell it lives in. */
export type SpriteStudioOptions = {
  apiKey: string
  provider: ProviderId
  model: string
  artStyle: string
  sceneBrief: string
  debugMode: boolean
  /** Surface a failure in the app's error banner. */
  setError: (message: string | null) => void
  /** Ask the user for a key when one is needed; false when they decline. */
  ensureCanGenerate: () => boolean
  onNeedsKey: () => void
}

export function useSpriteStudio({
  apiKey,
  provider,
  model: selectedModel,
  artStyle,
  sceneBrief,
  debugMode,
  setError,
  ensureCanGenerate,
  onNeedsKey,
}: SpriteStudioOptions) {
  const { t } = useI18n()
  // Sprite-animation state. One sheet at a time (the active animation type).
  // Switching animation chips creates a fresh empty sheet so each animation
  // is independent; the previous sheet is replaced rather than archived.
  //
  // Frame consistency: we use a two-pass anchor → sheet workflow. Pass 1
  // generates a single neutral standing reference of the character ("the
  // anchor"); Pass 2 generates the 8-frame sheet and passes the anchor as
  // a visual reference, which 2026's AI-sprite community identified as the
  // strongest known technique for keeping the character on-model across
  // cells (chongdashu/ai-game-spritesheets, Robotic Ape, Auto-Sprite, etc.).
  // The anchor PERSISTS across animation switches so the same character can
  // be re-used for idle/walk/run/jump/attack/hurt/death without re-rolling
  // identity.
  // Which body plan we're animating (humanoid / quadruped / serpent / flyer /
  // blob). The plan selects the deterministic pose rig, the available
  // animations, and the choreography/QA the API uses.
  const [spriteBodyPlan, setSpriteBodyPlan] = useState<BodyPlan>('biped')
  const [spriteAnim, setSpriteAnim] = useState<SpriteAnimType>('idle')
  const [spriteSheet, setSpriteSheet] = useState<SpriteSheet>(() =>
    createEmptySpriteSheet('idle')
  )
  // Per-(plan, anim) cache so switching tabs/plans doesn't discard generated
  // sheets. Keyed by `${bodyPlan}:${anim}`; the latest sheet for each is kept
  // here so the user can flip between animations and still see prior results.
  // Cleared when the character identity (anchor) or body plan changes, since
  // cached sheets belong to the previous character/plan.
  const spriteSheetCacheRef = useRef<Record<string, SpriteSheet>>({})
  const spriteCacheKey = (plan: BodyPlan, anim: SpriteAnimType) =>
    `${plan}:${anim}`
  // Set of animation types (for the CURRENT plan) that have a generated
  // (cached) sheet, used to mark those tabs with a dot.
  const [spriteGeneratedAnims, setSpriteGeneratedAnims] = useState<
    Set<SpriteAnimType>
  >(new Set())
  useEffect(() => {
    spriteSheetCacheRef.current[spriteCacheKey(spriteBodyPlan, spriteSheet.anim)] =
      spriteSheet
    const prefix = `${spriteBodyPlan}:`
    const next = new Set<SpriteAnimType>()
    for (const [key, sheet] of Object.entries(spriteSheetCacheRef.current)) {
      if (key.startsWith(prefix) && sheet && sheet.frames.some((f) => !!f.imageUrl)) {
        next.add(key.slice(prefix.length) as SpriteAnimType)
      }
    }
    setSpriteGeneratedAnims(next)
  }, [spriteSheet, spriteBodyPlan])
  const [spriteAnchor, setSpriteAnchor] = useState<{
    /** Chroma-keyed thumbnail (transparent background) for display. */
    imageUrl: string
    /** Raw magenta-background version — fed to the AI as a reference image
     * on every sheet pass. The model sees magenta naturally, transparent
     * regions less so, so we keep the un-keyed version for inference. */
    rawImageUrl: string
    /** Prompt that produced this anchor. */
    prompt: string
    /** True when the anchor came from a user-uploaded image rather than the
     * anchor generation pass. Uploaded anchors are never auto-regenerated
     * from the prompt. */
    uploaded?: boolean
  } | null>(null)
  const [spritePrompt, setSpritePrompt] = useState('')
  const [spriteFps, setSpriteFps] = useState<number>(
    SPRITE_ANIMATIONS.idle.defaultFps
  )
  const [spriteGenerating, setSpriteGenerating] = useState(false)
  const [spriteProgressMsg, setSpriteProgressMsg] = useState<string | null>(null)
  const [lastCost, setLastCost] = useState<ReportedCost | null>(null)
  const spriteStopRef = useRef(false)

  /** Switch the active sprite animation. Replaces the current sheet with a
   * fresh empty one for the new animation, but PRESERVES the character
   * anchor so the user can build idle → walk → run → jump → attack for the
   * same character without re-rolling identity. Also resets FPS to the new
   * anim's default. */
  const handleSelectSpriteAnim = (next: SpriteAnimType) => {
    if (next === spriteAnim) return
    if (spriteGenerating) return
    // Persist the current sheet, then restore a previously generated sheet for
    // the target animation if we have one cached (so the user can flip back and
    // forth without losing results). Falls back to a fresh empty sheet.
    spriteSheetCacheRef.current[spriteCacheKey(spriteBodyPlan, spriteAnim)] =
      spriteSheet
    const cached = spriteSheetCacheRef.current[spriteCacheKey(spriteBodyPlan, next)]
    setSpriteAnim(next)
    setSpriteSheet(cached ?? createEmptySpriteSheet(next))
    setSpriteFps(cached?.fps ?? SPRITE_ANIMATIONS[next].defaultFps)
    setSpriteProgressMsg(null)
  }

  /** Switch body plan. Animations, the pose rig, and the anchor identity are
   * all plan-specific, so this resets to the plan's default animation, drops
   * the previous character anchor and cached sheets, and starts clean. */
  const handleSelectBodyPlan = (next: BodyPlan) => {
    if (next === spriteBodyPlan) return
    if (spriteGenerating) return
    const plan = BODY_PLANS[next]
    const nextAnim = plan.defaultAnim
    spriteSheetCacheRef.current = {}
    setSpriteBodyPlan(next)
    setSpriteAnim(nextAnim)
    setSpriteSheet(createEmptySpriteSheet(nextAnim))
    setSpriteFps(SPRITE_ANIMATIONS[nextAnim].defaultFps)
    setSpriteAnchor(null)
    setSpriteProgressMsg(null)
    setError(null)
  }

  /**
   * Internal: generate the character ANCHOR (Pass 1 of the two-pass sprite
   * pipeline). Produces a single 512×512 neutral standing reference of the
   * character on a flat magenta key. Returns both the chroma-keyed
   * thumbnail and the un-keyed magenta version (which is what gets fed
   * back into the sheet pass).
   */
  const runSpriteAnchorPass = async (
    prompt: string
  ): Promise<{ imageUrl: string; rawImageUrl: string }> => {
    const data = await studioRequest<{ imageUrl?: string; cost?: ReportedCost | null }>(
      '/api/generate',
      toWire({
        kind: 'spriteAnchor',
        prompt,
        width: SPRITE_FRAME_SIZE,
        height: SPRITE_FRAME_SIZE,
        artStyle: artStyle !== 'none' ? artStyle : undefined,
        apiKey: apiKey || undefined,
        provider,
        model: selectedModel,
        spriteBodyPlan,
        sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
      }),
      { on401: onNeedsKey, fallbackMessage: t('extender.error.characterAnchor') }
    )
    if (!data.imageUrl) throw new Error(t('extender.error.noAnchorImage'))
    setLastCost(data.cost ?? null)
    const rawImageUrl: string = data.imageUrl
    const keyedImageUrl = await chromaKeyToAlpha(rawImageUrl)
    return { imageUrl: keyedImageUrl, rawImageUrl }
  }

  /**
   * Internal: generate the SHEET (Pass 2 of the two-pass sprite pipeline).
   *
   * Before calling the API, this builds a STRUCTURAL GUIDE image: a
   * 2048×1024 PNG with the anchor pre-composited into each of the 8 grid
   * cells at pixel-locked position/scale/baseline. The guide is then
   * passed as the reference image, so the model has a concrete spatial
   * template to anchor every frame against — not just a loose character
   * reference. This is the headline fix for position/scale flicker: text
   * directives alone ("same baseline", "same scale") aren't strong
   * enough; the model needs to *see* the layout.
   *
   * Splits the resulting 4×2 grid into 8 cells, chroma-keys each, and
   * returns the processed frames.
   */
  const runSpriteSheetPass = async (
    prompt: string,
    anchorRawUrl: string | null,
    fixNotes?: string
  ): Promise<{
    rawSheetUrl: string
    keyedCells: string[]
    keyedSheetUrl: string | null
  }> => {
    let guideImage: string | undefined
    if (anchorRawUrl) {
      try {
        guideImage = await buildSpriteSheetGuideDataUrl(anchorRawUrl)
      } catch (err) {
        console.warn('Sprite guide build failed; proceeding without it:', err)
      }
    }
    const data = await studioRequest<{ imageUrl?: string; cost?: ReportedCost | null }>(
      '/api/generate',
      toWire({
        kind: 'spriteSheet',
        prompt,
        width: SPRITE_SHEET_W,
        height: SPRITE_SHEET_H,
        artStyle: artStyle !== 'none' ? artStyle : undefined,
        apiKey: apiKey || undefined,
        provider,
        model: selectedModel,
        spriteAnim,
        spriteBodyPlan,
        spriteFrameCount: SPRITE_FRAME_COUNT,
        spriteGridCols: SPRITE_GRID_COLS,
        spriteGridRows: SPRITE_GRID_ROWS,
        spriteFrameSize: SPRITE_FRAME_SIZE,
        spriteGuideImage: guideImage,
        // The pose-map guide carries STRUCTURE (correct per-frame poses);
        // the raw anchor carries IDENTITY (outfit, palette, proportions).
        // Sending both lets the model skin a known character onto a known
        // pose instead of inventing either.
        spritePoseGuide: Boolean(guideImage),
        spriteIdentityImage: anchorRawUrl ?? undefined,
        spriteFixNotes: fixNotes,
        sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
      }),
      { on401: onNeedsKey, fallbackMessage: t('extender.error.spriteSheet') }
    )
    if (!data.imageUrl) throw new Error(t('extender.error.noImage'))
    setLastCost(data.cost ?? null)
    const rawSheetUrl: string = data.imageUrl
    const rawCells = await sliceImageGrid(rawSheetUrl, {
      cols: SPRITE_GRID_COLS,
      rows: SPRITE_GRID_ROWS,
      cellSize: SPRITE_FRAME_SIZE,
    })
    const keyedCells = await Promise.all(
      rawCells.map(async (cellUrl) => {
        const keyed = await chromaKeyToAlpha(cellUrl)
        // Strip any dark cell-divider/border line the model painted around the
        // frame. It isn't magenta, so chroma-keying leaves it as a dark square
        // outline; this erases full-span border bands at the cell edges.
        let cleaned = keyed
        try {
          cleaned = await removeFrameBorder(cleaned)
        } catch {
          cleaned = keyed
        }
        // Non-humanoid generations, especially long quadrupeds, can still
        // duplicate/spill across a hidden cell boundary. Keep the main
        // connected creature silhouette and erase detached secondary copies
        // before alignment/playback/export.
        if (spriteBodyPlan !== 'biped') {
          try {
            // Compact bodies (quadruped/blob) can have two creatures fused by a
            // thin bridge; allow morphological splitting for them. Thin subjects
            // (serpent/flyer) must NOT be split or erosion would fragment them.
            const enableSplit =
              spriteBodyPlan === 'quadruped' || spriteBodyPlan === 'blob'
            cleaned = await isolatePrimarySpriteComponent(cleaned, { enableSplit })
          } catch {
            // Keep the prior cleanup if component isolation fails.
          }
        }
        return cleaned
      })
    )

    // Scale normalization — the model redraws the character at a slightly
    // different size in every cell, so the silhouette "breathes" during
    // playback. Rescale each frame toward the median silhouette size BEFORE
    // baseline/horizontal passes re-seat position, so the creature holds one
    // constant scale frame to frame. Runs for every body plan (humanoid too).
    let alignedCells = keyedCells
    try {
      const scaled = await normalizeSpriteFrameScale(keyedCells, {
        tolerance: 0.05,
        maxScaleAdjust: 0.18,
      })
      alignedCells = scaled.cells
      // eslint-disable-next-line no-console
      console.log('[Sprite] Scale normalization:', {
        target: scaled.targetSize,
        sizes: scaled.sizes,
        scales: scaled.scales,
      })
    } catch (err) {
      console.warn('Sprite scale normalization failed; using raw cells:', err)
    }

    // Baseline alignment — pixel-level post-process that kills the remaining
    // y-axis drift the model can't fully suppress. Grounded animations plant
    // every frame on a fixed in-cell ground line; airborne/flying animations
    // anchor their most-grounded pose to that same line and rigidly carry the
    // remaining frames so genuine lifts (jump/run/flight) are preserved.
    try {
      const hasAirborne = isAirborneAnim(spriteBodyPlan, spriteAnim)
      // Fixed in-cell ground line shared by every animation so a walk and a run
      // of the same creature rest on the SAME floor. Grounded anims plant each
      // frame to it; airborne anims anchor their most-grounded pose to it and
      // rigidly carry the rest (preserving the lift).
      const alignment = await alignSpriteFramesToBaseline(alignedCells, {
        groundAll: !hasAirborne,
        targetBaseline: Math.round(SPRITE_FRAME_SIZE * 0.9),
      })
      alignedCells = alignment.cells
      // eslint-disable-next-line no-console
      console.log('[Sprite] Baseline alignment:', {
        target: alignment.targetBaseline,
        detected: alignment.detected,
        shifted: alignment.shifted,
      })
    } catch (err) {
      console.warn('Sprite baseline alignment failed; using raw cells:', err)
    }

    // Horizontal centering — pins each frame's center of mass to the cell
    // center, so the character is centered in-frame and doesn't slide left/
    // right across cells (kills horizontal "in place" drift on walk/run).
    try {
      const centering = await centerSpriteFramesHorizontally(alignedCells, {
        mode: 'cellCenter',
      })
      alignedCells = centering.cells
      // eslint-disable-next-line no-console
      console.log('[Sprite] Horizontal centering:', {
        target: centering.targetCenterX,
        detected: centering.detected,
        shifted: centering.shifted,
      })
    } catch (err) {
      console.warn('Sprite horizontal centering failed; using prior cells:', err)
    }

    const keyedSheetUrl = await composeSpriteGridSheet(alignedCells)
    return { rawSheetUrl, keyedCells: alignedCells, keyedSheetUrl }
  }

  /** Deterministic twin/spillover detector. A correct frame is ONE centered
   * figure → its alpha mass profile is a single hump on both axes. When the
   * model paints two characters side-by-side OR lets a creature spill from the
   * row above/below into this sliced cell, the alpha profile splits into two
   * comparable humps with a clear empty valley. We flag only when the second
   * hump carries a substantial fraction of the first hump's mass, so an
   * extended tail/weapon/wing does not trip it. Returns the number of cells
   * that look duplicated or grid-spilled. Best-effort — returns 0 if anything
   * fails. */
  const detectSpriteDuplicateCells = async (cells: string[]): Promise<number> => {
    const W = 100 // downscaled analysis width — fast, plenty for column stats
    const H = 100
    const hasSplitMass = (profile: number[]) => {
      const peak = Math.max(...profile)
      if (peak <= 0) return false
      const occThresh = peak * 0.06
      // Segment occupied runs; only an empty gap at least 5% of the dimension
      // separates two figures (bridges tiny internal gaps between legs/tails).
      const minGap = Math.max(3, Math.round(profile.length * 0.05))
      const segments: { mass: number }[] = []
      let cur: number | null = null
      let gap = 0
      for (let i = 0; i < profile.length; i++) {
        if (profile[i] > occThresh) {
          if (cur === null) {
            segments.push({ mass: 0 })
            cur = segments.length - 1
          }
          segments[cur].mass += profile[i]
          gap = 0
        } else if (cur !== null) {
          gap++
          if (gap >= minGap) cur = null
        }
      }
      if (segments.length < 2) return false
      segments.sort((a, b) => b.mass - a.mass)
      // Two comparable masses ⇒ a real twin / spillover; a limb/tail is smaller.
      return segments[1].mass >= segments[0].mass * 0.45
    }
    const analyze = (url: string): Promise<boolean> =>
      new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            canvas.width = W
            canvas.height = H
            const ctx = canvas.getContext('2d')
            if (!ctx) return resolve(false)
            ctx.clearRect(0, 0, W, H)
            ctx.drawImage(img, 0, 0, W, H)
            const { data } = ctx.getImageData(0, 0, W, H)
            const colMass = new Array<number>(W).fill(0)
            const rowMass = new Array<number>(H).fill(0)
            for (let y = 0; y < H; y++) {
              for (let x = 0; x < W; x++) {
                const alpha = data[(y * W + x) * 4 + 3]
                colMass[x] += alpha
                rowMass[y] += alpha
              }
            }
            resolve(hasSplitMass(colMass) || hasSplitMass(rowMass))
          } catch {
            resolve(false)
          }
        }
        img.onerror = () => resolve(false)
        img.src = url
      })
    try {
      const flags = await Promise.all(cells.map(analyze))
      return flags.filter(Boolean).length
    } catch {
      return 0
    }
  }

  /**
   * Generate the sprite sheet — orchestrates the two-pass anchor → sheet
   * workflow. If an anchor exists (from a previous run or a previous
   * animation type for the same character), the anchor pass is SKIPPED and
   * we re-use the existing reference; otherwise we run anchor pass first.
   *
   * This is the headline frame-consistency fix: by handing the model a
   * concrete visual reference of the character before asking it to paint 8
   * keyframes, the cross-frame identity drift ("flicker") drops sharply.
   * Backed by independent findings from chongdashu/ai-game-spritesheets,
   * Robotic Ape, Auto-Sprite, and the Google Cloud Nano Banana prompting
   * guide — all of 2026.
   */
  const handleGenerateSpriteSheet = async ({
    forceNewAnchor = false,
  }: { forceNewAnchor?: boolean } = {}) => {
    if (spriteGenerating) return
    // An uploaded character supplies the identity, so a text prompt is
    // optional in that case; otherwise we need a description to lock identity.
    const hasUploadedAnchor = !!spriteAnchor?.uploaded
    if (!spritePrompt.trim() && !hasUploadedAnchor) {
      setError(t('extender.error.describeCharacter'))
      return
    }
    if (!ensureCanGenerate()) return
    setError(null)
    spriteStopRef.current = false
    setSpriteGenerating(true)
    const startedAt = Date.now()

    // Prompt sent to the sheet pass. With an uploaded character the appearance
    // comes from the reference image, so fall back to a neutral description.
    const effectivePrompt =
      spritePrompt.trim() || 'the character shown in the reference image'

    // Reset the sheet up front so the UI reads as "fresh generation in
    // progress" while we wait for the API.
    setSpriteSheet((prev) => ({
      ...prev,
      anim: spriteAnim,
      frames: prev.frames.map((f) => ({ ...f, imageUrl: null })),
      gridSheetUrl: null,
      rawGridSheetUrl: null,
      prompt: effectivePrompt,
    }))

    // Anchor pass — needed if:
    //   • No anchor exists yet, OR
    //   • The user explicitly asked to re-roll the character, OR
    //   • The prompt changed since the existing anchor was made.
    // Uploaded anchors are never regenerated from the prompt — the image IS
    // the source of truth for identity.
    const needsNewAnchor =
      forceNewAnchor ||
      !spriteAnchor ||
      (!spriteAnchor.uploaded &&
        spriteAnchor.prompt.trim() !== spritePrompt.trim())

    if (needsNewAnchor) {
      setSpriteAnchor(null)
      // The character is changing, so previously cached animations belong to
      // the old identity — drop them to avoid mixing characters across tabs.
      spriteSheetCacheRef.current = {}
    }

    // Up to this many extra repaint passes after the first sheet. Each one is
    // driven by the deterministic duplicate/spillover check below — there is no
    // model review that could ask for one.
    const MAX_SPRITE_REPAINT_PASSES = 2
    let phaseLabel = needsNewAnchor
      ? t('extender.phase.lockingCharacter')
      : t('extender.phase.paintingFrames')
    const tickHandle = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setSpriteProgressMsg(t('extender.progress.phase', { phase: phaseLabel, seconds: elapsed }))
    }, 1000)

    try {
      let anchorRef = spriteAnchor
      if (needsNewAnchor) {
        const anchorResult = await runSpriteAnchorPass(effectivePrompt)
        if (spriteStopRef.current) return
        anchorRef = {
          imageUrl: anchorResult.imageUrl,
          rawImageUrl: anchorResult.rawImageUrl,
          prompt: effectivePrompt,
        }
        setSpriteAnchor(anchorRef)
      }

      // Pass 2: paint the sheet, then count cells whose alpha mass splits in
      // two (a duplicate creature, or a spillover from the neighbouring row or
      // column) and repaint with a fix instruction if any. That check is the
      // whole critic: the vision art-director pass was removed deliberately
      // (4a8d674, "fast and predictable"), and /api/sprite-review stays
      // reachable for anyone who wants it. The anchor identity is reused on
      // every repaint so the character stays on-model, and the frames stay in
      // their loading state while the repaint runs.
      phaseLabel = t('extender.phase.paintingFrames')
      let sheetResult = await runSpriteSheetPass(
        effectivePrompt,
        anchorRef?.rawImageUrl ?? null
      )
      if (spriteStopRef.current) return

      for (let pass = 0; pass < MAX_SPRITE_REPAINT_PASSES; pass++) {
        phaseLabel = t('extender.progress.checkingFrames')
        setSpriteProgressMsg(t('extender.progress.checkingFrames'))

        const twinCount = await detectSpriteDuplicateCells(sheetResult.keyedCells)
        if (spriteStopRef.current) return
        if (twinCount === 0) {
          if (debugMode) {
            // eslint-disable-next-line no-console
            console.log('🎭 no duplicate or spillover cells — keeping this sheet')
          }
          break
        }

        const fixNotes = `CRITICAL DEFECT: ${twinCount} cell(s) contain duplicate/spillover creatures: either two copies in one cell, or a full creature plus a cropped partial creature/body part from a neighbouring row/column. Paint EXACTLY ONE single character per ${SPRITE_FRAME_SIZE}×${SPRITE_FRAME_SIZE} cell, centered and scaled down with a clear magenta gutter; no head, tail, wing, leg, body, fur, shadow, or motion shape may cross a hidden cell boundary. This is the highest-priority fix. `
        if (debugMode) {
          // eslint-disable-next-line no-console
          console.log(`🎭 QA rejected (twins: ${twinCount}), repainting with notes:`, fixNotes)
        }

        phaseLabel = t('extender.phase.repaintingFrames', { pass: pass + 2 })
        setSpriteProgressMsg(t('extender.progress.duplicateRepainting'))
        sheetResult = await runSpriteSheetPass(
          effectivePrompt,
          anchorRef?.rawImageUrl ?? null,
          fixNotes
        )
        if (spriteStopRef.current) return
      }

      setSpriteSheet((prev) => ({
        ...prev,
        anim: spriteAnim,
        frames: sheetResult.keyedCells.map((url, i) => ({
          index: i,
          imageUrl: url,
        })),
        gridSheetUrl: sheetResult.keyedSheetUrl,
        rawGridSheetUrl: sheetResult.rawSheetUrl,
        prompt: effectivePrompt,
        fps: spriteFps,
      }))
    } catch (err) {
      setSpriteSheet((prev) => ({
        ...prev,
        frames: prev.frames.map((f) => ({ ...f, imageUrl: null })),
      }))
      setError(
        err instanceof Error ? err.message : t('extender.error.spriteSheet')
      )
    } finally {
      clearInterval(tickHandle)
      setSpriteGenerating(false)
      setSpriteProgressMsg(null)
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      // eslint-disable-next-line no-console
      if (debugMode) console.log(`🎭 Sprite sheet generated in ${elapsed}s`)
    }
  }

  /** Discard the current anchor + sheet and re-run the full two-pass
   * pipeline. Use this when you want a completely fresh character (vs.
   * keeping the same character and only re-rolling poses for the current
   * animation, which is what the main "Generate" button does). */
  const handleRerollSpriteCharacter = () => {
    if (spriteGenerating) return
    handleGenerateSpriteSheet({ forceNewAnchor: true })
  }

  /**
   * Turn an arbitrary uploaded character image into a sprite anchor that
   * matches what the generation pass produces: the subject is contained inside
   * a single SPRITE_FRAME_SIZE cell, bottom-aligned with margin, on a magenta
   * background (the AI reads magenta as background more reliably than alpha).
   * Returns both the magenta version (for the AI) and a chroma-keyed,
   * transparent version (for display).
   */
  const buildSpriteAnchorFromUpload = async (
    rawDataUrl: string
  ): Promise<{ imageUrl: string; rawImageUrl: string }> => {
    // Strip any baked-in checkerboard / solid backdrop first (no-op for assets
    // that already have real transparency) so it doesn't get composited as art.
    let dataUrl = rawDataUrl
    try {
      dataUrl = await removeUploadedBackground(rawDataUrl)
    } catch {
      dataUrl = rawDataUrl
    }
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = async () => {
        try {
          const S = SPRITE_FRAME_SIZE
          const canvas = document.createElement('canvas')
          canvas.width = S
          canvas.height = S
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error(t('extender.error.sheetCanvas')))
          // Magenta backdrop — transparent areas of the upload become magenta,
          // exactly like a generated anchor.
          ctx.fillStyle = '#FF00FF'
          ctx.fillRect(0, 0, S, S)
          // Contain the character with margin, feet near the bottom (~94%).
          const maxW = S * 0.84
          const maxH = S * 0.9
          const scale = Math.min(maxW / img.width, maxH / img.height)
          const dw = img.width * scale
          const dh = img.height * scale
          const dx = (S - dw) / 2
          const dy = S * 0.95 - dh
          ctx.imageSmoothingEnabled = true
          ctx.drawImage(img, dx, dy, dw, dh)
          const rawImageUrl = canvas.toDataURL('image/png')
          const imageUrl = await chromaKeyToAlpha(rawImageUrl)
          resolve({ imageUrl, rawImageUrl })
        } catch (err) {
          reject(err)
        }
      }
      img.onerror = () => reject(new Error(t('extender.error.uploadedLoad')))
      img.src = dataUrl
    })
  }

  /** Accept a user-supplied character image and lock it in as the anchor so the
   * sheet pass animates THAT character instead of generating a new one. */
  const handleUploadSpriteCharacter = async (file: File) => {
    if (spriteGenerating) return
    if (!file.type.startsWith('image/')) {
      setError(t('extender.error.chooseImageFile'))
      return
    }
    setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error(t('extender.error.readFile')))
        reader.readAsDataURL(file)
      })
      const { imageUrl, rawImageUrl } = await buildSpriteAnchorFromUpload(dataUrl)
      // A new character → drop cached animations from the previous one and
      // clear the current sheet so the user starts clean.
      spriteSheetCacheRef.current = {}
      setSpriteAnchor({
        imageUrl,
        rawImageUrl,
        prompt: spritePrompt.trim() || 'Uploaded character',
        uploaded: true,
      })
      setSpriteSheet(createEmptySpriteSheet(spriteAnim))
      setSpriteProgressMsg(null)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('extender.error.uploadedProcess')
      )
    }
  }

  /** Remove the uploaded character so the user can switch back to a starter
   * preset or their own prompt. Keeps the typed prompt intact; drops the
   * anchor, the orphaned cached animations, and the current sheet. */
  const handleRemoveUploadedCharacter = () => {
    if (spriteGenerating) return
    spriteSheetCacheRef.current = {}
    setSpriteAnchor(null)
    setSpriteSheet(createEmptySpriteSheet(spriteAnim))
    setSpriteProgressMsg(null)
    setError(null)
  }

  const handleStopSpriteSheet = () => {
    spriteStopRef.current = true
  }

  /** Toggle a single frame's excluded state. Excluded frames are dropped from
   * playback and from every export (grid, strip, per-frame ZIP, manifest). */
  const handleToggleSpriteFrame = (index: number) => {
    setSpriteSheet((prev) => ({
      ...prev,
      frames: prev.frames.map((f) =>
        f.index === index && f.imageUrl
          ? { ...f, disabled: !f.disabled }
          : f
      ),
    }))
  }

  const handleClearSpriteSheet = () => {
    spriteSheetCacheRef.current = {}
    setSpriteSheet(createEmptySpriteSheet(spriteAnim))
    setSpriteAnchor(null)
    setSpritePrompt('')
    setSpriteProgressMsg(null)
    setSpriteFps(SPRITE_ANIMATIONS[spriteAnim].defaultFps)
    spriteStopRef.current = false
    setError(null)
  }

  /**
   * Build the POSE-MAP GUIDE that's fed to the sheet-generation pass.
   *
   * The old approach stamped the SAME neutral anchor into all 8 cells and
   * begged the model (in text) to "ignore that pose and do the walk cycle
   * instead." That fails: a diffusion model obeys an image guide far more
   * strongly than text, so the dominant signal said "stand still" in every
   * cell and the model copied neutral or drifted into random leg phases.
   *
   * The new approach renders a deterministic skeletal MANNEQUIN per frame
   * (see utils/poseRig) in the exact, biomechanically-correct pose that
   * frame must hold — a from-scratch ControlNet/OpenPose-style pose map.
   * The motion is now guaranteed correct by code; the model only has to
   * skin the character onto each pose. Identity/appearance is supplied
   * separately via the raw anchor image (see runSpriteSheetPass), so the
   * model gets "what the character looks like" + "what pose to hold."
   *
   * We measure the anchor's bounding box so the mannequin matches the
   * character's height, horizontal center, and foot baseline — keeping the
   * pose map aligned with the identity reference and the downstream
   * baseline-alignment pass.
   */
  const buildSpriteSheetGuideDataUrl = async (
    anchorRawImageUrl: string
  ): Promise<string> => {
    const subject = await measureAnchorSubject(anchorRawImageUrl)
    const canvas = document.createElement('canvas')
    canvas.width = SPRITE_SHEET_W
    canvas.height = SPRITE_SHEET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(t('extender.error.spriteGuideCanvas'))
    ctx.imageSmoothingEnabled = true
    drawPoseGuideSheet(ctx, {
      anim: spriteAnim,
      bodyPlan: spriteBodyPlan,
      cols: SPRITE_GRID_COLS,
      rows: SPRITE_GRID_ROWS,
      cellSize: SPRITE_FRAME_SIZE,
      frameCount: SPRITE_FRAME_COUNT,
      subject,
    })
    return canvas.toDataURL('image/png')
  }

  /**
   * Measure where the character sits inside a single anchor cell (height,
   * horizontal center, foot baseline) so the rendered pose mannequin matches
   * the character's body plan. Falls back to sensible defaults if the anchor
   * can't be measured (e.g. solid/empty frame).
   */
  const measureAnchorSubject = async (
    anchorRawImageUrl: string
  ): Promise<SubjectBounds> => {
    const fallback: SubjectBounds = {
      height: Math.round(SPRITE_FRAME_SIZE * 0.78),
      centerX: SPRITE_FRAME_SIZE / 2,
      baseline: Math.round(SPRITE_FRAME_SIZE * 0.92),
    }
    try {
      return await new Promise<SubjectBounds>((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = SPRITE_FRAME_SIZE
          c.height = SPRITE_FRAME_SIZE
          const cx = c.getContext('2d')
          if (!cx) return resolve(fallback)
          cx.drawImage(img, 0, 0, SPRITE_FRAME_SIZE, SPRITE_FRAME_SIZE)
          const { data } = cx.getImageData(
            0,
            0,
            SPRITE_FRAME_SIZE,
            SPRITE_FRAME_SIZE
          )
          const measured = measureSubjectBounds(
            data,
            SPRITE_FRAME_SIZE,
            SPRITE_FRAME_SIZE
          )
          resolve(measured ?? fallback)
        }
        img.onerror = () => resolve(fallback)
        img.src = anchorRawImageUrl
      })
    } catch {
      return fallback
    }
  }

  /** Stitch keyed cells into a 4×2 grid PNG. Used for manifest export. */
  const composeSpriteGridSheet = async (
    cells: string[]
  ): Promise<string | null> => {
    if (cells.length === 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = SPRITE_SHEET_W
    canvas.height = SPRITE_SHEET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    await Promise.all(
      cells.map(
        (url, i) =>
          new Promise<void>((resolve, reject) => {
            const r = Math.floor(i / SPRITE_GRID_COLS)
            const c = i % SPRITE_GRID_COLS
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(
                img,
                c * SPRITE_FRAME_SIZE,
                r * SPRITE_FRAME_SIZE,
                SPRITE_FRAME_SIZE,
                SPRITE_FRAME_SIZE
              )
              resolve()
            }
            img.onerror = () => reject(new Error(t('extender.error.loadFrame', { index: i })))
            img.src = url
          })
      )
    )
    return canvas.toDataURL('image/png')
  }

  /** Stitch keyed cells into a single horizontal strip (1 row × N frames).
   * Most 2D engines (Phaser, Unity 2D, Godot, Defold) prefer this layout. */
  const composeSpriteStripSheet = async (
    cells: string[]
  ): Promise<string | null> => {
    if (cells.length === 0) return null
    const canvas = document.createElement('canvas')
    // Size to the number of frames actually being exported so excluded frames
    // don't leave transparent gaps on the right of the strip.
    canvas.width = cells.length * SPRITE_FRAME_SIZE
    canvas.height = SPRITE_STRIP_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    await Promise.all(
      cells.map(
        (url, i) =>
          new Promise<void>((resolve, reject) => {
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(
                img,
                i * SPRITE_FRAME_SIZE,
                0,
                SPRITE_FRAME_SIZE,
                SPRITE_FRAME_SIZE
              )
              resolve()
            }
            img.onerror = () => reject(new Error(t('extender.error.loadFrame', { index: i })))
            img.src = url
          })
      )
    )
    return canvas.toDataURL('image/png')
  }

  const handleDownloadSpriteSheet = async () => {
    try {
      const populated = spriteSheet.frames.filter(
        (f) => !!f.imageUrl && !f.disabled
      )
      if (populated.length === 0) {
        setError(
          spriteSheet.frames.some((f) => !!f.imageUrl)
            ? t('extender.error.framesExcludedDownload')
            : t('extender.error.generateSheetFirstDownload')
        )
        return
      }
      const cellUrls = populated.map((f) => f.imageUrl as string)
      // Always recompose from the kept cells (cached gridSheetUrl still
      // contains excluded frames).
      const grid = await composeSpriteGridSheet(cellUrls)
      const strip = await composeSpriteStripSheet(cellUrls)
      const baseName = `${spriteAnim}_${(
        spritePrompt.trim().slice(0, 24) || 'sprite'
      ).replace(/[^a-z0-9]+/gi, '_')}`

      if (grid) {
        downloadUrl(grid, `${baseName}_grid_${SPRITE_SHEET_W}x${SPRITE_SHEET_H}.png`)
      }
      if (strip) {
        downloadUrl(strip, `${baseName}_strip_${SPRITE_STRIP_W}x${SPRITE_STRIP_H}.png`)
      }
      // Manifest as sidecar JSON.
      downloadText(JSON.stringify(buildSpriteManifest({ anim: spriteAnim, bodyPlan: spriteBodyPlan, fps: spriteFps, prompt: spritePrompt, sheetPrompt: spriteSheet.prompt, sceneBrief, artStyle, frames: populated }), null, 2), `${baseName}_manifest.json`)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('extender.error.exportSpriteSheet')
      )
    }
  }

  const handleDownloadSpriteZip = async () => {
    try {
      const populated = spriteSheet.frames.filter(
        (f) => !!f.imageUrl && !f.disabled
      )
      if (populated.length === 0) {
        setError(
          spriteSheet.frames.some((f) => !!f.imageUrl)
            ? t('extender.error.framesExcludedExport')
            : t('extender.error.generateSheetFirstExport')
        )
        return
      }
      const cellUrls = populated.map((f) => f.imageUrl as string)
      // Per-frame PNGs (engines that prefer one file per frame). Reindexed to
      // contiguous positions so filenames match the repacked manifest/strip.
      const entries: ZipEntry[] = populated.map((f, i) => ({
        name: `frame_${String(i + 1).padStart(2, '0')}.png`,
        dataUrl: f.imageUrl as string,
      }))
      const grid = await composeSpriteGridSheet(cellUrls)
      if (grid) entries.push({ name: 'sheet.png', dataUrl: grid })
      // Horizontal strip for engines that want one row.
      const strip = await composeSpriteStripSheet(cellUrls)
      if (strip) entries.push({ name: 'strip.png', dataUrl: strip })
      entries.push({ name: 'manifest.json', text: JSON.stringify(buildSpriteManifest({ anim: spriteAnim, bodyPlan: spriteBodyPlan, fps: spriteFps, prompt: spritePrompt, sheetPrompt: spriteSheet.prompt, sceneBrief, artStyle, frames: populated }), null, 2) })

      const baseName = `${spriteAnim}_${(
        spritePrompt.trim().slice(0, 24) || 'sprite'
      ).replace(/[^a-z0-9]+/gi, '_')}`
      await downloadZip(`${baseName}_sprite.zip`, entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extender.error.exportZip'))
    }
  }

  return {
    spriteBodyPlan,
    lastCost,
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
  }
}
