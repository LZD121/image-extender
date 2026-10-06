---
phase: 01-transport-probe
verified: 2026-10-06T17:00:51Z
status: passed
score: 5/5 truths verified
covered_files:
  - .planning/phases/01-transport-probe/01-01-PLAN.md
  - .planning/phases/01-transport-probe/01-02-PLAN.md
  - .planning/phases/01-transport-probe/01-01-SUMMARY.md
  - .planning/phases/01-transport-probe/01-02-SUMMARY.md
  - .planning/phases/01-transport-probe/01-PROBE-RECORD.md
  - .planning/phases/01-transport-probe/01-VALIDATION.md
  - .planning/phases/01-transport-probe/probe-config.json
  - .planning/phases/01-transport-probe/evidence/call-result.json
  - .planning/phases/01-transport-probe/evidence/measured-raw.json
  - .planning/phases/01-transport-probe/evidence/measured-fixture.json
  - app/lib/aspectRatio.ts
  - app/api/generate/route.ts
  - app/api/generate/__tests__/aspectRatio.test.ts
  - app/lib/__tests__/providers.test.ts
  - scripts/probe-measure.mjs
  - tests/fixtures/anim/chaser_idle_f1_8dir.png
covered_digest: "v1:sha256:938fc52adbeaddb90ec1174a07abf8551be23d03aca82e6d1723cba46da5885c"
behavior_unverified: 1
behavior_unverified_items:
  - truth: "`apiKeyEnv` 把 key 来源（而非 key 值）带到出网请求的鉴权头上"
    test: "用 `probe-teamo`（`apiKeyEnv: TEAMOROUTER_API_KEY`）发一次真实调用，抓到出网请求的 `Authorization` 头，断言它等于 `Bearer $TEAMOROUTER_API_KEY`"
    expected: "出网请求带上由 env var 解析出的 bearer；配置里没有任何字面 key 值"
    why_human: "Phase 1 的探针走的是 `probe-magpie`（keyRequired=false、无 key），`probe-teamo` 是零成本的备用落点，本 phase 从未用它发过调用。存在性（配置里只有来源名、无 key 值）已静态验证；解析到真实请求头这一段行为没有任何测试或调用碰过。"
coincidental_reliance_items:
  - truth: "TRAN-04「六个既有 studio 请求的档位不变」"
    reason: fixture-only
    harden: "把 studio 画布清单从测试里硬编码的 4 条，改成从唯一的 studio 请求构造处（`app/lib/studioRequest.ts` / `app/page.tsx`）导出并断言，否则 studio 侧新增请求时回归不会红"
---

# Phase 1: 传输探针与精确尺寸透传 Verification Report

**Phase Goal:** 用一次真实 strip 调用（一次付费）测出：返回尺寸 vs 请求尺寸、面板拟合间距/相位、场色，并把传输决定固化下来（magpie 直通 / Teamo 直连以 magpie profile 表达 / 条件性放宽比例表）。

**Verified:** 2026-10-06T17:00:51Z
**Status:** passed

> **复审（2026-10-06T17:00:51Z，commit `f6cf83f`）。** 首审（`16:59:14Z`）判 `failed`，因 1 条阻断缺口 G-1（`tsc --noEmit` 红）与 2 条非阻断项 G-2/G-3。三项均已修，我**只复审这三项**并确认未引入新问题：
> - **G-1 关闭**：`npx tsc --noEmit -p tsconfig.json` → **exit 0**（首审时 exit 2）。修法即我建议的一行：`vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => …)` + `fetchMock.mock.calls[0]?.[1]?.body ?? ''`。`npm test` → **296 passed / 33 files**；`aspectRatio.test.ts` 单文件 → 5 passed。
> - **G-2 关闭**：三处 `16.3 MB` 已改为 `1,480,226 B = 1.48 MB`，并把 16.3 MB 明确归给**语料**里 11712×1408 那批图（`01-PROBE-RECORD.md:71,76`、`01-01-SUMMARY.md:21`、`01-VALIDATION.md:60`）。
> - **G-3 关闭**：`/tmp/probe-1.json`（1973877 B，含 data URL）已删除（`ls` 报 No such file）。
> - **新问题：无。** 因 `01-PROBE-RECORD.md` 在本次 commit 里被编辑，我**重跑了记录闸门**：json 围栏仍**恰好 1 个**、7 个必备字段仍非空、`prompt_full` 仍完整（1168 字符、无省略号）、8 个 cell 顺序不变、重算 sha256 仍 = `9d966280…cfe8a6`。表与 evidence 未被本次 commit 触碰。
> - **本报告保留首审全文**（下方 G-1/G-2/G-3 的原始证据），只在上方更新 status/score 与本节；`covered_digest` 已按 17 个文件重算。

