// app/lib/gatewayProbe.ts
/**
 * Probing a gateway's `/models` — reachability, credential, and the list it
 * admits to. One implementation because the dev-server route and the headless
 * CLI both need it, and the CLI cannot call the route when a profile names its
 * own baseUrl (the route resolves the server's env, not the profile's).
 */
import { looksLikeImageModel, vendorOf, type GatewayModel } from '@/app/lib/providers'

/** A gateway that is slow to answer is not a gateway we wait on. */
export const PROBE_TIMEOUT_MS = 15_000

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

export type GatewayProbeResult =
  | { ok: true; provider: string | null; baseUrl: string; models: GatewayModel[] }
  | { ok: false; provider: string | null; baseUrl: string; status?: number; error: string }

export async function probeGatewayModels(opts: {
  providerId: string | null
  baseUrl: string
  key: string
}): Promise<GatewayProbeResult> {
  const shape = { provider: opts.providerId, baseUrl: opts.baseUrl }
  try {
    const response = await fetch(`${opts.baseUrl}/models`, {
      headers: opts.key ? { Authorization: `Bearer ${opts.key}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })

    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 400)
      return { ...shape, ok: false, status: response.status, error: text.trim() || `HTTP ${response.status}` }
    }

    const payload = await response.json().catch(() => null)
    // The supplier is whoever the gateway says owns the model: a routing-group
    // id like `group/auto-claude-opus-4-5` is really served by apimart, and
    // crediting it to the `group` prefix hides the actual supplier from the UI.
    const models: GatewayModel[] = reportedModels(payload)
      .map((m) => ({ id: m.id, vendor: m.ownedBy || vendorOf(m.id), imageCapable: looksLikeImageModel(m.id) }))
      .sort((a, b) => (a.imageCapable === b.imageCapable ? a.id.localeCompare(b.id) : a.imageCapable ? -1 : 1))

    return { ...shape, ok: true, models }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'TimeoutError'
          ? `No answer within ${PROBE_TIMEOUT_MS / 1000}s from ${opts.baseUrl}.`
          : error.message
        : 'probe failed'
    return { ...shape, ok: false, error: message }
  }
}
