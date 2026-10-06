/**
 * Studio commands — `extend`, `tiles`, `sprite`, `props`.
 *
 * Each one mirrors the browser studio's pipeline exactly: the same route bodies,
 * the same post-processing ops in the same order, the same best-of-N rules. The
 * only differences are that images travel as files/data URLs instead of canvas
 * state, and a `manifest.json` lands next to the outputs so an agent can see
 * what produced them.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { IE_DIR } from '../native/deps.mjs'
import { CliError, UsageError, enumFlag, numberFlag, positional } from '../lib/args.mjs'
import { dataUrlFromFile, dataUrlSize, ensureFile, imageSize, toDataUrl, writeDataUrl, writeManifest } from '../lib/media.mjs'

/** Everything the studio commands read out of the app, bundled once for Node. */
const APP_MODULES = [
  'app/lib/tileset',
  'app/lib/sprite',
  'app/lib/props',
  'app/lib/app',
  'app/lib/models',
  'app/lib/bodyPlans',
  'app/lib/stylePrompt',
  'app/lib/llmServer',
]

const TOOL_VERSION = `ie@${JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version}`

/** Library `kind` per command (app/lib/libraryTypes.ts ASSET_KINDS). */
const LIBRARY_KIND = { extend: 'extend', tiles: 'tiles', sprite: 'sprites', props: 'props' }

const appModules = (ctx) => ctx.modules('studio', APP_MODULES)

/** `--style <artStyle key>|none` — validated against the app's own table. */
function artStyleFlag(ctx, mods) {
  const style = ctx.flags.style
  if (!style || style === 'none') return undefined
  const keys = Object.keys(mods.ART_STYLE_PROMPTS)
  if (!keys.includes(style)) {
    throw new UsageError(`--style must be one of ${keys.join('|')}|none, got "${style}"`, ctx.spec.usage)
  }
  return style
}

/** The provider/model a run actually used — recorded in the manifest/provenance. */
function resolvedBackend(ctx, mods, kind) {
  const id = ctx.profile || ctx.config.defaultProfile
  const profile = id ? ctx.config.profiles[id] : null
  return {
    provider: profile ? profile.provider : 'openrouter',
    model: mods.modelOrDefault({ model: ctx.model, provider: undefined, profile: id || undefined, kind }),
    profile: id || null,
  }
}

/**
 * `<project>/<kind>/<slug>` form, which must name this command's kind.
 */
function libraryFlag(ctx, kind) {
  const value = ctx.flags.library
  if (!value) return null
  const parts = String(value).split('/')
  if (parts.length === 2 && parts[0] && parts[1]) return { project: parts[0], slug: parts[1] }
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    if (parts[1] !== kind) {
      throw new UsageError(`--library kind "${parts[1]}" does not match this command's kind "${kind}"`, ctx.spec.usage)
    }
    return { project: parts[0], slug: parts[2] }
  }
  throw new UsageError(`--library must be <project>/<slug> or <project>/<kind>/<slug>, got "${value}"`, ctx.spec.usage)
}

/**
 * Refuse to spend an API call on an asset that is already in the library, so a
 * re-run fails in the first second instead of after the money.
 */
async function assertLibraryTargetFree(ctx, { project, slug, kind }) {
  if (!project) return
  const lib = await ctx.modules('library', ['app/lib/library'])
  try {
    await lib.readMeta(project, kind, slug)
  } catch {
    return
  }
  if (!ctx.flags.overwrite) {
    ctx.fail('EEXISTS', `${project}/${kind}/${slug} is already in the library — pass --overwrite to replace it`)
  }
}

async function saveToLibrary(ctx, { kind, project, slug, files, manifest, provenance }) {
  if (!project) return null
  const collect = await ctx.modules('librarycollect', ['app/lib/libraryCollect'])
  const lib = await ctx.modules('library', ['app/lib/library'])
  const meta = collect.buildAssetMeta(
    { kind, files, manifest, provenance },
    { project, slug, toolVersion: TOOL_VERSION }
  )
  const written = await lib.saveAsset(project, kind, slug, meta, files, { overwrite: true })
  return {
    project,
    kind,
    slug,
    path: path.join(lib.assetsRoot(), project, kind, slug),
    files: written,
  }
}

