# Roadmap: Image Extender — 游戏美术生产管线（fork）

## Overview

本里程碑（S1 动画集生产）把"一个规格 → 一整套「方向 × 状态 × 帧」资产"变成现实，并让 `dark-black` 的一次性 python 生成脚本退役。旅程从一个便宜的探针开始（它决定传输能否承载精确尺寸，这个答案会成为后续所有代码里的常量），接着写下全部决策所在的纯核心，然后让"一张 strip → N 帧"只实现一次（CLI 与 UI 共用），再依次接上 CLI、库与 provenance、UI，最后用 hero 的真实一次跑做验收。排序遵循一条原则：**每个"可能把整套做错"的环节都排在真花钱跑整套之前。**

## Phases

- [x] **Phase 1: 传输探针与精确尺寸透传** - 用一次真实调用把"请求的画布是否原样到达模型"钉成常量，并定下传输路线 (completed 2026-10-07)
- [x] **Phase 2: 纯核心（animStrip + animSet）** - 规格校验、计划、prompt、set.json、续跑判定、面板拟合代数，全部无 DOM/网络/磁盘 (completed 2026-10-07)
- [x] **Phase 3: strip → frames 后处理（bridge op `strip-frames`）** - 一张 strip 切成 N 帧并归一化，基线对齐显式关闭，每步可计数 (completed 2026-10-07)
- [ ] **Phase 4: CLI runner（`ie anim plan` / `run --go`）** - 计划闸门、原子写、按 `(state, frame)` 合并的 ledger、续跑与重跑
- [ ] **Phase 5: 库 kind、provenance 诚实性与载荷上限** - `animations` kind、backend/cost 一致、raw 不入库
- [ ] **Phase 6: UI studio（`AnimStudio` + i18n）** - 第 7 个模式：规格 → 计划确认 → 逐条进度 → 帧画廊 → 入库
- [ ] **Phase 7: 端到端验收（消费端 hero 形状）** - hero idle+walk 8 次调用跑通并入库，刷新后仍在

## Phase Details

### Phase 1: 传输探针与精确尺寸透传

**Goal**: 用一次真实 strip 调用（一次付费）测出：返回尺寸 vs 请求尺寸、面板拟合间距/相位、场色，并把传输决定固化下来（magpie 直通 / Teamo 直连以 magpie profile 表达 / 条件性放宽比例表）。
**Depends on**: Nothing (first phase)
**Requirements**: TRAN-03, TRAN-04, TRAN-05
**Success Criteria** (what must be TRUE):

  1. 仓库里有一份 probe 记录：请求画布、返回画布、拟合 `(spacing, phase)`、场色，全部来自同一次真实调用
  2. 传输决定有可执行的落地形态：走 magpie 直通，或一个 magpie profile（`baseUrl`+`apiKeyEnv`），且 `PROVIDER_IDS` 数量未变
  3. 若动了比例表，blast-radius 表已重算并断言六个既有 studio 请求的档位不变
  4. 探针的失败模式（超时 vs 比例）被如实记录，不是"重试到成功"掩盖过去

**Plans**: 2 plans

Plans:

- [x] 01-01: 探针：一次真实 strip 调用 + 尺寸/网格/场色测量记录
- [x] 01-02: 传输落地：profile 或比例表放宽（含 blast-radius 回归断言）

### Phase 2: 纯核心（`animStrip.ts` + `animSet.ts`）

**Goal**: 把所有决策写成无依赖的纯 TypeScript：规格校验（含每状态帧数一致）、`planStrips()`、`stripSize()`、`buildStripPrompt()`、`buildSetJson()`、`nextPending()`、以及面板网格拟合代数。
**Depends on**: Nothing（与 Phase 1 可并行；探针的数字是参数，不是依赖）
**Requirements**: GEOM-01, GEOM-03, GEN-07, GEN-08
**Success Criteria** (what must be TRUE):

  1. 非法规格（帧数不一致、`cell×dirs>4096`、未知 dirs 预设、空 states）在任何调用之前被拒绝，有逐项单测
  2. prompt 含逐格方向枚举、"不出格/纯洋红/禁卡片文字网格线"约束与内联风格文本，有断言
  3. `fitPanelGrid` 用合成剖面（均匀/相位偏移/噪声）单测通过，并能对真实 strip 的剖面给出 `(spacing, phase, residual)`
  4. 1-based 文件名 ↔ 0-based 索引的转换只在命名函数里发生，两个边界值都有测试

