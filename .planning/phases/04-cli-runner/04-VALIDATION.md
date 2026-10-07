---
phase: "4"
slug: "cli-runner"
status: validated
nyquist_compliant: false
wave_0_complete: true
created: "2026-10-08"
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Validated 2026-10-08 by the nyquist-validate workflow (inline auditor; `gsd-*`
> subagents unavailable in this harness). Evidence below was **observed**, not
> copied from plan `<verification>` blocks: every arm was mutation-probed in a
> scratch worktree to prove it can go red.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.9 (node environment; already installed) |
| **Config file** | `vitest.config.ts` (includes `cli/**/__tests__/**/*.test.mjs`) |
| **Quick run command** | `npx vitest run cli/commands/__tests__/anim.test.mjs` |
| **Full suite command** | `npm test`（= `npx vitest run`，37 files / 416 tests） |
| **Estimated runtime** | quick ~3 s；full ~3.5 s（实测 2.9 s / 3.3 s） |

Chromium tier (`npm run test:cli`, `node:test`) is **not** used by this phase's
gates: both seams (`ctx.api` / `ctx.bridge`) are replaced in-process, so the
money path is proven with no network, no browser and no spend.

---

## Sampling Rate

- **After every task commit:** `npx vitest run cli/commands/__tests__/anim.test.mjs`
- **After every plan wave:** `npm test`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 秒

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | GEN-03（机制） | T-04-04 | raw/derived/set.json 只经 temp+rename 落盘 | unit | `npx vitest run cli/commands/__tests__/anim.test.mjs`（write path 臂） | ✅ | ✅ green |
| 4-01-02 | 01 | 1 | GEN-01, GEN-02, CLI-01, CLI-02 | T-04-01/02/03 | 预演零调用零写入；`--go` 是唯一花钱开关 | integration | 同上（dry path / --go gate 两组臂） | ✅ | ✅ green |
| 4-01-03 | 01 | 1 | GEN-01, GEN-02 | T-04-01 | 两个 seam 计数器读数 0（假件一碰就抛） | unit | 同上（`plans without a single seam invocation…`） | ✅ | ✅ green |
| 4-02-01 | 02 | 2 | GEN-06 | T-04-17 | 5xx/网络重试 2 次（2s/8s）；4xx 不重试不等待 | unit | 同上（retry boundary 5 臂） | ✅ | ✅ green |
| 4-02-02 | 02 | 2 | GEN-03, GEN-05, GEN-06 | T-04-08/09/10/11 | 失败即停 / `--keep-going` / `--redo`；账本按 key 合并且拒绝重复 | integration | 同上（walk modes / ledger 两组臂） | ✅ | ✅ green |
| 4-03-01 | 03 | 3 | GEN-04 | T-04-12 | 截断 raw 不算完成（整解码，不是读头） | unit | 同上（resume facts 2 臂） | ✅ | ✅ green |
| 4-03-02 | 03 | 3 | GEN-04, TRAN-02 | T-04-13/14/15/16 | 比例闸门在切格之前；`nextPending` 是唯一完成判定 | integration | 同上（resume gate / aspect gate 两组臂） | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Per-Requirement Coverage（本 phase 的 10 条，逐条观察）

每条 = 会红的测试 + 实际观察到的红。命中的 `<arm>` 均可用
`npx vitest run cli/commands/__tests__/anim.test.mjs` 复跑（41 臂全绿，
`Test Files 1 passed (1)` / `Tests 41 passed (41)`）。

