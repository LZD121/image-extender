/**
 * Post-processing primitives — direct, server-less calls into the app's own
 * pixel code (headless Chromium). Flags mirror the studios' internals 1:1 so a
 * command does exactly one thing and is composable in a shell pipeline.
 */
import { numberFlag, enumFlag, positional } from '../lib/args.mjs'
import { ensureFile, imageSize } from '../lib/media.mjs'

/** `--axis both|horizontal|vertical` → the bridge's axis token. */
const AXIS_TO_BRIDGE = { both: undefined, horizontal: 'h', vertical: 'v' }

const chroma = {
  summary: 'key a flat magenta background out of an image (alpha)',
  usage: 'ie chroma <in.png> <out.png> [--preset default|tile|prop|despill] [--role <tileRole>]',
  options: { preset: { type: 'string' }, role: { type: 'string' } },
  async run(ctx) {
    const input = positional(ctx.args, 0, 'in.png', ctx.spec)
    const out = positional(ctx.args, 1, 'out.png', ctx.spec)
    ensureFile(input)
    const preset = enumFlag(ctx.flags, 'preset', ['default', 'tile', 'prop', 'despill'], 'default', ctx.spec)
    const result = ctx.bridge({
      op: 'chroma',
      opts: { preset, ...(ctx.flags.role ? { role: ctx.flags.role } : {}) },
      inputs: [input],
      out: [out],
    })
    return { summary: `chroma (${preset}) → ${out}`, written: result.written, meta: result.meta }
  },
}

const slice = {
  summary: 'slice a sheet into a grid of cells',
  usage: 'ie slice <in.png> <outdir> --cols N --rows N [--cell N]',
  options: { cols: { type: 'string' }, rows: { type: 'string' }, cell: { type: 'string' } },
  async run(ctx) {
    const input = positional(ctx.args, 0, 'in.png', ctx.spec)
    const outDir = positional(ctx.args, 1, 'outdir', ctx.spec)
    ensureFile(input)
    const cols = numberFlag(ctx.flags, 'cols', null, ctx.spec, 1)
    const rows = numberFlag(ctx.flags, 'rows', null, ctx.spec, 1)
    if (!cols || !rows) ctx.fail('usage', '--cols and --rows are required (see: ie help slice)')
    // The slicer normalizes the sheet to cols×cell by rows×cell, so a missing
    // --cell is derived from the real image rather than guessed at 512.
    const cell =
      numberFlag(ctx.flags, 'cell', null, ctx.spec, 1) || Math.max(1, Math.round((await imageSize(input)).width / cols))
    ctx.note(`slicing ${cols}×${rows} at ${cell}px per cell`)
    const result = ctx.bridge({ op: 'slice', opts: { cols, rows, cell }, inputs: [input], outDir })
    return { summary: `sliced ${cols}×${rows} → ${outDir}`, written: result.written, meta: result.meta }
  },
}

const tileable = {
  summary: 'make an image tile seamlessly (horizontal, vertical or both)',
  usage: 'ie tileable <in.png> <out.png> [--axis both|horizontal|vertical] [--key-magenta]',
  options: { axis: { type: 'string' }, 'key-magenta': { type: 'boolean' } },
  async run(ctx) {
    const input = positional(ctx.args, 0, 'in.png', ctx.spec)
    const out = positional(ctx.args, 1, 'out.png', ctx.spec)
    ensureFile(input)
    const axis = enumFlag(ctx.flags, 'axis', ['both', 'horizontal', 'vertical'], 'both', ctx.spec)
    const result = ctx.bridge({
      op: 'tileable',
      opts: { axis: AXIS_TO_BRIDGE[axis], keyMagenta: !!ctx.flags['key-magenta'] },
      inputs: [input],
      out: [out],
    })
    return { summary: `tileable (${axis}) → ${out}`, written: result.written }
  },
}

const tileGuide = {
  summary: 'render the app’s 8×8 tileset guide image',
  usage: 'ie tile-guide <out.png> [--cell N]',
  options: { cell: { type: 'string' } },
  async run(ctx) {
    const out = positional(ctx.args, 0, 'out.png', ctx.spec)
    const result = ctx.bridge({ op: 'tile-guide', opts: {}, inputs: [], out: [out] })
    return { summary: `tile guide → ${out}`, written: result.written }
  },
}

const tileExtract = {
  summary: 'align + slice a generated tileset sheet into the 13 tile roles',
  usage: 'ie tile-extract <sheet.png> <outdir> [--cell 512] [--raw]',
  options: { cell: { type: 'string' }, raw: { type: 'boolean' } },
  async run(ctx) {
    const sheet = positional(ctx.args, 0, 'sheet.png', ctx.spec)
    const outDir = positional(ctx.args, 1, 'outdir', ctx.spec)
    ensureFile(sheet)
    const result = ctx.bridge({
      op: 'tile-extract',
      opts: {
        cell: numberFlag(ctx.flags, 'cell', 512, ctx.spec, 1),
        post: !ctx.flags.raw,
      },
      inputs: [sheet],
      outDir,
    })
    return {
      summary: `extracted ${result.meta.roles} tile roles → ${outDir}`,
      written: result.written,
      meta: result.meta,
    }
  },
}

