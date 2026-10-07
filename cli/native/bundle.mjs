/**
 * esbuild bundling of the app's own modules — the CLI's only build step.
 *
 * Two shapes:
 *   browserBundle() — `app/utils/*` + `app/lib/tileset` as one IIFE for the
 *     headless-Chromium post-processing engine (window.IE). This is how the
 *     DOM-bound pixel code is reused instead of reimplemented.
 *   nodeBundle() — a named set of app modules as an ESM file Node imports
 *     directly (library/, pixelGrid, models), for work that never touches a DOM.
 *
 * Both invalidate on source mtime and land in `.ie/cache/`.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { CACHE_DIR, REPO_ROOT, requireFromRepo } from './deps.mjs'

/** What the in-page program may call. Anything else is not bundled. */
const BROWSER_IMPORTS = ['app/utils/imageProcessor', 'app/utils/poseRig', 'app/utils/tileFinish', 'app/lib/tileset', 'app/lib/chromaPresets', 'app/lib/animStrip', 'app/lib/animFrames']

/** Bundled modules pull from both source dirs; either changing invalidates. */
const SOURCE_DIRS = ['app/utils', 'app/lib'].map((p) => path.join(REPO_ROOT, p))

function newestMtime(dir) {
  if (!existsSync(dir)) return 0
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs)
  }
  return newest
}

function fresh(bundle, sources) {
  return existsSync(bundle) && statSync(bundle).mtimeMs >= Math.max(...sources.map(newestMtime))
}

function build(entryImports, outfile, extra) {
  const esbuild = requireFromRepo('esbuild')
  const contents = entryImports.map((m) => `export * from ${JSON.stringify('@/' + m)}`).join('\n') + '\n'
  esbuild.buildSync({
    stdin: { contents, resolveDir: REPO_ROOT, sourcefile: 'ie-entry.ts', loader: 'ts' },
    bundle: true,
    outfile,
    logLevel: 'warning',
    tsconfig: path.join(REPO_ROOT, 'tsconfig.json'),
    ...extra,
  })
  return outfile
}

/** The IIFE bundle the headless browser loads; exports everything as `window.IE`. */
export function browserBundle({ force = false } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true })
  const outfile = path.join(CACHE_DIR, 'ie-browser.js')
  if (!force && fresh(outfile, SOURCE_DIRS)) return outfile
  return build(BROWSER_IMPORTS, outfile, { format: 'iife', globalName: 'IE', platform: 'browser' })
}

/**
 * An ESM bundle of app modules for Node. `name` keys the cache file, so
 * different commands never overwrite each other's build.
 */
export function nodeBundle(name, entryImports, { force = false } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true })
  const outfile = path.join(CACHE_DIR, `node-${name}.mjs`)
  if (!force && fresh(outfile, SOURCE_DIRS)) return outfile
  return build(entryImports, outfile, { format: 'esm', platform: 'node' })
}
