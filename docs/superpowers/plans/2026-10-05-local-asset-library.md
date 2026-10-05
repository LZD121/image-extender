# Local Asset Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 image-extender 增加一个磁盘资产库，让 studio 产物可持久化、可被 git 共享、可追溯 —— 刷新页面不再丢失。

**Architecture:** 单一 fs 所有者模块（`app/lib/library.ts`）+ 一个可选 catch-all 路由（`app/api/library/[[...path]]/route.ts`）+ 一个浏览器客户端（`app/lib/libraryClient.ts`）+ 一个面板组件。磁盘布局是 `$IE_ASSETS_DIR/<project>/<kind>/<slug>/{meta.json,raw/,derived/}`；`raw/` 不进 git，`derived/` 进。共享机制是 git，无服务端、无认证。

**Tech Stack:** Next.js 14 App Router（`runtime = 'nodejs'`）、TypeScript strict、`node:fs/promises`、Vitest（本仓库当前**没有任何测试框架**，Task 1 引入）、React 18。

**Spec:** `docs/superpowers/specs/2026-10-05-fork-design.md`（commit `20f4c00`，已批准）

---

## 关键约束（实现时不要违反）

1. **不得修改现有 4 个 ZIP 导出路径**（`app/page.tsx:1746` / `:2250` / `:3256` / `:3470` 及其调用）。导出输出必须逐字节不变；资产库只**旁挂**。
2. **只有 `app/lib/library.ts` 可以 `import 'node:fs'`**。UI、route、客户端都经它。
3. `libraryPath.ts` 必须是**纯函数**（无 fs），因为路径校验表是安全边界，必须能脱离文件系统测试。
4. 路径校验的威胁模型是"自己误操作"（spec §9）：`path.resolve` + 前缀校验，**不做** `realpath` 符号链接校验。
5. 所有 fs 测试必须写在 `os.tmpdir()` 下的临时目录，测试结束删除；**绝不**碰真实 `assets/`。

## 文件结构

**新建**

| 文件 | 职责 |
|---|---|
| `vitest.config.ts` | 测试运行器配置（`@/*` 别名） |
| `app/lib/libraryTypes.ts` | `AssetKind` / `AssetMeta` / `Provenance` / `LibraryIndex` 共享类型 |
| `app/lib/libraryPath.ts` | **纯函数**：slug/project/kind 校验、relpath 校验、路径解析与前缀断言 |
| `app/lib/library.ts` | fs 操作：`listAssets` / `readMeta` / `readAssetFile` / `saveAsset`（原子）/ `deleteAsset` |
| `app/api/library/[[...path]]/route.ts` | HTTP：GET 索引 / GET meta / GET `?file=` / POST / DELETE |
| `app/lib/libraryCollect.ts` | **纯函数**：把 studio 状态整理成 `{ kind, files, manifest }` |
| `app/lib/libraryClient.ts` | 浏览器侧 fetch 封装 |
| `app/components/LibraryPanel.tsx` | 资产面板 UI（列表 / 保存对话框 / 载入 / 删除） |
| `app/lib/__tests__/libraryPath.test.ts` | 路径校验表 |
| `app/lib/__tests__/library.test.ts` | fs 层（临时目录） |
| `app/lib/__tests__/libraryCollect.test.ts` | 收集器 |
| `app/api/library/__tests__/route.test.ts` | 路由 handler |
| `app/lib/__tests__/generateCost.test.ts` | cost 透传的 fixture 测试 |

**修改**

| 文件 | 改动 |
|---|---|
| `package.json` | 加 `vitest` devDependency + `"test": "vitest run"` |
| `app/page.tsx` | 挂载面板；加 `handleSaveToLibrary`；接入载入 |
| `app/api/generate/route.ts` | 响应里透传 `cost`（可空） |
| `.gitignore` | `assets/**/raw/` |
| `.gitattributes` | 新建：`*.png -diff` |
| `.env.example` | `IE_ASSETS_DIR` / `IE_BACKEND_LABEL` |
| `README.md` | 资产库说明 |

---

## Task 1: 测试运行器

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`
- Test: `app/lib/__tests__/smoke.test.ts`

- [ ] **Step 1: 安装 vitest**

```bash
cd /Users/zidong/repos/image-extender
npm install -D vitest@^2
```

- [ ] **Step 2: 加 test 脚本**

把 `package.json` 的 `scripts` 改成：

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: 写配置文件**

`vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json "paths": { "@/*": ["./*"] }
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['app/**/__tests__/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: 写一个冒烟测试证明别名可用**

`app/lib/__tests__/smoke.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { STORAGE_MODE } from '@/app/lib/app'

describe('test harness', () => {
  it('resolves the @ alias and imports app modules', () => {
    expect(STORAGE_MODE).toBe('extender:mode')
  })
})
```

- [ ] **Step 5: 运行**

Run: `npm test -- app/lib/__tests__/smoke.test.ts`
Expected: PASS，1 test passed

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json vitest.config.ts app/lib/__tests__/smoke.test.ts
git commit -m "test: add vitest harness"
```

---

## Task 2: 共享类型

**Files:**
- Create: `app/lib/libraryTypes.ts`

- [ ] **Step 1: 写类型**

```ts
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
```

- [ ] **Step 2: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无新错误

- [ ] **Step 3: 提交**

```bash
git add app/lib/libraryTypes.ts
git commit -m "feat(library): add asset library types"
```

---

## Task 3: 路径校验（纯函数）

**Files:**
- Create: `app/lib/libraryPath.ts`
- Test: `app/lib/__tests__/libraryPath.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  assertInsideRoot,
  isValidName,
  isValidRelPath,
  resolveAssetDir,
  resolveAssetFile,
} from '@/app/lib/libraryPath'

const ROOT = '/tmp/ie-assets'

describe('isValidName', () => {
  it('accepts lower-case slugs', () => {
    expect(isValidName('mossy-stone')).toBe(true)
    expect(isValidName('dungeon2')).toBe(true)
    expect(isValidName('a')).toBe(true)
  })

  it('rejects anything that could escape a path', () => {
    for (const bad of ['..', '../x', 'a/b', '/abs', 'a b', 'UPPER', 'a_b', '', '-lead', '.hidden']) {
      expect(isValidName(bad), bad).toBe(false)
    }
  })

  it('rejects names longer than 64 chars', () => {
    expect(isValidName('a'.repeat(64))).toBe(true)
    expect(isValidName('a'.repeat(65))).toBe(false)
  })
})

