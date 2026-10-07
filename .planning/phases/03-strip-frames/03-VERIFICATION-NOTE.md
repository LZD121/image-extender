# Phase 3 plan review trail

**Plans:** `03-01`（337 行，bridge op `strip-frames`）· `03-02`（217 行，真实 fixture 上的 `node --test` 冒烟）
**Waves:** 1 = 03-01, 2 = 03-02（DAG 判定；03-02 依赖 03-01 的 op）

## 独立核查（两轮）

第一轮判 **FAIL**，四条 blocker 全部带本机实测：

| # | 问题 | 实测证据 | 修法 |
|---|---|---|---|
| 1 | `skip` 计数正则永远匹配不上 → 那条检查空转，删掉 raw 那路测试闸门照样绿 | `node --test` v24.21.0 只打印 `ℹ skipped 1`；旧正则 NO MATCH | 换成 `(skipped\|cancelled) [1-9]`，双向验过 |
| 2 | 一条验收期望值任何正确实现都会红 | 按公式 `fitBox({100,100},64)` → `scale 0.56`，不是 1 | 改成三档并列（243×204@256→0.9218、100×100@64→0.56、50×50@64→1） |
| 3 | 同一条里两个留边要求互相打架（≥131 vs 16） | cell 256 帧 7 实测落 `@18,16`，底边留边恰 16 | `>=131` 明确限定在 cell 512 那臂 |
| 4 | "零半透明像素"在缩放前量，区分不了插值实现 | cell 512 那臂 `scale` 恰为 1，改成插值后仍是 0；但 cell 256 臂同一变异产出 **7414** 个半透明像素 | 512 臂改写成"断的是二值抠底生效"；插值陷阱移到 256 臂（八帧合计必须 0）+ 源码计数 |
| 5 | `DIRS8` 正则匹配不了多行数组 | 单行骨架才匹配 | `([\s\S]*?)` |
| 6 | `CHROMA_PRESETS[preset: string]` **编译不过**，会逼执行者自己发明守卫（未知名字静默退回纯洋红） | 实测 `TS7053` | 计划里加 `resolvePreset(name)` 显式守卫、未知名字抛错，并加一条 `preset:'nope'` 必须抛的验收 |
| 7 | 打包闸门测不到"陈旧 bundle" | 针脚今天全为 0，但缓存会让它通过 | 写成必须 `force: true` 并说明原因 |

改后 planner 对每条都做了**负向验证**（把实现改坏，证明闸门会红）：(1) 合成日志走完整闸门 rc=1；(2) 变异 `fitBox` 为恒 1 → rc=1；(4) 把 `imageSmoothingEnabled` 改 `true` → rc=1；(6) 静默回退版 `tsc` **rc=0**（能编译，正是危险所在）→ 靠新验收拦。

**planner 反手抓到我的一处污染**：我上一轮为过结构校验，把 `FRAME_FILL = 0.875` 连同**代码骨架与闸门 grep** 一起替换成中文短语，导致那条源码闸门永远匹配 0；已复原标识符，改用计划自己文档化的 `<!-- planner-discipline-allow -->`。

## 我的独立复验（改后）

两份 `frontmatter.validate` / `verify.plan-structure` 双绿；HTML 转义 0；`verify-command-paths` 与 `verify-failure-directions` 各 3 条、0 blocker；决定覆盖 6/6；需求覆盖面 11/11；`phase-plan-index` 波次无警告；工作树只有这两份计划被改动。

**待办**：checker 的**第二轮复核**（确认七条真关闭）尚未跑；跑完才进 `$gsd-execute-phase 3`。
