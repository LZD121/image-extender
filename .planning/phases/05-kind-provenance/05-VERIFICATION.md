---
phase: 05-kind-provenance
verified: 2026-10-08T15:50:00Z
status: passed
score: 11/11 truths verified
covered_files:
  - .planning/phases/05-kind-provenance/05-01-PLAN.md
  - .planning/phases/05-kind-provenance/05-02-PLAN.md
  - .planning/phases/05-kind-provenance/05-01-SUMMARY.md
  - .planning/phases/05-kind-provenance/05-02-SUMMARY.md
  - .planning/phases/05-kind-provenance/05-CONTEXT.md
  - .planning/phases/05-kind-provenance/05-RESEARCH.md
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - app/lib/libraryTypes.ts
  - app/lib/libraryCollect.ts
  - app/lib/__tests__/libraryCollect.test.ts
  - app/lib/__tests__/payloadArithmetic.test.ts
  - app/components/LibraryPanel.tsx
  - app/i18n/messages/shell.ts
  - cli/commands/library.mjs
  - cli/commands/__tests__/library.test.mjs
covered_digest: "v1:sha256:47ff6d0a86ce744d567ec5bd49a51614a185bf7f658e38ffc5179331e8d4d22d"
behavior_unverified: 0
behavior_unverified_items:
coincidental_reliance_items:
  - truth: "`ie library save … animations` 在无头 CLI 上的完整环（save → list → get → file → delete）"
    reason: plan-gate
    harden: "上面这一轮是**手工**用 `IE_ASSETS_DIR` 指向临时目录跑的；持久套件里已有 save/list/get/delete 的进程内臂（`cli/commands/__tests__/library.test.mjs`），但整套 CLI 全环还没有一条端到端臂。下一次有人改 subcommand 分派时，红的是那条进程内臂，不是环。"
---

# Phase 5: 库 kind、provenance 诚实性与载荷上限 — Verification Report

**Verified:** 2026-10-08 · **Goal:** `ASSET_KINDS += 'animations'`，集资产只收 `derived/` + `set.json` + `meta.json`；`BackendLabel` 一处定义、route 与 CLI 共用；`cost` 报才记且断言 `cost.source === backend`；修掉 `ie library save` 的硬编码 backend。

**Verdict: PASSED — 11/11 must_have truths, 7/7 requirement IDs, all four success criteria observed.**

