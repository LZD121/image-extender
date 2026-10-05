# 真像素画产线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 fork 里落地一条真像素画产线：`/api/pixel` 薄代理接 PixelLab，第六个 studio 做生成与确定性拼装（探相位 → mode-decimate → 整数裁切），成品落进资产库。

**Architecture:** 生成走 vendor HTTP API（BYOK，key 走 `x-pixellab-key` 头，服务端不落盘）；拼装是纯函数（`app/utils/pixelGrid.ts`，不碰 canvas，vitest 可测）；PixelStudio 自带状态与自己的 `<LibraryPanel>` 实例（不往 4068 行的 `page.tsx` 里塞状态）。验收指标留在 agent 侧，app 只显示单图徽章。

**Tech Stack:** Next.js 14 App Router · React 18 · TypeScript strict · Tailwind · vitest 2（`app/**/__tests__/**/*.test.ts`）· PixelLab REST v2

**Spec:** `docs/superpowers/specs/2026-10-05-pixel-art-line-design.md`

**前置条件：** 资产库计划（`2026-10-05-local-asset-library.md`）Task 1–10 已完成。本计划的 Task 10/11 依赖它的 `app/lib/libraryClient.ts` 与 `app/components/LibraryPanel.tsx`。

---

## File Structure

| 文件 | 职责 |
|---|---|
| Create `app/lib/pixel.ts` | op 名 / 尺寸边界 / 模板清单 / 格点默认值 / `PixelGenerator` 类型缝 / pixellab 客户端 / localStorage key 助手 |
| Create `app/utils/pixelGrid.ts` | 纯数学：纯度、相位、mode-decimate、整数裁切、门禁分析。**不 import DOM** |
| Create `app/utils/__tests__/pixelGrid.test.ts` | 上述纯函数的单测 |
| Create `app/api/pixel/route.ts` | 白名单薄代理（5 个 op）+ 请求体校验 + vendor 错误透传 |
| Create `app/api/pixel/__tests__/route.test.ts` | 只测校验路径（400/401）与图片代理的白名单（安全边界） |
| Create `app/components/PixelStudio.tsx` | 第六个 studio：表单 / 提交 / 轮询 / 徽章 / 入库 |
| Modify `app/lib/app.ts:54` | `Mode` 加 `'pixel'` |
| Modify `app/components/TopBar.tsx:82-86` | mode 列表加一条 |
| Modify `app/components/icons.tsx` | 加 `Pixel` 图标 |
| Modify `app/page.tsx` | import + 挂载 + 像素模式不渲染共享库面板 |
| Modify `app/lib/libraryCollect.ts` | `CollectedAsset` 带上 `backend`（来源必须被真实记录） |
| Modify `app/components/LibraryPanel.tsx` | 不再硬编码 `backend: 'openrouter'` |
| Modify `app/api/library/[[...path]]/route.ts` | 客户端 backend 走**白名单**（保住"不许伪造任意值"这条安全属性） |
| Modify `app/api/library/__tests__/route.test.ts` | 白名单两条用例 |

---

## Task 1: 常量、类型与生成器缝

**Files:**
- Create: `app/lib/pixel.ts`

- [ ] **Step 1: 写文件**

```ts
// app/lib/pixel.ts
/**
 * Everything the fork knows about pixel-art generators.
 *
 * Round 1 has exactly one implementation (`pixellab`). The `PixelGenerator`
 * type is a seam, not a framework: a second engine is a new module, not a
 * refactor. The types mirror the vendor's REST v2 shapes only where the UI
 * needs them.
 */

export const PIXEL_OPS = ['pixflux', 'character', 'characterStatus', 'balance', 'image'] as const
export type PixelOp = (typeof PIXEL_OPS)[number]

export function isPixelOp(value: unknown): value is PixelOp {
  return typeof value === 'string' && (PIXEL_OPS as readonly string[]).includes(value)
}

/** `image_size` bounds, verified against api.pixellab.ai/v2/openapi.json. */
export const PIXFLUX_MIN = 16
export const PIXFLUX_MAX = 400
export const V3_MIN = 32
export const V3_MAX = 256

/** Standard mode drives a fixed skeleton: the template beats the prompt. */
export const PIXEL_TEMPLATES = ['mannequin', 'bear', 'cat', 'dog', 'horse', 'lion'] as const
export type PixelTemplate = (typeof PIXEL_TEMPLATES)[number]

export const PIXEL_VIEWS = ['low top-down', 'high top-down', 'side'] as const
export type PixelView = (typeof PIXEL_VIEWS)[number]

export const PIXELLAB_BASE = 'https://api.pixellab.ai/v2'
export const PIXEL_KEY_HEADER = 'x-pixellab-key'

/**
 * Hosts the `image` op may proxy. Rotation URLs come back on a CDN host —
 * Task 13 prints the real one; add it here if the proxy answers 403.
 */
export const PIXEL_IMAGE_HOSTS = ['api.pixellab.ai', 'pixellab.ai']

export const PIXEL_KEY_STORAGE = 'extender:pixelKey'
export const PIXEL_PROJECT_STORAGE = 'extender:libraryProject'
export const PIXEL_BLOCK_STORAGE = 'extender:pixelBlock'
export const PIXEL_CELL_STORAGE = 'extender:pixelCell'

/** Browser-only key storage. Never sent anywhere except the proxy header. */
export function readPixelKey(): string {
  try {
    return localStorage.getItem(PIXEL_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function writePixelKey(key: string): void {
  try {
    localStorage.setItem(PIXEL_KEY_STORAGE, key)
  } catch {
    /* private mode: the key just does not persist */
  }
}

export function readStoredNumber(storageKey: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(storageKey)
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

export function writeStoredNumber(storageKey: string, value: number): void {
  try {
    localStorage.setItem(storageKey, String(value))
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Generator seam
// ---------------------------------------------------------------------------

export type PixfluxRequest = {
  description: string
  width: number
  height: number
  noBackground: boolean
  /** Optional palette reference image (data URL). */
  colorImage?: string | null
  seed?: number | null
}

export type CharacterRequest = {
  description: string
  template: PixelTemplate
  view: PixelView
  /** Square output size, V3_MIN..V3_MAX. Non-square results are padded by the vendor. */
  size: number
  seed?: number | null
}

export type PixelRotationUrls = {
  south: string
  west: string
  east: string
  north: string
  'south-east'?: string | null
  'north-east'?: string | null
  'south-west'?: string | null
  'north-west'?: string | null
}

export type PixelJob = {
  status: 'pending' | 'completed' | 'failed'
  /** Empty until status is 'completed'. */
  images: string[]
  /** e.g. "48x48" — measured, not requested. */
  size: string | null
}

export type PixelUsage = { usd: number | null; generations: number | null }

export type PixelGenerator = {
  id: 'pixellab'
  generateImage(req: PixfluxRequest, key: string): Promise<{ dataUrl: string; usage: PixelUsage | null }>
  createCharacter(req: CharacterRequest, key: string): Promise<{ characterId: string }>
  pollCharacter(id: string, key: string): Promise<PixelJob>
}

// ---------------------------------------------------------------------------
// The one implementation
// ---------------------------------------------------------------------------

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  return text.trim() || `HTTP ${res.status}`
}

async function proxy<T>(op: PixelOp, key: string, init: { body?: unknown; query?: string }): Promise<T> {
  const url = `/api/pixel?op=${op}${init.query ?? ''}`
  const res = await fetch(url, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: {
      [PIXEL_KEY_HEADER]: key,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as T
}

/** The vendor returns either a bare base64 blob or a full data URL. */
function toDataUrl(base64: string): string {
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`
}

