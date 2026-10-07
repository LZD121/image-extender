---
phase: 04-cli-runner
verified: 2026-10-08T02:45:00Z
status: passed
score: 24/24 truths verified
covered_files:
  - .planning/phases/04-cli-runner/04-01-PLAN.md
  - .planning/phases/04-cli-runner/04-02-PLAN.md
  - .planning/phases/04-cli-runner/04-03-PLAN.md
  - .planning/phases/04-cli-runner/04-01-SUMMARY.md
  - .planning/phases/04-cli-runner/04-02-SUMMARY.md
  - .planning/phases/04-cli-runner/04-03-SUMMARY.md
  - .planning/phases/04-cli-runner/04-04-SUMMARY.md
  - .planning/phases/04-cli-runner/04-REVIEW.md
  - .planning/phases/04-cli-runner/04-VALIDATION.md
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - cli/commands/anim.mjs
  - cli/commands/__tests__/anim.test.mjs
  - cli/lib/media.mjs
  - cli/lib/server.mjs
  - cli/ie.mjs
  - docs/agent-api.md
covered_digest: "v1:sha256:4cad032bfa09df96b62c5654ab87a20e2f984a35b15de26ce731ebbcd506858b"
behavior_unverified: 0
behavior_unverified_items:
coincidental_reliance_items:
  - truth: "一条只在计划级闸门里被证明的真实性（每条 plan 的 7 条 `<automated>` 都逐字重跑过 exit 0，但其中若干断言只存在于闸门脚本，不在持久测试里）"
    reason: plain
    harden: "本阶段已经补掉两条最贵的（CLI-01 的注册、GEN-06 的「op 失败只买一次」），其余是计划闸门与持久臂一一对应的部分；任何仅靠闸门证明的真相在下一阶段被改动时不会响。"
---

# Phase 4: CLI runner — Verification Report

**Verified:** 2026-10-08 · **Phase goal:** `ie anim plan|run` 两个子命令：预演零调用、`--go` 才花钱、每张完成即原子落盘、ledger 按 `(state, frame)` 合并、失败默认停止、`--redo state:frame` 单条重跑、`requested`/`returned` 都记录且比例不符即 `ok:false`。

**Verdict: PASSED — 24/24 must_have truths, 10/10 requirement IDs accounted for.**

This phase is where the pipeline starts spending money, so a plan-level gate was never
taken as proof on its own: every claim below is either a command I ran (with its key
output line) or an arm I mutation-probed to show it can fail. Two subagent dispatches
died on a provider quota wall mid-run (`ollama-cloud/deepseek-v4.1-flash`, HTTP 429), so
the verification was executed inline by the orchestrator — the generic-agent fallback.

## 1. The goal's four success criteria, observed live

Run against `IE_BASE_URL=http://127.0.0.1:1` (nothing is listening on port 1): any touch
of `ensureServer` would die with `server_unreachable`, so a passing run proves the dry
path needs no server at all.

| # | Criterion | Observation |
|---|---|---|
| 1 | `ie anim plan --spec x.json` prints canvas/calls/total/output-root with **zero** network calls | `{"ok":true,"summary":"plan: 8 strips · 8 calls · 64 frames · out /tmp/p4-ver/o1","dryRun":true,"plan":[{"index":0,"state":"idle","frame":0,"canvas":"4096x512","calls":1,"out":"raw/idle_f1_8dir.png"}, …]}` — **exit 0 on a dead base URL** |
| 2 | A resume skips finished entries; a hand-truncated raw is redone | suite arms: `makes a second pass over a complete set cost ZERO calls`; `redoes one strip whose raw is truncated, and only that one`; `decodesAsImage` pinned against `metadata()`'s 60%-truncated FALSE PASS |
| 3 | One ledger row per `state:frame` — double billing impossible | `keys every row once, and keeps the failed strip in frames[]`; a hand-written duplicate is **refused** (`duplicate_ledger`), not counted as 17 rows for 16 strips |
| 4 | A mis-shaped return is failed and never reaches the cutter | `refuses an absurd return without cutting it (1:1 against 8:1, 87.50% off)` → `ok:false`, `returned:'2048x2048'`, zero derived files, `bridgeCalls` unchanged |

Also observed: dry `run` is **byte-identical** to `plan` (`cmp` → IDENTICAL), and neither
creates `<out>` (`test -e` → ABSENT). `plan --go` → **exit 2**; `run --keep-going` without
`--go` → **exit 2**.

## 2. must_haves (24 truths across the three plans)

Grouped by where each is pinned; the suite line is the arm that would go red.

**04-01 (10 truths) — the command surface and the spend gate**
- Zero-call dry path: two independent observations — in-process counters (`apiCalls`,
  `serverCalls`) that the fakes increment *and* throw on, plus the live dead-URL run above.
- Zero writes: `!existsSync(out)` after a dry run (live: ABSENT).
- `--go` is the only switch and defaults off: live exit 2 for `plan --go` and for
  `run --keep-going`; `--go` absent → the same `planPayload()`.
- GEN-01 rendering: the live JSON above carries `canvas`, `calls`, `cells` (summary
  `64 frames`) and the resolved absolute `out`.
- Spec sources (D-31): `--spec` and inline flags reach the same plan (`takes a spec from
  inline flags and reaches the same plan`); `--spec` + inline fields together is refused.
- Atomic writes: `writeFileAtomic` arms — replacing an existing **file** succeeds, writing
  over a **directory** throws, an unwritable parent throws; no `.*.tmp-*` survives.
- Help surface: `ie help anim` prints the two subcommand lines (checked verbatim by the
  registration arm below).

