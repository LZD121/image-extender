# image-extender fork：真像素画产线设计

> 状态：设计已定稿（第 1、2 节经用户确认）·本文件待用户评审
> 日期：2026-10-05
> 关系：**独立于** `2026-10-05-fork-design.md`（本地资产库）。那份管"生成物怎么落盘"，本份管"怎么生成真像素画"。前者 §3 把"修改后处理算法"列为非目标，本份不改它的任何后处理。

## 0. 一句话

给 fork 加一条**真像素画产线**：`/api/pixel` 把 PixelLab 的 HTTP API 以 BYOK 薄代理接进来，新增第六个 studio 做生成与**确定性拼装**（探相位 → mode-decimate → 整数裁切），产物落进资产库；**验收（纯度/帧间 bbox/蒙太奇）仍留在 agent 侧**，app 只把测量结果显示出来。

## 1. 背景与证据

### 1.1 现状：仓库里没有一个像素机具

| 观察 | 证据 |
|---|---|
| 无量化、无最近邻 | `grep -rin "quantiz" app/` → 0 处；`"nearest"` → 0 处 |
| `pixel-art` 只是 prompt 字符串 | `app/api/generate/route.ts:110`、`app/api/extend/route.ts:169`、`app/api/prop-brief/route.ts:25` 各一行文案 |
| 后处理全部为 painterly 设计 | `app/utils/imageProcessor.ts`（3459 行）里是洋红抠图、512px 切格、Poisson 混合、基线对齐 |

### 1.2 目标语料的约定（dark-black，已实测）

| 属性 | 语料值 |
|---|---|
| 2×2 块纯度 | **1.0000**（逻辑格点在 offset `(0, 1)`） |
| partial-alpha 像素 | **0** |
| figure 高度（32px cell 上） | 24–28 px |
| 不透明色数 / atlas | 79–86 |

### 1.3 候选生成器（已实测，来自 `pixelart-vendor-acceptance`）

| | PixelLab | Retro Diffusion |
|---|---|---|
| 2×2 纯度（四相位最优） | **0.84–0.87** | 0.57–0.65 |
| 帧间 bbox | **8 帧完全一致（不沸腾）** | 帧 0 仅 16.5% 与输入帧一致 |
| 输出颗粒 | 1 px（**2×2 是待施加的，不是自带的**） | 1 px |
| 成本 | 标准模式 **1 generation = 8 方向整角色**；模板动画 1 generation/方向 | $0.07/次，`num_images` 被忽略 |
| 关键坑 | `background_job_ids`（**复数**）；`image_size` 请求 ≠ 返回（32×32 → 48×48，为对角线留 √2 余量） | 结果嵌在 `result` 下（读顶层会"成功但空手"） |

### 1.4 通用生图模型？——本轮实测，**不成立**

2026-10-05 用 `gemini-3.1-flash-image`（经 Teamo Router）跑 2 次：一次强约束（"每个逻辑像素 = 16×16 实心块、≤12 色、无抗锯齿"），一次普通像素风。纯度按四相位算法内联测量。

| 指标 | 语料 | PixelLab | gemini 强约束 | gemini 普通 |
|---|---|---|---|---|
| 2×2 纯度 | 1.0000 | 0.84–0.87 | **0.0476** | 0.0586 |
| 纯度 @ b=4 / 8 / 16 | — | — | **0.0002 / 0 / 0** | 同 |
| 不透明色数 | 79–86 | 34→21（自带量化） | **14,684** | 12,801 |
| 洋红背景遵守度 | — | — | 69.9% | 83.6% |

**视觉读**：一眼*像*像素画（块状轮廓、16-bit 味道、洋红背景照做），但格点是**画出来的不是排出来的**——b≥4 纯度全 0.0000，内部平滑渐变。按最优相位 decimate 到 256×256 后**仍有 5,804 色**（语料的 68 倍）。

**结论**：约束层能做两件事——吸格点、压色——但**它吸不到一个不存在的格点**。生成器是这一层的真护城河，通用模型在 32px 网格契约上不是"差一档"，是结构性没有格点。（未测：`gpt-image-2` 经 APIMart；PixelLab 的 Pro Flash 底层即 `gpt-image-2.5-flare`，见 §12。）

## 2. 目标与成功标准

