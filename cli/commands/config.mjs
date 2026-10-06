/**
 * The config file the CLI and the dev server share: read it, edit it, probe the
 * gateway it names, or drive it from an interactive menu.
 *
 * Every write is a validated read-modify-write — `validateIeConfig` runs before
 * the old file is replaced, so a file on disk is always one the server accepts,
 * and a rejected value never leaves a half-written config behind. `ie.mjs` hands
 * us `ctx.config.file` (the resolved file, or the path a new one takes) so the
 * very first `set` can create the config.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { CliError, UsageError, positional } from '../lib/args.mjs'

const PROFILE_FIELDS = ['provider', 'baseUrl', 'apiKeyEnv', 'apiKey', 'imageModel', 'qaModel']
const PIXEL_FIELDS = ['apiKeyEnv', 'apiKey']
const PATH_HELP =
  'valid paths: defaultProfile · pixel.apiKeyEnv · pixel.apiKey · ' +
  `profiles.<id>.<${PROFILE_FIELDS.join('|')}>`

const SUBCOMMANDS = {
  path: 'print the resolved config file and where it comes from',
  list: 'every profile: provider, baseUrl, models, key source (never the key)',
  get: 'print one value, e.g. profiles.local-magpie.baseUrl',
  set: 'set one value (validated read-modify-write)',
  unset: 'remove one value (empty profiles/pixel blocks are pruned)',
  test: 'probe the resolved gateway through /api/providers and report its models',
}

const USAGE = 'ie config <path|list|get|set|unset|test> [args] [--help]'

/**
 * Where a write lands and how it got there: `ctx.config.file` is the resolved
 * file, or the path a new one takes when none exists yet.
 */
function targetInfo(ctx) {
  const found = ctx.ieConfig.configFilePath()
  const source = found ? (found.required ? '$IE_CONFIG' : 'discovered') : 'default (created on first write)'
  return { path: ctx.config.file, source, exists: existsSync(ctx.config.file) }
}

/** The raw JSON on disk, for read-modify-write; {} when the file does not exist yet. */
function readRaw(file) {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new CliError('config_invalid', `${file}: not valid JSON (${err.message}) — fix it or delete the file`)
  }
}

/**
 * The raw JSON a write must start from. A file that exists but failed to load
 * is refused rather than silently replaced with `{}` — that would delete its
 * other content. A file that simply does not exist yet is exactly the case
 * `set` must be able to bootstrap.
 */
function editable(ctx) {
  if (ctx.config.error && existsSync(ctx.config.file)) {
    throw new CliError(
      'config_invalid',
      `${ctx.config.error} — refusing to edit (a write would discard its other content); fix or delete the file, then retry. \`ie config get\` reads it raw.`,
    )
  }
  return readRaw(ctx.config.file)
}

/**
 * Validate, then swap the file in atomically: a temp file in the same directory
 * plus a rename, so an interrupted write can never leave a partial config. A
 * file holding an inline secret is made owner-only.
 */
function save(ctx, file, raw) {
  let validated
  try {
    validated = ctx.ieConfig.validateIeConfig(raw, file)
  } catch (err) {
    throw new CliError('config_invalid', err.message)
  }
  const { config, warnings } = validated
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n')
  if (Object.values(config.profiles).some((p) => p.apiKey) || !!config.pixel.apiKey) chmodSync(tmp, 0o600)
  renameSync(tmp, file)
  return { config, warnings }
}

/** Resolve a dotted path; anything else is a usage error, never a silent no-op. */
function parsePath(dotted, spec) {
  const parts = String(dotted).split('.')
  if (parts.length === 1 && parts[0] === 'defaultProfile') return { kind: 'default' }
  if (parts.length === 2 && parts[0] === 'pixel' && PIXEL_FIELDS.includes(parts[1])) {
    return { kind: 'pixel', field: parts[1] }
  }
  if (parts.length === 3 && parts[0] === 'profiles' && parts[1] && PROFILE_FIELDS.includes(parts[2])) {
    return { kind: 'profile', id: parts[1], field: parts[2] }
  }
  throw new UsageError(`unknown config path "${dotted}" — ${PATH_HELP}`, spec.usage)
}

