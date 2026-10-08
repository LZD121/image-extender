import { type AssetKind, type AssetMeta, type BackendLabel, BACKEND_LABELS, isBackendLabel, type Provenance, type ReportedCost } from '@/app/lib/libraryTypes'
import type { SetJson } from '@/app/lib/animSet'
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

/**
 * What the studio knows about the run that produced an asset, and the collector
 * must not guess: which gateway painted it, what canvas was asked for, and what
 * the provider reported spending. Required on every input — the label used to
 * default to `openrouter` inside the collector, which is how an APIMart save
 * came to record the wrong producer.
 */
export type StudioFacts = {
  backend: BackendLabel
  /** Requested canvas, e.g. "2048x1024". */
  requested?: string | null
  cost?: ReportedCost | null
}

export type CollectedAsset = {
  kind: AssetKind
  files: Record<string, string>
  manifest: Record<string, unknown> | null
  /** `backend` is the real producer; `toolVersion` is still stamped by the panel. */
  provenance: Omit<Provenance, 'toolVersion'> & { backend: BackendLabel }
}

/** What one studio hands over; the facts above travel with every variant. */
type StudioPayload =
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

export type CollectorInput = StudioFacts & StudioPayload

export function slugify(input: string): string {
  const slug = (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
  return slug || 'asset'
}

/**
 * The provenance shape, authored once. The browser collector, the pixel studio
 * and the headless CLI all describe one asset the same way — they differ only
 * in the facts they have (a backend id, a cost, a returned size). Every field
 * is written, so a reader never has to tell "absent" from "null".
 */
export function buildProvenance<Backend extends BackendLabel>(opts: {
  backend: Backend
  model: string
  prompt?: string | null
  sceneBrief?: string | null
  artStyle?: string | null
  params?: Record<string, unknown>
  requested?: string | null
  returned?: string | null
  cost?: ReportedCost | null
}): Omit<Provenance, 'toolVersion'> & { backend: Backend } {
  // LIB-03: a cost is recorded only when the vendor reported one, and when it
  // did, the vendor it names must be the vendor that painted the asset. `source`
  // is a free string (D-52), so this compares strings rather than tightening the
  // type — that belongs to the second adapter, not here.
  if (opts.cost != null && opts.cost.source !== opts.backend) {
    throw new Error(`cost.source (${opts.cost.source}) must match backend (${opts.backend})`)
  }
  return {
    backend: opts.backend,
    model: opts.model,
    prompt: opts.prompt ?? null,
    sceneBrief: opts.sceneBrief ?? null,
    artStyle: opts.artStyle ?? null,
    params: opts.params ?? {},
    requested: opts.requested ?? null,
    returned: opts.returned ?? null,
    cost: opts.cost ?? null,
  }
}

/** The collector's skeleton: everything a browser studio does not know yet. */
const base = (input: StudioFacts, prompt: string | null, model: string): CollectedAsset['provenance'] =>
  buildProvenance({
    backend: input.backend,
    model,
    prompt,
    requested: input.requested,
    cost: input.cost,
  })

export function collectStudioAsset(input: CollectorInput): CollectedAsset | null {
  const p = base(input, input.prompt, input.model)

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
  opts: { project: string; slug: string; now?: string; toolVersion?: string }
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
    // The route re-stamps `backend` from the allow-list; `toolVersion` is ours —
    // the browser panel writes 'web', the headless CLI writes 'ie@<version>'.
    provenance: { ...collected.provenance, toolVersion: opts.toolVersion ?? 'web' },
  }
}

/**
 * Assemble an animation set's payload from the run's own artefacts — a sibling
 * of `collectStudioAsset` rather than another `mode` on it, because the input
 * genuinely differs: a `set.json` is read off disk after a CLI run, not handed
 * over by a browser studio's state (D-49).
 *
 * Pure on purpose. `app/lib/**` is bundled into the browser as well as the CLI
 * (this module is imported by `app/page.tsx` and `LibraryPanel.tsx`), and
 * `library.ts` is the only module here allowed to touch `node:fs` — so the
 * caller does the reading and the encoding, and this function only decides the
 * shape.
 *
 * `raw/` cannot appear by construction: the payload is the derived frames plus
 * the ledger (D-42). The byte arithmetic that keeps that structural lives in the
 * payload guard, not here.
 */