> **本报告的独立性声明。** 我不是 `gsd-verifier`——这个 harness 无法 spawn 具名 `gsd-*` 角色，所以本轮验证是由一个 **generic agent** 顶替完成的，没有 GSD audit log。关键事实：**本 phase 的执行者是 orchestrator 本人**（两份 SUMMARY 自述 "inline（本 harness 无法 spawn 具名 gsd-* executor）"），计划由独立 planner agent 撰写。也就是说，被验证的实现与我之间**没有**作者关系——但我与 orchestrator 同属一个 harness，这一层无法像标准 GSD 那样由角色机制保证，只能靠"每一条都自己重跑"来补偿。下面每一条都标注了是**实跑**还是**读文件**。
>
> **模板枚举与本轮 status 取值。** 模板的 `status:` 枚举是 `passed | gaps_found | human_needed`；本轮任务书明确要求 `passed | failed`，故此处取 `passed`（按模板语义即 **`passed`**——全部 must-have 已核实、无阻断缺口）。首审取值 `failed` ≡ 模板的 `gaps_found`。注意 `behavior_unverified: 1` 的存在按模板规则**不会**把总体降为 `human_needed`，只因它不与更高优先级的 `gaps_found` 并存——它作为 `behavior_unverified_items` 原样保留并列进 Human Verification。

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **SC1** 仓库里有一份 probe 记录：请求画布、返回画布、拟合 `(spacing, phase)`、场色，全部来自同一次真实调用 | ✓ VERIFIED | 实跑重算：`01-PROBE-RECORD.md` 的 json 围栏**恰好 1 个**（全文 ``` 标记 6 个，`json` 语言标记 1 个）；7 个必备字段全部非空；`requested_aspect_name === "8:1"`；`returned_size === "2928x352"`；`channel === "magpie"`；`outcome === "成功"`；`raw_png_path === ".ie/probe/chaser_idle_f1_8dir.png"`。`prompt_full` 完整（1168 字符、**无省略号**，与正文 `text` 围栏逐字符相等），含 8 个 `cell N facing <dir>` 且顺序恰为 DIRS8；重算 `sha256(prompt_full)` = `9d966280…cfe8a6` == 记录值。**同源性复核**：`~/.config/magpie/usage.jsonl` 第 11578 行确为用户所引原行（`rid f6195b13…` 全文出现 1 次，`ms:14629`、`status:200`、`provider:teamo-router`、`ep:/v1/chat/completions`），且该行**不含 key 值**。 |
| 2 | **SC2** 传输决定有可执行的落地形态：magpie 直通或一个 magpie profile（`baseUrl`+`apiKeyEnv`），且 `PROVIDER_IDS` 数量未变 | ✓ VERIFIED | 实跑 `node cli/ie.mjs config list --json` → `{"id":"probe-teamo","provider":"magpie","baseUrl":"https://api.teamorouter.com/v1","imageModel":"gemini-3.1-flash-image","keySource":"$TEAMOROUTER_API_KEY (set)"}`，退出 0。**数量未变**：`git show c97d300^:app/lib/providers.ts` 与工作区**逐字节相同**的 `PROVIDER_IDS = ['openrouter','magpie','apimart']`（长度 3，顺序不变）。`.ie/config.json` 被 `git ls-files .ie/` 确认为 0 条跟踪记录（`.gitignore` 的 `.ie/` 覆盖）。 |
| 3 | **SC3** 若动了比例表，blast-radius 表已重算并断言六个既有 studio 请求的档位不变 | ✓ VERIFIED (coincidental-reliance) | 表确实动了（`app/lib/aspectRatio.ts` 由 route 内联迁出 + 新增 `4:1`/`8:1`，12 项）。实跑 `npx vitest run aspectRatio.test.ts` → 5 passed，断言 56 组里**恰 4 组**变化且全为 `21:9→4:1`、52 组逐组不变、`counts['4:1'] === 4`、`counts['21:9'] === 8`；六个 studio 档位逐条断言（4096×4096→1:1、2048×1024→16:9 ×2、512×512→1:1）。测试读的是**真出网体**（stub `globalThis.fetch`，解析 route 写出的 `init.body.image_config.aspect_ratio`），不是表的副本；负面对照 256×2048→9:16 阻止 `1:8` 混入。**advisory**：studio 那 4 条是测试里硬编码的字面量（`fixture-only` 味道）——见 `coincidental_reliance_items`。 |
| 4 | **SC4** 探针的失败模式（超时 vs 比例）被如实记录，不是"重试到成功"掩盖过去 | ✓ VERIFIED | 记录 `outcome: 成功` 与 `gutter_ok: false` **分开**写；正文用整段 "**gutter 判定为 False**：8 格里有 1 条边界被实体占满" 明确说这是模型没守 gutter，并说明"这不是探针失败"。我独立重跑 `probe-measure.mjs` 得到同一结论（见 #5）。`paid_calls_this_phase: 1` 与网关日志一致（无第二次调用）。**判读见下方「关于 `成功` 这个标签」**。 |
| 5 | 记录里的每个数字都能由磁盘上的字节离线重算出来 | ✓ VERIFIED | 实跑两次 `node scripts/probe-measure.mjs tests/fixtures/anim/chaser_idle_f1_8dir.png 8` → 2048×246、aspect 8.3252、`fitted_pitch 255`、`phase 253`、`delta_pct_vs_uniform -0.391`、`gutter_ok false`、`cut_lines` 第 5 条 x=1528 mass=246（其余 0）、`trials 10496`——与 `01-PROBE-RECORD.md` 与 `evidence/measured-fixture.json` 逐字段一致。**确定性**：两次输出在 `jq -S 'del(.seconds_measure)'` 后 sha256 相同（`70909fec…1115`）；只有 `seconds_measure` 浮动（0.011741 vs 0.010629），与脚本头注释的确定性契约一致。**原始条带**：`.ie/probe/` 非空，实跑 → 2928×352、aspect 8.3182、pitch 360、phase 20、Δ −1.639、gutter_ok false、x=2180 mass=352、trials 21594——与 `measured-raw.json` 逐字段一致。 |
| 6 | 计划自定的落地闸门：`npx tsc --noEmit -p tsconfig.json` 退出 0 | ✓ VERIFIED（复审后） | **复审实跑：exit 0。** 首审时 exit 2（TS2532 + TS2493，见 G-1）；`f6cf83f` 修好 mock 签名后转绿。对照 `next build` 首审即 exit 0（Next 的生产类型检查排除测试文件——这也是为什么没有任何自动化拦住首审那个红）。 |

**Score:** 5/5 truths verified（另 1 条 PRESENT_BEHAVIOR_UNVERIFIED，随 `behavior_unverified_items` 列进 Human Verification）

> **truth 6 的归属说明。** 它不是 ROADMAP 的 Success Criterion，而是计划自定的 `<automated>` 闸门。列进 must-have 是因为 `01-02-PLAN.md` 把它写成 Task 1 的 `<done>`，且 `01-02-SUMMARY.md` 声称它已绿——这个声称在首审时**与提交状态不符**（测试文件与声称同属 `c97d300`）。修好后才与声称一致。

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/probe-measure.mjs` | 从 PNG 重算尺寸/场色/拟合参数 | ✓ EXISTS + SUBSTANTIVE | 125 行；sharp 解码真实字节取 W/H（从不读请求）；四角中位数取场色；全图列质量剖面；`s×phase` 双循环搜索（`Math.round(p + k*s)` 用**四舍五入**而非截断，与拟合循环同语义，自洽）；Δ%、gutter、trials。除 `seconds_measure` 外纯函数，已实测两次逐字节相同。 |
| `tests/fixtures/anim/chaser_idle_f1_8dir.png` | 一张下采样后的真实 8 向条带图 | ✓ EXISTS + SUBSTANTIVE | 实跑 `stat`：945309 B（0.945 MB，落在 0.4–1.8 MB 区间）；`sips`/sharp 均报 2048×246。`git check-attr diff …` → **`diff: unset`**（`.gitattributes` 的 `*.png -diff` 覆盖）。 |
| `app/lib/aspectRatio.ts` | 比例表的唯一之家，12 项 | ✓ EXISTS + SUBSTANTIVE | 49 行；`SUPPORTED_IMAGE_ASPECT_RATIOS` 12 项且 `new Set(...).size === 12`（测试断言，反空转）；`const SUPPORTED_IMAGE_ASPECT_RATIOS` 的定义在 `app/` 下**恰好命中 1 个文件**（`grep -rl`）。 |
| `app/api/generate/route.ts` | 删掉内联表、改为一行 import | ✓ EXISTS + SUBSTANTIVE | 实跑：`grep -c SUPPORTED_IMAGE_ASPECT_RATIOS route.ts` = **0**；`grep -c "from '@/app/lib/aspectRatio'"` = **1**；:132 调用点 `image_config: { aspect_ratio: supportedAspectRatioForSize(width, height) }` 未动。 |
| `app/api/generate/__tests__/aspectRatio.test.ts` | blast-radius 回归（读真出网体） | ✓ EXISTS + SUBSTANTIVE | 190 行；5 个断言块全部通过；`BEFORE` 基表 56 条齐备（缺一条即 `expect(before).toBeTruthy()` 红）。 |
| `app/lib/__tests__/providers.test.ts` | `PROVIDER_IDS` 未增第四家 | ✓ EXISTS + SUBSTANTIVE | 新增 describe 3 条：成员与顺序、`isProviderId('teamo') === false`、`PROVIDERS.magpie.keyRequired === false`。 |
| `.planning/phases/01-transport-probe/probe-config.json` | 两份 profile，无内联 key | ✓ EXISTS + SUBSTANTIVE | `probe-magpie`（网关直通）+ `probe-teamo`（`baseUrl` + `apiKeyEnv`）；**无 `"apiKey"` 字段**。 |
| `.ie/config.json`（gitignored） | 落地的 magpie profile，无内联 key | ✓ EXISTS + SUBSTANTIVE | 实跑：未跟踪、无 `"apiKey"` 字段、key 值为来源名。 |

