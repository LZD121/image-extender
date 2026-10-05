import path from 'node:path'
import { ASSET_KINDS, type AssetKind } from '@/app/lib/libraryTypes'

/**
 * Path validation for the asset library. Pure — no fs — so the security
 * boundary can be tested exhaustively without touching a disk.
 *
 * Threat model (spec §9) is "self-inflicted mistakes": the prefix assertion
 * stops `..` and absolute paths. It deliberately does NOT resolve symlinks;
 * a symlinked directory inside the library is out of scope for a local,
 * single-user tool.
 */

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
// A file must carry an extension and may not nest: `raw|derived` + one segment.
const FILE_RE = /^(raw|derived)\/[a-z0-9][a-z0-9._-]{0,118}\.[a-z0-9]{1,8}$/

export function isValidName(name: unknown): name is string {
  return typeof name === 'string' && NAME_RE.test(name)
}

export function isValidKind(kind: unknown): kind is AssetKind {
  return typeof kind === 'string' && (ASSET_KINDS as readonly string[]).includes(kind)
}

export function isValidRelPath(rel: unknown): rel is string {
  return typeof rel === 'string' && FILE_RE.test(rel)
}

/** Throws unless `candidate` resolves strictly inside `root`. */
export function assertInsideRoot(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(candidate)
  if (resolved !== resolvedRoot && resolved.startsWith(resolvedRoot + path.sep)) return
  throw new Error(`path resolves outside the asset library root: ${candidate}`)
}

export function resolveAssetDir(root: string, project: string, kind: string, slug: string): string {
  if (!isValidName(project)) throw new Error(`invalid project name: ${project}`)
  if (!isValidKind(kind)) throw new Error(`invalid kind: ${kind}`)
  if (!isValidName(slug)) throw new Error(`invalid slug: ${slug}`)
  const dir = path.join(root, project, kind, slug)
  assertInsideRoot(root, dir)
  return dir
}

export function resolveAssetFile(
  root: string,
  project: string,
  kind: string,
  slug: string,
  rel: string
): string {
  if (!isValidRelPath(rel)) throw new Error(`invalid asset file path: ${rel}`)
  const file = path.join(resolveAssetDir(root, project, kind, slug), rel)
  assertInsideRoot(root, file)
  return file
}
