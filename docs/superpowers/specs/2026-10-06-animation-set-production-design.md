# 动画集生产（S1）：方向 × 状态 × 帧

日期：2026-10-06 · 状态：待实现 · 适用仓库：`image-extender`（fork）· 消费端：`dark-black`（Godot 4.7）

## 0. 一句话

让 image-extender 能一次产出一个**动画集**——「方向 × 状态 × 帧」的完整帧序列、计时、成本与 provenance——用现在就能跑通的图像模型通道（exact-ratio strip），使 `dark-black/tools/gen_assets_teamo.py` 这条外部脚本路径退役。

## 1. 背景（现状与证据）

### 1.1 消费端今天怎么拿到动画

| 事实 | 证据（`~/repos/dark-black`） |
|---|---|
| 现行动画生产**不在本仓库**，在游戏侧 python 脚本里 | `tools/gen_assets_teamo.py`（v11 手绘线），它 shell out 到 agent skill 的 `~/.agents/skills/image-extender/scripts/ie.py --backend teamo` |
| 生成粒度 = 每 **(状态, 帧)** 一张 strip，一行 N 格 = N 个方向 | `gen_assets_teamo.py` docstring 与 `build_prompt()`：`"a flat 1-row x {n}-column strip of {n} equal square cells"` |
| 尺寸是精确整数比，靠"8 cells @ 8:1 是模型支持的精确比例、无需非等比缩放" | 同上 docstring；请求体 `{"width": 4096, "height": 512}`（8 向）与 `{"width": 2048, "height": 512}`（hero 4 向） |
| 方向顺序 = 运行时 sector 顺序（east 起顺时针），**顺序即契约** | `DIRS8 = ["east","south-east","south","south-west","west","north-west","north","north-east"]`；`tools/build_handpainted_sheets.py` docstring："row index = dir * n_states + state … direction order is the runtime's sector order" |
| 每 actor：`desc` + `states[]` + 每状态 `motion` 文案 + `frames`（4） | `gen_assets_teamo.py` 的 `ACTORS`（chaser/lunger 4 状态，hero 2 状态） |
| 花钱有闸门：预演 → `--go`；逐条记账（state/frame/dirs/file/ok/seconds/prompt） | `gen_assets_teamo.py` main() 的 dry-run 分支与 `generation-ledger.json` |
| 组装成 per-actor atlas（行 = 方向×状态、列 = 帧，64px cell，trim→fit→margin）是**另一支**脚本 | `tools/build_handpainted_sheets.py` |
| 运行时二选一：手绘 atlas 优先，像素 atlas 是 fallback | `scripts/actors/enemy.gd:84-87,192`（"ATLAS_PATH is the OLD pixel-art fallback"） |
| 像素时代已退役；手绘是 10-04 的前线 | 提交 `6abb5ed feat(39): … retired atlas`（09-24）、`e503ae1 / 8d27e67 / a8ec4d7`（10-04） |
| 一条 PixelLab 8 向动画路线（`gen_monsters_8dir.py`，223–275 次生成的计划）**未落地**：仓库无任何 `*east*`/`*south*` 文件，`generation-ledger-8dir.json` 不存在 | 全仓 `find`；`assets/sprites/roster/` 只有 `generation-ledger.json` + `palette-ref.png` |

### 1.2 本仓库缺什么

| 事实 | 证据 |
|---|---|
| 没有"方向 × 状态 × 帧"这个一等对象：sprite studio 一次一条动画，pixel/character 只有**静态** 8 向 | `app/lib/pixel.ts:11`（`PIXEL_OPS`）、`PixelRotationUrls` |
| 风格文本只能来自封闭的风格表，游戏那段自定义 STYLE 走不了 `artStyle` | `app/lib/stylePrompt.ts`（`ART_STYLE_PROMPTS` 键表）、`app/lib/artStyles.ts` 的 option 列表 |
| UI 尺寸梯子选不出 8:1，精确比例只能来自脚本 | `app/components/Modals.tsx:836,853` 的固定宽度/高度列表 |
| 资产库没有承载动画集的 kind | `app/lib/libraryTypes.ts:8`（`ASSET_KINDS = tiles｜sprites｜props｜parallax｜extend`） |
| 但**通道与后处理都已具备**：magpie 已能路由到同一个图像模型；切格/抠底/归一化在浏览器侧现成，CLI 经 headless bridge 复用 | `app/lib/providers.ts:74,129`（`teamo-router/gemini-3.1-flash-image`，已实测）；`app/utils/imageProcessor.ts`（`sliceImageGrid:2070`、`chromaKeyToAlpha`、`removeFrameBorder`、`normalizeSpriteFrameScale`、`centerSpriteFramesHorizontally`）；`cli/native/bridge.mjs` 的 `slice`(179) / `chroma`(155) / `sprite-align`(276) |

