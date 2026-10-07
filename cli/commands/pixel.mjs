/**
 * PixelLab pixel art — the vendor surface the older external tooling never
 * covered. Generation goes through the dev server's `/api/pixel` relay (it
 * owns the vendor wire format and the `x-pixellab-key` header); everything
 * after that is local: sharp decodes the vendor PNG to raw RGBA, the app's own
 * pixelGrid lattice is imposed (analyse -> decimate by mode -> crop to the
 * cell), and every cell is written as a PNG. Without `--out` nothing is
 * written and the vendor result comes back as JSON instead.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { CliError, UsageError, enumFlag, numberFlag } from '../lib/args.mjs'


/** Every place a PixelLab key may come from, in resolution order. */
const KEY_SOURCES =
  '--key-env <ENV_NAME>, config pixel.apiKeyEnv (env var name), config pixel.apiKey, or $PIXELLAB_API_KEY'

/** The vendor relays no error body for these; each has one obvious next move. */
const STATUS_HINTS = {
  401: 'the key was rejected — verify it, or point --key-env at one that works',
  402: 'the account is out of credits — `ie pixel balance` shows the balance',
  429: 'rate limited by PixelLab — retry shortly',
  529: 'PixelLab is overloaded — retry shortly',
}

const SUBCOMMANDS = ['pixflux', 'character', 'status', 'balance']

/** One line per subcommand, shared by `ie help pixel` and `ie pixel help`. */
const SUBCOMMAND_LINES = [
  '  pixflux --description <t> [--width N --height N] [--seed N] [--out <dir>]',
  '      one image, generated now; --out writes raw/source.png + derived/cell.png',
  '  character --description <t> [--image-size N] [--template <id>] [--view <v>] [--seed N] [--out <dir>]',
  '      8-direction character (async); with --out it polls until done, then writes derived/dir_NN.png',
  '  status --id <characterId> [--out <dir>]',
  '      vendor job status; with --out, finalizes the rotations once the job is completed',
  '  balance',
  '      PixelLab credit balance',
]

const USAGE = 'ie pixel <pixflux|character|status|balance> [args] [flags]'

/** The app's own pixel tables + grid math as one Node bundle (built once, cached). */
function pixelModules(ctx) {
  return ctx.modules('pixel', ['app/lib/pixel', 'app/utils/pixelGrid'])
}

/** The key, from the first source that has one. Never a silent default. */
function resolveKey(ctx) {
  const envName = ctx.flags['key-env']
  if (envName) {
    const value = process.env[envName]
    if (!value) ctx.fail('missing_key', `--key-env ${envName}: ${envName} is not set — key sources: ${KEY_SOURCES}`)
    return value
  }
  const pixel = ctx.config.pixel || {}
  if (pixel.apiKeyEnv) {
    const value = process.env[pixel.apiKeyEnv]
    if (!value) {
      ctx.fail(
        'missing_key',
        `pixel.apiKeyEnv names ${pixel.apiKeyEnv}, but that variable is not set${ctx.config.path ? ` (config: ${ctx.config.path})` : ''} — key sources: ${KEY_SOURCES}`,
      )
    }
    return value
  }
  if (pixel.apiKey) return pixel.apiKey
  if (process.env.PIXELLAB_API_KEY) return process.env.PIXELLAB_API_KEY
  ctx.fail('missing_key', `no PixelLab key found — set one of: ${KEY_SOURCES}`)
}

/** One shape for both the route's JSON errors and the vendor's bodyless ones. */
function relayFailure(ctx, where, status, text, detail) {
  const hint = STATUS_HINTS[status]
  ctx.fail(
    'vendor_error',
    `${where} → HTTP ${status ?? '?'}: ${text || 'empty response body'}${hint ? ` — ${hint}` : ''}`,
    detail,
  )
}

/**
 * POST one vendor op. The route relays the vendor status verbatim, which is
 * why the non-2xx mapping lives here: route validation errors carry their own
 * message, bodyless vendor rejections get a per-status hint.
 */
