# 动画集生产（S1）：方向 × 状态 × 帧

日期：2026-10-06 · 版本：**v2**（v1 → v2 的修订见 §13）· 状态：待实现 · 适用仓库：`image-extender`（fork）· 消费端：`dark-black`（Godot 4.7）

## 0. 一句话

让 image-extender 能一次产出一个**动画集**——「方向 × 状态 × 帧」的完整帧序列、计时、成本与 provenance——用现在就能跑通的图像模型通道（exact-ratio strip），使 `dark-black/tools/gen_assets_teamo.py` 这条外部脚本路径退役。

## 1. 背景（现状与证据）

### 1.1 消费端今天怎么拿到动画

| 事实 | 证据（`~/repos/dark-black`） |
|---|---|
| 现行动画生产**不在本仓库**，在游戏侧 python 脚本里 | `tools/gen_assets_teamo.py`（v11 手绘线），它 shell out 到 agent skill 的 `~/.agents/skills/image-extender/scripts/ie.py --backend teamo` |
| 生成粒度 = 每 **(状态, 帧)** 一张 strip，一行 N 格 = N 个方向 | `gen_assets_teamo.py` docstring 与 `build_prompt()`：`"a flat 1-row x {n}-column strip of {n} equal square cells"` |
| 尺寸是精确整数比，靠"8 cells @ 8:1 是模型支持的精确比例、无需非等比缩放" | 同上 docstring；请求体 `{"width": 4096, "height": 512}`（8 向）与 `{"width": 2048, "height": 512}`（hero 4 向） |
| 方向顺序 = 运行时 sector 顺序（east 起顺时针），**顺序即契约**；hero 的 4 个方向是**命名绘制**（`down/side/up/back`），**不是** sector 顺序 | `DIRS8`/`DIRS4`；`tools/build_handpainted_sheets.py` docstring："row index = dir * n_states + state … direction order is the runtime's sector order"；`player.gd` 的命名方向约定 |
| 每 actor：`desc` + `states[]` + 每状态 `motion` 文案 + `frames`（4） | `gen_assets_teamo.py` 的 `ACTORS`（chaser/lunger 4 状态，hero 2 状态） |
| **每状态帧数必须一致**：`frame = row * FRAMES + col` 的寻址规则只在行等宽时成立 | `enemy.gd` 的 ruled-grid 契约；`tools/check_enemy.gd` 的门 |
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
| 通道与后处理都已具备（但见 §1.3 的四条实测缺陷） | `app/lib/providers.ts:74,129`；`app/utils/imageProcessor.ts`；`cli/native/bridge.mjs` |

### 1.3 研究实测（2026-10-06，`.planning/research/*`）

这八条是 v1 → v2 的全部依据；每一条都能复现。

| # | 事实 | 证据 |
|---|---|---|
| R1 | **8:1 出不了这个 app**：`/api/generate` 把 `width/height` 折进 10 值比例表（无 8:1/4:1）→ `4096×512` 与 `2048×512` **都变 21:9**（APIMart 是 3:1）；chat 适配器**根本不发 width/height**。模型本身支持 8:1 | `app/api/generate/route.ts` 的 `SUPPORTED_IMAGE_ASPECT_RATIOS` / `supportedAspectRatioForSize`；live 探测 `openrouter.ai/api/v1/images/models` |
| R2 | **magpie 有 ~15s 硬超时**：3 次探测 12–15s 返 504；`usage.jsonl` 历史上仅 2 次成功图像生成（29s / 35s），而一条 strip 要 20–70s → 预期失败模式是**超时**，不是比例 | `POST 127.0.0.1:3425/v1/images/generations`；`~/.config/magpie/usage.jsonl` |
| R3 | **`sprite-align` 不能当单元用**：它无条件跑 `normalizeSpriteFrameScale → alignSpriteFramesToBaseline(cell*0.9) → center`，把俯视/仰视格钉到同一地面、缩放迁就基线、且丢超出格边的内容 | `cli/native/bridge.mjs:276-329` |
| R4 | **近似均匀网格上均匀切格仍然破坏画面**：40 条已交付 strip 的拟合 pitch 与 `W/N` 平均差 0.91%（≤2.25%），但 224 条切线有 68 条切到生物像素、32 条 strip 里 23 条中招；且 `sliceImageGrid` 会把整张图缩放到 `cols×cellSize`（每格 ~3.4× 横向压扁） | `.planning/research/STACK.md`、`ARCHITECTURE.md`、`PITFALLS.md`；`imageProcessor.ts:2082-2095` |
| R5 | **一次 8 向 × 4 帧的集存不进库**：16 张真实 raw = **363.8M** base64 字符 > route 上限 **279.6M**，413 只在 body 缓冲完之后才发生 | `app/api/library/[[...path]]/route.ts:14-16` |
| R6 | **provenance 会自信地撒谎**：`BACKEND_LABELS=['openrouter','pixellab']` 兜底 `openrouter`；`extractCost` 写死 `source:'openrouter'`；`ie library save` **硬编码 `backend:'openrouter'`** | `libraryCollect.ts:20`、`generateCost.ts:13-15`、`cli/commands/library.mjs:166` |
| R7 | **续跑会被非原子写毒化**：`cli/lib/media.mjs` 的 `writeDataUrl` 非原子 → 截断 PNG 永远被"文件存在"跳过；消费端 ledger 已有 17 行 / 16 条 strip 的重复计费 | `cli/lib/media.mjs`；`chaser/generation-ledger.json` |
| R8 | Godot 4.7 侧已实测（S2 用）：`SpriteFrames` `.tres` 结构、`AtlasTexture.filter_clip` 才是防渗色开关（`hframes/vframes` 路径会把它关掉）、`.tres` 由 headless Godot 4.7.2 生成并回读通过 | `.planning/research/STACK.md`；Godot 4.7 文档与引擎源码 |