**Artifacts:** 8/8 verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `route.ts` POST | `supportedAspectRatioForSize` | `@/app/lib/aspectRatio` import | ✓ WIRED | route.ts:132 真实调用；测试从**真出网体**读回该函数的结果。 |
| 出网体 | 模型 | `image_config.aspect_ratio` | ✓ WIRED（本机侧） | 测试证明本机对 `4096×512` 写出 `8:1`。"该值原样到达远端模型"由**返回 2928×352 = 8.3182** 反证——见下方「独立复核」。 |
| `probe-measure.mjs` | PNG 真实字节 | `sharp(...).raw()` | ✓ WIRED | W/H 取自 `info`（解码后），不取自请求。 |
| `probe-teamo` 的 `apiKeyEnv` | 出网 `Authorization` 头 | `ieConfig.ts` → 调用方 | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | 配置解析链已由 `ieConfig.test.ts`（33 tests）覆盖存在性；**解析成真实请求头**这一步本 phase 从未跑过（探针走的是无 key 的 `probe-magpie`）。 |

**Wiring:** 3/4 connections verified

## Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| TRAN-03（一次真实探针记录 returned 尺寸/拟合间距/场色，结论固化成常量或 profile） | ✓ SATISFIED | - |
| TRAN-04（比例表按 spec §9.3 放宽 + 六个 studio 档位不变回归） | ✓ SATISFIED | 见 `coincidental_reliance_items`（studio 清单硬编码） |
| TRAN-05（fallback 以 magpie profile 表达，`PROVIDER_IDS` 数量不变） | ✓ SATISFIED | `apiKeyEnv` 到出网头这一段行为未行使（非阻断，见 Human Verification） |