**Plans**: 2 plans

Plans:

- [x] 02-01: `animStrip.ts`：尺寸代数、prompt、cell↔方向映射、面板拟合
- [x] 02-02: `animSet.ts`：规格校验、计划、`set.json`、续跑判定、命名与进制

### Phase 3: strip → frames 后处理（bridge op `strip-frames`）

**Goal**: 新增**一个** bridge op，把"一张 strip → N 帧"实现成对既有 `IE.*` 导出的薄组合（panel-fit → chroma 二值 → removeFrameBorder → isolate → 套 cell 居中），**基线对齐关闭**，每步 best-effort 都返回计数器，并带上 gutter 与几何断言。
**Depends on**: Phase 2
**Requirements**: POST-01, POST-02, POST-03, POST-05, GEOM-02
**Success Criteria** (what must be TRUE):

  1. 用仓库里已交付的 `chaser` strip 跑 `strip-frames`，输出 N 帧且每帧角点透明、内容留边 ≥ 阈值
  2. gutter 断言生效：切线切到生物像素时该条判为失败，而不是产出错帧
  3. 每个 best-effort 步骤的计数器出现在结果里（静默 no-op 可被看见）
  4. 整条链**没有** `alignSpriteFramesToBaseline`（有断言或测试）

**Plans**: 2 plans

Plans:
**Wave 1**

- [x] 03-01: `strip-frames` op：组合既有导出 + 计数器 + 断言

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02: `node --test` 冒烟：真实 PNG 字节、几何断言、基线对齐缺席

### Phase 4: CLI runner（`ie anim plan` / `run --go`）

**Goal**: `ie anim plan|run` 两个子命令：预演零调用、`--go` 才花钱、每张完成即原子落盘、ledger 按 `(state, frame)` 合并、失败默认停止、`--redo state:frame` 单条重跑、`requested`/`returned` 都记录且比例不符即 `ok:false`。
**Depends on**: Phase 2, Phase 3
**Requirements**: GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, GEN-06, TRAN-01, TRAN-02, CLI-01, CLI-02
**Success Criteria** (what must be TRUE):

  1. `ie anim plan --spec x.json` 打印逐 strip 画布/调用数/总量/输出根，且**零次**网络调用
  2. 中断后重跑跳过已完成条目；手动写一个截断的 raw，重跑会重做该条
  3. ledger 里同一 `state:frame` 只有一行（重复计费不可能发生）
  4. 返回比例与请求不符的 strip 被标记失败且未进入切格

**Plans**: 3/3 plans executed

Plans:

- [x] 04-01-PLAN.md
- [x] 04-02-PLAN.md
- [x] 04-03-PLAN.md

**Wave 1**

- [x] 04-01: 命令骨架 + 计划渲染 + `--go` 闸门（零调用可证）

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02: 生成循环：原子写、记账、重试、停止/继续/重跑

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-03: 续跑判定 + 比例校验 + ledger 合并唯一性

### Phase 5: 库 kind、provenance 诚实性与载荷上限

