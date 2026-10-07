// app/utils/tileFinish.ts
/**
 * Tile finishing — the composition that turns a raw tile-sheet image from the
 * model into tiles an engine can import: align to the template, slice the grid,
 * key each cell by role, seal the loop edges, reconcile the corners, and
 * assemble the two composites the rest of the app asks for (the QA preview and
 * the raw atlas).
 *
 * Why it exists: the *steps* live in `imageProcessor` and `tileset`, but the
 * order used to be written twice — once in `app/page.tsx` for the browser
 * studios, once in `cli/native/bridge.mjs` for the CLI — and the role ladder
 * plus the feather mask were copied between the two (the bridge's copy even
 * said "mirrors page.tsx"). Two callers of one chain is a seam; this is the
 * module behind it, so the CLI adapter and the page adapter share the order
 * instead of each owning a copy of it.
 *
 * DOM-bound by nature (canvas, `Image`), so it is an `app/utils` module and
 * reaches the headless browser through the same bundle as the rest.
 */
import { CHROMA_PRESETS } from '@/app/lib/chromaPresets'
import {
  TILE_TEMPLATE_CELL,
  TILE_TEMPLATE_COLS,
  TILE_TEMPLATE_ROWS,
  TILE_TEMPLATE_SAMPLES,
  TILESET_SHEET_H,
  TILESET_SHEET_W,
  TILESET_SLOTS,
  TILESET_TILE_SIZE,
  applyFeatheredRoleMask,
  alignAiOutputToTemplate,
  reconcileAllCorners,
  templateRoleForCell,
  type TileSetRole,
} from '@/app/lib/tileset'
import {
  chromaKeyToAlpha,
  makeHorizontallyTileable,
  makeTileable2D,
  makeVerticallyTileable,
  sliceImageGrid,
} from '@/app/utils/imageProcessor'

/** A role → image map: the shape every caller here passes around. */
export type TileUrlMap = Partial<Record<TileSetRole, string>>

/** The chroma tuning for tile material — aggressive, because tile art has no
 * natural magenta cast, and the model renders cut boundaries as faint pink. */
export const TILE_CHROMA = CHROMA_PRESETS.tile

/** Fraction of a cell sealed along a loop axis, on both ends. */
const LOOP_BLEND_RATIO = 0.22

/** The QA preview composites at 96px cells; the atlas uses the real cell size. */
export const TILE_PREVIEW_CELL = 96

/** Load one image, or null when it will not load. */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  const { promise, resolve } = Promise.withResolvers<HTMLImageElement | null>()
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => resolve(null)
  img.src = src
  return promise
}

/** Re-apply the role mask so a keyed tile keeps only its autotile region. */
export async function enforceTileRoleMask(role: TileSetRole, imageUrl: string): Promise<string> {
  if (role === 'body') return imageUrl
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const w = img.width
    const h = img.height
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('tile mask: no 2d context'))
      return
    }
    ctx.drawImage(img, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)
    applyFeatheredRoleMask(
      imageData.data,
      w,
      h,
      role,
      Math.round(w / 4),
      Math.round(h / 4)
    )
    ctx.putImageData(imageData, 0, 0)
    resolve(canvas.toDataURL('image/png'))
  }
  img.onerror = () => reject(new Error('tile mask: image load failed'))
  img.src = imageUrl
  return promise
}

/**
 * One cell → a finished tile. Body is fully opaque, so it only needs the pink
 * lines neutralized (despill) and a strong loop seal — it repeats many times
 * in the preview, where edge drift reads as grid lines. Edge tiles seal only
 * along their uncut axis, and they seal *before* keying so the tiler sees
 * opaque pixels. Corners only need the magenta keyed away.
 */
export async function finishTileCell(
  role: TileSetRole,
  rawImageUrl: string,
  cell: number = TILESET_TILE_SIZE
): Promise<string> {
  if (role === 'body') {
    const despilled = await chromaKeyToAlpha(rawImageUrl, CHROMA_PRESETS.despill)
    return makeTileable2D(despilled, {
      equalizeStrength: 1,
      blendWidthPx: Math.round(cell * LOOP_BLEND_RATIO),
      verticalBlendHeightPx: Math.round(cell * LOOP_BLEND_RATIO),
    })
  }
  if (role === 'top' || role === 'bottom') {
    const tiled = await makeHorizontallyTileable(rawImageUrl)
    return enforceTileRoleMask(role, await chromaKeyToAlpha(tiled, TILE_CHROMA))
  }
  if (role === 'left' || role === 'right') {
    const tiled = await makeVerticallyTileable(rawImageUrl)
    return enforceTileRoleMask(role, await chromaKeyToAlpha(tiled, TILE_CHROMA))
  }
  return enforceTileRoleMask(role, await chromaKeyToAlpha(rawImageUrl, TILE_CHROMA))
}

/** The steps a caller may want to announce or interrupt between. */
export type TileFinishStep = 'align' | 'slice' | 'finish' | 'reconcile'