## 2. 目标与成功标准

1. **一个规格 → 一整个动画集**：给出 actor 描述、状态列表（含每状态 motion 文案与帧数）、方向预设、cell 边长，得到 `Σ states.frames` 张 strip 的完整计划，并可无人值守跑完。
2. **产物是中性的**：`set.json` + `derived/<state>_f<N>_<dir>.png`，不含任何 Godot 词汇；S2 引擎适配器只读它。
3. **可入库、可追溯**：动画集是一个库资产（`kind: animations`），provenance 记录后端、模型、规格、**请求 vs 实际尺寸**、拟合出的网格参数、成本（网关报了才记）、调用数与耗时——且 `backend` 与 `cost.source` 必须一致（R6）。
4. **省钱纪律**：任何生成前必须先看到计划与调用数（含每张画布与总量）；CLI 需 `--go`，UI 需二次确认。
5. **两端同期**：CLI 与 UI 调**同一份纯函数核心**，口径一致（含"一张 strip 如何变成帧"这件事只允许有一处实现）。
6. **几何必须被验证而不是被假设**：每张 strip 断言"每条切线落在接近空白的 gutter 列上"（R4）；`returned` 比例与 `requested` 不符即 `ok:false`（R1）。
7. 现有 studio 的产物与 ZIP/manifest 导出**逐字节不变**；`AssetMeta` 保持 `schemaVersion: 1`。

## 3. 非目标

- **组装**：trim→fit→拼成"行 = 方向×状态"的 per-actor atlas、写进 Godot 工程、生成 `.tres`/`.import` —— 全部属于 S2（引擎交付层）。
- **PixelLab 动画端点**（`/characters/animations`）：作为第二个 backend 适配器，接口按本 spec 的模型设计，但不在本次实现。
- **新增第四个 provider**：R2 的 fallback 是一个 **magpie profile**（`baseUrl` + `apiKeyEnv`），不是新 ProviderId。
- **新增 API 路由 / 新增 wire kind**：strip 走现有 plain 形状；唯一允许的传输侧改动是 §9 的条件性比例表放宽。
- 身份锚（首帧作后续帧参考图）：v1 默认关闭，见 §12。
- 修改任何后处理**算法**与现有 studio 的导出路径；改 `AssetMeta` schema；成本双单位。
- 批量队列/调度器、多用户、服务端实例。

## 4. 架构与单元边界

```
        ┌─ CLI:  cli/commands/anim.mjs ──┐
规格 ──▶ │  ie anim plan | run --go       │──┐
        └────────────────────────────────┘  │
        ┌─ UI:   app/components/AnimStudio.tsx ─┐   ▼
        └────────────────────────────────────┘  app/lib/animSet.ts   （纯：规格校验 / 计划 / set.json / 续跑判定 / durationsMs）
                                                app/lib/animStrip.ts （纯：strip prompt + cell↔方向映射 + 面板网格拟合代数）
                                                        │
                                     ┌──────────────────┴──────────────────┐
                                     ▼                                     ▼
                       /api/generate（现有 plain 形状）        后处理：一张 strip → N 帧
                       width=cell×dirs, height=cell           CLI: bridge 新 op 'strip-frames'
                                                              UI : imageProcessor 同函数（同一条链）
```