**Coverage:** 3/3 requirements satisfied

## Anti-Patterns Found

> 首审发现 3 条；**G-1 与 G-2 已在 `f6cf83f` 修掉**，此处保留原始证据并标注现状。（G-3 是环境残留项，见 Gaps 节。）

| File | Line | Pattern | Severity | Impact | 现状 |
|------|------|---------|----------|--------|------|
| `app/api/generate/__tests__/aspectRatio.test.ts` | 47 | `fetchMock.mock.calls[0][1].body` — `vi.fn()` 无参数签名使 `mock.calls[0]` 推断为 `[]`，`[1]` 越界 | 🛑 Blocker | `strict: true` 下 `tsc --noEmit` 报 TS2532 + TS2493；计划自定的闸门红 | ✅ **已修**（`f6cf83f`）：参数已声明 + 可选链；tsc 转 exit 0 |
| `01-PROBE-RECORD.md:71,76` / `01-01-SUMMARY.md:21` / `01-VALIDATION.md:60` | 71 等 | `真实返回 2928×352 ≈ 16.3 MB` —— **约 11 倍夸大**，实测 1480226 B = 1.48 MB | ⚠️ Warning | 不影响任何断言（原始字节从未进仓库），但这是研究期一个错误估算（11712×1408）的残留，被三处复制 | ✅ **已修**（`f6cf83f`）：三处改为 `1,480,226 B = 1.48 MB`，16.3 MB 明确归给语料那批 11712×1408 的图 |
| `01-PROBE-RECORD.md`（json 块） | 107 | fixture `phase: 253` 未说明是 `phase mod pitch` | ℹ️ Info | 原始 `phase: 20` 与 fixture `255` 同量级，两者语义不同源 | ⬜ 未改（非阻断）；见下方 Note-1 |

