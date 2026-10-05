/**
 * Types for the on-disk asset library. The server, the route handler, the
 * browser client and the UI all import from here so a field rename can never
 * drift between them.
 */

export const ASSET_KINDS = ['tiles', 'sprites', 'props', 'parallax', 'extend'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export type Provenance = {
  /** Which provider the dev server proxied to. Stamped server-side. */
  backend: string
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
  cost: { usd: number; source: string } | null
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

/** localStorage key for the library project name. Shared by every studio. */
export const LIBRARY_PROJECT_STORAGE = 'extender:libraryProject'