**Goal**: `ASSET_KINDS += 'animations'`，集资产只收 `derived/` + `set.json` + `meta.json`；`BackendLabel = ProviderId | 'pixellab'` 一处定义、route 与 CLI 共用；`cost` 报才记且断言 `cost.source === backend`；修掉 `ie library save` 的硬编码 backend。
**Depends on**: Phase 2（形状）/ 与 Phase 4 可并行
**Requirements**: LIB-01, LIB-02, LIB-03, LIB-04, LIB-05, LIB-06, CLI-03
**Success Criteria** (what must be TRUE):

  1. 一个动画集能被保存、在索引里列出、按 kind 分组显示、读取与删除
  2. 保存请求里没有 raw；对 16 张真实尺寸 raw 的载荷算术有测试或断言守卫
  3. 一个由 magpie/OpenRouter/APIMart 生成的集，其 `meta.json.provenance.backend` 与实际服务方一致
  4. `meta.manifest` 不含帧清单；`provenance.params` 含 `calls/cells/seconds` 且与 `ok:true` 条数一致

**Plans**: 2 plans

Plans:

- [ ] 05-01: kind 扩宽 + collector 分支 + 面板分组
- [ ] 05-02: provenance 诚实性（BackendLabel/cost/CLI 硬编码）+ 载荷守卫

### Phase 6: UI studio（`AnimStudio` + i18n）

**Goal**: 第 7 个模式：规格表单 → 计划确认（第二道花钱闸门）→ 逐 strip 进度（可停）→ 帧画廊（含方向矩阵视图）→ Save to library；全部文案 en+zh；两处硬编码 mode 清单同批更新。
**Depends on**: Phase 2, Phase 5（不需要 Phase 3：UI 的切格在页面内跑同一条函数链）
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, POST-04
**Success Criteria** (what must be TRUE):

  1. 顶栏出现 `anim` 模式，切换进出不破坏其余六个模式
  2. 未确认计划前不发起任何生成；确认后能看到逐条进度并可停止
  3. 帧画廊能按状态分组，并用方向矩阵（一行一 sector、一列一状态、第 1 帧）呈现方向确是八张独立绘制
  4. 保存走既有对话框与 409 三选；中英双语齐备且缺键会导致编译失败
  5. CLI 与 UI 对"strip → 帧"调用的是同一条链（无私有副本，有断言或评审证据）

**Plans**: 3 plans

Plans:

- [ ] 06-01: 模式接入 + 规格表单 + 计划确认
- [ ] 06-02: 进度、帧画廊与方向矩阵
- [ ] 06-03: i18n（en/zh）+ 两处硬编码清单 + 入库接线

### Phase 7: 端到端验收（消费端 hero 形状）

**Goal**: hero 的 idle+walk（8 次调用）端到端跑一遍：生成 → 切格 → 入库 → 刷新页面后仍能找回；并做完全部"看着完成了但其实没有"的检查。
**Depends on**: Phase 1–6
**Requirements**: ACC-01, ACC-02, ACC-03
**Success Criteria** (what must be TRUE):

  1. hero 的 8 张 strip 全部 `ok:true`，产出的帧集合在库中可见，刷新页面后仍能找到
  2. `provenance.params.calls` 与 `ok:true` 条数一致；per-row bbox stddev 在阈值内
  3. 既有 studio 的 ZIP/manifest 导出逐字节不变
  4. 退役说明落盘：raw 的 ignore 规则与"如何用新管线产出"写进 producer 的文档（供 dark-black 侧替换 `gen_assets_teamo.py`）

**Plans**: 1 plan

Plans:

- [ ] 07-01: 真实 hero 跑 + 断言 + 文档收尾

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7
（Phase 1 与 Phase 2 可并行；Phase 5 的 kind 扩宽可与 Phase 3/4 并行）

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 传输探针与精确尺寸透传 | 2/2 | Complete    | 2026-10-07 |
| 2. 纯核心（animStrip + animSet） | 2/2 | Complete    | 2026-10-07 |
| 3. strip → frames 后处理 | 2/2 | Complete    | 2026-10-07 |
| 4. CLI runner | 3/3 | In Progress|  |
| 5. 库 kind、provenance 诚实性与载荷上限 | 0/2 | Not started | - |
| 6. UI studio | 0/3 | Not started | - |
| 7. 端到端验收 | 0/1 | Not started | - |