export const pixellab: PixelGenerator = {
  id: 'pixellab',

  async generateImage(req: PixfluxRequest, key: string) {
    const data = await proxy<{ image: { base64: string }; usage?: { usd?: number | null; generations?: number | null } }>(
      'pixflux',
      key,
      {
        body: {
          description: req.description,
          width: req.width,
          height: req.height,
          no_background: req.noBackground,
          ...(req.colorImage ? { color_image: req.colorImage } : {}),
          ...(req.seed === null || req.seed === undefined ? {} : { seed: req.seed }),
        },
      },
    )
    return {
      dataUrl: toDataUrl(data.image.base64),
      usage: data.usage ? { usd: data.usage.usd ?? null, generations: data.usage.generations ?? null } : null,
    }
  },

  async createCharacter(req: CharacterRequest, key: string) {
    const data = await proxy<{ character_id: string }>('character', key, {
      body: {
        description: req.description,
        template_id: req.template,
        view: req.view,
        image_size: { width: req.size, height: req.size },
        no_background: true,
        ...(req.seed === null || req.seed === undefined ? {} : { seed: req.seed }),
      },
    })
    return { characterId: data.character_id }
  },

  async pollCharacter(id: string, key: string) {
    const data = await proxy<{
      status: 'pending' | 'completed' | 'failed'
      rotation_urls: PixelRotationUrls | null
      size: { width: number; height: number } | null
    }>('characterStatus', key, { query: `&id=${encodeURIComponent(id)}` })
    const urls = data.rotation_urls
    const images = urls
      ? [urls.south, urls['south-east'], urls.east, urls['north-east'], urls.north, urls['north-west'], urls.west, urls['south-west']]
          .filter((u): u is string => typeof u === 'string' && u.length > 0)
      : []
    return {
      status: data.status,
      images,
      size: data.size ? `${data.size.width}x${data.size.height}` : null,
    }
  },
}

export type PixelBalance = { usd: number; generations: number | null; total: number | null; plan: string | null }

export async function fetchBalance(key: string): Promise<PixelBalance> {
  const data = await proxy<{
    credits?: { usd?: number }
    subscription?: { generations?: number; total?: number; plan?: string }
  }>('balance', key, {})
  return {
    usd: data.credits?.usd ?? 0,
    generations: data.subscription?.generations ?? null,
    total: data.subscription?.total ?? null,
    plan: data.subscription?.plan ?? null,
  }
}

/** Same-origin URL that may be drawn into a canvas without tainting it. */
export function proxiedImageUrl(url: string): string {
  return `/api/pixel?op=image&url=${encodeURIComponent(url)}`
}
```


- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（`app/lib/pixel.ts` 目前无人 import，纯新增）

- [ ] **Step 3: 提交**

```bash
git add app/lib/pixel.ts
git commit -m "feat(pixel): add pixel generator constants, types and the pixellab client"
```

---

## Task 2: 纯度与相位（四相位搜索）

**Files:**
- Create: `app/utils/pixelGrid.ts`
- Test: `app/utils/__tests__/pixelGrid.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
// app/utils/__tests__/pixelGrid.test.ts
import { describe, expect, it } from 'vitest'
import { bestPhase, purityAt, type PixelBuffer, type RGBA } from '@/app/utils/pixelGrid'

const TRANSPARENT: RGBA = [0, 0, 0, 0]

function makeBuffer(width: number, height: number, fill: RGBA = TRANSPARENT): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4)
  return { data, width, height }
}

function setPx(buf: PixelBuffer, x: number, y: number, c: RGBA): void {
  buf.data.set(c, (y * buf.width + x) * 4)
}

/**
 * An 8x8 image whose logical 2x2 lattice starts at (1,1): nine distinct
 * blocks covering x,y in 1..6, transparent border elsewhere.
 * Only the (1,1) phase tiles it purely.
 */
function offsetLattice(): PixelBuffer {
  const buf = makeBuffer(8, 8)
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const c: RGBA = [40 + i * 40, 40 + j * 40, 128, 255]
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) setPx(buf, 1 + i * 2 + x, 1 + j * 2 + y, c)
    }
  }
  return buf
}

describe('purityAt', () => {
  it('scores the true lattice phase 1.0 and a shifted phase 0', () => {
    const buf = offsetLattice()
    expect(purityAt(buf, 2, 1, 1)).toBe(1)
    expect(purityAt(buf, 2, 0, 0)).toBe(0)
  })
})

