# Phase 5: 库 kind、provenance 诚实性与载荷上限 - Context

**Gathered:** 2026-10-08 (--auto)
**Status:** Ready for planning

<domain>
## Phase Boundary

把 Phase 4 的 run 目录（`derived/*.png` + `set.json`）变成库里的**一等资产**：新 kind `animations`，一个动画集 = 一个资产（保存 / 列出 / 读取 / 删除 / 面板按 kind 分组）；provenance 必须**诚实**——`backend` 是实际服务方、`cost` 报才记、`params` 记 `calls/cells/seconds` 且与 `ok:true` 条数一致；同时把"raw 永不入库"从约定升级成**有算术守卫的约束**。

不做的事：不做界面（Phase 6 的 `AnimStudio` 与帧画廊）、不新增 provider（Teamo 走 magpie profile，Phase 1 已定）、不动 `AssetMeta.schemaVersion: 1`、不改 `/api/generate` 的 wire 形状、不做成本双单位（PixelLab 的账，留给第二适配器）。

</domain>

<decisions>
## Implementation Decisions

### kind 与 payload 边界
- **D-41:** `ASSET_KINDS` (`app/lib/libraryTypes.ts:8`) 追加 `'animations'`。**不加第二个 kind 分支**：面板的 kind→i18n 映射表 (`app/components/LibraryPanel.tsx:29-33`) 与 `app/i18n/messages/*` 各加一条（`shell.library.kind.animations`，en/zh 都给——zh 缺翻译是编译错误，这是既有不变量）。— **Reversibility:** costly —— kind 是磁盘目录名（`<project>/<kind>/<slug>/`），改名会孤立既有资产。
- **D-42:** 一个动画集 = 一个资产，payload **恒为** `derived/*.png` + `set.json` + `meta.json`；`raw/` 永不进入 payload（延续 Phase 4 的入库边界，不是新决定）。文件名沿用 `derived/<state>_f<N>_<dir>.png`（Phase 2 的命名函数，不要在这里重新拼）。

### provenance 的来源（诚实性）
- **D-43:** 集资产的 `backend` 与 `model` **从 `set.json` 的 `backend.{provider,model}` 读**，不从 CLI 默认值或参数猜。`app/lib/animSet.ts:380` 写的 `backend.provider`/`backend.model` 是 Phase 4 已经落地的诚实来源（CR-03：`spec.model` 是实际请求用的模型，含 `--model` 覆盖）。— **Reversibility:** costly —— 这是"一个事实一处"在 provenance 上的直接后果。
- **D-44:** `cli/commands/library.mjs:162` 的 `ctx.flags.backend ?? 'openrouter'` **去掉那个字面默认**。裸文件导入（没有 `set.json` 可读）时 `--backend` 缺失即 **usage error**（`ctx.fail('bad_backend', …)` 家族已有的形状），而不是替操作者猜一个 `openrouter`——那正是本阶段要修的那类谎（LIB-04）。
- **D-45:** `cost` 遵守"报才记"：`ReportedCost | null`，且当 `cost !== null` 时断言 `cost.source === backend`（LIB-03）；`null` 是**合法值**，不是"缺字段"。任何情况下不允许把未知成本写成 `0` 或 `{amount:0}`。

### 内容边界（manifest 与 params）
- **D-46:** `meta.manifest` 只放**规格块**（actor/states/dirs/cell/style 一类），**不含帧清单**（LIB-05）——帧清单已经在 `set.json` 里，放两份就是两个会漂的真相。
- **D-47:** `provenance.params` 记 `dirs/states/frames/cell/calls/cells/seconds`（LIB-06），其中 `calls`/`cells`/`seconds` 必须与 `set.json` 里 `ok:true` 的条数**一致**（不是"大概等于"）；不一致时入库**拒绝**而不是记一个好看的数字。

