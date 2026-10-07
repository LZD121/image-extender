---
phase: 02-pure-core
verified: 2026-10-07T03:57:34Z
status: passed
score: 16/16 truths verified
covered_files:
  - .planning/phases/02-pure-core/02-01-PLAN.md
  - .planning/phases/02-pure-core/02-01-SUMMARY.md
  - .planning/phases/02-pure-core/02-02-PLAN.md
  - .planning/phases/02-pure-core/02-02-SUMMARY.md
  - .planning/phases/02-pure-core/02-CONTEXT.md
  - app/api/generate/route.ts
  - app/lib/__tests__/animSet.test.ts
  - app/lib/__tests__/animStrip.test.ts
  - app/lib/animSet.ts
  - app/lib/animStrip.ts
  - app/lib/aspectRatio.ts
covered_digest: v1:sha256:5d47ce5786212a4902e00b3fdbf115a8e59c43f2ef93ee3e5048b89a5cc167c7
behavior_unverified: 0
behavior_unverified_items:
coincidental_reliance_items:
  - truth: "拟合搜索在 2928 宽的原图上给出 360/20、21594 trials，与 Phase 1 记录一致"
    reason: fixture-only
    harden: "该断言挂在 `it.runIf(existsSync('.ie/probe/chaser_idle_f1_8dir.png'))` 上，而 `.ie/` 被 gitignore——干净 clone 上这条会**静默跳过**而不是红。要让它在任何机器上都成立，要么把该 raw 的**剖面**（`Int32Array`，约 11 KB）作为 fixture 入库并由剖面断言拟合值，要么让 Phase 1 的 raw 走一个可检索的 artifact store。"
---

# Phase 2: 纯核心（animStrip + animSet）Verification Report

**Phase Goal:** 把所有决策写成无依赖的纯 TypeScript：规格校验（含每状态帧数一致）、`planStrips()`、`stripSize()`、`buildStripPrompt()`、`buildSetJson()`、`nextPending()`、以及面板网格拟合代数。
**Requirements:** GEOM-01、GEOM-03、GEN-07、GEN-08
**Verified:** 2026-10-07T03:57:34Z
**Status:** passed