## 2. 目标与成功标准

1. **一个规格 → 一整个动画集**：给出 actor 描述、状态列表（含每状态 motion 文案与帧数）、方向列表、cell 边长，得到 `states × frames` 张 strip 的完整计划，并可无人值守跑完。
2. **产物是中性的**：`set.json` + `derived/<state>_f<N>_<dir>.png`，不含任何 Godot 词汇；引擎适配器（S2）只需读它。
3. **可入库、可追溯**：动画集是一个库资产（`kind: animations`），`meta.json` 的 provenance 记录后端、模型、规格、请求 vs 实际尺寸、成本（provider 报就记）、调用数与耗时。
4. **省钱纪律**：任何生成前必须先看到计划与调用数；CLI 需 `--go`，UI 需二次确认。
5. **两端同期**：CLI 与 UI 调**同一份纯函数核心**，口径一致。
6. 现有 studio 的产物与 ZIP 导出**逐字节不变**（本次不改任何后处理算法与既有导出路径）。

## 3. 非目标

- **组装**：trim→fit→拼成"行 = 方向×状态"的 per-actor atlas、写进 Godot 工程、生成 `.tres`/`.import` —— 全部属于 S2（引擎交付层）。
- **PixelLab 动画端点**（`/characters/animations`）：作为第二个 backend 适配器，接口按本 spec 的模型设计，但不在本次实现。
- 身份锚（用首帧作后续帧参考图以压跨帧漂移）：v1 默认关闭，见 §12。
- 修改 `/api/generate` 的既有 wire 形状、`/api/library`、任何后处理函数、现有 studio 的导出。
- 批量队列/调度器、多用户、服务端实例。

## 4. 架构与单元边界

```
        ┌─ CLI:  cli/commands/anim.mjs ──┐
规格 ──▶ │  ie anim plan | run --go       │──┐
        └────────────────────────────────┘  │
        ┌─ UI:   app/components/AnimStudio.tsx ─┐   ▼
        └────────────────────────────────────┘  app/lib/animSet.ts   （纯：规格校验 / 计划 / set.json / 续跑判定）
                                                app/lib/animStrip.ts （纯：strip prompt 组装 + cell↔方向映射）
                                                        │
                                     ┌──────────────────┴──────────────────┐
                                     ▼                                     ▼
                       /api/generate（现有 plain 形状）        后处理（复用，不新写）
                       width=cell×dirs, height=cell           CLI: bridge ops slice/chroma/sprite-align
                                                              UI : app/utils/imageProcessor 同函数
```

| 单元 | 职责 | 依赖 | 可独立测试 |
|---|---|---|---|
| `app/lib/animSet.ts` | `AnimSetSpec` 校验、`planStrips()`、`buildSetJson()`、`nextPending()`（续跑判定） | 无（纯） | 可（vitest） |
| `app/lib/animStrip.ts` | strip prompt 组装（含 cell↔方向枚举、不出格与纯洋红背景约束）、尺寸代数 `width = cell × dirs.length` | 无（纯） | 可（vitest） |
| `cli/commands/anim.mjs` | 读规格 → 调 plan → 逐 strip 打 `/api/generate` → 写 `raw/` → 调 bridge 切格 → 写 `derived/` 与 `set.json` | `animSet`/`animStrip`、`cli/lib/*`、`cli/native/bridge.mjs` | 可（stub 网关） |
| `app/components/AnimStudio.tsx` | 规格表单、计划确认、逐 strip 进度、帧画廊、`Save to library` | `animSet`/`animStrip`、`imageProcessor`、`LibraryPanel` | 手动 E2E |

**边界原则**：`animSet.ts` / `animStrip.ts` 不认识 HTTP、不认识 React、不认识文件系统；运行器分两端但只调这两个模块 + 既有后处理。

## 5. 数据模型

### 5.1 输入规格 `AnimSetSpec`

