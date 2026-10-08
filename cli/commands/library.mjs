/**
 * The asset library — list, get, file, delete, save — driven by the app's own
 * `app/lib/library.ts`, bundled for Node. Nothing here goes over HTTP: the
 * library is filesystem state, and `library.ts` is its only owner, so a
 * CLI-written asset is byte-identical to one the panel saved (same
 * `libraryPath` validation, same temp-dir + atomic-rename write).
 *
 * One registry entry, subcommands as the first positional: `ie.mjs` resolves
 * exactly one key per module, so `ie library <sub> …` is how the five surfaces
 * share a namespace without a second dispatch layer.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CliError, UsageError, positional } from '../lib/args.mjs'
import { dataUrlFromFile, ensureFile } from '../lib/media.mjs'

const SUBCOMMANDS = ['list', 'get', 'file', 'delete', 'save']

/** One line per subcommand, shared by `ie help library` and `ie library help`. */
const SUBCOMMAND_LINES = [
  '  list                                        list every asset (project → kind → slug)',
  '  get <project> <kind> <slug>                 print one asset\'s meta.json',
  '  file <project> <kind> <slug> <relpath> --out <file>   copy one stored file out',
  '  delete <project> <kind> <slug>              remove an asset and its files',
  '  save <project> <kind> <slug> --sheet <raw.png> --derived <a.png,b.png> [--overwrite] [--type <t>] [--meta <json>]',
  '  save <project> animations <slug> --set-json <set.json> --derived-dir <dir/>   (no --sheet/--derived)',
]

const USAGE = 'ie library <list|get|file|delete|save> [args] [flags]  (save needs --backend <label>; --sheet --derived --type --meta; animations: --set-json --derived-dir, backend read from set.json)'

/**
 * Every app module the subcommands need, in one bundle. `libraryPath` is here
 * rather than used indirectly so a bad id names the field to fix, instead of
 * surfacing `library.ts`'s internal throw.
 */
const MODULES = [
  'app/lib/library',
  'app/lib/libraryPath',
  'app/lib/libraryCollect',
  'app/lib/libraryTypes',
]

/**
 * `buildAssetMeta` stamps `toolVersion: 'web'` (the panel is its only caller
 * today); an asset written by this CLI says so. Read once at import — a broken
 * read must not stop `ie help` from loading every command module.
 */
const IE_VERSION = (() => {
  try {
    return `ie@${JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version}`
  } catch {
    return 'ie'
  }
})()

/** The three ids every subcommand but `list` takes, checked with the app's own rules. */
function assetIds(ctx, lib) {
  const project = positional(ctx.args, 1, 'project', ctx.spec)
  const kind = positional(ctx.args, 2, 'kind', ctx.spec)
  const slug = positional(ctx.args, 3, 'slug', ctx.spec)
  for (const [label, value] of [
    ['project', project],
    ['slug', slug],
  ]) {
    if (!lib.isValidName(value)) {
      ctx.fail(
        'invalid_name',
        `invalid ${label} "${value}": expected lowercase a-z, 0-9 and dashes, first char alphanumeric, max 64 chars`
      )
    }
  }
  if (!lib.isValidKind(kind)) {
    ctx.fail('invalid_kind', `invalid kind "${kind}": expected one of ${lib.ASSET_KINDS.join('|')}`)
  }
  return { project, kind, slug }
}

/** A rel path is `raw|derived/<file>`; when it is not, say which file and what a valid one looks like. */
function checkRel(ctx, lib, rel) {
  if (!lib.isValidRelPath(rel)) {
    ctx.fail(
      'invalid_file_path',
      `invalid asset file path "${rel}": expected raw/ or derived/, then a lowercase a-z 0-9 . _ - name with an extension`
    )
  }
}

async function list(ctx, lib) {
  const index = await lib.listAssets()
  const root = lib.assetsRoot()
  const assets = index.projects.reduce((n, p) => n + p.kinds.reduce((m, k) => m + k.assets.length, 0), 0)
  const warn = index.warnings.length ? `, ${index.warnings.length} warning(s)` : ''
  return {
    summary: `${assets} asset(s) in ${root}${warn}`,
    root,
    projects: index.projects,
    warnings: index.warnings,
  }
}

async function get(ctx, lib) {
  const { project, kind, slug } = assetIds(ctx, lib)
  const meta = await lib.readMeta(project, kind, slug)
  return { summary: `${project}/${kind}/${slug}`, root: lib.assetsRoot(), meta }
}

