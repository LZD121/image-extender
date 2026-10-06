/**
 * Image and JSON helpers shared by commands: reading what came back from a
 * route, writing PNGs, and the manifest every studio command drops next to its
 * outputs. Kept boring on purpose — these are the only places the CLI touches
 * the filesystem.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { CliError } from './args.mjs'

const DATA_URL_RE = /^data:image\/(png|jpeg|webp|jpg);base64,/

export function isDataUrl(value) {
  return typeof value === 'string' && DATA_URL_RE.test(value)
}

export function writeDataUrl(dataUrl, outPath) {
  const m = DATA_URL_RE.exec(dataUrl)
  if (!m) throw new CliError('bad_payload', `not a base64 image data URL: ${String(dataUrl).slice(0, 60)}`)
  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  writeFileSync(outPath, Buffer.from(dataUrl.slice(m[0].length), 'base64'))
  return outPath
}

export function dataUrlFromFile(file) {
  const ext = path.extname(file).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,` + readFileSync(file).toString('base64')
}

/**
 * Any route-reported image as a data URL. Routes may hand back a remote URL
 * (the gateway's own link); the bridge and the inpainting routes expect the
 * bytes, so a remote link is downloaded once, here.
 */
export async function toDataUrl(value) {
  if (isDataUrl(value)) return value
  if (typeof value !== 'string' || !/^https?:\/\//.test(value)) {
    throw new CliError('bad_payload', `not an image: ${String(value).slice(0, 60)}`)
  }
  const res = await fetch(value)
  if (!res.ok) throw new CliError('download_failed', `GET ${value} → HTTP ${res.status}`)
  const mime = res.headers.get('content-type') || 'image/png'
  return `data:${mime};base64,` + Buffer.from(await res.arrayBuffer()).toString('base64')
}

export async function imageSize(file) {
  const meta = await sharp(file).metadata()
  return { width: meta.width, height: meta.height }
}

/**
 * The real pixel size of what a model returned — worth recording, because a
 * gateway may answer a 4096² request with a 1024² image (the app's own
 * provenance has `returned` for exactly this reason).
 */
export async function dataUrlSize(dataUrl) {
  const m = DATA_URL_RE.exec(dataUrl)
  if (!m) return null
  const meta = await sharp(Buffer.from(dataUrl.slice(m[0].length), 'base64')).metadata()
  return { width: meta.width, height: meta.height }
}

export function ensureFile(file, label = file) {
  try {
    if (!statSync(file).isFile()) throw new Error('not a file')
  } catch {
    throw new CliError('missing_file', `${label}: no such file`)
  }
  return file
}

export function writeManifest(outPath, manifest) {
  const file = path.join(outPath, 'manifest.json')
  mkdirSync(outPath, { recursive: true })
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
  return file
}

/**
 * The image a route returned, wherever it put it. Routes differ: `/api/generate`
 * answers `{imageUrl}` (data URL or a remote URL), `/api/pixel` relays the
 * vendor's body verbatim, `/api/extend` returns the whole canvas.
 */
export function findImagePayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  for (const key of ['imageUrl', 'url', 'image', 'png']) {
    const value = payload[key]
    if (typeof value === 'string' && (isDataUrl(value) || /^https?:\/\//.test(value))) return value
  }
  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object') {
      const found = findImagePayload(value)
      if (found) return found
    }
  }
  return null
}

/** A remote URL is fetched, a data URL is decoded — both end up as one file. */
export async function saveImage(value, outPath) {
  if (isDataUrl(value)) return writeDataUrl(value, outPath)
  const res = await fetch(value)
  if (!res.ok) throw new CliError('download_failed', `GET ${value} → HTTP ${res.status}`)
  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()))
  return outPath
}