**Anti-patterns:** 3 found (1 blocker — 已修, 1 warning — 已修, 1 info — 保留)

### Note-1：两个 `phase` 是同一语义但来源不同（接受为已知事项）

`raw phase = 20`、`fixture phase = 253`，而 `fixture = 0.708× raw` 下 pitch 从 360 缩到 255。20 与 253 不是同一个物理量的两个值，而是**同一取模语义（`phase mod pitch`）在两个不同模数下的两个代表元**——同一个切割相位的等价类。**Phase 2 的 `fitPanelGrid` 不得把其中任何一个当成常量抄下来**：相位必须在给定 pitch 下重新搜索（记录正文的 Fit 节也正是靠"Δ% 符号在两套图上相反"证明了拟合必须是搜索而非常量）。

## Human Verification Required

### 1. `apiKeyEnv` → 出网 `Authorization` 头的真实解析

**Test:** 给 `probe-teamo` 的 `apiKeyEnv` 指向的 env var 赋值，用它发一次（或零成本的 dry-run）请求，抓出网请求头。
**Expected:** `Authorization: Bearer <该 env var 的值>`，且仓库/配置里不存在任何字面 key。
**Why human:** 本 phase 的唯一次付费调用走的是 `probe-magpie`（`keyRequired: false`，无 key），`probe-teamo` 是零成本备用落点，从未被行使。存在性（配置只存来源名）已静态验证；行为未行使。

### 2. `成功` 这个标签的判读（见下）

## 关于 `成功` 这个标签（判读，不是缺陷）

任务书要求对记录的自评做诚实性交叉核对，我的判读是：**`成功` 用在这里是对的，但它是一个窄命题的标签，记录本身把这一点说清楚了。**