/** A `rel › file` list as the data-URL map `saveAsset` wants. */
function libraryFiles(pairs) {
  const files = {}
  for (const [rel, file] of pairs) files[rel] = dataUrlFromFile(file)
  return files
}

const extend = {
  summary: 'extend an image in one direction (best-of-N seam blending)',
  usage:
    'ie extend <in.png> <out.png> --direction left|right|up|down [--amount 38] [--attempts N] [--prompt <text>] [--style <key|none>] [--library <project>/<slug>] [--overwrite]',
  options: {
    direction: { type: 'string' },
    amount: { type: 'string' },
    attempts: { type: 'string' },
    prompt: { type: 'string' },
    style: { type: 'string' },
    library: { type: 'string' },
    overwrite: { type: 'boolean' },
  },
  async run(ctx) {
    const startedAt = Date.now()
    const input = positional(ctx.args, 0, 'in.png', ctx.spec)
    const out = positional(ctx.args, 1, 'out.png', ctx.spec)
    ensureFile(input)
    const mods = await appModules(ctx)
    const target = libraryFlag(ctx, LIBRARY_KIND.extend)
    await assertLibraryTargetFree(ctx, { ...target, kind: LIBRARY_KIND.extend })

    const direction = enumFlag(ctx.flags, 'direction', ['left', 'right', 'up', 'down'], 'right', ctx.spec)
    const amount = numberFlag(ctx.flags, 'amount', mods.EXTENSION_PERCENT, ctx.spec, 1)
    const style = artStyleFlag(ctx, mods)
    const prompt = (ctx.flags.prompt || '').trim() || undefined
    const backend = resolvedBackend(ctx, mods, 'image')
    const source = dataUrlFromFile(input)

    const body = (extra) => ({
      direction,
      extensionAmount: amount,
      customPrompt: prompt,
      artStyle: style,
      ...ctx.llmFields(),
      ...extra,
    })
    const calls = []
    const cost = []
    const horizontal = direction === 'left' || direction === 'right'
    let best

    if (horizontal) {
      // One browser for every candidate's canvas; then the paid calls; then one
      // browser for every blend+seam score. The app's loop, batched by stage.
      const modelCfg = mods.getModelConfig(ctx.model || backend.model)
      const attempts = Math.max(
        1,
        Math.min(numberFlag(ctx.flags, 'attempts', modelCfg.maxAttempts, ctx.spec, 1), modelCfg.maxAttempts)
      )
      ctx.note(`${attempts} attempt(s) at ${amount}% to the ${direction} (model max ${modelCfg.maxAttempts})`)
      const canvases = ctx.bridgeBatch(
        Array.from({ length: attempts }, () => ({
          op: 'expand-canvas',
          opts: { direction, percent: amount, maxDim: 1536 },
          inputs: [source],
        }))
      )

      const aiResults = []
      for (let attempt = 0; attempt < attempts; attempt++) {
        const res = await ctx.api(
          'extend',
          body({
            expandedCanvas: canvases[attempt].data[0],
            useFullContext: true,
            extensionInfo: canvases[attempt].meta.extensionInfo,
            attempt,
          })
        )
        if (!res.imageUrl) throw new CliError('no_image', `extend returned no image on attempt ${attempt + 1}`)
        aiResults.push(await toDataUrl(res.imageUrl))
        if (res.cost) cost.push(res.cost)
      }

      const finals = ctx.bridgeBatch(
        aiResults.map((ai, attempt) => ({
          op: 'extend-finalize',
          opts: { extensionInfo: canvases[attempt].meta.extensionInfo },
          inputs: [source, ai],
        }))
      )
      finals.forEach((final, attempt) => {
        if (final.meta.unfilled) {
          calls.push({ attempt: attempt + 1, unfilled: true, score: null })
          return
        }
        const score = final.meta.score
        calls.push({ attempt: attempt + 1, unfilled: false, score })
        if (!best || score < best.score) best = { score, image: final.data[0] }
      })
      if (!best) {
        throw new CliError(
          'extend_unfilled',
          `the model never filled the extension area in ${attempts} attempt(s) — try another --direction, --style or model`
        )
      }
    } else {
      ctx.note(`single vertical pass at ${amount}% going ${direction}`)
      const chunk = ctx.bridge({
        op: 'create-chunked',
        opts: { direction, percent: amount, overlapPercent: 40, maxDim: 1536 },
        inputs: [source],
      })
      const res = await ctx.api(
        'extend',
        body({ expandedCanvas: chunk.data[0], chunkInfo: chunk.meta.chunkInfo, useFullContext: false })
      )
      if (!res.imageUrl) throw new CliError('no_image', 'extend returned no image')
      if (res.cost) cost.push(res.cost)
      const stitched = ctx.bridge({
        op: 'stitch-chunk',
        opts: { chunkInfo: chunk.meta.chunkInfo },
        inputs: [source, await toDataUrl(res.imageUrl)],
      })
      best = { score: null, image: stitched.data[0] }
      calls.push({ attempt: 1, unfilled: false, score: null })
    }

    writeDataUrl(best.image, out)
    const returned = await imageSize(out)
    const manifest = {
      tool: TOOL_VERSION,
      command: 'extend',
      params: { direction, amount, prompt: prompt ?? null, style: style ?? null },
      provider: backend.provider,
      profile: backend.profile,
      model: backend.model,
      attempts: calls,
      seamResidual: best.score,
      returned: `${returned.width}x${returned.height}`,
      cost: cost.length ? cost : null,
      tookMs: Date.now() - startedAt,
    }
    const manifestFile = writeManifest(path.dirname(path.resolve(out)), manifest)
    const library = target
      ? await saveToLibrary(ctx, {
          kind: LIBRARY_KIND.extend,
          ...target,
          files: libraryFiles([['derived/image.png', out]]),
          manifest,
          provenance: {
            backend: backend.provider,
            model: backend.model,
            prompt: prompt ?? null,
            sceneBrief: null,
            artStyle: style ?? null,
            params: { direction, amount, attempts: calls.length },
            requested: null,
            returned: `${returned.width}x${returned.height}`,
            cost: cost[0] ?? null,
          },
        })
      : null

    return {
      summary: `extended ${direction} by ${amount}%${best.score === null ? '' : ` (seam residual ${best.score.toFixed(2)})`}`,
      written: [out, manifestFile],
      attempts: calls,
      manifest,
      library,
    }
  },
}

