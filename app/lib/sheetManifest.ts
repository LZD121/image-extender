// app/lib/sheetManifest.ts
/**
 * The sheet manifests: the JSON written next to an exported sheet that tells an
 * engine importer what each grid cell *is*.
 *
 * Why they live here and not in the client: they were three closures inside
 * `app/page.tsx`'s 4,000-line component, reachable only from that module's
 * state, so nothing else could produce one — which is why the CLI wrote a
 * second, differently-shaped manifest for the same sheet
 * (`cli/commands/studio.mjs`). The layout facts (cell coords, atlas stride,
 * per-frame rects) are pure arithmetic over the tables in `tileset`, `props` and
 * `sprite`; the page now hands in state and the CLI hands in what it wrote.
 *
 * The shapes are a tested invariant: `sheetManifest.test.ts` pins each one, so a
 * rename or a reordered key fails there rather than in someone's engine import.
 */
import { BODY_PLANS, type BodyPlan } from '@/app/lib/bodyPlans'
import { PROP_TILE_SIZE, propAtlasLayout, resolvePropNames, type PropItem } from '@/app/lib/props'
import {
  SPRITE_ANIMATIONS,
  SPRITE_FRAME_SIZE,
  SPRITE_GRID_COLS,
  SPRITE_GRID_ROWS,
  SPRITE_SHEET_H,
  SPRITE_SHEET_W,
  SPRITE_STRIP_H,
  type SpriteAnimType,
  type SpriteFrame,
} from '@/app/lib/sprite'
import {
  TILESET_ATLAS_EXTRUDE_PX,
  TILESET_COLS,
  TILESET_PADDED_SHEET_H,
  TILESET_PADDED_SHEET_W,
  TILESET_PADDED_STRIDE,
  TILESET_ROWS,
  TILESET_SHEET_H,
  TILESET_SHEET_W,
  TILESET_SLOTS,
  TILESET_TILE_SIZE,
  type TileSetRole,
} from '@/app/lib/tileset'

export type TileManifestInput = {
  prompt: string
  sceneBrief: string
  artStyle: string
  /** The roles that actually carry an image. */
  presentRoles: readonly TileSetRole[]
}

export function buildTileSetManifest(input: TileManifestInput) {
  const present = new Set(input.presentRoles)
  return {
    version: 1,
    tileSize: TILESET_TILE_SIZE,
    cols: TILESET_COLS,
    rows: TILESET_ROWS,
    sheetWidth: TILESET_SHEET_W,
    sheetHeight: TILESET_SHEET_H,
    productionAtlas: {
      fileName: 'sheet_padded.png',
      tileSize: TILESET_TILE_SIZE,
      extrudePx: TILESET_ATLAS_EXTRUDE_PX,
      stride: TILESET_PADDED_STRIDE,
      sheetWidth: TILESET_PADDED_SHEET_W,
      sheetHeight: TILESET_PADDED_SHEET_H,
      importNote:
        'Use each tile source rect at paddedX/paddedY with width/height tileSize. Keep the surrounding extruded pixels in the atlas to prevent filtering seams.',
    },
    prompt: input.prompt,
    sceneBrief: input.sceneBrief.trim() || null,
    artStyle: input.artStyle !== 'none' ? input.artStyle : null,
    tiles: TILESET_SLOTS.map((spec) => ({
      role: spec.role,
      label: spec.label,
      col: spec.col,
      row: spec.row,
      index: spec.row * TILESET_COLS + spec.col,
      fileName: `${spec.fileName}.png`,
      present: present.has(spec.role),
      sourceX: spec.col * TILESET_TILE_SIZE,
      sourceY: spec.row * TILESET_TILE_SIZE,
      paddedX: spec.col * TILESET_PADDED_STRIDE + TILESET_ATLAS_EXTRUDE_PX,
      paddedY: spec.row * TILESET_PADDED_STRIDE + TILESET_ATLAS_EXTRUDE_PX,
    })),
  }
}

export type PropManifestInput = {
  prompt: string
  sceneBrief: string
  /** Every prop in the studio; the ones without an image are left out. */
  items: readonly PropItem[]
}

export function buildPropManifest(input: PropManifestInput) {
  const populated = input.items.filter((p) => p.imageUrl)
  const layout = propAtlasLayout(populated.length)
  const names = resolvePropNames(populated)
  return {
    type: 'prop-atlas',
    generator: 'AI Image Extender — Props',
    prompt: input.prompt.trim() || null,
    sceneBrief: input.sceneBrief.trim() || null,
    sheet: { width: layout.width, height: layout.height },
    grid: { cols: layout.cols, rows: layout.rows, cellSize: PROP_TILE_SIZE },
    count: populated.length,
    props: populated.map((p, i) => {
      const r = layout.rect(i)
      return {
        id: p.id,
        name: names[i].name,
        file: names[i].file,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      }
    }),
  }
}

export type SpriteManifestInput = {
  anim: SpriteAnimType
  bodyPlan: BodyPlan
  fps: number
  prompt: string
  /** The prompt the sheet was actually painted with, when it differs. */
  sheetPrompt?: string
  sceneBrief: string
  artStyle: string
  /** Every frame in the studio; the ones excluded or empty are left out. */
  frames: readonly SpriteFrame[]
}

export function buildSpriteManifest(input: SpriteManifestInput) {
  const spec = SPRITE_ANIMATIONS[input.anim]
  const frames = input.frames.filter((f) => !!f.imageUrl && !f.disabled)
  const count = frames.length
  const stripCols = Math.max(1, count)
  return {
    version: 1,
    bodyPlan: input.bodyPlan,
    bodyPlanLabel: BODY_PLANS[input.bodyPlan].label,
    anim: input.anim,
    label: spec.label,
    frameCount: count,
    frameSize: SPRITE_FRAME_SIZE,
    fps: input.fps,
    frameDurationMs: Math.round(1000 / input.fps),
    loop: spec.loop,
    grid: {
      fileName: 'sheet.png',
      cols: SPRITE_GRID_COLS,
      rows: SPRITE_GRID_ROWS,
      sheetWidth: SPRITE_SHEET_W,
      sheetHeight: SPRITE_SHEET_H,
    },
    strip: {
      fileName: 'strip.png',
      cols: stripCols,
      rows: 1,
      sheetWidth: stripCols * SPRITE_FRAME_SIZE,
      sheetHeight: SPRITE_STRIP_H,
    },
    prompt: input.sheetPrompt || input.prompt,
    sceneBrief: input.sceneBrief.trim() || null,
    artStyle: input.artStyle !== 'none' ? input.artStyle : null,
    frames: frames.map((f, i) => ({
      index: i,
      sourceIndex: f.index,
      fileName: `frame_${String(i + 1).padStart(2, '0')}.png`,
      gridCol: i % SPRITE_GRID_COLS,
      gridRow: Math.floor(i / SPRITE_GRID_COLS),
      gridX: (i % SPRITE_GRID_COLS) * SPRITE_FRAME_SIZE,
      gridY: Math.floor(i / SPRITE_GRID_COLS) * SPRITE_FRAME_SIZE,
      stripX: i * SPRITE_FRAME_SIZE,
      stripY: 0,
    })),
  }
}
