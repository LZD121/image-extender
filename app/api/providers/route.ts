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
import { llmCredentials, serverProvider } from '@/app/lib/llmServer'

export async function GET() {
  return NextResponse.json({
    defaultProvider: DEFAULT_PROVIDER,
    providers: PROVIDER_IDS.map((id) => {
      const provider = serverProvider(id)
      // GET never fails on a missing key: `hasEnvKey` is the whole point of the
      // field. The same ladder as POST, read for "did the server supply one?".
      const credentials = llmCredentials({ provider: id, apiKey: null })
      return {
        ...provider,
        hasEnvKey: 'key' in credentials && !!credentials.key,
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
  // The same key ladder every other route runs (body → profile → provider env).
  // The resolved provider id is named here, so a config profile can never
  // reroute a browser request.
  const credentials = llmCredentials({
    provider: provider.id,
    apiKey: 'apiKey' in raw ? raw.apiKey : undefined,
  })

  if ('error' in credentials) {
    return NextResponse.json(
      { ok: false, provider: provider.id, baseUrl: provider.baseUrl, error: credentials.error },
      { status: 401 },
    )
  }

  const probe = await probeGatewayModels({ providerId: provider.id, baseUrl: provider.baseUrl, key: credentials.key })
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
