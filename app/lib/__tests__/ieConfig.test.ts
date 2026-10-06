import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  IeConfigError,
  configFilePath,
  effectiveProvider,
  type IeConfig,
  loadIeConfig,
  profileKey,
  resolveConfigModel,
  resolveProfile,
  validateIeConfig,
} from '@/app/lib/ieConfig'
import { llmTarget, modelOrDefault } from '@/app/lib/llmServer'

let dir: string
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ie-config-'))
  savedEnv.IE_CONFIG = process.env.IE_CONFIG
  savedEnv.MAGPIE_TEST_KEY = process.env.MAGPIE_TEST_KEY
  savedEnv.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
  delete process.env.IE_CONFIG
  delete process.env.MAGPIE_TEST_KEY
  delete process.env.OPENROUTER_API_KEY
})

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(dir, { recursive: true, force: true })
})

async function writeConfig(name: string, content: unknown): Promise<string> {
  const file = path.join(dir, name)
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  return file
}

const valid: IeConfig = {
  defaultProfile: 'local-magpie',
  profiles: {
    'local-magpie': { provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1/', imageModel: 'teamo-router/gemini-3.1-flash-image', qaModel: 'commandcode/Qwen' },
    paid: { provider: 'openrouter', apiKeyEnv: 'MAGPIE_TEST_KEY' },
  },
  pixel: { apiKeyEnv: 'PIXELLAB_API_KEY' },
}

describe('config discovery', () => {
  it('prefers $IE_CONFIG over the project-local file and marks it required', async () => {
    await mkdir(path.join(dir, '.ie'), { recursive: true })
    const local = path.join(dir, '.ie', 'config.json')
    await writeFile(local, '{}')
    const found = configFilePath({ IE_CONFIG: 'explicit.json' }, dir)
    expect(found).toEqual({ path: path.join(dir, 'explicit.json'), required: true })
  })

  it('falls back to <cwd>/.ie/config.json', async () => {
    await mkdir(path.join(dir, '.ie'), { recursive: true })
    await writeFile(path.join(dir, '.ie', 'config.json'), '{}')
    expect(configFilePath({}, dir)).toEqual({ path: path.join(dir, '.ie', 'config.json'), required: false })
  })

  it('reports a missing $IE_CONFIG file instead of silently degrading', () => {
    process.env.IE_CONFIG = path.join(dir, 'nope.json')
    expect(() => loadIeConfig()).toThrow(/config file not found/)
  })

  it('reports malformed JSON with the file path', async () => {
    process.env.IE_CONFIG = await writeConfig('broken.json', '{ nope')
    expect(() => loadIeConfig()).toThrow(IeConfigError)
    expect(() => loadIeConfig()).toThrow(/not valid JSON/)
  })
})

describe('validation', () => {
  it('accepts the documented schema and normalizes the base URL', () => {
    const { config, warnings } = validateIeConfig(valid)
    expect(warnings).toEqual([])
    expect(config.defaultProfile).toBe('local-magpie')
    expect(config.profiles['local-magpie'].baseUrl).toBe('http://127.0.0.1:3425/v1')
    expect(config.pixel).toEqual({ apiKeyEnv: 'PIXELLAB_API_KEY' })
  })

  it('warns about an inline key instead of rejecting it', () => {
    const { config, warnings } = validateIeConfig({
      profiles: { paid: { provider: 'openrouter', apiKey: 'sk-or-secret' } },
    })
    expect(config.profiles.paid.apiKey).toBe('sk-or-secret')
    expect(warnings.join(' ')).toMatch(/prefer apiKeyEnv/)
  })

  const rejects: [string, unknown, RegExp][] = [
    ['non-object config', [], /config must be an object/],
    ['unknown top-level field', { profiles: {}, nope: 1 }, /unknown field "nope"/],
    ['bad profile id', { profiles: { Bad_ID: { provider: 'openrouter' } } }, /invalid profile id/],
    ['unknown profile field', { profiles: { a: { provider: 'openrouter', url: 'x' } } }, /unknown field "url"/],
    ['missing provider', { profiles: { a: {} } }, /provider is required/],
    ['unknown provider', { profiles: { a: { provider: 'anthropic' } } }, /must be one of the supported providers/],
    ['baseUrl on openrouter', { profiles: { a: { provider: 'openrouter', baseUrl: 'http://x/v1' } } }, /only valid for provider "magpie"/],
    ['non-URL baseUrl', { profiles: { a: { provider: 'magpie', baseUrl: 'not-a-url' } } }, /must be an http\(s\) URL/],
    ['bad env name', { profiles: { a: { provider: 'openrouter', apiKeyEnv: 'not a name' } } }, /must be an env var name/],
    ['empty model', { profiles: { a: { provider: 'openrouter', imageModel: '  ' } } }, /must not be empty/],
    ['dangling defaultProfile', { defaultProfile: 'ghost', profiles: {} }, /which no profile defines/],
    ['unknown pixel field', { pixel: { key: 'x' } }, /unknown field "key"/],
  ]

  for (const [label, raw, pattern] of rejects) {
    it(`rejects ${label}`, () => {
      expect(() => validateIeConfig(raw)).toThrow(pattern)
    })
  }
})

describe('profile resolution', () => {
  it('merges a profile over the provider table and drops its trailing slash', () => {
    const provider = effectiveProvider({ provider: 'magpie', baseUrl: 'http://gw.test/v1/', imageModel: 'custom/image' })
    expect(provider.baseUrl).toBe('http://gw.test/v1')
    expect(provider.imageModel).toBe('custom/image')
    // Unset fields keep the table's value, so a profile never half-configures.
    expect(provider.qaModel).toBe('commandcode/Qwen/Qwen3.7-Plus')
    expect(provider.label).toBe('Magpie gateway')
  })

  it('reads the credential from the env var first, then inline', () => {
    process.env.MAGPIE_TEST_KEY = ' from-env '
    expect(profileKey({ provider: 'magpie', apiKeyEnv: 'MAGPIE_TEST_KEY', apiKey: 'inline' })).toBe('from-env')
    delete process.env.MAGPIE_TEST_KEY
    expect(profileKey({ provider: 'magpie', apiKeyEnv: 'MAGPIE_TEST_KEY', apiKey: 'inline' })).toBe('inline')
    expect(profileKey({ provider: 'magpie' })).toBe('')
  })

  it('resolves models: body, then profile kind, then route default', () => {
    const profile = { provider: 'magpie' as const, imageModel: 'profile-image', qaModel: 'profile-qa' }
    expect(resolveConfigModel('body-model', profile, 'image', 'route')).toBe('body-model')
    expect(resolveConfigModel(undefined, profile, 'image', 'route')).toBe('profile-image')
    expect(resolveConfigModel('  ', profile, 'qa', 'route')).toBe('profile-qa')
    expect(resolveConfigModel(undefined, null, 'qa', 'route')).toBe('route')
  })

  it('returns null for an unknown profile id', () => {
    expect(resolveProfile(valid, 'nope')).toBeNull()
    expect(resolveProfile(valid, 42)?.provider).toBeUndefined()
  })
})

describe('request precedence (llmTarget / modelOrDefault)', () => {
  it('body.provider wins over a profile — the browser path is never rerouted', async () => {
    process.env.IE_CONFIG = await writeConfig('precedence.json', valid)
    const target = llmTarget({ provider: 'openrouter', profile: 'local-magpie', apiKey: 'sk-or-x', title: 't' })
    expect('error' in target).toBe(false)
    expect('url' in target && target.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(modelOrDefault({ model: undefined, provider: 'openrouter', profile: 'local-magpie', kind: 'image', routeDefault: 'route-default' })).toBe('route-default')
  })

  it('uses the named profile: gateway URL, key from its env var, its models', async () => {
    process.env.IE_CONFIG = await writeConfig('profile.json', valid)
    process.env.MAGPIE_TEST_KEY = 'magpie-key'
    const target = llmTarget({ provider: undefined, profile: 'paid', apiKey: undefined, title: 't' })
    expect('url' in target && target.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect('headers' in target && target.headers.Authorization).toBe('Bearer magpie-key')
  })

  it('lets a body key override the profile credential', async () => {
    process.env.IE_CONFIG = await writeConfig('bodykey.json', valid)
    process.env.MAGPIE_TEST_KEY = 'profile-key'
    const target = llmTarget({ provider: undefined, profile: 'paid', apiKey: ' body-key ', title: 't' })
    expect('headers' in target && target.headers.Authorization).toBe('Bearer body-key')
  })

  it('falls back to defaultProfile when the request names nothing', async () => {
    process.env.IE_CONFIG = await writeConfig('default.json', valid)
    const target = llmTarget({ provider: undefined, apiKey: undefined, title: 't' })
    expect('url' in target && target.url).toBe('http://127.0.0.1:3425/v1/chat/completions')
    // magpie needs no key, so the request proceeds with no credential at all.
    expect('error' in target).toBe(false)
    expect(modelOrDefault({ model: undefined, provider: undefined, kind: 'image', routeDefault: 'route-default' })).toBe('teamo-router/gemini-3.1-flash-image')
  })

  it('is a hard, actionable error for a profile id the file does not define', async () => {
    process.env.IE_CONFIG = await writeConfig('ghost.json', valid)
    const target = llmTarget({ provider: undefined, profile: 'ghost', apiKey: undefined, title: 't' })
    expect('error' in target && target.error).toMatch(/unknown profile "ghost"/)
  })

  it('keeps the legacy env behavior when no profile and no config exist', async () => {
    process.env.IE_CONFIG = await writeConfig('empty.json', {})
    process.env.OPENROUTER_API_KEY = 'env-key'
    const target = llmTarget({ provider: undefined, apiKey: undefined, title: 't' })
    expect('error' in target).toBe(false)
    expect('url' in target && target.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect('headers' in target && target.headers.Authorization).toBe('Bearer env-key')
    delete process.env.OPENROUTER_API_KEY
    const bare = llmTarget({ provider: 'openrouter', apiKey: undefined, title: 't' })
    expect('error' in bare && bare.error).toMatch(/API key missing/)
  })
})