| Requirement | 覆盖臂（观察值断言） | 变异探针（把行为改坏 → 臂转红） | 结论 |
|-------------|----------------------|----------------------------------|------|
| GEN-01 | `plans without a single seam invocation and without a single write`（`apiCalls/serverCalls/bridgeCalls === 0`、`plan.length 8`、`calls 8`、`cells 64`、`canvas '4096x512'`、`!existsSync(out)`） | P4 删掉 per-strip `canvas` → 该臂红；M10 让 `plan` 吞掉 `--go` → `refuses to spend from plan…` 红 | **COVERED** |
| GEN-02 | `makes a dry run say exactly what plan says`（`deepEqual`，两个 seam 计数 0） | F9 dry 前多调一次 `ctx.api` → 红；P5 把 `--go` 闸门反转（run 默认花钱）→ 红；M11 dry 路径碰 `ctx.server` → 红 | **COVERED** |
| GEN-03 | `lets an unwritable raw/ fail loudly, with nothing half-written`；`leaves no temp file behind, in a failing run or a redo` | M6 把 `writeFileAtomic` 退化成直接 `writeFileSync`（无 temp+rename）→ write path 臂红（`promise resolved … instead of rejecting`） | **COVERED** |
| GEN-04 | `fully decodes a whole file, and refuses a truncated one…`；`redoes one strip whose raw is truncated`；`makes a second pass over a complete set cost ZERO calls` | F5 `decodesAsImage` 退回 `metadata()` 读头 → 4 臂红；F4 `derivedCount` 永远报满 → 2 臂红；M9 facts 清空 → 6 臂红 | **COVERED** |
| GEN-05 | `refuses a ledger that already carries a duplicate key, without calling out`（`code: 'duplicate_ledger'`、0 调用）；`keys every row once…` | M8 账本 append 取代 merge → 9 臂红；F1 两个重复守卫都删 → duplicate 臂红；定位到 `is not readable JSON` 的 `bad_ledger` 守卫删除 → parse 臂红 | **COVERED**（守卫有冗余，见下） |
| GEN-06 | `stops after the first strip that cannot be finished`（`api.calls.length 4`、`strips.length 2`、第 3 帧不存在）；`runs the plan to its end under --keep-going`（`5` 调用、恰一行 `ok:false`）；`redoes exactly the named strip…`（其余行 deepEqual） | F7 默认改成 keep-going → 2 臂红；F8 `--redo` 不生效 → redo 臂红；M4 重试表砍成 1 次 → 5xx 臂红；M5 状态改从 route body 读（真实 503 不重试的缺陷）→ 6 臂红 | **COVERED**（“重试只包生成调用”的另一半见下） |
| TRAN-01 | `books what came back, not what it asked for`（`requested '4096x512'` / `returned '2048x246'`；回显写法产不出后者） | M1 `returned` 回显请求 → 5 臂红 | **COVERED** |
| TRAN-02 | `refuses an absurd return without cutting it`（`bridgeCalls 0`、零 derived、raw 保留）；`passes the normal drift…`（0.392% / 3.977% / 4.065% 必须过）；`refuses both ends of the absurd side`（87.50% / 70.83%） | M2 容差放到 0.95（方图被放过）→ 2 臂红；M3 收紧到 0.03（拒掉自身常态）→ 14 臂红 —— **两个方向都可证伪** | **COVERED** |
| CLI-01 | 无测试臂 —— 见 “Uncovered” 一节 | M12/P1：从 `cli/ie.mjs` 删掉 `'./commands/anim.mjs'` 注册行，`npm test` **仍然全绿**（415 passed / 1 skipped，exit 0） | **UNCOVERED** |
| CLI-02 | `spends on run --go…`（`written` 含 raw/derived/set.json、`setJson` 路径）；`plans without…`（plan 数组逐字段 `toEqual`）；`lets --out override…` | P3 run payload 去掉 `written` → 4 臂红；P4 去掉 per-strip `canvas` → 1 臂红 | **COVERED** |

**计数：10 条中 9 条 COVERED、1 条 UNCOVERED（CLI-01）。**

---

## Uncovered & Vacuous Coverage

### 1. CLI-01 — 注册行没有任何测试（UNCOVERED）

`ie anim plan|run` 进命令表、`ie help anim` 存在，今天**实际成立**（观察：
`node cli/ie.mjs help anim` → exit 0 且含 `ie anim plan`；`ie help` 表中有
`anim` 行），但**没有任何会红的测试**守着它：

```
# 变异：从 cli/ie.mjs 删掉 "  './commands/anim.mjs',"
npx vitest run   →  Tests  415 passed | 1 skipped (416)   exit 0   # 全绿，毫无察觉
bash <04-01 Task2 的 <automated>（仅把 cd 与临时目录换到 scratch worktree）  →  GATE_EXIT=2   # 只有 plan 级闸门抓到
node cli/ie.mjs anim plan --spec …  →  ie: unknown command "anim"
```

- **gap_type:** `no_test_file`（suite 层）
- **suggested_test_path:** `cli/commands/__tests__/ie.test.mjs`（或加进
  `library.test.mjs` 同层的命令注册臂）
- **suggested_command:** `npx vitest run cli/commands/__tests__/ie.test.mjs`
- 最小臂：spawn `node cli/ie.mjs help anim`，断言 exit 0 且 stdout 含
  `ie anim plan`；以及 `ie help` 命令表里出现 `anim`。
