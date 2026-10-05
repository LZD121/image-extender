# Stylized Asset Production — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `artStyle` 真正生效，从而能用现有 studio 产出**风格化**（像素风 / low-poly 风）的手绘动画资产。

**Architecture:** 把风格注入抽成一个纯函数（单一真相），四条 prompt 分支全部改用它；并用**路由级行为测试**（stub `fetch`，检查出站请求体）锁住"每种模式都带风格"这一契约。

**Tech Stack:** Next.js 14 App Router、TypeScript strict、vitest。

**Worktree:** `~/.herdr/worktrees/image-extender/stylized-assets`（分支 `feat/stylized-assets`，基线 72 tests 全绿）

---

## 背景：这是修一个已测量的 bug，不是加功能

2026-10-05 实测（本轮探索）：

| 事实 | 证据 |
|---|---|
| `artStyle` 参数在 **sprite sheet / tile sheet / 角色锚点**三条路径被**静默丢弃** | `grep -n artStyle app/api/generate/route.ts` 只有 5 处；`fullPrompt` 在四条分支（257 / 394 / 1018 / 1087）被**整体覆盖**，其中只有 prop sheet（1088）把风格**拼回去** |
| 因此 UI 里选 `pixel-art` / `low-poly` 对 sprite sheet **完全无效** | 实验：同一 prompt + `artStyle:"pixel-art"` 与 `"low-poly"` → 两张都是写实插画 |
| 把风格写进 **prompt 正文**则生效 | 同一 prompt 加 "crisp hard-edged pixel blocks, flat solid colors, thick dark outlines, NO anti-aliasing, limited 16-color palette" → 原生分辨率下可见硬边块/平涂/有限配色 |
| 但它**不是严格格点** | 该图纯度在 `b≥4` 全 ≈0，decimate 后 67,852 色（语料 79–86）。**这符合需求**——目标是风格化，不是像素契约 |

**结论**：风格化路线可行，但**必须先修这个 bug**，否则所有风格结论都建立在"参数根本没送到模型"之上。

## 非目标

- **不做严格像素**——那需要真像素生成器（PixelLab，已集成），本轮不碰
- 不改 `pixelGrid.ts` / `PixelStudio.tsx` / 像素产线
- 不改 sprite 的网格/帧/洋红契约，不加新 studio
- 不做自动化视觉评分（风格判据是**看图**；本轮靠人眼 + 现有 AI critic）

## 文件结构

| 文件 | 职责 |
|---|---|
| `app/lib/stylePrompt.ts`（新建） | **唯一**的风格真相：`ART_STYLE_PROMPTS` 表 + `styleDirective(artStyle)`。纯函数 |
| `app/lib/__tests__/stylePrompt.test.ts`（新建） | 纯函数单测 |
| `app/api/generate/__tests__/styleInjection.test.ts`（新建） | **路由级行为测试**：stub `fetch`，断言出站 prompt 在每种模式都含风格 |
| `app/api/generate/route.ts`（修改） | 删掉内联的 `artStyleDescriptions`，四条分支统一改用 `styleDirective()` |

---

## Task 1: 让 artStyle 真正到达模型

**Files:**
- Create: `app/lib/stylePrompt.ts`
- Create: `app/lib/__tests__/stylePrompt.test.ts`
- Create: `app/api/generate/__tests__/styleInjection.test.ts`
- Modify: `app/api/generate/route.ts`

- [ ] **Step 1: 写失败的纯函数测试**

`app/lib/__tests__/stylePrompt.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { styleDirective } from '@/app/lib/stylePrompt'

describe('styleDirective', () => {
  it('returns an empty string when no style is selected', () => {
    expect(styleDirective(undefined)).toBe('')
    expect(styleDirective('')).toBe('')
    expect(styleDirective('none')).toBe('')
  })

  it('ignores an unknown style key rather than inventing a directive', () => {
    expect(styleDirective('not-a-real-style')).toBe('')
  })

  it('leads with the style so a long structural prompt cannot bury it', () => {
    const d = styleDirective('pixel-art')
    expect(d.startsWith('RENDER STYLE')).toBe(true)
    expect(d.endsWith('\n\n')).toBe(true)
  })

  it('spells out the negatives that make pixel art read as pixel art', () => {
    const d = styleDirective('pixel-art').toLowerCase()
    for (const term of ['no anti-aliasing', 'no gradients', 'no soft shading']) {
      expect(d, term).toContain(term)
    }
    expect(d).toContain('limited palette')
  })

  it('spells out the negatives that make low-poly read as low-poly', () => {
    const d = styleDirective('low-poly').toLowerCase()
    expect(d).toContain('flat')
    expect(d).toContain('no texture detail')
    expect(d).toContain('no gradients')
  })

  it('covers every style the UI offers a description for', () => {
    // The UI list lives in app/lib/artStyles.ts; every value except 'none'
    // must produce a directive, or the dropdown silently lies.
    expect(styleDirective('cinematic')).not.toBe('')
    expect(styleDirective('watercolor')).not.toBe('')
    expect(styleDirective('anime')).not.toBe('')
  })
})
```

