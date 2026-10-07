# Phase 3: strip → frames 后处理（bridge op `strip-frames`）- Context

**Gathered:** 2026-10-07
**Status:** Ready for planning

<domain>
## Phase Boundary

新增**一个** bridge op，把"一张真条带 → N 帧"实现成对既有 `IE.*` 导出的薄组合：拟合网格切格 → 抠底 → 去边 → 套进固定 cell 居中。**基线对齐显式关闭**，每个 best-effort 步骤都返回计数器，并带上 gutter 与几何断言。CLI（Phase 4）与界面（Phase 6）都调它，不许有第二份实现。

不做的事：不发请求（Phase 4）、不做库的 kind 与 provenance（Phase 5）、不做界面（Phase 6）。

</domain>

<decisions>
## Implementation Decisions

### 边界被占时怎么办（实测已发生：gutter_ok=false）
- **D-22:** 先用 `isolatePrimarySpriteComponent` **抢救**（以格中心为种子取连通块，把邻格伸过来的残肢切掉），抢不干净才判该条 `ok:false` 并保留 raw。拟合值与 gutter 判定无论如何都记进 `meta`，让上层能分辨"格子本身不好"与"抢救没成功"。理由：实测 8 条切线里只有 1 条踩线，而那条本身可能救得回来；直接毙掉代价太大。— **Reversibility:** reversible。

### 抠底
- **D-23:** 在 `app/lib/chromaPresets.ts` 新增一档 **`binary`**（洋红度阈值拉高、软边宽度 0 = 二值、保留 despill），本阶段默认用它。理由：探针实测底色 `#FC06FA`（cast 244）是**饱和洋红**，`default` 的软边（30）会在整格上留一层半透明。参数进预设表而不是散在调用点——"一处一个事实"。— **Reversibility:** costly —— 预设是三个界面共用的表，改数值会同时改变既有 studio 的观感。

### 缩放与套格
- **D-24:** trim 到 alpha 包围盒 → **等比缩到内容 ≤ cell × 0.875**（与消费端 64/56 同比例）→ 居中贴入；缩放用**最近邻**（`imageSmoothingEnabled = false`），避免把像素画插值糊掉。— **Reversibility:** reversible。

### op 的形状
- **D-25:** 沿用 bridge 既有形状：输入 `IN[0]`（图）+ `opts`（`N` / `cell` / 阈值 / 预设），输出 `{ data: string[] }`（N 帧）+ `meta: { fitted, gutter, counters, preset }`。阈值默认取 Phase 1 实测值，但仍可从 opts 覆盖（Phase 1 的教训：拟合必须是搜索，参数化才好在闸门里收紧）。— **Reversibility:** reversible。

### 冒烟测试
- **D-26:** 在**真实 fixture**（`tests/fixtures/anim/chaser_idle_f1_8dir.png`，2048×246）上跑完整断言组：每帧尺寸恰为 `cell`、四角透明、内容留边 ≥ 阈值、`meta` 里的拟合值与 gutter 判定被记录、每个 best-effort 步骤计数器非零；并断言整条链里**没有**基线对齐（行为 + 源码双查）。理由：合成图测不出"真模型画的条带"的脾气。
- **D-27:** **不使用 `sprite-align`**（它无条件跑 `alignSpriteFramesToBaseline`，会把俯视/仰视格钉到同一地面并丢内容）——这是 Phase 1 就定下的结论，本阶段把它写死进 CONTEXT，防止有人图省事复用它。

### the agent's Discretion
- 抢救的具体判定（连通块阈值、最小面积、什么时候算"抢不回来"）由你决定，但必须：① 计数器记录抢了几格；② 抢救失败时该条 `ok:false` 而不是静默产出一张错帧。
- 去边的强度、留边阈值的具体数字由你定，但要与 D-24 的 0.875 自洽。

</decisions>

<canonical_refs>
## Canonical References

### 规格与需求
- `docs/superpowers/specs/2026-10-06-animation-set-production-design.md` §7（数据流：panel-fit → chroma → removeFrameBorder → isolate → 套 cell）、§8（错误处理）、§10（测试）
- `.planning/ROADMAP.md` §Phase 3 · `.planning/REQUIREMENTS.md`（POST-01/02/03/05、GEOM-02）

### Phase 1 的实测输入（本阶段的参数来源）
- `.planning/phases/01-transport-probe/01-PROBE-RECORD.md` — 2928×352、底色 `#FC06FA` cast 244、pitch 360/phase 20、**gutter_ok=false**（x=2180 占满）
- `scripts/probe-measure.mjs` — Phase 1 的剖面与拟合语义（Phase 2 已把它变成纯函数，本阶段调纯函数而不是这份脚本）
- `tests/fixtures/anim/chaser_idle_f1_8dir.png` — 冒烟用的真图（2048×246）

### 本仓库要复用的实现（只组合，不重写）
- `app/utils/imageProcessor.ts` — `chromaKeyToAlpha:1445`、`sliceImageGrid:2070`、`removeFrameBorder:2914`、`isolatePrimarySpriteComponent:3132`、`normalizeSpriteFrameScale:2804`（**本阶段不用**，见 D-24）、`alignSpriteFramesToBaseline:2601`（**禁用**，见 D-27）
- `app/lib/chromaPresets.ts` — 预设表与 `CHROMA`（新增 `binary` 档的落点）
- `cli/native/bridge.mjs` — op 注册与既有 `slice`/`chroma`/`sprite-align` 的写法参照

### Phase 2 的纯函数（本阶段调用方）
- `app/lib/animStrip.ts` — `columnProfile` / `fitPanelGrid` / `DIRS8`；切格的参数从它来

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `isolatePrimarySpriteComponent`：现成的"取主连通块"实现，D-22 的抢救就是它。
- `chromaKeyToAlpha` 的 `CHROMA_PRESETS` 机制：新增一档只改表、不动三个调用点。
- bridge 既有 op 的 `{ data, meta }` 契约：CLI 与界面都按这个形状取结果，本阶段照抄。

### Established Patterns
- 浏览器侧像素运算一律在 `app/utils/*`，Node 侧只经 bridge 调它——本阶段不引入第二套像素实现。
- best-effort 步骤必须可计数（Phase 1 的教训：静默 no-op 与成功无法区分）。

### Integration Points
- Phase 4 的 CLI 与 Phase 6 的界面都调这个 op / 同名函数链；"一张 strip 如何变成帧"只允许一处实现。

</code_context>

<specifics>
## Specific Ideas

- 用户明确：切线被占**先抢救**（isolate），抢不回来才失败。
- 用户明确：**新增 `binary` 档**，不复用 `prop`。
- 用户明确：**87.5% 留边 + 最近邻**缩放。
- 用户明确：op 沿用 bridge 既有形状。
- 用户明确：冒烟在**真实 fixture** 上跑完整断言组。

</specifics>

<deferred>
## Deferred Ideas

- 用 `normalizeSpriteFrameScale` 做缩放 —— 不做（插值会改像素观感）。
- 用 `sprite-align` 一条命令搞定 —— 不做（它带基线对齐）。
- 逐帧人工微调 UI —— 后续里程碑。

</deferred>

---

*Phase: 3-strip-frames*
*Context gathered: 2026-10-07*
