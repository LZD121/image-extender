---
phase: 04-cli-runner
plan: 03
subsystem: cli
tags: [node, esm, cli, resume, nextPending, aspect-ratio, full-decode, sharp, vitest, animSet]

# Dependency graph
requires:
  - phase: 04-cli-runner
    provides: "04-02's `readLedger` (missing → empty, broken → `bad_ledger`), the duplicate-key gate, `--redo` key parsing resolved against the plan, and the three walk modes — this wave replaces the *selection* of strips (plan walk → `nextPending`) and adds the two gates around it, not the ledger plumbing"
  - phase: 02-pure-core
    provides: "`nextPending` / `stripKey` / `planStrips` / `stripFile` / `frameFile` / `dirsForPreset` / `planSize` — the five-reason completion judgement is a pure function there; nothing here re-derives it"
  - phase: 03-strip-frames
    provides: "the `strip-frames` op whose verdict the ledger books — the aspect gate sits strictly before it, so a bad shape never reaches the cutter"
provides:
  - "`decodesAsImage(file)` in `cli/lib/media.mjs` — a FULL decode, because `metadata()` is a trap on truncated files (measured: 60% of the committed fixture still reports 2048x246 through `metadata()`, while the full decode throws `pngload: libspng read error`)"
  - "`collectFacts(spec, outRoot, record, mods)` — the resume facts, measured: `rawDecodable` from the full decode, `derivedCount` by counting `derived/<state>_f<N>_<dir>.png`"
  - "`nextPending` as the ONLY completion judgement: the `--go` loop walks `pending[]` (five reasons), and an empty `pending` returns zero calls with `0 to do, N/M done`"
  - "`ASPECT_TOLERANCE = 0.05` + `aspectMismatch`/`aspectNote` — a wrong-shaped reply is `ok:false`, keeps its raw, and never reaches the op (zero derived files)"
affects: [05, 06]

actuals:
  tokens: 6090
  tasks: 2
  commits: 2
  plan_head_before: e4de988eb09646542822a48d409b2800e8194767

tech-stack:
  added: []
  patterns:
    - "the CLI collects facts and the pure module judges: `nextPending` decides what is pending, the command is not allowed a second rule"
    - "a gate that rejects shapes, not drift — the tolerance is a named constant with the measured norm (3.977% / 4.065%) on its PASS side and the absurd side (87.50% / 70.83%) on its FAIL side"
    - "the paid-for evidence lands before any gate that could refuse it: raw first, aspect check second, cutter third"
    - "a decision must be readable: every pending strip's note names its `reason`"

key-files:
  created: []
  modified:
    - cli/commands/anim.mjs
    - cli/lib/media.mjs
    - cli/commands/__tests__/anim.test.mjs

key-decisions:
  - "`decodesAsImage` is a full `sharp(file).raw().toBuffer()`, not `metadata()`: the header read is exactly how the consumer's ledger got 17 rows for 16 strips. The trap is pinned as an assertion (same truncated file: `imageSize().width === 2048` AND `decodesAsImage() === false`), so a future sharp that sees truncation reddens the arm as 'the trap no longer exists' instead of silently hollowing out the fact"
  - "`ASPECT_TOLERANCE = 0.05` and not tighter: the pipeline's own normal output drifts 3.977% (Phase 1's 2928x352 probe) to 4.065% (the committed 2048x246 fixture, which 04-01's pipeline arm uses) — a tighter number would refuse the norm. 0.05 is the one constant; the flip points are 0.0407 (fixture arm) and 0.7083 (21:9 arm), so both directions falsify"
  - "the ratio gate sits AFTER the atomic raw write and BEFORE `ctx.bridge`: raw is the only paid-for evidence and spec §8 keeps it on every failure line, while cutting a wrong shape would 'fix' it (R1) and land 8 plausible cells in `derived/`"
  - "the CLI never grew a second completion rule — the loop iterates `nextPending(...).pending` and the reasons drive the notes; `entry.ok && …` appears nowhere in the module (asserted in the gate)"
  - "an empty `pending` is a success with ZERO calls, not a log line claiming it skipped: `written: []`, summary `0 to do, N/M done`"
  - "`collectFacts` takes `record` per the plan's signature even though this wave reads only the filesystem — the facts are about disk, the record is consulted by `nextPending`, and keeping the signature makes the caller's two inputs explicit"

