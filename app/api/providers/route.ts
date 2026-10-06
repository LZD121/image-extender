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
import { DEFAULT_PROVIDER, PROVIDER_IDS } from '@/app/lib/providers'
import { probeGatewayModels } from '@/app/lib/gatewayProbe'
import { providerKey, serverProvider } from '@/app/lib/llmServer'

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

  const probe = await probeGatewayModels({ providerId: provider.id, baseUrl: provider.baseUrl, key })
  if (!probe.ok) {
    return NextResponse.json({
      ok: false,
      provider: provider.id,
      baseUrl: provider.baseUrl,
      ...(probe.status ? { status: probe.status } : {}),
      error: probe.error,
    })
  }
  return NextResponse.json({
    ok: true,
    provider: provider.id,
    baseUrl: provider.baseUrl,
    count: probe.models.length,
    imageModelCount: probe.models.filter((m) => m.imageCapable).length,
    models: probe.models,
  })
}