| 单元 | 职责 | 依赖 | 可独立测试 |
|---|---|---|---|
| `app/lib/animSet.ts` | `AnimSetSpec` 校验（含"每状态帧数一致"）、`planStrips()`、`buildSetJson()`、`nextPending()`（**从记录判定**，不是从文件存在判定）、`durationsMs` 由 `fps` 推出 | 无（纯） | 可（vitest） |
| `app/lib/animStrip.ts` | strip prompt 组装（逐格方向枚举、格内包含、纯洋红场、禁止卡片/文字/网格线）、`stripSize()` 代数、**面板网格拟合**（对列质量剖面拟合 `(spacing, phase)` 的纯函数） | 无（纯） | 可（vitest，喂合成剖面） |
| `cli/commands/anim.mjs` | 调 plan → 逐 strip 打 `/api/generate` → 原子写 `raw/` → 调 bridge `strip-frames` → 原子写 `derived/` + `set.json`；ledger 合并 + 唯一性断言 | `animSet`/`animStrip`、`cli/lib/*`、`cli/native/bridge.mjs` | 可（stub 网关） |
| `strip-frames`（bridge 新 op） | `panel-fit → chromaKeyToAlpha(按实测场色、二值) → removeFrameBorder → isolatePrimarySpriteComponent → 套进固定 cell 居中`，**基线对齐显式关闭**；每步 best-effort 都返回计数器 | 既有 `IE.*` 导出 | 可（`node --test` 对真实 PNG 字节） |
| `app/components/AnimStudio.tsx` | 规格表单、计划确认（第二道花钱闸门）、逐 strip 进度、帧画廊（含方向矩阵视图）、`Save to library` | `animSet`/`animStrip`、`imageProcessor`（**同一条链**）、`LibraryPanel` | 手动 E2E |

**边界原则**：两个纯模块不认识 HTTP/React/fs；"一张 strip 如何变成帧"只允许一处实现（CLI 经 op、UI 经同名函数），私有副本正是 `app/lib/chromaPresets.ts` 记录过的付过一次的错。

## 5. 数据模型

### 5.1 输入规格 `AnimSetSpec`

```jsonc
{
  "actor": "chaser",                    // slug，[a-z0-9-]，且必须合法于库的 FILE_RE
  "subject": "a hulking armored beast chaser: …",
  "dirs": "dirs8",                      // 命名有序预设：dirs8（东起顺时针=sector 序）| dirs4（down/side/up/back）
  "states": [
    { "name": "idle", "motion": "a calm breathing idle, stance settled", "frames": 4, "fps": 4, "loop": true },
    { "name": "walk", "motion": "mid-step of a heavy stalking walk",     "frames": 4, "fps": 8, "loop": true }
  ],
  "cell": 512,
  "styleText": "Hand-painted dark-fantasy dungeon art, …",   // 内联进 prompt（artStyle 表封闭）
  "background": "magenta",
  "model": "teamo-router/gemini-3.1-flash-image",
  "out": "./out/chaser"
}
```

校验（全部有测试）：`actor` 匹配 `[a-z0-9][a-z0-9-]{0,63}` 且对 FILE_RE 合法；`dirs` 为已知预设名（展开后非空、无重复）；`states` 非空、名字唯一、**所有状态 `frames` 相同**（R8/1.1 的寻址规则，不同直接报错）；`frames ≥ 1`、`fps ≥ 1`；`cell ∈ [64, 1024]`；`cell × dirs.length ≤ 4096`（超过报错，不静默缩水）。

### 5.2 计划与几何（纯函数）

- `planStrips(spec)` → `[{ state, frame, index, prompt, width: cell*dirs.length, height: cell }]`，数量 = `Σ states.frames`（hero 2×4=8，怪物 4×4=16）。`frame` **0-based**；文件名 **1-based**（`f1..fN`，文件号 = `frame+1`），`set.json` 一律 0-based。
- `stripSize(spec)` → `{ width, height, aspect }`。
- `fitPanelGrid(profile)` → `{ spacing, phase, residual }`：对列质量剖面做**搜索**（不是常量），用于切格；判定闸门是"每条切线落在接近空白的 gutter 列上"，**不是**拟合质量本身（R4）。
- prompt 由 `animStrip.ts` 生成：一行 N 格布局声明、**"cell i 面向 dirs[i]"逐格枚举**、格内包含 + 四周沟槽、纯洋红场、"无地面/阴影/文字/网格线/边框/卡片"。

