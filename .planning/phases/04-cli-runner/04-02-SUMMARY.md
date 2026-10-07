---
phase: 04-cli-runner
plan: 02
subsystem: cli
tags: [node, esm, cli, retry, backoff, ledger, atomic-write, vitest, animSet]

# Dependency graph
requires:
  - phase: 04-cli-runner
    provides: "04-01's `writeFileAtomic`, the serial single-strip pipeline, the `--go` gate and the spec loader — this wave replaces the pipeline's generation step and its ledger read/write, not the surface around them"
  - phase: 02-pure-core
    provides: "`stripKey` / `parseStripKey` / `buildSetJson` — the merge key, the `--redo` parser and the ledger writer; none of them re-implemented here"
provides:
  - "`generateWithRetry`: 2s then 8s, wrapping ONE call — a post-processing failure never buys a second image"
  - "`err.status` on `routeError`'s error: the HTTP status has one owner at the throw point, so 5xx classification cannot drift to the route body"
  - "the three walk modes (default stop / `--keep-going` / `--redo state:frame`) as declared flags, in USAGE, help and docs"
  - "the ledger's merge-by-`stripKey` and its two loud refusals: `duplicate_ledger` and `bad_ledger`"
affects: [04-03, 05, 06]

actuals:
  tokens: 9352
  tasks: 2
  commits: 3
  plan_head_before: fba56d34487e2ce902610a07d876739908d87ab6

tech-stack:
  added: []
  patterns:
    - "retry boundary proven twice: a call-expression assertion in the source and call counts through the real pipeline"
    - "the throw point owns the machine-readable fact (`err.status`), the payload keeps the human one (`detail`)"
    - "a ledger that cannot be trusted is a loud error, never a repaired-by-omission file"

key-files:
  created: []
  modified:
    - cli/commands/anim.mjs
    - cli/commands/__tests__/anim.test.mjs
    - cli/lib/server.mjs
    - docs/agent-api.md

key-decisions:
  - "`routeError` attaches the HTTP status to the error (`err.status`) instead of letting it hide in the route body: every body is `{error: …}`, so reading `detail.status` made a live 503 look permanent and the retry never ran"
  - "`generateWithRetry` takes one `call` and nothing else — the temptation to wrap the pipeline is exactly what would pay for a second image after a cut failure"
  - "a strip that exhausts its retries is a failed ledger row, not a dead run: the paid-for attempts are recorded, no raw exists (no reply arrived), and the walk mode decides what happens next"
  - "`--redo` accepts both `--redo k1 --redo k2` and `--redo k1,k2`, and resolves every key against the plan before anything is called"
  - "the ledger is rewritten in plan order, not Map insertion order, so a resumed reader sees a predictable file"

patterns-established:
  - "the retry table is a test seam on the command spec (`retryDelays`), so pipeline arms assert call counts without spending ten seconds of wall clock"

requirements-completed: [GEN-03, GEN-05, GEN-06, TRAN-01]

coverage:
  - id: D1
    description: "Network/5xx failures are retried twice (2s, 8s) and 4xx never is; the retry wraps only the generation call"
    requirement: GEN-06
    verification:
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#retries a network failure once, and only after 2s"
        status: pass
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#gives a 5xx two retries and then throws with every attempt on it"
        status: pass
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#does not retry a 4xx and does not even wait"
        status: pass
      - kind: integration
        ref: "task 1 gate: retry boundary ok (the block's own node script, run verbatim)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The HTTP status is owned by the throw point: a live 503 through the real `routeError` retries twice, and the classification never reads the route body"
    requirement: GEN-06
    verification:
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#makes routeError own the status, not the route body"
        status: pass
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#retries twice through the pipeline when a live route answer is a 503 (apiCalls === 3, zero bridge calls)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A failed strip stops the run by default, `--keep-going` runs the plan to its end, `--redo state:frame` redoes exactly one strip"
    requirement: GEN-06
    verification:
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#stops after the first strip that cannot be finished (2 ledger rows, frame 3 never written)"
        status: pass
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#runs the plan to its end under --keep-going (3 rows, exactly one ok:false, frame 3 complete)"
        status: pass
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#redoes exactly the named strip and leaves the other rows byte-identical"
        status: pass
      - kind: integration
        ref: "task 2 gate: node cli/ie.mjs anim plan --keep-going → exit 2; `--redo idle:9` / `--redo idle:x` → exit 2"
        status: pass
    human_judgment: false
  - id: D4
    description: "The ledger merges by `state:frame` and refuses to run over a duplicate or broken one (`duplicate_ledger` / `bad_ledger`, zero calls)"
    requirement: GEN-05
    verification:
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#keys every row once, and keeps the failed strip in frames[]"
        status: pass
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#refuses a ledger that already carries a duplicate key, without calling out"
        status: pass
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#refuses a ledger it cannot parse, without calling out"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every write is atomic (zero `.*.tmp-*` after a failing run and after a redo) and a failed strip keeps its raw with no derived frame"
    requirement: GEN-03
    verification:
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#leaves no temp file behind, in a failing run or a redo"
        status: pass
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#keeps the raw and writes no derived frame when the op refuses the strip"
        status: pass
    human_judgment: false
  - id: D6
    description: "`requested` is the request canvas and `returned` is the size of the bytes on disk — a gateway that answers a different size is booked as such"
    requirement: TRAN-01
    verification:
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#books what came back, not what it asked for (4096x512 requested, 2048x246 returned)"
        status: pass
    human_judgment: false