export type FinishedTileSheet = {
  /** The sliced cell grid, in template order. */
  cells: string[]
  /** Each role's raw cell, before finishing — what the library keeps as `raw/`. */
  raw: TileUrlMap
  /** The finished, corner-reconciled tile per role. */
  byRole: TileUrlMap
  alignFailed: boolean
  reconcileFailed: boolean
}

/**
 * A raw sheet → finished tiles. Returns null when `shouldContinue` says stop
 * between steps, so a caller with a cancel button stays in charge of when the
 * work ends. A single cell that fails to finish falls back to its raw slice:
 * one bad tile must not cost the whole paid sheet.
 */
export async function finishTileSheet(
  sheet: string,
  opts: {
    cell?: number
    /** false → slice and map the cells but skip the per-role finishing. */
    post?: boolean
    /** false → trust the sheet's own geometry, skip template alignment. */
    align?: boolean
    onStep?: (step: TileFinishStep) => void
    shouldContinue?: () => boolean
  } = {}
): Promise<FinishedTileSheet | null> {
  const cell = opts.cell ?? TILE_TEMPLATE_CELL
  const go = opts.shouldContinue ?? (() => true)

  opts.onStep?.('align')
  let aligned = sheet
  let alignFailed = false
  if (opts.align !== false) {
    try {
      aligned = await alignAiOutputToTemplate(sheet)
    } catch {
      alignFailed = true
    }
  }
  if (!go()) return null

  opts.onStep?.('slice')
  const cells = await sliceImageGrid(aligned, {
    cols: TILE_TEMPLATE_COLS,
    rows: TILE_TEMPLATE_ROWS,
    cellSize: cell,
  })
  if (!go()) return null

  opts.onStep?.('finish')
  const raw: TileUrlMap = {}
  const byRole: TileUrlMap = {}
  for (const spec of TILESET_SLOTS) {
    const sample = TILE_TEMPLATE_SAMPLES[spec.role]
    const url = cells[sample.row * TILE_TEMPLATE_COLS + sample.col]
    if (!url) continue
    raw[spec.role] = url
    if (opts.post === false) {
      byRole[spec.role] = url
      continue
    }
    try {
      byRole[spec.role] = await finishTileCell(spec.role, url, cell)
    } catch (error) {
      console.warn(`Tile finishing failed for ${spec.role}:`, error)
      byRole[spec.role] = url
    }
  }
  if (!go()) return null

  opts.onStep?.('reconcile')
  let reconciled = byRole
  let reconcileFailed = false
  try {
    reconciled = await reconcileAllCorners(byRole)
  } catch (error) {
    console.warn('Corner reconcile failed; using unfinished corners:', error)
    reconcileFailed = true
  }
  return { cells, raw, byRole: reconciled, alignFailed, reconcileFailed }
}

/**
 * The QA critic's input: the tiles placed by the autotile role map over a sky
 * gradient, downscaled to 96px cells. This is where seams and palette drift
 * show up — not in isolated cells — so it is the image the art director judges.
 * Returns null when there is nothing to place.
 */
export async function buildTilePreviewComposite(
  map: TileUrlMap,
  cell: number = TILE_PREVIEW_CELL
): Promise<string | null> {
  const rows = TILE_TEMPLATE_ROWS
  const cols = TILE_TEMPLATE_COLS
  const canvas = document.createElement('canvas')
  canvas.width = cols * cell
  canvas.height = rows * cell
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
  gradient.addColorStop(0, '#8cc3eb')
  gradient.addColorStop(1, '#28466e')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // One image per role, loaded in parallel; a role the map leaves out is simply
  // not placed.
  const loaded: Partial<Record<TileSetRole, HTMLImageElement>> = {}
  await Promise.all(
    (Object.keys(map) as TileSetRole[]).map(async (role) => {
      const src = map[role]
      if (!src) return
      const img = await loadImage(src)
      if (img) loaded[role] = img
    })
  )

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const role = templateRoleForCell(x, y)
      if (!role) continue
      const img = loaded[role]
      if (img) ctx.drawImage(img, x * cell, y * cell, cell, cell)
    }
  }
  return canvas.toDataURL('image/png')
}

/**
 * The raw atlas: every tile at its real cell size on one canvas, which is what
 * the library stores as `raw/sheet.png` and what a re-roll is painted against.
 */
export async function buildTileSheetAtlas(map: TileUrlMap): Promise<string | null> {
  if (TILESET_SLOTS.every((spec) => !map[spec.role])) return null
  const canvas = document.createElement('canvas')
  canvas.width = TILESET_SHEET_W
  canvas.height = TILESET_SHEET_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false

  await Promise.all(
    TILESET_SLOTS.map(async (spec) => {
      const src = map[spec.role]
      if (!src) return
      const img = await loadImage(src)
      if (!img) return
      ctx.drawImage(
        img,
        spec.col * TILESET_TILE_SIZE,
        spec.row * TILESET_TILE_SIZE,
        TILESET_TILE_SIZE,
        TILESET_TILE_SIZE
      )
    })
  )
  return canvas.toDataURL('image/png')
}
