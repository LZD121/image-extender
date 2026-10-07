/**
 * `ie anim` — one spec in, a whole animation set out.
 *
 * Two subcommands and one gate. `plan` renders what a run would do; `run`
 * without `--go` renders the *same* plan (literally the same function, so the
 * two can never drift) and `--go` is the only switch that spends. Nothing on
 * the dry path touches `ctx.server()`, `ctx.api` or the filesystem: a preview
 * that costs a request, or a file, is a preview nobody dares run twice.
 *
 * Everything that decides *what* the set is — validation, the plan, the file
 * names, the prompt, the ledger shape — lives in `app/lib/animSet.ts` +
 * `app/lib/animStrip.ts` and is reached through `ctx.modules` (Phase 2 pinned
 * those in vitest; this module re-implements none of it). What lives here is
 * the surface: flags, the gate, and the per-strip pipeline. One strip at a time
 * is deliberate (D-29): the gateway dislikes concurrent image requests, and
 * serial keeps billing and the ledger one-to-one.
 *
 * The ledger IS `<out>/set.json` (D-28): rewritten atomically as each strip
 * completes, merged by `state:frame`, and the thing a later run reads to
 * continue. `raw/` is the model's untouched reply — the only paid-for evidence
 * — so it lands before any post-processing.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { UsageError, numberFlag } from '../lib/args.mjs'
import { dataUrlSize, ensureFile, toDataUrl, writeDataUrl, writeFileAtomic } from '../lib/media.mjs'

const SUBCOMMANDS = ['plan', 'run']

// `ie help anim` prints `usage: <USAGE>` verbatim (cli/ie.mjs:85-97), so the two
// subcommand spellings are on their own lines — that is the only place the
// names the gate greps for actually exist in the help output.
const USAGE = 'ie anim plan --spec <file.json> [--out <dir>]\n' +
  '       ie anim run  --spec <file.json> [--out <dir>] [--go]\n' +
  '       ie anim <plan|run> --actor <slug> --subject-file <f> --states <json> --dirs dirs8|dirs4 --cell <n> --style-file <f>'

/** One line per subcommand, shared by `ie help anim` and `ie anim help`. */
const SUBCOMMAND_LINES = [
  '  plan                                       逐 strip 画布 + 调用数 + 总量 + 输出根；零调用、零写入',
  '  run [--go]                                 无 --go 与 plan 逐字节同；--go 才生成（串行、逐条原子落盘）',
  '',
  'notes:',
  '  --states takes the spec\'s own states array as JSON, e.g.',
  '    \'[{"name":"idle","motion":"a calm breathing idle","frames":4,"fps":4,"loop":true}]\'',
  '  inline flags need --out and a model (--model, or "model" in the spec);',
  '  --spec carries the whole spec and --out is the only field it lets you override.',
]

const MODULES = ['app/lib/animSet', 'app/lib/animStrip']

/** 2s then 8s: enough for the gateway's ~15s ceiling to clear, ~10s total when it never does. */
const RETRY_DELAYS_MS = [2000, 8000]

/**
 * The POST, retried. Retrying means paying again, so this wraps ONE call and
 * never the pipeline around it: a failure after the image arrived must not
 * buy a second image, and a failure *of* the image is the only thing worth
 * waiting out.
 */
export async function generateWithRetry(call, opts = {}) {
  const delays = opts.delays || RETRY_DELAYS_MS
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const attempts = []
  for (let attempt = 0; ; attempt++) {
    try {
      return { value: await call(), attempts: attempts.length + 1 }
    } catch (err) {
      attempts.push(err)
      const retryable = isRetryable(err)
      if (!retryable || attempt >= delays.length) {
        err.attempts = attempts.map((e) => e.code || e.name)
        throw err
      }
      if (opts.onRetry) opts.onRetry(attempt + 1, delays[attempt], err)
      await sleep(delays[attempt])
    }
  }
}

/** Network trouble and 5xx are worth another try; a 4xx answer to the same body never is. */
export function isRetryable(err) {
  if (!err) return false
  if (err.code === 'request_failed') return true // fetch threw: DNS/reset/timeout
  if (err.code !== 'route_failed') return false
  // The HTTP status lives on the error itself (set by routeError). It used to
  // be read from `err.detail`, which is the route body — and every route body
  // is `{error: …}`, so a live 503 arrived with `detail.status === undefined`
  // and spec §8's retry silently did not exist.
  const status = err.status
  return typeof status === 'number' && (status === 429 || status >= 500)
}