function getPath(config, target) {
  if (target.kind === 'default') return config.defaultProfile
  if (target.kind === 'pixel') return (config.pixel || {})[target.field]
  return ((config.profiles || {})[target.id] || {})[target.field]
}

function setPath(raw, target, value) {
  const next = structuredClone(raw)
  if (target.kind === 'default') next.defaultProfile = value
  else if (target.kind === 'pixel') next.pixel = { ...(next.pixel || {}), [target.field]: value }
  else {
    next.profiles = { ...(next.profiles || {}) }
    next.profiles[target.id] = { ...(next.profiles[target.id] || {}), [target.field]: value }
  }
  return next
}

function unsetPath(raw, target) {
  const next = structuredClone(raw)
  if (target.kind === 'default') {
    delete next.defaultProfile
    return next
  }
  if (target.kind === 'pixel') {
    if (next.pixel) delete next.pixel[target.field]
    return next
  }
  const profile = next.profiles?.[target.id]
  if (profile) {
    delete profile[target.field]
    // An entry without a provider is rejected on the next load; drop it instead.
    if (!Object.keys(profile).length) delete next.profiles[target.id]
  }
  return next
}

/** A secret never leaves the process, not even into the caller's own logs. */
function shown(target, value) {
  return target.field === 'apiKey' && value ? '(inline secret)' : value
}

/** Where a credential comes from — the env var's state, never its value. */
function profileKeySource(profile) {
  if (profile.apiKeyEnv) {
    return process.env[profile.apiKeyEnv] ? `$${profile.apiKeyEnv} (set)` : `$${profile.apiKeyEnv} (not set)`
  }
  if (profile.apiKey) return 'inline in the config file (prefer apiKeyEnv)'
  return "none — the provider's own env var is the fallback"
}

function pixelKeySource(pixel) {
  if (!pixel) return 'not configured'
  if (pixel.apiKeyEnv) {
    return process.env[pixel.apiKeyEnv] ? `$${pixel.apiKeyEnv} (set)` : `$${pixel.apiKeyEnv} (not set)`
  }
  if (pixel.apiKey) return 'inline in the config file (prefer apiKeyEnv)'
  return 'not configured (pixel.apiKeyEnv unset)'
}

/**
 * The same probe /api/providers runs, executed by the CLI. Needed because that
 * route resolves the gateway from the *server's* env, so it cannot test a
 * profile that names its own baseUrl.
 */
async function probeGateway(ctx, baseUrl, providerId, key) {
  const { looksLikeImageModel } = await ctx.modules('config-test', ['app/lib/providers'])
  const shape = { provider: providerId ?? null, baseUrl }
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 400).trim()
      return { ...shape, ok: false, status: res.status, error: text || `HTTP ${res.status}` }
    }
    const payload = await res.json().catch(() => null)
    const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
    const ids = list.map((m) => String(m?.id ?? '')).filter(Boolean)
    return { ...shape, ok: true, count: ids.length, imageModelCount: ids.filter(looksLikeImageModel).length }
  } catch (err) {
    return {
      ...shape,
      ok: false,
      error: err.name === 'TimeoutError' ? `no answer within 15s from ${baseUrl}` : err.message,
    }
  }
}