> **本报告的独立性声明。** 我不是 `gsd-verifier`——这个 harness 无法 spawn 具名 `gsd-*` 角色，所以本轮验证由一个 **generic agent** 顶替完成，没有 GSD audit log。关键事实：**本 phase 的执行者是 orchestrator 本人**（两份 SUMMARY 自述 "inline（本 harness 无法 spawn 具名 gsd-* executor）"），计划由独立 planner agent 撰写、独立 checker 两轮评审。也就是说，被验证的实现与我之间**没有**作者关系——但我与 orchestrator 同属一个 harness，这一层无法像标准 GSD 那样由角色机制保证，只能靠"每一条都自己重跑"来补偿。下面每一条都标注是**实跑**还是**读文件**。
>
> **本轮不采信 SUMMARY。** 两份 SUMMARY 声称的数字（27→28 条、361 passed、`field: 'states'` 已改）我都当**待证命题**处理，全部从磁盘重跑得到。下面第 10/11/12 条的差异与 SUMMARY 措辞有关，已单列。
>
> **模板枚举与本轮 status 取值。** 模板的 `status:` 枚举是 `passed | gaps_found | human_needed`；本轮任务书要求 `passed | failed`，故取 `passed`（按模板语义即全部 must-have 已核实、无阻断缺口）。`behavior_unverified: 0`、`coincidental_reliance_items` 1 条（见 frontmatter，属咨询性，不改变 status 与分数）。

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **PLAN-01 T1** `fitPanelGrid` 是**搜索**，不是常量：同一份代码在 2928 宽上给出 360/20（21594 trials）、在 2048 宽上给出 255/253（10496 trials） | ✓ VERIFIED (coincidental-reliance) | **实跑两遍**（esbuild 打成 `--platform=node` 的 bundle，sharp 解码真实字节，不经任何测试文件）：原图 `.ie/probe/chaser_idle_f1_8dir.png`（1480226 B）→ `size 2928x352`、`field [252,6,250]`、`spacing 360`、`phase 20`、`trials 21594`、`medianMass 239`、`residual 352`、`gutterOk false`。fixture `tests/fixtures/anim/chaser_idle_f1_8dir.png` → `2048x246`、`field [253,5,250]`、`spacing 255`、`phase 253`、`trials 10496`、`medianMass 167`、`residual 246`、`gutterOk false`。**两组数字逐字段与 `01-PROBE-RECORD.md` / `evidence/measured-*.json` 一致，且两个答案不同**——这正是"搜索而非常量"的凭据。另外我实跑参数化：`spanPct 0.08 → trials 224`、`0.2 → 416`。**advisory**：原图那条断言在测试里被 `it.runIf(existsSync(RAW))` 保护，干净 clone 上会跳过——见 `coincidental_reliance_items`。 |
| 2 | **PLAN-01 T2** Phase 1 的实测数字（2928/2048/21594/10496/360/253…）在源码里**一个都不出现**，只作为测试断言值 | ✓ VERIFIED | **实跑**独立脚本（剥掉块注释**与行注释**后按 `\b<num>\b` 搜）：`code-only leak: none`。这些数字只出现在 `animStrip.ts:18-19` 的 docblock 里，且该 docblock 的措辞是"Both are *outputs of the search*, never…"。plan 自带的闸门 2 用**只剥块注释**的更弱剥离，我用了更强的剥离仍无泄漏，故该结论不依赖闸门的实现细节。 |
| 3 | **PLAN-01 T3** `columnProfile` 收**已解码的 RGBA 缓冲**（不是 canvas、不是路径），`columnProfile`/`fitPanelGrid` 都是纯函数 | ✓ VERIFIED | 读文件 + 实跑：签名 `columnProfile(buf: PixelBuffer, width, height, fieldRgb, distance = 60): Int32Array`（`animStrip.ts:137`），`PixelBuffer = Uint8Array \| Uint8ClampedArray`（:80）。我在 scratch 里直接喂 `Uint8Array` 与 `Int32Array` 剖面调用两者，无 fs/网络参与；缓冲长度不符抛错（闸门 2 的 `short buffer` 分支实跑通过）。 |
| 4 | **PLAN-01 T4** 阈值全部是参数：`FIT_SPAN_PCT === 0.08`、`GUTTER_RATIO === 0.02`，传自定义值时行为随之变化 | ✓ VERIFIED | **实跑**：`FIT_SPAN_PCT 0.08`/`GUTTER_RATIO 0.02` 由 plan 闸门 2 首行断言（exit 0），我在 scratch 里另跑 `spanPct: 0.2` 得 `trials 416 ≠ 224`，`gutterRatio: -1` 与 `spanPct: 1` 均抛错。 |
| 5 | **PLAN-01 T5** `DIRS8` 顺序 = 运行时 sector 序，`DIRS4` = down/side/up/back；`directionForCell`/`cellForDirection` 给出映射 | ✓ VERIFIED | **实跑** plan 闸门 1（exit 0）：`DIRS8.join(',') === "east,south-east,south,south-west,west,north-west,north,north-east"`、`DIRS4 === "down,side,up,back"`、`DIRS_PRESETS === "dirs8,dirs4"`、`directionForCell(DIRS8,0)==='east'`、`(DIRS8,7)==='north-east'`、`cellForDirection(DIRS8,'west')===4`、`cellForDirection(DIRS8,'down')===-1`（4 向表不是 8 向表的子集）、`cell=-1/8/1.5` 三条各自抛。repo 内 `DIRS8 = [` **只命中 `app/lib/animStrip.ts` 一个文件**。 |
| 6 | **PLAN-01 T6/GEN-08** `buildStripPrompt()` 逐格枚举由 `dirs` 数组生成；约束句是常量 | ✓ VERIFIED | **实跑** plan 闸门 3（exit 0，`sha 9d966280…cfe8a6`）：8 向 prompt 含 8 句 `cell i facing <dir>` 逐句断言；4 向 prompt 含 `1-row x 4-column` **且不含** `cell 5 facing` / `x 8-column`（枚举不继承）。约束串逐条命中：`COMPLETELY INSIDE its own cell`、`NOT a scene`、`no card, no plaque, no frame, no panel`、`no text, no grid lines, no cell borders, no labels`、`#FF00FF`。`STYLE-SENTINEL` 证明风格文本内联。frame 越界与空 dirs 各抛。 |
| 7 | **PLAN-01 T7** prompt 模板与 Phase 1 真花过钱的那段**逐字节相同**（sha256 `9d966280…cfe8a6`） | ✓ VERIFIED | **实跑** plan 闸门 3：用记录里的 subject/motion/dirs 重建 prompt，`createHash('sha256')` 等于 `9d966280493b9530e2271a1775463ea0513d2e50fdedc97d3fcadf92ffcfe8a6`。测试侧也**实跑**通过（`still holds the prompt the paid call actually sent`，`expect(createHash('sha256').update(prompt,'utf8').digest('hex')).toBe(PROBE_PROMPT_SHA)`；且 `expect(block.prompt_sha256).toBe(PROBE_PROMPT_SHA)` 把记录值与重算值一起钉住）。 |
| 8 | **PLAN-01 T8 / D-21** 两个模块不 import `node:*`/`next/*`/`react` | ✓ VERIFIED | **实跑三重**：(a) `grep -c '^import' app/lib/animStrip.ts` = **0**；`animSet.ts` = **1**，唯一那条来自 `@/app/lib/animStrip`。(b) `grep -nE "from '(node:\|next\|react)"` 两个文件 **0 命中**。(c) 自建入口 `export * from` 两者后 `npx esbuild --platform=browser` → 16218 B 产物，`grep -nE "require\(\|node:"` **0 命中**。plan 闸门 1/2/3 与 02-02 闸门 1/3 各自也内嵌了同一检查并 exit 0。 |
| 9 | **PLAN-01 T9** 两个 `gutter_ok` 都是 false：原图 1/8 条切线被占满（x=2180，352 px），fixture 同型（x=1528，246 px） | ✓ VERIFIED | **实跑**原图拟合：`cutLines` 中 7 条 `mass 0`、第 6 条 `1820:352` 为满；`residual 352`、`gutterOk false`。**实跑** fixture：`cutLines.filter(c => c.mass === 246)` 恰 1 条（x=1528），`gutterOk false`。测试对两者都有断言且实跑通过。拟合没有把"差不多"写成通过。 |
| 10 | **PLAN-02 T1 / GEN-07** 非法规格在**任何调用之前**被拒，每条断言 `err.field` | ✓ VERIFIED | **实跑** 02-02 闸门 1（exit 0）：15 条硬错逐条 `err instanceof AnimSpecError` 且 `err.field` 精确匹配——`frames differ→states`、`unknown dirs→dirs`、`free dirs array→dirs`、`cell x dirs > 4096→cell`、`cell below range→cell`、`cell above range→cell`、`empty states→states`、`duplicate state names→states`、`illegal actor→actor`、`illegal state name→states`、`frames 0→frames`、`fps 0→fps`、`missing subject→subject`、`bad background→background`、`states not an array→states`。另**实跑**我自己的 scratch：`{frames:6}, {frames:8}` → 抛且 `field='states'`；`cell*8 > 4096` → `'cell'`；`dirs:'dirs16'` → `'dirs'`；`states: []` → `'states'`。全部在纯函数内发生，不触碰 fs/网络。 |
| 11 | **PLAN-02 T2 / D-17** 未知字段**不是**硬错，而是 warning，且不泄进返回的 `spec` | ✓ VERIFIED | **实跑** 02-02 闸门 1：`warnings.join('\|')` 精确等于 `unknown field ignored: futureKnob\|unknown field ignored: states[0].anchor`（顶层与状态路径各一条、前缀正确）；`'futureKnob' in warn.spec === false`。我另跑注入 `{futureKnob:1, isAdmin:true}` → 两条 warning、返回对象 `Object.keys` **恰为九个白名单字段**，无 mass assignment。 |
| 12 | **PLAN-02 T3 / D-15** 1-based ↔ 0-based 转换**只在一处**，两个边界值都有测试 | ✓ VERIFIED | **实跑** 02-02 闸门 2（exit 0）：`` `f${ `` 插值在 `animSet.ts` 计数 **恰 1**、在 `animStrip.ts` 计数 **0**（这两条是 plan 的硬计数断言，不是"大约"）；`frameNumber(0)==='f1'`、`frameNumber(3)==='f4'`、`frameIndex('f1')===0`、`frameIndex('f4')===3`、round trip `frameIndex(frameNumber(11))===11` 且 `frameNumber(frameIndex('f9'))==='f9'`；八个非法标签 `f0/f01/F1/f/f1x/''/f-1/1` 全部抛。我**独立重跑**：`frameNumber(0)==='f1'`、`frameNumber(11)==='f12'`、`frameIndex('f1')===0`、`frameIndex('f12')===11`。**单一之家复核**：`function frameNumber` 全 repo 只命中 `app/lib/animSet.ts`。 |
| 13 | **PLAN-02 T4** `planStrips` 数量 = `Σ states.frames`，每条 `{state, frame, index, prompt, width, height, file}` | ✓ VERIFIED | **实跑** 02-02 闸门 2：2 状态 × 4 帧 → `plan.length === 8`、`index` 恰为 `0..7`、顺序 `idle:0..3,walk:0..3`、`plan[0].file === 'raw/idle_f1_8dir.png'`、`plan[7].file === 'raw/walk_f4_8dir.png'`、`planSize(dirs8/512) === {4096,512,aspect 8}`、`planSize(dirs4/512) === {2048,512,aspect 4}`（4 格 × 512 = 2048 而非 4096）、4 向 prompt 里 **`/cell 5 facing/` 无命中**。另**实跑**我自己的 scratch：单状态 6 帧 → `plan.length === 6`。 |
| 14 | **PLAN-02 T5 / GEOM-03** `durationsMs = round(1000/fps)`；`set.json` 含 `dirs.preset`+`dirs.order`、`requested`/`returned`、`fitted`、逐格 `frames[]`、`backend`、`totals` | ✓ VERIFIED | **实跑** `animSet.test.ts`（36 passed 含此 describe）：`durationsMs(4,4) → [250,250,250,250]`、`(8,4) → [125×4]`、`(3,2) → [333,333]`、`(7,1) → [143]`，`fps 0`/`frames 0` 各自抛。`set.dirs === {preset:'dirs8', order:[...DIRS8]}`、`set.cell === 512`、`set.states` 逐条含 `durationsMs`、`set.backend === {provider:'magpie', model:'teamo-router/gemini-3.1-flash-image'}`、`set.frames` 长度 16（2 strip × 8 cell）且 `frames[0]`/`frames[7]` 的 `file`/`strip` 双文件名逐字段断言、`totals === {calls:1, cells:8, seconds:21.4}`（**只数 ok 的 strip**，记录里那条 `ok:false` 被排除——这是"totals 诚实"的证据，不是"条数"的证据）。读文件复核 `buildSetJson` 原样透传 `strip.requested`/`strip.returned`，**不做相等断言**（与 D-19 一致）。 |
| 15 | **PLAN-02 T6 / D-16** 完成判定来自**记录 + 运行器事实**，五种 reason，重复键进 `duplicates` | ✓ VERIFIED | **实跑**计划闸门 3（36 passed，含 `set.json + resume` 段）+ **我自己的 scratch**（独立于测试文件）五条：(c) `ok:true` + `rawDecodable:false` → `'raw-unreadable'`（且精确指向 `idle:0`，`done 1/2`）——**方向与计划一致**；(d) facts 里缺该键 → 仍待办 `'raw-unreadable'`（**沉默不等于成功**）；(e) `derivedCount 7 < 8` → `'derived-short'`；(f) 记录里重复 `(state,frame)` → `duplicates === ["idle:0"]` 且 `done` **不**被重复条目虚增（`2/2` 而非 `3`）；(g) 命名边界。测试侧另覆盖 `missing`、`not-ok`、`redo`。五种 reason 全在本轮的实跑输出里出现过。 |
| 16 | **PLAN-02 T7 / D-21** `animSet.ts` 唯一的 import 是 `@/app/lib/animStrip` | ✓ VERIFIED | **实跑** 02-02 闸门 1 的收尾段：`test "$(grep -c '^import' app/lib/animSet.ts)" = "1"`、`grep -q "from '@/app/lib/animStrip'"`、`! grep -qE "from '(node:\|next\|react)"`——三条全过（exit 0）。测试侧 `is pure: one internal import, nothing from a runtime` 实跑通过。第 8 条的浏览器 bundle 也覆盖了它。 |

**Score:** 16/16 truths verified（0 present-behavior-unverified，1 条 coincidental-reliance 见 frontmatter）

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/lib/animStrip.ts`（300 行） | DIRS8/DIRS4、`stripSize`、`sampleFieldRgb`/`fieldDistance`/`magentaCast`/`columnProfile`/`fitPanelGrid`、`stripPrompt` 代数 | ✓ EXISTS + SUBSTANTIVE | **实跑** `wc -l` = 300。导出符号清单实读：`DIRS8`/`DIRS4`/`DIRS_PRESETS`/`isDirsPreset`/`dirsForPreset`/`directionForCell`/`cellForDirection`/`stripSize`/`PixelBuffer`/`Rgb`/`sampleFieldRgb`/`fieldDistance`/`magentaCast`/`columnProfile`/`CutLine`/`PanelFit`/`FitOptions`/`FIT_SPAN_PCT`/`GUTTER_RATIO`/`fitPanelGrid`/`FIELD_HEX`/`STRIP_CONSTRAINTS`/`StripPromptBody`/`buildStripPrompt`。`TODO/FIXME/placeholder/stub` 扫描 0 命中。 |
| `app/lib/animSet.ts`（476 行） | 校验 + 计划 + `set.json` + 续跑 + 命名进制 | ✓ EXISTS + SUBSTANTIVE | **实跑** `wc -l` = 476。`AnimSpecError`（`readonly field`，手写而非 TS parameter property——理由写在 :75 注释里）；`nextPending`/`stripKey`/`parseStripKey`/`planStrips`/`planSize`/`buildSetJson`/`durationsMs`/`stripFile`/`frameFile`/`frameNumber`/`frameIndex`；`FIELD` 常量 `CELL_MIN 64`/`CELL_MAX 1024`/`MAX_STRIP_WIDTH 4096`。`TODO/FIXME` 0 命中。 |
| `app/lib/__tests__/animStrip.test.ts`（270 行） | GEOM-01 / GEN-08 的断言 | ✓ EXISTS + SUBSTANTIVE | **实跑** `wc -l` = 270；`vitest run --reporter=verbose` → **28 passed**（与 SUMMARY 的 28 一致；plan 里那条 ">20" 的软承诺满足）。含合成剖面四类（均匀/相位偏移/噪声/越窗）、`cells===1` 特例、参数化、命名两边界、prompt 八句枚举 + 四约束 + 4 向不继承、两个真实文件的拟合、零 import 守卫、以及 sha 漂移锚点。无 `.skip`/`.only`/`.todo`。 |
| `app/lib/__tests__/animSet.test.ts`（236 行） | GEN-07 / GEOM-03 的断言 | ✓ EXISTS + SUBSTANTIVE | **实跑** `wc -l` = 236；verbose → **36 passed**。15 条硬错 + warning 路径 + 命名两边界 + 计划 + `set.json` 全形状 + 五种 reason + duplicates + 纯度。无 `.skip`/`.only`/`.todo`。 |
| `.planning/phases/02-pure-core/02-01-PLAN.md` / `02-02-PLAN.md` | 各 3 条可执行 `<automated>` 闸门 | ✓ EXISTS + SUBSTANTIVE | 我**逐字提取**六个块（`re.findall(r"<automated>(.*?)</automated>")` → 23/44/25 与 37/32/46 行）到临时 `.sh` 并 `bash` 执行。**六个全部 exit 0。** |
| `app/lib/aspectRatio.ts` + `app/api/generate/route.ts` | Phase 2 坐其上的 Phase 1 invariant，本 phase 不得触碰 | ✓ EXISTS + UNCHANGED | **实跑** `git log --oneline 6bac853^..HEAD -- app/lib/aspectRatio.ts app/api/generate/route.ts` → 空（phase-2 两个 commit **未碰**）。`tsc --noEmit` 依赖它仍编译（第 2 条）。`package.json`/`package-lock.json` 相对 Phase 1 结束时 `git diff --stat 59d5acd..HEAD` **空**（无新依赖）。 |

