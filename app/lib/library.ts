import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertInsideRoot,
  isValidName,
  isValidRelPath,
  resolveAssetDir,
  resolveAssetFile,
} from '@/app/lib/libraryPath'
import {
  ASSET_KINDS,
  type AssetKind,
  type AssetMeta,
  type LibraryIndex,
  type LibraryProjectGroup,
} from '@/app/lib/libraryTypes'

/**
 * The only module in the app that touches the filesystem. Everything else —
 * the route handler, the browser client, the UI — goes through these
 * functions, so the on-disk layout has exactly one owner.
 */

const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,/
// Leftovers from a crashed save/overwrite swap. Not assets — report, never list.
const ORPHAN_RE = /^[a-z0-9][a-z0-9-]*\.(old|tmp)-\d+-\d+$/

export function assetsRoot(): string {
  return path.resolve(process.env.IE_ASSETS_DIR || path.join(process.cwd(), 'assets'))
}

function decode(dataUrl: string): Buffer {
  const m = DATA_URL_RE.exec(dataUrl)
  if (!m) throw new Error('not a data URL (expected data:image/png|jpeg|webp;base64,…)')
  return Buffer.from(dataUrl.slice(m[0].length), 'base64')
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Write one asset. Files land in a sibling temp directory first and are then
 * atomically renamed into place, so a failure (bad payload, full disk) never
 * leaves a half-written asset behind.
 */
export async function saveAsset(
  project: string,
  kind: string,
  slug: string,
  meta: AssetMeta,
  files: Record<string, string>,
  opts: { overwrite?: boolean } = {}
): Promise<string[]> {
  const dir = resolveAssetDir(assetsRoot(), project, kind, slug)
  if ((await exists(dir)) && !opts.overwrite) {
    throw new Error(`asset already exists: ${project}/${kind}/${slug}`)
  }

  const entries = Object.entries(files)
  for (const [rel] of entries) {
    if (!isValidRelPath(rel)) throw new Error(`invalid asset file path: ${rel}`)
  }
  // Decode everything BEFORE touching the disk so a bad payload cannot leave
  // a stray temp directory behind.
  const decoded = entries.map(([rel, dataUrl]) => [rel, decode(dataUrl)] as const)

  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`
  try {
    await mkdir(tmp, { recursive: true })
    for (const [rel, buf] of decoded) {
      const target = path.join(tmp, rel)
      assertInsideRoot(assetsRoot(), target)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, buf)
    }
    await writeFile(path.join(tmp, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
    // Crash-safe overwrite: move the old asset aside, promote the new one, and
    // only then delete the old. A crash mid-swap leaves either the old or the
    // new asset on disk, never nothing.
    const backup = `${dir}.old-${process.pid}-${Date.now()}`
    let moved = false
    if (await exists(dir)) {
      await rename(dir, backup)
      moved = true
    }
    try {
      await rename(tmp, dir)
    } catch (err) {
      if (moved) await rename(backup, dir).catch(() => {})
      throw err
    }
    if (moved) await rm(backup, { recursive: true, force: true })
  } catch (err) {
    await rm(tmp, { recursive: true, force: true })
    throw err
  }
  return entries.map(([rel]) => rel)
}

export async function readMeta(project: string, kind: string, slug: string): Promise<AssetMeta> {
  const file = path.join(resolveAssetDir(assetsRoot(), project, kind, slug), 'meta.json')
  return JSON.parse(await readFile(file, 'utf8')) as AssetMeta
}

export async function readAssetFile(
  project: string,
  kind: string,
  slug: string,
  rel: string
): Promise<Buffer> {
  return readFile(resolveAssetFile(assetsRoot(), project, kind, slug, rel))
}

export async function deleteAsset(project: string, kind: string, slug: string): Promise<void> {
  const dir = resolveAssetDir(assetsRoot(), project, kind, slug)
  if (!(await exists(dir))) throw new Error(`asset not found: ${project}/${kind}/${slug}`)
  await rm(dir, { recursive: true, force: true })
}

/**
 * Walk `<root>/<project>/<kind>/<slug>/meta.json`. A meta.json that fails to
 * parse is reported in `warnings` and skipped — one bad file must not hide
 * the rest of the library.
 */
export async function listAssets(): Promise<LibraryIndex> {
  const root = assetsRoot()
  const warnings: string[] = []
  const projects: LibraryProjectGroup[] = []
  if (!(await exists(root))) return { projects, warnings }

  const projectDirs = (await readdir(root, { withFileTypes: true })).filter(
    (d) => d.isDirectory() && isValidName(d.name)
  )
  for (const project of projectDirs) {
    const kinds = []
    for (const kind of ASSET_KINDS) {
      const kindDir = path.join(root, project.name, kind)
      if (!(await exists(kindDir))) continue
      const assets = []
      const slugDirs = (await readdir(kindDir, { withFileTypes: true })).filter((d) =>
        d.isDirectory()
      )
      for (const slug of slugDirs) {
        if (ORPHAN_RE.test(slug.name)) {
          warnings.push(`orphaned write directory: ${project.name}/${kind}/${slug.name}`)
          continue
        }
        if (!isValidName(slug.name)) continue
        try {
          const parsed = JSON.parse(
            await readFile(path.join(kindDir, slug.name, 'meta.json'), 'utf8')
          ) as AssetMeta
          if (typeof parsed?.slug !== 'string' || typeof parsed?.type !== 'string') {
            throw new Error('meta.json is missing slug/type')
          }
          assets.push({
            slug: slug.name,
            type: parsed.type,
            updatedAt: parsed.updatedAt,
            derived: parsed.files?.derived ?? [],
          })
        } catch {
          warnings.push(`unreadable meta.json: ${project.name}/${kind}/${slug.name}`)
        }
      }
      if (assets.length) kinds.push({ name: kind as AssetKind, assets })
    }
    if (kinds.length) projects.push({ name: project.name, kinds })
  }
  return { projects, warnings }
}
