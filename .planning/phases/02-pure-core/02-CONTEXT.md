# Phase 2: 纯核心（animStrip + animSet）- Context

**Gathered:** 2026-10-07
**Status:** Ready for planning

<domain>
## Phase Boundary

把本阶段所有决策写成两个**不碰网络、不碰文件系统、不碰界面**的纯 TypeScript 模块：规格校验、计划、strip prompt、`set.json`、续跑判定，以及面板网格拟合代数。CLI（Phase 4）与界面（Phase 6）都调它们，口径必须在这里定死。

不做的事：不发请求、不切图/抠底（那是 Phase 3）、不做 CLI 命令与界面、不动库的 kind 与 provenance（Phase 5）。

</domain>

<decisions>
## Implementation Decisions

### 拟合的接口与阈值
- **D-12:** 纯模块包下"剖面 + 拟合"两件事。`animStrip.ts` 导出 `columnProfile(rgba, width, height, fieldRgb)`（从像素缓冲算列质量，纯函数）与 `fitPanelGrid(profile, opts)`（搜索 `(spacing, phase)`，阈值当参数带默认值：搜索范围 ±8%、gutter 判定 2%）。CLI 与界面直接喂图；Phase 3 想收紧阈值不必改代码。— **Reversibility:** reversible。
- **D-13:** 拟合必须是**搜索**，不得把 Phase 1 量到的任何数字当常量抄（原图 phase 20 / fixture phase 253 是同一"模间距"语义的两个代表元）。`set.json` 里记录**实际拟合到什么**。

### 方向预设与命名进制
- **D-14:** `DIRS8`（east 起顺时针 = 运行时 sector 序）与 `DIRS4`（down/side/up/back）作为纯模块常量表；规格写的是**预设名**而不是数组（顺序即契约，靠常量表守住）。— **Reversibility:** costly —— 改顺序会让已产出的资产与引擎的行映射错位。
- **D-15:** 文件名 ↔ 索引的进制转换只允许出现在**一个**函数里（运行器渲染时用 1-based，`set.json` 里 0-based）。两个边界值都要有测试。

### 续跑判定的真相源
- **D-16:** `nextPending(spec, record, facts)` 是纯函数，收三样输入：规格、上次的记录（`set.json` 的 `strips[]`/`frames[]`）、以及运行器采到的**事实**（`rawDecodable: boolean`、`derivedCount: number`）。纯模块不认识文件系统，但"截断的 PNG 被当成已完成"这个坑必须由它判定掉。— **Reversibility:** reversible。

### 规格校验的严格度
- **D-17:** 分两档。硬错（抛，一个调用都不发）：每状态帧数不一致、未知 dirs 预设、`cell × dirs > 4096`、cell 越界、states 为空、名字重复或非法。**未知字段忽略但记一条 warning**（返回 `{ spec, warnings }`，前向兼容，以后加字段不会把旧规格全弄挂）。

### prompt 模板怎么放
- **D-18:** 约束句（每格在自己格内 + 四周洋红沟槽、纯洋红场不是场景、无地面/阴影/文字/网格线/边框/卡片）是常量；逐格方向枚举由 dirs 数组生成（`cell i facing <dir>`）；整个 prompt 由纯函数拼出。单测能断言"含八个枚举串 + `#FF00FF` + 不出格约束"。

### 数据契约与测试组织
- **D-19:** 类型（`AnimSetSpec` / `StripPlan` / `SetJson`）与 spec v2 §5 逐字一致；`buildSetJson()` 纯函数产出，`durationsMs = round(1000 / fps)`。
- **D-20:** 测试放 `app/lib/__tests__/`（vitest，node 环境）；拟合用**合成剖面**测（均匀 / 带相位偏移 / 噪声三种），命名函数测两个边界值，校验测每一条硬错与 warning 路径。
- **D-21:** 两个模块不得 import `node:*`、`next/*`、`react`——它们是纯的，这条由一条测试或静态检查守住（Phase 4/6 复用它们的前提）。