patterns-established:
  - "resume arms are written as a first pass + a targeted mutation (truncate the raw / delete one derived file / flip a row to `ok:false`) + a second pass asserting `apiCalls === 1` and the reason in the note — mutation-confirmed (each arm reddens under the corresponding implementation change)"
  - "the tolerance is tested from both sides in one file: three measured-shape PASS arms and two absurd-shape FAIL arms"

requirements-completed: [GEN-04, TRAN-02]

coverage:
  - id: D1
    description: "`decodesAsImage` decodes a whole file; a truncated PNG that `metadata()` still reads as 2048x246 is false, and an empty file is false rather than a throw"
    requirement: GEN-04
    verification:
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#fully decodes a whole file, and refuses a truncated one that metadata() still reads"
        status: pass
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#answers false for an empty file instead of throwing"
        status: pass
      - kind: integration
        ref: "task 1 gate: `decode facts ok` (the block's own node script, run verbatim — fixture true, truncated false, `imageSize(trunc).width === 2048`, empty false)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The resume decision is `nextPending` and nothing else: `collectFacts` measures the raw's full decode and the derived count, the loop walks `pending[]`, and each note names its reason"
    requirement: GEN-04
    verification:
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#exercises all five reasons across a first pass, a resumed pass and a --redo"
        status: pass
      - kind: integration
        ref: "task 2 gate: `resume plumbing ok` (the source assertions — `/nextPending\\(/` present, `collectFacts` + `decodesAsImage` + `ASPECT_TOLERANCE` present, `/entry\\.ok\\s*&&/` ABSENT)"
        status: pass
      - kind: integration
        ref: "live CLI against a truncated raw with a dead base URL: stderr reads `[1/1] idle:0 · raw-unreadable → redo 4096x512`"
        status: pass
    human_judgment: false
  - id: D3
    description: "A complete set costs zero calls on a second pass: `apiCalls === 0`, `bridgeCalls === 0`, `written: []`, summary `0 to do, N/M done`"
    requirement: GEN-04
    verification:
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#makes a second pass over a complete set cost ZERO calls"
        status: pass
      - kind: integration
        ref: "live CLI, complete set + dead base URL: `{\"ok\":true,\"summary\":\"anim set complete — 0 to do, 1/1 done\",\"written\":[]…}`, exit 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "A truncated raw, a short derived set and a recorded failure each redo exactly that strip (`apiCalls === 1`), and the raw/derived/row comes back"
    requirement: GEN-04
    verification:
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#redoes one strip whose raw is truncated, and only that one"
        status: pass
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#redoes one strip whose derived set is short by a frame"
        status: pass
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#redoes a strip the record says failed, and the row comes back ok"
        status: pass
    human_judgment: false
  - id: D5
    description: "A wrong-shaped reply is refused before the cutter: `ok:false`, `bridgeCalls === 0`, zero derived files, raw kept, both ratios in the note"
    requirement: TRAN-02
    verification:
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#refuses an absurd return without cutting it (1:1 against 8:1, 87.50% off)"
        status: pass
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#refuses an absurd return without cutting it — `strips[0].returned !== strips[0].requested` (an echo implementation reddens)"
        status: pass
    human_judgment: false
  - id: D6
    description: "`ASPECT_TOLERANCE = 0.05` is exercised on both sides: the measured norm (0.392% / 3.977% / 4.065%) passes and is cut; the absurd shapes (1:1 = 87.50%, 21:9 = 70.83%) are refused"
    requirement: TRAN-02
    verification:
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#passes the normal drift this pipeline actually produces (4096x510, 2928x352, 2048x246 — all ok:true with bridge.calls === 1)"
        status: pass
      - kind: integration
        ref: "cli/commands/__tests__/anim.test.mjs#refuses both ends of the absurd side (2048x2048 and 4096x1755 — ok:false, zero bridge calls, zero derived)"
        status: pass
      - kind: integration
        ref: "task 2 gate: `reason coverage ok` (the arm file names the measured shapes: 4096x510 / 2928x352 / 2048x246 / 2048x2048)"
        status: pass
    human_judgment: false

# Metrics
duration: 6 min
completed: 2026-10-08
status: complete
---

# Phase 4 Plan 03: resume facts, the aspect gate, and `nextPending` as the only completion judgement Summary

