// app/api/providers/route.ts
/**
 * Which gateways exist, and whether one is actually usable right now.
 *
 * GET  — the provider table with server-resolved base URLs. No network call.
 * POST — probe one provider's `/models`: reachability, credential and the list
 *        of models the gateway will admit to. The gateway is the only source of
 *        truth for its model ids; they are not written down in the app.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  DEFAULT_PROVIDER,
  PROVIDER_IDS,
  looksLikeImageModel,
  vendorOf,
  type GatewayModel,
} from '@/app/lib/providers'
import { providerKey, serverProvider } from '@/app/lib/llmServer'

/** A gateway that is slow to answer is not a gateway we wait on. */
const PROBE_TIMEOUT_MS = 15_000

/** One entry from a gateway's `/models` list, as it reports itself. */
type ReportedModel = { id: string; ownedBy: string | null }

function reportedModels(payload: unknown): ReportedModel[] {
  if (!payload || typeof payload !== 'object') return []
  const list = 'data' in payload && Array.isArray(payload.data)
    ? payload.data
    : 'models' in payload && Array.isArray(payload.models)
      ? payload.models
      : []
  const models: ReportedModel[] = []
  for (const entry of list) {
    if (typeof entry === 'string') {
      models.push({ id: entry, ownedBy: null })
      continue
    }
    if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string') continue
    models.push({
      id: entry.id,
      ownedBy: 'owned_by' in entry && typeof entry.owned_by === 'string' ? entry.owned_by : null,
    })
  }
  return models
}

export async function GET() {
  return NextResponse.json({
    defaultProvider: DEFAULT_PROVIDER,
    providers: PROVIDER_IDS.map((id) => {
      const provider = serverProvider(id)
      return {
        ...provider,
        hasEnvKey: !!providerKey(provider, null),
      }
    }),
  })
}

export async function POST(request: NextRequest) {
  const raw: unknown = await request.json().catch(() => null)
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const provider = serverProvider('provider' in raw ? raw.provider : undefined)
  const key = providerKey(provider, 'apiKey' in raw ? raw.apiKey : undefined)

  if (!key && provider.keyRequired) {
    return NextResponse.json(
      { ok: false, provider: provider.id, baseUrl: provider.baseUrl, error: `${provider.label} API key missing. Add one in Settings.` },
      { status: 401 },
    )
  }

  try {
    const response = await fetch(`${provider.baseUrl}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })

    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 400)
      return NextResponse.json({
        ok: false,
        provider: provider.id,
        baseUrl: provider.baseUrl,
        status: response.status,
        error: text.trim() || `HTTP ${response.status}`,
      })
    }

    const payload = await response.json().catch(() => null)
    // The supplier is whoever the gateway says owns the model: a routing-group
    // id like `group/auto-claude-opus-4-5` is really served by apimart, and
    // crediting it to the `group` prefix hides the actual supplier from the UI.
    const models: GatewayModel[] = reportedModels(payload)
      .map((m) => ({ id: m.id, vendor: m.ownedBy || vendorOf(m.id), imageCapable: looksLikeImageModel(m.id) }))
      .sort((a, b) => (a.imageCapable === b.imageCapable ? a.id.localeCompare(b.id) : a.imageCapable ? -1 : 1))

    return NextResponse.json({
      ok: true,
      provider: provider.id,
      baseUrl: provider.baseUrl,
      count: models.length,
      imageModelCount: models.filter((m) => m.imageCapable).length,
      models,
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'TimeoutError'
          ? `No answer within ${PROBE_TIMEOUT_MS / 1000}s from ${provider.baseUrl}.`
          : error.message
        : 'probe failed'
    return NextResponse.json({
      ok: false,
      provider: provider.id,
      baseUrl: provider.baseUrl,
      error: message,
    })
  }
}