async function file(ctx, lib) {
  const { project, kind, slug } = assetIds(ctx, lib)
  const rel = positional(ctx.args, 4, 'relpath', ctx.spec)
  checkRel(ctx, lib, rel)
  const out = ctx.flags.out
  if (!out) {
    ctx.fail('usage', 'missing --out <file>: ie library file <project> <kind> <slug> <relpath> --out <file>')
  }
  const bytes = await lib.readAssetFile(project, kind, slug, rel)
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  writeFileSync(out, bytes)
  return {
    summary: `${project}/${kind}/${slug}/${rel} → ${out}`,
    root: lib.assetsRoot(),
    written: [out],
    bytes: bytes.length,
  }
}

async function remove(ctx, lib) {
  const { project, kind, slug } = assetIds(ctx, lib)
  await lib.deleteAsset(project, kind, slug)
  return {
    summary: `deleted ${project}/${kind}/${slug}`,
    root: lib.assetsRoot(),
    deleted: `${project}/${kind}/${slug}`,
  }
}

async function save(ctx, lib) {
  const { project, kind, slug } = assetIds(ctx, lib)
  const derived = (ctx.flags.derived || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // An animation set arrives as a run directory, not as loose files (D-42): its
  // payload is `derived/*.png` plus the ledger, and `--sheet`/`--derived` do not
  // apply. Dispatch BEFORE the guard below, which would otherwise reject a save
  // that is legitimately file-less.
  if (kind === 'animations') return saveSet(ctx, lib, project, slug)

  if (!ctx.flags.sheet && !derived.length) {
    ctx.fail('usage', 'save needs at least one file: --sheet <raw.png> and/or --derived <a.png,b.png>')
  }

  const files = {}
  if (ctx.flags.sheet) {
    ensureFile(ctx.flags.sheet, '--sheet')
    files[`raw/${path.basename(ctx.flags.sheet)}`] = dataUrlFromFile(ctx.flags.sheet)
  }
  for (const input of derived) {
    ensureFile(input, '--derived')
    const rel = `derived/${path.basename(input)}`
    // Two inputs with one basename would collapse into a single stored file.
    if (files[rel]) ctx.fail('duplicate_file', `--derived lists ${rel} twice: pass each file once, or rename one`)
    files[rel] = dataUrlFromFile(input)
  }
  for (const rel of Object.keys(files)) checkRel(ctx, lib, rel)

  // LIB-04: there is no default producer. The flag used to fall back to
  // `openrouter`, which is how an APIMart asset came to be stamped with a
  // gateway that never painted it — the lie this phase exists to end. An
  // animation set never reaches this line: it is dispatched to `saveSet` above
  // and reads its backend off the ledger (D-43).
  if (!ctx.flags.backend) {
    ctx.fail('missing_flag', '--backend is required: name the gateway that painted this asset')
  }
  const backendLabel = ctx.flags.backend
  if (!lib.isBackendLabel(backendLabel)) {
    ctx.fail('bad_backend', `--backend must be one of ${lib.BACKEND_LABELS.join('|')}, got "${backendLabel}"`)
  }
  const meta = lib.buildAssetMeta(
    {
      kind,
      files,
      manifest: null,
      // The full Provenance shape minus toolVersion (stamped below), so
      // meta.json never has holes a reader would have to treat as absent-vs-null.
      provenance: await ctx.provenance({ backend: backendLabel, model: '' }),
    },
    { project, slug }
  )
  if (ctx.flags.type) meta.type = ctx.flags.type
  meta.provenance.toolVersion = IE_VERSION
  if (ctx.flags.meta) {
    let extra
    try {
      extra = JSON.parse(ctx.flags.meta)
    } catch (err) {
      ctx.fail('bad_json', `--meta is not valid JSON: ${err.message}`)
    }
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
      ctx.fail('bad_json', `--meta must be a JSON object, e.g. '{"manifest":{"type":"dungeon-set"}}'`)
    }
    // Identity comes from the arguments; --meta only carries what has no flag.
    Object.assign(meta, extra, { project, kind, slug, schemaVersion: 1 })
  }

  const written = await lib.saveAsset(project, kind, slug, meta, files, {
    overwrite: !!ctx.flags.overwrite,
  })
  const dir = lib.resolveAssetDir(lib.assetsRoot(), project, kind, slug)
  return {
    summary: `saved ${project}/${kind}/${slug} (${written.length} files) → ${dir}`,
    root: lib.assetsRoot(),
    path: `${project}/${kind}/${slug}`,
    written: written.map((rel) => path.join(dir, rel)),
    meta,
  }
}