**Artifacts:** 6/6 verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `app/lib/animSet.ts` | `app/lib/animStrip.ts` | `import { DIRS_PRESETS, buildStripPrompt, dirsForPreset, isDirsPreset, stripSize } from '@/app/lib/animStrip'` | ✓ WIRED | 实读 :22-30；`grep -c '^import' animSet.ts` = 1。`buildStripPrompt` 在 `planStrips` :255 被真实调用（不是 re-export）。方向顺序与 prompt 文本**只有一处实现**：`grep -rln "DIRS8 = \[" app/ scripts/` → 仅 `animStrip.ts`。 |
| `app/lib/__tests__/animSet.test.ts` | `app/lib/animSet.ts` | 断言真实返回值（抛错的 `field`、warnings 原文、计划的 `file`/`prompt`） | ✓ WIRED | 实跑 verbose：断言的是具体值（`err.field`、`warnings.join('\|')`、`plan[7].file`、`set.totals`），无快照；`vitest run --reporter=json` 无 `snapshot` 相关输出。 |
| `app/lib/__tests__/animStrip.test.ts` | `.planning/phases/01-transport-probe/01-PROBE-RECORD.md` | `readFileSync` + `sha256(prompt_full)` vs `PROBE_PROMPT_SHA` | ✓ WIRED | 实跑通过（`still holds the prompt the paid call actually sent`）；`RECORD` 常量 :249 指向真实存在的文件；json 围栏数 `expect(blocks.length).toBe(1)` 实跑通过。另 `:241-244` 有反空转断言（`source.length > 2000` 且含 `export function fitPanelGrid`）。 |
| `app/lib/__tests__/animStrip.test.ts` | `tests/fixtures/anim/chaser_idle_f1_8dir.png` | `sharp` 解码 → `sampleFieldRgb` → `columnProfile` → `fitPanelGrid` | ✓ WIRED | 实跑 255/253/10496/median 167/gutter false/恰 1 条 246 px 全部命中。该 fixture **已入库**（945309 B，`git ls-files` 命中），不依赖 `.ie/`。 |
| `app/lib/animStrip.ts` | Phase 3 的 `strip-frames` / Phase 4 CLI / Phase 6 UI | 导出面 | ⚠️ NOT WIRED YET（**按设计**） | 这些消费者在 Phase 3/4/6 才存在，本 phase 的 ROADMAP 明写"CLI（Phase 4）与界面（Phase 6）都调它们"。**不记为缺口**：pure 模块的导出面已由本 phase 的测试完整行使，且第 8 条的浏览器 bundle 证明它可被任一运行环境消费。 |