describe('bestPhase', () => {
  it('finds the lattice offset instead of trusting (0,0)', () => {
    const best = bestPhase(offsetLattice(), 2)
    expect(best.ox).toBe(1)
    expect(best.oy).toBe(1)
    expect(best.purity).toBe(1)
  })

  it('reports a low score for a smooth image that has no lattice at all', () => {
    const smooth = makeBuffer(8, 8)
    let v = 0
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        v += 7
        setPx(smooth, x, y, [v % 256, 0, 0, 255])
      }
    }
    expect(bestPhase(smooth, 2).purity).toBeLessThan(0.95)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/utils/__tests__/pixelGrid.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/utils/pixelGrid"`

- [ ] **Step 3: 实现**

```ts
// app/utils/pixelGrid.ts
/**
 * Pure pixel-grid math. No DOM, no canvas: every function takes and returns
 * plain buffers so the whole module is testable in node.
 *
 * The corpus convention is a 2x2 block lattice on a 16-logical-pixel grid.
 * The block size is an INPUT, not something we detect: vendor output has 1px
 * grain, and an image with no 2x2 structure contains no evidence of "2".
 * What must be detected is the PHASE — the corpus lattice sits at (0, 1), and
 * measuring a single offset reports 0.55 on an image whose truth is 1.0000.
 */

export type RGBA = readonly [number, number, number, number]
export type PixelBuffer = { data: Uint8ClampedArray; width: number; height: number }

export const DEFAULT_BLOCK = 2
export const DEFAULT_CELL = 32
export const DEFAULT_FIGURE_BAND = { min: 24, max: 28 } as const
export const PURITY_THRESHOLD = 0.95

function px(buf: PixelBuffer, x: number, y: number): RGBA {
  const i = (y * buf.width + x) * 4
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]] as const
}

function same(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

/** Fraction of `block x block` tiles (at this phase) that are a single colour. */
export function purityAt(buf: PixelBuffer, block: number, ox: number, oy: number): number {
  let total = 0
  let impure = 0
  for (let by = oy; by + block <= buf.height; by += block) {
    for (let bx = ox; bx + block <= buf.width; bx += block) {
      total += 1
      const first = px(buf, bx, by)
      let pure = true
      for (let y = by; y < by + block && pure; y++) {
        for (let x = bx; x < bx + block; x++) {
          if (!same(px(buf, x, y), first)) {
            pure = false
            break
          }
        }
      }
      if (!pure) impure += 1
    }
  }
  return total === 0 ? 0 : 1 - impure / total
}

/** Best of all four phases. Never trust a single-offset measurement. */
export function bestPhase(buf: PixelBuffer, block: number): { ox: number; oy: number; purity: number } {
  let best = { ox: 0, oy: 0, purity: -1 }
  for (let oy = 0; oy < block; oy++) {
    for (let ox = 0; ox < block; ox++) {
      const purity = purityAt(buf, block, ox, oy)
      if (purity > best.purity) best = { ox, oy, purity }
    }
  }
  return best
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/utils/__tests__/pixelGrid.test.ts`
Expected: PASS，3 passed

- [ ] **Step 5: 提交**

```bash
git add app/utils/pixelGrid.ts app/utils/__tests__/pixelGrid.test.ts
git commit -m "feat(pixel): add four-phase purity detection"
```

---

## Task 3: mode-decimate

**Files:**
- Modify: `app/utils/pixelGrid.ts`
- Test: `app/utils/__tests__/pixelGrid.test.ts`

- [ ] **Step 1: 追加失败的测试**

```ts
// 追加到 app/utils/__tests__/pixelGrid.test.ts 末尾
import { decimateByMode } from '@/app/utils/pixelGrid'

describe('decimateByMode', () => {
  it('takes the block mode and never invents a colour', () => {
    const RED: RGBA = [200, 30, 30, 255]
    const BLUE: RGBA = [30, 30, 200, 255]
    const buf = makeBuffer(2, 2, RED)
    setPx(buf, 1, 1, BLUE) // 3 red, 1 blue
    const out = decimateByMode(buf, 2, 0, 0)
    expect(out.width).toBe(1)
    expect(out.height).toBe(1)
    expect(Array.from(out.data)).toEqual([...RED])
  })

  it('keeps the output colour set a subset of the input', () => {
    const buf = offsetLattice()
    const out = decimateByMode(buf, 2, 1, 1)
    const input = new Set<string>()
    for (let i = 0; i < buf.width * buf.height; i++) {
      input.add(buf.data.slice(i * 4, i * 4 + 4).join(','))
    }
    for (let i = 0; i < out.width * out.height; i++) {
      expect(input.has(out.data.slice(i * 4, i * 4 + 4).join(','))).toBe(true)
    }
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/utils/__tests__/pixelGrid.test.ts`
Expected: FAIL — `decimateByMode is not a function`

- [ ] **Step 3: 实现（追加到 pixelGrid.ts）**

```ts
/**
 * Mode of every `block x block` tile — never the average. Averaging also
 * reaches purity 1.0 but inflates the palette (measured 20 -> 54..73 colours).
 */
export function decimateByMode(buf: PixelBuffer, block: number, ox: number, oy: number): PixelBuffer {
  const width = Math.floor((buf.width - ox) / block)
  const height = Math.floor((buf.height - oy) / block)
  const out: PixelBuffer = { data: new Uint8ClampedArray(Math.max(width, 0) * Math.max(height, 0) * 4), width: Math.max(width, 0), height: Math.max(height, 0) }
  for (let by = 0; by < out.height; by++) {
    for (let bx = 0; bx < out.width; bx++) {
      const counts = new Map<string, { colour: RGBA; n: number }>()
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const colour = px(buf, ox + bx * block + x, oy + by * block + y)
          const key = colour.join(',')
          const hit = counts.get(key)
          if (hit) hit.n += 1
          else counts.set(key, { colour, n: 1 })
        }
      }
      let top: { colour: RGBA; n: number } | null = null
      // Array.from: this repo's tsconfig targets es5 without downlevelIteration (TS2802).
      for (const entry of Array.from(counts.values())) if (!top || entry.n > top.n) top = entry
      if (top) out.data.set(top.colour, (by * out.width + bx) * 4)
    }
  }
  return out
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/utils/__tests__/pixelGrid.test.ts`
Expected: PASS，5 passed

- [ ] **Step 5: 提交**

```bash
git add app/utils/pixelGrid.ts app/utils/__tests__/pixelGrid.test.ts
git commit -m "feat(pixel): add mode decimation"
```

---

## Task 4: 整数裁切（绝不缩放）

**Files:**
- Modify: `app/utils/pixelGrid.ts`
- Test: `app/utils/__tests__/pixelGrid.test.ts`

- [ ] **Step 1: 追加失败的测试**

```ts
// 追加到 app/utils/__tests__/pixelGrid.test.ts 末尾
import { cropToCell, isBackground } from '@/app/utils/pixelGrid'

/** A `w x h` opaque figure at (x, y) on a transparent canvas. */
function withFigure(canvas: number, x: number, y: number, w: number, h: number): PixelBuffer {
  const buf = makeBuffer(canvas, canvas)
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) setPx(buf, x + xx, y + yy, [90, 160, 90, 255])
  return buf
}

describe('cropToCell', () => {
  it('places the figure without changing its pixel size', () => {
    const src = withFigure(48, 10, 12, 26, 28)
    const res = cropToCell(src, { cell: 32, minFigureHeight: 24, maxFigureHeight: 28 })
    expect(res.image.width).toBe(32)
    expect(res.image.height).toBe(32)
    expect(res.figure).toEqual({ width: 26, height: 28 })
    expect(res.warnings).toEqual([])
    // bottom-aligned: last figure row is the last canvas row
    const lastRow = Array.from(res.image.data.slice((31 * 32 + 16) * 4, (31 * 32 + 16) * 4 + 4))
    expect(isBackground(lastRow as unknown as RGBA)).toBe(false)
  })

  it('throws rather than rescaling a figure that does not fit', () => {
    const src = withFigure(48, 4, 4, 40, 40)
    expect(() => cropToCell(src, { cell: 32 })).toThrow(/does not fit/)
  })

  it('warns when the figure height leaves the band, but still crops', () => {
    const src = withFigure(48, 10, 10, 20, 31)
    const res = cropToCell(src, { cell: 32, minFigureHeight: 24, maxFigureHeight: 28 })
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('31px')
    expect(res.figure).toEqual({ width: 20, height: 31 })
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/utils/__tests__/pixelGrid.test.ts`
Expected: FAIL — `cropToCell is not a function`

- [ ] **Step 3: 实现（追加到 pixelGrid.ts）**

```ts
/** Transparent or magenta: both mean "not the figure". */
export function isBackground(c: RGBA): boolean {
  return c[3] < 8 || (c[0] > 200 && c[1] < 80 && c[2] > 200)
}

function emptyBuffer(width: number, height: number): PixelBuffer {
  return { data: new Uint8ClampedArray(Math.max(width, 0) * Math.max(height, 0) * 4), width: Math.max(width, 0), height: Math.max(height, 0) }
}

/**
 * Place the figure into a `cell x cell` canvas, horizontally centred and
 * bottom-aligned. Integer pixels only: this function NEVER resamples. If the
 * figure is larger than the cell it throws — fix `image_size` so the figure is
 * born at the right height instead of shrinking a finished sprite.
 */
export function cropToCell(
  src: PixelBuffer,
  opts: { cell: number; minFigureHeight?: number; maxFigureHeight?: number },
): { image: PixelBuffer; figure: { width: number; height: number }; warnings: string[] } {
  let minX = src.width
  let minY = src.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (isBackground(px(src, x, y))) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) {
    return { image: emptyBuffer(opts.cell, opts.cell), figure: { width: 0, height: 0 }, warnings: ['no figure pixels found'] }
  }
  const figure = { width: maxX - minX + 1, height: maxY - minY + 1 }
  if (figure.width > opts.cell || figure.height > opts.cell) {
    throw new Error(
      `cropToCell: figure ${figure.width}x${figure.height} does not fit ${opts.cell}x${opts.cell}; change image_size instead of rescaling`,
    )
  }
  const warnings: string[] = []
  const band = `${opts.minFigureHeight}-${opts.maxFigureHeight}`
  if (opts.minFigureHeight !== undefined && figure.height < opts.minFigureHeight) {
    warnings.push(`figure ${figure.height}px below the ${band} band`)
  }
  if (opts.maxFigureHeight !== undefined && figure.height > opts.maxFigureHeight) {
    warnings.push(`figure ${figure.height}px above the ${band} band`)
  }
  const image = emptyBuffer(opts.cell, opts.cell)
  const dx = Math.floor((opts.cell - figure.width) / 2)
  const dy = opts.cell - figure.height
  for (let y = 0; y < figure.height; y++) {
    for (let x = 0; x < figure.width; x++) {
      image.data.set(px(src, minX + x, minY + y), ((dy + y) * opts.cell + dx + x) * 4)
    }
  }
  return { image, figure, warnings }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/utils/__tests__/pixelGrid.test.ts`
Expected: PASS，8 passed

- [ ] **Step 5: 提交**

```bash
git add app/utils/pixelGrid.ts app/utils/__tests__/pixelGrid.test.ts
git commit -m "feat(pixel): add integer-only crop-to-cell"
```

---

## Task 5: 门禁分析（低纯度不静默降级）

**Files:**
- Modify: `app/utils/pixelGrid.ts`
- Test: `app/utils/__tests__/pixelGrid.test.ts`

- [ ] **Step 1: 追加失败的测试**

```ts
// 追加到 app/utils/__tests__/pixelGrid.test.ts 末尾
import { analyzeGrid, PURITY_THRESHOLD } from '@/app/utils/pixelGrid'

describe('analyzeGrid', () => {
  it('passes a real lattice', () => {
    const res = analyzeGrid(offsetLattice(), 2)
    expect(res.ok).toBe(true)
    expect(res.ox).toBe(1)
    expect(res.oy).toBe(1)
    expect(res.purity).toBe(1)
  })

  it('refuses to call a smooth image decimatable', () => {
    const smooth = makeBuffer(16, 16)
    let v = 0
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { v += 11; setPx(smooth, x, y, [v % 256, 7, 9, 255]) }
    const res = analyzeGrid(smooth, 2)
    expect(res.ok).toBe(false)
    expect(res.purity).toBeLessThan(PURITY_THRESHOLD)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/utils/__tests__/pixelGrid.test.ts`
Expected: FAIL — `analyzeGrid is not a function`

- [ ] **Step 3: 实现（追加到 pixelGrid.ts）**

```ts
export type GridAnalysis = {
  ok: boolean
  block: number
  ox: number
  oy: number
  purity: number
  /** Diagnostic: distinguishes 1px-grain sources from already-blocky ones. */
  purityAtBlockOne: number
}

/**
 * Purity is a gate, not decoration. Below the threshold the caller must show
 * the measurement and ask a human instead of decimating quietly.
 */
export function analyzeGrid(buf: PixelBuffer, block: number = DEFAULT_BLOCK, threshold: number = PURITY_THRESHOLD): GridAnalysis {
  const best = bestPhase(buf, block)
  return {
    ok: best.purity >= threshold,
    block,
    ox: best.ox,
    oy: best.oy,
    purity: best.purity,
    purityAtBlockOne: purityAt(buf, 1, 0, 0),
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/utils/__tests__/pixelGrid.test.ts`
Expected: PASS，10 passed

- [ ] **Step 5: 提交**

```bash
git add app/utils/pixelGrid.ts app/utils/__tests__/pixelGrid.test.ts
git commit -m "feat(pixel): add grid gate analysis"
```

---

## Task 6: `/api/pixel` 薄代理

**Files:**
- Create: `app/api/pixel/route.ts`
- Test: `app/api/pixel/__tests__/route.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
// app/api/pixel/__tests__/route.test.ts
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '../route'
import { PIXEL_KEY_HEADER } from '@/app/lib/pixel'

function post(body: unknown, key: string | null = 'k') {
  const headers = key === null ? {} : { [PIXEL_KEY_HEADER]: key }
  return new NextRequest(new URL('/api/pixel', 'http://localhost:3000'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  } as never)
}

function get(query: string, key: string | null = 'k') {
  const headers = key === null ? {} : { [PIXEL_KEY_HEADER]: key }
  return new NextRequest(new URL(`/api/pixel?${query}`, 'http://localhost:3000'), { headers } as never)
}

describe('/api/pixel', () => {
  it('rejects a missing key before doing anything else', async () => {
    const res = await POST(post({ op: 'pixflux', description: 'x' }, null))
    expect(res.status).toBe(401)
  })

  it('rejects an op that is not on the allow-list', async () => {
    for (const op of ['/v2/balance', '../x', 'balance?', 'nope', '']) {
      const res = await POST(post({ op, description: 'x' }))
      expect(res.status).toBe(400)
    }
  })

  it('rejects a GET op that is not on the allow-list', async () => {
    const res = await GET(get('op=create-image-pixflux'))
    expect(res.status).toBe(400)
  })

  it('rejects a pixflux body with no description, without calling the vendor', async () => {
    const res = await POST(post({ op: 'pixflux' }))
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('description')
  })

  it('rejects an out-of-range size', async () => {
    const res = await POST(post({ op: 'pixflux', description: 'x', width: 8, height: 8 }))
    expect(res.status).toBe(400)
  })

  it('refuses to proxy an image from a host that is not the vendor', async () => {
    const res = await GET(get('op=image&url=' + encodeURIComponent('https://evil.example/x.png')))
    expect(res.status).toBe(403)
  })

  it('refuses a non-https image url', async () => {
    const res = await GET(get('op=image&url=' + encodeURIComponent('http://api.pixellab.ai/x.png')))
    expect(res.status).toBe(400)
  })

  it('validates the characterStatus id', async () => {
    const res = await GET(get('op=characterStatus&id=../../etc/passwd'))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/api/pixel/__tests__/route.test.ts`
Expected: FAIL — `Failed to resolve import "../route"`

- [ ] **Step 3: 实现**

```ts
// app/api/pixel/route.ts
import { NextRequest, NextResponse } from 'next/server'
import {
  isPixelOp,
  PIXEL_IMAGE_HOSTS,
  PIXEL_KEY_HEADER,
  PIXELLAB_BASE,
  PIXFLUX_MAX,
  PIXFLUX_MIN,
  PIXEL_TEMPLATES,
  PIXEL_VIEWS,
  V3_MAX,
  V3_MIN,
} from '@/app/lib/pixel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CHARACTER_ID = /^[A-Za-z0-9_-]{1,64}$/

const json = (body: unknown, status: number) => NextResponse.json(body, { status })

function pickKey(request: NextRequest): string | null {
  const key = request.headers.get(PIXEL_KEY_HEADER)
  return key && key.trim().length > 0 ? key.trim() : null
}

/** The vendor has no error-body contract (401/402/422/429/529 are bodyless):
 *  pass the status and the raw text through, never invent a shape. */
async function relay(res: Response): Promise<NextResponse> {
  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  })
}

type IntResult = { ok: true; value: number | null } | { ok: false }

/** `undefined` means "not provided" (null); anything malformed is a rejection. */
function integerOrNull(value: unknown, min: number, max: number): IntResult {
  if (value === undefined) return { ok: true, value: null }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return { ok: false }
  return { ok: true, value }
}

function buildPixflux(input: Record<string, unknown>): { ok: true; body: unknown } | { ok: false; error: string } {
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!description) return { ok: false, error: 'description is required' }
  const width = integerOrNull(input.width, PIXFLUX_MIN, PIXFLUX_MAX)
  const height = integerOrNull(input.height, PIXFLUX_MIN, PIXFLUX_MAX)
  if (!width.ok || !height.ok) {
    return { ok: false, error: `width/height must be integers in ${PIXFLUX_MIN}..${PIXFLUX_MAX}` }
  }
  return {
    ok: true,
    body: {
      description,
      ...(width.value === null || height.value === null ? {} : { image_size: { width: width.value, height: height.value } }),
      ...(typeof input.no_background === 'boolean' ? { no_background: input.no_background } : {}),
      ...(typeof input.color_image === 'string' ? { color_image: input.color_image } : {}),
      ...(typeof input.seed === 'number' && Number.isInteger(input.seed) ? { seed: input.seed } : {}),
    },
  }
}

function buildCharacter(input: Record<string, unknown>): { ok: true; body: unknown } | { ok: false; error: string } {
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!description) return { ok: false, error: 'description is required' }
  const size = integerOrNull(input.image_size, V3_MIN, V3_MAX)
  if (!size.ok) return { ok: false, error: `image_size must be an integer in ${V3_MIN}..${V3_MAX}` }
  const template = input.template_id
  if (template !== undefined && !(PIXEL_TEMPLATES as readonly unknown[]).includes(template)) {
    return { ok: false, error: `template_id must be one of ${PIXEL_TEMPLATES.join(', ')}` }
  }
  const view = input.view
  if (view !== undefined && !(PIXEL_VIEWS as readonly unknown[]).includes(view)) {
    return { ok: false, error: `view must be one of ${PIXEL_VIEWS.join(', ')}` }
  }
  return {
    ok: true,
    body: {
      description,
      no_background: true,
      ...(size.value === null ? {} : { image_size: { width: size.value, height: size.value } }),
      ...(template === undefined ? {} : { template_id: template }),
      ...(view === undefined ? {} : { view }),
      ...(typeof input.seed === 'number' && Number.isInteger(input.seed) ? { seed: input.seed } : {}),
    },
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const key = pickKey(request)
  if (!key) return json({ error: `missing ${PIXEL_KEY_HEADER}` }, 401)

  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  const op = payload.op
  if (!isPixelOp(op) || (op !== 'pixflux' && op !== 'character')) {
    return json({ error: 'unknown op' }, 400)
  }

  const built = op === 'pixflux' ? buildPixflux(payload) : buildCharacter(payload)
  if (!built.ok) return json({ error: built.error }, 400)

  const path = op === 'pixflux' ? '/create-image-pixflux' : '/create-character-v3'
  const res = await fetch(`${PIXELLAB_BASE}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(built.body),
  })
  return relay(res)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const key = pickKey(request)
  if (!key) return json({ error: `missing ${PIXEL_KEY_HEADER}` }, 401)

  const op = request.nextUrl.searchParams.get('op')
  if (!isPixelOp(op) || op === 'pixflux' || op === 'character') {
    return json({ error: 'unknown op' }, 400)
  }

  if (op === 'characterStatus') {
    const id = request.nextUrl.searchParams.get('id') ?? ''
    if (!CHARACTER_ID.test(id)) return json({ error: 'invalid character id' }, 400)
    const res = await fetch(`${PIXELLAB_BASE}/characters/${id}`, {
      headers: { authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    return relay(res)
  }

  if (op === 'balance') {
    const res = await fetch(`${PIXELLAB_BASE}/balance`, {
      headers: { authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    return relay(res)
  }

  // op === 'image': same-origin proxy so a canvas can read the pixels.
  const raw = request.nextUrl.searchParams.get('url') ?? ''
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return json({ error: 'invalid url' }, 400)
  }
  if (target.protocol !== 'https:') return json({ error: 'https only' }, 400)
  const allowed = PIXEL_IMAGE_HOSTS.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`))
  if (!allowed) return json({ error: `host ${target.hostname} is not a vendor host` }, 403)

  const res = await fetch(target.toString(), { cache: 'no-store' })
  if (!res.ok) return json({ error: `upstream ${res.status}` }, 502)
  return new NextResponse(await res.arrayBuffer(), {
    status: 200,
    headers: { 'content-type': res.headers.get('content-type') ?? 'image/png' },
  })
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/api/pixel/__tests__/route.test.ts`
Expected: PASS，8 passed（全部是校验路径，不发真实请求）

- [ ] **Step 5: 提交**

```bash
git add app/api/pixel/route.ts app/api/pixel/__tests__/route.test.ts
git commit -m "feat(pixel): add allow-listed BYOK proxy for the pixellab API"
```

---

## Task 7: PixelStudio 骨架（表单 + key + 余额 + pixflux 提交）

**Files:**
- Create: `app/components/PixelStudio.tsx`

- [ ] **Step 1: 写文件**

```tsx
// app/components/PixelStudio.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_BLOCK,
  DEFAULT_CELL,
  DEFAULT_FIGURE_BAND,
  PIXEL_VIEWS,
  PIXEL_TEMPLATES,
  PIXEL_BLOCK_STORAGE,
  PIXEL_CELL_STORAGE,
  PIXEL_PROJECT_STORAGE,
  fetchBalance,
  pixellab,
  readPixelKey,
  readStoredNumber,
  writePixelKey,
  writeStoredNumber,
  type PixelBalance,
  type PixelTemplate,
  type PixelView,
} from '@/app/lib/pixel'
import { type GridAnalysis, type PixelBuffer } from '@/app/utils/pixelGrid'
// Task 8 会往这一行补 analyzeGrid / cropToCell / decimateByMode —— 本任务还不使用它们，先不要提前 import。

type SubMode = 'stills' | 'character'
type StillKind = 'tiles' | 'props'

type Candidate = {
  id: string
  label: string
  sourceUrl: string
  analysis: GridAnalysis | null
  processedUrl: string | null
  figure: { width: number; height: number } | null
  warnings: string[]
}

/** Browser-only glue: decode an image into a plain buffer. */
async function loadPixels(url: string): Promise<PixelBuffer> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`could not load ${url}`))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: data.data, width: data.width, height: data.height }
}

/** Browser-only glue: buffers back to a PNG data URL. */
function pixelsToDataUrl(buf: PixelBuffer): string {
  const canvas = document.createElement('canvas')
  canvas.width = buf.width
  canvas.height = buf.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  const image = new ImageData(new Uint8ClampedArray(buf.data), buf.width, buf.height)
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

export function PixelStudio() {
  const [sub, setSub] = useState<SubMode>('stills')
  const [stillKind, setStillKind] = useState<StillKind>('tiles')
  const [description, setDescription] = useState('')
  const [width, setWidth] = useState(64)
  const [height, setHeight] = useState(64)
  const [noBackground, setNoBackground] = useState(true)
  const [template, setTemplate] = useState<PixelTemplate>('mannequin')
  const [view, setView] = useState<PixelView>('high top-down')
  const [size, setSize] = useState(64)
  const [block, setBlock] = useState(() => readStoredNumber(PIXEL_BLOCK_STORAGE, DEFAULT_BLOCK))
  const [cell, setCell] = useState(() => readStoredNumber(PIXEL_CELL_STORAGE, DEFAULT_CELL))
  const [key, setKey] = useState('')
  const [balance, setBalance] = useState<PixelBalance | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showProcessed, setShowProcessed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setKey(readPixelKey())
  }, [])

  useEffect(() => {
    writeStoredNumber(PIXEL_BLOCK_STORAGE, block)
  }, [block])

  useEffect(() => {
    writeStoredNumber(PIXEL_CELL_STORAGE, cell)
  }, [cell])

  const rememberKey = (value: string) => {
    setKey(value)
    writePixelKey(value)
  }

  const refreshBalance = useCallback(async () => {
    if (!key) return
    try {
      setBalance(await fetchBalance(key))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'balance failed')
    }
  }, [key])

  const submit = async () => {
    setError(null)
    if (!key) {
      setError('Paste your PixelLab key first.')
      return
    }
    if (!description.trim()) {
      setError('Describe what to draw.')
      return
    }
    setBusy('Submitting…')
    try {
      const { dataUrl } = await pixellab.generateImage(
        { description, width, height, noBackground, seed: null },
        key,
      )
      setCandidates((prev) => [
        { id: `${Date.now()}`, label: description.slice(0, 40), sourceUrl: dataUrl, analysis: null, processedUrl: null, figure: null, warnings: [] },
        ...prev,
      ])
      void refreshBalance()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generation failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="password"
          value={key}
          onChange={(e) => rememberKey(e.target.value)}
          placeholder="PixelLab API key"
          className="w-64 rounded bg-white/5 px-2 py-1 text-xs"
        />
        <button type="button" onClick={() => void refreshBalance()} className="rounded bg-white/10 px-2 py-1 text-xs">
          Check balance
        </button>
        {balance && (
          <span className="text-xs text-white/60">
            {balance.plan ?? 'no plan'} · {balance.generations ?? '—'} / {balance.total ?? '—'} generations · ${balance.usd}
          </span>
        )}
      </div>

      <div className="flex gap-2 text-xs">
        {(['stills', 'character'] as SubMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSub(m)}
            className={`rounded px-2 py-1 ${sub === m ? 'bg-white/20' : 'bg-white/5'}`}
          >
            {m === 'stills' ? 'Tiles & props' : 'Character'}
          </button>
        ))}
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="mossy cobblestone, top-down, 12 colours"
        className="h-20 w-full rounded bg-white/5 px-2 py-1 text-xs"
      />

      {sub === 'stills' ? (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <select value={stillKind} onChange={(e) => setStillKind(e.target.value as StillKind)} className="rounded bg-white/5 px-2 py-1">
            <option value="tiles">Tiles</option>
            <option value="props">Props</option>
          </select>
          <label>
            W{' '}
            <input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} className="w-16 rounded bg-white/5 px-1" />
          </label>
          <label>
            H{' '}
            <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} className="w-16 rounded bg-white/5 px-1" />
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={noBackground} onChange={(e) => setNoBackground(e.target.checked)} />
            no background
          </label>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <select value={template} onChange={(e) => setTemplate(e.target.value as PixelTemplate)} className="rounded bg-white/5 px-2 py-1">
            {PIXEL_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={view} onChange={(e) => setView(e.target.value as PixelView)} className="rounded bg-white/5 px-2 py-1">
            {PIXEL_VIEWS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <label>
            size{' '}
            <input type="number" value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-16 rounded bg-white/5 px-1" />
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label>
          block{' '}
          <input type="number" value={block} onChange={(e) => setBlock(Math.max(1, Number(e.target.value)))} className="w-14 rounded bg-white/5 px-1" />
        </label>
        <label>
          cell{' '}
          <input type="number" value={cell} onChange={(e) => setCell(Math.max(8, Number(e.target.value)))} className="w-14 rounded bg-white/5 px-1" />
        </label>
        <button type="button" onClick={() => void submit()} disabled={busy !== null} className="rounded bg-white/10 px-3 py-1">
          {busy ?? 'Generate'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {candidates.map((c) => (
          <div key={c.id} className="rounded border border-white/10 p-2">
            <img src={showProcessed[c.id] && c.processedUrl ? c.processedUrl : c.sourceUrl} alt={c.label} className="w-full [image-rendering:pixelated]" />
            <p className="mt-1 truncate text-[10px] text-white/60">{c.label}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-white/40">
        Figure band {DEFAULT_FIGURE_BAND.min}-{DEFAULT_FIGURE_BAND.max}px on a {cell}px cell.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。**若报 `PixelStudio` 未被使用**——它在 Task 12 才挂载，tsc 不报未使用的导出，可忽略。

- [ ] **Step 3: 提交**

```bash
git add app/components/PixelStudio.tsx
git commit -m "feat(pixel): add PixelStudio shell with pixflux generation"
```

---

## Task 8: 探格点徽章 + decimate/裁切预览

**Files:**
- Modify: `app/components/PixelStudio.tsx`

- [ ] **Step 1: 加处理函数**

先把导入补齐（Task 7 刻意只留了类型）：

```tsx
import { analyzeGrid, cropToCell, decimateByMode } from '@/app/utils/pixelGrid'
```

在 `submit` 之前插入：

```tsx
  /** Analyse a source image; decimate + crop when the gate passes. */
  const process = useCallback(
    async (candidate: Candidate, force = false) => {
      const apply = async (buf: PixelBuffer) => {
        const analysis = analyzeGrid(buf, block)
        const shouldApply = force || analysis.ok
        let processedUrl: string | null = null
        let figure: { width: number; height: number } | null = null
        let warnings: string[] = []
        if (shouldApply) {
          const decimated = decimateByMode(buf, analysis.block, analysis.ox, analysis.oy)
          try {
            const cropped = cropToCell(decimated, {
              cell,
              minFigureHeight: DEFAULT_FIGURE_BAND.min,
              maxFigureHeight: DEFAULT_FIGURE_BAND.max,
            })
            processedUrl = pixelsToDataUrl(cropped.image)
            figure = cropped.figure
            warnings = cropped.warnings
          } catch (err) {
            warnings = [err instanceof Error ? err.message : 'crop failed']
          }
        }
        setCandidates((prev) =>
          prev.map((x) => (x.id === candidate.id ? { ...x, analysis, processedUrl, figure, warnings } : x)),
        )
      }
      try {
        const buf = await loadPixels(candidate.sourceUrl)
        await apply(buf)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'could not read the image')
      }
    },
    [block, cell],
  )
```

- [ ] **Step 2: 在提交成功后自动处理**

把 `submit` 里的

```tsx
      setCandidates((prev) => [
        { id: `${Date.now()}`, label: description.slice(0, 40), sourceUrl: dataUrl, analysis: null, processedUrl: null, figure: null, warnings: [] },
        ...prev,
      ])
```

改成：

```tsx
      const candidate: Candidate = {
        id: `${Date.now()}`,
        label: description.slice(0, 40),
        sourceUrl: dataUrl,
        analysis: null,
        processedUrl: null,
        figure: null,
        warnings: [],
      }
      setCandidates((prev) => [candidate, ...prev])
      await process(candidate)
```

- [ ] **Step 3: 加徽章与切换**

把渲染候选的那段 `<div key={c.id} …>` 整块替换为：

```tsx
          <div key={c.id} className="rounded border border-white/10 p-2">
            <img
              src={showProcessed[c.id] && c.processedUrl ? c.processedUrl : c.sourceUrl}
              alt={c.label}
              className="w-full [image-rendering:pixelated]"
            />
            <p className="mt-1 truncate text-[10px] text-white/60">{c.label}</p>
            {c.analysis && (
              <p className={`mt-1 text-[10px] ${c.analysis.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                block={c.analysis.block} phase=({c.analysis.ox},{c.analysis.oy}) purity={c.analysis.purity.toFixed(4)}
                {c.analysis.ok ? ' ✓' : ' ✗ 未通过格点检测'}
              </p>
            )}
            {c.figure && (
              <p className="text-[10px] text-white/40">
                figure {c.figure.width}x{c.figure.height}
              </p>
            )}
            {c.warnings.map((w) => (
              <p key={w} className="text-[10px] text-amber-400">
                {w}
              </p>
            ))}
            <div className="mt-1 flex gap-1">
              <button
                type="button"
                onClick={() => setShowProcessed((s) => ({ ...s, [c.id]: !s[c.id] }))}
                disabled={!c.processedUrl}
                className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] disabled:opacity-40"
              >
                {showProcessed[c.id] ? 'source' : 'processed'}
              </button>
              {c.analysis && !c.analysis.ok && (
                <button
                  type="button"
                  onClick={() => void process(c, true)}
                  className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px]"
                >
                  仍然施加
                </button>
              )}
            </div>
          </div>
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add app/components/PixelStudio.tsx
git commit -m "feat(pixel): show the grid badge and the decimated preview"
```

---

## Task 9: 角色子模式（生成 + 轮询 + 8 方向）

**Files:**
- Modify: `app/components/PixelStudio.tsx`

- [ ] **Step 1: 加轮询常量与生成函数**

在 `refreshBalance` 之后插入：

```tsx
  const POLL_EVERY_MS = 5000
  const POLL_LIMIT_MS = 10 * 60 * 1000

  const generateCharacter = async () => {
    setError(null)
    if (!key) {
      setError('粘贴 PixelLab key。')
      return
    }
    if (!description.trim()) {
      setError('先描述这个角色。')
      return
    }
    setBusy('提交角色（8 方向，约 2–5 分钟）…')
    let characterId: string
    try {
      const created = await pixellab.createCharacter({ description, template, view, size, seed: null }, key)
      characterId = created.characterId
    } catch (err) {
      setError(err instanceof Error ? err.message : 'character submit failed')
      setBusy(null)
      return
    }

    const startedAt = Date.now()
    try {
      for (;;) {
        const job = await pixellab.pollCharacter(characterId, key)
        if (job.status === 'failed') {
          setError(`角色生成失败（character_id=${characterId}）；不会自动重试。`)
          return
        }
        if (job.status === 'completed' && job.images.length > 0) {
          const made: Candidate[] = job.images.map((url, i) => ({
            id: `${characterId}-${i}`,
            label: `${description.slice(0, 24)} #${i}`,
            sourceUrl: proxiedImageUrl(url),
            analysis: null,
            processedUrl: null,
            figure: null,
            warnings: [],
          }))
          setCandidates((prev) => [...made, ...prev])
          for (const candidate of made) await process(candidate)
          void refreshBalance()
          return
        }
        if (Date.now() - startedAt > POLL_LIMIT_MS) {
          setError(`轮询超时（10 分钟）。character_id=${characterId} —— 用“再查一次”继续，不要重新提交。`)
          return
        }
        await new Promise((r) => setTimeout(r, POLL_EVERY_MS))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'polling failed')
    } finally {
      setBusy(null)
    }
  }