const tiles = {
  summary: 'generate a 13-role tileset from a prompt (with optional art-director review)',
  usage:
    'ie tiles <prompt> --out <dir> [--review] [--style <key|none>] [--library <project>/<slug>] [--overwrite]',
  options: {
    out: { type: 'string' },
    review: { type: 'boolean' },
    style: { type: 'string' },
    library: { type: 'string' },
    overwrite: { type: 'boolean' },
  },
  async run(ctx) {
    const startedAt = Date.now()
    const prompt = positional(ctx.args, 0, 'prompt', ctx.spec).trim()
    if (!prompt) throw new UsageError('empty <prompt>', ctx.spec.usage)
    const out = ctx.flags.out ? path.resolve(ctx.flags.out) : positional(ctx.args, 1, 'outdir', ctx.spec)
    const mods = await appModules(ctx)
    const target = libraryFlag(ctx, LIBRARY_KIND.tiles)
    await assertLibraryTargetFree(ctx, { ...target, kind: LIBRARY_KIND.tiles })

    const style = artStyleFlag(ctx, mods)
    const backend = resolvedBackend(ctx, mods, 'image')
    // The app's own cap: the initial generation plus two repaints.
    const MAX_REVIEW_PASSES = 2
    const guide = ctx.bridge({ op: 'tile-guide', inputs: [] }).data[0]
    const roleFiles = mods.TILESET_SLOTS.map((slot) => ({ role: slot.role, file: `${slot.fileName}.png` }))
    const cost = []
    const passes = []
    let best = null
    let fixNotes

    for (let pass = 0; pass <= (ctx.flags.review ? MAX_REVIEW_PASSES : 0); pass++) {
      ctx.note(pass === 0 ? 'generating tileset' : `repainting (pass ${pass + 1}) with the art director's notes`)
      const res = await ctx.api('generate', {
        prompt,
        width: mods.TILE_TEMPLATE_W,
        height: mods.TILE_TEMPLATE_H,
        tileSheet: true,
        tileGuideImage: guide,
        tileFixNotes: fixNotes,
        artStyle: style,
        ...ctx.llmFields(),
      })
      if (!res.imageUrl) throw new CliError('no_image', 'generate returned no tileset image')
      if (res.cost) cost.push(res.cost)
      const sheet = await toDataUrl(res.imageUrl)
      const sheetSize = await dataUrlSize(sheet)
      const passDir = path.join(IE_DIR, 'tmp', `tiles-pass-${pass}`)
      const extract = ctx.bridge({ op: 'tile-extract', opts: { cell: mods.TILESET_TILE_SIZE }, inputs: [sheet], outDir: passDir })

      // The app treats an unavailable critic exactly like an approval: a flaky
      // review must never turn a clean generation into a rejection.
      let review = null
      let score = -1
      if (ctx.flags.review) {
        const preview = ctx.bridgeBatch([
          {
            op: 'tile-preview',
            opts: { roles: Object.fromEntries(roleFiles.map((r, i) => [r.role, i])) },
            inputs: roleFiles.map((r) => path.join(passDir, r.file)),
          },
          {
            op: 'tile-sheet',
            opts: { roles: Object.fromEntries(roleFiles.map((r, i) => [r.role, i])) },
            inputs: roleFiles.map((r) => path.join(passDir, r.file)),
          },
        ])
        try {
          review = await ctx.api('tile-review', {
            prompt,
            previewImage: preview[0].data[0],
            sheetImage: preview[1].data[0],
            ...ctx.llmFields(),
          })
        } catch (err) {
          ctx.note(`tile review unavailable (${err.message}) — accepting this pass`)
        }
        if (review && !review.ok) score = Array.isArray(review.issues) ? review.issues.length || 1 : 1
      }

      // `approved: null` means no critic ran (no --review, or an unavailable
      // critic) — never report an un-reviewed pass as approved.
      const approved = !review || review.ok
      passes.push({
        pass: pass + 1,
        reviewed: !!review,
        approved: review ? review.ok : null,
        issues: review ? review.issues : [],
        score,
        fix: review ? review.fix : '',
      })
      // Strictly-better comparison: ties keep the EARLIER pass, so a critic that
      // rejects a clean first generation can only ever be ignored, never obeyed.
      if (!best || score < best.score) best = { pass, score, passDir, sheet, sheetSize, roles: extract.meta.roles }
      if (approved || !ctx.flags.review) break
      fixNotes = (review && (review.fix || (review.issues || []).join('; '))) || ''
      if (!fixNotes) break
    }

    writeDataUrl(best.sheet, path.join(out, 'sheet.png'))
    const written = [path.join(out, 'sheet.png')]
    for (const { file } of roleFiles) {
      const from = path.join(best.passDir, file)
      const to = path.join(out, file)
      writeDataUrl(dataUrlFromFile(from), to)
      written.push(to)
    }
    const manifest = {
      tool: TOOL_VERSION,
      command: 'tiles',
      params: { prompt, style: style ?? null, cell: mods.TILESET_TILE_SIZE, sheetPx: `${mods.TILE_TEMPLATE_W}x${mods.TILE_TEMPLATE_H}` },
      provider: backend.provider,
      profile: backend.profile,
      model: backend.model,
      passes,
      roles: best.roles,
      returned: best.sheetSize ? `${best.sheetSize.width}x${best.sheetSize.height}` : null,
      cost: cost.length ? cost : null,
      tookMs: Date.now() - startedAt,
    }
    const manifestFile = writeManifest(out, manifest)
    written.push(manifestFile)
    const library = target
      ? await saveToLibrary(ctx, {
          kind: LIBRARY_KIND.tiles,
          ...target,
          files: libraryFiles([
            ['raw/sheet.png', path.join(out, 'sheet.png')],
            ...roleFiles.map(({ file }) => [`derived/${file}`, path.join(out, file)]),
          ]),
          manifest,
          provenance: {
            backend: backend.provider,
            model: backend.model,
            prompt,
            sceneBrief: null,
            artStyle: style ?? null,
            params: { cell: mods.TILESET_TILE_SIZE, passes: passes.length, reviewed: passes[passes.length - 1].reviewed },
            requested: `${mods.TILE_TEMPLATE_W}x${mods.TILE_TEMPLATE_H}`,
            returned: best.sheetSize ? `${best.sheetSize.width}x${best.sheetSize.height}` : null,
            cost: cost[0] ?? null,
          },
        })
      : null

    return {
      summary: `tileset: ${best.roles} roles → ${out}${ctx.flags.review ? ` (${passes.length} pass(es), ${passes[passes.length - 1].approved ? 'approved' : 'kept the best'})` : ' (unreviewed — pass --review for the art director)'}`,
      written,
      passes,
      manifest,
      library,
    }
  },
}