describe('isValidRelPath', () => {
  it('accepts raw/ and derived/ files', () => {
    expect(isValidRelPath('raw/sheet.png')).toBe(true)
    expect(isValidRelPath('derived/edge-top.png')).toBe(true)
    expect(isValidRelPath('derived/body.v2.png')).toBe(true)
  })

  it('rejects anything outside raw/ and derived/, and any nesting', () => {
    for (const bad of [
      'meta.json',
      'derived/',
      'derived/sub/x.png',
      '../derived/x.png',
      'derived/../meta.json',
      '/derived/x.png',
      'derived/UPPER.png',
      'derived/x',
      '',
    ]) {
      expect(isValidRelPath(bad), bad).toBe(false)
    }
  })
})

describe('assertInsideRoot', () => {
  it('accepts a path inside the root', () => {
    expect(() => assertInsideRoot(ROOT, path.join(ROOT, 'a/b/c.png'))).not.toThrow()
  })

  it('rejects the root itself and anything above or beside it', () => {
    expect(() => assertInsideRoot(ROOT, ROOT)).toThrow(/outside/)
    expect(() => assertInsideRoot(ROOT, '/tmp/other/x.png')).toThrow(/outside/)
    expect(() => assertInsideRoot(ROOT, path.join(ROOT, '../escape.png'))).toThrow(/outside/)
  })
})