/** Inline flags that conflict with `--spec` — `--out` is the one legal override. */
const INLINE_FLAGS = ['actor', 'subject', 'subject-file', 'states', 'dirs', 'cell', 'style', 'style-file']

/**
 * The provider a run will actually ask — the same resolution chain `studio.mjs`
 * uses (`ctx.profile` → `config.defaultProfile` → the profile's provider), not
 * a hardcoded label. Label *honesty* (cost.source, BACKEND_LABELS) is Phase 5's
 * LIB-03; here we only record what the server will really select.
 */
function providerFor(ctx) {
  const id = ctx.profile || ctx.config.defaultProfile
  return id ? (ctx.config.profiles[id] && ctx.config.profiles[id].provider) || 'openrouter' : 'openrouter'
}

/** Exactly one of `--x` / `--x-file`; both or neither is a usage error. */
function oneOf(ctx, inlineKey, fileKey) {
  const inline = ctx.flags[inlineKey]
  const file = ctx.flags[fileKey]
  if ((inline === undefined) === (file === undefined)) {
    throw new UsageError(`give exactly one of --${inlineKey} / --${fileKey}`, USAGE)
  }
  if (inline !== undefined) return inline
  return readFileSync(ensureFile(file, `--${fileKey}`), 'utf8').trim()
}

/** The spec as inline flags describe it — the same shape a `--spec` file holds. */
function inlineSpec(ctx) {
  const flags = ctx.flags
  let states
  try {
    states = JSON.parse(flags.states)
  } catch (err) {
    throw new UsageError(`--states must be the spec's states array as JSON: ${err.message}`, USAGE)
  }
  return {
    actor: flags.actor,
    subject: oneOf(ctx, 'subject', 'subject-file'),
    dirs: flags.dirs,
    states,
    cell: numberFlag(flags, 'cell', undefined, ctx.spec),
    styleText: oneOf(ctx, 'style', 'style-file'),
    background: 'magenta',
    model: ctx.model || null,
    out: flags.out,
  }
}

/**
 * Load and validate the spec, whichever of the two sources it came from. Both
 * paths run `validateAnimSetSpec`, so the fifteen hard errors are identical
 * there — and happen before a single call.
 */
function resolveSpec(ctx, mods) {
  const flags = ctx.flags
  const inline = INLINE_FLAGS.filter((key) => flags[key] !== undefined)
  if (flags.spec !== undefined && inline.length) {
    throw new UsageError('--spec carries the whole spec; --out is the only override', USAGE)
  }

  let raw
  if (flags.spec !== undefined) {
    const file = ensureFile(flags.spec, '--spec')
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      throw new UsageError(`--spec is not valid JSON: ${err.message}`, USAGE)
    }
  } else {
    raw = inlineSpec(ctx)
  }

  let validated
  try {
    validated = mods.validateAnimSetSpec(raw)
  } catch (err) {
    // D-32: carry the offending key through, so the caller is told which field
    // to edit instead of reading a sentence.
    if (err && err.name === 'AnimSpecError') ctx.fail('bad_spec', err.message, { field: err.field })
    throw err
  }
  for (const warning of validated.warnings) ctx.note('warning: ' + warning)

  const spec = validated.spec
  return { spec, outRoot: path.resolve(ctx.flags.out || spec.out), model: ctx.model || spec.model }
}

/**
 * The rendered plan. `plan` and a dry `run` both return this object and nothing
 * else — GEN-02's "equivalent" is this function, not two renderers that agree
 * today.
 */
function planPayload(ctx, mods, spec, outRoot, model) {
  const dirs = mods.dirsForPreset(spec.dirs)
  const plan = mods.planStrips(spec)
  return {
    summary: `plan: ${plan.length} strips · ${plan.length} calls · ${plan.length * dirs.length} frames · out ${outRoot}`,
    dryRun: true,
    plan: plan.map((p) => ({
      index: p.index,
      state: p.state,
      frame: p.frame,
      canvas: `${p.width}x${p.height}`,
      calls: 1,
      out: p.file,
    })),
    calls: plan.length,
    cells: plan.length * dirs.length,
    canvas: `${plan[0].width}x${plan[0].height}`,
    out: outRoot,
    dirs: { preset: spec.dirs, order: dirs.slice() },
    cell: spec.cell,
    states: spec.states.map((s) => ({ name: s.name, frames: s.frames, fps: s.fps })),
    model,
    provider: providerFor(ctx),
  }
}