const sprite = {
  summary: 'generate an animated sprite sheet (anchor → pose guide → sheet → align)',
  usage:
    'ie sprite <description> --out <dir> [--body-plan biped|quadruped|serpent|flyer|blob] [--anim <name>] [--frames 8] [--style <key|none>] [--library <project>/<slug>] [--overwrite]',
  options: {
    out: { type: 'string' },
    'body-plan': { type: 'string' },
    anim: { type: 'string' },
    frames: { type: 'string' },
    style: { type: 'string' },
    library: { type: 'string' },
    overwrite: { type: 'boolean' },
  },
  async run(ctx) {
    const startedAt = Date.now()
    const prompt = positional(ctx.args, 0, 'description', ctx.spec).trim()
    if (!prompt) throw new UsageError('empty <description>', ctx.spec.usage)
    const out = ctx.flags.out ? path.resolve(ctx.flags.out) : positional(ctx.args, 1, 'outdir', ctx.spec)
    const mods = await appModules(ctx)
    const target = libraryFlag(ctx, LIBRARY_KIND.sprite)
    await assertLibraryTargetFree(ctx, { ...target, kind: LIBRARY_KIND.sprite })

    const bodyPlan = enumFlag(ctx.flags, 'body-plan', mods.BODY_PLAN_ORDER, 'biped', ctx.spec)
    const anim = enumFlag(ctx.flags, 'anim', Object.keys(mods.SPRITE_ANIMATIONS), 'walk', ctx.spec)
    const frames = numberFlag(ctx.flags, 'frames', mods.SPRITE_FRAME_COUNT, ctx.spec, 1)
    const cols = mods.SPRITE_GRID_COLS
    const rows = Math.ceil(frames / cols)
    const frameSize = mods.SPRITE_FRAME_SIZE
    const style = artStyleFlag(ctx, mods)
    const backend = resolvedBackend(ctx, mods, 'image')
    const cost = []

    ctx.note(`pass 1/2: character anchor (${frameSize}²)`)
    const anchorRes = await ctx.api('generate', {
      prompt,
      width: frameSize,
      height: frameSize,
      spriteAnchor: true,
      spriteBodyPlan: bodyPlan,
      artStyle: style,
      ...ctx.llmFields(),
    })
    if (!anchorRes.imageUrl) throw new CliError('no_image', 'the anchor pass returned no image')
    if (anchorRes.cost) cost.push(anchorRes.cost)
    const anchorRaw = await toDataUrl(anchorRes.imageUrl)
    writeDataUrl(anchorRaw, path.join(out, 'anchor-raw.png'))
    const keyed = ctx.bridge({ op: 'chroma', opts: { preset: 'default' }, inputs: [anchorRaw] })
    writeDataUrl(keyed.data[0], path.join(out, 'anchor.png'))
    const guide = ctx.bridge({
      op: 'pose-guide',
      opts: { cell: frameSize, cols, rows, anim, bodyPlan },
      inputs: [anchorRaw],
    })

    ctx.note(`pass 2/2: ${frames}-frame ${anim} sheet (${cols}×${rows})`)
    const sheetRes = await ctx.api('generate', {
      prompt,
      width: cols * frameSize,
      height: rows * frameSize,
      spriteSheet: true,
      spriteAnim: anim,
      spriteBodyPlan: bodyPlan,
      spriteFrameCount: frames,
      spriteGridCols: cols,
      spriteGridRows: rows,
      spriteFrameSize: frameSize,
      spriteGuideImage: guide.data[0],
      spritePoseGuide: true,
      spriteIdentityImage: anchorRaw,
      artStyle: style,
      ...ctx.llmFields(),
    })
    if (!sheetRes.imageUrl) throw new CliError('no_image', 'the sheet pass returned no image')
    if (sheetRes.cost) cost.push(sheetRes.cost)
    const sheet = await toDataUrl(sheetRes.imageUrl)
    const sheetSize = await dataUrlSize(sheet)
    writeDataUrl(sheet, path.join(out, 'sheet.png'))

    const aligned = ctx.bridge({
      op: 'sprite-align',
      opts: {
        cols,
        rows,
        cell: frameSize,
        bodyPlan,
        // Grounded animations plant every frame on the shared ground line;
        // airborne ones let the genuine lift through. The app decides this from
        // the body plan + animation, so the CLI asks the same function.
        airborne: mods.isAirborneAnim(bodyPlan, anim),
      },
      inputs: [sheet],
      outDir: out,
    })
    const flagged = aligned.meta.duplicateFrames || []
    const manifest = {
      tool: TOOL_VERSION,
      command: 'sprite',
      params: { prompt, bodyPlan, anim, frames, cols, rows, frameSize, style: style ?? null, airborne: mods.isAirborneAnim(bodyPlan, anim) },
      provider: backend.provider,
      profile: backend.profile,
      model: backend.model,
      alignment: aligned.meta,
      returned: sheetSize ? `${sheetSize.width}x${sheetSize.height}` : null,
      cost: cost.length ? cost : null,
      tookMs: Date.now() - startedAt,
    }
    const manifestFile = writeManifest(out, manifest)
    const library = target
      ? await saveToLibrary(ctx, {
          kind: LIBRARY_KIND.sprite,
          ...target,
          files: libraryFiles([
            ['raw/sheet.png', path.join(out, 'sheet.png')],
            ...Array.from({ length: aligned.meta.count }, (_, i) => [
              `derived/frame_${String(i).padStart(2, '0')}.png`,
              path.join(out, `frame_${String(i).padStart(2, '0')}.png`),
            ]),
          ]),
          manifest,
          provenance: {
            backend: backend.provider,
            model: backend.model,
            prompt,
            sceneBrief: null,
            artStyle: style ?? null,
            params: { bodyPlan, anim, frames, airborne: mods.isAirborneAnim(bodyPlan, anim) },
            requested: `${cols * frameSize}x${rows * frameSize}`,
            returned: sheetSize ? `${sheetSize.width}x${sheetSize.height}` : null,
            cost: cost[0] ?? null,
          },
        })
      : null

    return {
      summary: `${aligned.meta.count} frames aligned → ${out}${flagged.length ? ` · ${flagged.length} frame(s) flagged (likely torn/spilled): ${flagged.join(', ')}` : ''}`,
      written: [...aligned.written, manifestFile],
      alignment: aligned.meta,
      warnings: flagged.length
        ? [`frames ${flagged.join(', ')} look like two disconnected masses — check them before shipping`]
        : [],
      manifest,
      library,
    }
  },
}

