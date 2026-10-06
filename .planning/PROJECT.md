# Image Extender — 游戏美术生产管线（fork）

## What This Is

`boona13/image-extender` 的 fork：把一个 BYOK、无状态、跑在浏览器里的 AI 图像工作室，改造成**面向独立游戏的美术生产管线**——产物落成磁盘资产库（可 git 共享、可追溯每个资产的 prompt/参数/成本）、多生成网关（OpenRouter / Magpie / APIMart / PixelLab）、中英双语 UI、以及可被脚本与 agent 驱动的无头 CLI（`ie`）。第一个真实消费者是同一作者的 Godot 4.7 项目 `dark-black`，当前要补的能力是**动画集生产**（方向 × 状态 × 帧）。

## Core Value

**一个规格产出一整套能直接进游戏的资产**（帧文件 + 计时 + provenance），使游戏侧那些一次性脚本永远退役。

## Requirements

### Validated

<!-- 由现有代码反推（brownfield），对应 `.planning/codebase/*` 的映射结果 -->

- ✓ 磁盘资产库：原子写、路径前缀校验、409 冲突三选（覆盖/`-v2`/取消）、`<project>/<kind>/<slug>/` 目录隔离、`meta.json` provenance（backend/model/prompt/params/请求 vs 实际尺寸/成本） — `app/lib/library.ts`、`app/lib/libraryPath.ts`、`app/api/library/[[...path]]/route.ts`
- ✓ 多网关收敛成一张 provider 表 + 实测过的模型 allow-list（APIMart 45 个 id 逐一探测） — `app/lib/providers.ts`、`app/lib/apimartServer.ts`
- ✓ 无头 CLI `ie`：复用 app 的模块与浏览器侧后处理（headless Chromium bridge），覆盖 studio / 像素 / 库 / 配置 / doctor — `cli/ie.mjs`、`cli/native/bridge.mjs`、`cli/commands/*.mjs`
- ✓ 中英双语 UI（含 API 路由错误文案）；zh 缺翻译是编译错误 — `app/i18n/index.ts`、`app/i18n/messages/*.ts`
- ✓ 三套测试：vitest 单元/契约（node env）、Playwright + Midscene AI E2E、bridge smoke（`node --test`） — `vitest.config.ts`、`playwright.config.ts`、`cli/native/__tests__/bridge.smoke.test.mjs`
- ✓ 像素线：PixelLab `pixflux` + 静态 8 向角色 + 强制像素网格（block/cell） — `app/lib/pixel.ts`、`app/utils/pixelGrid.ts`、`app/components/PixelStudio.tsx`
- ✓ 六个 studio（Extender / Parallax / Tiles / Sprite / Props / Pixel）与 ZIP/manifest 导出（"逐字节不变"是既有不变量） — `app/page.tsx`、`app/lib/studioDownload.ts`

### Active

<!-- 当前 scope：本里程碑（S1）。spec = docs/superpowers/specs/2026-10-06-animation-set-production-design.md -->

- [ ] 探针先行：验证 magpie → `teamo-router/gemini-3.1-flash-image` 是否透传 `4096×512`（8:1）；失败则在同一 provider 表里加 Teamo 直连（key 文件 + `host=ip` pin），接口不变
- [ ] 纯核心：`app/lib/animSet.ts`（规格校验 / `planStrips` / `set.json` / 断点续跑判定）与 `app/lib/animStrip.ts`（strip prompt 组装 + cell↔方向映射），全部可单测
- [ ] 生成与后处理：逐 strip 打 `/api/generate`（现有 plain 形状）→ 落 `raw/` → 复用 bridge/`imageProcessor` 切格、抠底、去边、归一化居中 → 写 `derived/` 与 `set.json`
- [ ] CLI 面：`ie anim plan`（预演，打印调用数与尺寸）与 `ie anim run --go [--redo] [--keep-going]`；入库复用 `ie library save`
- [ ] 库面：新增 `AssetKind = 'animations'`，一个动画集 = 一个资产（`derived/*.png` + `set.json` + `meta.json`），provenance 的 `params` 记 `calls/cells/seconds`
- [ ] UI 面：第 7 个模式 `anim`（规格表单 → 计划确认 → 逐 strip 进度 → 帧画廊 → Save to library）+ `app/i18n/messages/anim.ts`（en/zh）
- [ ] 端到端验收：用 hero（idle+walk，8 次调用）实跑一遍 → 入库 → 刷新页面后仍能从面板找回
- [ ] 收尾：`dark-black/tools/gen_assets_teamo.py` 退役（改由本管线产出，游戏侧只留消费端脚本）

### Out of Scope