/** Probe one profile's gateway (or the server's default provider when none is named). */
async function testProfile(ctx, config, profileId) {
  const profile = profileId ? config.profiles[profileId] : null
  if (profileId && !profile) {
    const defined = Object.keys(config.profiles).join(', ') || 'none'
    throw new CliError(
      'unknown_profile',
      `unknown profile "${profileId}" — defined: ${defined} (add it with \`ie config set profiles.${profileId}.provider magpie\`)`,
    )
  }

  const key = profile ? ctx.ieConfig.profileKey(profile, process.env) : ''
  const url = profile ? ctx.ieConfig.effectiveProvider(profile).baseUrl : null
  const declared = profile?.baseUrl || null

  let server = null
  let serverError = null
  try {
    server = await ctx.api('providers', profile ? { provider: profile.provider, apiKey: key } : {})
  } catch (err) {
    serverError = err.message
  }

  // The route's answer counts only when it probed the gateway the profile names;
  // otherwise it describes a different endpoint and the CLI probes instead.
  const fromServer = !!server && (!declared || server.baseUrl === declared)
  const serverProbe = server
    ? { ok: server.ok, baseUrl: server.baseUrl, error: server.error ?? null }
    : { error: serverError }
  if (!fromServer && !url) {
    throw new CliError('probe_failed', `no gateway to probe — ${serverError || 'no server answered and no profile is configured'}`)
  }
  const result = fromServer ? server : await probeGateway(ctx, url, profile.provider, key)
  const via = fromServer ? 'server' : 'direct'

  if (!result.ok) {
    throw new CliError('probe_failed', `${result.provider} at ${result.baseUrl}: ${result.error || `HTTP ${result.status}`}`, {
      via,
      provider: result.provider,
      baseUrl: result.baseUrl,
      status: result.status ?? null,
      error: result.error ?? null,
      serverProbe,
    })
  }

  return {
    summary: `${result.provider} at ${result.baseUrl} — reachable, ${result.count} model(s), ${result.imageModelCount} image-capable (probe: ${via})`,
    via,
    profile: profileId,
    provider: result.provider,
    baseUrl: result.baseUrl,
    count: result.count,
    imageModelCount: result.imageModelCount,
    keySource: profile ? profileKeySource(profile) : 'none named — the server used its default provider',
    serverProbe,
  }
}

function helpText(spec, note) {
  return [
    `ie config — ${spec.summary}`,
    '',
    `usage: ${spec.usage}`,
    '',
    ...Object.entries(SUBCOMMANDS).map(([name, line]) => `  ${name.padEnd(7)} ${line}`),
    `  ${'(none)'.padEnd(7)} interactive editor (a TTY is required)`,
    '',
    PATH_HELP,
    ...(note || []),
  ].join('\n')
}

/** Ask one field: empty keeps the current value, `-` clears it, null means EOF. */
async function askField(ask, label, current) {
  const answer = await ask(`${label} [${current || 'none'}]${current !== undefined ? ' (- to clear)' : ''}: `)
  if (answer === null) return null
  if (!answer) return current
  if (answer === '-') return ''
  return answer
}

/** Values the operator left blank are absent, not empty strings. */
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''))
}