- 该 phase 存在的理由（ROADMAP Goal 与 `app/lib/aspectRatio.ts` 模块头都写死了）是："出网的**比例名**能不能到达模型"。改动前 `4096×512` 会静默落到 `21:9`（= 2.333）；改动后写出 `8:1`，模型回来 **8.3182** —— 与消费端同一签名。
- **我独立复核了这条核心推断**（这是 `success criteria 1` 的实质，不只是"调用没报错"）：在 `~/repos/dark-black` 上量了磁盘上全部 `*_8dir.png`——**32/32 全部是 11712×1408 = 8.3182**，与探针返回的 8.3182 完全同值（记录里 "返回宽度是请求的 2.86 倍" 也对：11712/4096 = 2.859）。消费端另有 8 张 `*_4dir.png`（hero，4128×1024 = 4.0312，请求 4:1）。即**磁盘上确有 40 张已交付 strip 带这个签名**。所以"8:1 这个比例名能到达模型"是**被外部证据复核过的事实**，不是自证。
- 记录**没有**把 `成功` 扩大到拟合质量：`gutter_ok: false` 单列，正文写明"8 格里有 1 条边界被实体占满""这不是探针失败""这正是 Phase 3 的 gutter 闸门要拦的东西"。我重跑得到同一条越界（x=2180 mass=352 / 全高 352）。
- **残留的窄点**：远端确实收到了 `8:1` 这一句，是**推断**而非直接观测——`/tmp/probe-1.json` 只存响应（`body/ok/status/summary/written`，不含请求体），出网体本身没有落盘证据。支持它的证据是 8.3182 这个签名（旧表下任何画布都不可能落到 8:1 这一档）。若未来需要硬证据，应在 `imageGeneration` 的 fetch 处加一个**只记 `image_config`** 的调试钩子。

## Anti-Vacuity 复核（测试是否真的能失败）

| 断言 | 若它错了会怎样 | 复核方式 |
|------|----------------|----------|
| json 围栏数 == 1 | 加第二个 ```json 块即红 | 我实跑重数：1 个 json、6 个 ``` 标记 |
| 8 个 `cell N facing <dir>` 按序 | 少一个或顺序错即红 | 正则实跑：8 个，顺序 = DIRS8 |
| `prompt_sha256` 重算 | 改一个字即红 | 我重算：相等 |
| 两次运行逐字节相同 | 任一处非确定性即红 | 我实跑两次：sha256 相同 |
| 56 组 4 变 / 52 不变 | 多一个变化项即 `expect(changed).toEqual([...])` 红 | 实跑 5 passed |
| `Set(table).size === 12` | 加重复项即红 | 表实为 12 项 |
| `isProviderId('teamo') === false` | 真有第四家即红 | `PROVIDER_IDS` 实测长度 3 |
| 256×2048→9:16 负面对照 | 混入 `1:8` 即红 | `SUPPORTED_IMAGE_ASPECT_RATIOS` 的逆比例实为 `['2:3','3:4','4:5','9:16']` |

无空转断言。

## Gaps

> **复审结论（2026-10-06T17:00:51Z，`f6cf83f`）：无阻断缺口。** G-1 与 G-2 已关闭（原始证据保留在下方，只加"现状"行）；G-3 已关闭。总体 status 由 `failed` 改为 `passed`。

### G-1（阻断）：计划自定的 `tsc --noEmit` 闸门为红 —— ✅ 已关闭

- **Missing（首审时）:** `app/api/generate/__tests__/aspectRatio.test.ts:47` 不满足 `strict: true`。`vi.fn(async () => …)` 未声明参数，vitest 把 `mock.calls` 推断为 `[][]`，于是 `fetchMock.mock.calls[0][1]` 报两个错：
  ```
  app/api/generate/__tests__/aspectRatio.test.ts(47,29): error TS2532: Object is possibly 'undefined'.
  app/api/generate/__tests__/aspectRatio.test.ts(47,53): error TS2493: Tuple type '[]' of length '0' has no element at index '1'.
  ```
