---
phase: 03-strip-frames
plan: 02
status: complete
requirements: [POST-03, POST-05]
---

# 03-02 Summary — 真 fixture 上 `strip-frames` 的端到端冒烟（五个作业、一个浏览器）

**执行方式：** 由通用执行代理按计划逐任务执行，`<automated>` 作硬闸门实跑；未提交（留给 orchestrator）。

## 交付物

| 文件 | 变化 | 内容 |
|---|---|---|
| `cli/native/__tests__/bridge.smoke.test.mjs` | **+304 / -1**（471 行） | 新增一个顶层 `test('strip-frames: one real strip to N frames, no baseline alignment')`：`bridgeBatch` 一批五个作业（512 成功臂 / `castThreshold 256` 失败臂 / `cell 256` 几何臂 / `preset default` 对照臂 / 原图臂），六个 `await t.test` 子测；模块头补 `existsSync` / `readFile` / `browserBundle` 三个 import。既有那一个 `test` 一字未动 |

## 闸门结果（实跑）

- 计划 `<automated>` → **exit 0**：`ℹ pass 17` / `fail 0` / `skipped 0`，`npm run test:cli` 一条命令（POST-05，未改 `package.json`）
- `npx tsc --noEmit` → exit 0；`npm test` → 36 文件 375 测试全绿
- 无文件时（`.ie/probe/…` 临时移走自测）：`ℹ pass 16 / skipped 1`，原图臂报 `﹣ … # raw strip is gitignored (.ie/probe)` —— **明的 skip，不是假过**；闸门的 `(skipped|cancelled) [1-9]` 分支单独用最小复现验过会红

## 逐臂断言（值全部取自实测，与 03-01 一致）

| 臂 | 断言 |
|---|---|
| 成功（`cell 512`） | 8 帧、`written` 空；`fitted {255,253,10496,167,246,residualPct 0.079436, gutterOk:false}`；`cutLines.x [508…2038]` / `mass [0,0,0,0,246,0,0]`；`field #FD05FA/cast 245/binary`；`windows[0] 0:253`、`windows[7] 1783:2038`；`gutter {ok:true, tolerance:3, unrescued:[], keyed 全 0, after 全 0}`；`counters` 十一项逐字（`keyed 8 / borderTrimmed 5 / isolated 1 / isolatedPx 365 / scaled 0 / centred 8`，其余 0）；每帧 512×512 字节数、四角 alpha 全 0、半透明恰 0、不透明 >10000、`scale = min(1, 448/max(bbox))` 与 `out`/居中关系自洽；帧 0 `243×204@135,154`、帧 7 `242×246@135,133`；最窄左边距 **131**；下边距 7 个不同值（≥3） |
| 失败（`castThreshold 256`） | `meta.ok:false`、零帧、`fieldSurvived:8`、`keyed` 全 246、`after` 全 0（把"第一级会假绿"写成断言） |
| 几何（`cell 256`） | `scaled:7`、帧 0 `243×204 → 224×188@16,34`（`scale 0.92181…= 224/243`）、帧 7 `→ 220×224@18,16`、每帧最大边 ≤224、最小留边 ≥16；八帧半透明合计恰 0（这一臂才真正咬住插值：7 帧被缩） |
| 对照（`preset default`） | 半透明像素 **2595**（>1000）、`isolated:0`，反证成功臂的 `isolated:1` 不是背景噪声 |
| 原图（有文件时） | `spacing 360 / phase 20 / trials 21594 / medianMass 239 / residual 352`、`field #FC06FA`、`windows[0].x0 20`、`unrescued [2180]`、`ok:false`、零帧、`isolatedPx 883` |
| 源码双查 | `animFrames.ts` 两个禁用导出名各 0 次、`FRAME_FILL = 0.875` 恰 1 次；`bridge.mjs` 的 `case 'strip-frames'` 体（切片带 `length >= 200` 反空转守卫）各 0 次；`browserBundle({force:true})` 产物含 `planStripFrames`/`frameMarginFloor`/`fitBox`/`0.875` |

## 偏离与说明

- 无功能偏离，断言值与计划逐字一致。
- 计划骨架给的是 `const [ok, neverKeyed, small, defaultPreset, raw] = bridgeBatch(jobs)`；实现里该行断言 `results.length === hasRaw ? 5 : 4`——因为原图臂按文件存在与否决定是否 push，写死 5 会在无该文件时红。这是计划骨架自身的算术，不是放宽。
- `bundle` 那组针脚（`planStripFrames` 等进了 IIFE）放在同一个「no baseline alignment」子测里，沿用计划 §⑦ 的"纯文本、不需要浏览器"的落点；bundle 已由上方的 `bridgeBatch` 经 `browserBundle()` 构建，`force:true` 只是让针脚对**当前源码**下结论，不是第二次启动浏览器。
- 未提交：`git status --porcelain` 只有 ` M cli/native/__tests__/bridge.smoke.test.mjs`（另有既存的 `?? .omp/`、`?? .planning/state.json`，非本次产生）。

## 闸门真的会红的实证（执行期各跑一次，均已还原）

1. 删掉第二级闸门（`counters.fieldSurvived === 0`）→ 失败臂立刻红：`castThreshold 256 keys nothing, so the strip must not pass`（`true !== false`），`pass 15 / fail 2`。这正是 T-03-08 要的形态。
2. 把居中改成"钉同一个地面"（`y: cell - h - 16`）→ 成功臂与几何臂同时红（`pass 14 / fail 3`）。D-27 的行为查不是空转。

两次修改后都 `shasum -a 256` 复核还原一致（`app/lib/animFrames.ts` = `41d112b1…`）。