/** The interactive editor. Never writes without validating; re-reads after every save. */
async function interactive(ctx) {
  const output = ctx.json ? process.stderr : process.stdout
  const rl = createInterface({ input: process.stdin, output })
  const lines = rl[Symbol.asyncIterator]()
  const out = (line = '') => output.write(line + '\n')
  const ask = async (prompt) => {
    output.write(prompt)
    const next = await lines.next()
    return next.done ? null : String(next.value).trim()
  }

  const menu = [
    ['1', 'list profiles'],
    ['2', 'add profile'],
    ['3', 'edit profile'],
    ['4', 'delete profile'],
    ['5', 'set defaultProfile'],
    ['6', 'edit the pixel block'],
    ['7', 'test a profile'],
    ['8', 'show the config file path'],
    ['q', 'quit'],
  ]

  try {
    const info = targetInfo(ctx)
    // A file that exists but does not load is never silently replaced: the
    // operator confirms the overwrite, and the default is to leave it alone.
    let broken = !!ctx.config.error && existsSync(info.path)
    if (broken) {
      out('')
      out(`config file: ${info.path}`)
      out(`error: ${ctx.config.error}`)
      const answer = await ask(`start from empty and overwrite ${info.path}? other content is lost (y/N): `)
      if (answer !== 'y') {
        out('left as-is')
        return { summary: `left ${info.path} untouched (it does not load)`, path: info.path, configError: ctx.config.error }
      }
    }

    const write = (path_, next) => {
      const { warnings } = save(ctx, path_, next)
      broken = false
      out(`wrote ${path_}`)
      for (const warning of warnings) out(`warning: ${warning}`)
    }

    /** Ask every profile field; the returned object omits blanks (they mean "keep unset"). */
    const readProfile = async (current) => {
      const answers = {
        provider: await askField(ask, 'provider (openrouter|magpie)', current.provider),
        baseUrl: await askField(ask, 'baseUrl (magpie only)', current.baseUrl),
        apiKeyEnv: await askField(ask, 'apiKeyEnv (env var name holding the key)', current.apiKeyEnv),
        apiKey: await askField(ask, 'apiKey (inline secret — prefer apiKeyEnv)', current.apiKey ? '(set)' : undefined),
        imageModel: await askField(ask, 'imageModel', current.imageModel),
        qaModel: await askField(ask, 'qaModel', current.qaModel),
      }
      if (Object.values(answers).some((v) => v === null)) return null
      return compact(answers)
    }

    for (;;) {
      const state = broken ? {} : readRaw(info.path)
      const ids = Object.keys(state.profiles || {})
      out('')
      out(`config file: ${info.path}${existsSync(info.path) ? '' : ' (does not exist yet)'}`)
      out(`default profile: ${state.defaultProfile || 'none'} · profiles: ${ids.join(', ') || 'none'} · pixel: ${pixelKeySource(state.pixel)}`)
      for (const [key, label] of menu) out(`  ${key}) ${label}`)

      const choice = await ask('choose> ')
      if (choice === null || choice === 'q' || choice === 'quit') break

      try {
        if (choice === '1') {
          if (!ids.length) out('no profiles yet — use 2 to add one')
          for (const id of ids) {
            const p = state.profiles[id]
            out(`${id}: ${p.provider}${p.baseUrl ? ` @ ${p.baseUrl}` : ''} · image: ${p.imageModel || 'default'} · qa: ${p.qaModel || 'default'} · key: ${profileKeySource(p)}`)
          }
        } else if (choice === '2') {
          const id = await ask('profile id (a-z, 0-9, -): ')
          if (id === null) break
          if (state.profiles?.[id]) {
            out(`"${id}" exists — use 3 to edit it`)
            continue
          }
          const profile = await readProfile({})
          if (profile === null) break
          write(info.path, { ...state, profiles: { ...(state.profiles || {}), [id]: profile } })
        } else if (choice === '3') {
          const id = await ask(`profile to edit (${ids.join(', ') || 'none'}): `)
          if (id === null) break
          if (!state.profiles?.[id]) {
            out(`no profile "${id}"`)
            continue
          }
          const profile = await readProfile(state.profiles[id])
          if (profile === null) break
          write(info.path, { ...state, profiles: { ...state.profiles, [id]: profile } })
        } else if (choice === '4') {
          const id = await ask(`profile to delete (${ids.join(', ') || 'none'}): `)
          if (id === null) break
          if (!state.profiles?.[id]) {
            out(`no profile "${id}"`)
            continue
          }
          if ((await ask(`delete "${id}"? (y/N): `)) !== 'y') {
            out('kept')
            continue
          }
          const next = { ...state, profiles: { ...state.profiles } }
          delete next.profiles[id]
          // A dangling defaultProfile would fail validation on the next load.
          if (next.defaultProfile === id) delete next.defaultProfile
          write(info.path, next)
        } else if (choice === '5') {
          const answer = await ask(`default profile (${ids.join(', ') || 'none'}) [${state.defaultProfile || 'none'}] (- to clear): `)
          if (answer === null) break
          if (!answer) continue
          const next = { ...state }
          if (answer === '-') delete next.defaultProfile
          else next.defaultProfile = answer
          write(info.path, next)
        } else if (choice === '6') {
          const current = state.pixel || {}
          const answers = {
            apiKeyEnv: await askField(ask, 'pixel.apiKeyEnv (env var name)', current.apiKeyEnv),
            apiKey: await askField(ask, 'pixel.apiKey (inline secret — prefer apiKeyEnv)', current.apiKey ? '(set)' : undefined),
          }
          if (Object.values(answers).some((v) => v === null)) break
          const pixel = compact(answers)
          const next = { ...state }
          if (Object.keys(pixel).length) next.pixel = pixel
          else delete next.pixel
          write(info.path, next)
        } else if (choice === '7') {
          const id = await ask(`profile to test (${ids.join(', ')}) [${state.defaultProfile || 'none'}]: `)
          if (id === null) break
          const { config } = ctx.ieConfig.validateIeConfig(state, info.path)
          out((await testProfile(ctx, config, id || config.defaultProfile || null)).summary)
        } else if (choice === '8') {
          out(`${info.path} (${info.source}${existsSync(info.path) ? '' : ', not created yet'})`)
        } else {
          out(`unknown choice "${choice}"`)
        }
      } catch (err) {
        out(`error: ${err.message}`)
      }
    }
    return { summary: 'config editor closed', path: info.path }
  } finally {
    rl.close()
  }
}