- [ ] **Step 2: 跑，确认失败**

Run: `npm test -- app/lib/__tests__/stylePrompt.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/lib/stylePrompt"`

- [ ] **Step 3: 实现 `app/lib/stylePrompt.ts`**

`artStyleDescriptions` 现在内联在 `app/api/generate/route.ts:95-111`（含约 40 个键）。**整表原样搬过来**，然后：

1. 把 `pixel-art` 与 `low-poly` 两条**加强**（其余键不动）：

```ts
  // Strengthened after measuring that the old one-liners did not survive a long
  // structural prompt. See docs/superpowers/plans/2026-10-05-stylized-assets.md.
  'pixel-art':
    'pixel art: crisp hard-edged pixel blocks, flat solid colours, thick dark outlines, a limited palette of roughly 16 colours, 16-bit console look. No anti-aliasing, no gradients, no soft shading, no photographic texture',
  'low-poly':
    'low-poly: flat geometric facets with straight visible edges, solid flat-shaded colour planes, crisp silhouettes. No texture detail, no gradients, no smooth or soft shading, no photographic realism',
```

2. 加导出：

```ts
/**
 * The one place that turns an art-style key into prompt text.
 *
 * Leading position is deliberate: the sheet prompts run to hundreds of words of
 * grid/magenta/choreography rules, and the previous version — buried as
 * `Art style: …` or dropped entirely — measurably failed to survive them.
 *
 * Returns '' for 'none', for an absent style, and for an unknown key (never
 * invents a directive).
 */
export function styleDirective(artStyle: string | null | undefined): string {
  if (!artStyle || artStyle === 'none') return ''
  const description = ART_STYLE_PROMPTS[artStyle]
  if (!description) return ''
  return `RENDER STYLE (follow strictly, it outranks decorative wording elsewhere in this prompt): ${description}.\n\n`
}
```

（表名用 `ART_STYLE_PROMPTS`；把路由里原来的局部常量删掉，改 import。）

- [ ] **Step 4: 跑，确认通过**

Run: `npm test -- app/lib/__tests__/stylePrompt.test.ts`
Expected: PASS，6 个用例

- [ ] **Step 5: 写失败的路由级行为测试**（这是本任务的核心防线）

它锁住"**每一种模式**的 prompt 都带风格"——正是当初 4 条分支里 2 条忘记的那一类 bug。