const spriteAlign = {
  summary: 'key, isolate, scale and baseline-align sprite sheet frames',
  usage:
    'ie sprite-align <sheet.png> <outdir> [--cols 4 --rows 2 --cell 512] [--body-plan biped|quadruped|serpent|flyer|blob] [--airborne] [--keyed] [--baseline-frac 0.9]',
  options: {
    cols: { type: 'string' },
    rows: { type: 'string' },
    cell: { type: 'string' },
    'body-plan': { type: 'string' },
    airborne: { type: 'boolean' },
    keyed: { type: 'boolean' },
    'baseline-frac': { type: 'string' },
  },
  async run(ctx) {
    const sheet = positional(ctx.args, 0, 'sheet.png', ctx.spec)
    const outDir = positional(ctx.args, 1, 'outdir', ctx.spec)
    ensureFile(sheet)
    const result = ctx.bridge({
      op: 'sprite-align',
      opts: {
        cols: numberFlag(ctx.flags, 'cols', 4, ctx.spec, 1),
        rows: numberFlag(ctx.flags, 'rows', 2, ctx.spec, 1),
        cell: numberFlag(ctx.flags, 'cell', 512, ctx.spec, 1),
        bodyPlan: ctx.flags['body-plan'],
        airborne: !!ctx.flags.airborne,
        keyed: !!ctx.flags.keyed,
        baselineFrac: numberFlag(ctx.flags, 'baseline-frac', 0.9, ctx.spec),
      },
      inputs: [sheet],
      outDir,
    })
    const flagged = result.meta.duplicateFrames || []
    return {
      summary: `aligned ${result.meta.count} frames → ${outDir}${flagged.length ? ` (${flagged.length} flagged: ${flagged.join(', ')})` : ''}`,
      written: result.written,
      meta: result.meta,
      flaggedFrames: flagged,
    }
  },
}

const poseGuide = {
  summary: 'render the app’s skeletal pose guide for a body plan + animation',
  usage: 'ie pose-guide <anchor.png> <out.png> [--body-plan <plan>] [--anim walk] [--cols 4 --rows 2 --cell 512]',
  options: {
    'body-plan': { type: 'string' },
    anim: { type: 'string' },
    cols: { type: 'string' },
    rows: { type: 'string' },
    cell: { type: 'string' },
  },
  async run(ctx) {
    const anchor = positional(ctx.args, 0, 'anchor.png', ctx.spec)
    const out = positional(ctx.args, 1, 'out.png', ctx.spec)
    ensureFile(anchor)
    const result = ctx.bridge({
      op: 'pose-guide',
      opts: {
        bodyPlan: ctx.flags['body-plan'] || 'biped',
        anim: ctx.flags.anim || 'walk',
        cols: numberFlag(ctx.flags, 'cols', 4, ctx.spec, 1),
        rows: numberFlag(ctx.flags, 'rows', 2, ctx.spec, 1),
        cell: numberFlag(ctx.flags, 'cell', 512, ctx.spec, 1),
      },
      inputs: [anchor],
      out: [out],
    })
    return { summary: `pose guide → ${out}`, written: result.written, meta: result.meta }
  },
}

const expandCanvas = {
  summary: 'expand a canvas with a blank area for outpainting',
  usage: 'ie expand-canvas <in.png> <out.png> --direction left|right|up|down [--amount 38] [--max-dim 1536]',
  options: { direction: { type: 'string' }, amount: { type: 'string' }, 'max-dim': { type: 'string' } },
  async run(ctx) {
    const input = positional(ctx.args, 0, 'in.png', ctx.spec)
    const out = positional(ctx.args, 1, 'out.png', ctx.spec)
    ensureFile(input)
    const direction = enumFlag(ctx.flags, 'direction', ['left', 'right', 'up', 'down'], 'right', ctx.spec)
    const result = ctx.bridge({
      op: 'expand-canvas',
      opts: {
        direction,
        percent: numberFlag(ctx.flags, 'amount', 38, ctx.spec, 1),
        maxDim: numberFlag(ctx.flags, 'max-dim', 1536, ctx.spec, 64),
      },
      inputs: [input],
      out: [out],
    })
    return { summary: `expanded ${direction} → ${out}`, written: result.written, extensionInfo: result.meta.extensionInfo }
  },
}

export default { chroma, slice, tileable, 'tile-guide': tileGuide, 'tile-extract': tileExtract, 'sprite-align': spriteAlign, 'pose-guide': poseGuide, 'expand-canvas': expandCanvas }