**Resuming is now measured rather than assumed — `decodesAsImage` full-decodes each raw (a truncated PNG is not "done"), `collectFacts` counts the derived frames, `nextPending` is the only thing that decides what is pending, and a wrong-shaped reply is refused with its raw kept and zero cells cut.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-07T17:06:40Z
- **Completed:** 2026-10-07T17:12:28Z
- **Tasks:** 2
- **Files modified:** 3 (0 created, 3 modified)

## Accomplishments

- The trap is an assertion, not a comment. `metadata()` reads only the header: the committed fixture truncated to 60% still reports `2048x246` there, while `sharp(file).raw().toBuffer()` throws `pngload: libspng read error`. `decodesAsImage` wraps the full decode, and the arm asserts **both** facts on the *same* truncated file — so the day sharp learns to see truncation the arm reddens as "the trap no longer exists" rather than quietly hollowing out `rawDecodable`.
- Completion is `nextPending`'s alone. `collectFacts` measures (full decode + derived count), the `--go` loop walks `pending[]`, and `entry.ok && …` appears nowhere in `cli/commands/anim.mjs` — the module collects facts and obeys. All five reasons are exercised: `missing` on a first pass, then `not-ok` / `raw-unreadable` / `derived-short` in a resumed pass, and `redo` under `--redo`. Each one shows up in the stderr note (`[1/1] idle:0 · raw-unreadable → redo 4096x512`), so the operator can argue with the decision.
- The acceptance shape of a resumed run is measured as **zero calls**, not narrated: over a complete set the second pass returns `apiCalls === 0`, `bridgeCalls === 0`, `written: []` and `anim set complete — 0 to do, 3/3 done`. The live CLI confirms it against a dead base URL (exit 0, no note at all).
- The three real interruptions each redo exactly one strip: truncating a raw (`raw-unreadable`), deleting one derived frame (`derived-short`), and flipping a ledger row to `ok:false` (`not-ok`) all read `apiCalls === 1` — and in the truncation arm the raw bytes come back equal to the fixture.
- The aspect gate refuses **shapes**, not drift. `ASPECT_TOLERANCE = 0.05` passes this pipeline's own normal output — 4096x510 (0.392%), 2928x352 (3.977%, Phase 1's probe) and 2048x246 (4.065%, the committed fixture, which 04-01's pipeline arm also feeds) — and refuses 2048x2048 (87.50%) and 4096x1755 (70.83%) with `bridgeCalls === 0`, zero derived files, and the raw kept. The echo-implementation arm (`returned !== requested`) is in the same test.
- The refusal sits in the right place: after the atomic `raw/` write (paid-for evidence survives) and before `ctx.bridge` (cutting a wrong shape would "fix" it into 8 plausible cells — R1).

## Task Commits

Each task was committed atomically:

1. **Task 1: `decodesAsImage` — full decode, `metadata()` trap pinned** - `6336792` (feat)
2. **Task 2: `collectFacts` + the aspect gate + `nextPending`-driven pending** - `dd4d730` (feat)

**Plan metadata:** `8479c7d` (docs: complete plan)

## Files Created/Modified

- `cli/lib/media.mjs` — `decodesAsImage(file)`: one full decode in a `try/catch`, returning a boolean. `imageSize` / `dataUrlSize` / `writeFileAtomic` / `writeDataUrl` / `saveImage` / `writeManifest` untouched (16 lines added).
- `cli/commands/anim.mjs` — `ASPECT_TOLERANCE` + `aspectMismatch` + `aspectNote` at the top; `collectFacts`; `runStrips` rewritten around `nextPending`'s `pending[]` with the reason in every note and the ratio gate between raw and the op.
- `cli/commands/__tests__/anim.test.mjs` — 10 new arms across three describes (`resume facts`, `the resume gate`, `the aspect gate`), plus the 04-01 unwritable-raw arm adapted to leave a genuinely pending strip.

## Decisions Made

- **`decodesAsImage` is a full decode and the cost is documented.** `metadata()`-based facts would be cheap and wrong; the docblock records the measurement and names the consumer's 17-rows-for-16-strips ledger as what it buys.
- **The tolerance is one number with both flip points known.** 0.05 is not "a big number that passes": the norm reaches 0.0407 (the fixture arm) so a tighter constant reddens the pipeline's own output, and the absurd side starts at 0.7083 so a looser one admits a 21:9 squash. Mutations confirm both directions.
- **The CLI has no completion rule.** Facts are collected; `nextPending` judges. `--redo` keys still go through `parseStripKey` + plan membership first (04-02), then ride into `nextPending({ redo })` so the redo reason is the module's.
- **A complete set returns the ledger, not an empty plan.** `strips: load.strips` and `written: []` — a resumed run that had nothing to do reports what is already paid for, without rewriting the file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 04-01's unwritable-raw arm could no longer reach the code path it tests**

- **Found during:** Task 2 (adding the resume gate made the arm fail with `extra is not iterable` and then a resolved promise)
- **Issue:** The arm ran a full pass, then made `<out>/raw` read-only and re-ran, expecting the atomic write to throw. With the resume gate in place the second pass correctly saw a **complete** set and made zero calls — so nothing touched `raw/` and there was nothing to throw. The arm was asserting 04-01's pre-resume behaviour, which this wave deliberately replaced.
- **Fix:** The arm now truncates the strip's raw before locking the directory, so the strip is genuinely `raw-unreadable` and the resumed run must attempt the write. Assertions unchanged (`tempsIn(out) === []`, `derivedNames(out).length === before`, raw still present); the test's *subject* — a failed atomic write leaves nothing half-written — is untouched.
- **Files modified:** `cli/commands/__tests__/anim.test.mjs`
- **Verification:** the arm passes; it is the only arm that runs against a read-only directory, and it still fails if `writeFileAtomic` loses its temp cleanup
- **Committed in:** `dd4d730`

**2. [Rule 1 - Bug] Two test helpers had argument-shape slips introduced while writing this wave's arms**

- **Found during:** Task 2 (first run of the new describes)
- **Issue:** `runOnce(out, file, extra = {})` spread a plain options object (`...extra`) into the argv array → `TypeError: extra is not iterable`; and the aspect describe carried an unused `one()` helper whose `extra.flags` default was never exercised.
- **Fix:** `...(extra.flags || [])`; the unused helper was left as a thin wrapper and then removed when no arm used it (no dead code left behind).
- **Files modified:** `cli/commands/__tests__/anim.test.mjs`
- **Verification:** the file runs 41/41 green
- **Committed in:** `dd4d730`

---

**Total deviations:** 2 auto-fixed (2 bugs, both in the test harness; one of them the expected consequence of this wave changing what a second pass means).
**Impact on plan:** No scope creep and no relaxed assertion. Deviation 1 is the direct, intended effect of the resume gate — 04-01's arm was adapted to the new contract, not weakened.

## Issues Encountered

The plan's Task 2 text says a failed strip is "booked `ok:false` and stops the run by default", and this wave keeps that. What changed is only *which* strips are attempted: the walk modes now apply to `pending[]`, so a run that hits a permanently failing strip records it and stops, and the **next** run re-selects it as `not-ok` rather than skipping it. That is the loop GEN-04 asked for, and it is why the `--keep-going` ledger arm still reads 3 rows, exactly one `ok:false`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- GEN-04 and TRAN-02 are closed: resume is measured (full decode + derived count through `nextPending`), the second pass over a complete set is zero calls, and a wrong-shaped reply is refused before the cutter with its raw kept.
- Phase 5 (`AssetKind = 'animations'`, library save) consumes `derived/` + `set.json` and never `raw/` — that split is now enforced by the fact that a truncated raw is a *pending* strip, not a completed one.
- The tolerance is a single exported-by-name constant in the module; whoever needs to tighten it must first move the 2048x246 fixture arm and 04-01's pipeline arm, which is the intended friction.

## Self-Check: PASSED

- `cli/lib/media.mjs` (modified, `decodesAsImage`) — FOUND
- `cli/commands/anim.mjs` (modified, `collectFacts` / `ASPECT_TOLERANCE` / `nextPending` wiring) — FOUND
- `cli/commands/__tests__/anim.test.mjs` (modified) — FOUND
- `6336792` — FOUND
- `dd4d730` — FOUND
- Task 1 `<automated>` verbatim — `decode facts ok`, exit 0
- Task 2 `<automated>` verbatim — `resume plumbing ok` + `reason coverage ok`, exit 0 (includes `npm test` 416/416 and `npx tsc --noEmit` exit 0)

---

*Phase: 04-cli-runner*
*Completed: 2026-10-08*
