# Phase 4: CLI runner（`ie anim plan` / `run --go`）- Context

**Gathered:** 2026-10-07
**Status:** Ready for planning

<domain>
## Phase Boundary

把 Phase 2 的两个纯模块与 Phase 3 的切图 op 串成**一条真能跑的生产命令**：`ie anim plan`（预演，零调用）与 `ie anim run --go`（真跑，逐条原子落盘、按 `(state, frame)` 合并的账本、失败默认停止、单条重跑）。同时把 `requested`/`returned` 都记下来，比例不符即 `ok:false`。

不做的事：不做界面（Phase 6）、不做入库与 provenance（Phase 5）、不改 op 的语义（Phase 3 已定）、不新增 provider。

</domain>

<decisions>
## Implementation Decisions

### 账本
- **D-28:** 账本就是 `<out>/set.json`。每张 strip 完成即**原子重写**（temp + rename），因此中断后重跑能真正续跑（Phase 2 的 `nextPending(spec, record, facts)` 直接读它）。— **Reversibility:** costly —— 换账本形状会让已存在的 run 目录失去续跑能力。

### 执行方式
- **D-29:** **串行**，一张接一张。不做 `--parallel`：网关对并发图像请求不友好（实测单张 15 秒到几分钟），串行也让计费与账本一一对应。

### 失败与重试
- **D-30:** 网络/5xx **退避重试 2 次**；仍失败 → 该条 `ok:false`，**默认整轮停止**（省钱，与 Phase 1 的 D-08 同一条纪律）；`--keep-going` 才继续跑剩余的；`--redo state:frame` 只重跑指定那条、不碰其它。

### 规格来源
- **D-31:** `--spec <file.json>` 为主，内联 flags（`--actor` / `--states` / `--dirs` / `--cell` / `--style-file`）为辅；`out` 从 spec 取、`--out` 可覆盖；`--model` / `--profile` / `--base-url` 用现有全局旗标。

### 输出
- **D-32:** 沿用 `okEnvelope`（`--json` 给脚本用）：`plan` 返回计划数组（每条的画布、调用数、输出路径与总量），`run` 返回 `{ written, strips, setJson }`；非法规格报 `AnimSpecError` 的 `err.field`，让 CLI 能把错误指到具体那个键。

### 沿用（不再重问）
- **D-33:** `requested` 与 `returned` 都记；**比例不符即 `ok:false` 且不切格**（TRAN-02，Phase 1 的 R1 教训）。raw 与 derived 都原子写（temp+rename）。入库不由本阶段负责（`ie library save` 的复用是 Phase 5 的 CLI-03）。每张 strip 的 prompt 文本与 sha256 由 Phase 2 的纯函数给出，本阶段只负责调用与记账。

### the agent's Discretion
- `<out>` 的目录结构（raw/、derived/、evidence/ 等）与文件名细则由你定，但必须与 Phase 2 的命名函数（1-based 文件名、0-based 索引）一致，并让 Phase 5/6 能只读 `set.json` + `derived/`。
- 退避的具体间隔与判定由你定；只要"重试 2 次后失败即停"这条不破。

</decisions>

<canonical_refs>
## Canonical References

### 规格与需求
- `docs/superpowers/specs/2026-10-06-animation-set-production-design.md` §6.1（CLI 契约）、§7（数据流）、§8（错误处理）
- `.planning/ROADMAP.md` §Phase 4 · `.planning/REQUIREMENTS.md`（GEN-01..06、TRAN-01/02、CLI-01/02）

### 上游阶段的产物（本阶段直接调用）
- `app/lib/animSet.ts`（Phase 2）— `validateAnimSetSpec` / `planStrips` / `buildSetJson` / `nextPending` / `stripKey` / `frameNumber`
- `app/lib/animStrip.ts`（Phase 2）— `buildStripPrompt` / `DIRS8` / `fitPanelGrid`
- `app/lib/animFrames.ts` + bridge `strip-frames`（Phase 3）— 一张 strip → N 帧
- `.planning/phases/01-transport-probe/01-PROBE-RECORD.md` — 实测：2928×352、`#FC06FA`、pitch 360/phase 20、`gutter_ok false`；**requested ≠ returned 是常态**
- `.planning/phases/02-pure-core/02-02-SUMMARY.md` §续跑契约；`.planning/phases/03-strip-frames/03-01-SUMMARY.md` §实测确认

### CLI 既有约定（照抄形状）
- `cli/ie.mjs`（`COMMAND_MODULES` 注册）、`cli/lib/context.mjs`（`ctx.api`/`ctx.bridge`/`ctx.modules`）、`cli/lib/args.mjs`（`okEnvelope`/`UsageError`）、`cli/lib/server.mjs`（端口 4317、`ensureServer`）、`cli/lib/media.mjs`
- `cli/commands/library.mjs` — 命令模块的既有写法（默认导出 `{ anim: spec }`、子命令取第一个位置参数）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ctx.api.call(route, body)`：打 `/api/generate` 的现成封装；profile 必须写在 **body** 里（Phase 1 实测：全局 `--profile` 会被忽略）。
- `ctx.bridge.runJob({op:'strip-frames', ...})`：Phase 3 的 op，CLI 侧直接调。
- `nextPending`：纯函数，输入是 `(spec, record, facts)`；`facts` 里"raw 可解码 / derived 齐不齐"要由本阶段自己采（读文件 + 解码校验）。

### Established Patterns
- 命令模块一个文件一个命令族，子命令取第一个位置参数；输出走 `okEnvelope`，进度写 stderr（stdout 只留一个可解析对象）。
- 原子写已有先例（`app/lib/library.ts` 的 temp+rename）。

### Integration Points
- 本阶段产出的 `<out>/set.json` + `derived/` 就是 Phase 5 入库的输入、Phase 6 界面读的东西。**"一张 strip 如何变成帧"仍然只有一处实现**。

</code_context>

<specifics>
## Specific Ideas

- 用户明确：**set.json 当账本**、每张完成即原子重写。
- 用户明确：**串行**，不做并发。
- 用户明确：**重试 2 次、失败即停**（`--keep-going` 才继续）。
- 用户明确：`--spec` 为主、内联 flags 为辅。
- 用户明确：输出沿用 **okEnvelope**。

</specifics>

<deferred>
## Deferred Ideas

- `--parallel N` —— 不做（串行已定）。
- 入库命令复用 —— Phase 5 的 CLI-03。
- 界面 —— Phase 6。

</deferred>

---

*Phase: 4-cli-runner*
*Context gathered: 2026-10-07*