### 载荷上限守卫
- **D-48:** 上限守卫是**测试期断言**，不是运行期拒绝：断言"16 张真实尺寸 raw 的 base64 体积 > route 请求上限 279.6M"，因此 raw 在结构上不可能进 payload（Phase 1 实测：16 张真实 raw = 363.8M base64）。运行期只保证一件事——**raw 从不进 payload**（由 D-42 的形状保证）。理由：运行期检查无法拦住"某天有人放宽形状"，而算术守卫能。

### 接线点
- **D-49:** 集资产的收集走既有 `CollectedAsset` 形状，接入 `app/lib/libraryCollect.ts` 的既有 switch（`input.mode` 加 `animations` 分支）或一个同样签名的兄弟函数——**不新增第二种"strip→帧"或 payload 组装实现**。`ie library save` 是唯一入口（CLI-03：不新增命令）。

### the agent's Discretion
- 集资产在 `set.json` 之外是否需要一个精简的 `animations` 规格视图（例如面板显示用的 `states/frames/fps` 摘要），由你定；只要 `set.json` 仍是唯一真相、且新视图可由它机械导出。
- 删除一个集资产时 `derived/` 下多文件与 `set.json` 的清理顺序由你定；`ie library delete` 的既有语义不变。

### 位置与边界（研究阶段发现的硬约束，--auto 决定）
- **D-50:** `set.json` 在**资产目录里**落在 `derived/set.json`，**不是**顶层。理由（实测）：`isValidRelPath`（`app/lib/libraryPath.ts:16`）的正则是 `/^(raw|derived)\/[a-z0-9][a-z0-9._-]{0,118}\.[a-z0-9]{1,8}$/`——顶层 `set.json` 会被**拒绝**，而 AGENTS.md 的库边界约束明确只接受 `raw/`、`derived/` 下的文件名。取"放进 `derived/`"而不是"给校验器开白名单"：改数据的位置是零代码，放宽边界是永久让步。`meta.json` 不走这条校验（由 `saveAsset` 自己写）。— **Reversibility:** costly —— 它是磁盘上的资产布局。
- **D-51:** 上面两条 Discretion 里的第一个问题就此关闭：**不新增**精简的 `animations` 规格视图。面板要显示什么就从 `derived/set.json` 机械导出（它是唯一真相）；多存一份摘要就是第二个会漂的真相。第二个问题（删除顺序）仍留给实现者：一次 `rm -rf` 整个资产目录（`deleteAsset`，`library.ts:133-137`）的既有语义不变。
- **D-52:** `cost` 的断言按**字符串**比较：`ReportedCost.source` 是 `string` 而不是 `BackendLabel`（`libraryTypes.ts:17`），所以 D-45 的"`cost.source === backend`"写成 `cost === null || cost.source === backend`，不要为了它去收紧 `ReportedCost.source` 的类型（那是第二个适配器才需要的收紧）。今天的真实参照物：`app/lib/generateCost.ts:12-18` 给 `source:'openrouter'`，`app/lib/imageGeneration.ts:137` 给 `'apimart'`，其余 `null`。
</decisions>

<canonical_refs>
## Canonical References

### 规格与需求
- `docs/superpowers/specs/2026-10-06-animation-set-production-design.md` §5.3（`set.json` 形状与产物树）、§5.4（provenance 诚实性 R6：`backend` 与实际服务方一致）、§8（错误处理）
- `.planning/ROADMAP.md` §Phase 5 · `.planning/REQUIREMENTS.md`（LIB-01..06、CLI-03）
- `AGENTS.md` 的 Constraints：`AssetMeta` 保持 `schemaVersion: 1`；库只接受 `raw/`、`derived/` 下的文件名

### 上游阶段的产物（本阶段直接消费）
- `.planning/phases/04-cli-runner/04-04-SUMMARY.md` — CR-03 决定了 `set.json` 记**实际请求用的 model**；这就是 D-43 的依据
- `.planning/phases/04-cli-runner/04-CONTEXT.md` D-28/D-32/D-33 — 账本形状、输出信封、raw/derived 原子写
- `app/lib/animSet.ts:326,380` — `buildSetJson` 的 `backend: { provider, model }`

