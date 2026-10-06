---
phase: 01-transport-probe
plan: 02
status: complete
requirements: [TRAN-04, TRAN-05]
commits: []
---

# 01-02 Summary — 精确尺寸透传：比例表放宽 + 回归断言 + Teamo profile

**执行方式：** inline（本 harness 无法 spawn 具名 gsd-* executor；由 orchestrator 按 `01-02-PLAN.md` 逐任务执行并逐个跑硬闸门）。计划由独立 planner agent 撰写、独立 checker agent 评审——执行者与被评审对象不是同一上下文。

## 交付物

| 文件 | 内容 |
|---|---|
| `app/lib/aspectRatio.ts`（新增） | 比例表的唯一之家：12 项（原 10 项 + `4:1`/`8:1`）+ `aspectRatioValue` + `supportedAspectRatioForSize`。搬出 route 的原因写在模块头：Next 的 route 模块类型约束不允许额外导出（实测 TS2344）。 |
| `app/api/generate/route.ts` | 删掉文件内的表与两个函数（原 :7-34），改为一行 `import { supportedAspectRatioForSize } from '@/app/lib/aspectRatio'`；:160 的调用点与 `extra` 形状未动。 |
| `app/api/generate/__tests__/aspectRatio.test.ts`（新增） | 读**真出网体**（stub `globalThis.fetch`，解析 `init.body` 的 `image_config.aspect_ratio`）的回归断言：4 变 / 52 组逐组不变 / 无一组落到 `8:1` / 六 studio 四条独立断言 / `4096×512→8:1`、`2048×512→4:1` / `256×2048→9:16` 负数对照 / `Set(...).size === 12` 反空转。 |
| `app/lib/__tests__/providers.test.ts` | 新增 `PROVIDER_IDS` describe：长度 3、成员与顺序恰为 `openrouter/magpie/apimart`、`isProviderId('teamo') === false`、`PROVIDERS.magpie.keyRequired === false`。 |
| `.ie/config.json`（未跟踪，已 gitignore） | `probe-teamo` = magpie profile：`baseUrl: https://api.teamorouter.com/v1`、`apiKeyEnv: TEAMOROUTER_API_KEY`、`imageModel: gemini-3.1-flash-image`。**无内联 apiKey**。 |

## 闸门结果（全部实跑）

- Task 1：`npx tsc --noEmit` 退出 0；`'8:1'`/`'4:1'` 各 1 次；route.ts 里 `SUPPORTED_IMAGE_ASPECT_RATIOS` 提及 0 次；`const SUPPORTED_IMAGE_ASPECT_RATIOS` 的定义只命中 `app/lib/aspectRatio.ts` 一个文件。
- Task 2：跑 aspectRatio 与 providers 两个测试文件 → **17 passed**（2 files）。
- Task 3：`ie config list --json` 读出 `probe-teamo`（provider=magpie、baseUrl 带 `/v1`、keySource=`$TEAMOROUTER_API_KEY (set)`）；`.ie/config.json` 无 `"apiKey"` 字段；`git check-ignore` 确认被忽略。
- 全量回归：`npm test` → **296 passed / 33 files**（`styleInjection.test.ts` 等既有测试未受影响）。

## 实测 blast radius（本机枚举，与计划的 4/56 一致）

改前 → 改后，只有这四组变化，全部 `21:9 → 4:1`：`1280×360`、`1536×360`、`1920×360`、`1920×540`；其余 **52 组逐组不变**；`4:1` 计 4 次、`21:9` 剩 8 次、**没有任何组合落到 `8:1`**（梯子最宽 1920×360 = 5.333）。六个 studio 尺寸（4096×4096→1:1、2048×1024→16:9、512×512→1:1）逐字不变。

研究文档早先的 "10/56（含 1920×720、512×1536）" 口径不符——那是同时加入 `3:1/1:3/1:4/1:8` 一整组的算法；本次只加两行，因此测试里显式禁止出现那两个尺寸作为变化项。

## 偏离与说明

- 无功能偏离。计划的 Task 1~3 全部按写法落地。
- `.ie/config.json` 不进仓库（`.ie/` 已 gitignore），与计划的 acceptance 一致。

## 下一步

`01-01`（探针：一次真实付费调用 + 离线测量 + 记录 + fixture）——它的第一步是零成本硬前置：断言 `supportedAspectRatioForSize(4096,512) === '8:1'`。**该前置现已满足**（见上表）。
