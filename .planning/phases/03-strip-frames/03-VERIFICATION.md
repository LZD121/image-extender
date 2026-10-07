---
phase: 03-strip-frames
verified: 2026-10-07T08:30:09Z
status: passed
score: 21/21 truths verified
covered_files:
  - .planning/phases/03-strip-frames/03-CONTEXT.md
  - .planning/phases/03-strip-frames/03-DISCUSSION-LOG.md
  - .planning/phases/03-strip-frames/03-VERIFICATION-NOTE.md
  - .planning/phases/03-strip-frames/03-01-PLAN.md
  - .planning/phases/03-strip-frames/03-01-SUMMARY.md
  - .planning/phases/03-strip-frames/03-02-PLAN.md
  - .planning/phases/03-strip-frames/03-02-SUMMARY.md
  - app/lib/__tests__/chromaPresets.test.ts
  - app/lib/animFrames.ts
  - app/lib/animStrip.ts
  - app/lib/chromaPresets.ts
  - cli/commands/prim.mjs
  - cli/native/__tests__/bridge.smoke.test.mjs
  - cli/native/bridge.mjs
  - cli/native/bundle.mjs
  - docs/agent-api.md
covered_digest: "v1:sha256:98cf39ebae14d7c711aade851a2b6d01c8e0ce74da195701396dfd5310e8a561"
behavior_unverified: 0
behavior_unverified_items:
coincidental_reliance_items:
  - truth: "原图臂（`spacing 360 / phase 20 / trials 21594 / medianMass 239 / residual 352 / field #FC06FA / unrescued [2180] / ok:false / 零帧 / isolatedPx 883`）"
    reason: fixture-only
    harden: "该臂挂在 `existsSync('.ie/probe/chaser_idle_f1_8dir.png')` 上，而 `.ie/` 被 gitignore——干净 clone 上它是**明的 skip**（`ℹ pass 16 / skipped 1`），不是假过。要让它处处成立，把该 raw 的**列剖面**（`Int32Array`，约 11 KB）作为 fixture 入库并由剖面断言拟合值。"
---

# Phase 3: strip → frames 后处理（bridge op `strip-frames`）Verification Report

**Phase Goal:** 新增**一个** bridge op，把"一张 strip → N 帧"实现成对既有 `IE.*` 导出的薄组合（panel-fit → chroma 二值 → removeFrameBorder → isolate → 套 cell 居中），**基线对齐关闭**，每步 best-effort 都返回计数器，并带上 gutter 与几何断言。（`.planning/ROADMAP.md` §Phase 3）
**Verified:** 2026-10-07T08:30:09Z
**Status:** passed
**Re-verification:** No — initial verification

**Verifier:** generic agent（替身 GSD 的 `gsd-verifier` 角色——本环境 spawn 不出 typed `gsd-*` agent）。**我未参与实现**：执行者是 orchestrator 指挥下的通用代理，计划由独立 planner 撰写、独立 checker 三轮评审。下面每一条都是我**自己在磁盘上重跑**的；凡未重跑的一律标 `[INFERENCE]`，不冒充证据。**零付费调用、零网络出网、未改任何产品代码**（本报告与 `SECURITY.md` 是本次会话仅有的两个写入）。

## Goal Achievement

### Observable Truths