```

并在 import 里补 `proxiedImageUrl`：

```tsx
  proxiedImageUrl,
```

- [ ] **Step 2: 让按钮按子模式分派**

把 `Generate` 按钮的

```tsx
        <button type="button" onClick={() => void submit()} disabled={busy !== null} className="rounded bg-white/10 px-3 py-1">
          {busy ?? 'Generate'}
        </button>
```

改为：

```tsx
        <button
          type="button"
          onClick={() => void (sub === 'stills' ? submit() : generateCharacter())}
          disabled={busy !== null}
          className="rounded bg-white/10 px-3 py-1"
        >
          {busy ?? (sub === 'stills' ? 'Generate' : 'Generate character (8 dirs)')}
        </button>
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add app/components/PixelStudio.tsx
git commit -m "feat(pixel): add the character sub-mode with polling"
```

---

## Task 10: 入库（自建 CollectedAsset + 面板）

**Files:**
- Modify: `app/components/PixelStudio.tsx`

**前置检查：** 运行 `grep -n "LibraryPanel" app/components/LibraryPanel.tsx app/page.tsx` 与 `ls app/lib/libraryClient.ts`。**若任一缺失，资产库计划（Task 8/9）还没落地 → 停下，先完成它。**

- [ ] **Step 1: 加 import 与项目名状态**

```tsx
import { LibraryPanel } from '@/app/components/LibraryPanel'
import type { CollectedAsset } from '@/app/lib/libraryCollect'
```

在组件内加：

```tsx
  const [project, setProject] = useState('')
  useEffect(() => {
    try {
      setProject(localStorage.getItem(PIXEL_PROJECT_STORAGE) ?? 'default')
    } catch {
      setProject('default')
    }
  }, [])

  useEffect(() => {
    if (!project) return
    try {
      localStorage.setItem(PIXEL_PROJECT_STORAGE, project)
    } catch {
      /* ignore */
    }
  }, [project])