- 注：`04-01-SUMMARY.md` D3 把这条记为 "integration: pass" —— 那是 **plan 闸门**
  的观察（真实且已复现），不是 suite 里的测试；回归时它不会自动红。

### 2. GEN-05 重复守卫有冗余 —— 单点变异能存活（WARNING，不是洞）

`duplicate_ledger` 有两处：load 循环的 `merged.has`，与 `nextPending().duplicates`。
只删前者（M7）→ 41/41 仍绿且行为仍正确（后者兜住）；两处都删（F1）→
`refuses a ledger that already carries a duplicate key` 红。行为保证成立，
但**单个守卫是 load-bearing 却无人守**：哪天有人删掉后一处，测试不会说话。

### 3. “重试只包生成调用”的反方向没有行为臂（WARNING）

计划 T-04-07 禁止“一条切格失败再买一张图”。现有臂只证明**生成失败时重试 3 次、
bridge 0 次**；反过来“切格/比例/格数失败后不得再买图”**没有臂**：

```
# 变异：在 meta.ok:false 分支前追加一次付费调用 ctx.api('generate', …)
npx vitest run cli/commands/__tests__/anim.test.mjs →  Tests  41 passed (41)   # 存活
```

该主张目前只由 plan 闸门的源码正则 `/generateWithRetry\(\s*\(\)\s*=>/`
（04-02 Task 1 的 `<automated>`，已复跑：`ledger plumbing ok`）钉住 ——
正则不是行为测试。**suggested arm：** op 返回 `ok:false` 后断言
`api.calls.length === 1`。

### 4. 04-01 Task 1 的 plan 闸门对“原子性”本身是弱的（注记）

同一闸门在 M6（去掉 temp+rename、直接写目标）下**通过**（`media atomic-write ok`）：
不残留 temp、失败不留目标 —— 直接写也满足这些断言。真正红的是 suite 里的
write path 臂。GEN-03 仍归 COVERED（有会红的测试），但别把那条闸门当成
原子性的证明。

---

## Wave 0 Requirements

- [x] 无 —— **既有基础设施覆盖本 phase 全部需求**：`cli/commands/__tests__/anim.test.mjs`
  在 Wave 1 内随执行交付（41 臂），`vitest.config.ts` 既有，无新依赖、无新配置。

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

（无 —— 本 phase 的行为都有自动化验证或已显式列为 UNCOVERED；真实付费
`run --go` 的端到端验收属于 Phase 7 的 ACC-01，不在本 phase 契约内。）

*If none: "All phase behaviors have automated verification."*

---

## Nyquist Audit 2026-10-08 — observed evidence

**State B（无既有 VALIDATION.md，3 份 SUMMARY 齐）→ 由工件重建。**

### 输入
`04-01..03-PLAN.md`、`04-01..03-SUMMARY.md`、`REQUIREMENTS.md`（GEN-01..06、
TRAN-01/02、CLI-01/02）、实现 `cli/commands/anim.mjs`、`cli/lib/media.mjs`、
`cli/ie.mjs`、`cli/commands/__tests__/anim.test.mjs`（41 臂）、`cli/lib/__tests__/args.test.mjs`。

### 复跑的 key lines

| # | 命令 | 关键行 |
|---|------|--------|
| 1 | `npx vitest run cli/commands/__tests__/anim.test.mjs` | `Test Files  1 passed (1)` / `Tests  41 passed (41)` |
| 2 | `npm test` | `Test Files  37 passed (37)` / `Tests  416 passed (416)` |
| 3 | `IE_BASE_URL=http://127.0.0.1:1 node cli/ie.mjs anim plan --spec … --json` | `{"ok":true,"summary":"plan: 8 strips · 8 calls · 64 frames · out /tmp/p4-val/out",…}`；`plan --json` 与 `run`（无 `--go`）`cmp` → `IDENTICAL`；`<out>` ABSENT |
| 4 | `node cli/ie.mjs anim plan … --go` / `node cli/ie.mjs anim` / `--redo idle:9` / `--redo idle:x` | `ie: plan never spends — --go belongs to run`、`ie: unknown anim subcommand "…"`、`ie: --redo idle:9: no such strip in the plan`、`ie: --redo must be state:frame, got "idle:x"` —— 全部 exit 2 |
| 5 | `node cli/ie.mjs help anim` + `node cli/ie.mjs help` | exit 0，含 `ie anim plan`；命令表有 `  anim  animation set — …` |
| 6 | 7 条 PLAN `<automated>` 逐条原样执行（04-01:142/260/330、04-02:179/243、04-03:123/227） | `media atomic-write ok`；`dry plan ok` + `gate plumbing ok`；`anim test file ok`；`retry boundary ok`；`ledger plumbing ok`；`decode facts ok`；`resume plumbing ok` + `reason coverage ok` —— 7/7 exit 0 |
| 7 | 手工截断 raw 后 `IE_BASE_URL=http://127.0.0.1:1 node cli/ie.mjs anim run --spec … --go` | stderr：`[1/1] idle:0 · raw-unreadable → redo 4096x512`；完整集第二轮：`{"ok":true,"summary":"anim set complete — 0 to do, 1/1 done","written":[]…}` exit 0 |