must_haves 来源：`03-01-PLAN.md` frontmatter（11 条）+ `03-02-PLAN.md` frontmatter（10 条），共 21 条。

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `strip-frames` 是对既有导出的薄组合：`chromaKeyToAlpha`(二值) → `removeFrameBorder` → `isolatePrimarySpriteComponent` → trim 到 alpha 包围盒 → 等比缩到 `cell×0.875` → 居中；切格来自 Phase 2 纯函数 | ✓ VERIFIED | 实读 `animFrames.ts:222-438`：五个步骤逐字对齐，切格调 `sampleFieldRgb`/`columnProfile`/`fitPanelGrid`（:252-261），模块无第二份拟合。实跑 8 帧产出（下详） |
| 2 | 整条链**没有** `alignSpriteFramesToBaseline`（D-27）也没有 `normalizeSpriteFrameScale`（D-24），源码＋行为双向可证 | ✓ VERIFIED | 源码：`animFrames.ts` 各 **0** 次、`bridge.mjs` 的 `case 'strip-frames'` 体（切片 722 字符，含 ≥200 反空转守卫）各 **0** 次。行为：八帧下边距 **7 个不同值** `[154,148,143,145,152,143,155,133]`（≥3 的门槛）——基线对齐会把每帧钉到同一地面 |
| 3 | op 形状沿用 bridge 契约（D-25）：`IN[0]` + `opts` → `{data:string[]}` + `meta{fitted,field,windows,gutter,counters,frames}`；阈值可取默认可覆盖 | ✓ VERIFIED | 实跑返回体逐键核对：`meta` 含 `ok/cells/cell/preset/dirs/fitted/field/windows/gutter/counters/frames` 十一键；`opts.key` 覆盖与 `opts.preset` 覆盖各有一条臂实跑（失败臂 / 对照臂） |
| 4 | gutter 闸门是**两级**的，缺一级就是空的：第一级会被骗（`castThreshold 256` 时 `after` 全 0、`rescued:7`），第二级 `fieldSurvived` 抓住它 | ✓ VERIFIED | 实测失败臂：`gutter.lines` 的 `keyed` 全 **246** / `after` 全 **0** / `rescued: 7` / **`fieldSurvived: 8`** → `meta.ok:false`、零帧。`animFrames.ts:383` 的 `ok` 三合一（`gutterOk ∧ fieldSurvived===0 ∧ empty===0`）实读确认 |
| 5 | `binary` 是新加的一行（D-23），不是就地改数值：`128 / 0 / 1 / 0.5`；可见后果是硬的可测的（同图 `binary` 0 半透明 vs `default` 2595） | ✓ VERIFIED | `chromaPresets.ts:68` 逐字 `binary: { castThreshold: 128, castSoftness: 0, despill: 1, despillGreenBoost: 0.5 }`。实跑：成功臂八帧半透明**合计 0**，`default` 对照臂**合计 2595** |
| 6 | 128 落在实测两事实之间：生物自身洋红度最大 99（6px 腐蚀后 p99.9 ≤ 11），而水洗在被占切线上是 cast 153..174（整列 246 px） | ✓ VERIFIED | 我自己重算：fixture x=1528 列 **246/246 行 cast>0，min 153 / max 174**（p05/median/p95 = 160/166/170）；生物像素（cast<128 且 6px 腐蚀）n=208510，**max 15、p99.9 = 10**；未腐蚀 max **127**。计划的"最大 99"是其自己更严的口径，我的独立口径给出更宽的 127——两者都在 128 之下，**结论不变**（见 Gaps 第 2 条） |
| 7 | **被占 ≠ 一定失败**，同一条代码两种结论：fixture 的占线是水洗（抠掉→`ok:true` 8 帧） | ✓ VERIFIED | fixture 实跑 `ok:true`、8 帧、`gutter.unrescued:[]`、`fitted.gutterOk:false`（源剖面自信度）但 `gutter.ok:true`（抢救后判定）——**两个字段都在 `meta` 里**，正是"分得开"的证据 |
| 8 | 原图的占线（x=2180，58 px）是**生物自己的像素**，抠底抠不掉、isolate 也救不回来 → `ok:false` 零帧 | ✓ VERIFIED | 实跑：`keyed 58 / after 58 / unrescued [2180] / ok:false / 零帧 / isolatedPx 883 / isolated:1`。我独立核算该列 cast<128 者 58 px（`is…` 计数 57，见 Gaps 第 1 条），且 2175..2183 邻居列 37..84 px——确认是**连续实心块**而非邻格残肢 |
| 9 | 每个 best-effort 步都有整数计数器进 `meta.counters`（POST-02），十一项，键名与 `StripRecord.steps`（`Record<string,number>`）同形 | ✓ VERIFIED | 实跑 `Object.keys(counters).length === 11`：`keyed/fieldSurvived/borderTrimmed/borderFailed/isolated/isolatedPx/isolateFailed/scaled/centred/empty/rescued`；`animSet.ts:291` 的 `steps: Record<string, number>` 实读同形 |
| 10 | 计数器区分"跑过"与"真的改了东西"：两个导出在没改动时原样返回入参，故字符串比一次即知；实测 `borderTrimmed 5 / isolated 1 / isolatedPx 365` 三个非零 | ✓ VERIFIED | 实跑成功臂 `borderTrimmed:5, isolated:1, isolatedPx:365, borderFailed:0, isolateFailed:0`——与计划逐字相等；实现（`animFrames.ts:300-324`）确实做的是 `trimmed !== keyed` / `split !== bordered` 的字符串/身份比较 |
| 11 | `phase` 是**模代表元**，朴素原点会丢格；op 把原点归一化到仍能容纳全部 `cells` 个窗口 | ✓ VERIFIED | 实跑 `windows[0] = {0,253}`、`windows[7] = {1783,2038}`，八窗口连续无洞；`animFrames.ts:267-270` 的 `overflow` 归一化实读（本 fixture 上 `origin = 253 - 255 = -2`，于是首窗左余 2px、末窗右余 10px） |
| 12 | 帧的几何可断言：cell 512 上每帧恰 512×512、四角 alpha 全 0、最窄左边距 **131**（构造下界 `cell/16=32`）；**131 只属于 512 这一臂** | ✓ VERIFIED | 实跑八帧 `512×512×4 = 1048576 B` 逐帧、四角全 0、`partial 0`、`opaque ∈ [31570,35823]`；左边界 `[135,140,131,135,134,133,149,135]` → min **131**。cell 256 臂独立的下界是 `frameMarginFloor(256)=16`，实测 min 恰 16 |
| 13 | 冒烟跑在**真图**上：`tests/fixtures/anim/chaser_idle_f1_8dir.png`（2048×246，已交付、已跟踪） | ✓ VERIFIED | `sharp` 实测 `2048×246, 3ch, uchar`；`git ls-files` 确认该文件**已跟踪** |
| 14 | 断言的是**真实 PNG 字节**，不是读 `meta` 的自述（POST-03） | ✓ VERIFIED | 测试用 `sharp(...).ensureAlpha().raw()` 逐像素数 `bytes/corners/partial/opaque`（`bridge.smoke.test.mjs:186-210`）。我自己也独立解字节重算了一遍，与 `meta` 一致 |
| 15 | 五个作业共用一个浏览器（一个子进程 + 一次 Chromium 启动） | ✓ VERIFIED | 实读 `bridgeBatch(jobs)` 一次调用、一组 5 作业（`bridge.smoke.test.mjs:212-222`）；单文件顶部 `test` 内六个 `await t.test` |
| 16 | 锚在实测数字上，不是"看起来对"（`fitted` 七个 + `cutLines` 七组 + `field` 三项 + `windows` + `counters` 十一项 + 帧几何） | ✓ VERIFIED | 我重跑得到：`spacing 255 / phase 253 / trials 10496 / medianMass 167 / residual 246 / residualPct 0.07943581 / gutterOk false`；`cutLines.x [508,763,1018,1273,1528,1783,2038]`、`.mass [0,0,0,0,246,0,0]`；`field {rgb[253,5,250], #FD05FA, cast 245, preset binary}`；帧 0 `243×204@135,154`、帧 7 `242×246@135,133` |
| 17 | **失败臂证明闸门能失败**：`castThreshold 256` 时 `ok:false`、`data.length:0`，且第一级会假绿这件事本身被写成断言 | ✓ VERIFIED | 实跑同一臂（见 #4）。`bridge.smoke.test.mjs:327-341` 把 `keyed` 全 246 / `after` 全 0 写成两条 `deepEqual`——后人删掉第二级，这条臂会以"闸门本该失败却通过了"红 |
| 18 | **D-27 的源码与行为双查**：源码两个禁用名各 0 次（case 体带反空转守卫）；行为八帧下边距至少 3 个不同值 | ✓ VERIFIED | 见 #2。行为实测 **7** 个不同值（计划写"实测 7 个，133..156"，我测得 `[133,143,145,148,152,154,155]`，区间一致） |
| 19 | cell 256 臂证明 87.5% 真的咬住：`scaled:7`、帧 0 `224×188@16,34`（`scale=224/243`）、帧 7 `220×224@18,16`、每帧最大边 ≤ 224、最小留边 ≥ 16 | ✓ VERIFIED | 实跑逐字一致：`scaled:7`；帧 0 `224x188@16,34 scale 0.9218106995884774`；帧 7 `220x224@18,16 scale 0.9105691056910569`；`max(out.w,out.h) ≤ 224` 全成立；`min(margins) = 16` |
| 20 | `default` 对照臂让 `binary` 的"零半透明"不是空话：同链同图 `default` 产 **2595** 个半透明像素（>1000 才断） | ✓ VERIFIED | 实跑 `2595`（逐帧求和，非估算）；`isolated: 0`（对照臂不需抢救 → 反证成功臂的 `isolated:1` 不是背景噪声） |
| 21 | 原图臂有文件时跑、没有时**跳过而不是假过**（`{skip}`）；跑法沿用 `npm run test:cli`，不新增命令/依赖/请求 | ✓ VERIFIED | 我**把 raw 临时移走实跑一次**：`ℹ pass 16 / fail 0 / skipped 1`，该子测报 `﹣ … # raw strip is gitignored (.ie/probe)`。`package.json:40` 的 `test:cli` 未改；`package.json`/`package-lock.json` 相对 Phase 2 起 `git diff --stat` **为空**（零新依赖） |

