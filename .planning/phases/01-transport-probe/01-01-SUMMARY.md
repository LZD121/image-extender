---
phase: 01-transport-probe
plan: 01
status: complete
requirements: [TRAN-03]
---

# 01-01 Summary — 探针：一次真实调用 + 离线测量 + 记录 + fixture

**执行方式：** inline（本 harness 无法 spawn 具名 gsd-* executor；orchestrator 按 `01-01-PLAN.md` 逐任务执行并跑硬闸门）。计划由独立 planner 撰写、独立 checker 两轮评审。

## 交付物

| 文件 | 内容 |
|---|---|
| `.planning/phases/01-transport-probe/probe-config.json` | 两份 profile：`probe-magpie`（本机网关直通）与 `probe-teamo`（magpie + Teamo baseUrl/apiKeyEnv）；无内联 key |
| `scripts/probe-measure.mjs` | 离线测量：真实尺寸、底色取样、列质量剖面 + `(spacing, phase)` 搜索拟合、Δ% vs 均匀、gutter 判定、计时。除 `seconds_measure` 外全部是输入的纯函数 |
| `.planning/phases/01-transport-probe/01-PROBE-RECORD.md` | D-10 五项 + D-11 分类 + 网关原行 + 两套（原始/fixture）拟合数字；唯一一个 json 围栏 |
| `.planning/phases/01-transport-probe/evidence/{call-result.json,measured-raw.json,measured-fixture.json}` | 裁剪过的调用证据（无 data URL、无 key）与两套测量 |
| `tests/fixtures/anim/chaser_idle_f1_8dir.png` | 2048×246、0.945 MB、`diff: unset`（`.gitattributes` 自动覆盖） |
| `.ie/probe/chaser_idle_f1_8dir.png` | 原始返回 2928×352（1.48 MB），**不进仓库**（`.ie/` 已 gitignore） |

## 结果

- **一次付费调用，HTTP 200，15 秒**（网关侧 `ms=14629`）。D-08 未触发 → **本 phase 没有第二次调用**（上限 2 次）。
- 出网比例名 = `8:1`；返回 **2928×352 = 8.318:1** —— 与消费端 40 条已交付 strip 同一签名（请求 8:1 → 返回 8.318）。**探针要回答的问题答案是：8:1 能到达模型。**
- 底色 `#FC06FA`（饱和洋红，cast 244）→ Phase 3 抠底用二值 + despill，不用 `default` 软边。
- 拟合：原始 pitch 360 / phase 20 / Δ −1.639%；fixture pitch 255 / phase 253 / Δ −0.391%。**符号相反** → 拟合必须是搜索，不能固化成常数。
- **gutter 判定 False**：8 条边界里 7 条干净、1 条被实体占满。也就是模型没有严格遵守"每格留宽沟槽"——这正是 Phase 3 的 gutter 闸门要拦的，也是把"返回了但格子不对"单列一类的原因。**这不是探针失败**：探针问的是比例名能否到达。

## 闸门结果（全部实跑）

- Task 1 前置（零成本）：`supportedAspectRatioForSize(4096,512) === '8:1'` ✓（由 01-02 落地）
- 调用：exit 0、HTTP 200、`usage_provider=teamo-router`、`usage_ms=14629`、`cost=null`
- 记录闸门：json 围栏计数 == 1；必填字段非空；`requested_aspect_name === "8:1"`；`prompt_full` 含八个 `cell N facing <dir>` 与 `#FF00FF`；重算 sha256 与记录一致 ✓
- 确定性：同一张图跑两次，去掉 `seconds_measure` 后逐字节相同 ✓
- fixture：2048×246、0.945 MB、`git check-attr diff` → `diff: unset` ✓

## 偏离与说明

- 计划的 `.ie/probe/` 与 `.planning/.../raw/` 分工按 checker 建议落定：原图只进 `.ie/probe/`（gitignored），仓库只收 2048 宽 fixture。
- fixture 创建第一次失败（`tests/fixtures/anim/` 目录不存在），补 `mkdir -p` 后成功——不是计划缺陷，是执行细节。
- 测量脚本的拟合是**自研搜索**（±8% 的 spacing × phase，最小化切线质量），不是照抄消费端的 `panel_boxes`；两者语义一致（切线落在空白沟槽）。