### 既有实现（一个事实一处，改动前先读）
- `app/lib/libraryTypes.ts` — `ASSET_KINDS` (:8)、`BACKEND_LABELS = [...PROVIDER_IDS, 'pixellab']` (:24，已是一处定义并说明它取代了手抄表)、`Provenance` (:30+，`backend`/`params`/`cost`/`manifest` 的字段语义)
- `app/lib/libraryCollect.ts` — `CollectorInput`/`CollectedAsset`、`buildProvenance` (:95)、`collectStudioAsset` (:129 的 switch)
- `app/lib/library.ts` — `saveAsset(project, kind, slug, meta, files, opts)` (:65)、temp+rename 原子写、路径前缀校验
- `app/api/library/[[...path]]/route.ts` — 库的 HTTP 边界（POST/GET/DELETE，`EEXISTS`→409 等）
- `app/components/LibraryPanel.tsx` — kind→i18n 映射 (:29-33) 与按 kind 分组显示
- `cli/commands/library.mjs` — `ie library save` 的现有形状；**硬编码所在**：`:162` 的 `?? 'openrouter'`
- `app/lib/providers.ts` — `PROVIDER_IDS` (:42)，`BACKEND_LABELS` 的唯一上游

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildProvenance(opts)` (`libraryCollect.ts:95`) 已经是 "Provenance 去掉 toolVersion" 的唯一构造器——集资产用它，而不是自己拼对象。
- `isBackendLabel` (`libraryTypes.ts:28`) + `BACKEND_LABELS`：校验与列表都在一处；CLI 已经通过 `lib.isBackendLabel` 用它（`:163`）。
- `saveAsset` 的 temp+rename 与路径前缀校验（`libraryPath.ts`）覆盖多文件原子性——集资产的 16+N 个文件不需要新的写路径。

### Established Patterns
- kind→label 走 i18n 键而不是字面字符串；zh 缺键是 `tsc` 错误。
- 一个事实一处：`BACKEND_LABELS` 从 `PROVIDER_IDS` 派生（它的 docblock 记录了上次手抄表落后两个 id 的事故）——D-43/D-44 是同一纪律在 provenance 上的延伸。
- 路由只做校验与映射，策略在 `app/lib/**`；CLI 通过 bundle 复用 app 模块，从不重写算法。

### Integration Points
- `set.json`（Phase 4 产物）→ 集资产 `meta.json` 的 `backend`/`model`/`params`；**这一条是 Phase 5 与 Phase 4 的接缝**，也是 Phase 6 面板显示的数据来源。
- `derived/` 的帧文件是库里的实际内容；`raw/` 留在 run 目录里从不入库（载荷算术是守卫）。
- `ie library save` 是唯一入库入口（CLI-03），Phase 6 的 UI 保存按钮走同一条路。

</code_context>

<specifics>
## Specific Ideas

- 用户明确（Phase 4 已定，本阶段执行）：**raw 永不入库**，且用载荷算术把它钉住。
- 用户明确：`backend` 必须与实际服务方一致（R6），`cost.source === backend` 或 `cost === null`。
- 用户明确：`ie library save` 的 `'openrouter'` 硬编码是要修的东西，不是要保留的默认。
- 用户明确：`manifest` 与 `set.json` 不重复记帧清单。

</specifics>

<deferred>
## Deferred Ideas

- 第 7 个 UI 模式与帧画廊（`AnimStudio`）—— Phase 6。
- 成本双单位（PixelLab 的 credits 与 usd）—— 留给第二适配器，不动库 schema。
- `--parallel N` 的入库批处理 —— 串行已定，无人需要。
- 集资产的版本化/差异（同一 slug 的 v2 对比）—— 现有 `-v2` 冲突三选已够；真要对比是另一个 phase。

</deferred>

---

*Phase: 5-kind-provenance*
*Context gathered: 2026-10-08 (--auto)*