**Score:** 21/21 truths verified（0 present-only，0 behavior-unverified）

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/lib/animFrames.ts` | 一张 strip → N 帧的唯一实现 | ✓ EXISTS + SUBSTANTIVE | **438 行**（`git show --numstat 57881b1` 逐字：`438 0`）。`planStripFrames` 导出、`FRAME_FILL=0.875`、`fitBox`、`frameMarginFloor` 俱在；`0.875` 常量**恰 1 次**声明；无 stub、无 TODO |
| `app/lib/chromaPresets.ts` | 新增 `binary` 档 | ✓ EXISTS + SUBSTANTIVE | +12 行，`binary` 在表内且带 8 行解释性 docblock；既有四档数值**未变**（`default 80/30`、`tile 40/35`、`prop 70/30`、`despill 256/0`——D-23 的 costly-reversibility 守住） |
| `app/lib/__tests__/chromaPresets.test.ts` | 表变 5 档 + "软边为 0"的**语义**断言 | ✓ EXISTS + SUBSTANTIVE | +14/-1（`git numstat` 13/1 + 1 行上下文）。5 行快照 + 第二个 `it` 断言 `binary.castSoftness===0` 且另三档皆非 0——把"数值"和"含义"分开钉 |
| `cli/commands/prim.mjs` | `ie chroma` 枚举收进 `binary` | ✓ EXISTS + WIRED | `:14` usage 串、`:20` `enumFlag(..., ['default','tile','prop','despill','binary'], ...)` 两处同改 |
| `docs/agent-api.md` | 文档表同步 | ✓ EXISTS + WIRED | `:246` 的 usage 行含 `binary` |
| `cli/native/bridge.mjs` | `case 'strip-frames'` | ✓ EXISTS + WIRED | +12 行；`:253-264` 调 `IE.planStripFrames`，失败时 `meta` 照回（`out.meta = r.meta; if (!r.meta.ok) break`）——CLI 才能报出为什么 |
| `cli/native/bundle.mjs` | `BROWSER_IMPORTS` 收进 `animStrip` + `animFrames` | ✓ EXISTS + WIRED | `:18` 两个模块都在列；实跑 `browserBundle({force:true})` 产物 **173218 字符**（173258 字节，UTF-8 多字节）含 `planStripFrames`/`frameMarginFloor`/`fitBox`/`0.875`；两次 force 重建 sha256 **逐字节相同**（确定性） |
| `cli/native/__tests__/bridge.smoke.test.mjs` | 真 fixture 上的端到端冒烟 | ✓ EXISTS + SUBSTANTIVE | +304/-1 → 471 行；新增顶 `test('strip-frames …')` 六子测；既有那个 `test` 未被改动（`git show f42a85f` 只有模块头一处 import 行被替换） |

**Artifacts:** 8/8 verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `bridge.mjs` | `animFrames.ts` | `IE.planStripFrames(IN[0], {...opts, dirs})` | ✓ WIRED | `:259`；实跑经此路径产出 8 帧 |
| `animFrames.ts` | `animStrip.ts` | `sampleFieldRgb` → `columnProfile` → `fitPanelGrid` | ✓ WIRED | `:252-261`；实跑 `field #FD05FA`（取样值，非常量）与 `255/253`（搜索值，非 `W/N`）为证 |
| `animFrames.ts` | `imageProcessor.ts` | `chromaKeyToAlpha` / `removeFrameBorder` / `isolatePrimarySpriteComponent` | ✓ WIRED | `:28,289,302,311`；三步各有 try/catch 与计数器；基线对齐与插值缩放不在此列 |
| `animFrames.ts` | `chromaPresets.ts` | `resolvePreset(opts.preset \|\| 'binary')` | ✓ WIRED（本 phase 的重点修复） | `:236` **确实调用**了（此前 1 处 `resolvePreset(` 调用点，函数名行不计）。我实跑 `preset:'nope'`：`runJobs` **reject**，消息 `unknown chroma preset: nope`；CLI 层 `{"ok":false,"error":"…unknown chroma preset: nope…"}` 且 `exit 1` |
| `animFrames.ts` | `chromaPresets.ts`（类型面） | `CHROMA_PRESETS` 是 `as const`，裸下标 `TS7053` | ✓ WIRED | `:152` 用 `as Record<string, ChromaPreset \| undefined>` 守卫式索引 + `throw`；闸门另有正则钉住这个形状，防它退化成 `?? CHROMA_PRESETS.default` 的空值回退 |
| `bundle.mjs` | 浏览器 IIFE | `page.evaluate` 只序列化函数源码 | ✓ WIRED | 实跑 bundle 含全部四个 pin；`animFrames` 不在 `BROWSER_IMPORTS` 时页面里根本看不见——这条是 `page.evaluate` 的硬约束，不是风格问题 |