- **Evidence（首审实跑 3 次）:** `npx tsc --noEmit -p tsconfig.json` → **exit 2**；`next build` → exit 0。
  两者的差别已定位：`tsconfig.json` 的 `include` 覆盖 `**/*.ts`（含测试），而 Next 生产构建用的类型检查把测试文件排除在外。**仓库里没有 `.github/workflows/`、没有 CI 配置，`package.json` 也没有 `typecheck` script**——所以这个红**不会**被任何自动化拦住，只有人手动跑计划里写的那条命令才会看见。
- **Impact:** 计划把这条写成 Task 1 的 `<done>`（"tsc 全绿"）与 `<fails_when>`，02-SUMMARY 也声称"`npx tsc --noEmit` 退出 0"——首审时**该声明与提交状态不符**（测试文件在 `c97d300` 里就被 commit 了，是同一个提交）。任何后续 phase 跑计划里那条 tsc 命令都会红；一个"红基线"会让下一处真正的类型错误淹没在噪声里。
- **Fix（首审建议）:** 给 fetch 桩补上参数签名。已按此修（`f6cf83f`）。
- **✅ 现状（复审实跑）:** 代码现在写 `vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => …)`，取用处为 `String(fetchMock.mock.calls[0]?.[1]?.body ?? '')`。`npx tsc --noEmit -p tsconfig.json` → **exit 0**；`npm test` → **296 passed / 33 files**；`npx vitest run app/api/generate/__tests__/aspectRatio.test.ts` → 5 passed。**关闭。**

### G-2（非阻断）：记录里的体积估算错了一个数量级 —— ✅ 已关闭

- **Issue（首审时）:** `01-PROBE-RECORD.md:71`、`01-01-SUMMARY.md`、`01-VALIDATION.md:60` 写 "原始返回 2928×352 ≈ 16.3 MB"；**实测 1480226 B = 1.48 MB**（`stat -f '%z'`）。16.3 MB 是研究期对 11712×1408 那批条带的估算，被错误地挂到了这张 2928×352 的探针图上。
- **Impact:** 有限——原始字节从未进仓库，fixture 0.945 MB 与 gate 都正确；但这是三处可被读者引用的错误数字。
- **Recommendation（首审建议）:** 改这三处为 "1.48 MB"。
- **✅ 现状（复审实跑 `grep`）:** 三处均已改为 `1,480,226 B = 1.48 MB`，并把 16.3 MB 明确归给**语料**里 11712×1408 那批图（`01-PROBE-RECORD.md:71,76`、`01-01-SUMMARY.md:21`、`01-VALIDATION.md:60`）。fixture 的 2048×246 / 0.945 MB 未动。**关闭。**

### G-3（非阻断）：`.ie/probe/` 里的原始条带含客户内容，且 `/tmp/probe-1.json` 是世界可读的 —— ✅ 已关闭

- **Issue:** 见 SECURITY.md §6。`.ie/probe/chaser_idle_f1_8dir.png`（1.48 MB，未跟踪）是真实返回图；`/tmp/probe-1.json`（1973877 B，含完整 data URL）权限 `0644`。
- **Impact:** 低——`.ie/` 已 ignore，`/tmp` 是 OS 临时区且探针图只是游戏素材。威胁模型（PROJECT.md）本就限于"自己误操作"。
- **✅ 现状（复审实跑）:** `ls /tmp/probe-1.*` → **No such file or directory**，已删除。（另注：`/tmp` 里仍有两个**更早的、非本 phase 的**同级残留——`probe_ref.json` 1.6 MB、`probe_teamo-router_gemini-3.1-flash-image.json` 1.58 MB，各含 1 处 `data:image`。它们属于 Phase 0 研究期，**不在本 phase 的改动面内**，故不计入本 phase 缺口，仅在此备案。）
- **`/tmp` 权限口径**：实测这些文件的权限位是 `-rw-r--r--`（`0644`），即 mode 位为 0644；若按"是否 world-writable"读则应为 `-rw-rw-rw-`（0666）——首审报告里"世界可读"指的是**可读**（0644，other 可读），此处口径已写清，避免后续误读。

## Verification Metadata

