/**
 * Types for the on-disk asset library. The server, the route handler, the
 * browser client and the UI all import from here so a field rename can never
 * drift between them.
 */
import { PROVIDER_IDS, type ProviderId } from '@/app/lib/providers'

export const ASSET_KINDS = ['tiles', 'sprites', 'props', 'parallax', 'extend'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]


/**
 * What a gateway said a call cost. One name for the shape, because it travels
 * from a vendor response through the adapters into the recorded provenance, and
 * every copy of it was a chance to drift.
 */
export type ReportedCost = { usd: number; source: string }

/**
 * Who produced an asset: one of the gateways, or the pixel vendor that is not
 * a gateway. Derived from the provider table rather than written out, because
 * the hand-kept list this replaces was two ids behind it — an APIMart or
 * magpie generation was being stamped `openrouter`.
 */
export const BACKEND_LABELS: readonly (ProviderId | 'pixellab')[] = [...PROVIDER_IDS, 'pixellab']
export type BackendLabel = (typeof BACKEND_LABELS)[number]

export function isBackendLabel(value: unknown): value is BackendLabel {
  return typeof value === 'string' && (BACKEND_LABELS as readonly string[]).includes(value)
}

export type Provenance = {
  /** Which provider the dev server proxied to. Stamped server-side. */
  backend: BackendLabel
  /** Model id as chosen in the UI (app/lib/models.ts). */
  model: string
  prompt: string | null
  sceneBrief: string | null
  artStyle: string | null
  /** Exact request params that produced the asset. */
  params: Record<string, unknown>
  /** Requested canvas, e.g. "4096x4096". */
  requested: string | null
  /** What actually came back — models do not always honour the request. */
  returned: string | null
  /** Provider-reported spend, when the provider reports it. */
  cost: ReportedCost | null
  toolVersion: string
}

export type AssetMeta = {
  schemaVersion: 1
  type: string
  project: string
  kind: AssetKind
  slug: string
  createdAt: string
  updatedAt: string
  /** Verbatim output of the existing manifest builders (buildPropManifest(), …). */
  manifest: Record<string, unknown> | null
  files: { sheet: string | null; derived: string[] }
  provenance: Provenance
}

export type LibraryAssetSummary = {
  slug: string
  type: string
  updatedAt: string
  derived: string[]
}

export type LibraryKindGroup = { name: AssetKind; assets: LibraryAssetSummary[] }
export type LibraryProjectGroup = { name: string; kinds: LibraryKindGroup[] }
export type LibraryIndex = { projects: LibraryProjectGroup[]; warnings: string[] }