# Metrics
duration: 4 min
completed: 2026-10-07
status: complete
---

# Phase 4 Plan 02: retry boundaries, the three walk modes, and a ledger that cannot hold a row twice Summary

**`generateWithRetry` wraps only the generation call (2s/8s, 5xx and network only), the HTTP status moves to the throw point where classification can actually read it, and the ledger merges by `state:frame` with loud refusals — so a `run --go` that hits a permanent failure stops, records what it paid for, and can be resumed or re-done one strip at a time.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-10-07T17:00:29Z
- **Completed:** 2026-10-07T17:04:12Z
- **Tasks:** 2
- **Files modified:** 4 (0 created, 4 modified)

## Accomplishments

- The retry boundary is pinned by two independent observations: `generateWithRetry` accepts one `call` (the source assertion `/generateWithRetry\(\s*\(\)\s*=>/`), and the arms count calls through the real pipeline — a permanent 503 costs three attempts and zero bridge calls, so a cut failure can never buy a second image.
- The status found its owner. `routeError` now hangs the HTTP status on the error it throws, and the arm asserts both halves: `err.status === 503` **and** `err.detail.status === undefined`. The regression this exists for (classifying by the route body) reads `apiCalls === 1` in the pipeline arm and reddens.
- The three walk modes are real: the default stops after the first strip it cannot finish (2 ledger rows, frame 3 never generated), `--keep-going` runs to the end (3 rows, exactly one `ok:false`, the last strip complete), and `--redo state:frame` replaces one row's raw bytes while the other two rows come back field-for-field identical — `seconds` included.
- A failed strip is a ledger row, not a lost run: retries exhausted books `ok:false` with the attempts named in the note, the op's own `ok:false` keeps its raw and writes **no** derived frame, and a dead bridge books the strip before the walk mode decides what to do next.
- The ledger refuses to be wrong out loud: two rows for one `state:frame` is `duplicate_ledger` and a file that will not parse is `bad_ledger`, both before a single call. Rows are written back in plan order, so a resumed reader sees the plan's order rather than a Map's history.
- `--keep-going` and `--redo state:frame` are declared, documented (`docs/agent-api.md`), in `USAGE`, and refused where they have no meaning (`plan` and a dry `run` are usage errors, exit 2).

## Task Commits

Each task was committed atomically:

1. **Task 1: `generateWithRetry` + the throw point owning the status** - `7c28b06` (feat)
2. **Task 2: the three walk modes + ledger merge uniqueness** - `cf0cfad` (feat)
3. **Plan-text fix: the gate's fixture spellings (see Deviations, Rule 1)** - `c7482cb` (docs)

**Plan metadata:** (this commit) (docs: complete plan)

## Files Created/Modified

- `cli/lib/server.mjs` — `routeError` attaches the HTTP status to the error it returns (`err.status`); `detail` keeps the route body.
- `cli/commands/anim.mjs` — `generateWithRetry` / `isRetryable` (exported), `readLedger`, `redoKeys`, the rewritten `runStrips` (three walk modes, merge-by-key uniqueness, plan-order rewrite), the two new flags.
- `cli/commands/__tests__/anim.test.mjs` — 15 new arms (5 retry-boundary, 4 walk-mode, 5 ledger, 1 rewritten), plus a `scriptedApi` stub that answers with route-shaped rejections.
- `docs/agent-api.md` — the `ie anim run` row lists `--keep-going` / `--redo state:frame`, with the stop/continue/redo paragraph and the two ledger refusals.

## Decisions Made

- **One owner for the status.** `err.status` is what machine code reads; `detail` stays the route's own body. Putting the status in both would be a fact with two sources, and the one that drifts is the one nobody reads.
- **A failed strip is data, not an exception.** The record is written before the walk mode decides; the run then stops (`--keep-going` continues) with the reason in a note. That is what makes a resumed run able to trust the ledger.
- **`--redo` never consults facts or pending.** This wave's `--redo` is "unconditionally redo this strip"; `nextPending` and the facts collection are 04-03's.
- **`plan --keep-going` is a usage error, not a silent ignore** — same discipline as `--go`: a preview has no "continue", and pretending otherwise makes the flag mean different things in two places.
- **The ledger's row order is the plan's order** (`plan.map(...).filter(Boolean)`), so a file written after a redo reads the same way as one written by a first run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 1's `<automated>` fixtures were mutually exclusive with the task's own mandated classification**

