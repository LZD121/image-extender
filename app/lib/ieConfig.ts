/**
 * The headless CLI's provider/model configuration file.
 *
 * One small JSON file decides which gateway, base URL, credential and models a
 * request uses, so an agent running `ie` never has to pass secrets or URLs on
 * the command line. The server resolves the profile (this module); the CLI only
 * sends the profile *id*, exactly like the browser sends a provider id.
 *
 * Node-safe on purpose: no Next/React imports, so the CLI can bundle it too.
 * Resolution order: `$IE_CONFIG` → `<cwd>/.ie/config.json` →
 * `~/.config/image-extender/config.json` → no file (legacy env behavior).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  PROVIDERS,
  isProviderId,
  type Provider,
  type ProviderId,
} from '@/app/lib/providers'

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const TOP_KEYS = ['defaultProfile', 'profiles', 'pixel'] as const
const PROFILE_KEYS = ['provider', 'baseUrl', 'apiKeyEnv', 'apiKey', 'imageModel', 'qaModel'] as const
const PIXEL_KEYS = ['apiKeyEnv', 'apiKey'] as const

export type IeProfile = {
  provider: ProviderId
  baseUrl?: string
  apiKeyEnv?: string
  apiKey?: string
  imageModel?: string
  qaModel?: string
}

export type IePixelConfig = { apiKeyEnv?: string; apiKey?: string }

export type IeConfig = {
  defaultProfile?: string
  profiles: Record<string, IeProfile>
  pixel: IePixelConfig
}

export type LoadedIeConfig = IeConfig & {
  /** Resolved path the values came from; null when no file exists. */
  path: string | null
  /** Non-fatal notes an operator should see (inline key present, …). */
  warnings: string[]
}

/** Thrown for anything an operator must fix; the message is the instruction. */
export class IeConfigError extends Error {
  constructor(message: string, readonly file: string | null = null) {
    super(file ? `${file}: ${message}` : message)
    this.name = 'IeConfigError'
  }
}

/** `$IE_CONFIG`, then the project-local file, then the user config file. */
export function configFilePath(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd()
): { path: string; required: boolean } | null {
  const explicit = (env.IE_CONFIG || '').trim()
  if (explicit) return { path: path.resolve(cwd, explicit), required: true }
  const local = path.join(cwd, '.ie', 'config.json')
  if (fs.existsSync(local)) return { path: local, required: false }
  const home = path.join(os.homedir(), '.config', 'image-extender', 'config.json')
  if (fs.existsSync(home)) return { path: home, required: false }
  return null
}

function fail(message: string, file: string | null = null): never {
  throw new IeConfigError(message, file)
}