```

- [ ] **Step 2: 加收集函数**

在 `generateCharacter` 之后插入：

```tsx
  /** Only candidates with a processed image can be saved. */
  const collect = useCallback((): CollectedAsset | null => {
    const ready = candidates.filter((c) => c.processedUrl)
    if (ready.length === 0) return null
    const kind = sub === 'character' ? 'sprites' : stillKind
    const files: Record<string, string> = {}
    const first = ready[0]
    files['raw/source.png'] = first.sourceUrl
    ready.forEach((c, i) => {
      const name = sub === 'character' ? `dir_${String(i).padStart(2, '0')}.png` : 'cell.png'
      files[`derived/${name}`] = c.processedUrl as string
    })
    return {
      kind,
      files,
      manifest: null,
      provenance: {
        backend: 'pixellab',
        model: sub === 'character' ? 'create-character-v3' : 'create-image-pixflux',
        prompt: description || null,
        sceneBrief: null,
        artStyle: null,
        params: sub === 'character' ? { template, view, size } : { width, height, no_background: noBackground, block, cell },
        requested: sub === 'character' ? `${size}x${size}` : `${width}x${height}`,
        returned: first.figure ? `${first.figure.width}x${first.figure.height}` : null,
        cost: null,
      },
    }
  }, [candidates, sub, stillKind, description, template, view, size, width, height, noBackground, block, cell])