- **Found during:** Task 1 (before writing any implementation — the gate was extracted and run against a probe copy of the plan's own mandated `generateWithRetry`/`isRetryable`)
- **Issue:** The inline script built its rejections as `boom("route_failed", { status: 503 })` — a status inside `detail`. The same task mandates `isRetryable` read `err.status` (step ②, and threat T-04-17 explicitly forbids `detail`). Under the mandated implementation attempt 1 is not retryable, so the block failed on its second assertion: `AssertionError [ERR_ASSERTION]: 2 retries must wait 2s then 8s / + actual [] / - expected [2000, 8000]`, exit 1. The gate was red by construction and no implementation could satisfy both halves of the same task.
- **Fix:** the two fixture spellings became the CLI-owned shape (`Object.assign(new Error("route_failed"), { code: "route_failed", status: 503 })`); **assertions untouched** (`sleeps === [2000, 8000]` is byte-identical). Re-ran the block verbatim: `retry boundary ok`, exit 0. Confirmed non-vacuous: against the pre-fix (`err.detail.status`) implementation the same block fails, exit 1.
- **Files modified:** `.planning/phases/04-cli-runner/04-02-PLAN.md` (the `<automated>` line of Task 1 only)
- **Verification:** extracted-and-run verbatim; red on the old classification, green on the mandated one
- **Committed in:** `c7482cb`

**2. [Rule 1 - Bug] Task 2's arm 1 call-count arithmetic contradicted its own Task 1**

- **Found during:** Task 2 (writing the default-stop arm)
- **Issue:** The plan's arm text says a permanent 503 on frame 2 gives `apiCalls === 3` (its comment counts "1 + 2 retries"), but Task 1 mandates a retry table of **two** retries — three attempts total. The observed count is 4 (1 for frame 1 + 3 attempts), which is also what the plan's own `--keep-going` arm implies when it counts the same failure as three calls (`1 + 3 + 1 = 5`).
- **Fix:** the arm asserts the observable truth (**4**), with a comment naming the arithmetic and why the plan's stated number was unreachable. **No implementation change** — the walk-mode code is exactly as specified.
- **Files modified:** `cli/commands/__tests__/anim.test.mjs`
- **Verification:** `api.calls.length === 4` passes; `--keep-going`'s `5` passes with the same script; mutating the retry table to 1 retry reddens the pair
- **Committed in:** `cf0cfad`

**3. [Rule 1 - Bug] A pipeline arm reused one bridge across two runs, summing their call counts**

- **Found during:** Task 2 (the `--redo` arm, `bridgeCalls` read 4 instead of 1)
- **Issue:** the first pass and the redo shared one `strictBridge`, whose `.calls` array accumulates — the assertion could not distinguish "the redo cut one strip" from "the redo cut everything".
- **Fix:** the redo gets its own bridge; `redoBridge.calls.length === 1` is now the statement about the second run alone.
- **Files modified:** `cli/commands/__tests__/anim.test.mjs`
- **Verification:** the arm passes; making `--redo` run the whole plan would read > 1
- **Committed in:** `cf0cfad`

---

**Total deviations:** 3 auto-fixed (3 bugs — one in the plan's own gate text, two in the test harness; none in shipped runner behaviour
beyond what the plan specifies).
**Impact on plan:** No scope creep and no relaxed assertion — deviation 1 was the only edit to a gate, it changed fixtures and not assertions, and it was authorized by the orchestrator after the contradiction was reproduced. Deviations 2–3 make the arms *able* to fail; both were confirmed by mutation.

## Issues Encountered

The first draft of the retry arm for the full pipeline (deviation 1's neighbour) ran under vitest fake timers to avoid the real 2s/8s waits. Those timers leaked into the sibling arms and nine unrelated tests timed out at 5 s each. Replaced with a deliberate test seam on the command spec (`retryDelays`), which the four unit arms do not touch — they assert the real table (`[2000, 8000]`) directly. The whole suite now runs in ~1.2 s.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 04-03 can build directly on this: `readLedger` already returns the parsed ledger (missing → empty, broken → `bad_ledger`) and the duplicate-key gate is in place, which is exactly the entry point its `facts` collection and `nextPending` wiring assume.
- The `--redo` key parsing is `parseStripKey` + plan membership, so 04-03's `nextPending({ redo })` receives an already-validated set.
- The retry table is a seam (`ctx.spec.retryDelays`) — an arm that wants to exercise backoff without the wall clock can set it, and the production default is asserted separately.

## Self-Check: PASSED

- `cli/lib/server.mjs` — FOUND (modified, `err.status` at `routeError`)
- `cli/commands/anim.mjs` — FOUND (modified)
- `cli/commands/__tests__/anim.test.mjs` — FOUND (modified)
- `docs/agent-api.md` — FOUND (modified)
- `c7482cb` — FOUND
- `7c28b06` — FOUND
- `cf0cfad` — FOUND
- Task 1 `<automated>` verbatim — `retry boundary ok`, exit 0
- Task 2 `<automated>` verbatim — `ledger plumbing ok`, exit 0

---

*Phase: 04-cli-runner*
*Completed: 2026-10-07*