```jsonc
{
  "actor": "chaser",                   // slug，[a-z0-9-]
  "subject": "a hulking armored beast chaser: …",   // 主体描述，进 prompt
  "dirs": ["east","south-east","south","south-west","west","north-west","north","north-east"],
  "states": [
    { "name": "idle",   "motion": "a calm breathing idle, stance settled", "frames": 4, "fps": 4, "loop": true },
    { "name": "walk",   "motion": "mid-step of a heavy stalking walk",     "frames": 4, "fps": 8, "loop": true }
  ],
  "cell": 512,                          // 每格边长 px
  "styleText": "Hand-painted dark-fantasy dungeon art, …",  // 内联进 prompt（artStyle 表是封闭的）
  "background": "magenta",              // 缺省
  "model": "teamo-router/gemini-3.1-flash-image",
  "out": "./out/chaser"
}
```

校验（`animSet.ts`，全部有测试）：`actor` 走 `[a-z0-9][a-z0-9-]{0,63}`；`dirs` 非空、无重复、每项 `[a-z-]`；`states` 非空、名字唯一；`frames` ≥ 1、`fps` ≥ 1；`cell` ∈ [64, 1024]；`width = cell × dirs.length` 必须 ≤ 4096（超过即报错而不是静默缩水）。

### 5.2 计划（纯函数）

`planStrips(spec)` → `[{ state, frame, index, prompt, width: cell*dirs.length, height: cell }]`，数量 = `Σ states.frames`（hero 2×4=8，怪物 4×4=16）。`frame` 为 **0-based** 帧序号；运行器渲染文件名时用 **1-based**（`f1..fN`），文件号 = `frame + 1`。这条进制差异只出现在运行器里，`set.json` 一律 0-based。

prompt 由 `animStrip.ts` 生成，包含：一行 N 格布局声明、**"cell i 面向 dirs[i]"的逐格枚举**（顺序即契约）、"每个生物完全在自己格内、四周留洋红沟槽、不得触碰格边或越格"、"背景是纯洋红 #FF00FF 场，不是场景"、"无地面/阴影/文字/网格线/边框/卡片"。风格文本来自 `styleText`。

### 5.3 产物

```
<out>/
  set.json
  raw/<state>_f<N>_<D>dir.png        # 模型原图（重切/复核用），N 为 1-based 帧号
  derived/<state>_f<N>_<dir>.png     # 切格 → 抠底 → 去边 → 归一化居中后的帧
```

`set.json`（中性契约，S2 只读它）：

```jsonc
{
  "schemaVersion": 1,
  "kind": "animation-set",
  "actor": "chaser",
  "dirs": ["east", "…"],
  "cell": 512,
  "states": [{ "name": "idle", "frames": 4, "fps": 4, "durationsMs": [250,250,250,250], "loop": true }],
  "strips": [{ "state": "idle", "frame": 0, "file": "raw/idle_f1_8dir.png", "ok": true,
               "seconds": 21.4, "requested": "4096x512", "returned": "4096x512", "prompt": "…" }],
  "frames": [{ "state": "idle", "dir": "east", "index": 0, "file": "derived/idle_f1_east.png", "strip": "raw/idle_f1_8dir.png" }],
  "backend": { "provider": "magpie", "model": "teamo-router/gemini-3.1-flash-image" }
}
```

### 5.4 库资产与 provenance

- 新 `AssetKind = 'animations'`（`app/lib/libraryTypes.ts` 的 `ASSET_KINDS`；route 的 `isValidKind` 与面板分组自动跟随，`libraryCollect.ts` 的判别式 union 新增分支——漏处理即编译失败）。
- 一个集 = 一个资产目录（`<project>/animations/<actor>/`）：`derived/*.png` + `set.json` + `meta.json`。
- `meta.json`：`files.derived` 收全部帧文件，`manifest` 放 `set.json` 的规格部分（不含逐帧文件名），`provenance`：`backend`（沿用 allow-list 机制）、`model`、`prompt`（首条 strip 的 prompt）、`params` = `{ dirs: n, states: [...], frames: n, cell, calls, cells, seconds }`、`requested`/`returned`（首张 strip 的尺寸对）、`cost`（沿用现有 `{usd, source} | null`；图像通道不报就是 null——游戏侧 ledger 同样只有秒数，这是实测事实）。**不引入双单位**（那是 PixelLab 后端的账，等第二个适配器再定）。
- `set.json` 存进资产目录、`meta.json.manifest` 只放规格：库的目录契约不因引擎需求而变；引擎契约不因库结构而变。

## 6. 表面契约

### 6.1 CLI

```
ie anim plan --spec <file.json>                    # 预演：打印逐 strip 计划 + 调用数 + 输出路径
ie anim run  --spec <file.json> --go [--redo] [--keep-going]
```