### the agent's Discretion
- 拟合搜索的具体步长与剪枝策略、剖面的具体度量（是否按底色距离、阈值多少）由你决定；只要 D-12 的接口与 D-13 的"搜索而非常量"成立。
- 模块拆分（`animStrip.ts` 与 `animSet.ts` 各放什么）按 spec v2 §4 的职责表来；若你发现更合理的切法，在计划里说明并保持"两个纯模块 + 无第三个家"。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 本里程碑的规格
- `docs/superpowers/specs/2026-10-06-animation-set-production-design.md` — S1 规格 v2（§4 单元职责、§5 数据模型、§5.2 计划与几何、§10 测试）
- `.planning/ROADMAP.md` §Phase 2 · `.planning/REQUIREMENTS.md`（GEOM-01、GEOM-03、GEN-07、GEN-08）

### Phase 1 的实测输入（拟合的参照）
- `.planning/phases/01-transport-probe/01-PROBE-RECORD.md` — 返回 2928×352（8.318:1）、底色 `#FC06FA`、拟合 pitch 360/phase 20、**gutter 判定 False**（8 条边界 1 条被占）
- `.planning/phases/01-transport-probe/evidence/measured-raw.json` 与 `measured-fixture.json` — 两套数字（原图 / 2048×246 fixture）
- `scripts/probe-measure.mjs` — Phase 1 的自研拟合实现，Phase 2 要把它**逐语义**变成纯函数（`scripts/` 下那份是一次性脚本，纯函数才是产品）

### 本仓库的既有约定
- `.planning/codebase/CONVENTIONS.md` — "一处一个事实"、模块头写清存在理由、纯逻辑与运行器分离
- `.planning/codebase/TESTING.md` — vitest 的组织方式与断言风格
- `.planning/codebase/ARCHITECTURE.md` — `app/lib/*` 纯模块与 `app/utils/*`（浏览器）的边界

### 消费端的参考实现（只读）
- `~/repos/dark-black/tools/build_handpainted_sheets.py` — `panel_boxes` 网格搜索、`fit_panel`、`trim_to_blob`；语义参照，不是要照抄的代码

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/probe-measure.mjs`（Phase 1 产出）：`columnProfile` 与拟合搜索的现成语义——**逐语义**搬进 `app/lib/animStrip.ts`，但要按 D-12 把阈值参数化。
- `app/lib/aspectRatio.ts`：Phase 1 建的"纯函数 + 单一之家"范例（模块头写清为什么存在）。
- `app/lib/pixel.ts` 的 `PIXEL_*` 常量表：纯模块放常量表的既有写法。

### Established Patterns
- 纯模块不 import 运行环境（`app/lib/generatePrompt.ts`、`generateRequest.ts` 都是这样）；类型与运行器分离。
- 测试断言**具体数字**（Phase 1 的 aspectRatio.test.ts 就是范例：4 变 / 52 不变 / 12 项），不许"看起来对"。

### Integration Points
- Phase 3（切图工具）会调 `columnProfile` + `fitPanelGrid`，并在其上加 gutter 断言。
- Phase 4（CLI）调 `planStrips`/`nextPending`；Phase 6（界面）调同一套——**"一张 strip 如何变成帧"只允许一处实现**。

</code_context>

<specifics>
## Specific Ideas

- 用户明确：拟合与剖面都由纯模块包下，阈值参数化。
- 用户明确：方向预设写进纯模块；进制转换只在一个函数里。
- 用户明确：续跑判定要拿"记录 + 运行器采到的事实"两个输入，不能只看 `ok` 标记。
- 用户明确：未知字段记 warning 而不是硬错。
- 用户明确：prompt 由模板 + dirs 自动生成枚举。

</specifics>

<deferred>
## Deferred Ideas

- 拟合质量作为闸门 —— 不做：判定闸门是"切线落在空白 gutter"（Phase 3 落地）。
- 4 向（英雄那套）的实际产出 —— D-09 已定本里程碑只跑 8 向；`DIRS4` 只作为常量与校验路径存在。
- 身份锚 / 调色板锁定 —— 后续里程碑。

</deferred>

---

*Phase: 2-纯核心（animStrip + animSet）*
*Context gathered: 2026-10-07*