```

- [ ] **Step 3: 渲染面板**

在组件返回的最外层 `<div className="space-y-4 text-sm">` 内、末尾加：

```tsx
      <div className="rounded border border-white/10 p-2">
        <p className="mb-2 text-xs text-white/60">
          保存到资产库（成品才会入库；source 原图存进 raw/）
        </p>
        <LibraryPanel
          pending={async () => collect()}
          project={project}
          onProjectChange={setProject}
          onSaved={() => setCandidates([])}
        />
      </div>
```

**注意：** `LibraryPanel` 的 props 以 `app/components/LibraryPanel.tsx` 实际导出为准。执行前先读那个文件的前 40 行；若签名不同（例如项目名回调叫别的名字），按实际签名调整这四行，**不要改面板本身**。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add app/components/PixelStudio.tsx
git commit -m "feat(pixel): save decimated assets into the library"
```

---

## Task 11: 让 `/api/library` 记录真实来源（白名单）

**Files:**
- Modify: `app/lib/libraryCollect.ts`（`CollectedAsset` 带上 `backend`）
- Modify: `app/components/LibraryPanel.tsx`（不再硬编码 `openrouter`）
- Modify: `app/api/library/[[...path]]/route.ts`（客户端值走白名单）
- Test: `app/api/library/__tests__/route.test.ts`