**Wiring:** 6/6 connections verified

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 03-01 闸门 1（preset/CLI/docs 接线） | `bash /tmp/verify-p3-01-gate1.sh` | exit **0**，`binary preset: row + pin + semantics + CLI enum + usage + docs all wired` | ✓ |
| 03-01 闸门 2（五臂 + 源码双查 + bundle） | `bash /tmp/verify-p3-01-gate2.sh` | exit **0**，三段输出逐字（含 `strip-frames case: … 722 chars`、`browser bundle 173218 bytes …`） | ✓ |
| 03-02 闸门（`npm run test:cli` + 日志正则 + 文件断言） | `bash /tmp/verify-p3-02-gate1.sh` | exit **0**，`ℹ pass 17 / fail 0 / cancelled 0 / skipped 0` | ✓ |
| 类型检查 | `npx tsc --noEmit -p tsconfig.json` | exit **0** | ✓ |
| 全量单测 | `npm test` | **36 文件 / 375 测试全绿**（`Test Files 36 passed`、`Tests 375 passed`） | ✓ |
| CLI 冒烟 | `npm run test:cli` | `ℹ tests 17 / suites 0 / pass 17 / fail 0 / cancelled 0 / skipped 0` | ✓ |
| skip 臂（移走 raw 后） | `mv .ie/probe/… /tmp && npm run test:cli`（已还原，sha256 复核一致） | `ℹ pass 16 / skipped 1`，报 `﹣ … # raw strip is gitignored (.ie/probe)` | ✓ |
| 闸门 skip 正则的**负向对照** | 对上面的 skip 日志跑 `! grep -qE '(skipped\|cancelled) [1-9]'` | **RED**（`skipped 1` 命中）——该闸门不是空转 | ✓ |
| 插值陷阱的**负向对照** | 把 `imageSmoothingEnabled` 的 setter 吞掉（getter 恒 `true`），同 op 同图重跑 | cell 512 臂 `scaled:0`、八帧半透明仍 **0**；cell 256 臂 `scaled:7`、八帧 **7414**（逐帧 `[1177,1116,1198,844,1147,1039,0,893]`）——与 03-02-SUMMARY 报的 7414 **逐字节相同** | ✓ |
| 双级闸门的**负向对照** | 失败臂实跑（`castThreshold 256`） | `ok:false`、零帧、`fieldSurvived:8`——第一级确会被骗，第二级确抓住 | ✓ |
| bundle 确定性 | `browserBundle()` / `{force:true}` ×2，sha256 比对 | 三次 `173258` 字节、`f5e500b6c616ea19…` 相同 | ✓ |
| 闸门临时文件 | 三闸门跑完后：仓库根无 `.p*-gate-entry.ts`、`/tmp/p3-{binary.png,chroma.log,strip.log,suite.log,smoke.log}` 全不存在 | 全清 | ✓ |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| POST-01 | 03-01 | 链路 = panel-fit → chroma（实测场色、二值）→ removeFrameBorder → isolate → 套 cell 居中；**不含基线对齐** | ✓ SATISFIED | 见 Truth #1/#2；五步实读 + 源码/行为双查 |
| POST-02 | 03-01 | 每个 best-effort 步返回计数器 | ✓ SATISFIED | 见 Truth #9（11 项，键名与 `StripRecord.steps` 同形） |
| POST-03 | 03-02 | 每帧断言角点透明、内容 bbox 留边 ≥ 阈值 | ✓ SATISFIED | 见 Truth #12/#14；对**解出的 RGBA** 断言，非读 `meta` |
| POST-05 | 03-02 | `node --test` 用已交付 `chaser` strip 对真实 PNG 字节跑通冒烟 | ✓ SATISFIED | `npm run test:cli` → `pass 17`，无新命令、无新依赖（`package.json` 未改） |
| GEOM-02 | 03-01 | 每条切线断言落在接近空白的 gutter 列；失败即 `ok:false` 且保留 raw | ✓ SATISFIED | 见 Truth #4/#7/#8；两级闸门 + 失败时零帧且 raw 原样（bridge 不写盘） |

