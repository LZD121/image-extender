import type { AssetKind, AssetMeta, Provenance } from '@/app/lib/libraryTypes'
import { TILESET_BY_ROLE, type TileSetRole } from '@/app/lib/tileset'

/**
 * Pure translation from studio state to an asset payload. Kept out of
 * app/page.tsx (a 4k-line component) so the mapping is unit-testable without
 * rendering React.
 *
 * The input is a per-mode discriminated union: each mode carries exactly the
 * fields it needs, and props' `propFiles` is required (they are the exact names
 * the ZIP exporter writes). Adding a mode without handling it in the switch
 * fails to compile — the `never` assignment in `default` is the guard.
 *
 * Deliberately duplicates a few lines from the existing ZIP exporters rather
 * than refactoring them: the exporters' byte-for-byte output is a tested
 * invariant, and sharing a collector would put it at risk for no gain.
 */

/** Labels the library route will accept from a client. */
export const BACKEND_LABELS = ['openrouter', 'pixellab'] as const
export type BackendLabel = (typeof BACKEND_LABELS)[number]

export type CollectedAsset = {
  kind: AssetKind
  files: Record<string, string>
  manifest: Record<string, unknown> | null
  /** `backend` is the real producer; `toolVersion` is still stamped by the panel. */
  provenance: Omit<Provenance, 'toolVersion'> & { backend: BackendLabel }
}

export type CollectorInput =
  | {
      mode: 'tile'
      prompt: string | null
      model: string
      tileSet: { role: string; imageUrl: string | null }[]
      tileSheetDataUrl: string | null
      manifest: Record<string, unknown> | null
    }
  | {
      mode: 'props'
      prompt: string | null
      model: string
      propItems: { id: string; name: string; imageUrl: string | null }[]
      /** Required: these are the exact names the ZIP exporter uses. */
      propFiles: string[]
      propAtlasDataUrl: string | null
      manifest: Record<string, unknown> | null
    }
  | {
      mode: 'sprite'
      prompt: string | null
      model: string
      frames: { imageUrl: string | null }[]
      manifest: Record<string, unknown> | null
    }
  | {
      mode: 'extender' | 'parallax'
      prompt: string | null
      model: string
      imageUrl: string | null
      dimensions: { width: number; height: number } | null
      manifest: Record<string, unknown> | null
    }

export function slugify(input: string): string {
  const slug = (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
  return slug || 'asset'
}

const base = (prompt: string | null, model: string) => ({
  backend: 'openrouter' as BackendLabel,
  model,
  prompt,
  sceneBrief: null,
  artStyle: null,
  requested: null,
  returned: null,
  cost: null,
})

export function collectStudioAsset(input: CollectorInput): CollectedAsset | null {
  const p = base(input.prompt, input.model)

  switch (input.mode) {
    case 'tile': {
      const files: Record<string, string> = {}
      for (const slot of input.tileSet) {
        if (!slot.imageUrl) continue
        const spec = TILESET_BY_ROLE[slot.role as TileSetRole]
        if (!spec) continue
        files[`derived/${spec.fileName}.png`] = slot.imageUrl
      }
      if (input.tileSheetDataUrl) files['raw/sheet.png'] = input.tileSheetDataUrl
      if (Object.keys(files).length === 0) return null
      const derived = Object.keys(files).filter((f) => f.startsWith('derived/')).length
      return {
        kind: 'tiles',
        files,
        manifest: input.manifest,
        provenance: { ...p, params: { derived, sheet: 'raw/sheet.png' in files } },
      }
    }

    case 'props': {
      const files: Record<string, string> = {}
      const populated = input.propItems.filter(
        (x): x is { id: string; name: string; imageUrl: string } => !!x.imageUrl
      )
      if (input.propFiles.length !== populated.length) {
        throw new Error('collectStudioAsset(props): propFiles must match the populated prop count')
      }
      if (new Set(input.propFiles).size !== input.propFiles.length) {
        throw new Error('collectStudioAsset(props): propFiles contains duplicate file names')
      }
      populated.forEach((item, i) => {
        files[`derived/${input.propFiles[i]}`] = item.imageUrl
      })
      if (input.propAtlasDataUrl) files['raw/sheet.png'] = input.propAtlasDataUrl
      if (Object.keys(files).length === 0) return null
      return { kind: 'props', files, manifest: input.manifest, provenance: { ...p, params: { count: populated.length } } }
    }

    case 'sprite': {
      const files: Record<string, string> = {}
      let n = 0
      for (const f of input.frames) {
        if (!f.imageUrl) continue
        n += 1
        files[`derived/frame_${String(n).padStart(2, '0')}.png`] = f.imageUrl
      }
      if (n === 0) return null
      return { kind: 'sprites', files, manifest: input.manifest, provenance: { ...p, params: { frames: n } } }
    }

    case 'extender':
    case 'parallax': {
      if (!input.imageUrl) return null
      const d = input.dimensions
      return {
        kind: input.mode === 'parallax' ? 'parallax' : 'extend',
        files: { 'derived/image.png': input.imageUrl },
        manifest: input.manifest,
        provenance: {
          ...p,
          returned: d ? `${d.width}x${d.height}` : null,
          params: { mode: input.mode },
        },
      }
    }

    default: {
      // Exhaustiveness: adding a mode without handling it fails to compile.
      const never: never = input
      throw new Error(`unhandled collector mode: ${JSON.stringify(never)}`)
    }
  }
}

/**
 * Assemble the on-disk meta for one collected asset. Kept pure and out of the
 * panel so the payload the route validates is covered by tests, not by
 * eyeballing JSX.
 */
export function buildAssetMeta(
  collected: CollectedAsset,
  opts: { project: string; slug: string; now?: string }
): AssetMeta {
  const now = opts.now ?? new Date().toISOString()
  return {
    schemaVersion: 1,
    type:
      typeof collected.manifest?.type === 'string'
        ? collected.manifest.type
        : `${collected.kind}-set`,
    project: opts.project,
    kind: collected.kind,
    slug: opts.slug,
    createdAt: now,
    updatedAt: now,
    manifest: collected.manifest,
    files: {
      sheet: Object.keys(collected.files).find((f) => f.startsWith('raw/')) ?? null,
      derived: Object.keys(collected.files)
        .filter((f) => f.startsWith('derived/'))
        .sort(),
    },
    // The route re-stamps `backend` from the allow-list; `toolVersion` is ours.
    provenance: { ...collected.provenance, toolVersion: 'web' },
  }
}
