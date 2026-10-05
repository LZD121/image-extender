import type { AssetKind, Provenance } from '@/app/lib/libraryTypes'
import { TILESET_BY_ROLE, type TileSetRole } from '@/app/lib/tileset'

/**
 * Pure translation from studio state to an asset payload. Kept out of
 * app/page.tsx (a 4k-line component) so the mapping is unit-testable without
 * rendering React.
 *
 * Deliberately duplicates a few lines from the existing ZIP exporters rather
 * than refactoring them: the exporters' byte-for-byte output is a tested
 * invariant, and sharing a collector would put it at risk for no gain.
 */

export type CollectedAsset = {
  kind: AssetKind
  files: Record<string, string>
  manifest: Record<string, unknown> | null
  provenance: Omit<Provenance, 'backend' | 'toolVersion'>
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
  model,
  prompt,
  sceneBrief: null,
  artStyle: null,
  requested: null,
  returned: null,
  cost: null,
})

export function collectStudioAsset(
  mode: string,
  input: {
    prompt: string | null
    model: string
    tileSet?: { role: string; imageUrl: string | null }[]
    tileSheetDataUrl?: string | null
    propItems?: { id: string; name: string; imageUrl: string | null }[]
    propFiles?: string[]
    propAtlasDataUrl?: string | null
    frames?: { imageUrl: string | null }[]
    imageUrl?: string | null
    dimensions?: { width: number; height: number } | null
    manifest: Record<string, unknown> | null
  }
): CollectedAsset | null {
  const p = base(input.prompt, input.model)

  if (mode === 'tile') {
    const files: Record<string, string> = {}
    for (const slot of input.tileSet ?? []) {
      if (!slot.imageUrl) continue
      const spec = TILESET_BY_ROLE[slot.role as TileSetRole]
      if (!spec) continue
      files[`derived/${spec.fileName}.png`] = slot.imageUrl
    }
    if (input.tileSheetDataUrl) files['raw/sheet.png'] = input.tileSheetDataUrl
    if (Object.keys(files).length === 0) return null
    return { kind: 'tiles', files, manifest: input.manifest, provenance: { ...p, params: { roles: Object.keys(files).length } } }
  }

  if (mode === 'props') {
    const files: Record<string, string> = {}
    const populated = (input.propItems ?? []).filter(
      (x): x is { id: string; name: string; imageUrl: string } => !!x.imageUrl
    )
    populated.forEach((item, i) => {
      const file = input.propFiles?.[i] ?? `${slugify(item.name)}.png`
      files[`derived/${file}`] = item.imageUrl
    })
    if (input.propAtlasDataUrl) files['raw/sheet.png'] = input.propAtlasDataUrl
    if (Object.keys(files).length === 0) return null
    return { kind: 'props', files, manifest: input.manifest, provenance: { ...p, params: { count: populated.length } } }
  }

  if (mode === 'sprite') {
    const files: Record<string, string> = {}
    let n = 0
    for (const f of input.frames ?? []) {
      if (!f.imageUrl) continue
      n += 1
      files[`derived/frame_${String(n).padStart(2, '0')}.png`] = f.imageUrl
    }
    if (n === 0) return null
    return { kind: 'sprites', files, manifest: input.manifest, provenance: { ...p, params: { frames: n } } }
  }

  // extender / parallax: a single finished image.
  if (input.imageUrl) {
    const d = input.dimensions
    return {
      kind: mode === 'parallax' ? 'parallax' : 'extend',
      files: { 'derived/image.png': input.imageUrl },
      manifest: input.manifest,
      provenance: {
        ...p,
        returned: d ? `${d.width}x${d.height}` : null,
        params: { mode },
      },
    }
  }

  return null
}
