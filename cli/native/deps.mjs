/**
 * Where the CLI's native dependencies live.
 *
 * Everything resolves from the checkout, never from the caller's cwd: `ie` may
 * be invoked from anywhere (an npm bin shim, an agent's shell), and the bundle
 * cache / server state must land inside this repo's `.ie/` so it is one
 * directory to delete.
 */
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The checkout root: cli/native/ → repo. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Runtime state + bundle cache; the only place the CLI writes inside the repo. */
export const IE_DIR = path.join(REPO_ROOT, '.ie')
export const CACHE_DIR = path.join(IE_DIR, 'cache')

/** Resolve a package from THIS repo's node_modules, not the caller's cwd. */
export const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'))

export const CHROMIUM_INSTALL_HINT = 'npx playwright install chromium-headless-shell'

/**
 * The browser the post-processing engine runs in. `$IE_CHROMIUM` always wins;
 * otherwise reuse whatever the machine's ms-playwright cache already has (no
 * forced download, no second copy of Chromium).
 */
export function findChromium() {
  if (process.env.IE_CHROMIUM) return process.env.IE_CHROMIUM
  const roots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), // macOS
    path.join(os.homedir(), '.cache', 'ms-playwright'), // Linux
  ]
  const patterns = [/^chromium_headless_shell-(\d+)$/, /^chromium-(\d+)$/]
  const found = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      let rev = 0
      for (const p of patterns) {
        const m = name.match(p)
        if (m) rev = parseInt(m[1], 10)
      }
      if (!rev) continue
      const candidates = [
        path.join(root, name, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(root, name, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
        path.join(root, name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(root, name, 'chrome-linux', 'chrome-headless-shell'),
        path.join(root, name, 'chrome-linux', 'chrome'),
      ]
      for (const p of candidates) {
        if (existsSync(p)) found.push({ rev, p })
      }
    }
  }
  found.sort((a, b) => b.rev - a.rev)
  return found.length ? found[0].p : null
}
