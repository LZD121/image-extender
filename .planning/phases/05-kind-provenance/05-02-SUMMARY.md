---
phase: 05-kind-provenance
plan: 02
subsystem: library
tags: [typescript, provenance, cost-honesty, payload-budget, vitest, cli]

# Dependency graph
requires:
  - phase: 05-kind-provenance
    provides: "05-01's `collectSetAsset` (the set payload) and the `ie library save … animations` entry point this plan closes the honesty gaps on"
  - phase: 04-cli-runner
    provides: "`set.json`'s `backend.{provider,model}` and `totals.{calls,cells,seconds}` — the ledger every check here reads"
provides:
  - "`ie library save` has no default producer: `--backend` is required for every non-animations kind, and an animations set reads its backend off the ledger (LIB-04)"
  - "`buildProvenance` refuses a reported cost whose `source` is not the backend that painted the asset (LIB-03)"
  - "`collectSetAsset` refuses a ledger whose `totals` disagree with its own `ok:true` rows (LIB-06 / D-47)"
  - "`app/lib/__tests__/payloadArithmetic.test.ts` — the payload guard, asserting the arithmetic against the route's own parsed caps rather than a copy (LIB-02 / D-48)"
affects: [06]

actuals:
  tokens: 0
  tasks: 4
---

# Phase 5 Plan 02: provenance 诚实性与载荷上限 Summary

**Four tasks, four commits, all gates green, all verified live against the real CLI.**

## What landed

| Task | Commit | What it closes |
|---|---|---|
| 1 — no default producer | `94a0246` | LIB-04: `?? 'openrouter'` is gone; a non-animations save without `--backend` fails with `missing_flag` |
| 2 — a cost names its vendor | `b1ed23f` | LIB-03: `buildProvenance` throws when `cost.source !== backend`; `null` stays legitimate |
| 3 — the payload arithmetic | `3eae0fb` | LIB-02 / D-48: 16 raw strips cannot fit the request, asserted against the route's real caps |
| 4 — totals vs the ledger | `939ca6f` | LIB-06 / D-47: `params.calls/cells/seconds` must equal the ledger's `ok:true` rows, or the save is refused |

## Evidence — observed, not asserted

- Task gates run verbatim; `npx tsc --noEmit` → exit 0 · `npm test` → **443/443** · `npm run test:cli` → **17/17**.
- **Live CLI** (`IE_ASSETS_DIR` in a temp dir):
  - animations save with a self-consistent ledger → **exit 0**, 2 files; provenance reads `backend: apimart`, `model: teamo-router/gemini-3.1-flash-image`, `cost: null`, `params: {dirs:8, states:1, frames:2, cell:512, calls:1, cells:8, seconds:12.5}`, `toolVersion: ie@1.0.0` — every one of them off the ledger, none from a flag default.
  - non-animations save without `--backend` → `--backend is required: name the gateway that painted this asset`; with `--backend apimart` → exit 0.
  - a ledger edited so `totals.calls` (5) disagrees with its one ok strip → **refused**: `set.json totals.calls (5) must equal its ok strips (1)`.
- **The payload guard's numbers** (printed independently): `MAX_TOTAL_CHARS = 279,621,291`; 16 real raws = `363,851,424` chars = **1.301×** the cap; the derived-only set = `75,264,000` = **26.9%** of the cap. So the shape is structurally impossible to bust, not merely discouraged.
- The guard **parses** `MAX_FILE_CHARS` / `MAX_TOTAL_CHARS` out of `app/api/library/[[...path]]/route.ts` instead of copying them (see deviation 1).

## Deviations

1. **Rule 2 (better implementation) — the payload guard reads the route's caps.** The plan copied the arithmetic into the test (`Math.ceil((200 * 1024 * 1024 * 4) / 3) + 1024`). A copy keeps passing after the route's limit changes, which is the drift the guard exists to catch; it now extracts the expression from the route source and evaluates it, so a changed cap re-points the guard instead of silently invalidating it. Character-class-guarded, arithmetic only.
2. **Rule 1 (plan bug) — tests written against the real signature.** The plan's Task 4 test snippets called `collectSetAsset({ setJsonPath, derivedFiles, … })`, the pre-deviation signature from 05-01 (see that SUMMARY). Written against the actual pure signature instead.
3. **Rule 1 (plan bug, small) — no separate empty-set branch.** The plan's Task 4 asked for an extra `if (okStrips.length === 0)` check forcing `totals` to zero. With no ok strips the three equalities already force exactly that, so the branch would be unreachable-by-construction dead code; the empty-set semantics are pinned by a test instead (`calls: 0, cells: 0, seconds: 5` → refused).
4. **Rule 1 (bug in the fixtures) — three pre-existing save tests and one CLI fixture updated.** Removing the default producer is a behaviour change: the tests that relied on it now pass `--backend: 'openrouter'` explicitly, and two ledgers that recorded `calls: 1` with no ok rows were made self-consistent — the new D-47 check is what caught them, which is the check doing its job.
5. **Process — executed inline by the orchestrator.** The plan's executor dispatches die on an upstream provider quota (HTTP 429) on this machine; same tasks, same gates, same commit scope, four separate commits.

## Not done here (phase tail)

Phase-level verification (`05-VERIFICATION.md`), the code review and the regression gate are the phase's closing steps, not this plan's.

## Self-Check: PASSED

- [x] All four tasks executed, each committed individually with the plan's scope
- [x] Every `<automated>` gate run verbatim and green; `tsc` green; bridge smoke green
- [x] `05-02-SUMMARY.md` created, matches the template, committed
- [x] No file touched outside the plan's `files_modified` (+ this SUMMARY)
