# Requirements: Image Extender — 游戏美术生产管线（fork）

**Defined:** 2026-10-06
**Core Value:** 一个规格产出一整套能直接进游戏的资产（帧文件 + 计时 + provenance），使游戏侧那些一次性脚本永远退役。
**Spec:** `docs/superpowers/specs/2026-10-06-animation-set-production-design.md`（v2）
**Research:** `.planning/research/SUMMARY.md`（1891 行，2026-10-06）

## v1 Requirements

本里程碑（S1 动画集生产）的验收范围。每条对应 roadmap 的一个 phase（见 Traceability）。

### TRANSPORT — 尺寸与传输

- [x] **TRAN-01**: 每张 strip 都记录 `requested` 尺寸，并在返回后**从实际字节**计算 `returned` 尺寸
- [x] **TRAN-02**: `returned` 宽高比 ≠ `requested` 时该条 `ok:false` 且不进入切格
- [x] **TRAN-03**: 一次真实探针（一次付费调用）记录 returned 尺寸 / 拟合间距 / 场色，结论固化成常量或 profile 配置
- [x] **TRAN-04**: 若探针证明现有通路送不出 8:1/4:1，比例表按 spec §9.3 放宽，且六个既有 studio 请求的档位不变（回归断言）
- [x] **TRAN-05**: fallback 以 magpie profile（`baseUrl`+`apiKeyEnv`）表达，`PROVIDER_IDS` 数量不变（断言）

### GEOM — 几何

- [x] **GEOM-01**: 面板网格由列质量剖面拟合 `(spacing, phase)`，纯函数、vitest 可测（均匀 / 相位偏移 / 噪声三种合成剖面）
- [x] **GEOM-02**: 每张 strip 断言每条切线落在接近空白的 gutter 列；失败即 `ok:false` 且保留 raw
- [x] **GEOM-03**: `set.json` 记录实际拟合值（spacing/phase/residual）与 gutter 判定结果

### GEN — 生成与续跑

- [x] **GEN-01**: `ie anim plan` 打印逐 strip 画布 + 调用数 + 总量 + 输出根，且**零调用**
- [x] **GEN-02**: `ie anim run` 不带 `--go` 时零调用（输出与 plan 等价）
- [x] **GEN-03**: 每张完成即**原子写** raw（temp+rename），中断不留截断文件
- [x] **GEN-04**: 续跑判定来自记录（`ok` ∧ raw 可解码 ∧ derived 数量符合预期）；截断 raw 视为未完成并重跑
- [x] **GEN-05**: ledger 按 `(state, frame)` 合并并断言唯一（同一 `state:frame` 不出现两行）
- [x] **GEN-06**: 失败默认停止；`--keep-going` 继续；`--redo state:frame` 只重跑该条
- [x] **GEN-07**: 规格非法（每状态帧数不一致 / `cell×dirs>4096` / 未知 dirs 预设 / 空 states）在**任何调用之前**报错
- [x] **GEN-08**: prompt 含逐格方向枚举、格内包含、纯洋红场、禁卡片/文字/网格线；风格文本内联

### POST — 一张 strip → N 帧

- [x] **POST-01**: 链路 = panel-fit → chroma（按实测场色、二值）→ removeFrameBorder → isolate → 套固定 cell 居中；**不含基线对齐**
- [x] **POST-02**: 每个 best-effort 步骤返回计数器并写入 `set.json.steps`
- [x] **POST-03**: 每帧断言角点透明、内容 bbox 留边 ≥ 阈值
- [ ] **POST-04**: 同一条链在 CLI（bridge op `strip-frames`）与 UI（同名函数）各调一次，无私有副本
- [x] **POST-05**: `node --test` 用已交付 `chaser` strip 对真实 PNG 字节跑通冒烟

### LIB — 库与 provenance

- [x] **LIB-01**: 新 kind `animations` 可保存/列出/读取/删除，面板按 kind 分组显示
- [x] **LIB-02**: 保存一个集只发 `derived/` + `set.json` + `meta.json`；raw 永不入库（含载荷断言）
- [x] **LIB-03**: provenance 的 `backend` 与实际服务方一致，且 `cost.source === backend`（或 `cost === null`）
- [x] **LIB-04**: `ie library save` 不再硬编码 `backend:'openrouter'`
- [x] **LIB-05**: `meta.manifest` 只含规格块（不含帧清单）
- [x] **LIB-06**: `provenance.params` 含 `dirs/states/frames/cell/calls/cells/seconds`

### CLI — 命令行面

- [x] **CLI-01**: `ie anim plan|run` 注册进命令表且有 `ie help anim`
- [x] **CLI-02**: 输出为 `okEnvelope`（plan 数组 / run `{written, strips, setJson}`）
- [x] **CLI-03**: 入库复用 `ie library save`，不新增命令

### UI — 界面面