**04-02 (7 truths) — retry, walk modes, ledger**
- The retry wraps the generation call only: a stub that fails twice then succeeds gives
  `apiCalls === 3` with `bridgeCalls === 1`; a source-shape arm asserts the wrapper wraps a
  call expression, not the pipeline.
- Out of retries → `ok:false` **and** the run stops by default (3-strip plan, strip 2
  permanently failed → 2 ledger rows, no raw for strip 3, a `stopped after …` note);
  `--keep-going` runs to the end.
- `--redo` scope: **this was broken and is now fixed** — see §3. The named strip is the
  only one re-run, and the other rows stay byte-identical (`seconds` included).
- Ledger merge-by-`(state, frame)`: rows are keyed by `stripKey`, a redo replaces rather
  than appends, and a pre-existing duplicate is refused.
- The HTTP status is owned at the throw point (`routeError` sets `err.status`), and the
  regression arm drives a **real** `routeError`-shaped rejection rather than a hand-built
  error object.

**04-03 (7 truths) — resume facts, completion judgement, aspect gate**
- Completion = record ∧ decodable raw ∧ expected derived count; a truncated raw is
  `raw-unreadable` and is redone (arm), and `decodesAsImage` is pinned against
  `metadata()` on the *same* file.
- `nextPending` is the only completion judgement: a `grep`-level arm asserts
  `nextPending(` is called and no `entry.ok` re-derivation exists; direction order comes
  from the ledger rows, never a directory listing.
- The aspect gate refuses only absurd shapes: `ASPECT_TOLERANCE = 0.05`
  (`cli/commands/anim.mjs:68`) with the measured **normal** drift (0.392% / 3.977% /
  4.065%) on the PASS side and 87.50% / 70.83% refused. The echo-the-request arm asserts
  `returned !== requested` and `returned === '2048x2048'`.
- A wrong-shaped strip keeps its raw, gets `ok:false`, and produces **zero** derived files.

## 3. The money invariants, mutation-probed

Two audits ran after the waves and both found real defects (`.planning/phases/04-cli-runner/04-REVIEW.md`,
`04-VALIDATION.md`); a post-audit gap-closure pass (`04-04-SUMMARY.md`) closed them. I
re-verified the closure by mutation rather than by reading the summary:

| Mutation | Expected | Observed |
|---|---|---|
| Revert CR-02 (`pending` back to the raw union), CR-03 (`spec.model` no longer set), WR-04 (`ledgerRows` drops orphans) at once | exactly the 3 new arms red, everything else green | **3 failed / 45 passed**, and the 3 are the CR-02, CR-03 and WR-04 arms |
| Restore all three | 48/48 | **48/48** |
| Delete `'./commands/anim.mjs',` from `cli/ie.mjs`'s command table | the new CLI-01 arm reddens | `× ie — the anim command is registered > lists anim in the command table, through the real CLI` → **1 failed** |
| Restore `cli/ie.mjs` | green, no diff | **1 passed**, `git diff --stat cli/ie.mjs` empty |

Money-invariant statements that now hold by observation, not by wording:
(a) `plan` and dry `run` cost zero calls; (b) a strip that was paid for always has a
ledger row, and the next run books it as `not-ok` instead of `missing` — never re-bought;
(c) a redo of one strip does not spend on the others; (d) an op-level `ok:false` costs
exactly one POST (`api.bodies.length === 1`).

## 4. Requirement coverage (10/10 accounted for)

`GEN-01` live plan payload · `GEN-02` dry `run` byte-identical to `plan` · `GEN-03`
`writeFileAtomic` + `.*.tmp-*` === 0 across a failing and a redo pass · `GEN-04` resume
facts from a full decode · `GEN-05` merge-by-key + duplicate refusal · `GEN-06` retry
boundary + the new one-POST arm · `TRAN-01` the `strip-frames` op contract (Phase 3) is
consumed, never re-implemented · `TRAN-02` aspect gate before the cutter · `CLI-01`
**new arm** (registration reddens when removed) · `CLI-02` `docs/agent-api.md` rows match
the shipped flags (`--keep-going`, `--redo state:frame`).

`04-VALIDATION.md` reported CLI-01 uncovered by the suite; that gap is now closed and the
arm was mutation-probed above.

## 5. Deliberately open, and why they do not break a must_have

`WR-01` (`providerFor` labels an unresolvable profile `openrouter` in the plan payload) —
the server rejects an unknown profile outright, so the run fails before writing anything;
the dishonest label lives only in the preview. The honest fix is a plan-payload contract
change no plan specified. `WR-02` (an undecodable reply is enveloped as `code:'error'`
rather than a named `bad_image`) — the failure is already *booked* and names the strip key
since CR-01; what remains is an error-code taxonomy. `IN-03` (`nextPending`'s duplicate
check is unreachable behind the load-time check) — defence-in-depth, harmless.

**None of the three falsifies a must_have, a success criterion, or a requirement ID.**

## 6. Verification limits (stated, not glossed)

- The full-suite line for this phase is `npm test → 423/423`, `npm run test:cli → 17/17`,
  `npx tsc --noEmit → exit 0`; the phase file alone is `48/48`.
- Two subagent dispatches (code review, Nyquist) completed; two (gap-fix, verifier) died
  on an upstream provider quota mid-run. The gap-fix interruption left CR-02/CR-03
  uncommitted and reintroduced them absent from the tree; they were re-applied from the
  review's text and re-probed before commit (`262d558`).
- `verify.codebase-drift` reports **warn** on the fork's root files (`.gitignore`,
  `AGENTS.md`, `package.json`, `tsconfig.json`, …): the codebase map predates the fork.
  Non-blocking, directive `warn`, no mapper required.