### 5.3 产物

```
<out>/
  set.json
  raw/<state>_f<N>_<D>dir.png        # 模型原图（重切/复核用）；从不进库、从不进 git
  derived/<state>_f<N>_<dir>.png     # 切格 → 抠底 → 去边 → 套 cell 居中
```

`set.json`（中性契约，S2 只读它）：

```jsonc
{
  "schemaVersion": 1,
  "kind": "animation-set",
  "actor": "chaser",
  "dirs": { "preset": "dirs8", "order": ["east","…"] },
  "cell": 512,
  "states": [{ "name": "idle", "frames": 4, "fps": 4, "durationsMs": [250,250,250,250], "loop": true }],
  "strips": [{
    "state": "idle", "frame": 0, "file": "raw/idle_f1_8dir.png", "ok": true, "seconds": 21.4,
    "requested": "4096x512", "returned": "11712x1408",
    "fitted": { "spacing": 1464.0, "phase": 72, "residualPct": 0.9, "gutterOk": true },
    "field": { "hex": "#FF07F6", "cast": 237, "preset": "binary" },
    "steps": { "borderTrimmed": 8, "isolated": 2, "fitShrunk": 3 },
    "prompt": "…"
  }],
  "frames": [{ "state": "idle", "dir": "east", "index": 0, "file": "derived/idle_f1_east.png", "strip": "raw/idle_f1_8dir.png" }],
  "backend": { "provider": "magpie", "model": "teamo-router/gemini-3.1-flash-image" },
  "totals": { "calls": 16, "cells": 128, "seconds": 512.3 }
}
```

要点：**`requested` 与 `returned` 都记**（R1：二者不等是常态）；`fitted` 记**实际拟合到的值**（R4：让探针的答案改一个数字而不是改设计）；`field` 记实测场色与所用 key 预设（R4/研究缺口：`FF07F6` 与 `DFC7D2` 两种场色都出现过，`default` 预设的软边在 512px 下是错的选择）；`steps` 是 best-effort 步骤的计数器（一个静默 no-op 必须能被看见）。

### 5.4 库资产与 provenance（含载荷约束）

- 新 `AssetKind = 'animations'`（`libraryTypes.ts` 的 `ASSET_KINDS`；route 的 `isValidKind` 与面板分组跟随；`libraryCollect.ts` 判别式 union 新增分支——漏处理即编译失败）。
- **载荷约束（R5）**：库资产 **只收 `derived/` + `set.json` + `meta.json`，raw 永不入库**（16 张真实 raw = 363.8M base64 字符 > 279.6M 上限；且在 body 缓冲完之后才 413）。需要复核原始 strip 时看工作目录（gitignore 规则写进 producer 自己的文档）。
- `meta.json`：`files.derived` = 全部帧文件；`manifest` **只放规格块**（放帧清单就是第二个事实源，会漂）；`provenance`：`backend`、`model`、`prompt`（首张 strip 的 prompt）、`params = { dirs, states, frames, cell, calls, cells, seconds }`、`requested`/`returned`、`cost`。
- **provenance 诚实性（R6）**：`BackendLabel = ProviderId | 'pixellab'`（一处定义，route 与 CLI 共用）；`cost: null` 除非网关真报了；断言 `cost.source === backend`；`cli/commands/library.mjs` 硬编码的 `backend:'openrouter'` 在 E2E 之前修掉——E2E 是验收证据，会把错标签固化。
- **不做双单位**（generations 是 PixelLab 后端的账，留给第二适配器）。

## 6. 表面契约

### 6.1 CLI

```
ie anim plan --spec <file.json>                          # 预演：逐 strip 画布 + 调用数 + 总量 + 输出根
ie anim run  --spec <file.json> --go [--redo state:frame] [--keep-going]
```

