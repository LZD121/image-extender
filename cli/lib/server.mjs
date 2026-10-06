/**
 * The dev server the CLI talks to, and the HTTP client for its routes.
 *
 * Generation only happens server-side (real prompt engineering, real provider
 * config), so every studio command needs a running `next dev`. `ensureServer`
 * finds or starts one; it is the reason `ie` needs no `next dev` babysitting
 * from the agent.
 */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { IE_DIR, REPO_ROOT, requireFromRepo } from '../native/deps.mjs'
import { CliError } from './args.mjs'

const STATE_FILE = path.join(IE_DIR, 'server.json')
const LOG_FILE = path.join(IE_DIR, 'server.log')
export const DEFAULT_PORT = 4317

/** Readiness + liveness probe: `/api/providers` answers without any key. */
async function alive(baseUrl, timeoutMs = 2500) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/providers`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}

export function readServerState() {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return typeof state?.url === 'string' ? state : null
  } catch {
    return null
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

/** The next free port at or after `from`, so a busy 4317 never blocks a run. */
async function pickPort(from) {
  for (let port = from; port < from + 50; port++) {
    if (await isPortFree(port)) return port
  }
  throw new CliError('no_port', `no free port in ${from}..${from + 49}`)
}

function spawnDev(port) {
  mkdirSync(IE_DIR, { recursive: true })
  const log = openSync(LOG_FILE, 'a')
  let bin
  try {
    bin = requireFromRepo.resolve('next/dist/bin/next')
  } catch {
    throw new CliError('no_next', 'next is not installed here — run `npm install` in the repo first')
  }
  const child = spawn(process.execPath, [bin, 'dev', '-p', String(port)], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
  })
  child.unref()
  closeSync(log)
  return child.pid
}

async function waitForReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await alive(url)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/**
 * A base URL to talk to. `$IE_BASE_URL` / `--base-url` wins (the documented
 * fallback for "my `next dev` is already up"); otherwise a previously started
 * server is reused, otherwise one is started and recorded in `.ie/server.json`.
 */
export async function ensureServer({ baseUrl, port, timeoutMs = 90000, note } = {}) {
  const explicit = (baseUrl || process.env.IE_BASE_URL || '').trim()
  if (explicit) {
    const url = explicit.replace(/\/+$/, '')
    if (!(await alive(url))) {
      throw new CliError('server_unreachable', `no server answering at ${url} (IE_BASE_URL/--base-url)`)
    }
    return { url, pid: null, spawned: false }
  }

  const state = readServerState()
  if (state && (await alive(state.url))) return { url: state.url, pid: state.pid ?? null, spawned: false }

  const chosen = await pickPort(port || DEFAULT_PORT)
  const url = `http://127.0.0.1:${chosen}`
  const pid = spawnDev(chosen)
  if (note) note(`starting next dev on port ${chosen} (log: .ie/server.log)`)
  if (!(await waitForReady(url, timeoutMs))) {
    throw new CliError('server_timeout', `next dev did not answer on ${url} within ${Math.round(timeoutMs / 1000)}s — see .ie/server.log`)
  }
  writeFileSync(STATE_FILE, JSON.stringify({ url, port: chosen, pid, startedAt: new Date().toISOString() }, null, 2) + '\n')
  return { url, pid, spawned: true }
}

/** Stop the server this CLI started. A server the user started is left alone. */
export function stopServer() {
  const state = readServerState()
  if (!state) return { stopped: false, reason: 'no server recorded in .ie/server.json' }
  if (state.pid) {
    try {
      process.kill(state.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
  rmSync(STATE_FILE, { force: true })
  return { stopped: true, pid: state.pid ?? null, url: state.url }
}

/** Readiness of a *recorded* server, for `ie status`. */
export async function statusServer() {
  const state = readServerState()
  if (!state) return { running: false, state: null }
  return { running: await alive(state.url), state, log: existsSync(LOG_FILE) ? LOG_FILE : null }
}

/**
 * One route call. Returns the raw HTTP facts — routes keep their own response
 * shapes (`{imageUrl,…}` / `{error}`), and the CLI never rewrites them.
 */
/** A GET route — the keyless reads (`/api/providers`, `/api/library`). */
export async function apiGet(baseUrl, route) {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/${String(route).replace(/^\/+/, '')}`
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  } catch (err) {
    throw new CliError('request_failed', `${route}: ${err.message}`)
  }
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text.slice(0, 4000) }
  }
  return { status: res.status, ok: res.ok, body: parsed }
}

/**
 * One route call. Returns the raw HTTP facts — routes keep their own response
 * shapes (`{imageUrl,…}` / `{error}`), and the CLI never rewrites them.
 */
export async function apiCall(baseUrl, route, body, { headers } = {}) {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/${String(route).replace(/^\/+/, '')}`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(15 * 60 * 1000),
    })
  } catch (err) {
    throw new CliError('request_failed', `${route}: ${err.message}`)
  }
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text.slice(0, 4000) }
  }
  return { status: res.status, ok: res.ok, body: parsed }
}

/** The failure message a route reported, for a concise error. */
export function routeError(route, result) {
  const message = result?.body?.error
  const detail = typeof message === 'string' ? message : JSON.stringify(result?.body || {}).slice(0, 400)
  return new CliError('route_failed', `${route} → HTTP ${result.status}: ${detail}`, result?.body)
}