`app/api/generate/__tests__/styleInjection.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/generate/route'

/** A 1×1 PNG data URL — enough for the route to hand back an imageUrl. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const MODEL = 'google/gemini-3.1-flash-image-preview'

function req(body: Record<string, unknown>) {
  return new NextRequest(new URL('/api/generate', 'http://localhost:3000'), {
    method: 'POST',
    body: JSON.stringify({ apiKey: 'dummy', model: MODEL, width: 512, height: 512, ...body }),
  })
}

/** Capture the outbound prompt without touching the network. */
async function capturePrompt(body: Record<string, unknown>): Promise<string> {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const sent = JSON.parse(init.body)
    const text = sent.messages
      .flatMap((m: { content: unknown }) => (Array.isArray(m.content) ? m.content : [m.content]))
      .map((p: { text?: string } | string) => (typeof p === 'string' ? p : p?.text ?? ''))
      .join('\n')
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, images: [{ image_url: { url: PNG } }] } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  })
  const original = globalThis.fetch
  globalThis.fetch = fetchMock as unknown as typeof fetch
  try {
    const res = await POST(req(body))
    expect(res.status).toBe(200)
    const call = fetchMock.mock.calls[0]
    const sent = JSON.parse((call[1] as { body: string }).body)
    return sent.messages
      .flatMap((m: { content: unknown }) => (Array.isArray(m.content) ? m.content : [m.content]))
      .map((p: { text?: string } | string) => (typeof p === 'string' ? p : p?.text ?? ''))
      .join('\n')
  } finally {
    globalThis.fetch = original
  }
}

const MODES: { name: string; body: Record<string, unknown> }[] = [
  { name: 'plain generate', body: { prompt: 'a mossy stone' } },
  { name: 'sprite sheet', body: { prompt: 'a knight', spriteSheet: true, spriteAnim: 'walk', spriteBodyPlan: 'biped', width: 2048, height: 1024 } },
  { name: 'tile sheet', body: { prompt: 'mossy stone', tileSheet: true, width: 4096, height: 4096 } },
  { name: 'prop sheet', body: { prompt: 'rocks', propSheet: true, width: 2048, height: 1024 } },
  { name: 'sprite anchor', body: { prompt: 'a knight', spriteAnchor: true, spriteBodyPlan: 'biped', width: 1024, height: 1024 } },
]

describe('artStyle reaches the model in every mode', () => {
  for (const { name, body } of MODES) {
    it(`${name} carries the style directive`, async () => {
      const prompt = await capturePrompt({ ...body, artStyle: 'pixel-art' })
      expect(prompt).toContain('RENDER STYLE')
      expect(prompt.toLowerCase()).toContain('no anti-aliasing')
    })

    it(`${name} stays style-free when no style is selected`, async () => {
      const prompt = await capturePrompt(body)
      expect(prompt).not.toContain('RENDER STYLE')
    })
  }
})
```

> **触发条件已核实**（不是猜测）：四条分支只认一个布尔，**不要求任何 guide/ref 图**才能进入：
> `if (tileSheet === true)` :256 · `else if (spriteAnchor === true)` :320 · `else if (spriteSheet === true)` :416 · `else if (propSheet === true)` :1064。
> 所以上面表格里的 body 就是进分支的充分条件；guide 图只影响分支**内部**是否附加参考图。
>
> 对应的 `fullPrompt = …` 赋值行在 **257 / 394(锚点段) / 1018 / 1087** —— 接线时按这些锚点改，不要按分支起始行改。

- [ ] **Step 6: 跑，确认它失败（这正是 bug 的证据）**

Run: `npm test -- app/api/generate/__tests__/styleInjection.test.ts`
Expected: **至少 4 条红** —— 只有 `plain generate` 那条应当是绿（基础路径本来就带风格），其余全部"RENDER STYLE 未找到"。

**把这个红/绿名单记下来**——它就是 bug 的复现证据。

- [ ] **Step 7: 接线（四处）**

在 `app/api/generate/route.ts` 里：

1. 删掉内联的 `artStyleDescriptions` 常量，改为 `import { styleDirective } from '@/app/lib/stylePrompt'`
2. 基础路径（原 141-142）：
```ts
    let fullPrompt = `${styleDirective(artStyle)}${prompt}`
```
3. 在四条分支的赋值**开头**插入同一个前缀（`fullPrompt = \`${styleDirective(artStyle)}You are generating …\`` 等）：
   - tile sheet（原 257）
   - sprite anchor（原 394）
   - **sprite sheet（原 1018）** ← 就是它漏掉的
   - prop sheet（原 1087 已有 `Art style: …` 片段，**换成** `styleDirective`，避免两套写法）
4. 确认没有任何地方再引用 `artStyleDescriptions`。

- [ ] **Step 8: 跑，全部通过**

Run: `npm test -- app/api/generate/__tests__/styleInjection.test.ts app/lib/__tests__/stylePrompt.test.ts`
Expected: PASS（10 条风格用例 + 6 条纯函数用例）

- [ ] **Step 9: 全量回归 + 提交**

```bash
npm test && npx tsc --noEmit
git add app/lib/stylePrompt.ts app/lib/__tests__/stylePrompt.test.ts app/api/generate/route.ts app/api/generate/__tests__/styleInjection.test.ts
git commit -m "fix(generate): make artStyle reach the model in every prompt path

Four prompt branches reassign fullPrompt, so the base 'Create an image in
<style>' prefix was discarded by three of them (sprite sheet, tile sheet,
and the sprite anchor); only the prop sheet re-prepended it. Selecting a
style in the UI was a silent no-op for those modes.

The directive now comes from one pure helper and leads every prompt, with
negatives spelled out (no anti-aliasing / no gradients / no soft shading)
because the measured output showed a one-line style phrase does not
survive a long structural prompt. A route-level test stubs fetch and
asserts the outbound prompt carries the directive in every mode."
```