- 规格亦可内联：`--actor --subject-file <f> --states idle,walk --frames 4 --dirs 8 --cell 512 --style-file <f> --out <dir>`；`--model/--profile/--base-url` 用现有全局 flag。
- 输出沿用 `okEnvelope`：`plan` 返回计划数组；`run` 返回 `{ written, strips: [...], setJson }`。
- 入库不新增命令：复用 `ie library save <project> animations <actor> --sheet <raw> --derived <a,b,…> --meta <json>`（已存在）。
- 命令模块契约同 `cli/commands/library.mjs`（默认导出 `{ anim: spec }`，子命令取第一个位置参数），在 `cli/ie.mjs` 的 `COMMAND_MODULES` 注册。

### 6.2 UI

- 第 7 个模式 `anim`：`app/lib/app.ts` 的 `Mode` union、`app/components/TopBar.tsx` 一项、`app/page.tsx` 渲染分支、`app/components/AnimStudio.tsx`。
- 流程：填规格 → 显示计划与调用数 → 确认（不可逆的花钱点）→ 逐 strip 进度（复用 `StudioActionBar` 的 running/stop）→ 帧画廊（按状态分组、逐方向翻看）→ `Save to library`（复用 `LibraryPanel` 的对话框与 409 三选）。
- 文案进 `app/i18n/messages/anim.ts`（`en` + `zh`，在 `app/i18n/index.ts` 注册；zh 缺翻译是编译错误）。

## 7. 数据流

1. `plan`：规格 → 校验 → `planStrips()` → 展示（CLI 打印 / UI 计划面板）。
2. 逐 strip：`POST /api/generate`（现有 plain 形状：`prompt` + `width` + `height` + `model`；**不新增 wire kind**）→ 得 dataUrl。
3. 落盘 `raw/<state>_f<N>_<D>dir.png` + 记账（即时）。
4. 切格与归一化，全部复用既有实现：CLI 用 bridge 的 `sprite-align`（`cols=dirs.length, rows=1, cell=cell`，它内部就是 slice → chroma → removeFrameBorder → isolate → scale → center 这条链）；UI 直接在浏览器里调 `imageProcessor` 的同名函数。
5. 写 `derived/` + 追加 `frames[]` → 收敛后写 `set.json`。
6. `ie library save` / UI 的 `Save to library` 把 `<out>` 收进库。

**不做基线对齐**（不用 `alignSpriteFramesToBaseline`）：跨 8 个方向做统一基线会让俯视/仰视格互相打架；游戏侧同样是"trim 到自身 alpha 包围盒 → 套进固定内框"，不是统一基线。

## 8. 错误处理

| 情况 | 行为 |
|---|---|
| 单 strip 网络/5xx | 退避重试 2 次；仍失败 → 记 `ok:false`，**默认停止**（省钱，对齐游戏侧 `break`）；`--keep-going` 继续跑其余 |
| 切格后格数 ≠ 方向数，或整格空白 | 记 `ok:false` 并保留 raw；不静默产出错帧 |
| 中断（Ctrl-C / 关页面） | 已完成的 strip 已落盘，重跑时跳过（`--redo` 强制） |
| 规格非法 | 生成前 `400`-级报错，一个调用都不发 |
| `width` 超模型上限 | 生成前报错（`cell × dirs.length ≤ 4096`），不静默缩水 |
| 库不可用/未配置 | 生成与切格照常，只在 save 时报错（沿用库的既有降级语义） |

## 9. 待验证的风险点（**先探针，后实现**）

1. **magpie 是否接受 `4096×512`（8:1）**：magpie → `teamo-router/gemini-3.1-flash-image` 是同一模型的另一条通路，但精确比例是否透传未验。做法：跑一张真实 strip（一次调用，几美分量级），比对返回尺寸与 8 格布局。**失败预案**：在同一 provider 表里加 Teamo 直连（`~/.config/teamorouter/token` 或 `TEAMO_API_KEY`、以及 `api.teamorouter.com=43.128.25.159` 的 host pin——本地 DNS 被劫持，见游戏侧注释），接口与本 spec 不变，只换 transport。
2. **模型是否稳定给出一行 8 格**：游戏侧实测可行（4096×512 请求下逐格可切），但那是 Teamo 直连。探针一并记录"是否每格都落在预期位置、是否触碰格边"。
3. **帧间一致性**：逐帧独立生成会有跨帧漂移。这是既有事实，不是本 spec 的缺陷；对策（身份锚）见 §12，默认关。

## 10. 测试

