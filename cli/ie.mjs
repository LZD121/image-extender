#!/usr/bin/env node
/**
 * `ie` — image-extender's headless CLI.
 *
 * Everything the browser app can do, with no browser: generation through the
 * real dev server (`ie serve` → `next dev`), every pixel transform through the
 * app's own code in headless Chromium (`cli/native/bridge.mjs`), the asset
 * library and pixel grid through esbuild-bundled app modules.
 *
 * Two output modes. Default is human: progress on stderr, results on stdout.
 * `--json` is machine mode: exactly one `{ok:true,…}` or
 * `{ok:false,error:{code,message}}` object on stdout, exit 0/1 (2 = usage).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { nodeBundle } from './native/bundle.mjs'
import { CliError, UsageError, errorEnvelope, okEnvelope, parseCommand } from './lib/args.mjs'
import { createContext } from './lib/context.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const COMMAND_MODULES = [
  './commands/core.mjs',
  './commands/prim.mjs',
  './commands/studio.mjs',
  './commands/pixel.mjs',
  './commands/library.mjs',
  './commands/anim.mjs',
  './commands/config.mjs',
]

/** Flags that belong to the CLI itself, valid on any command. */
const GLOBAL_FLAGS = {
  '--json': 'json',
  '--base-url': 'baseUrl',
  '--profile': 'profile',
  '--model': 'model',
  '--port': 'port',
}

/** A command that printed its own output (help, version) — print nothing more. */
const SILENT = Symbol('silent')

/** Pull the global flags out before the command's own strict parse runs. */
function splitGlobals(argv) {
  const globals = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    const eq = token.startsWith('--') ? token.indexOf('=') : -1
    const name = eq === -1 ? token : token.slice(0, eq)
    const key = GLOBAL_FLAGS[name]
    if (!key) {
      rest.push(token)
      continue
    }
    if (name === '--json') {
      globals.json = true
      continue
    }
    const value = eq === -1 ? argv[++i] : token.slice(eq + 1)
    if (value === undefined) throw new UsageError(`${name} needs a value`, 'ie help')
    globals[key] = value
  }
  return { globals, rest }
}

async function loadCommands() {
  const commands = new Map()
  for (const mod of COMMAND_MODULES) {
    const loaded = await import(mod)
    for (const [name, spec] of Object.entries(loaded.default || {})) commands.set(name, spec)
  }
  return commands
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function helpText(commands, name) {
  const spec = name ? commands.get(name) : null
  if (spec) {
    const flags = Object.keys(spec.options || {})
    return [
      `ie ${name} — ${spec.summary}`,
      '',
      `usage: ${spec.usage}`,
      `flags: ${flags.length ? flags.map((f) => '--' + f).join(' ') : '(none)'}`,
      '',
      'global flags: --json --base-url <url> --profile <id> --model <id>',
    ].join('\n')
  }
  const rows = [...commands.entries()].map(([key, s]) => `  ${key.padEnd(14)} ${s.summary}`)
  return [
    `ie — image-extender headless CLI (v${packageVersion()})`,
    '',
    'usage: ie <command> [args] [flags]',
    '',
    'commands:',
    ...rows,
    '',
    'global flags: --json --base-url <url> --profile <id> --model <id>',
    'docs: docs/agent-api.md · per-command detail: ie help <command>',
  ].join('\n')
}

/** Default human rendering: summary, the files written, then the rest as JSON. */
function renderHuman(payload) {
  const lines = []
  if (payload.summary) lines.push(payload.summary)
  if (Array.isArray(payload.written)) lines.push(...payload.written.map((p) => `wrote ${p}`))
  if (Array.isArray(payload.warnings)) lines.push(...payload.warnings.map((w) => `warning: ${w}`))
  const rest = { ...payload }
  delete rest.summary
  delete rest.written
  delete rest.warnings
  const keys = Object.keys(rest).filter((k) => rest[k] !== undefined && rest[k] !== null)
  if (keys.length) lines.push(JSON.stringify(Object.fromEntries(keys.map((k) => [k, rest[k]])), null, 2))
  return lines.join('\n') || 'ok'
}

async function main(argv) {
  const { globals, rest } = splitGlobals(argv)
  const commands = await loadCommands()
  const [name, ...args] = rest

  if (!name || name === 'help' || name === '-h' || name === '--help') {
    process.stdout.write(helpText(commands, args[0]) + '\n')
    return SILENT
  }
  if (name === 'version' || name === '--version' || name === '-v') {
    process.stdout.write(packageVersion() + '\n')
    return SILENT
  }

  const spec = commands.get(name)
  if (!spec) throw new UsageError(`unknown command "${name}"`, 'Run `ie help` for the command list.')

  // The config is validated once, up front: a malformed file must be an
  // actionable error, never something that silently degrades a request. The one
  // exception is `ie config` itself — a broken or missing file is exactly what
  // it was invoked to deal with, so it gets the error instead of dying on it.
  const ieConfig = await import(pathToFileURL(nodeBundle('config', ['app/lib/ieConfig'])).href)
  const where = ieConfig.configFilePath()
  const target = where ? where.path : path.join(process.cwd(), '.ie', 'config.json')
  let config
  try {
    config = ieConfig.loadIeConfig()
  } catch (err) {
    if (name !== 'config') throw new CliError('config_invalid', err.message)
    config = { profiles: {}, pixel: {}, path: null, warnings: [] }
    globals.configError = err.message
  }
  // `file` is where a write must land — the existing file, or the path a new one
  // would take, so `ie config set` can bootstrap the very first config.
  globals.config = { ...config, file: config.path || target, error: globals.configError || null }

  const { values, positionals } = parseCommand(args, spec)
  const note = (message) => {
    if (!globals.json) process.stderr.write(message + '\n')
  }
  for (const warning of config.warnings) note(`warning: ${warning}`)

  const ctx = createContext({ globals, cmd: { positionals, values, spec, ieConfig }, note })
  const payload = await spec.run(ctx)
  return payload === undefined ? {} : payload
}

const jsonMode = process.argv.includes('--json')
try {
  const payload = await main(process.argv.slice(2))
  if (payload === SILENT) {
    // help/version already wrote to stdout
  } else if (jsonMode) {
    process.stdout.write(JSON.stringify(okEnvelope(payload)) + '\n')
  } else {
    process.stdout.write(renderHuman(payload) + '\n')
  }
} catch (err) {
  const { exit, ...envelope } = errorEnvelope(err)
  if (jsonMode) process.stdout.write(JSON.stringify(envelope) + '\n')
  else process.stderr.write(`ie: ${envelope.error.message}\n`)
  process.exit(exit)
}