**Verification approach:** Goal-backward（从 ROADMAP Phase 1 的 4 条 Success Criteria + 计划自定闸门反推）
**Must-haves source:** `.planning/ROADMAP.md` Phase 1 Success Criteria（4 条，SC1–SC4）+ `01-02-PLAN.md` Task 1 的 `<automated>` tsc 闸门（1 条）= **5 条**
**Automated checks:** 首审 8 跑 7 通过 1 失败；**复审 3 跑全通过**（`tsc` exit 0、全量 296 passed、记录闸门重跑仍绿）——累计 11 跑，10 通过，唯一一次失败即 G-1，已修
**Human checks required:** 2（`apiKeyEnv` 到出网头的行为；`成功` 标签的判读已在本报告给出）
**Verified files:** 17（= 四个 phase commit 的全部改动：`c97d300` `00f0d3a` `1360b49` `f6cf83f`）
**Total verification time:** 首审 ~15 分钟 + 复审 ~3 分钟

### 逐条重跑记录

| # | 命令 | 首审（16:59:14Z） | 复审（17:00:51Z，`f6cf83f`） |
|---|------|------|------|
| 1 | `npx tsc --noEmit -p tsconfig.json` | ✗ **exit 2**（TS2532 + TS2493）；`next build` 对照 exit 0 | ✓ **exit 0** |
| 2 | `npx vitest run aspectRatio.test.ts providers.test.ts` / `npm test` | ✓ 2 files / 17 passed；33 files / **296 passed** | ✓ 单文件 5 passed；33 files / **296 passed**（复跑） |
| 3 | `node scripts/probe-measure.mjs tests/fixtures/anim/chaser_idle_f1_8dir.png 8` ×2 | ✓ 2048×246；`jq -S 'del(.seconds_measure)'` 后 sha256 相同 `70909fec…1115` | —（未受影响，脚本未改） |
| 4 | `node scripts/probe-measure.mjs .ie/probe/chaser_idle_f1_8dir.png 8` | ✓ **2928×352**，aspect **8.3182**，pitch 360 / phase 20 / Δ −1.639 / gutter_ok false | — |
| 5 | json 围栏 + sha256 重算 | ✓ 恰 1 个 json 围栏；8 个 cell 按序；`#FF00FF` 在；sha256 重算 = 记录值 | ✓ **重跑仍绿**（`f6cf83f` 改了该文件正文，故必须重验）：围栏 1 个、7 字段非空、`prompt_full` 1168 字符无省略号、8 个 cell 按序、sha256 = `9d966280…cfe8a6` |
| 6 | evidence 扫描 | ✓ 三份 evidence **无** `data:image`；`usage_provider=teamo-router`；`channel=magpie`；key 值在跟踪树 + `.ie/` 中 0 命中 | ✓ 未受影响（evidence 未改） |
| 7 | `git check-attr diff …fixture.png` | ✓ `diff: unset`；945309 B（区间内） | ✓ 未受影响 |
| 8 | `node cli/ie.mjs config list --json` | ✓ `probe-teamo` / `provider: magpie` / `baseUrl …/v1` / `keySource: $TEAMOROUTER_API_KEY (set)`；`.ie/config.json` 未跟踪、无 `"apiKey"` | ✓ 未受影响 |
| 9 | 交叉核对 + 外部复核 | 判读见正文；**32/32** 消费端 `*_8dir.png` = 11712×1408 = 8.3182（独立复算） | — |
| 10 | `git log` / `git status` | ✓ 三个 phase commit；无未提交的 phase 工作 | ✓ 现为四个 phase commit（+`f6cf83f`）；`git status` 仅 `.omp/`、`.planning/state.json` 与本报告两个产物未跟踪 |
| 11 | 复审新增：`ls /tmp/probe-1.*` + `grep 16.3/1.48` 三处 | — | ✓ tmp 已清、三处数字已改（G-2/G-3 关闭证据） |

---

*Verified: 2026-10-06T17:00:51Z（首验 2026-10-06T16:59:14Z，复审于 `f6cf83f`）*
*Verifier: generic agent（替身 gsd-verifier + security 步骤；非本 phase 作者——执行者是 orchestrator，计划由独立 planner 撰写）*