const props = {
  summary: 'generate a props batch for a biome (art director → sheet → per-cell cleanup)',
  usage:
    'ie props <biome> --out <dir> [--count 8] [--style <key|none>] [--library <project>/<slug>] [--overwrite]',
  options: {
    out: { type: 'string' },
    count: { type: 'string' },
    style: { type: 'string' },
    library: { type: 'string' },
    overwrite: { type: 'boolean' },
  },
  async run(ctx) {
    const startedAt = Date.now()
    const prompt = positional(ctx.args, 0, 'biome', ctx.spec).trim()
    if (!prompt) throw new UsageError('empty <biome>', ctx.spec.usage)
    const out = ctx.flags.out ? path.resolve(ctx.flags.out) : positional(ctx.args, 1, 'outdir', ctx.spec)
    const mods = await appModules(ctx)
    const target = libraryFlag(ctx, LIBRARY_KIND.props)
    await assertLibraryTargetFree(ctx, { ...target, kind: LIBRARY_KIND.props })

    const count = numberFlag(ctx.flags, 'count', mods.PROP_BATCH, ctx.spec, 1)
    const cols = mods.PROP_BATCH_COLS
    const rows = Math.ceil(count / cols)
    const tile = mods.PROP_TILE_SIZE
    const style = artStyleFlag(ctx, mods)
    const backend = resolvedBackend(ctx, mods, 'image')
    const cost = []

    // Art director — a text model picks WHAT to paint. A failure is not fatal:
    // the image model then free-invents, exactly as the UI falls back.
    let ideas = []
    try {
      ctx.note(`art director is planning ${count} props`)
      const brief = await ctx.api('prop-brief', { prompt, count, existing: [], artStyle: style, ...ctx.llmFields() })
      if (Array.isArray(brief.ideas)) ideas = brief.ideas
    } catch (err) {
      ctx.note(`prop brief unavailable (${err.message}) — asking the image model to invent them`)
    }

    ctx.note(`painting a ${cols}×${rows} props sheet`)
    const sheetRes = await ctx.api('generate', {
      prompt,
      width: cols * tile,
      height: rows * tile,
      propSheet: true,
      propCols: cols,
      propRows: rows,
      propCount: count,
      propList: ideas.length ? ideas.map((idea) => idea.description) : undefined,
      artStyle: style,
      ...ctx.llmFields(),
    })
    if (!sheetRes.imageUrl) throw new CliError('no_image', 'generate returned no props sheet')
    if (sheetRes.cost) cost.push(sheetRes.cost)
    const sheet = await toDataUrl(sheetRes.imageUrl)
    const sheetSize = await dataUrlSize(sheet)
    writeDataUrl(sheet, path.join(out, 'sheet.png'))

    const cut = ctx.bridge({ op: 'prop-sheet', opts: { cols, rows, cell: tile }, inputs: [sheet] })
    const cells = cut.data
    // The art director's categories line up with the cells in reading order, so
    // file names come from them; with no brief the app's positional names apply.
    const named = mods.resolvePropNames(ideas.map((idea) => ({ name: idea.category })))
    const items = cells.map((cell, i) => {
      const name = named[i] || { name: `prop ${i + 1}`, file: `prop_${String(i + 1).padStart(3, '0')}.png` }
      const file = path.join(out, name.file)
      writeDataUrl(cell, file)
      return { name: name.name, file: name.file, path: file, description: ideas[i] ? ideas[i].description : null }
    })
    const manifest = {
      tool: TOOL_VERSION,
      command: 'props',
      params: { prompt, count: items.length, cols, rows, cell: tile, style: style ?? null },
      provider: backend.provider,
      profile: backend.profile,
      model: backend.model,
      ideas: ideas.map((idea) => ({ category: idea.category, description: idea.description })),
      returned: sheetSize ? `${sheetSize.width}x${sheetSize.height}` : null,
      cost: cost.length ? cost : null,
      tookMs: Date.now() - startedAt,
    }
    const manifestFile = writeManifest(out, manifest)
    const library = target
      ? await saveToLibrary(ctx, {
          kind: LIBRARY_KIND.props,
          ...target,
          files: libraryFiles([
            ['raw/sheet.png', path.join(out, 'sheet.png')],
            ...items.map((item) => [`derived/${item.file}`, item.path]),
          ]),
          manifest,
          provenance: {
            backend: backend.provider,
            model: backend.model,
            prompt,
            sceneBrief: null,
            artStyle: style ?? null,
            params: { count: items.length, cols, rows },
            requested: `${cols * tile}x${rows * tile}`,
            returned: sheetSize ? `${sheetSize.width}x${sheetSize.height}` : null,
            cost: cost[0] ?? null,
          },
        })
      : null

    return {
      summary: `${items.length} props → ${out}${items.length < count ? ` (only ${items.length} of ${count} cells came back)` : ''}`,
      written: [path.join(out, 'sheet.png'), ...items.map((item) => item.path), manifestFile],
      warnings: cut.meta.borderFailed
        ? [`${cut.meta.borderFailed} cell(s) kept their painted edge band (frame-border trim failed) — check the PNGs`]
        : [],
      items: items.map(({ name, file, description }) => ({ name, file, description })),
      manifest,
      library,
    }
  },
}

export default { extend, tiles, sprite, props }