**为什么必须做：** 现在路由第 122 行是 `backend: process.env.IE_BACKEND_LABEL || 'openrouter'` —— 像素资产会被记成 `openrouter`，而资产库 spec §2.3 的成功标准是"后端可追溯"。改成白名单后，客户端只能从已知标签里选，**不能伪造任意值**（原来的安全属性保住）。

- [ ] **Step 1: 追加失败的测试**

在 `app/api/library/__tests__/route.test.ts` 的 describe 内追加：

```ts
  it('honours a known backend label from the client', async () => {
    const meta2 = { ...meta, provenance: { ...meta.provenance, backend: 'pixellab' } }
    const res = await POST(
      req('/api/library', {
        method: 'POST',
        body: JSON.stringify({ project: 'dungeon', kind: 'tiles', slug: 'pixel-tile', meta: meta2, files: { 'derived/body.png': PNG } }),
      }),
    )
    expect(res.status).toBe(201)
    const saved = await readMeta('dungeon', 'tiles', 'pixel-tile')
    expect(saved.provenance.backend).toBe('pixellab')
  })

  it('falls back to openrouter for an unknown backend label', async () => {
    const meta2 = { ...meta, provenance: { ...meta.provenance, backend: 'evil' } }
    const res = await POST(
      req('/api/library', {
        method: 'POST',
        body: JSON.stringify({ project: 'dungeon', kind: 'tiles', slug: 'forged', meta: meta2, files: { 'derived/body.png': PNG } }),
      }),
    )
    expect(res.status).toBe(201)
    const saved = await readMeta('dungeon', 'tiles', 'forged')
    expect(saved.provenance.backend).toBe('openrouter')
  })
```

并在该文件顶部 import 里补 `readMeta`（从 `@/app/lib/library` 导入；若实际导出名不同，以 `grep -n "export async function readMeta" app/lib/library.ts` 为准）。

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- app/api/library/__tests__/route.test.ts`
Expected: 第一条 FAIL（`received "openrouter"`）

- [ ] **Step 3: 实现**

`app/lib/libraryCollect.ts`：把

```ts
export type CollectedAsset = {
  kind: AssetKind
  files: Record<string, string>
  manifest: Record<string, unknown> | null
  provenance: Omit<Provenance, 'backend' | 'toolVersion'>
}
```

改成

```ts
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
```

并把 `base()` 的返回值加上 `backend: 'openrouter'`（五个 studio 现在都走 OpenRouter 代理）：

```ts
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
```

`app/components/LibraryPanel.tsx`：把

```tsx
      provenance: { ...collected.provenance, backend: 'openrouter', toolVersion: 'web' },
```

改成

```tsx
      provenance: { ...collected.provenance, toolVersion: 'web' },
```

`app/api/library/[[...path]]/route.ts`：把

```ts
      backend: process.env.IE_BACKEND_LABEL || 'openrouter',