- **单测（vitest）**：`planStrips` 的尺寸代数与调用数；prompt 必含逐格方向枚举、"不出格"与"纯洋红背景"约束、风格文本；`buildSetJson` 的 `durationsMs` 由 `fps` 推出（`1000/fps` 取整）；`nextPending` 状态机（跳过 ok / 重跑 `--redo` / 失败标记）；规格校验表（非法 dirs 重复、frames=0、cell 越界、`cell×dirs > 4096`）。
- **集成**：stub 网关（仓库既有做法）跑 `plan → 2 strips → 切格 → set.json` 短路径，断言文件树与 `set.json` 字段；切格失败路径断言 `ok:false` 且 raw 保留。
- **回归**：现有 studio 的 ZIP/manifest 导出逐字节不变（本次不改它们的调用路径）。
- **不做**：视觉回归（后处理全是复用代码，已有测试）。
- **人工 E2E 一次**：UI 跑完 hero 的 idle+walk（8 次调用）→ 入库 → 刷新页面 → 面板找回。

## 11. 与现有代码的接缝

**新增**：`app/lib/animSet.ts`、`app/lib/animStrip.ts`（+ `__tests__`）、`cli/commands/anim.mjs`、`app/components/AnimStudio.tsx`、`app/i18n/messages/anim.ts`。

**修改**：`app/lib/app.ts`（Mode）、`app/components/TopBar.tsx`、`app/page.tsx`（渲染分支）、`app/i18n/index.ts`（注册 namespace）、`app/lib/libraryTypes.ts`（`ASSET_KINDS`）、`app/lib/libraryCollect.ts`（collector 分支）、`cli/ie.mjs`（命令注册）、`docs/agent-api.md`、`README.md`。

**不动**：`/api/generate` 的 wire 形状（身份锚启用时才动）、`/api/library`、`app/utils/imageProcessor.ts` 的任何函数、现有 studio 的导出路径、`app/lib/pixel.ts`。

## 12. 后续（不在本次范围）

- **S2 引擎交付层**：读 `set.json` → 组装 per-actor atlas（行 = 方向×状态、列 = 帧）→ 写进 Godot 工程（或 `.tres`）；适配器表，Godot 先落地，其余引擎后加。
- **身份锚开关**：首帧作后续帧的参考图（`/api/generate` 已有 `spriteIdentityImage`/`propRefImage` 参考图管道，见 `route.ts:81-111,149`），需要给 wire 加一个中性字段；作为 S1 的可选项，默认关。
- **PixelLab 第二适配器**：`/characters/animations`（一次 job 出 4 帧 × 8 方向）+ `/animate-object`；届时再定成本双单位（generations 与 usd 两种计费单位实测并存）。
- **dark-black 侧收尾**：`gen_assets_teamo.py` 退役，只留 `build_handpainted_sheets.py` 这类消费端脚本（或一并收进 S2）。

## 附录 A：证据索引

| 断言 | 位置 |
|---|---|
| 每 (状态,帧) 一张 strip、8:1 精确比例 | `~/repos/dark-black/tools/gen_assets_teamo.py:95-118,155-163` |
| 方向顺序 = 运行时 sector 顺序 | 同上 `:38-40`；`tools/build_handpainted_sheets.py` docstring |
| `--go` 闸门、逐条记账 | 同上 `main()`；`assets/handpainted/sprites/<actor>/generation-ledger.json` |
| 组装（trim→fit→行=方向×状态） | `tools/build_handpainted_sheets.py` |
| 手绘优先、像素 fallback、像素已退役 | `scripts/actors/enemy.gd:84-87,192`；提交 `6abb5ed`（09-24）vs `e503ae1/8d27e67/a8ec4d7`（10-04） |
| PixelLab 8 向路线未落地 | 全仓无 `*east*`/`*south*` 文件；无 `generation-ledger-8dir.json` |
| magpie 可路由同一模型 | `app/lib/providers.ts:74,129` |
| 风格表封闭 | `app/lib/stylePrompt.ts:16+`、`app/lib/artStyles.ts` |
| 尺寸梯子无 8:1 | `app/components/Modals.tsx:836,853` |
| 后处理与 bridge op | `app/utils/imageProcessor.ts:2070`；`cli/native/bridge.mjs:155,179,276` |
| 库 kind 表 / collector union / CLI 契约 | `app/lib/libraryTypes.ts:8`；`app/lib/libraryCollect.ts:31-63`；`cli/commands/library.mjs:1-27`；`cli/ie.mjs:70-72` |
| 成本形状单一（仅 usd） | `app/lib/imageGeneration.ts:23`；`app/lib/generateCost.ts:13-15` |
| 参考图管道 | `app/api/generate/route.ts:81-111,149` |