Two subagent dispatches (the phase's code review and its verifier) died on an upstream
provider quota (HTTP 429, ~6m20s each) — the same wall that killed two executor dispatches
during the waves. Verification therefore ran **inline** by the orchestrator, and no
`05-REVIEW.md` exists (the code-review gate is advisory and never blocks).

## 1. The four success criteria, observed

Every check below ran the **real** `node cli/ie.mjs` against `IE_ASSETS_DIR` in a temp dir
with a throwaway run directory.

| # | Criterion | Observation |
|---|---|---|
| 1 | a set can be saved, listed, grouped by kind, read and deleted | `save` → exit 0, 2 files; `list` → `dungeon → animations → chaser-idle` with its three `derived` entries; `get` → meta; `file … derived/idle_f1_east.png --out` → **222 bytes copied out**; `delete` → exit 0 and `list` then reports `0 asset(s)` |
| 2 | a save carries no `raw/`, with arithmetic guarding it | on disk: `derived/idle_f1_east.png`, `derived/set.json`, `meta.json` — no `raw/`. `meta.files.sheet === null`. Arithmetic: `MAX_TOTAL_CHARS = 279,621,291`; 16 real raws = `363,851,424` chars = **1.301×** the cap; the derived-only set = `75,264,000` = **26.9%** |
| 3 | `provenance.backend` is the real producer | `meta.provenance.backend === 'apimart'`, `model === 'teamo-router/gemini-3.1-flash-image'` — both read from the ledger (the run's `set.json`), and `buildProvenance` now throws when a reported `cost.source` names another vendor |
| 4 | `manifest` has no frame list; `params` agree with the `ok:true` rows | `manifest` keys are `type/actor/dirs/cell/states` only; `params = {dirs:8, states:1, frames:2, cell:512, calls:1, cells:8, seconds:12.5}` — the ledger's totals, which the collector now refuses to accept unless they equal its `ok:true` rows |

## 2. must_haves — 11 truths (6 in 05-01, 5 in 05-02)

Grouped by what pins each one; every group was run, not read.

**05-01 (6) — the kind, the payload, the CLI entry**
- `'animations'` is in `ASSET_KINDS` (6 kinds) — asserted, and `ie library list` groups it.
- The panel's `Record<AssetKind, string>` and both message maps include the kind — `npx tsc --noEmit` exits 0, which is the enforcement (a missing label or translation is a compile error, not a blank row).
- The payload is derived frames + the ledger, never a raw — asserted key-by-key, and observed on disk after a live save.
- `meta.manifest` carries the spec block only — asserted `not.toHaveProperty('frames' | 'strips')`.
- `manifest.states[0]` has the ledger's real state shape (`name/frames/fps/durationsMs/loop`) and **no `motion`** — the field a pre-audit draft would have written as `undefined`.
- The CLI entry dispatches **before** the `--sheet`/`--derived` guard — proven by the negative arm: a non-animations save with no files still fails with `save needs at least one file`.

**05-02 (5) — the honesty and the budget**
- No default producer: `?? 'openrouter'` is gone, a non-animations save without `--backend` exits non-zero with `missing_flag`, with `--backend apimart` it exits 0, and an animations set ignores the flag entirely (backend from the ledger).
- `cost` is recorded only when reported, and a `cost.source` that is not the backend throws — three unit cases (mismatch throws, `null` accepted, match accepted).
- The payload arithmetic holds against the route's **own** parsed caps (not a copy of them).
- `params.calls/cells/seconds` equal the ledger's `ok:true` rows, or the save is refused — four unit cases including the empty set (`totals` all zero; a non-zero second total on an empty set is refused).
- `manifest` carries no frame list (asserted here as well as in 05-01).

## 3. Two observed reds — the phase's own changes falsified real inputs

Rather than hand-built mutation probes, this phase produced two falsifications that came
from real code paths, both observed before their fixtures were corrected:

| Change | What went red | What it proves |
|---|---|---|
| removing the `?? 'openrouter'` default | **three existing save tests** (`3 failed | 6 passed`) that had saved without `--backend` | the default really was load-bearing for real callers; its removal is a behaviour change, and the tests that encoded the old behaviour had to change with it |
| the D-47 totals check | the CLI test fixture whose ledger said `calls: 1` with **no** `ok:true` row (`1 failed | 442 passed`) | the check catches a hand-written ledger that lies about itself — exactly the input class it exists for, found in my own fixture |

## 4. Requirement coverage — 7/7

`LIB-01` kind + panel + i18n (05-01 T1) · `LIB-02` payload shape (05-01 T2) + arithmetic guard (05-02 T3) · `LIB-03` provenance from the ledger (05-01 T2) + cost honesty (05-02 T2) · `LIB-04` no default producer (05-02 T1) · `LIB-05` spec-only manifest (05-01 T2 + 05-02 T4) · `LIB-06` params/ledger agreement (05-02 T4) · `CLI-03` reuse of `ie library save`, no new command (05-01 T3).

## 5. The recorded deviations, judged

- **`collectSetAsset` is pure** (the plan had it read files). Holds up: `app/lib/**` is bundled into the browser — `app/page.tsx` and `LibraryPanel.tsx` import this module — and `library.ts` remains the only `node:fs` owner in `app/lib`. The CLI does the reading. No behaviour lost, and the layering rule survived intact.
- **The guard parses the route's caps** instead of copying them. Holds up, and is strictly stronger: a changed cap re-points the guard rather than silently invalidating it.
- **No separate empty-set branch** in the D-47 check. Holds up: with no ok rows the three equalities already force every total to zero; the semantics are pinned by a test, not by dead code.
- **Fixtures updated** in three save tests and one CLI fixture (see §3). Holds up — these were consequences of the intended behaviour change, not adjustments made to turn a red green.

## 6. Limits (stated, not glossed)

- `npm test` → **443/443** · `npm run test:cli` → **17/17** · `npx tsc --noEmit` → exit 0 · prior-phase regression files → **84/84**.
- **No `05-REVIEW.md`**: its dispatch died on the quota wall. The code-review gate is advisory.
- The full CLI round trip in §1 is a **manual** observation; the persistent suite covers save/list/get/delete in-process but has no end-to-end arm for the whole ring (recorded above under coincidental reliance).
- The truth score is a quoted-string enumeration of `must_haves.truths` (6 + 5).