**Wiring:** 4/4 本 phase 内可达的连接 verified

## Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| **GEOM-01**: 面板网格由列质量剖面拟合 `(spacing, phase)`，纯函数、vitest 可测（均匀/相位偏移/噪声三种合成剖面） | ✓ SATISFIED | truth 1 + 3 + 4。三类合成剖面 + 越窗 + 单格在 `animStrip.test.ts` 逐条钉具体数字，实跑 28 passed。 |
| **GEOM-03**: `set.json` 记录实际拟合值（spacing/phase/residual）与 gutter 判定结果 | ✓ SATISFIED | truth 14。`SetJsonStrip.fitted = {spacing, phase, residualPct, gutterOk}`（实读 :289），`buildSetJson` 原样透传 `strip.fitted`（:303/:378 `{...strip}`），测试断言 `set.strips` 形状。 |
| **GEN-07**: 规格非法（帧数不一致 / `cell×dirs>4096` / 未知 dirs 预设 / 空 states）在**任何调用之前**报错 | ✓ SATISFIED | truth 10。四条点名条件各自被实跑确认拒绝于 `validateAnimSetSpec` 内（纯函数，无 I/O 可发生）。 |
| **GEN-08**: prompt 含逐格方向枚举、格内包含、纯洋红场、禁卡片/文字/网格线；风格文本内联 | ✓ SATISFIED | truth 6 + 7。四项约束串逐条实跑命中，8 向/4 向枚举由 `dirs` 生成，`STYLE-SENTINEL` 证明内联，且与 Phase 1 真花钱的那段逐字节相同。 |