1. 在 studio 里能产出**真像素网格**的资产：角色静帧、8 方向转台、图块/材质、道具/装饰，并落进资产库。
2. 探格点结果**可见**：每张图显示 `block / phase / purity` 实测值；低于阈值时明确标红，**绝不静默降级**。
3. **任何路径都不缩放**：只有整数裁切与整块抽取，没有非整数重采样。
4. 现有 5 个 studio 与资产库**零回归**：不改它们的后处理、导出与数据模型。
5. 不引入服务端状态、队列、认证；key 不落盘。

## 3. 非目标（本轮）

- **动画行**（第二轮，接口已在 §11 钉死）
- **验收指标的全量报告**（purity/bbox 扫描报告属 agent 侧；app 只显示单图徽章）
- **其他生成器实现**（Retro Diffusion 等）
- **调色板编辑器**（`color_image` 只做上传，不做拾色）
- 批量/队列 UI（上一份 spec §3 已划给 `ie.py`）
- 4 方向端点（`/create-character-with-4-directions`）
- **适配器框架**（只留类型缝，见 §4.3）

## 4. 架构

### 4.1 落点

**新增**

```
app/api/pixel/route.ts                  BYOK 薄代理（白名单 op，服务端零状态）
app/components/PixelStudio.tsx          第六个 studio
app/utils/pixelGrid.ts                  纯函数：探相位 / mode-decimate / 整数裁切
app/lib/pixel.ts                        常量与类型（op 名、尺寸边界、模板清单、PixelGenerator 类型缝）
app/lib/__tests__/pixelGrid.test.ts     纯函数单测
```

**改动（行号已核实）**

```
app/lib/app.ts:54                   Mode 联合类型加 | 'pixel'
app/components/TopBar.tsx:82-86     mode 列表加一条 {value,label,Icon,hint}
app/components/icons.tsx            新增一个 Pixel 图标（现有 Layers/Sprout/Play/Mountain 已被占用）
app/page.tsx                        import + 挂载 <PixelStudio/>（现有 studio 挂在 3832/3853/3880/3899）
```

### 4.2 资产库兼容（不改数据模型）

像素角色就是 `sprites`、图块就是 `tiles`、道具就是 `props`（`libraryTypes.ts` 的 `ASSET_KINDS` 已含）。`provenance`：

```
backend: 'pixellab'
model:   'create-character-v3' | 'create-image-pixflux'
params:  { template_id, view, image_size, seed, … }
returned: '48x48'（来自 CharacterSize/实测）
cost:    { usd, generations }（vendor 的 usage 字段）
```

 `files.sheet` = vendor 原图（raw），`files.derived` = decimate + 裁切后的成品。**不复用 `collectStudioAsset`**（它是按五个 studio 的字段形状设计的）；PixelStudio 自己按 `libraryTypes.ts` 构造 `AssetMeta`，复用的是 `LibraryClient` 与面板组件。

**面板归属**（消除一处歧义）：资产库计划把面板挂在 `page.tsx`，靠 `pending` 回调读那里的状态。像素状态在 PixelStudio 内部 → `page.tsx` 读不到，所以 **PixelStudio 自己渲染一份 `<LibraryPanel>`**，同时 `page.tsx` 在 `mode === 'pixel'` 时**不渲染**共享那份（一行条件）。否则页面上会同时出现两个面板。

### 4.3 生成器缝（只留类型，不做框架）

`app/lib/pixel.ts` 里定义：

```ts
export type PixelJob = { id: string; status: 'pending' | 'completed' | 'failed'; images: string[] }
export type PixelGenerator = {
  id: 'pixellab'
  submitImage(req: PixfluxRequest): Promise<string>          // base64
  submitCharacter(req: CharacterRequest): Promise<{ characterId: string }>
  pollCharacter(id: string): Promise<PixelJob>
}
```

第一轮只有 `pixellab` 一个实现。加第二个引擎 = 新增一个模块，不是重构。

## 5. HTTP 契约

`/api/pixel`：**白名单 op**，不转发任意路径。