### 变异矩阵（在 `/tmp/p4-mut/repo` 的 scratch worktree 内做，每个变异后 `git checkout --` 还原；真实仓库零改动）

| 变异 | 目标 | 结果 |
|------|------|------|
| M1 `returned` 回显请求 | TRAN-01 | **红 5 臂** |
| M2 容差 0.05→0.95 | TRAN-02 上界 | **红 2 臂** |
| M3 容差 0.05→0.03 | TRAN-02 常态侧 | **红 14 臂** |
| M4 重试表 `[2000,8000]→[2000]` | GEN-06 | **红 1 臂** |
| M5 `err.status` → `err.detail.status` | GEN-06（真实 503 不重试） | **红 6 臂** |
| M6 `writeFileAtomic` → 直接写 | GEN-03 | **红 1 臂**（media plan 闸门仍绿，见注记） |
| M7 删 load 循环重复守卫 | GEN-05 | 存活（F1 两处都删 → 红 1 臂） |
| M8 账本 append 取代 merge | GEN-05 | **红 9 臂** |
| M9 facts 清空 | GEN-04 | **红 6 臂** |
| M10 `plan` 吞掉 `--go` | GEN-01/02 | **红 1 臂** |
| M11 dry 路径碰 `ctx.server` | GEN-01/02 | **红 1 臂** |
| M12 删注册行 | CLI-01 | **全 suite 绿**（=UNCOVERED；plan 闸门红） |
| F4 `derivedCount` 恒满 | GEN-04 | **红 2 臂** |
| F5 `metadata()` 取代整解码 | GEN-04 | **红 4 臂** |
| F6 删格数检查 | GEN-04 | **红 1 臂** |
| F7 默认 keep-going | GEN-06 | **红 2 臂** |
| F8 `--redo` 不生效 | GEN-06 | **红 1 臂** |
| F9 dry 前多一次 api | GEN-02 | **红 1 臂** |
| F10 跳过 raw 落盘 | TRAN-01 | **红 11 臂** |
| P2 停用 `bad_ledger`（parse 分支） | GEN-05 | **红 1 臂** |
| P3 payload 去掉 `written` | CLI-02 | **红 4 臂** |
| P4 payload 去掉 `canvas` | CLI-02 | **红 1 臂** |
| P5 反转 `--go` 闸门 | GEN-02 | **红 1 臂** |
| 生成后追加一次付费调用 | GEN-06 / T-04-07 | **存活**（=WARNING，见 Uncovered §3） |

*（scratch worktree 上另有 1 条 skip：`app/lib/__tests__/animStrip.test.ts` 的
probe-strip 臂依赖本机 `.ie/probe/` 产物，与 Phase 4 无关。）*

### 结论

- 9/10 条需求由可红的自动化测试守着，且红的方向都在本次审计中**实际观察到**。
- 1 条 UNCOVERED（CLI-01，suite 层），2 处 WARNING（GEN-05 守卫冗余、
  GEN-06 “重试只包生成调用”的反方向无行为臂）。因此
  **`nyquist_compliant: false`**，路线 = PARTIAL。

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references（无 Wave 0 需求 —— 基础设施既覆盖）
- [x] No watch-mode flags（本文件全部命令均为 `vitest run`，非 watch）
- [x] Feedback latency < 5s（quick 2.9 s / full 3.3 s 实测）
- [ ] `nyquist_compliant: true` set in frontmatter —— **未设**：CLI-01 无 suite 测试（见 Uncovered §1）

**Approval:** approved 2026-10-08（部分：9 条 COVERED / 1 条 UNCOVERED）

---

*Phase: 04-cli-runner*
*Validated: 2026-10-08*