---

## Verification & decision gate（控制器执行，不是子代理）

代码修好后，这一步才第一次**真正**回答"风格化值不值得"。

- [ ] **V1: 重跑风格矩阵**（每条 1 张 8 帧 sprite sheet，~25–50s/张）

用修好的 `artStyle` 参数（**不是** prompt 正文），跑：

| # | `artStyle` | prompt |
|---|---|---|
| 1 | `pixel-art` | knight in blue tabard with sword |
| 2 | `low-poly` | 同上 |
| 3 | `cartoon`（对照） | 同上 |

命令模板（在**主仓库**跑，因为它需要 `~/.config/teamorouter/token` 与 `ie.py`；worktree 只放代码改动）：
```bash
K=$(cat ~/.config/teamorouter/token)
python3 ~/.agents/skills/image-extender/scripts/ie.py --backend teamo --backend-key "$K" \
  call generate --save /tmp/style-<name>.png \
  --body '{"spriteSheet":true,"spriteAnim":"walk","spriteBodyPlan":"biped","width":2048,"height":1024,
           "model":"google/gemini-3.1-flash-image-preview","artStyle":"<style>","prompt":"knight in blue tabard with sword"}'
```

- [ ] **V2: 看图判定**（判据是眼睛，不是数字）

逐张看**原生分辨率局部**（不是缩略图——本轮已踩过：缩略图的"块状感"可能是降采样假象）：
```bash
python3 -c "
from PIL import Image
im = Image.open('/tmp/style-pixel-art.png'); im.crop((260,90,620,450)).save('/tmp/z1.png')
im2 = Image.open('/tmp/style-low-poly.png'); im2.crop((260,90,620,450)).save('/tmp/z2.png')"
```
每张记录三行：**风格是否成立**（硬边块/平面切面 vs 插画）· **跨帧身份是否一致** · **是否可入库**（洋红干净、帧边界不溢出）。

- [ ] **V3: 确定性后处理仍工作**

```bash
rm -rf /tmp/style-frames && python3 ~/.agents/skills/image-extender/scripts/ie.py \
  sprite-align /tmp/style-<胜出者>.png /tmp/style-frames --cols 4 --rows 2 --cell 512 --anim walk
```
Expected: `wrote: 8`，且 `duplicateFrames: []`。

- [ ] **V4: 决策门（写进 close-out）**
  - 若 V2 中 ≥1 种风格"成立且可入库" → **保留配方**，把该风格标为推荐；结论："风格化资产 = 现有 studio + 修好的 artStyle 即可"
  - 若三种都不可用 → 结论："需要真像素生成器"，并停止这条线（工作树关闭，改动仍可保留因为 bug 是真 bug）

---

## Results / close-out（2026-10-05，控制器执行）

### 代码

| commit | 内容 |
|---|---|
| `7abb0e2` | `app/lib/stylePrompt.ts` + 四条分支接线 + 路由级行为测试（88 tests） |
| `71f9335` | 把 `extend` / `prop-brief` / `scene-brief` 的**私有副本表**统一到共享表（去重 ~90 行） |

**bug 已复现并验证**：修前跑 `styleInjection.test.ts` → **5 红 / 5 绿**；审查者另在 /tmp 副本做了**定向变异**（删掉 sprite sheet 分支的 `styleDirective`）→ 测试立刻变红，证明这条测试真能抓住"分支静默丢弃风格"。

### V1–V3：矩阵实测（每条 1 张 8 帧 sheet，`artStyle` 参数路径，非 prompt 正文）

| 风格 | 风格是否成立（**原生分辨率**验证） | 跨帧身份一致性 | 可入库 |
|---|---|---|---|
| **`low-poly`** | ✅✅ 平面切面、直边、平涂、无纹理 | ✅ **8 帧体型/配色/剪影一致** | ✅ |
| `pixel-art` | ✅ 平涂色块、有限配色、硬边 | ⚠️ **第 3、7 帧明显更瘦更直立**（其余 6 帧一致） | ✅ |
| `cartoon`（对照） | ✅ 干净的卡通造型，与前两者**明显不同** | ✅ | ✅ |