| op | 转发到 | 同步性 | 参数（边界已从 openapi.json 核对） |
|---|---|---|---|
| `pixflux` | `POST /create-image-pixflux` | **同步**，直接回 base64 | `description`；`image_size` **16–400**；`no_background`；`color_image`；`init_image`+`init_image_strength`；`seed` |
| `character` | `POST /create-character-v3` | 异步：立刻回 `character_id` + `background_job_id` | `description`；`image_size` **32–256**（从零生成才生效，**非方图会被补成方图再旋转**）；`template_id` ∈ mannequin\|bear\|cat\|dog\|horse\|lion；`view` ∈ low top-down\|high top-down\|side；`reference_image`；`no_background`；`seed` |
| `characterStatus` | `GET /characters/{id}` | — | 回 `status` ∈ pending\|completed\|failed、`rotation_urls`（**只有 completed 才非 null**）、`directions` ∈ 4\|8、`size`、`animations[]` |
| `balance` | `GET /balance` | 免费 | `{credits:{usd}, subscription:{generations,total,plan,status}}`（当前 1437.3 / 2000，Tier 1） |

**鉴权**：浏览器把 key 放 `x-pixellab-key` 头；路由换成 `Authorization: Bearer` 转发。**服务端不落盘、不进日志、不进 git**——与现有 6 个路由的 BYOK 同构（它们的 `apiKey` 走请求体，这里走头，因为要兼容 GET 轮询）。

**错误透传**：`openapi.json` 里 401/402/422/429/529 **全部无 body 契约** → 代理层只回 `{status, text}`，不发明 JSON 形状。

## 6. 数据流

```
A. 图块 / 道具 / 静帧（同步，秒级）
   POST /api/pixel {op:'pixflux'} → base64
   → pixelGrid.decimate() → cropToCell() → 预览 → 入库
   （sheet = 原图，derived = 成品）

B. 角色 / 8 方向转台（异步，2–5 分钟；1 generation 出 8 方向）
   POST /api/pixel {op:'character'} → character_id
   → 轮询 /api/pixel?op=characterStatus&id=… （每 5s，上限 10 分钟）
   → status=completed → rotation_urls（south/west/east/north + 4 对角线）
   → 每张 decimate + 裁切 → 8 张成品全部入库
```

v3 **恒出 8 方向**（`directions=8`）："静帧"取南向一张，"转台"保留全部——同一次调用，1 generation。

## 7. 组装数学（`pixelGrid.ts`，纯函数、不碰 canvas）

**这是本设计的技术核心。** 顺序固定：探相位 → decimate → 裁切。

### 7.1 块大小 `b` 是**输入**，不是被探测的对象

**这一条修正了设计评审时的一个决定**，证据：PixelLab 输出是 **1px 颗粒**；语料的 2×2 块是**施加**上去的（`pixel-art-vendor-output-measurement` §2：*the grid must be imposed. Take the mode of each 2×2 block*）。一个 1px 颗粒的图里**不存在"2"这个信息**——扫描块大小只会得到 `b=1`（纯度恒 1.0）→ 什么都不抽。

`b` 默认 **2**（= dark-black 语料：32px cell ÷ 16 逻辑像素），studio 里是一个数字输入，记住在 localStorage。

### 7.2 探相位（真正需要探测的东西）

四个相位各算一次块纯度（`b×b` 内单色块占比），取最高者。**这正是 0.55 vs 1.0 那个坑的解法**——单相位测量会把语料读成 0.55。

### 7.3 纯度是**施加强度**的度量，门禁阈值靠实测定

**这一节在 Task 13 的 smoke 里被实测推翻过一次**，记在这里免得后人重犯：

初稿把阈值定在 **0.95**（"纯度 ≥ 0.95 才自动施加"）。实测后作废——PixelLab 输出是 1px 颗粒，2×2 格点是**施加**上去的，所以真实产物的纯度**本来就不该高**。0.95 会拦下整条产线的正常输出。

实测（2026-10-05，全部经 app 自己的 `/api/pixel` 代理取回、用仓库里的真函数测量，block=2）：

| 来源 | purity | 应有的行为 |
|---|---|---|
| `gemini-3.1-flash-image`（通用模型，无格点） | **0.0476** | **拦** |
| PixelLab `create-image-pixflux`（图块） | **0.2305** | **放行** |
| PixelLab `create-character-v3`（角色南向） | **0.4766** | **放行** |