**Coverage:** 5/5 requirements satisfied

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | 无 TODO / FIXME / 占位返回 / no-op 兜底 | — | 无 |

**Anti-patterns:** 0 found（0 blocker, 0 warning）

## Human Verification Required

None — 全部可程序化验证项已跑过。唯一"人更适合看"的是第 12 条那层视觉判断（八帧真的像 chaser 的八个朝向），但它不在本 phase 的 must_haves 里，属 Phase 7 端到端验收。

## Gaps Summary

**No gaps found.** 21/21 truths、8/8 artifacts、6/6 key links、5/5 requirements verified。

判据诚实性复核（任务书第 7 条）——执行者报告里的**行为数字**逐条与我的实测相符；发现 1 处记账滑手与 2 处量法口径差异，**均不构成缺陷**（下面第 1、2、4 点），第 3 点是闸门措辞问题：

### 不构成缺口但值得记录的 4 点

1. **原图那 58 px：量法不同，结论相同。** 03-01/03-02 SUMMARY 与两份计划都写"x=2180，58 px"。我独立核算：该列 cast<128（即二值抠底后 alpha 存活）的像素 **57**；闸门报 `keyed:58`。差额 1 来自边界取样——`removeFrameBorder` 只对**窗口内**的列计数，而该窗口 `[1820,2180)` 是**半开**的，`keyedLast` 采的是窗口最后一列而非 x=2180 本身（x=2179 那列恰为 58）。**58（闸门值）与 57（我按列号直取）都对，指的是两个相邻的像素列。** 两处都记下来，免得后人拿 57 去改测试。