- atlas 组装 / 写进 Godot 工程 / 生成 `.tres`（SpriteFrames、TileSet） — 推迟到下一个里程碑（S2 引擎交付层，方向已定：读 `set.json` + 适配器表，Godot 先落地）
- PixelLab 动画端点（`/characters/animations`）与 object 动画 — 第二适配器；接口按 S1 的中性模型设计，本里程碑不实现
- 身份锚（首帧作后续帧参考图以压跨帧漂移） — v1 默认关；启用需要给 `/api/generate` wire 加字段，推迟
- `AssetMeta` schema 变更与成本双单位（usd + generations） — 保持 `schemaVersion: 1`，`usage` 放 `provenance.params`
- 修改任何后处理算法、现有 studio 的 ZIP/manifest 导出 — 逐字节不变量，且非本里程碑所需
- 批量队列/调度器、多用户、服务端实例、云对象存储 — BYOK 本地单用户模型不变（库共享靠 git）
- 音频 / 字体 / 9-slice UI / 关卡数据等品类竖线 — 与"先 Godot 手绘角色动画"无关，暂不扩品类

## Context

- **消费端现状**（`~/repos/dark-black`，Godot 4.7）：v11 手绘路径 = `tools/gen_assets_teamo.py` 逐 (状态, 帧) 生成 8 向 strip（`4096×512`，exact ratio，cell i 对应方向 i，方向顺序 = 运行时 sector 顺序）→ `assets/handpainted/sprites/<actor>/` → `tools/build_handpainted_sheets.py` 组 per-actor atlas（行 = 方向×状态、列 = 帧、64px cell）→ `scripts/actors/enemy.gd:86-87,192` 读 `sprite-sheet-alpha.png`。像素 atlas 已退役为 fallback（提交 `6abb5ed`，2026-09-24）；一条 PixelLab 8 向动画路线（`gen_monsters_8dir.py`）计划过但未落地。
- **本 fork 的既有 spec**：`docs/superpowers/specs/2026-10-05-fork-design.md`（资产库，已实现）、`docs/superpowers/specs/2026-10-06-animation-set-production-design.md`（S1，本里程碑）。
- **并行的历史实现**：agent skill 的 `~/.agents/skills/image-extender/scripts/ie.py` ↔ repo 的 `cli/ie.mjs`（repo 是后代）；游戏侧 python 脚本 ↔ app 的 studio；游戏侧 `generation-ledger.json` ↔ 库的 `meta.json`。
- **已知债务**（细节见 `.planning/codebase/CONCERNS.md`）：`app/page.tsx` 约 4k 行的在飞重构（分支 `feat/deepen-modules`）；库索引串行读每个 `meta.json`；面板缩略图加载全尺寸 PNG 且 `cache-control: no-store`；`BACKEND_LABELS` 只允许 `openrouter|pixellab` 会把 APIMart/Magpie 产出谎报成 `openrouter`。

## Constraints

- **Tech stack**：复用现有 provider 表与 `/api/generate` 的 wire 形状（不新增 kind）；后处理必须复用 `app/utils/imageProcessor.ts` + bridge 现有 op，不在服务端重写
- **Cost/Spend**：任何生成前必须展示计划与调用数；CLI 要 `--go`、UI 要二次确认；探针会真实花钱（一次调用）
- **Compatibility**：既有 studio 的 ZIP/manifest 导出逐字节不变；`AssetMeta` 保持 `schemaVersion: 1`
- **Compatibility**：方向顺序即契约（消费端按运行时 sector 顺序把行映射到方向）
- **Dependencies**：本机无法 spawn 具名 `gsd-*` agent（走 generic-agent workaround）；headless 像素引擎需要 Chromium（`npx playwright install chromium-headless-shell`）
- **Security**：BYOK 键只留在浏览器 `localStorage` 或 provider profile 的 `apiKeyEnv`；库只接受 `raw/`、`derived/` 下的文件名；威胁模型限于"自己误操作"（不做 symlink/realpath 加固）

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 目录即库（`<project>/<kind>/<slug>/`，而非单一 `library.json`） | 共享靠 git、冲突靠路径隔离、零服务端零并发协调 | ✓ Good |
| provider/model/请求事实收敛成一张表 | 曾经 6 个路由各写一份 base URL，改一处漏五处 | ✓ Good |
| CLI 复用 app 模块（headless Chromium bridge）而非重写后处理 | 不产生第二份会漂移的实现 | ✓ Good |
| S1 先服务**手绘 strip 路径**而非 PixelLab 动画端点 | 消费端现行路径是手绘；像素时代已退役，接它没有产出 | — Pending |
| 中性"动画集"模型 + 可替换 transport | 先 Godot 后泛化；探针失败可切 Teamo 直连而不动接口 | — Pending |
| 成本保持单单位（usd），`usage{calls,cells,seconds}` 进 `provenance.params` | 不动库 schema；双单位是 PixelLab 后端的账，留给第二适配器 | — Pending |
| 身份锚 v1 关闭 | 缩小 S1；避免给 `/api/generate` wire 加字段 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-06 after initialization*