**阈值 = 0.15**（两类实测点的中点）。行为：

- 纯度 **≥ 0.15** → 自动 decimate，徽章显示实测值 ✅
- **< 0.15** → **标红**，显示实测值，默认**不自动** decimate；给一个显式的「仍然施加」按钮作为人工 override——**绝不静默降级**
- 介于两类之间（0.15–0.23）本就是判断题：显示数字、交给人

**另一处实测删除**：初稿还要求"同时报告 `purity @ b=1` 作为诊断（区分 1px 颗粒 vs 已是块状）"。它**恒等于 1.0000**（1×1 块必然单色），是个没信息的字段，已从 `GridAnalysis` 删除。

**顺带实测到的默认值正确性**：`block=2 / cell=32 / band 24–28` 把 PixelLab 的 64×64 角色输出变成 32×32 cell、figure **27×27**，**零警告**——正好落在语料带里。

### 7.4 decimate

逐块**取众数**（`collections.Counter.most_common(1)` 语义）。**禁用均值**——实测均值把 20 色膨胀到 54–73 色。

### 7.5 裁切

按目标 cell 尺寸 + figure 高度带（用非背景/非洋红的 bbox）定位，水平居中、底部贴地。**任何路径都不缩放**：要改尺寸就改 `image_size` 让图"出生"就对；目标尺寸不可能达到时**抛错**，不静默 resize。

## 8. UI（PixelStudio）

### 8.1 子模式 A：图块 / 道具 / 静帧（pixflux）

`description`（必填）、`width`/`height`（16–400，默认 64）、`no_background`（道具默认开）、`color_image`（上传调色板参考图）、`seed`。

### 8.2 子模式 B：角色 / 8 方向转台（create-character-v3）

`description`（必填）、`template_id`（**一级控件**——标准模式是骨架驱动，**模板压过 prompt**：写"甲壳爬行者"会还你一个盔甲人形）、`view`、`image_size`（32–256，默认 64；提示"非方图会被补成方图"）、`reference_image`（可选，南向图 → 旋转成 8 方向）。

### 8.3 输出区

- 每张结果 **原始图 ↔ 成品图** 可切换对照
- 每张挂**探格点徽章**：`block · phase · purity`，通过 ✅ / 未通过 ✗
- 顶部显示 `op=balance` 取回的剩余 generations（免费调用）

### 8.4 入库映射

| 子模式 | `kind` | `sheet` | `derived` |
|---|---|---|---|
| 图块 | `tiles` | vendor 原图 | decimate+裁切成品 |
| 道具 | `props` | 同上 | 同上 |
| 角色 | `sprites` | 同上 | 8 张成品 |

### 8.5 状态位置

**PixelStudio 自带**（表单、候选、探格点结果、保存），不往 `page.tsx`（已 4068 行）里塞。**这与现有"studio 是壳、page.tsx 是脑"的惯例相反**——代价是偏离惯例，收益是与资产库收集器零耦合。

## 9. 错误处理

| 情况 | 处理 |
|---|---|
| 401 | key 输入框标红；key 存 localStorage，只经头转发 |
| 402 | 显示 `op=balance` 实测值，把"没额度"与"参数错"分开 |
| 422 | vendor 原文**原样显示**（可能带 `…` 截断的可用值列表，正好当枚举提示） |
| 429 / 529 | 提示稍后重试，**不自动重试** |
| 超时 / 网络断 | **绝不自动重发**——提交不幂等，重发 = 二次扣 generation；文案明说"可能已提交" |
| 角色 `status='failed'` | 明说失败，不静默；**不假设** vendor 退款 |
| 轮询超时（10 分钟） | **保留 `character_id`**，给"再查一次"按钮，**不重新提交** |
| purity < 0.15 | 徽章标红 + 实测值；不静默 decimate |

## 10. 测试

### 10.1 `pixelGrid.ts` 纯函数单测（vitest 已就位，4 条）

1. **四相位搜索必须纠正单相位误判**——合成一张逻辑格点在 `(0,1)` 的图，故意让 `(0,0)` 相位测出低纯度，断言找到 `(0,1)` 且 purity≈1.0。
2. **decimate 取众数且不产生新颜色**——`[红,红,红,蓝]` → 红；断言输出色集合 ⊆ 输入色集合。
3. **裁切任何路径都不缩放**——图高 31 要进 24–28 高度带：断言输出尺寸是输入的整数子集、bbox 尺寸不变；目标不可能达到时**抛错**。
4. **低纯度不静默降级**——purity < 0.15 时返回 `{ok:false, purity}`，不返回 decimate 结果。