const config = {
  summary: 'the provider config file — path/list/get/set/unset/test, or an interactive editor with no subcommand',
  usage: USAGE,
  // parseArgs runs strict per top-level command, so every flag any subcommand
  // accepts has to be declared here; `--help` is a subcommand token too.
  options: { help: { type: 'boolean' } },

  async run(ctx) {
    const sub = ctx.args[0]
    if (ctx.flags.help || sub === 'help' || sub === '--help') return { summary: helpText(ctx.spec) }

    if (sub === undefined) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new UsageError(
          '`ie config` with no subcommand opens an interactive editor, but stdin/stdout is not a TTY; ' +
            `non-interactive subcommands: ${Object.keys(SUBCOMMANDS).join(', ')}`,
          ctx.spec.usage,
        )
      }
      return interactive(ctx)
    }

    if (sub === 'path') {
      const info = targetInfo(ctx)
      return {
        summary: `${info.path} (${info.source}${info.exists ? ', exists' : ', not created yet'})`,
        path: info.path,
        exists: info.exists,
        source: info.source,
        configError: ctx.config.error,
      }
    }

    if (sub === 'list') {
      const cfg = ctx.config
      const profiles = Object.entries(cfg.profiles).map(([id, p]) => ({
        id,
        provider: p.provider,
        baseUrl: p.baseUrl ?? null,
        imageModel: p.imageModel ?? null,
        qaModel: p.qaModel ?? null,
        keySource: profileKeySource(p),
      }))
      return {
        summary: cfg.error
          ? `${cfg.file} does not load: ${cfg.error}`
          : profiles.length
            ? `${profiles.length} profile(s)${cfg.defaultProfile ? `, default ${cfg.defaultProfile}` : ''} (${cfg.path || 'no file'})`
            : `no profiles — \`ie config set profiles.<id>.provider magpie\` writes ${targetInfo(ctx).path}`,
        path: cfg.file,
        exists: existsSync(cfg.file),
        defaultProfile: cfg.defaultProfile ?? null,
        profiles,
        pixel: pixelKeySource(cfg.pixel),
        warnings: cfg.warnings,
        configError: cfg.error,
      }
    }

    if (sub === 'get') {
      const dotted = positional(ctx.args, 1, 'dotted.path', ctx.spec)
      const target = parsePath(dotted, ctx.spec)
      const value = getPath(ctx.config, target) ?? null
      return {
        summary: ctx.config.error
          ? `${ctx.config.file} does not load: ${ctx.config.error}`
          : `${dotted} = ${JSON.stringify(shown(target, value))}`,
        path: ctx.config.file,
        value: shown(target, value),
        configError: ctx.config.error,
      }
    }

    if (sub === 'set') {
      const dotted = positional(ctx.args, 1, 'dotted.path', ctx.spec)
      const value = positional(ctx.args, 2, 'value', ctx.spec)
      const target = parsePath(dotted, ctx.spec)
      const file = ctx.config.file
      const { config: written, warnings } = save(ctx, file, setPath(editable(ctx), target, value))
      const stored = getPath(written, target) ?? null
      return {
        summary: `${dotted} = ${JSON.stringify(shown(target, stored))} in ${file}`,
        path: file,
        value: shown(target, stored),
        warnings,
      }
    }

    if (sub === 'unset') {
      const dotted = positional(ctx.args, 1, 'dotted.path', ctx.spec)
      const target = parsePath(dotted, ctx.spec)
      const file = ctx.config.file
      const raw = editable(ctx)
      if (getPath(raw, target) === undefined) return { summary: `${dotted} was not set`, path: file, changed: false }
      save(ctx, file, unsetPath(raw, target))
      return { summary: `unset ${dotted} in ${file}`, path: file, changed: true }
    }

    if (sub === 'test') {
      if (ctx.config.error) {
        throw new CliError('config_invalid', `${ctx.config.error} — fix or delete the file before testing`)
      }
      return testProfile(ctx, ctx.config, ctx.profile || ctx.config.defaultProfile || null)
    }

    throw new UsageError(
      `unknown subcommand "${sub}" — non-interactive subcommands: ${Object.keys(SUBCOMMANDS).join(', ')}`,
      ctx.spec.usage,
    )
  },
}

export default { config }