/** The strips already in the ledger. Unreadable is treated as empty — the next write repairs it. */
function existingRecords(setFile) {
  if (!existsSync(setFile)) return []
  try {
    const parsed = JSON.parse(readFileSync(setFile, 'utf8'))
    return Array.isArray(parsed.strips) ? parsed.strips : []
  } catch {
    return []
  }
}

/**
 * One `StripRecord`, the exact shape `animSet.ts` pins — no field more, none
 * less: the ledger is `set.json`, so a new field is a contract change that
 * costs an existing run directory its resumability (D-28, Reversibility:
 * costly). `requested`/`returned` come from the request canvas and from the
 * bytes on disk; `fitted`/`field`/`steps` come from the op's own `meta`.
 */
function recordFor(mods, item, spec, { ok, seconds, size, meta }) {
  return {
    state: item.state,
    frame: item.frame,
    file: mods.stripFile(item.state, item.frame, spec.dirs),
    ok,
    seconds,
    requested: `${item.width}x${item.height}`,
    returned: size ? `${size.width}x${size.height}` : '',
    fitted: meta && meta.fitted
      ? {
        spacing: meta.fitted.spacing,
        phase: meta.fitted.phase,
        residualPct: meta.fitted.residualPct,
        gutterOk: meta.fitted.gutterOk,
      }
      : { spacing: 0, phase: 0, residualPct: 0, gutterOk: false },
    field: meta && meta.field
      ? { hex: meta.field.hex, cast: meta.field.cast, preset: meta.field.preset }
      : { hex: '', cast: 0, preset: 'binary' },
    steps: (meta && meta.counters) || {},
    prompt: item.prompt,
  }
}

/**
 * The serial pipeline (D-29). Per strip: generate → atomically write `raw/`
 * *immediately* (before any post-processing: a failed cut must keep the
 * bytes that were paid for) → the `strip-frames` op, fed the file path so it
 * cuts exactly the bytes that landed → one atomic write per derived frame →
 * rewrite `set.json`.
 *
 * A strip the op itself calls `ok:false` (gutter / blank cell) is recorded as
 * `ok:false` and stops the run — the op owns that verdict, the CLI only books
 * it. Everything else throws: retry / keep-going / redo are the next wave, and
 * a retry must never wrap this whole pipeline, only the generation call (that
 * is the one that costs money twice).
 */