### 10.2 白名单（安全边界，唯一的路由测试）

`op` 不在白名单（含 `op:'/v2/balance'`、`op:'../x'`）必须 **400**。这是安全边界，不是转发测试。

### 10.3 手动 smoke（不进单测）

真实 key 各打一次 `pixflux` 与 `character`（角色那次 = **1 generation**，8 方向；pixflux 的 generation 成本实现时读 `usage` 实测，不预设）。角色那次必须走完轮询到 `completed` 并把 8 张 URL 全取回。

## 11. 第二轮接口（本轮不做，但已钉死）

- 端点：`POST /characters/animations`（`mode: 'template'` → **1 generation/方向**）；`POST /animate-character` 是 legacy，不用
- **不需要新的查询端点**：`GET /characters/{id}` 已返回 `animations[] → directions[] → frames[]`，**frames 是公开 URL 数组**（`AnimationDirection = {direction, frame_count, frames[]}`）
- 轮询复用 `characterStatus`
- 唯一要注意的：`CreateCharacterAnimationResponse` 回的是 `background_job_ids`（**复数**）

## 12. 待实现时验证的风险点

1. ~~**探相位在真实 PixelLab 输出上的表现**~~ **已实测收口（2026-10-05）**：真实输出 `block=2 phase=(0,0) purity=0.2305`（图块）/ `0.4766`（角色），相位未判歪；阈值从 0.95 改为 **0.15**（见 §7.3）。`purityAtBlockOne` 已删（恒为 1.0）。剩余风险：介于 0.15–0.23 之间的产物是判断题——UI 显示数字 + 人工 override，符合设计。
2. **`image_size` 请求 ≠ 返回**（32×32 → 48×48，对角线余量）：裁切逻辑必须按**实际返回尺寸**工作，不按请求值。
3. **未测的候选**：`gpt-image-2` 经 APIMart 未测；PixelLab Pro Flash 底层是 `gpt-image-2.5-flare`——若将来想要"自带通用模型的像素脚手架"，这是参照物。
4. **`template_id` 与参考图必须同体型**（openapi 原文："Must match the body type in `reference_image`"）。
5. **动画模板清单在文档里是截断的**（`… crouched-walking, ...`）；mannequin 的完整枚举用**故意非法的 `template_animation_id`** 探（校验先于计费，0 generation）。

## 13. 与既有计划的关系

- **依赖**：`2026-10-05-local-asset-library.md` 的 Task 6/7/8（收集器 / `LibraryClient` / 面板）。本产线不改其数据模型与契约。
- **不依赖**：Task 9（page.tsx 接入）——像素 studio 自带状态（§8.5）。
- **顺序**：资产库计划先落（正在另一会话执行），本产线随后；两者不共享文件（除 `page.tsx` 一行挂载）。

## 附录 A：证据索引

| 事实 | 来源 / 命令 |
|---|---|
| PixelLab 端点、请求/响应 schema、边界（16–400 / 32–256 / 6 个 template / 3 个 view） | `https://api.pixellab.ai/v2/openapi.json`（464 KB，本地核对） |
| 401/402/422/429/529 无 body | 同上，`paths.*.post.responses` |
| `background_job_ids` 复数 / `image_size` 不保真 / 帧间 bbox 一致 | `skill://pixelart-vendor-acceptance` §"Vendor API gotchas"、§"Measuring generated art" |
| 四相位纯度算法、mode-decimate、禁止非整数缩放 | `skill://pixel-art-vendor-output-measurement` §0–§2 |
| 语料基线（1.0000 / 0 / 24–28px / 79–86 色） | 同上 §1 |
| 通用模型实测（0.0476 / 0.0586 / 14,684 色） | 本文件 §1.4；2026-10-05 经 `ie.py --backend teamo --backend-model gemini-3.1-flash-image` 2 次调用 |
| 账户余额 | `GET /v2/balance` → 1437.3 / 2000，Tier 1 |