- **风格选择现在真的有区分度** —— 修前两张不同 `artStyle` 出来几乎一样的插画；修后三种风格肉眼可分。
- **V3**：`sprite-align` 在 low-poly 上 → `wrote: 8`，`duplicateFrames: []`，`targetSize 512.4`。确定性后处理对新风格仍然工作。

### V4 决策门：**通过 —— 保留配方**

结论：**风格化动画资产 = 现有 studio + 修好的 `artStyle` 即可**，不需要新生成器。
推荐默认：**`low-poly`**（一致性最好，直接可用）；`pixel-art` 可用但需配合锚点流程。

### 运维备注

- 首次 low-poly 生成遇到一次 `HTTP 500: fetch failed`（Teamo 侧瞬时网络错误）——**重试即成功**。这不是代码问题，但批处理时要有重试。

### 后续（明确未做，勿当成已完成）

1. **`extend` 把风格放在编号指令的第 7 项（末尾）**，而 `generate` 是前置。据"位置影响存活率"推测 extend 也偏弱，但**未测量** —— 要改先测。
2. **`pixel-art` 的帧间一致性**：本次矩阵走的是**单趟**；app 本就有"锚点 → sheet"两趟流程（pass 1 锁身份）正是为此设计。**用锚点重测 pixel-art** 是下一个显然的实验。
3. 三条文本/图像路由现在共用表，但 `pixel-art` / `low-poly` 的**强化文案只作用于图像生成路径**（extend / generate）；两个 brief 路由只共用描述。
4. 未做：把风格结论写进 README / 推荐到 UI 默认值。

---

## Follow-up results（2026-10-05，四项全部执行）

### 0. `npm run test:ai` 核对 —— ✅
路由改动后重跑 11 条 Midscene UI 用例：**11 passed (12.6s)**。prompt 拼装改动未影响前端接线。

### P1. `pixel-art` 锚点两趟重测 —— ✅ 有效，推荐改用两趟

- Pass 1 锚点：出来的骑士本身就是**很好的像素画**（1024² 下块约 16–20px，说明模型确实在画连贯的格；平涂、有限配色、洋红干净）。
- Pass 2 带 `spriteIdentityImage`：8 帧 4×2，**目视一致性明显优于单趟**（单趟那版第 3、7 帧明显更瘦，锚点版消失）。`sprite-align`：`wrote: 8`、`duplicateFrames: []`。
- **一个被否决的指标，记在这里免得后人重犯**：我试过用"逐帧非背景 bbox 离散度"衡量漂移 —— **无效**。bbox 主要由**姿势**决定（迈步幅度、剑的角度），锚点版 sd 反而更大（35.0 vs 20.4）而它显然更一致。bbox 不能用来测角色漂移。

### P2. `extend` 风格位置 —— ❌ **假设不成立，未改代码**

- 实测（当前代码，风格在编号指令第 7 项）：用 low-poly 背景做 38% 右向扩展，**2/2 样本新区域的风格完全正确**（切面山体、平涂、配色延续）。
- 结论：**"排在末尾会失效"这个假设没有证据支持**。不做 B 变体（前置 directive），不改代码 —— 不为一个未被观测到的缺陷增加改动面。
- **顺带冒出一个更值钱的问题**：两次扩展都在源图右缘出现**硬竖直接缝**（结构性不连续，源图边缘的山体没被续上）。
  - 已核实**不是工具链缺步骤**：`harmonizeHorizontalSeams` 属于 `makeTileable2D`（可平铺化），不是 extend 的通用后处理；`ie.py` 跑的 `applyFullContextResult` 就是 app 自己的 Poisson 混合。
  - **UI 有缓解机制**（多候选 + 按 `measureSeamResidual` 取最优），而单次 headless `ie.py extend` 不走这套。所以这是"单次扩展"的已知局限，不是产品回归 —— 但值得单开 ticket。

### P3. 结论固化 —— ✅
`README.md` 新增 "Stylized art: which studio for which job"：分工表（真格 → Pixel studio；风格 → 其余五个）、配方排序（`low-poly` 最佳 / `pixel-art` 配两趟 / `cartoon` 作对照）、"必须原生分辨率目视、色数与纯度对风格化无效"、以及上述接缝与 stylePrompt 的注意点。
