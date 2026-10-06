/**
 * Core commands: the server lifecycle, `doctor`, and the universal HTTP escape
 * hatch. Everything an agent needs before it can generate anything.
 */
import { accessSync, constants, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { DEFAULT_PORT, apiCall, apiGet, ensureServer, routeError, statusServer, stopServer } from '../lib/server.mjs'
import path from 'node:path'
import { nativeStatus } from '../native/bridge.mjs'
import { REPO_ROOT, requireFromRepo } from '../native/deps.mjs'
import { CliError, UsageError, positional } from '../lib/args.mjs'
import { findImagePayload, saveImage } from '../lib/media.mjs'

/** Dependency presence, reported by `doctor` instead of failing at use time. */
function dependencyCheck(name) {
  try {
    requireFromRepo.resolve(name)
    return { ok: true, detail: name }
  } catch {
    return { ok: false, detail: `${name} not installed — run \`npm install\` in ${REPO_ROOT}` }
  }
}

function assetsCheck() {
  const dir = path.resolve(process.env.IE_ASSETS_DIR || path.join(REPO_ROOT, 'assets'))
  try {
    mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, '.ie-write-probe')
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    accessSync(dir, constants.W_OK)
    return { ok: true, detail: dir }
  } catch (err) {
    return { ok: false, detail: `${dir}: ${err.message}` }
  }
}

const serve = {
  summary: 'start (or reuse) the dev server the CLI talks to',
  usage: 'ie serve [--stop] [--port <n>]',
  options: { stop: { type: 'boolean' } },
  async run(ctx) {
    if (ctx.flags.stop) {
      const stopped = stopServer()
      return { summary: stopped.stopped ? `stopped ${stopped.url}` : stopped.reason, ...stopped }
    }
    const server = await ensureServer({
      baseUrl: ctx.baseUrl,
      port: ctx.port ? Number(ctx.port) : DEFAULT_PORT,
      note: ctx.note,
    })
    const providers = await apiGet(server.url, 'providers')
    if (!providers.ok) throw new CliError('route_failed', `providers → HTTP ${providers.status}`)
    return {
      summary: `${server.spawned ? 'started' : 'reusing'} ${server.url}`,
      url: server.url,
      pid: server.pid,
      spawned: server.spawned,
      defaultProvider: providers.body.defaultProvider,
    }
  },
}

const status = {
  summary: 'report the recorded server, config file and profiles',
  usage: 'ie status',
  options: {},
  async run(ctx) {
    const state = await statusServer()
    const server = await ensureServer({ baseUrl: ctx.baseUrl, note: () => {} }).catch(() => null)
    return {
      summary: state.running
        ? `server running at ${state.state.url}`
        : 'no server running (any command that needs one will start it)',
      running: state.running,
      recorded: state.state,
      reachable: server ? server.url : null,
      config: ctx.config.path,
      profiles: Object.keys(ctx.config.profiles),
      defaultProfile: ctx.config.defaultProfile || null,
      log: state.log,
    }
  },
}

const doctor = {
  summary: 'check every prerequisite (node, deps, Chromium, config, server, assets)',
  usage: 'ie doctor',
  options: {},
  async run(ctx) {
    const checks = {}
    const major = Number(process.versions.node.split('.')[0])
    checks.node = { ok: major >= 18, detail: process.versions.node }

    for (const dep of ['next', 'esbuild', 'playwright-core', 'sharp']) checks[dep] = dependencyCheck(dep)

    let native = null
    try {
      native = nativeStatus()
      checks.chromium = { ok: !!native.chromium, detail: native.chromium || 'not found' }
      checks.bundle = { ok: native.bundleBytes > 0, detail: `${native.bundle} (${native.bundleBytes} bytes)` }
    } catch (err) {
      checks.chromium = { ok: false, detail: 'the app modules could not be bundled' }
      checks.bundle = { ok: false, detail: err.message }
    }

    checks.config = {
      ok: true,
      detail: ctx.config.path
        ? ctx.config.path
        : 'no config file — legacy env behavior (OPENROUTER_API_KEY / IE_MAGPIE_BASE_URL)',
    }

    const profileId = ctx.profile || ctx.config.defaultProfile
    const profile = profileId ? ctx.config.profiles[profileId] : null
    checks.profile = {
      ok: !profileId || !!profile,
      detail: !profileId
        ? 'none named — the server uses the deployment default provider'
        : profile
          ? `${profileId}: provider=${profile.provider}${profile.baseUrl ? ` baseUrl=${profile.baseUrl}` : ''}`
          : `${profileId}: no such profile in ${ctx.config.path}`,
    }
    checks.credentials = profile
      ? {
          ok: true,
          detail: `key from ${profile.apiKeyEnv ? `$${profile.apiKeyEnv}` : profile.apiKey ? 'inline config' : `$${profile.provider === 'magpie' ? 'MAGPIE_API_KEY' : 'OPENROUTER_API_KEY'} (provider default)`}`,
        }
      : {
          ok: true,
          detail: process.env.OPENROUTER_API_KEY
            ? 'OPENROUTER_API_KEY is set'
            : 'no profile and no OPENROUTER_API_KEY (a self-hosted gateway may need no key)',
        }
    checks.assets = assetsCheck()

    const state = await statusServer()
    checks.server = {
      ok: state.running || dependencyCheck('next').ok,
      detail: state.running
        ? `running at ${state.state.url}`
        : 'not running — `ie serve` starts one (or point IE_BASE_URL at your own)',
    }

    const failed = Object.entries(checks).filter(([, check]) => !check.ok)
    const summary = failed.length
      ? `doctor: ${failed.length} check(s) failed — ${failed.map(([key]) => key).join(', ')}`
      : 'doctor: all checks passed'
    if (failed.length) throw new CliError('doctor_failed', summary, checks)
    return { summary, checks, chromium: native ? native.chromium : null, repo: REPO_ROOT }
  },
}

const call = {
  summary: 'POST any /api route with a raw body (escape hatch for every route)',
  usage: 'ie call <route> [--body <json>] [--body-file <file>] [--save <out.png>]',
  options: { body: { type: 'string' }, 'body-file': { type: 'string' }, save: { type: 'string' } },
  async run(ctx) {
    const route = positional(ctx.args, 0, 'route', ctx.spec)
    if (ctx.flags.body && ctx.flags['body-file']) {
      throw new UsageError('--body and --body-file are mutually exclusive', ctx.spec.usage)
    }
    let body = {}
    if (ctx.flags.body) {
      try {
        body = JSON.parse(ctx.flags.body)
      } catch (err) {
        throw new UsageError(`--body is not valid JSON: ${err.message}`, ctx.spec.usage)
      }
    } else if (ctx.flags['body-file']) {
      try {
        body = JSON.parse(await readFile(ctx.flags['body-file'], 'utf8'))
      } catch (err) {
        throw new CliError('bad_body_file', `${ctx.flags['body-file']}: ${err.message}`)
      }
    }
    const { url } = await ctx.server()
    const res = await apiCall(url, route, body)
    // A non-2xx is a failure even here: `ok` must mean the request worked, not
    // that we managed to send it. The route's body still travels in `detail`.
    if (!res.ok) throw routeError(route, res)
    const payload = { summary: `${route} → HTTP ${res.status}`, status: res.status, body: res.body }
    if (ctx.flags.save) {
      const image = findImagePayload(res.body)
      if (!image) throw new CliError('no_image', `${route} returned no image to save`, res.body)
      payload.written = [await saveImage(image, ctx.flags.save)]
    }
    return payload
  },
}

export default { serve, status, doctor, call }