2. **Truth #6 的"最大 99"比我的独立口径更严，方向是安全侧。** 计划写生物自身洋红度"最大 99（6px 腐蚀后 p99.9 ≤ 11）"；我按"cast<128 且 6px 腐蚀"这一独立口径重算得 **max 15 / p99.9 10**（未腐蚀 max 127）。差异来自腐蚀与阈值口径不同。**结论不变**：128 在两个口径下都稳稳高于生物像素、低于水洗的 153..174。我没有改计划的措辞（那会动 covered_digest 且不是缺陷）。

3. **`03-01-SUMMARY` 的"browser bundle 173218 bytes"是字符数，文件是 173258 字节。** 该数字**逐字取自闸门输出**（闸门打印 `browser bundle ${s.length} bytes`，`s` 是 `readFileSync` 未指定编码时的**字符串**），所以这不是执行者编的，是闸门措辞把 char 叫成了 byte。UTF-8 下 40 个多字节字符解释了差额。非缺陷，但值得在 Phase 4 顺手把措辞改准。

4. **`03-01-SUMMARY.md` 有一处 +1 的记账错误（非阻断，不影响任何 must-have）。** 它的"交付物"表把 `app/lib/__tests__/chromaPresets.test.ts` 记作 **+14/-1**；实际 `git show --numstat 57881b1` 是 **13/1**，我逐行数过那处 diff：`it` 标题 1 + `binary` 行 1 + 空行 1 + 注释 4 + 新 `it` 1 + `expect` 4 + `}` 1 = **13 增**，文件行数 26 → 38 净 +12，也要求 13-1。**+14/-1 会给出净 +13，与行数不符。** 同表的另外六行（`animFrames.ts` 438 行、`bridge.mjs` +12、`bundle.mjs` +1/-1、`prim.mjs` +2/-2、`agent-api.md` +1/-1、`chromaPresets.ts` +12）**全部与 `git numstat` 逐字相符**；`03-02-SUMMARY` 的 +304/-1 也相符。所以这是一处孤立的记账滑手，不是系统性高报。