**Coverage:** 4/4 requirements satisfied

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/lib/__tests__/animStrip.test.ts` | 167 | `it.runIf(existsSync(RAW))` 保护原图拟合断言 | ℹ️ Info | 该守卫**是刻意的**（注释 :163-165 写明 `.ie/probe/` 被 gitignore，干净 clone 上跳过而非红）。它让一条 must-have 在无 raw 的机器上静默降级——已作为 `coincidental_reliance_items` 记录，非阻断。 |
| `app/lib/animStrip.ts` | 18-19 | docblock 引用 Phase 1 的实测数字 | ℹ️ Info | 与 PLAN-01 的"**绝对不要**把这些数字写进源码或 docblock **当默认值**"一致（措辞为"outputs of the search"）；剥注释后零泄漏（truth 2）。**不是**把答案做成常量。 |
| `app/lib/animSet.ts` | 53,133 | `out` 只校验"非空字符串"，接受 `../../../../tmp/evil` | ⚠️ Warning | `out` 是 Phase 4 runner 的写盘根，本模块不做路径约束（plan 第 4 条只要求非空字符串，spec v2 §5.1 的校验清单亦未列它；且 `out` **不进入** `set.json`——实测 `buildSetJson` 的返回体里没有该字段）。**非本 phase 缺口**，已移交 SECURITY.md §P2-3 给 Phase 4 处理。 |

**Anti-patterns:** 3 found (0 blockers, 1 warning, 2 info)

## Human Verification Required

None — 所有 must-have 均已由我自己重跑的可执行检查覆盖（六个 plan 闸门 + `tsc` + 全量 `npm test` + 浏览器打包纯度 + 真实字节拟合 + 独立 scratch 的续跑/命名/校验探针）。`behavior_unverified: 0`。

（按 `coincidental_reliance_items` 的口径，若在**没有** `.ie/probe/chaser_idle_f1_8dir.png` 的机器上复核，truth 1 的原图那一半会变成"未行使"，其加固方式写在 frontmatter。）

## Gaps Summary

**No gaps found.** Phase 2 goal achieved。16/16 truths verified、4/4 requirements satisfied、0 blockers。

### 独立复核中发现的、**不构成缺口**但值得记录的三点

1. **SUMMARY 的测试数字与实测有偏差（措辞层面）**——`02-01-SUMMARY.md` 写 "27→28 条"：实跑该文件 **28 passed**，且 27 = `grep -c 'it('` 的普通 `it(` 数、+1 条 `it.runIf(existsSync(RAW))`（`animStrip.test.ts:167`）恰好 28，SUMMARY 的写法在算术上成立，只是把 `it.runIf` 那条算成了"另加"的。`02-02-SUMMARY.md` 写 "236 行 / 36 条"，实测 **236 行 / 36 passed** 完全一致（25 个字面 `it(`、其中一处是 `it.each` 表驱动展开成 11 条）。两份 SUMMARY 都写 "npm test 全量绿（361 passed）"，实测 **362 passed / 35 files**——361 是 executor 写下 SUMMARY 时的数，最后的 commit `94001b3` 又给 `animStrip.test.ts` 加了 1 条（sha 锚点）后没回填。**不影响任何 must-have**（全量绿这一事实成立），仅记录数字漂移，避免后续把它当基线。
2. **执行轨迹可见**：`.ie/scratch/phase2-planner/` 里留着 planner 自验的实现（gitignored）。我逐文件 diff 到 shipped：`animStrip.ts` 与 `animSet.test.ts` **逐字节相同**；`animSet.ts` 差 **1 行**（`'frames'` → `'states'`）；`animStrip.test.ts` 差 **25 行**（新增 `node:crypto` import + 整个 sha 漂移锚点 describe 块）。这与两份 SUMMARY 自述的"计划自验留下的一份实现，逐条过闸"一致——**两处偏离正是 SUMMARY 声称被闸门抓到的两处**，且方向正确（缺陷 3/4 见下）。该目录不在跟踪区，无泄漏（密钥扫描 0 命中），不构成缺口。
3. **`git status` 干净**：`--untracked-files=no` 输出为空（零个已跟踪文件的未提交改动）；未跟踪项恰为任务书预期的 `.omp/` 与 `.planning/state.json`。六个闸门的 `trap` 全部生效——运行后仓库根**没有** `.p1-gate-entry.ts` / `.p2-gate-entry.ts`，也无 `.log`/scratch 残留（`ls -a | grep -i gate-entry` → 无）。

### 两个被修的缺陷——方向逐一复核（任务书第 4 条）

- **缺陷 A（`field` 归属）**：`git show 94001b3 -- app/lib/animSet.ts` 的 diff **恰一行** `'frames'` → `'states'`，位置在"`stateFrames !== frames`"那个分支内（:180-185）。**我实跑**：两状态 6/8 帧 → `AnimSpecError`，`field === 'states'`；而**单状态** `frames: 0` → `field === 'frames'`。两者**没有**被合并成同一个值——这正是 plan :105 要求的区分（"出问题的是状态之间的不一致…而单个 `frames` 越界的错才是 `'frames'`"）。
- **缺陷 B（sha 锚点）**：`git show 94001b3 -- app/lib/__tests__/animStrip.test.ts` 新增 `import { createHash } from 'node:crypto'` 与整个 `describe('the probe record this module was built from')` 块；字面量 `9d966280493b9530e2271a1775463ea0513d2e50fdedc97d3fcadf92ffcfe8a6` 落在 `PROBE_PROMPT_SHA`（:252）。**逐行读**该测试：它同时断言 `block.prompt_sha256 === PROBE_PROMPT_SHA` **与** `sha256(block.prompt_full) === PROBE_PROMPT_SHA`。**实跑**该测试通过；`grep -c` 该字面量在测试文件里 **恰 1** 次（02-01 闸门 3 的硬计数断言）。
  - **一处如实记录**：该断言读的是 `01-PROBE-RECORD.md` 的 json 围栏，而**重建**（用 `buildStripPrompt` 重建 prompt 再算 sha）发生在 **plan 闸门 3 的 node 脚本**里，不在测试里。两者都实跑通过且给出同一个 sha，所以结论成立；但"测试自己在钉重建"这句话不准确——测试钉的是**记录未漂移**，重建由闸门钉。这一分工本身合理（重建需要知道记录的 subject/motion 字面量），仅澄清。

### 判据诚实性复核（任务书第 6 条）

`animSet.ts:177-185` 的每状态帧数检查**确实跨状态比较**，不是各状态孤立自查：`frames` 变量在 `map` 回调外声明（:162 `let frames: number | null = null`），首个状态赋值，后续状态与**它**比（`else if (stateFrames !== frames)`），错误信息同时给出两个数（`${name} has ${stateFrames}, earlier states have ${frames}`）。注释 :177-178 明写理由："The consumer addresses frames as `frame = row * FRAMES + col` (a ruled grid); that only holds when every state is the same width." 我另外**实跑**了 3 状态（4/4/8）的排列，报错信息正确指到第三个状态。语义与消费端 `enemy.gd` 的行寻址规则一致。

## Verification Metadata

**Verification approach:** Goal-backward（从 ROADMAP §Phase 2 的 4 条 Success Criteria + 两份 PLAN 的 `must_haves` 反推）
**Must-haves source:** `02-01-PLAN.md` / `02-02-PLAN.md` 的 frontmatter `must_haves`（8 + 7 条 truths，去重后 16 行）
**Automated checks:** 6 个 plan 闸门全过（0 失败）+ `npx tsc --noEmit -p tsconfig.json` exit 0 + `npm test` 362 passed / 35 files + 浏览器打包纯度 + 两份模块级 vitest（28 + 36）+ 我自建的 3 个 scratch 探针
**Digest:** `v1:sha256:5d47ce5786212a4902e00b3fdbf115a8e59c43f2ef93ee3e5048b89a5cc167c7`（由 `gsd-tools query verification.fingerprint` 计算，覆盖 11 个文件）
**Human checks required:** 0
**Total verification time:** ~12 min

---
*Verified: 2026-10-07T03:57:34Z*
*Verifier: generic agent（替身 GSD 的 `gsd-verifier` 角色；执行者为 orchestrator，我未参与实现）*