function asObject(value: unknown, where: string, file: string | null): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${where} must be an object`, file)
  return value as Record<string, unknown>
}

function asString(value: unknown, where: string, file: string | null): string {
  if (typeof value !== 'string') fail(`${where} must be a string`, file)
  return value
}

function rejectUnknown(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  file: string | null
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      fail(`${where}: unknown field "${key}" (allowed: ${allowed.join(', ')})`, file)
    }
  }
}

/**
 * Validate a raw parsed config. Pure — the TUI and `ie config set` validate
 * through this too, so a file that loads is a file the server accepts.
 */
export function validateIeConfig(
  raw: unknown,
  file: string | null = null
): { config: IeConfig; warnings: string[] } {
  const top = asObject(raw, 'config', file)
  rejectUnknown(top, TOP_KEYS, 'config', file)
  const warnings: string[] = []

  const profiles: Record<string, IeProfile> = {}
  if (top.profiles !== undefined) {
    const rawProfiles = asObject(top.profiles, '"profiles"', file)
    for (const [id, value] of Object.entries(rawProfiles)) {
      if (!PROFILE_ID_RE.test(id)) {
        fail(`profiles: invalid profile id "${id}" (must match ${PROFILE_ID_RE})`, file)
      }
      const where = `profiles.${id}`
      const p = asObject(value, where, file)
      rejectUnknown(p, PROFILE_KEYS, where, file)
      if (p.provider === undefined) fail(`${where}.provider is required`, file)
      const provider = asString(p.provider, `${where}.provider`, file)
      if (!isProviderId(provider)) {
        fail(`${where}.provider must be one of the supported providers, got "${provider}"`, file)
      }

      const profile: IeProfile = { provider }
      if (p.baseUrl !== undefined) {
        if (provider !== 'magpie') {
          fail(`${where}.baseUrl is only valid for provider "magpie" (a generic OpenAI-compatible gateway)`, file)
        }
        const url = asString(p.baseUrl, `${where}.baseUrl`, file).trim().replace(/\/+$/, '')
        if (!/^https?:\/\/[^\s]+$/.test(url)) fail(`${where}.baseUrl must be an http(s) URL`, file)
        profile.baseUrl = url
      }
      if (p.apiKeyEnv !== undefined) {
        const name = asString(p.apiKeyEnv, `${where}.apiKeyEnv`, file).trim()
        if (!ENV_NAME_RE.test(name)) fail(`${where}.apiKeyEnv must be an env var name, got "${name}"`, file)
        profile.apiKeyEnv = name
      }
      if (p.apiKey !== undefined) {
        const key = asString(p.apiKey, `${where}.apiKey`, file).trim()
        if (key) {
          profile.apiKey = key
          warnings.push(`${where}.apiKey holds a secret inline; prefer apiKeyEnv (env var name)`)
        }
      }
      for (const kind of ['imageModel', 'qaModel'] as const) {
        if (p[kind] === undefined) continue
        const model = asString(p[kind], `${where}.${kind}`, file).trim()
        if (!model) fail(`${where}.${kind} must not be empty`, file)
        profile[kind] = model
      }
      profiles[id] = profile
    }
  }

  const pixel: IePixelConfig = {}
  if (top.pixel !== undefined) {
    const p = asObject(top.pixel, '"pixel"', file)
    rejectUnknown(p, PIXEL_KEYS, 'pixel', file)
    if (p.apiKeyEnv !== undefined) {
      const name = asString(p.apiKeyEnv, 'pixel.apiKeyEnv', file).trim()
      if (!ENV_NAME_RE.test(name)) fail(`pixel.apiKeyEnv must be an env var name, got "${name}"`, file)
      pixel.apiKeyEnv = name
    }
    if (p.apiKey !== undefined) {
      const key = asString(p.apiKey, 'pixel.apiKey', file).trim()
      if (key) {
        pixel.apiKey = key
        warnings.push('pixel.apiKey holds a secret inline; prefer apiKeyEnv (env var name)')
      }
    }
  }

  const config: IeConfig = { profiles, pixel }
  if (top.defaultProfile !== undefined) {
    const id = asString(top.defaultProfile, '"defaultProfile"', file).trim()
    if (!PROFILE_ID_RE.test(id)) fail(`"defaultProfile" must match ${PROFILE_ID_RE}, got "${id}"`, file)
    if (!profiles[id]) fail(`"defaultProfile" points at "${id}", which no profile defines`, file)
    config.defaultProfile = id
  }
  return { config, warnings }
}

const EMPTY: LoadedIeConfig = { profiles: {}, pixel: {}, path: null, warnings: [] }

let cache: { key: string; value: LoadedIeConfig } | null = null

/** Read + validate the config file. Cached on (path, mtime). */
export function loadIeConfig(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd()
): LoadedIeConfig {
  const found = configFilePath(env, cwd)
  if (!found) return EMPTY
  let mtimeMs: number
  try {
    mtimeMs = fs.statSync(found.path).mtimeMs
  } catch {
    if (found.required) fail(`config file not found: ${found.path} (unset IE_CONFIG or create it)`, null)
    return EMPTY
  }
  const key = `${found.path}:${mtimeMs}`
  if (cache && cache.key === key) return cache.value

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(found.path, 'utf8'))
  } catch (err) {
    fail(`not valid JSON (${(err as Error).message}) — fix it or delete the file`, found.path)
  }
  const { config, warnings } = validateIeConfig(raw, found.path)
  const value: LoadedIeConfig = { ...config, path: found.path, warnings }
  cache = { key, value }
  return value
}

/** Look up one profile; null when the config (or the id) has nothing to say. */
export function resolveProfile(config: IeConfig, id: unknown): IeProfile | null {
  if (typeof id !== 'string') return null
  return config.profiles[id] || null
}

/** A profile as the server needs it: the app's provider shape, overridden. */
export function effectiveProvider(profile: IeProfile): Provider {
  const base = PROVIDERS[profile.provider]
  return {
    ...base,
    // A profile is normally normalized at load time; the CLI also builds these
    // inline (`ie config test`), so normalize here too — the URL is concatenated.
    baseUrl: (profile.baseUrl || base.baseUrl).replace(/\/+$/, ''),
    imageModel: profile.imageModel || base.imageModel,
    qaModel: profile.qaModel || base.qaModel,
  }
}

/** The profile's credential: its env var when set, else the inline key. */
export function profileKey(
  profile: IeProfile,
  env: Record<string, string | undefined> = process.env
): string {
  if (profile.apiKeyEnv) {
    const fromEnv = (env[profile.apiKeyEnv] || '').trim()
    if (fromEnv) return fromEnv
  }
  return (profile.apiKey || '').trim()
}

/**
 * Which model id a model route should call: the request wins, then the
 * profile's image/qa model, then the route's own default.
 */
export function resolveConfigModel(
  bodyModel: unknown,
  profile: IeProfile | null,
  kind: 'image' | 'qa',
  routeDefault: string
): string {
  if (typeof bodyModel === 'string' && bodyModel.trim()) return bodyModel.trim()
  const fromProfile = profile ? (kind === 'image' ? profile.imageModel : profile.qaModel) : undefined
  if (fromProfile && fromProfile.trim()) return fromProfile.trim()
  return routeDefault
}
