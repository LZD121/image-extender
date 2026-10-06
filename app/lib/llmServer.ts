// app/lib/llmServer.ts
/**
 * Server-side resolution of "which endpoint, with which credentials".
 *
 * Every route that talks to a model provider goes through `llmTarget`, so the
 * base URL lives in exactly one place and a request body can never make the
 * server fetch an arbitrary URL.
 */

import {
  DEFAULT_PROVIDER,
  MAGPIE_DEFAULT_BASE_URL,
  PROVIDERS,
  isProviderId,
  type Provider,
} from '@/app/lib/providers'

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

/**
 * Where this call goes and what it carries. The `{ error }` branch is a
 * credential problem the caller should surface as 401, not a fetch failure.
 */
export function llmTarget(opts: {
  provider: unknown
  apiKey: unknown
  title: string
  referer?: string | null
}): LlmTarget | { error: string } {
  const provider = serverProvider(opts.provider)
  const key = providerKey(provider, opts.apiKey)

  if (!key && provider.keyRequired) {
    return { error: `${provider.label} API key missing. Add one in Settings.` }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  if (provider.id === 'openrouter') {
    // OpenRouter attributes traffic from these; other gateways ignore them.
    headers['HTTP-Referer'] = opts.referer || 'http://localhost:3000'
    headers['X-Title'] = opts.title
  }

  return { provider, url: `${provider.baseUrl}/chat/completions`, headers }
}