describe('resolveAssetDir / resolveAssetFile', () => {
  it('builds the canonical layout', () => {
    expect(resolveAssetDir(ROOT, 'dungeon', 'tiles', 'mossy-stone')).toBe(
      path.join(ROOT, 'dungeon', 'tiles', 'mossy-stone')
    )
  })

  it('refuses to build a path from an invalid name', () => {
    expect(() => resolveAssetDir(ROOT, 'dungeon', 'tiles', '../x')).toThrow()
    expect(() => resolveAssetFile(ROOT, 'dungeon', 'tiles', 'ok', '../meta.json')).toThrow()
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/lib/__tests__/libraryPath.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/lib/libraryPath"`

- [ ] **Step 3: 实现**

`app/lib/libraryPath.ts`：

```ts
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
// NOTE (2026-10-05, after Task 3): the original draft here was
// /^(raw|derived)\/[a-z0-9][a-z0-9._-]{0,127}$/ which ACCEPTS 'derived/x',
// but the test table requires that to be rejected. Verified with node:
//   /^(raw|derived)\/[a-z0-9][a-z0-9._-]{0,127}$/.test('derived/x') === true
// The shipped regex requires an extension. All files we write are *.png.
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
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/lib/__tests__/libraryPath.test.ts`
Expected: PASS，全部用例通过

- [ ] **Step 5: 提交**

```bash
git add app/lib/libraryPath.ts app/lib/__tests__/libraryPath.test.ts
git commit -m "feat(library): add pure path validation for the asset library"
```

---

## Task 4: fs 层

**Files:**
- Create: `app/lib/library.ts`
- Test: `app/lib/__tests__/library.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assetsRoot,
  deleteAsset,
  listAssets,
  readAssetFile,
  readMeta,
  saveAsset,
} from '@/app/lib/library'
import type { AssetMeta } from '@/app/lib/libraryTypes'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function meta(slug = 'mossy-stone'): AssetMeta {
  return {
    schemaVersion: 1,
    type: 'tile-set',
    project: 'dungeon',
    kind: 'tiles',
    slug,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    manifest: null,
    files: { sheet: 'raw/sheet.png', derived: ['derived/body.png'] },
    provenance: {
      backend: 'apimart',
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'mossy stone',
      sceneBrief: null,
      artStyle: null,
      params: { width: 4096, height: 4096 },
      requested: '4096x4096',
      returned: '4096x4096',
      cost: { usd: 0.0262, source: 'apimart' },
      toolVersion: 'web',
    },
  }
}

describe('library fs layer', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ie-lib-'))
    process.env.IE_ASSETS_DIR = root
  })

  afterEach(async () => {
    delete process.env.IE_ASSETS_DIR
    await rm(root, { recursive: true, force: true })
  })

  it('defaults the root to <cwd>/assets', () => {
    delete process.env.IE_ASSETS_DIR
    expect(assetsRoot()).toBe(path.join(process.cwd(), 'assets'))
  })

  it('writes meta, sheet and derived files', async () => {
    const written = await saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), {
      'raw/sheet.png': PNG,
      'derived/body.png': PNG,
    })
    expect(written.sort()).toEqual(['derived/body.png', 'raw/sheet.png'])

    const dir = path.join(root, 'dungeon', 'tiles', 'mossy-stone')
    expect((await stat(path.join(dir, 'meta.json'))).isFile()).toBe(true)
    expect((await stat(path.join(dir, 'derived', 'body.png'))).isFile()).toBe(true)

    const roundTrip = await readMeta('dungeon', 'tiles', 'mossy-stone')
    expect(roundTrip.slug).toBe('mossy-stone')
    expect(roundTrip.provenance.cost?.usd).toBe(0.0262)
  })

  it('leaves no directory behind when a payload is not a data URL', async () => {
    await expect(
      saveAsset('dungeon', 'tiles', 'broken', meta('broken'), { 'derived/body.png': 'nope' })
    ).rejects.toThrow(/data URL/)

    const dir = path.join(root, 'dungeon', 'tiles', 'broken')
    await expect(stat(dir)).rejects.toThrow()
  })

  it('refuses to overwrite without the flag, and allows it with', async () => {
    await saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), { 'derived/body.png': PNG })
    await expect(
      saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), { 'derived/body.png': PNG })
    ).rejects.toThrow(/exists/)

    const again = await saveAsset(
      'dungeon',
      'tiles',
      'mossy-stone',
      meta(),
      { 'derived/body.png': PNG },
      { overwrite: true }
    )
    expect(again).toEqual(['derived/body.png'])
  })

  it('lists assets and skips a corrupt meta.json with a warning', async () => {
    await saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), { 'derived/body.png': PNG })
    const brokenDir = path.join(root, 'dungeon', 'tiles', 'broken')
    await mkdir(brokenDir, { recursive: true })
    await writeFile(path.join(brokenDir, 'meta.json'), '{ not json')

    const index = await listAssets()
    expect(index.warnings).toHaveLength(1)
    expect(index.projects.map((p) => p.name)).toEqual(['dungeon'])
    expect(index.projects[0].kinds[0].assets.map((a) => a.slug)).toEqual(['mossy-stone'])
  })

  it('reads a derived file as bytes and refuses a traversal path', async () => {
    await saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), { 'derived/body.png': PNG })
    const bytes = await readAssetFile('dungeon', 'tiles', 'mossy-stone', 'derived/body.png')
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')

    await expect(
      readAssetFile('dungeon', 'tiles', 'mossy-stone', '../meta.json')
    ).rejects.toThrow(/invalid asset file path/)
  })

  it('deletes an asset directory', async () => {
    await saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), { 'derived/body.png': PNG })
    await deleteAsset('dungeon', 'tiles', 'mossy-stone')
    const index = await listAssets()
    expect(index.projects).toHaveLength(0)
  })
})
```

在文件顶部补上 `mkdir`、`writeFile` 到已有的 `node:fs/promises` import 里。

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/lib/__tests__/library.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/lib/library"`

- [ ] **Step 3: 实现**

`app/lib/library.ts`：

```ts
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertInsideRoot,
  isValidKind,
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
    if (opts.overwrite && (await exists(dir))) await rm(dir, { recursive: true, force: true })
    await rename(tmp, dir)
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

  for (const project of (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && isValidName(d.name))) {
    const kinds = []
    for (const kind of ASSET_KINDS) {
      const kindDir = path.join(root, project.name, kind)
      if (!(await exists(kindDir))) continue
      const assets = []
      for (const slug of (await readdir(kindDir, { withFileTypes: true })).filter((d) => d.isDirectory() && isValidName(d.name))) {
        try {
          const meta = JSON.parse(await readFile(path.join(kindDir, slug.name, 'meta.json'), 'utf8')) as AssetMeta
          assets.push({ slug: slug.name, type: meta.type, updatedAt: meta.updatedAt, derived: meta.files?.derived ?? [] })
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
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/lib/__tests__/library.test.ts`
Expected: PASS，7 个用例通过

- [ ] **Step 5: 类型检查 + 提交**

```bash
npx tsc --noEmit
git add app/lib/library.ts app/lib/__tests__/library.test.ts
git commit -m "feat(library): add atomic fs layer for the asset library"
```

> **IMPLEMENTATION DRIFT (as built, commits `eb54397` → `d55ceb9` → `13e0f51` → `31d78da`).** 下面的代码块是初稿；实际落地在四处更强，**Task 5 及以后必须按实际版本写**：
>
> 1. **覆盖是"挪开再顶上"**，不是 `rm` + `rename`：先把旧目录 `rename` 成 `<dir>.old-<pid>-<ts>`，新目录顶上成功后才删 backup；失败则回滚 backup。初稿在两步之间崩溃会丢数据。
> 2. **`listAssets` 校验 meta 形状**：`slug`/`type` 必须都是 string，否则进 `warnings`（初稿只 `JSON.parse`，`{}` 会被当成正常资产列出）。
> 3. **孤儿写目录会告警**：形如 `<slug>.old-<digits>-<digits>` / `.tmp-<digits>-<digits>` 的目录记 `orphaned write directory: <project>/<kind>/<name>` 并跳过（双故障下不会静默消失）。
> 4. **导出了 `LibraryError` / `LibraryErrorCode`**（`'EEXISTS' | 'ENOTFOUND'`）：`saveAsset` 同名抛 `EEXISTS`，`deleteAsset` 缺失抛 `ENOTFOUND`。**route 用 `err.code` 映射状态码，禁止用错误文案前缀判断**（Task 5 的初稿写的 `message.startsWith('asset already exists')` 是错的）。
>
> 测试 11 条全绿（`app/lib/__tests__/library.test.ts`）。

---

## Task 5: 路由 —— GET 索引 / meta / 文件

**Files:**
- Create: `app/api/library/[[...path]]/route.ts`
- Test: `app/api/library/__tests__/route.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { GET, POST, DELETE } from '@/app/api/library/[[...path]]/route'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function req(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), init as never)
}

const meta = {
  schemaVersion: 1,
  type: 'tile-set',
  project: 'dungeon',
  kind: 'tiles',
  slug: 'mossy-stone',
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  manifest: { type: 'tile-set' },
  files: { sheet: 'raw/sheet.png', derived: ['derived/body.png'] },
  provenance: { backend: 'openrouter', model: 'm', prompt: null, sceneBrief: null, artStyle: null, params: {}, requested: null, returned: null, cost: null, toolVersion: 'web' },
}

describe('/api/library', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ie-lib-api-'))
    process.env.IE_ASSETS_DIR = root
    process.env.IE_BACKEND_LABEL = 'apimart'
  })

  afterEach(async () => {
    delete process.env.IE_ASSETS_DIR
    delete process.env.IE_BACKEND_LABEL
    await rm(root, { recursive: true, force: true })
  })

  it('starts empty', async () => {
    const res = await GET(req('/api/library'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ projects: [], warnings: [] })
  })

  it('saves, indexes, serves meta and serves the PNG', async () => {
    const save = await POST(
      req('/api/library', {
        method: 'POST',
        body: JSON.stringify({
          project: 'dungeon',
          kind: 'tiles',
          slug: 'mossy-stone',
          meta,
          files: { 'derived/body.png': PNG },
        }),
      })
    )
    expect(save.status).toBe(201)

    const index = await (await GET(req('/api/library'))).json()
    expect(index.projects[0].kinds[0].assets[0].slug).toBe('mossy-stone')

    const metaRes = await GET(req('/api/library/dungeon/tiles/mossy-stone'))
    expect(metaRes.status).toBe(200)
    expect((await metaRes.json()).provenance.backend).toBe('apimart')

    const fileRes = await GET(req('/api/library/dungeon/tiles/mossy-stone?file=derived/body.png'))
    expect(fileRes.status).toBe(200)
    expect(fileRes.headers.get('content-type')).toBe('image/png')
    const bytes = Buffer.from(await fileRes.arrayBuffer())
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  })

  it('rejects invalid names and traversal with 400 and writes nothing', async () => {
    for (const body of [
      { project: '../etc', kind: 'tiles', slug: 'x', meta, files: {} },
      { project: 'dungeon', kind: 'nope', slug: 'x', meta, files: {} },
      { project: 'dungeon', kind: 'tiles', slug: 'x', meta: { ...meta, slug: 'x' }, files: { '../meta.json': PNG } },
    ]) {
      const res = await POST(req('/api/library', { method: 'POST', body: JSON.stringify(body) }))
      expect(res.status).toBe(400)
    }
    const index = await (await GET(req('/api/library'))).json()
    expect(index.projects).toEqual([])
  })

  it('returns 409 on a duplicate and 200 with overwrite', async () => {
    const body = JSON.stringify({ project: 'dungeon', kind: 'tiles', slug: 'mossy-stone', meta, files: { 'derived/body.png': PNG } })
    expect((await POST(req('/api/library', { method: 'POST', body }))).status).toBe(201)
    expect((await POST(req('/api/library', { method: 'POST', body }))).status).toBe(409)
    expect(
      (await POST(req('/api/library', { method: 'POST', body: JSON.stringify({ ...JSON.parse(body), overwrite: true }) }))).status
    ).toBe(200)
  })

  it('404s an unknown asset and deletes an existing one', async () => {
    expect((await GET(req('/api/library/dungeon/tiles/nope'))).status).toBe(404)
    await POST(req('/api/library', { method: 'POST', body: JSON.stringify({ project: 'dungeon', kind: 'tiles', slug: 'mossy-stone', meta, files: { 'derived/body.png': PNG } }) }))
    expect((await DELETE(req('/api/library/dungeon/tiles/mossy-stone'))).status).toBe(204)
    expect((await GET(req('/api/library/dungeon/tiles/mossy-stone'))).status).toBe(404)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/api/library/__tests__/route.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/library/[[...path]]/route"`

- [ ] **Step 3: 实现**

`app/api/library/[[...path]]/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server'
import {
  deleteAsset,
  listAssets,
  readAssetFile,
  readMeta,
  saveAsset,
} from '@/app/lib/library'
import { isValidKind, isValidName, isValidRelPath } from '@/app/lib/libraryPath'
import type { AssetMeta } from '@/app/lib/libraryTypes'

// fs needs the Node runtime, and the index must never be cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FILE_BYTES = 40 * 1024 * 1024
const MAX_BODY_BYTES = 200 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function triple(segments: string[] | undefined) {
  if (!segments || segments.length !== 3) return null
  const [project, kind, slug] = segments
  if (!isValidName(project) || !isValidKind(kind) || !isValidName(slug)) return null
  return { project, kind, slug }
}

export async function GET(request: NextRequest, ctx: { params: { path?: string[] } }) {
  const segments = ctx?.params?.path
  if (!segments || segments.length === 0) {
    try {
      return NextResponse.json(await listAssets())
    } catch (err) {
      return NextResponse.json(
        { error: `asset library unavailable: ${(err as Error).message}` },
        { status: 500 }
      )
    }
  }

  const ids = triple(segments)
  if (!ids) return bad('invalid asset path')

  const rel = request.nextUrl.searchParams.get('file')
  if (rel) {
    if (!isValidRelPath(rel)) return bad('invalid file')
    try {
      const bytes = await readAssetFile(ids.project, ids.kind, ids.slug, rel)
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          'content-type': CONTENT_TYPES[rel.split('.').pop() ?? 'png'] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        },
      })
    } catch {
      return bad('file not found', 404)
    }
  }

  try {
    return NextResponse.json(await readMeta(ids.project, ids.kind, ids.slug))
  } catch {
    return bad('asset not found', 404)
  }
}

export async function POST(request: NextRequest) {
  let payload: {
    project?: string
    kind?: string
    slug?: string
    meta?: AssetMeta
    files?: Record<string, string>
    overwrite?: boolean
  }
  try {
    payload = await request.json()
  } catch {
    return bad('invalid JSON body')
  }

  const { project, kind, slug, meta, files, overwrite } = payload
  if (!isValidName(project)) return bad('invalid project')
  if (!isValidKind(kind)) return bad('invalid kind')
  if (!isValidName(slug)) return bad('invalid slug')
  if (!meta || typeof meta !== 'object') return bad('missing meta')
  if (!files || typeof files !== 'object' || Object.keys(files).length === 0) return bad('missing files')
  for (const [rel, dataUrl] of Object.entries(files)) {
    if (!isValidRelPath(rel)) return bad(`invalid file path: ${rel}`)
    if (typeof dataUrl !== 'string') return bad(`invalid payload for ${rel}`)
    if (dataUrl.length > MAX_FILE_BYTES * 1.4) return bad(`file too large: ${rel}`, 413)
  }
  const total = Object.values(files).reduce((n, v) => n + v.length, 0)
  if (total > MAX_BODY_BYTES) return bad('request body too large', 413)

  // The backend that actually served the generation is a server-side fact —
  // never trust the client for it.
  const stamped: AssetMeta = {
    ...meta,
    schemaVersion: 1,
    project,
    kind,
    slug,
    updatedAt: new Date().toISOString(),
    provenance: {
      ...meta.provenance,
      backend: process.env.IE_BACKEND_LABEL || meta.provenance?.backend || 'openrouter',
    },
  }

  try {
    const written = await saveAsset(project, kind, slug, stamped, files, { overwrite })
    return NextResponse.json({ path: `${project}/${kind}/${slug}`, written }, { status: overwrite ? 200 : 201 })
  } catch (err) {
    const err2 = err as { message?: string; code?: string }
    const status = err2.code === 'EEXISTS' ? 409 : 400
    return bad(err2.message || 'save failed', status)
  }
}

export async function DELETE(_request: NextRequest, ctx: { params: { path?: string[] } }) {
  const ids = triple(ctx?.params?.path)
  if (!ids) return bad('invalid asset path')
  try {
    await deleteAsset(ids.project, ids.kind, ids.slug)
    return new NextResponse(null, { status: 204 })
  } catch {
    return bad('asset not found', 404)
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/api/library/__tests__/route.test.ts`
Expected: PASS，5 个用例通过

- [ ] **Step 5: 验证真实 dev server 上的 404 与 201**

```bash
npm run dev &            # 等待 "ready"
curl -s localhost:3000/api/library | head -c 200
# 期望: {"projects":[],"warnings":[]}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/library/a/b/c
# 期望: 404
```
（该 `assets/` 目录此时还没被写；确认 GET 不报错。）

- [ ] **Step 6: 验证 15 MB 级 POST body（spec §13.1 的唯一契约风险点）**

真实产物就是 5–15 MB（spec §1 实测：2880² PNG = 5.7 MB，4096² ≈ 11 MB 二进制）。先测，再决定要不要改 §6 契约。

```bash
cd /Users/zidong/repos/image-extender
python3 - <<'PY'
import base64, json, urllib.request
png = base64.b64encode(open('/tmp/apimart_tile.png','rb').read()).decode()  # 5.7MB PNG
body = {
  "project": "probe", "kind": "tiles", "slug": "big",
  "meta": {"schemaVersion":1,"type":"tile-set","project":"probe","kind":"tiles","slug":"big",
           "createdAt":"2026-10-05T00:00:00Z","updatedAt":"2026-10-05T00:00:00Z","manifest":None,
           "files":{"sheet":None,"derived":["derived/body.png"]},
           "provenance":{"backend":"x","model":"m","prompt":None,"sceneBrief":None,"artStyle":None,
                         "params":{},"requested":None,"returned":None,"cost":None,"toolVersion":"web"}},
  "files": {"derived/body.png": "data:image/png;base64," + png},
}
req = urllib.request.Request("http://localhost:3000/api/library",
        data=json.dumps(body).encode(), headers={"content-type":"application/json"})
print(json.load(urllib.request.urlopen(req, timeout=120)))
PY
du -sh assets/probe/tiles/big
```

Expected: `201` 且 `du` 报出 5.7 MB 左右。

- **如果 201**：契约成立，不改 §6，继续。
- **如果 413 / 请求被截断 / Next 报 body 上限**：**停下来**，把发现记进 spec §13.1，并把 §6 的 POST 契约改成"先 `POST` 建目录（只带 meta），再逐个 `PUT /api/library/<p>/<k>/<s>?file=<rel>` 写文件"。这是**契约变更**，需要重新过一遍 spec，不要就地改 plan。

- [ ] **Step 7: 提交**

```bash
git add app/api/library app/api/library/__tests__/route.test.ts
git commit -m "feat(library): add /api/library route (index, meta, file, save, delete)"
```

> **IMPLEMENTATION DRIFT (as built, commits `a6876fd` → `bb940e4` → `23e9e4a`).** 上面的代码块是初稿；实际落地：
>
> 1. **backend 必须服务端盖章**：`backend: process.env.IE_BACKEND_LABEL || 'openrouter'` —— **不要**回退到客户端的 `meta.provenance.backend`（复审探针证实：env 未设置时客户端伪造值会原样落盘）。默认值 `'openrouter'` 是对的，因为 6 个路由都硬编码 OpenRouter。
> 2. **深层路径缺 `ctx.params` 时返回 400 `missing route params`**，不是静默返回索引（`pathname !== '/api/library'` 时）。
> 3. **尺寸上限按 base64 的 4/3 膨胀从事实派生**：`MAX_FILE_CHARS = ceil(40MiB*4/3)+256`、`MAX_TOTAL_CHARS = ceil(200MiB*4/3)+1024`；超限文案是 `payload too large`（它限制的是已缓冲之后的文件总量，不是整个 body）。
> 4. 命名：`parseAssetIds()`（不是 `triple()`）；`UNUSABLE_FS_CODES` 用 `Set<string>`。
> 5. 错误映射：`LibraryError.code === 'EEXISTS'` → 409；fs 的 `ENOTDIR/EACCES/EROFS/EISDIR/ENOSPC` → 500；其余 → 400。
>
> 测试 8 条全绿（`app/api/library/__tests__/route.test.ts`）。另外 `/api/library/a/b/c` 返回 **400**（`b` 不是合法 kind），不是初稿里写的 404。

---

## Task 6: studio 状态收集器（纯函数）

**Files:**
- Create: `app/lib/libraryCollect.ts`
- Test: `app/lib/__tests__/libraryCollect.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest'
import { collectStudioAsset, slugify } from '@/app/lib/libraryCollect'

const PNG = 'data:image/png;base64,AAAA'

describe('slugify', () => {
  it('lower-cases, collapses and truncates', () => {
    expect(slugify('Mossy Grey Dungeon Stone!')).toBe('mossy-grey-dungeon-stone')
    expect(slugify('   ')).toBe('asset')
    expect(slugify('a'.repeat(90))).toHaveLength(64)
    expect(slugify('--weird__name--')).toBe('weird-name')
  })
})

describe('collectStudioAsset', () => {
  it('collects tiles: one derived PNG per role plus the sheet', () => {
    const out = collectStudioAsset({ mode: 'tile',
      prompt: 'mossy stone',
      model: 'google/gemini-3.1-flash-image-preview',
      tileSet: [
        { role: 'body', imageUrl: PNG },
        { role: 'top', imageUrl: null },
      ],
      tileSheetDataUrl: PNG,
      manifest: null,
    })
    expect(out.kind).toBe('tiles')
    expect(Object.keys(out.files).sort()).toEqual(['derived/body.png', 'raw/sheet.png'])
    expect(out.provenance.params).toEqual({ role: 'body' })
  })

  it('collects props with their file names and the manifest', () => {
    const out = collectStudioAsset({ mode: 'props',
      prompt: 'rocks',
      model: 'm',
      propItems: [{ id: 'p1', name: 'Rock', imageUrl: PNG }],
      propFiles: ['rock.png'],
      propAtlasDataUrl: PNG,
      manifest: { type: 'prop-atlas' },
    })
    expect(out.kind).toBe('props')
    expect(Object.keys(out.files).sort()).toEqual(['derived/rock.png', 'raw/sheet.png'])
    expect(out.manifest).toEqual({ type: 'prop-atlas' })
  })

  it('collects sprite frames reindexed to contiguous names', () => {
    const out = collectStudioAsset({ mode: 'sprite',
      prompt: 'knight',
      model: 'm',
      frames: [{ imageUrl: PNG }, { imageUrl: null }, { imageUrl: PNG }],
      manifest: null,
    })
    expect(out.kind).toBe('sprites')
    expect(Object.keys(out.files)).toEqual(['derived/frame_01.png', 'derived/frame_02.png'])
  })

  it('collects a single extender/parallax image', () => {
    const out = collectStudioAsset({ mode: 'extender',
      prompt: null,
      model: 'm',
      imageUrl: PNG,
      dimensions: { width: 1413, height: 1024 },
      manifest: null,
    })
    expect(out.kind).toBe('extend')
    expect(Object.keys(out.files)).toEqual(['derived/image.png'])
    expect(out.provenance.returned).toBe('1413x1024')
  })

  it('returns null when there is nothing to save', () => {
    expect(collectStudioAsset({ mode: 'tile',
      prompt: null, model: 'm', tileSet: [], tileSheetDataUrl: null, manifest: null,
    })).toBeNull()
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/lib/__tests__/libraryCollect.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现**

`app/lib/libraryCollect.ts`：

```ts
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
    const populated = (input.propItems ?? []).filter((x): x is { id: string; name: string; imageUrl: string } => !!x.imageUrl)
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
```

> 已核实：`app/lib/tileset.ts` 导出的是 `TileSetRole`（不是 `TileRole`）与 `TILESET_BY_ROLE: Record<TileSetRole, TileSetSlotSpec>`，`TileSetSlotSpec.fileName` 就是 ZIP 导出用的文件名。`tileSet` 元素类型是 `TileSetSlot`。**不要**改 `tileset.ts`。

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/lib/__tests__/libraryCollect.test.ts`
Expected: PASS，5 个用例通过

- [ ] **Step 5: 提交**

```bash
git add app/lib/libraryCollect.ts app/lib/__tests__/libraryCollect.test.ts
git commit -m "feat(library): add pure studio-state collector"
```

---

## Task 7: 浏览器客户端

**Files:**
- Create: `app/lib/libraryClient.ts`

- [ ] **Step 1: 实现**

```ts
import type { AssetMeta, LibraryIndex } from '@/app/lib/libraryTypes'

/**
 * Browser-side wrapper around /api/library. The UI never builds a URL by hand
 * and never touches the filesystem.
 */

export class LibraryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function toError(res: Response): Promise<LibraryError> {
  let message = `HTTP ${res.status}`
  try {
    const body = await res.json()
    if (body?.error) message = body.error
  } catch {
    /* keep the status text */
  }
  return new LibraryError(message, res.status)
}

export async function fetchIndex(): Promise<LibraryIndex> {
  const res = await fetch('/api/library', { cache: 'no-store' })
  if (!res.ok) throw await toError(res)
  return res.json()
}

export async function fetchMeta(project: string, kind: string, slug: string): Promise<AssetMeta> {
  const res = await fetch(`/api/library/${project}/${kind}/${slug}`, { cache: 'no-store' })
  if (!res.ok) throw await toError(res)
  return res.json()
}

/** Same-origin URL for a stored file — safe to draw into a canvas. */
export function assetFileUrl(project: string, kind: string, slug: string, rel: string): string {
  return `/api/library/${project}/${kind}/${slug}?file=${encodeURIComponent(rel)}`
}

export async function saveAsset(payload: {
  project: string
  kind: string
  slug: string
  meta: AssetMeta
  files: Record<string, string>
  overwrite?: boolean
}): Promise<{ path: string; written: string[] }> {
  const res = await fetch('/api/library', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw await toError(res)
  return res.json()
}

export async function deleteAsset(project: string, kind: string, slug: string): Promise<void> {
  const res = await fetch(`/api/library/${project}/${kind}/${slug}`, { method: 'DELETE' })
  if (!res.ok) throw await toError(res)
}
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
npx tsc --noEmit
git add app/lib/libraryClient.ts
git commit -m "feat(library): add browser client for /api/library"
```

---

## Task 8: 面板组件

**Files:**
- Create: `app/components/LibraryPanel.tsx`

- [ ] **Step 1: 实现**

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  assetFileUrl,
  deleteAsset,
  fetchIndex,
  saveAsset,
  LibraryError,
} from '@/app/lib/libraryClient'
import type { AssetKind, AssetMeta, LibraryIndex } from '@/app/lib/libraryTypes'
import type { CollectedAsset } from '@/app/lib/libraryCollect'
import { slugify } from '@/app/lib/libraryCollect'

export type LibraryPanelProps = {
  /** What the current studio would save, or null when there is nothing. */
  pending: (() => Promise<CollectedAsset | null>) | null
  /** Default project name, remembered across sessions. */
  project: string
  onProjectChange: (project: string) => void
  /** Load a stored PNG back into the active studio. */
  onLoad: (url: string) => void
  /** Report a saved asset id so the studio can mark it as stored. */
  onSaved?: (id: string) => void
}

const KIND_LABEL: Record<AssetKind, string> = {
  tiles: 'Tiles',
  sprites: 'Sprites',
  props: 'Props',
  parallax: 'Parallax',
  extend: 'Extender',
}

/**
 * Asset library browser. Mounted next to the existing export buttons; it is a
 * consumer of /api/library and holds no asset state of its own beyond the
 * index it just fetched.
 */
export default function LibraryPanel({
  pending,
  project,
  onProjectChange,
  onLoad,
  onSaved,
}: LibraryPanelProps) {
  const [index, setIndex] = useState<LibraryIndex | null>(null)
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [dialog, setDialog] = useState<{ kind: AssetKind; slug: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      setIndex(await fetchIndex())
      setError('')
    } catch (err) {
      setIndex(null)
      setError(err instanceof LibraryError ? err.message : 'asset library unavailable')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const beginSave = async () => {
    const collected = await pending?.()
    if (!collected) {
      setStatus('Nothing to save yet — generate something first.')
      return
    }
    const source =
      collected.provenance.prompt || collected.kind
    setDialog({ kind: collected.kind, slug: slugify(source as string) })
  }

  const commitSave = async (overwrite: boolean) => {
    const collected = await pending?.()
    if (!dialog || !collected) return
    const now = new Date().toISOString()
    const meta: AssetMeta = {
      schemaVersion: 1,
      type: typeof collected.manifest?.type === 'string' ? collected.manifest.type : `${collected.kind}-set`,
      project,
      kind: collected.kind,
      slug: dialog.slug,
      createdAt: now,
      updatedAt: now,
      manifest: collected.manifest,
      files: {
        sheet: Object.keys(collected.files).find((f) => f.startsWith('raw/')) ?? null,
        derived: Object.keys(collected.files).filter((f) => f.startsWith('derived/')).sort(),
      },
      provenance: { ...collected.provenance, backend: 'openrouter', toolVersion: 'web' },
    }
    setStatus('Saving…')
    try {
      const res = await saveAsset({ project, kind: collected.kind, slug: dialog.slug, meta, files: collected.files, overwrite })
      onSaved?.(res.path)
      setStatus(`Saved ${res.path}`)
      setDialog(null)
      await refresh()
    } catch (err) {
      if (err instanceof LibraryError && err.status === 409) {
        setError(`“${dialog.slug}” already exists.`)
        return
      }
      setError(err instanceof Error ? err.message : 'save failed')
    }
  }

  const remove = async (kind: AssetKind, slug: string) => {
    try {
      await deleteAsset(project, kind, slug)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium">Asset library</span>
        <input
          aria-label="project"
          value={project}
          onChange={(e) => onProjectChange(slugify(e.target.value))}
          className="w-28 rounded bg-white/5 px-2 py-0.5 text-xs"
        />
        <button type="button" onClick={() => void beginSave()} className="rounded bg-white/10 px-2 py-0.5 text-xs">
          Save to library
        </button>
        <button type="button" onClick={() => void refresh()} className="rounded bg-white/5 px-2 py-0.5 text-xs">
          Refresh
        </button>
      </div>

      {status && <p className="text-xs text-white/60">{status}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {dialog && (
        <div className="my-2 rounded border border-white/10 p-2">
          <label className="text-xs">
            Slug
            <input
              aria-label="slug"
              value={dialog.slug}
              onChange={(e) => setDialog({ ...dialog, slug: slugify(e.target.value) })}
              className="ml-2 rounded bg-white/5 px-2 py-0.5"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-xs" onClick={() => void commitSave(false)}>
              Save
            </button>
            <button type="button" className="rounded bg-white/5 px-2 py-0.5 text-xs" onClick={() => void commitSave(true)}>
              Overwrite
            </button>
            <button type="button" className="rounded bg-white/5 px-2 py-0.5 text-xs" onClick={() => setDialog(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {index?.projects.map((p) => (
        <div key={p.name} className="mt-2">
          <div className="text-xs uppercase tracking-wide text-white/40">{p.name}</div>
          {p.kinds.map((k) => (
            <div key={k.name} className="mt-1">
              <div className="text-xs text-white/60">{KIND_LABEL[k.name]}</div>
              <ul className="flex flex-wrap gap-2">
                {k.assets.map((a) => (
                  <li key={a.slug} className="flex items-center gap-1 rounded bg-white/5 p-1">
                    {a.derived[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={assetFileUrl(p.name, k.name, a.slug, a.derived[0])}
                        alt={a.slug}
                        width={40}
                        height={40}
                        className="h-10 w-10 object-contain"
                      />
                    )}
                    <button
                      type="button"
                      className="text-xs"
                      onClick={() => a.derived[0] && onLoad(assetFileUrl(p.name, k.name, a.slug, a.derived[0]))}
                    >
                      {a.slug}
                    </button>
                    <button
                      type="button"
                      aria-label={`delete ${a.slug}`}
                      className="text-xs text-white/40 hover:text-red-400"
                      onClick={() => void remove(k.name, a.slug)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}

      {index && index.warnings.length > 0 && (
        <p className="mt-2 text-xs text-amber-400">{index.warnings.join('; ')}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/components/LibraryPanel.tsx
git commit -m "feat(library): add asset library panel"
```

---

## Task 9: 接入 `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: 加 import（文件顶部，与既有 import 同区）**

在 `app/page.tsx` 的 import 区（第 24 行 `import JSZip from 'jszip'` 附近）加：

```tsx
import LibraryPanel from '@/app/components/LibraryPanel'
import { collectStudioAsset } from '@/app/lib/libraryCollect'
```

- [ ] **Step 2: 加 project 状态**

在 `const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL)`（第 194 行）后面加：

```tsx
  const [libraryProject, setLibraryProject] = useState<string>('default')
```

并在已有的 localStorage 水合 effect（第 207-209 行那一段）末尾加：

```tsx
      setLibraryProject(localStorage.getItem('extender:library_project') || 'default')
```

在已有保存 effect（第 256-258 行那一段）里加一行：

```tsx
      localStorage.setItem('extender:library_project', libraryProject)
```

- [ ] **Step 3: 加收集器回调**

在 `buildPropManifest` 定义（第 1958 行）之后加：

```tsx
  /**
   * Snapshot of what the current studio would hand to the library. Reads the
   * same state the ZIP exporters read; never mutates it.
   */
  const collectPendingLibraryAsset = useCallback(async () => {
    if (mode === 'tile') {
      return collectStudioAsset({ mode: 'tile',
        prompt: tilePrompt.trim() || null,
        model: selectedModel,
        tileSet: tileSet.map((s) => ({ role: s.role, imageUrl: s.imageUrl })),
        // `buildTileSheetDataUrl` is async (it renders a canvas) — line 1563.
        tileSheetDataUrl: await buildTileSheetDataUrl(),
        manifest: buildTileSetManifest(),
      })
    }
    if (mode === 'props') {
      const populated = propItems.filter((p) => p.imageUrl)
      return collectStudioAsset({ mode: 'props',
        prompt: propPrompt.trim() || null,
        model: selectedModel,
        propItems: populated.map((p) => ({ id: p.id, name: p.name, imageUrl: p.imageUrl })),
        propFiles: resolvePropNames(populated).map((n) => n.file),
        propAtlasDataUrl: await buildPropAtlasDataUrl(),
        manifest: buildPropManifest(),
      })
    }
    if (mode === 'sprite') {
      return collectStudioAsset({ mode: 'sprite',
        prompt: spritePrompt.trim() || null,
        model: selectedModel,
        frames: spriteSheet.frames.filter((f) => f.imageUrl && !f.disabled).map((f) => ({ imageUrl: f.imageUrl })),
        manifest: null,
      })
    }
    return collectStudioAsset(mode === 'parallax' ? 'parallax' : 'extender', {
      prompt: null,
      model: selectedModel,
      imageUrl: activeCandidate?.imageUrl ?? selectedImage,
      dimensions: activeCandidate ? candidateDims[selectedCandidateIdx] ?? null : currentImageDimensions,
      manifest: null,
    })
  }, [
    mode, tilePrompt, tileSet, propPrompt, propItems, spritePrompt, spriteSheet,
    activeCandidate, selectedImage, candidateDims, selectedCandidateIdx,
    currentImageDimensions, selectedModel,
  ])
```

已核实（`grep` 过 `app/page.tsx`）：`tilePrompt` / `propPrompt` / `spritePrompt` / `propItems` / `tileSet` / `spriteSheet` / `activeCandidate` / `selectedImage` / `candidateDims` / `selectedCandidateIdx` / `currentImageDimensions` 都存在；`buildTileSheetDataUrl`（:1563）与 `buildPropAtlasDataUrl`（:1927）是 **async** 函数，`buildTileSetManifest`（:1660）是同步函数 —— 上面已按此写。`resolvePropNames` 从 `@/app/lib/props` 导入（page.tsx:18）。

回调改成 async 后，`LibraryPanelProps.pending` 的类型也必须改成 `() => Promise<CollectedAsset | null>`（Task 8 已按此写），面板内两处调用都要 `await`。

`beginSave` 现在是 async 调用点：把按钮的 `onClick={beginSave}` 改成 `onClick={() => void beginSave()}`，否则 `tsc` 会报 Promise 未处理。

`useCallback` 的依赖数组里补上 `buildTileSheetDataUrl` / `buildPropAtlasDataUrl` / `buildTileSetManifest`；如果 `next lint` 因此报 exhaustive-deps 抖动，改为在回调内直接调用这三个函数并在依赖里保留 `mode`、`selectedModel` 与各 studio 状态即可 —— 不要为了消警告去 `useRef` 包一层。

- [ ] **Step 4: 渲染面板**

找到渲染 `handleDownloadFull` 那个按钮的容器（在 `app/page.tsx` 尾部渲染区，约 4000 行附近），在同一容器内、按钮下方插入：

```tsx
        <LibraryPanel
          pending={collectPendingLibraryAsset}
          project={libraryProject}
          onProjectChange={setLibraryProject}
          onLoad={(url) => void applyImageToActiveLayer(url, { fromUpload: true })}
        />
```

- [ ] **Step 5: 手动验证（这是本任务唯一有效的验收）**

```bash
npm run dev
```

在浏览器里：
1. Tiles studio 生成一次（或先只上传一张图）→ 点 **Save to library** → 确认出现 slug 对话框 → Save。
2. 终端确认磁盘：`ls -R assets/default/tiles/*/ && cat assets/default/tiles/*/meta.json`
3. **刷新页面** → 面板里能看到该资产、缩略图正常。
4. 点击资产名 → 图被载入到 studio。
5. 再点一次 Save 同名 → 出现 409 提示，点 Overwrite → 成功。

- [ ] **Step 6: 提交**

```bash
git add app/page.tsx
git commit -m "feat(library): mount asset library panel in the studio"
```

---

## Task 10: cost 透传（可空）

**Files:**
- Modify: `app/api/generate/route.ts`
- Test: `app/lib/__tests__/generateCost.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest'
import { extractCost } from '@/app/api/generate/route'

describe('extractCost', () => {
  it('reads OpenRouter usage cost when present', () => {
    expect(extractCost({ usage: { cost: 0.0312 } })).toEqual({ usd: 0.0312, source: 'openrouter' })
  })

  it('returns null when the provider reports nothing', () => {
    expect(extractCost({})).toBeNull()
    expect(extractCost({ usage: {} })).toBeNull()
    expect(extractCost({ usage: { cost: 'free' } })).toBeNull()
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/lib/__tests__/generateCost.test.ts`
Expected: FAIL — `extractCost` 未导出

- [ ] **Step 3: 实现**

在 `app/api/generate/route.ts` 里加一个导出函数（放在文件顶部 helper 区）：

```ts
/**
 * Pull the provider-reported spend out of a chat-completions response body.
 * Only OpenRouter's `usage.cost` is understood; anything else yields null so
 * the library records "unknown" rather than a fabricated number.
 */
export function extractCost(data: unknown): { usd: number; source: string } | null {
  const cost = (data as { usage?: { cost?: unknown } } | null)?.usage?.cost
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null
  return { usd: cost, source: 'openrouter' }
}
```

并把该路由成功返回的那一行（`return NextResponse.json({ imageUrl, names })`）改为：

```ts
    return NextResponse.json({ imageUrl, names, cost: extractCost(data) })
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/lib/__tests__/generateCost.test.ts`
Expected: PASS，2 个用例通过

> 说明：真实 provider 是否返回 `usage.cost` **未在本次会话验证**（无 OpenRouter key）。这是防御式读取 —— 有就用，没有就 `null`。若实际不返回，`cost` 保持 `null` 是可接受的结果，不要伪造。

- [ ] **Step 5: 提交**

```bash
git add app/api/generate/route.ts app/lib/__tests__/generateCost.test.ts
git commit -m "feat(library): pass provider-reported cost through /api/generate"
```

---

## Task 11: 仓库配置与文档

**Files:**
- Create: `.gitattributes`
- Modify: `.gitignore`, `.env.example`, `README.md`

- [ ] **Step 1: 忽略 raw 且不 diff 二进制**

`.gitattributes`（新建）：

```
*.png -diff
```

`.gitignore` 追加：

```
# Asset library: only derived/ is versioned; raw model output stays local.
assets/**/raw/
```

- [ ] **Step 2: 环境变量**

`.env.example` 追加：

```
# Where the local asset library lives (default: <repo>/assets).
IE_ASSETS_DIR=
# Label recorded in each asset's meta.json provenance.backend.
IE_BACKEND_LABEL=openrouter
```

- [ ] **Step 3: README**

在 README 的 Tech stack 之后加一节：

```markdown
## Asset library

Generated assets are saved to a local, git-shareable directory:

    assets/<project>/<kind>/<slug>/
      meta.json      # manifest + provenance (backend, model, params, cost)
      raw/           # model output — gitignored
      derived/       # finished tiles / frames / atlases — versioned

- `IE_ASSETS_DIR` overrides the location (default `<repo>/assets`).
- Sharing with a teammate is `git pull` — one directory per asset means no
  merge conflicts.
- `raw/` is intentionally not versioned: a 4096² sheet is ~11 MB, and a
  hundred of them would make the repo unusable. The prompt and params in
  `meta.json` are enough to regenerate it.
```

- [ ] **Step 4: 确认忽略规则生效**

```bash
git check-ignore -v --no-index assets/default/tiles/stone/raw/sheet.png
```
Expected: 命中 `assets/**/raw/`

- [ ] **Step 5: 提交**

```bash
git add .gitattributes .gitignore .env.example README.md
git commit -m "docs(library): document the asset library and ignore raw output"
```

---

## Task 12: 收尾验证

**Files:** 无（只跑验证）

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全部通过（Task 1-10 的用例）

- [ ] **Step 2: Export 逐字节回归（spec §10 的最关键一条）**

```bash
npm run dev
```
在浏览器里生成一次 tile set，分别：
1. 点 Export ZIP → 保存文件 A
2. 点 Save to library（不导出）→ 刷新页面 → 从库载入
3. 再从当前状态点 Export ZIP → 保存文件 B

```bash
unzip -p A manifest.json > /tmp/a.json 2>/dev/null || true
unzip -p B manifest.json > /tmp/b.json 2>/dev/null || true
cmp /tmp/a.json /tmp/b.json && echo "manifest identical"
```
Expected: `manifest identical`（导出路径未被资产库改动）

> 注意：PNG 字节可能因重新生成而不同 —— 本步骤只比对 **manifest 结构**，不要拿两次生成的图做字节比较。

- [ ] **Step 3: 团队共享冒烟**

```bash
cd /tmp && rm -rf ie-fork-b && git clone https://github.com/LZD121/image-extender.git ie-fork-b
# 把上一步产生的 assets/ 提交并推到 fork，然后在 clone 里：
ls ie-fork-b/assets/default/tiles/
```
Expected: 第二个 clone 里能看到资产目录（`raw/` 不在其中）

- [ ] **Step 4: 提交任何收尾修复并推 fork**

```bash
git push fork main
```

---

## 非目标（不要做）

- 不要改 `handleDownload*` 四个导出处理器，也不要抽公共函数
- 不要做队列 / 批量生成 UI
- 不要做认证、多用户、服务端实例
- 不要做内容寻址去重、GC
- 不要加 `realpath` 符号链接校验（spec §9 明确接受该风险）
- 不要给 `meta.json` 写 migration（spec §5 明确推迟）