- 内联规格亦可：`--actor --subject-file <f> --states idle,walk --dirs dirs8 --cell 512 --style-file <f> --out <dir>`；`--model/--profile/--base-url` 用现有全局 flag。
- 输出沿用 `okEnvelope`：`plan` 返回计划数组；`run` 返回 `{ written, strips, setJson }`。
- 入库复用 `ie library save`（**先修其 backend 硬编码**，见 §5.4）。
- 命令模块契约同 `cli/commands/library.mjs`（默认导出 `{ anim: spec }`，子命令取第一个位置参数），在 `cli/ie.mjs` 的 `COMMAND_MODULES` 注册。

### 6.2 UI

- 第 7 个模式 `anim`：`app/lib/app.ts` 的 `Mode`、`TopBar` 一项、`app/page.tsx` 渲染分支、`app/components/AnimStudio.tsx`。
- 流程：填规格 → 计划确认（花钱点）→ 逐 strip 进度 → 帧画廊（按状态分组 + **方向矩阵**视图：一行一个 sector、一列一个状态、取第 1 帧）→ `Save to library`。
- 文案进 `app/i18n/messages/anim.ts`（en/zh；zh 缺键是编译错误）；**同时改两处不会编译失败的硬编码 mode 清单**：`app/i18n/__tests__/messages.test.ts:80` 与 `e2e/studio-library.spec.ts:17-24`。

## 7. 数据流

1. `plan`：规格 → 校验 → `planStrips()` → 展示（CLI 打印 / UI 计划面板）。
2. 逐 strip：`POST /api/generate`（现有 plain 形状：`prompt` + `width` + `height` + `model`；**不新增 wire kind**）→ 得 dataUrl。
3. **立即原子写** `raw/<state>_f<N>_<D>dir.png`（temp + rename，R7）+ 记账 → 从**实际字节**读回尺寸并记 `returned`；与 `requested` 比例不符 → `ok:false`（R1）。
4. 一张 strip → N 帧：`strip-frames` op（CLI）或同一函数链（UI）——`fitPanelGrid` → 每格 key → trim → isolate → 套 cell 居中。**基线对齐显式关闭**（R3）；每步 best-effort 返回计数器。
5. 断言每条切线落在接近空白的 gutter 列（R4）→ 通过则原子写 `derived/` + 追加 `frames[]`。
6. 收敛后写 `set.json`（含 `fitted`/`field`/`steps`/`totals`）。
7. `ie library save` / UI `Save to library` 把 `<out>/derived` + `set.json` 收进库（raw 不入库）。

## 8. 错误处理

| 情况 | 行为 |
|---|---|
| 单 strip 网络/5xx/超时 | 退避重试 2 次；仍失败 → `ok:false`，**默认停止**（省钱，对齐消费端 `break`）；`--keep-going` 才继续 |
| `returned` 比例 ≠ `requested` | `ok:false` 且**不切格**（切格会把错误比例"修好"，这正是 R1 的坑） |
| gutter 断言失败（切线切到生物） | `ok:false`，保留 raw，不产出错帧；可用 `--redo state:frame` 单条重跑 |
| 格数 ≠ 方向数 / 整格空白 | `ok:false`，保留 raw |
| 中断（Ctrl-C / 关页面） | 完成判定来自记录（`ok:true` ∧ raw 可解码 ∧ derived 数量符合预期），**不是文件存在**；`--redo` 强制重做 |
| 记录里有重复 `(state, frame)` | 合并并断言唯一（消费端 17/16 的重复计费就是 append 不 merge 造成的） |
| 规格非法（含每状态帧数不一致） | 生成前报错，一个调用都不发 |
| `cell × dirs > 4096` | 生成前报错，不静默缩水 |
| 库不可用/载荷超限 | 生成与切格照常，只在 save 时报错（沿用库的降级语义）；载荷按 §5.4 只送 derived |

## 9. 探针与传输（**先探针，后实现**）

**Phase 1 的唯一交付物是一次真实调用 + 一个传输决定**，因为它的答案会成为后续所有代码里的常量。