async function vendorPost(ctx, key, body) {
  const mods = await pixelModules(ctx)
  try {
    return await ctx.api('pixel', body, { headers: { [mods.PIXEL_KEY_HEADER]: key } })
  } catch (err) {
    if (!(err instanceof CliError) || err.code !== 'route_failed') throw err
    const detail = err.detail
    const text =
      detail && typeof detail.error === 'string'
        ? detail.error
        : detail && typeof detail.raw === 'string'
          ? detail.raw.trim().slice(0, 300)
          : ''
    relayFailure(ctx, 'pixel', Number((err.message.match(/HTTP (\d+)/) || [])[1]) || null, text, detail)
  }
}

/**
 * GET one vendor op. `ctx.api` always POSTs and the route's GET half owns the
 * characterStatus/balance ops, so this fetches directly against the same
 * server with the key header the route requires.
 */
async function vendorGet(ctx, key, query) {
  const { url } = await ctx.server()
  const mods = await pixelModules(ctx)
  let res
  try {
    res = await fetch(`${url}/api/pixel?${query}`, {
      headers: { [mods.PIXEL_KEY_HEADER]: key },
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    ctx.fail('request_failed', `pixel?${query}: ${err.message}`)
  }
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    /* the vendor relays bodyless errors; the !ok branch below handles that */
  }
  if (!res.ok) {
    const message = parsed && typeof parsed.error === 'string' ? parsed.error : text.trim().slice(0, 300)
    relayFailure(ctx, `pixel?${query}`, res.status, message, parsed)
  }
  if (parsed === null) ctx.fail('bad_payload', `pixel?${query} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`)
  return parsed
}

/** Rotation URLs are public CDN links; the browser proxies only for canvas. */
async function download(ctx, url) {
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  } catch (err) {
    ctx.fail('download_failed', `GET ${url}: ${err.message}`)
  }
  if (!res.ok) ctx.fail('download_failed', `GET ${url} → HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * PixelStudio's `apply`, in Node: decode the vendor PNG to raw RGBA, impose
 * the app's lattice (analyse the phase -> decimate by mode -> crop to the
 * cell), encode the cell as PNG. cropToCell throws when the figure outgrows
 * the cell; its message names the fix, and the callers surface it untouched.
 */
async function finalizeImage(mods, bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const source = {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  }
  const analysis = mods.analyzeGrid(source, mods.DEFAULT_BLOCK)
  const decimated = mods.decimateByMode(source, analysis.block, analysis.ox, analysis.oy)
  const cropped = mods.cropToCell(decimated, {
    cell: mods.DEFAULT_CELL,
    minFigureHeight: mods.DEFAULT_FIGURE_BAND.min,
    maxFigureHeight: mods.DEFAULT_FIGURE_BAND.max,
  })
  const { image } = cropped
  const png = await sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer()
  return {
    png,
    analysis,
    figure: cropped.figure,
    warnings: cropped.warnings,
    source: { width: info.width, height: info.height },
    cell: { width: image.width, height: image.height },
  }
}

/** Finalize one image; a crop failure keeps the app's message and adds the CLI fix. */
async function finalizeCell(ctx, mods, bytes, label, hint) {
  try {
    return await finalizeImage(mods, bytes)
  } catch (err) {
    if (err instanceof Error && /does not fit/.test(err.message)) {
      ctx.fail('figure_too_large', `${label}: ${err.message} — ${hint}`)
    }
    ctx.fail('finalize_failed', `${label}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function writeCell(outDir, name, png) {
  const file = path.join(outDir, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, png)
  return file
}

/**
 * Finalize every rotation image. Nothing touches disk until all of them have
 * finalized, so a failed crop never leaves a half-written set behind.
 */
async function finalizeDirections(ctx, mods, images, outDir) {
  const cells = []
  for (let i = 0; i < images.length; i++) {
    const bytes = await download(ctx, images[i])
    cells.push(
      await finalizeCell(
        ctx,
        mods,
        bytes,
        `direction ${i + 1}/${images.length}`,
        `resubmit with an --image-size where the figure is at most ${mods.DEFAULT_CELL * mods.DEFAULT_BLOCK}px tall`,
      ),
    )
  }
  const written = []
  const directions = []
  for (let i = 0; i < cells.length; i++) {
    const file = writeCell(outDir, `derived/dir_${String(i).padStart(2, '0')}.png`, cells[i].png)
    written.push(file)
    directions.push({
      file,
      url: images[i],
      figure: `${cells[i].figure.width}x${cells[i].figure.height}`,
      analysis: cells[i].analysis,
      ...(cells[i].warnings.length ? { warnings: cells[i].warnings } : {}),
    })
  }
  return { written, directions }
}

/** The vendor's character row, mapped the way the app's pollCharacter does. */
async function characterStatus(ctx, key, id) {
  const mods = await pixelModules(ctx)
  const body = await vendorGet(ctx, key, `op=characterStatus&id=${encodeURIComponent(id)}`)
  const urls = body && body.rotation_urls
  const images = urls
    ? mods.PIXEL_DIRECTIONS.map((direction) => urls[direction]).filter((url) => typeof url === 'string' && url.length > 0)
    : []
  return {
    status: body && typeof body.status === 'string' ? body.status : null,
    images,
    size: body && body.size ? `${body.size.width}x${body.size.height}` : null,
  }
}

/** Poll until completed; failed/timeout mirror the studio's own messages. */
async function waitForCharacter(ctx, key, characterId) {
  const mods = await pixelModules(ctx)
  const started = Date.now()
  for (;;) {
    const job = await characterStatus(ctx, key, characterId)
    if (job.status === 'failed') {
      ctx.fail(
        'job_failed',
        `the character job failed (character_id=${characterId}) — it is not retried automatically; resubmit only if the balance allows`,
      )
    }
    if (job.status === 'completed' && job.images.length > 0) return job
    if (Date.now() - started > mods.PIXEL_POLL_LIMIT_MS) {
      ctx.fail(
        'job_timeout',
        `still polling after 10 minutes (character_id=${characterId}) — re-check with \`ie pixel status --id ${characterId} --out <dir>\` instead of resubmitting`,
      )
    }
    ctx.note(`character ${characterId}: ${job.status ?? 'pending'} — polling again in ${mods.PIXEL_POLL_EVERY_MS / 1000}s`)
    await new Promise((resolve) => setTimeout(resolve, mods.PIXEL_POLL_EVERY_MS))
  }
}

function descriptionFlag(ctx) {
  const description = (ctx.flags.description || '').trim()
  if (!description) throw new UsageError('missing --description <text>', ctx.spec.usage)
  return description
}

/** An integer flag inside the app's own bounds, rejected before any HTTP. */
function intRangeFlag(ctx, key, fallback, min, max) {
  const value = numberFlag(ctx.flags, key, fallback, ctx.spec)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(`--${key} must be an integer in ${min}..${max}, got "${ctx.flags[key] ?? fallback}"`, ctx.spec.usage)
  }
  return value
}

function seedFlag(ctx) {
  const seed = numberFlag(ctx.flags, 'seed', null, ctx.spec)
  if (seed !== null && !Number.isInteger(seed)) {
    throw new UsageError(`--seed must be an integer, got "${ctx.flags.seed}"`, ctx.spec.usage)
  }
  return seed
}

async function pixflux(ctx) {
  const description = descriptionFlag(ctx)
  const mods = await pixelModules(ctx)
  const width = intRangeFlag(ctx, 'width', 64, mods.PIXFLUX_MIN, mods.PIXFLUX_MAX)
  const height = intRangeFlag(ctx, 'height', 64, mods.PIXFLUX_MIN, mods.PIXFLUX_MAX)
  const seed = seedFlag(ctx)
  const key = resolveKey(ctx)
  // The route does not forward `view` for pixflux; say so instead of pretending.
  const warnings = ctx.flags.view
    ? ['--view is ignored for pixflux: /api/pixel forwards view only for character']
    : []

  ctx.note(`generating pixflux "${description}" ${width}x${height} …`)
  const res = await vendorPost(ctx, key, {
    op: 'pixflux',
    description,
    width,
    height,
    no_background: true, // the studio's default
    ...(seed === null ? {} : { seed }),
  })
  const base64 = res && res.image && typeof res.image.base64 === 'string' ? res.image.base64 : ''
  if (!base64) ctx.fail('bad_payload', 'pixel pixflux returned no image.base64', res)
  // The vendor returns either a bare base64 blob or a full data URL.
  const dataUrl = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')

  const payload = {
    backend: 'pixellab',
    model: 'create-image-pixflux',
    prompt: description,
    params: {
      width,
      height,
      no_background: true,
      block: mods.DEFAULT_BLOCK,
      cell: mods.DEFAULT_CELL,
      ...(seed === null ? {} : { seed }),
    },
    requested: `${width}x${height}`,
    usage: (res && res.usage) || null,
  }

  if (!ctx.flags.out) {
    const meta = await sharp(bytes).metadata()
    return {
      summary: `pixflux "${description}" ${width}x${height} → ${meta.width}x${meta.height} (no --out: the image is returned as JSON)`,
      ...payload,
      returned: `${meta.width}x${meta.height}`,
      image: dataUrl,
      ...(warnings.length ? { warnings } : {}),
    }
  }

  const processed = await finalizeCell(
    ctx,
    mods,
    bytes,
    `pixflux "${description}"`,
    `resubmit with --width/--height where the figure is at most ${mods.DEFAULT_CELL * mods.DEFAULT_BLOCK}px tall`,
  )
  const rawFile = writeCell(ctx.flags.out, 'raw/source.png', bytes)
  const cellFile = writeCell(ctx.flags.out, 'derived/cell.png', processed.png)
  return {
    summary: `pixflux "${description}" ${width}x${height} → ${cellFile} (cell ${processed.cell.width}x${processed.cell.height}, figure ${processed.figure.width}x${processed.figure.height})`,
    written: [rawFile, cellFile],
    ...payload,
    returned: `${processed.source.width}x${processed.source.height}`,
    figure: `${processed.figure.width}x${processed.figure.height}`,
    analysis: processed.analysis,
    ...(warnings.length + processed.warnings.length
      ? { warnings: [...warnings, ...processed.warnings] }
      : {}),
  }
}

async function character(ctx) {
  const description = descriptionFlag(ctx)
  const mods = await pixelModules(ctx)
  const size = intRangeFlag(ctx, 'image-size', 64, mods.V3_MIN, mods.V3_MAX)
  const template = enumFlag(ctx.flags, 'template', mods.PIXEL_TEMPLATES, 'mannequin', ctx.spec)
  const view = enumFlag(ctx.flags, 'view', mods.PIXEL_VIEWS, 'high top-down', ctx.spec)
  const seed = seedFlag(ctx)
  const key = resolveKey(ctx)

  ctx.note(`submitting character "${description}" ${size}x${size} (template ${template}, view ${view}) …`)
  const res = await vendorPost(ctx, key, {
    op: 'character',
    description,
    template_id: template,
    view,
    image_size: size,
    ...(seed === null ? {} : { seed }),
  })
  const characterId = res && typeof res.character_id === 'string' ? res.character_id : ''
  if (!characterId) ctx.fail('bad_payload', 'pixel character returned no character_id', res)

  const payload = {
    backend: 'pixellab',
    model: 'create-character-v3',
    prompt: description,
    params: {
      template_id: template,
      view,
      image_size: size,
      block: mods.DEFAULT_BLOCK,
      cell: mods.DEFAULT_CELL,
      ...(seed === null ? {} : { seed }),
    },
    requested: `${size}x${size}`,
    usage: (res && res.usage) || null,
    character_id: characterId,
    background_job_id: (res && res.background_job_id) || null,
    status: (res && res.status) || null,
  }

  if (!ctx.flags.out) {
    return {
      summary: `character "${description}" submitted (character_id=${characterId}) — poll with: ie pixel status --id ${characterId}`,
      ...payload,
    }
  }

  ctx.note(`character_id=${characterId} — polling every ${mods.PIXEL_POLL_EVERY_MS / 1000}s …`)
  const job = await waitForCharacter(ctx, key, characterId)
  const { written, directions } = await finalizeDirections(ctx, mods, job.images, ctx.flags.out)
  return {
    summary: `character "${description}" ${size}x${size} → ${written.length} direction(s) in ${ctx.flags.out} (cell ${mods.DEFAULT_CELL}px)`,
    written,
    ...payload,
    status: job.status,
    size: job.size,
    images: job.images,
    directions,
  }
}

async function status(ctx) {
  const id = (ctx.flags.id || '').trim()
  if (!id) throw new UsageError('missing --id <characterId>', ctx.spec.usage)
  const key = resolveKey(ctx)
  const job = await characterStatus(ctx, key, id)
  const payload = { character_id: id, status: job.status, size: job.size, images: job.images }

  if (!ctx.flags.out) {
    return { summary: `character ${id}: ${job.status ?? 'unknown'}${job.size ? ` (${job.size})` : ''}`, ...payload }
  }
  if (job.status !== 'completed' || job.images.length === 0) {
    return { summary: `character ${id}: ${job.status ?? 'unknown'} — nothing written yet; poll again later`, written: [], ...payload }
  }
  const mods = await pixelModules(ctx)
  const { written, directions } = await finalizeDirections(ctx, mods, job.images, ctx.flags.out)
  return {
    summary: `character ${id}: completed → ${written.length} direction(s) in ${ctx.flags.out}`,
    written,
    ...payload,
    directions,
  }
}

async function balance(ctx) {
  const key = resolveKey(ctx)
  const body = await vendorGet(ctx, key, 'op=balance')
  const usd = (body && body.credits && body.credits.usd) ?? 0
  const generations = (body && body.subscription && body.subscription.generations) ?? null
  const total = (body && body.subscription && body.subscription.total) ?? null
  const plan = (body && body.subscription && body.subscription.plan) ?? null
  return {
    summary: `PixelLab balance: $${usd}${generations === null ? '' : ` · ${generations}${total === null ? '' : `/${total}`} generations`}${plan ? ` · ${plan}` : ''}`,
    usd,
    generations,
    total,
    plan,
  }
}

const HANDLERS = { pixflux, character, status, balance }

const pixel = {
  summary: 'PixelLab pixel art — pixflux/character/status/balance (needs a PixelLab key)',
  usage: USAGE,
  options: {
    description: { type: 'string' },
    width: { type: 'string' },
    height: { type: 'string' },
    seed: { type: 'string' },
    view: { type: 'string' },
    template: { type: 'string' },
    'image-size': { type: 'string' },
    out: { type: 'string' },
    'key-env': { type: 'string' },
    id: { type: 'string' },
    help: { type: 'boolean' },
  },
  async run(ctx) {
    const sub = ctx.args[0]
    if (ctx.flags.help || sub === 'help') {
      return {
        summary: [`ie pixel — ${pixel.summary}`, '', `usage: ${USAGE}`, '', 'subcommands:', ...SUBCOMMAND_LINES].join(
          '\n',
        ),
      }
    }
    if (!sub || !HANDLERS[sub]) {
      throw new UsageError(`unknown pixel subcommand "${sub ?? ''}" (expected ${SUBCOMMANDS.join('|')})`, USAGE)
    }
    return HANDLERS[sub](ctx)
  },
}

export default { pixel }