/**
 * An animation set is a run directory, not loose files: the payload is the
 * derived frames plus the ledger, and the provenance is read off that ledger
 * (D-42/D-43) — a different input from `save`'s `--sheet`/`--derived`, so it gets
 * its own entry point rather than a flag on the existing one.
 *
 * The reading and the encoding live here, not in `collectSetAsset`: that module
 * sits in `app/lib`, which is bundled into the browser as well, and `node:fs`
 * stays out of it.
 */
async function saveSet(ctx, lib, project, slug) {
  if (!ctx.flags['set-json']) ctx.fail('missing_flag', '--set-json is required for the animations kind')
  if (!ctx.flags['derived-dir']) ctx.fail('missing_flag', '--derived-dir is required for the animations kind')
  const setJsonPath = path.resolve(ctx.flags['set-json'])
  const derivedDir = path.resolve(ctx.flags['derived-dir'])
  ensureFile(setJsonPath, '--set-json')

  let setJson
  try {
    setJson = JSON.parse(readFileSync(setJsonPath, 'utf8'))
  } catch (err) {
    ctx.fail('bad_json', `--set-json is not valid JSON: ${err.message}`)
  }

  let names
  try {
    names = readdirSync(derivedDir).filter((f) => f.endsWith('.png')).sort()
  } catch (err) {
    ctx.fail('bad_dir', `--derived-dir cannot be read: ${err.message}`)
  }
  if (!names.length) ctx.fail('bad_dir', `--derived-dir holds no .png: ${derivedDir}`)

  const { meta, files } = lib.collectSetAsset({
    setJson,
    setJsonDataUrl: dataUrlFromFile(setJsonPath),
    // The collector keys the ledger as `derived/set.json`, the only spelling the
    // route's path validator accepts (D-50).
    derived: names.map((name) => ({ name, dataUrl: dataUrlFromFile(path.join(derivedDir, name)) })),
    project,
    slug,
  })
  meta.provenance.toolVersion = IE_VERSION
  const written = await lib.saveAsset(project, 'animations', slug, meta, files, {
    overwrite: !!ctx.flags.overwrite,
  })
  const dir = lib.resolveAssetDir(lib.assetsRoot(), project, 'animations', slug)
  return {
    summary: `saved ${project}/animations/${slug} (${written.length} files) → ${dir}`,
    root: lib.assetsRoot(),
    path: `${project}/animations/${slug}`,
    written: written.map((rel) => path.join(dir, rel)),
    meta,
  }
}

const HANDLERS = { list, get, file, delete: remove, save }

const library = {
  summary: 'asset library — list/get/file/delete/save (no server needed)',
  usage: USAGE,
  options: {
    sheet: { type: 'string' },
    derived: { type: 'string' },
    meta: { type: 'string' },
    overwrite: { type: 'boolean' },
    type: { type: 'string' },
    backend: { type: 'string' },
    out: { type: 'string' },
    'set-json': { type: 'string' },
    'derived-dir': { type: 'string' },
    help: { type: 'boolean' },
  },
  async run(ctx) {
    const sub = ctx.args[0]
    if (ctx.flags.help || sub === 'help') {
      return {
        summary: [
          `ie library — ${library.summary}`,
          '',
          `usage: ${USAGE}`,
          '',
          'subcommands:',
          ...SUBCOMMAND_LINES,
        ].join('\n'),
      }
    }
    if (!sub || !HANDLERS[sub]) {
      throw new UsageError(`unknown library subcommand "${sub ?? ''}" (expected ${SUBCOMMANDS.join('|')})`, USAGE)
    }
    const lib = await ctx.modules('library', MODULES)
    try {
      return await HANDLERS[sub](ctx, lib)
    } catch (err) {
      // ctx.fail's CliError and UsageError already carry the right code/exit.
      if (err instanceof CliError || err instanceof UsageError) throw err
      // LibraryError is the app's typed pair; its message already names the asset.
      if (err && err.name === 'LibraryError') {
        const hint = err.code === 'EEXISTS' ? ' — pass --overwrite to replace it' : ''
        ctx.fail(err.code, `${err.message}${hint}`)
      }
      // A missing asset/file comes back as a bare ENOENT from the fs.
      if (err && err.code === 'ENOENT') {
        ctx.fail('ENOTFOUND', `${err.message} — \`ie library list\` shows what exists`)
      }
      ctx.fail((err && err.code) || 'library_error', (err && err.message) || String(err))
    }
  },
}

export default { library }
