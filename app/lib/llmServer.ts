// app/lib/llmServer.ts
/**
 * Server-side resolution of "which endpoint, with which credentials".
 *
 * Every route that talks to a model provider goes through `llmTarget`, so the
 * base URL lives in exactly one place and a request body can never make the
 * server fetch an arbitrary URL.
 *
 * Two ways in: the browser sends `provider` + `apiKey` (BYOK, unchanged), the
 * headless CLI sends a `profile` id that names an entry in the config file
 * (`app/lib/ieConfig.ts`). A named provider always wins, so every existing
 * client keeps its exact behavior.
 */

import {
  DEFAULT_PROVIDER,
  MAGPIE_DEFAULT_BASE_URL,
  PROVIDERS,
  isProviderId,
  type Provider,
} from '@/app/lib/providers'
import {
  effectiveProvider,
  loadIeConfig,
  profileKey,
  resolveProfile,
  type IeProfile,
} from '@/app/lib/ieConfig'

/** The provider as the server sees it: deployment env may move magpie's URL. */
export function serverProvider(raw: unknown): Provider {
  const id = isProviderId(raw) ? raw : DEFAULT_PROVIDER
  if (id !== 'magpie') return PROVIDERS[id]
  const baseUrl = (process.env.IE_MAGPIE_BASE_URL || MAGPIE_DEFAULT_BASE_URL).replace(/\/+$/, '')
  return { ...PROVIDERS.magpie, baseUrl }
}

/** The browser's key wins; the env var is the self-hosted fallback. */
export function providerKey(provider: Provider, bodyKey: unknown): string {
  if (typeof bodyKey === 'string' && bodyKey.trim()) return bodyKey.trim()
  return (process.env[provider.keyEnv] || '').trim()
}

export type LlmTarget = {
  provider: Provider
  url: string
  headers: Record<string, string>
}

/** What the request named, once resolved: a provider plus its profile (if any). */
type RequestProvider = { provider: Provider; profile: IeProfile | null } | { error: string }

/**
 * Which gateway this request means. `provider` (the browser's field) wins, then
 * `profile` (the CLI's config id), then the config's `defaultProfile`, then the
 * deployment default — so an agent that names nothing still gets the operator's
 * configured gateway, and a browser request is never rerouted by config.
 */
function requestProvider(opts: { provider: unknown; profile?: unknown }): RequestProvider {
  if (isProviderId(opts.provider)) return { provider: serverProvider(opts.provider), profile: null }

  const config = loadIeConfig()
  const id =
    typeof opts.profile === 'string' && opts.profile.trim() ? opts.profile.trim() : config.defaultProfile
  if (!id) return { provider: serverProvider(opts.provider), profile: null }

  const profile = resolveProfile(config, id)
  if (!profile) {
    return { error: `unknown profile "${id}". Define it with \`ie config\`, or drop the profile from the request.` }
  }
  return { provider: effectiveProvider(profile), profile }
}

/**
 * Which gateway and credential a request means, whichever surface it reaches:
 * the chat path (`llmTarget`) and the APIMart task adapter both start here, so
 * a config profile works for either. The `{ error }` branch is a credential (or
 * unknown-profile) problem the caller surfaces as 401, not a fetch failure.
 */
export function llmCredentials(opts: {
  provider: unknown
  apiKey: unknown
  profile?: unknown
}): { provider: Provider; key: string } | { error: string } {
  const resolved = requestProvider(opts)
  if ('error' in resolved) return { error: resolved.error }
  const { provider, profile } = resolved

  // Body key → profile credential (env var, then inline) → provider env var.
  const bodyKey = typeof opts.apiKey === 'string' ? opts.apiKey.trim() : ''
  const key = bodyKey || (profile ? profileKey(profile) : '') || (process.env[provider.keyEnv] || '').trim()

  if (!key && provider.keyRequired) {
    return { error: `${provider.label} API key missing. Add one in Settings.` }
  }
  return { provider, key }
}

/** Where a chat/completions call goes and what it carries. */
export function llmTarget(opts: {
  provider: unknown
  apiKey: unknown
  profile?: unknown
  title: string
  referer?: string | null
}): LlmTarget | { error: string } {
  const credentials = llmCredentials(opts)
  if ('error' in credentials) return { error: credentials.error }
  const { provider, key } = credentials

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  if (provider.id === 'openrouter') {
    // OpenRouter attributes traffic from these; other gateways ignore them.
    headers['HTTP-Referer'] = opts.referer || 'http://localhost:3000'
    headers['X-Title'] = opts.title
  }

  return { provider, url: `${provider.baseUrl}/chat/completions`, headers }
}

/**
 * The image/QA model a route should call: the request wins, then the resolved
 * profile's model for that kind, then the route's own default. Uses the same
 * profile resolution as `llmTarget`, so the model and the endpoint can never
 * come from two different profiles.
 */
export function modelOrDefault(opts: {
  model: unknown
  provider: unknown
  profile?: unknown
  kind: 'image' | 'qa'
  routeDefault: string
}): string {
  if (typeof opts.model === 'string' && opts.model.trim()) return opts.model.trim()
  const resolved = requestProvider(opts)
  if (!('error' in resolved) && resolved.profile) {
    const fromProfile = opts.kind === 'image' ? resolved.profile.imageModel : resolved.profile.qaModel
    if (fromProfile && fromProfile.trim()) return fromProfile.trim()
  }
  return opts.routeDefault
}