```

改成

```ts
      backend: process.env.IE_BACKEND_LABEL || pickBackendLabel(meta?.provenance?.backend),
```

并在同一文件顶部加：

```ts
import { BACKEND_LABELS } from '@/app/lib/libraryCollect'

/** A client may only propose a label we already know — never a free-form string. */
function pickBackendLabel(value: unknown): string {
  return typeof value === 'string' && (BACKEND_LABELS as readonly string[]).includes(value) ? value : 'openrouter'
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- app/api/library/__tests__/route.test.ts`
Expected: PASS（含新增两条）

- [ ] **Step 5: 全量测试 + 提交**

Run: `npm test`
Expected: 全绿（资产库既有用例不受影响）

```bash
git add app/lib/libraryCollect.ts app/components/LibraryPanel.tsx "app/api/library/[[...path]]/route.ts" app/api/library/__tests__/route.test.ts
git commit -m "feat(library): record the real backend label via an allow-list"
```

---

## Task 12: 挂载（Mode / TopBar / 图标 / page.tsx）

**Files:**
- Modify: `app/lib/app.ts:54`
- Modify: `app/components/icons.tsx`
- Modify: `app/components/TopBar.tsx:82-86`
- Modify: `app/page.tsx`

- [ ] **Step 1: 扩 Mode**

`app/lib/app.ts:54`：

```ts
export type Mode = 'extender' | 'parallax' | 'tile' | 'sprite' | 'props' | 'pixel'
```

- [ ] **Step 2: 加图标**

在 `app/components/icons.tsx` 里任意相邻图标之后插入（保持文件既有的 `svg(...)` 写法）：

```tsx
  Pixel: svg(
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>,
  ),
```

- [ ] **Step 3: 加 mode 条目**

`app/components/TopBar.tsx` 的 mode 列表里（`sprite` 之后）加：

```tsx
    { value: 'pixel', label: 'Pixel', Icon: Icons.Pixel, hint: 'True pixel-art grid' },
```

- [ ] **Step 4: 挂载 + 让共享面板让位**

`app/page.tsx`：

1. import（与既有 studio import 同区）：

```tsx
import { PixelStudio } from '@/app/components/PixelStudio'
```

2. 在现有 `<ParallaxStudio … />` 之后加：

```tsx
        {mode === 'pixel' && <PixelStudio />}
```

3. 找到渲染 `<LibraryPanel` 的那一行（资产库计划 Task 9），给它加条件：

```tsx
        {mode !== 'pixel' && <LibraryPanel … />}
```

- [ ] **Step 5: 类型检查 + 构建**

Run: `npx tsc --noEmit && npm run lint`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add app/lib/app.ts app/components/icons.tsx app/components/TopBar.tsx app/page.tsx
git commit -m "feat(pixel): mount the pixel studio as the sixth mode"
```

---

## Task 13: 真实 smoke + 阈值校准 + 收尾

**Files:**
- 可能 Modify: `app/utils/pixelGrid.ts`（`PURITY_THRESHOLD`）
- 可能 Modify: `app/lib/pixel.ts`（`PIXEL_IMAGE_HOSTS`）

- [ ] **Step 1: 起 dev server 并走一遍真实流程**

```bash
npm run dev
```

在浏览器里（`http://localhost:3000`）：
1. 顶部切到 **Pixel**，粘贴 PixelLab key，点 **Check balance** → 应显示 `Tier 1 · 1437 / 2000`
2. 选 **Tiles & props**，描述填 `mossy cobblestone, top-down, 12 colours`，W/H = 64 → Generate
3. 图回来后读**徽章数字**，把它抄进下一步
4. 选 **Character**，template `mannequin`，view `high top-down`，size 64 → Generate character
5. 轮询期间应停在 `提交角色（8 方向…）`；完成后应出现 **8 张**候选，每张都有徽章

- [ ] **Step 2: 记录真实阈值（这是 spec §12 风险点 1 的收口）**

把 Step 1.3 与 1.5 实测到的 purity 抄进 spec 的 §12：

```bash
# 用实测值替换 <purity-stills> / <purity-character>
python3 - <<'PY'
import re, pathlib
p = pathlib.Path('docs/superpowers/specs/2026-10-05-pixel-art-line-design.md')
s = p.read_text()
s = s.replace('实现时必须先拿真实输出量一次，再定 0.95 这个阈值是否合适。',
              '实测（2026-10-05，TileStudio / CharacterStudio 各一次真实生成）：tiles purity=<purity-stills>，character 8 方向 purity 区间=[<purity-character>]。阈值 0.95 保持不变/调整为 <final>。')
p.write_text(s)
PY
```

若实测 purity 全部 < 0.95（即门禁会拦下所有真实输出），**把 `PURITY_THRESHOLD` 调到实测最小值再减 0.05**，并在提交信息里写明为什么。

- [ ] **Step 3: 确认图片代理主机名**

若 Step 1.5 的候选图显示为破图（403），从浏览器网络面板复制真实的 rotation host，加进 `app/lib/pixel.ts`：

```ts
export const PIXEL_IMAGE_HOSTS = ['api.pixellab.ai', 'pixellab.ai', '<real-host>']
```

- [ ] **Step 4: 全量验证**

```bash
npx tsc --noEmit
npm test
npm run lint
```

Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore(pixel): record measured purity thresholds from a real run"
```

---

## Self-Review

**1. Spec coverage**

| spec 章节 | 落点 |
|---|---|
| §4.1 落点（5 新 + 4 改） | Task 1/2–5/6/7–10/12 |
| §4.2 资产库兼容（不改数据模型） | Task 10（自建 `CollectedAsset`）+ Task 11（backend 白名单） |
| §4.3 生成器缝 | Task 1（`PixelGenerator` + `pixellab`） |
| §5 契约（5 op / BYOK 头 / 错误透传） | Task 6 |
| §6 数据流（同步 pixflux / 异步角色） | Task 7（同步）+ Task 9（异步轮询） |
| §7.1 b 是输入 | Task 7（`block` 输入框，默认 `DEFAULT_BLOCK`） |
| §7.2 探相位 | Task 2 |
| §7.3 纯度门禁 + 人工 override | Task 5（`analyzeGrid`）+ Task 8（徽章 + 「仍然施加」） |
| §7.4 decimate 取众数 | Task 3 |
| §7.5 整数裁切、不缩放、越界抛错 | Task 4 |
| §8 UI（两子模式 / 徽章 / balance / 入库映射） | Task 7/8/9/10 |
| §8.5 状态在 PixelStudio | Task 7 + Task 12 Step 4（共享面板让位） |
| §9 错误处理（不自动重试 / 不静默降级 / 保留 character_id） | Task 6（透传）+ Task 8/9（文案与按钮） |
| §10.1 四条纯函数单测 | Task 2–5（共 10 条） |
| §10.2 白名单安全边界 | Task 6（8 条） |
| §10.3 手动 smoke | Task 13 |
| §11 第二轮接口 | 本轮不实现（spec 已钉死） |
| §12 风险点 1（阈值校准） | Task 13 Step 2 |
| §12 风险点 2（按实际返回尺寸裁切） | Task 4（`cropToCell` 只看输入缓冲，不看请求值） |

**2. Placeholder scan**：无 TBD/TODO。Task 10 Step 3 与 Task 11 Step 1 的"以实际文件为准"是**跨计划依赖的核对指令**（附了具体 `grep` 命令），不是待补内容。

**3. Type consistency**：`PixelBuffer`/`RGBA`/`GridAnalysis`（Task 2/5 定义 → Task 7/8 使用）；`PixelGenerator` 三个方法一律 `(req, key)`（Task 1 已修正笔误）；`Candidate` 字段在 Task 7 定义、Task 8/9/10 使用；`CollectedAsset.provenance.backend` 在 Task 11 定型，Task 10 已按 `'pixellab'` 写入。