1. **跑一张真实 strip**（一次调用），记录：`returned` 尺寸 vs `requested`、拟合出的 `(spacing, phase)`、场色、每格是否触碰格边。
2. **预期失败模式是超时而不是比例**（R2）：magpie 有 ~15s 天花板，图像生成历史上要 29–35s。若 504 → 启用 **Teamo 直连 fallback，但表达为 magpie profile**（`app/lib/ieConfig.ts:132-139` 允许 magpie 配 `baseUrl`；加 `apiKeyEnv` 指向 `TEAMO_API_KEY` / `~/.config/teamorouter/token`；注意本机 DNS 被劫持，需要 `api.teamorouter.com=43.128.25.159` 的 host pin）——**绝不新增第四个 provider**，接口不变。
3. **条件性放宽比例表**：只有在探针证明现有通路无论如何都送不出 8:1/4:1 时，才改 `SUPPORTED_IMAGE_ASPECT_RATIOS`（加 8:1 与 4:1）。**必须同时重算 blast radius**：56 组 `width×height` 组合里有 10 组会改变最近的档位（例如 1920×720 21:9→3:1、512×1536 9:16→1:3），而**现有六个 studio 的请求一个都不变**（4096×4096→1:1、2048×1024→16:9、1024×1024→1:1、512×512→1:1）。验证以**返回比例**为准，不以打印的计划为准。
4. **APIMart 侧**：`gpt-image-2-official` 接受精确像素但单边上限 3840 → 8:1 strip 是 `3840×480`，不是 `4096×512`；作为备选通道记录，不作为首选。
5. **帧间一致性**：逐帧独立生成会有跨帧漂移（实测 chaser 均值 |ΔRGB| 5.9、lunger 7.0、最大 74）。这是既有事实；对策（身份锚）见 §12，默认关。

## 10. 测试

- **单测（vitest）**：`stripSize` 代数与调用数；prompt 含逐格方向枚举/不出格/纯洋红/风格文本；`buildSetJson` 的 `durationsMs`（`1000/fps` 取整）；`nextPending` 状态机（跳过 ok / `--redo` / 失败标记 / 截断 raw 视为未完成）；规格校验表（dirs 预设非法、frames 不一致、frames=0、cell 越界、`cell×dirs>4096`）；**命名函数的 1-based↔0-based 两个边界值**；**`fitPanelGrid` 对合成剖面**（均匀、带相位偏移、含噪声）。
- **bridge op 冒烟（`node --test`，对真实 PNG 字节）**：用仓库里已交付的 `chaser` strip 跑 `strip-frames`，断言每格角点透明、内容 bbox 留边 ≥ 2px、gutter 断言通过、计数器非零。
- **集成（stub 网关）**：`plan → 2 strips → 切格 → set.json` 短路径，断言文件树与 `set.json` 字段；失败路径断言 `ok:false` 且 raw 保留；**截断 raw 的续跑用例**（写一半的 PNG 必须被重跑）。
- **回归**：现有 studio 的 ZIP/manifest 导出逐字节不变。
- **E2E（人工一次，Phase 7）**：hero 的 idle+walk（8 次调用）→ 入库 → 刷新页面后仍能找回；断言 `params.calls` 与 `ok:true` 条数一致、per-row bbox stddev 在阈值内。
- **不做**：视觉回归（后处理全是复用代码）。

## 11. 与现有代码的接缝

**新增**：`app/lib/animSet.ts`、`app/lib/animStrip.ts`（+ `__tests__`）、`cli/commands/anim.mjs`、`app/components/AnimStudio.tsx`、`app/i18n/messages/anim.ts`、bridge op `'strip-frames'`。

**修改**：`app/lib/app.ts`（Mode）、`app/components/TopBar.tsx`、`app/page.tsx`（渲染分支）、`app/i18n/index.ts`、`app/i18n/__tests__/messages.test.ts`、`e2e/studio-library.spec.ts`、`app/lib/libraryTypes.ts`（`ASSET_KINDS`）、`app/lib/libraryCollect.ts`（`BackendLabel` + collector 分支）、`cli/commands/library.mjs`（backend 硬编码）、`cli/lib/media.mjs`（原子写）、`cli/ie.mjs`（注册）、`docs/agent-api.md`、`README.md`；**条件性**：`app/api/generate/route.ts`（仅 §9.3 的比例表放宽）。

**不动**：`/api/library` 的协议与 schema、`app/utils/imageProcessor.ts` 的任何函数、现有 studio 的导出路径、`app/lib/pixel.ts`、provider 数量。

## 12. 后续（不在本次范围）

