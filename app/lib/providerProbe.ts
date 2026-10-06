// app/lib/providerProbe.ts
'use client'

/**
 * Client half of the gateway probe: ask the server's `/api/providers` what a
 * gateway offers. The payload crosses a network boundary, so every field is
 * narrowed where it is read — the shape is never asserted.
 */

import {
  PROVIDERS,
  PROVIDER_IDS,
  type GatewayModel,
  type ProviderId,
  type ProviderStatus,
} from '@/app/lib/providers'

export type ProbeResult = {
  ok: boolean
  error: string | null
  baseUrl: string
  models: GatewayModel[]
  imageModelCount: number
}

/** How long a cached model list may be shown before we go and ask again. */
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_KEY = 'extender:providerModels'

/**
 * The last model list we actually got from this gateway, keyed per gateway.
 * Discovery is a real round trip, so the picker is populated from here
 * instantly on open and the probe runs behind it — a cache, never an
 * assumption, and nothing is offered that a gateway did not report.
 */
export function readCachedModels(provider: ProviderId): { models: GatewayModel[]; fresh: boolean } | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY}:${provider}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!('at' in parsed) || typeof parsed.at !== 'number') return null
    const models = readModels('models' in parsed ? parsed.models : undefined)
    if (models.length === 0) return null
    return { models, fresh: Date.now() - parsed.at < CACHE_TTL_MS }
  } catch {
    return null
  }
}

export function writeCachedModels(provider: ProviderId, models: GatewayModel[]): void {
  if (models.length === 0) return
  try {
    localStorage.setItem(`${CACHE_KEY}:${provider}`, JSON.stringify({ at: Date.now(), models }))
  } catch {
    /* storage unavailable — the cache is an optimisation, not a requirement */
  }
}

function readModels(raw: unknown): GatewayModel[] {
  if (!Array.isArray(raw)) return []
  const models: GatewayModel[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    if (!('id' in entry) || typeof entry.id !== 'string') continue
    models.push({
      id: entry.id,
      vendor: 'vendor' in entry && typeof entry.vendor === 'string' ? entry.vendor : '',
      imageCapable: 'imageCapable' in entry && entry.imageCapable === true,
    })
  }
  return models
}

export async function probeProvider(provider: ProviderId, apiKey: string): Promise<ProbeResult> {
  const base = PROVIDERS[provider].baseUrl
  const failed = (error: string): ProbeResult => ({ ok: false, error, baseUrl: base, models: [], imageModelCount: 0 })

  let payload: unknown = null
  try {
    const response = await fetch('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey: apiKey || undefined }),
    })
    payload = await response.json().catch(() => null)
    if (!payload || typeof payload !== 'object') return failed(`HTTP ${response.status}`)
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'probe failed')
  }

  const models = readModels('models' in payload ? payload.models : undefined)
  return {
    ok: 'ok' in payload && payload.ok === true,
    error: 'error' in payload && typeof payload.error === 'string' ? payload.error : null,
    baseUrl: 'baseUrl' in payload && typeof payload.baseUrl === 'string' ? payload.baseUrl : base,
    models,
    imageModelCount: models.filter((m) => m.imageCapable).length,
  }
}

/** The server-resolved table: magpie's base URL is deployment config, not client state. */
export async function fetchProviderTable(): Promise<ProviderStatus[]> {
  const fallback: ProviderStatus[] = PROVIDER_IDS.map((id) => ({ ...PROVIDERS[id], hasEnvKey: false }))

  let payload: unknown = null
  try {
    payload = await (await fetch('/api/providers')).json()
  } catch {
    return fallback
  }
  if (!payload || typeof payload !== 'object' || !('providers' in payload)) return fallback
  const entries: unknown[] = Array.isArray(payload.providers) ? payload.providers : []

  return fallback.map((provider) => {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || !('id' in entry) || entry.id !== provider.id) continue
      return {
        ...provider,
        baseUrl: 'baseUrl' in entry && typeof entry.baseUrl === 'string' ? entry.baseUrl : provider.baseUrl,
        keyRequired: 'keyRequired' in entry && entry.keyRequired === true,
        hasEnvKey: 'hasEnvKey' in entry && entry.hasEnvKey === true,
      }
    }
    return provider
  })
}
