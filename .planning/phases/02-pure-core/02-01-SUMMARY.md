---
phase: 02-pure-core
plan: 01
status: complete
requirements: [GEOM-01, GEN-08]
---

# 02-01 Summary — `app/lib/animStrip.ts`（剖面 + 拟合 + prompt + 方向预设）

**执行方式：** inline（本 harness 无法 spawn 具名 gsd-* executor）。计划由独立 planner 撰写、独立 checker 两轮评审；**执行者与评审者不是同一上下文**。

## 交付物

| 文件 | 内容 |
|---|---|
| `app/lib/animStrip.ts`（300 行） | `columnProfile(rgba,w,h,fieldRgb)` 列质量剖面、`fitPanelGrid(profile,opts)` 的 ±8%/2% **参数化搜索**、`stripSize()`、`buildStripPrompt()`（常量约束 + 由 dirs 生成逐格枚举）、`DIRS8`/`DIRS4` 常量表、`directionForCell`/`cellForDirection`、`sampleFieldRgb`/`magentaCast` |
| `app/lib/__tests__/animStrip.test.ts`（245→264 行） | 27→28 条：合成剖面（均匀/相位偏移/噪声）测拟合、命名边界值、prompt 的八向枚举与约束、**外加一条把 Phase 1 探针的 prompt sha256 钉成漂移锚点的测试** |

## 闸门结果（实跑）

- `02-01` 三条 `<automated>` 全绿（exit 0）：结构 + 尺寸代数 + prompt 重建（`buildStripPrompt` 重建出的 prompt 与 `01-PROBE-RECORD.md` 的 `prompt_full` **逐字节一致**，sha256 `9d966280…cfe8a6` 复现）
- 拟合**是搜索**：源码扫描拒收任何写死的 360/253（行注释同样命中）
- 纯度（D-21）：`import` 行恰 1 条（`@/app/lib/animStrip` 侧无外部依赖），浏览器打包产物无 `require(`/`node:`
- `tsc --noEmit` 退出 0；`npm test` 全量绿（362 passed）

## 偏离与说明

- 起点是 planner 自验时留下的一份实现（`.ie/scratch/phase2-planner/`），**逐条过闸**而非直接收养；闸门确实抓到了两处：`es5` 目标下的 `DIRS8.entries()` / `matchAll` 展开会报 TS2802（已按仓库既有写法改成索引循环与 `exec` 循环），以及测试文件缺失那条 sha 锚点断言（已补）。
- 计划里那条"测试数 > 20"的承诺没有单独闸门；实际 28 条。