**除此之外，执行者报告里我**没有**找到任何未兑现的声称。** 我逐条比对了 `03-01-SUMMARY` 的"闸门结果 / 实测确认 / 偏离与说明"与 `03-02-SUMMARY` 的"逐臂断言"：

- `animFrames.ts` 438 行 ✓（`git numstat`）；`bridge.smoke.test.mjs` +304/-1 ✓
- `animFrames.ts` = `41d112b1523c4f39a84e0f8d98a2e02e37cd32b24b39febe074edd666ac6fadd` ✓ **与 03-02-SUMMARY 里"还原后复核"的 `41d112b1…` 前 8 位一致**
- 失败臂 `fieldSurvived:8 / keyed 全 246 / after 全 0` ✓；对照臂 `2595 / isolated:0` ✓；几何臂 `scaled:7 / 224×188@16,34 / 220×224@18,16` ✓；原图臂 `360/20/21594/239/352/#FC06FA/[2180]/883` ✓
- "删掉第二级闸门 → `pass 15 / fail 2`"、"居中改钉地面 → `pass 14 / fail 3`"：**这是执行期的一次性变异实验，我无法从当前树重放**（要改产品码），故标为 `[INFERENCE]`。但我**独立做了插值陷阱的同类变异**（见 Behavioral Spot-Checks 第 9 行）得到与它一致的 7414，说明这类实验确实做过且数字留得住。

### 我**没有**验证的（明确列出，不假装）

1. **真实付费调用下的 strip 从未经本 op 跑过**（本 phase 零出网）。八帧是"看起来对"吗——我只证明了它们**几何正确**（尺寸、角点、留边、零半透明），没有证明它们**看起来像 chaser 的八个朝向**。
2. **Phase 4/6 的消费者不存在**，`bridge op` 之外的另一半（`set.json.steps` 落盘、UI 调同名链）在后续 phase 才可审。POST-04 归 Phase 6。
3. **原图臂在干净 clone 上会 skip**（见 `coincidental_reliance_items`）；本机有该 gitignored raw 才跑得起来。
4. **未做依赖/供应链审计**：本 phase 零新依赖（`package.json`/`package-lock.json` 相对 Phase 2 起未变，由 `git diff --stat` 证明），既有 sharp/Next/Playwright 版本的 CVE 未查。

---

## Verification Metadata

**Verification approach:** Goal-backward（从 `ROADMAP.md` §Phase 3 的 goal 与两份 PLAN frontmatter 的 must_haves 反推）
**Must-haves source:** `03-01-PLAN.md` frontmatter（11）+ `03-02-PLAN.md` frontmatter（10）
**Automated checks:** 12 组，0 失败（三闸门 + tsc + 两套件 + 六条现场测量 + 三条负向对照）
**Human checks required:** 0
**Git:** `57881b1`（03-01，8 文件 +522/-5）、`f42a85f`（03-02，2 文件 +351/-1）、`a859cf7`（状态翻牌，3 个 .md）——三笔都在；`git status --porcelain` 只有 `?? .omp/` 与 `?? .planning/state.json`（harness 自写，预期内）
**Total verification time:** 约 25 分钟

---
*Verified: 2026-10-07T08:30:09Z*
*Verifier: generic agent（替身 GSD 的 `gsd-verifier`；执行者为 orchestrator 指挥下的通用代理，计划由独立 planner 撰写。我未参与实现，以上每条均为亲自重跑）*