- [ ] **UI-01**: 第 7 个模式 `anim` 出现在顶栏且不影响其余模式
- [ ] **UI-02**: 表单 → 计划面板（调用数/画布/输出）→ 二次确认后才开始
- [ ] **UI-03**: 逐 strip 进度可见且可停止
- [ ] **UI-04**: 帧画廊按状态分组 + 方向矩阵视图（一行一 sector、一列一状态、取第 1 帧）
- [ ] **UI-05**: `Save to library` 走 LibraryPanel 既有对话框与 409 三选
- [ ] **UI-06**: 新文案 en+zh 齐备（zh 缺键编译失败）；两处硬编码 mode 清单（`app/i18n/__tests__/messages.test.ts:80`、`e2e/studio-library.spec.ts:17-24`）同批更新

### ACCEPT — 验收

- [ ] **ACC-01**: hero idle+walk（8 次调用）端到端跑通并入库，刷新页面后仍能找回
- [ ] **ACC-02**: E2E 断言 `params.calls == ok:true 条数`、per-row bbox stddev 在阈值内
- [ ] **ACC-03**: 既有 studio 的 ZIP/manifest 导出逐字节不变（回归）

## v2 Requirements

推迟到后续里程碑，记录在案以免重新发明。

### 一致性

- **IDENT-V2**: 首帧作后续帧参考图（身份锚），压跨帧漂移（实测 chaser |ΔRGB| 均值 5.9 / lunger 7.0）
- **PALETTE-V2**: 调色板锁定与从已交付语料抽调色板

### 生产通道

- **PIXEL-V2**: PixelLab 动画适配器（`/characters/animations`，一次 job 出 4 帧 × 8 方向）+ object 动画
- **TUNE-V2**: 逐帧微调 UI（重绘单帧而不重跑整套）
- **ENGINE-V2**: 引擎原生导出（per-actor atlas 组装 + Godot `.tres`）——即 S2 引擎交付层

## Out of Scope

| Feature | Reason |
|---|---|
| 浏览器内动画编辑器（时间轴/洋葱皮/逐帧绘画） | 与"生产管线"定位冲突；编辑留给 Aseprite 这类工具，本管线只负责产出可编辑的帧 |
| 运行时在引擎内生成资产 | 破坏可复现与可追溯；游戏发行需要确定的字节 |
| 云资产托管 / 多用户协作 | 共享机制是 git；加服务端会引入认证、并发、计费，全部超出"本地单用户 BYOK"模型 |
| 批量队列 / 调度器 | 编排已由 CLI 与 agent 覆盖；队列是无人需要的中间层 |
| 自动重定时（自动决定 fps/loop） | 计时要来自消费端契约（`enemy.gd` 的 `FPS_*`），不能由生成器猜 |
| 成本双单位（usd + generations） | 只有 PixelLab 后端按 generations 计费；S1 走图像通道，单单位够用（留给 PIXEL-V2） |

## Traceability

由 roadmap 创建时填充。

| Requirement | Phase | Status |
|:--|:--|:--|
| TRAN-01 | Phase 4 | Complete |
| TRAN-02 | Phase 4 | Complete |
| TRAN-03 | Phase 1 | Complete |
| TRAN-04 | Phase 1 | Complete |
| TRAN-05 | Phase 1 | Complete |
| GEOM-01 | Phase 2 | Complete |
| GEOM-02 | Phase 3 | Complete |
| GEOM-03 | Phase 2 | Complete |
| GEN-01 | Phase 4 | Complete |
| GEN-02 | Phase 4 | Complete |
| GEN-03 | Phase 4 | Complete |
| GEN-04 | Phase 4 | Complete |
| GEN-05 | Phase 4 | Complete |
| GEN-06 | Phase 4 | Complete |
| GEN-07 | Phase 2 | Complete |
| GEN-08 | Phase 2 | Complete |
| POST-01 | Phase 3 | Complete |
| POST-02 | Phase 3 | Complete |
| POST-03 | Phase 3 | Complete |
| POST-04 | Phase 6 | Pending |
| POST-05 | Phase 3 | Complete |
| LIB-01 | Phase 5 | Complete |
| LIB-02 | Phase 5 | Complete |
| LIB-03 | Phase 5 | Complete |
| LIB-04 | Phase 5 | Complete |
| LIB-05 | Phase 5 | Complete |
| LIB-06 | Phase 5 | Complete |
| CLI-01 | Phase 4 | Complete |
| CLI-02 | Phase 4 | Complete |
| CLI-03 | Phase 5 | Complete |
| UI-01 | Phase 6 | Pending |
| UI-02 | Phase 6 | Pending |
| UI-03 | Phase 6 | Pending |
| UI-04 | Phase 6 | Pending |
| UI-05 | Phase 6 | Pending |
| UI-06 | Phase 6 | Pending |
| ACC-01 | Phase 7 | Pending |
| ACC-02 | Phase 7 | Pending |
| ACC-03 | Phase 7 | Pending |