export function collectSetAsset(args: {
  /** The parsed `set.json` — the run's ledger, and the only provenance source. */
  setJson: SetJson
  /** The same bytes, already encoded; the ledger is a derived artefact too (D-50). */
  setJsonDataUrl: string
  /** The run's `derived/*.png`, already encoded, with their bare file names. */
  derived: { name: string; dataUrl: string }[]
  project: string
  slug: string
}): { meta: AssetMeta; files: Record<string, string> } {
  const { setJson } = args
  // A backend the allow-list does not know must stop the save rather than ride
  // into `meta.json` unchecked — that is the class of lie LIB-03 exists to end.
  const provider = setJson.backend.provider
  if (!isBackendLabel(provider)) {
    throw new Error(
      `set.json names backend "${provider}", which is not one of ${BACKEND_LABELS.join('|')}`
    )
  }

  // LIB-06 / D-47: the params recorded must agree with the ledger they came from.
  // `buildSetJson` counts only `ok:true` strips (animSet.ts:345-387), so `totals`
  // is the honest source; a mismatch means one of the two is wrong, and a pretty
  // number is worse than a refusal. The empty set needs no special case — with no
  // ok strips the three checks below already force every total to zero.
  const okStrips = setJson.strips.filter((strip) => strip.ok)
  if (setJson.totals.calls !== okStrips.length) {
    throw new Error(
      `set.json totals.calls (${setJson.totals.calls}) must equal its ok strips (${okStrips.length})`
    )
  }
  const expectedCells = okStrips.length * setJson.dirs.order.length
  if (setJson.totals.cells !== expectedCells) {
    throw new Error(
      `set.json totals.cells (${setJson.totals.cells}) must equal ok strips × directions (${expectedCells})`
    )
  }
  const expectedSeconds = okStrips.reduce((sum, strip) => sum + strip.seconds, 0)
  if (Math.abs(setJson.totals.seconds - expectedSeconds) > 0.001) {
    throw new Error(
      `set.json totals.seconds (${setJson.totals.seconds}) must equal the ok strips' seconds (${expectedSeconds})`
    )
  }

  const files: Record<string, string> = {}
  for (const frame of args.derived) files[`derived/${frame.name}`] = frame.dataUrl
  files['derived/set.json'] = args.setJsonDataUrl

  // The spec block only. The frame list already lives in `set.json`; a second
  // copy here would be a second truth that drifts (D-46 / LIB-05).
  const manifest = {
    type: setJson.kind,
    actor: setJson.actor,
    dirs: setJson.dirs,
    cell: setJson.cell,
    // `SetJson.states` has no `motion` (animSet.ts:323) — copy the shape it has.
    states: setJson.states.map((s) => ({
      name: s.name,
      frames: s.frames,
      fps: s.fps,
      durationsMs: s.durationsMs,
      loop: s.loop,
    })),
  }

  const provenance = buildProvenance({
    backend: provider,
    model: setJson.backend.model,
    // The gateway has not reported a cost for these calls; `null` is the honest
    // value, not a zero (D-45).
    cost: null,
    params: {
      dirs: setJson.dirs.order.length,
      states: setJson.states.length,
      frames: setJson.states.reduce((sum, s) => sum + s.frames, 0),
      cell: setJson.cell,
      calls: setJson.totals.calls,
      cells: setJson.totals.cells,
      seconds: setJson.totals.seconds,
    },
  })

  const meta = buildAssetMeta(
    { kind: 'animations', files, manifest, provenance },
    { project: args.project, slug: args.slug }
  )
  return { meta, files }
}