async function runStrips(ctx, mods, spec, outRoot, model) {
  const dirs = mods.dirsForPreset(spec.dirs)
  const plan = mods.planStrips(spec)
  const provider = providerFor(ctx)
  const setFile = path.join(outRoot, 'set.json')
  // Keyed by `state:frame`, so re-running a strip replaces its row instead of
  // appending a second one (the consumer's 17-rows-for-16-strips bug came from
  // appending).
  const strips = new Map(
    existingRecords(setFile).map((record) => [mods.stripKey(record.state, record.frame), record])
  )
  const written = []

  const commit = (record) => {
    strips.set(mods.stripKey(record.state, record.frame), record)
    const setJson = mods.buildSetJson({ spec, strips: [...strips.values()], provider })
    const file = writeFileAtomic(setFile, Buffer.from(JSON.stringify(setJson, null, 2) + '\n'))
    if (!written.includes(file)) written.push(file)
    return record
  }

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i]
    // Progress goes to stderr: stdout carries exactly one parseable object.
    ctx.note(`[${i + 1}/${plan.length}] ${item.state} f${item.frame + 1} → ${item.width}x${item.height}`)

    const started = Date.now()
    // `<spec>.retryDelays` is the test seam: the four unit arms assert the real
    // 2s/8s table, while the pipeline arms inject ~0ms so a run that retries
    // does not cost ten seconds of wall clock per suite.
    const { value: res, attempts } = await generateWithRetry(
      () => ctx.api('generate', {
        prompt: item.prompt,
        width: item.width,
        height: item.height,
        model,
        // profile/model ride in the BODY: a global `--profile` is ignored by the
        // gateway (Phase 1 measured it). `llmFields()` is the only implementation.
        ...ctx.llmFields(),
      }),
      { delays: ctx.spec && ctx.spec.retryDelays, onRetry: (n, ms, e) => ctx.note(`  retry ${n}/2 after ${ms / 1000}s: ${e.message}`) }
    )
    if (!res || !res.imageUrl) {
      ctx.fail('no_image', `generate answered without an imageUrl for ${item.state} f${item.frame + 1}`)
    }
    const dataUrl = await toDataUrl(res.imageUrl)
    const size = await dataUrlSize(dataUrl)
    const seconds = Number(((Date.now() - started) / 1000).toFixed(3))

    const rawPath = writeDataUrl(dataUrl, path.join(outRoot, mods.stripFile(item.state, item.frame, spec.dirs)))
    written.push(rawPath)

    const op = ctx.bridge({ op: 'strip-frames', opts: { cell: spec.cell, dirs }, inputs: [rawPath] })
    const meta = op.meta

    if (meta && meta.ok === false) {
      ctx.note(`strip not ok: gutter ${JSON.stringify(meta.gutter && meta.gutter.unrescued)} counters ${JSON.stringify(meta.counters)}`)
      commit(recordFor(mods, item, spec, { ok: false, seconds, size, meta }))
      ctx.note(`failed (${seconds}s)`)
      break
    }
    if (!op.data || op.data.length !== dirs.length) {
      const got = op.data ? op.data.length : 0
      ctx.note(`the op returned ${got} frames, the strip has ${dirs.length} directions`)
      commit(recordFor(mods, item, spec, { ok: false, seconds, size, meta }))
      ctx.note(`failed (${seconds}s)`)
      break
    }

    // Names and order both come from Phase 2: `dirs` is the preset's own order.
    dirs.forEach((dir, cell) => {
      written.push(writeDataUrl(op.data[cell], path.join(outRoot, mods.frameFile(item.state, item.frame, dir))))
    })
    commit(recordFor(mods, item, spec, { ok: true, seconds, size, meta }))
    ctx.note(`ok ${seconds}s${attempts > 1 ? ` (${attempts} attempts)` : ''}`)
  }

  return { written, strips: [...strips.values()], setJson: setFile }
}

const anim = {
  summary: 'animation set — plan (zero calls) / run --go (serial, atomic writes, set.json ledger)',
  usage: USAGE,
  options: {
    spec: { type: 'string' },
    out: { type: 'string' },
    actor: { type: 'string' },
    subject: { type: 'string' },
    'subject-file': { type: 'string' },
    states: { type: 'string' },
    dirs: { type: 'string' },
    cell: { type: 'string' },
    style: { type: 'string' },
    'style-file': { type: 'string' },
    go: { type: 'boolean' },
    help: { type: 'boolean' },
  },
  async run(ctx) {
    const sub = ctx.args[0]
    if (ctx.flags.help || sub === 'help') {
      return {
        summary: [
          `ie anim — ${anim.summary}`,
          '',
          `usage: ${USAGE}`,
          '',
          'subcommands:',
          ...SUBCOMMAND_LINES,
        ].join('\n'),
      }
    }
    if (!sub || !SUBCOMMANDS.includes(sub)) {
      throw new UsageError(`unknown anim subcommand "${sub ?? ''}" (expected ${SUBCOMMANDS.join('|')})`, USAGE)
    }

    const mods = await ctx.modules('anim', MODULES)
    const { spec, outRoot, model } = resolveSpec(ctx, mods)

    if (sub === 'plan') {
      // A silently ignored `--go` turns "I did pass --go" into a misunderstanding.
      if (ctx.flags.go) throw new UsageError('plan never spends — --go belongs to run', USAGE)
      return planPayload(ctx, mods, spec, outRoot, model)
    }

    if (!ctx.flags.go) {
      const payload = planPayload(ctx, mods, spec, outRoot, model)
      ctx.note(`dry run: ${payload.plan.length} strips, ${payload.plan.length} calls — pass --go to spend`)
      return payload
    }
    return runStrips(ctx, mods, spec, outRoot, model)
  },
}

export default { anim }