- **S2 引擎交付层**：读 `set.json`（含 `fitted`）→ 组装 per-actor atlas（行 = 方向×状态、列 = 帧）→ Godot 原生输出（`SpriteFrames` `.tres` 用 `AtlasTexture(region, filter_clip=true)`，已实测可生成并回读）；适配器表，Godot 先落地。
- **身份锚开关**：首帧作后续帧参考图（`/api/generate` 已有 `spriteIdentityImage`/`propRefImage` 管道，`route.ts:81-111,149`），需要给 wire 加中性字段。
- **调色板锁定/抽取**（从已交付语料抽调色板）：修的是一个**实测过的**消费端失败，但不是 S1 所需。
- **PixelLab 第二适配器**：`/characters/animations` + `/animate-object`；届时再定成本双单位。
- **dark-black 侧收尾**：`gen_assets_teamo.py` 退役；raw-strip 的 ignore 规则写进 producer 文档。

## 13. 修订记录（v1 → v2）

v2 只依据 §1.3 的实测，改动如下：

1. **传输**（§6/§9）：新增"精确尺寸透传"为 Phase 1 交付物；预期失败模式改为**超时**；fallback 从"加 Teamo provider"改为 **magpie profile**。
2. **后处理**（§7）：不再复用 `sprite-align`（R3），改为新 op `strip-frames`，基线对齐显式关闭，best-effort 步骤全部计数。
3. **切格**（§4/§5.2/§7）：从"均匀切格"改为**拟合网格 + gutter 断言**；`set.json` 记录实际拟合值；标注 `sliceImageGrid` 的隐式缩放不可用（R4）。
4. **入库**（§5.4）：raw 永不入库；集资产 = derived + set.json + meta.json；`manifest` 只放规格（R5）。
5. **provenance**（§5.4/§11）：`BackendLabel = ProviderId | 'pixellab'`；`cost` 报才记；断言 `cost.source === backend`；E2E 之前修 `ie library save` 的硬编码（R6）。
6. **续跑**（§8）：完成判定从"文件存在"改为"记录 + 可解码 + 数量"，全部产物原子写，ledger 按 `(state, frame)` 合并并断言唯一（R7）。
7. **规格**（§5.1）：方向改为命名有序预设（`dirs8`/`dirs4`，hero 的 4 向不是 sector 序）；**每状态帧数必须一致**；`cell×dirs > 4096` 报错。
8. **验收与接缝**（§6.2/§10/§11）：两处硬编码 mode 清单同批修改；E2E 增加 `params.calls` 对账与 per-row bbox stddev 阈值。

## 附录 A：证据索引

| 断言 | 位置 |
|---|---|
| 每 (状态,帧) 一张 strip、精确比例、方向 = sector 序、每状态帧数一致 | `~/repos/dark-black/tools/gen_assets_teamo.py`；`tools/build_handpainted_sheets.py`；`scripts/actors/enemy.gd`、`player.gd`、`tools/check_enemy.gd` |
| 组装（trim→fit→行=方向×状态）与 `panel_boxes` 网格搜索 | `tools/build_handpainted_sheets.py` |
| `--go` 闸门、逐条记账、重复计费（17/16） | `gen_assets_teamo.py` main()；`assets/handpainted/sprites/chaser/generation-ledger.json` |
| 手绘优先、像素 fallback、像素已退役 | `scripts/actors/enemy.gd:84-87,192`；`6abb5ed` vs `e503ae1/8d27e67/a8ec4d7` |
| 比例表降级（无 8:1/4:1）与 blast radius | `app/api/generate/route.ts`（`SUPPORTED_IMAGE_ASPECT_RATIOS`、`supportedAspectRatioForSize`）；`.planning/research/STACK.md` |
| magpie ~15s 天花板与历史成功记录 | `.planning/research/STACK.md`；`~/.config/magpie/usage.jsonl` |
| `sprite-align` 无条件基线对齐 | `cli/native/bridge.mjs:276-329` |
| 网格拟合与切线安全（40 条 strip / 224 条切线 / 68 条切到生物） | `.planning/research/{STACK,ARCHITECTURE,PITFALLS}.md` |
| 载荷上限与 363.8M/279.6M 算术 | `app/api/library/[[...path]]/route.ts:14-16`；`.planning/research/PITFALLS.md` |
| provenance 三处硬编码 | `app/lib/libraryCollect.ts:20`、`app/lib/generateCost.ts:13-15`、`cli/commands/library.mjs:166` |
| 非原子写与续跑毒化 | `cli/lib/media.mjs`；`app/lib/library.ts:96-111`（仓库内已有的原子模式） |
| Godot 4.7 消费契约 | `.planning/research/STACK.md`（headless 4.7.2 生成并回读 `.tres`） |
