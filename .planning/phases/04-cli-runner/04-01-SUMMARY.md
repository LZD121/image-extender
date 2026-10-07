---
phase: 04-cli-runner
plan: 01
subsystem: cli
tags: [node, esm, cli, atomic-write, dry-run, vitest, sharp, animSet, animStrip]

# Dependency graph
requires:
  - phase: 02-pure-core
    provides: "`validateAnimSetSpec` / `planStrips` / `stripFile` / `frameFile` / `buildSetJson` / `stripKey` / `dirsForPreset` — spec judgement, naming and the ledger shape, none of it re-implemented here"
  - phase: 03-strip-frames
    provides: "the `strip-frames` bridge op (one strip → N frames) and its measured `meta`: fitted {255, 253}, field #FD05FA cast 245, counters keyed 8 / centred 8"
provides:
  - "`ie anim plan` / `ie anim run [--go]`: the command surface, the plan renderer, and --go as the only switch into the generation path"
  - "`writeFileAtomic` in `cli/lib/media.mjs` — one temp+rename write path, shared by raw/derived/set.json and (via `writeDataUrl`) every studio/pixel land path"
  - "the serial single-strip pipeline: generate → atomic raw → `strip-frames` → per-frame atomic derived/ → atomic set.json ledger"
  - "an browser-free, network-free vitest gate that proves the money path with two in-process seams"
affects: [04-02, 04-03, 05, 06]

actuals:
  tokens: 9757
  tasks: 3
  commits: 3
  plan_head_before: 6a51339a3f7349c173217c60aacde7affb7cd301

tech-stack:
  added: []
  patterns:
    - "one function renders the plan, so dry-run equivalence is identity rather than agreement between two renderers"
    - "atomic write as a single home (`writeFileAtomic`) that every landing path inherits"
    - "seam counters as the proof of 'no calls' — the fakes count and throw, never a source grep"

key-files:
  created:
    - cli/commands/anim.mjs
    - cli/commands/__tests__/anim.test.mjs
  modified:
    - cli/lib/media.mjs
    - cli/ie.mjs
    - docs/agent-api.md

key-decisions:
  - "--keep-going / --redo stay undeclared this wave: strict parse refuses them, which is honest, where a declared-but-ignored flag would let `--redo idle:2` silently run the whole set"
  - "the ledger is merged by `stripKey` from day one, so re-running a strip replaces its row instead of appending a second one (the consumer's 17/16 duplication)"
  - "`requested` comes from the request canvas and `returned` from the bytes on disk, so a gateway that answers a different size is booked as such"
  - "`writeManifest` stays non-atomic — its output is a human-facing artifact, not a resume input (recorded in its docblock)"
  - "an op-level `meta.ok:false` is bookkept and stops the run; every other failure throws (retry/keep-going/redo belong to the next wave, and a retry must never wrap the whole pipeline)"

patterns-established:
  - "dry paths are proven twice: in-process seam counters of 0 AND a live CLI against a dead port"
  - "fakes assert the shape they receive, so a stub that accepts anything cannot leave an interface unguarded"

requirements-completed: [GEN-01, GEN-02, CLI-01, CLI-02]

coverage:
  - id: D1
    description: "`ie anim plan` prints each strip's canvas, the call count, the total and the output root, and makes zero calls and zero writes"
    requirement: GEN-01
    verification:
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#plans without a single seam invocation and without a single write"
        status: pass
      - kind: integration
        ref: "task 2 gate: IE_BASE_URL=http://127.0.0.1:1 ie anim plan --spec … --json → exit 0, plan.length 8, calls 8, cells 64, canvas 4096x512, out absolute, !existsSync(out)"
        status: pass
    human_judgment: false
  - id: D2
    description: "`ie anim run` without --go prints exactly what `plan` prints, byte for byte"
    requirement: GEN-02
    verification:
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#makes a dry run say exactly what plan says"
        status: pass
      - kind: integration
        ref: "task 2 gate: diff of plan.json vs dry.json — identical"
        status: pass
    human_judgment: false
  - id: D3
    description: "`ie anim plan|run` is registered with `ie help anim` and both subcommands answer through `okEnvelope` (plan array / run {written, strips, setJson})"
    requirement: CLI-01, CLI-02
    verification:
      - kind: integration
        ref: "node cli/ie.mjs help anim → exit 0, contains `ie anim plan` and `ie anim run` and `--go`; `ie help` command table lists `anim`"
        status: pass
      - kind: integration
        ref: "task 2 gate: `anim` with no subcommand exit 2; `anim plan --go` exit 2 with `plan never spends`; `anim run --keep-going` exit 2 (strict parse)"
        status: pass
    human_judgment: false
  - id: D4
    description: "One strip's pipeline lands completely: atomic raw → op → derived/<state>_f<N>_<dir>.png per direction → atomically rewritten <out>/set.json"
    verification:
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#writes the raw reply, then one derived frame per direction in preset order"
        status: pass
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#books what came back, not what it asked for"
        status: pass
    human_judgment: false
  - id: D5
    description: "Atomic write is one home: `writeFileAtomic` succeeds on an existing file, throws on a directory or an unwritable parent, and leaves no temp behind either way"
    verification:
      - kind: unit
        ref: "task 1 gate: media atomic-write ok (round-trip bytes, no temp on success, replace-file succeeds, directory throws, unwritable parent throws, failure leaves neither temp nor target)"
        status: pass
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#lets an unwritable raw/ fail loudly, with nothing half-written"
        status: pass
    human_judgment: false
  - id: D6
    description: "Spec errors point at the offending field and happen before any call (both sources through one validator)"
    verification:
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#reports the offending field and never calls out"
        status: pass
      - kind: unit
        ref: "cli/commands/__tests__/anim.test.mjs#takes a spec from inline flags and reaches the same plan"
        status: pass
    human_judgment: false

# Metrics
duration: 8 min
completed: 2026-10-08
status: complete
---

# Phase 4 Plan 01: `ie anim` command surface, `--go` gate, and the atomic single-strip pipeline Summary

**`ie anim plan|run` lands with `--go` as the only spending switch, one shared plan renderer, and a serial generate → atomic raw → `strip-frames` → derived/ → atomic `set.json` pipeline — proven by two in-process seams, so the gate spends nothing, opens no browser and never touches the network.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-10-07T16:20:19Z
- **Completed:** 2026-10-08T00:25Z
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `writeFileAtomic` (sibling temp → `renameSync`, temp cleaned on failure) is now the CLI's single landing path; `writeDataUrl` decodes before touching disk and calls it, so studio/pixel land paths inherit the fix instead of a second copy of temp+rename appearing beside it (R7's root cause).
- `ie anim plan|run` exists, registers in the command table, and answers `ie help anim`. `plan` and a dry `run` return the *same function's* output — GEN-02's equivalence is identity, and the live CLI proves it byte-for-byte under a dead base URL.
- The `--go` gate is enforced by behaviour: `plan --go` is a usage error ("plan never spends"), `run` without it makes zero seam calls and creates no directory, and `--keep-going` / `--redo` stay undeclared so strict `parseArgs` refuses them rather than ignoring them.
- One strip runs the whole pipeline: generation with `profile`/`model` **in the body**, atomic `raw/` before any post-processing, `strip-frames` fed the *file path*, one atomic write per derived frame in `dirsForPreset` order, and an atomic rewrite of `<out>/set.json` merged by `state:frame`.
- The ledger records observation, not echo: the stub answers a 4096×512 request with the committed 2048×246 fixture, and `set.json` says `requested:'4096x512'` / `returned:'2048x246'`.

## Task Commits

Each task was committed atomically:

1. **Task 1: `cli/lib/media.mjs` atomic write** - `d1148fe` (feat)
2. **Task 2: `cli/commands/anim.mjs` + registration + docs** - `a956a90` (feat)
3. **Task 3: `cli/commands/__tests__/anim.test.mjs`** - `9ba3c02` (test)

**Plan metadata:** (this commit) (docs: complete plan)

## Files Created/Modified

- `cli/commands/anim.mjs` — the command family (351 lines): spec loading from both sources through one validator, the plan renderer, the `--go` gate, and the serial single-strip pipeline with the atomic ledger rewrite.
- `cli/lib/media.mjs` — `writeFileAtomic` added; `writeDataUrl` now decodes then delegates (28 lines changed).
- `cli/commands/__tests__/anim.test.mjs` — the gate (494 lines, 16 arms): counted zero-call seams, the `--go` gate, the full single-strip landing, spec errors by field, inline-equals-file, `--out` override, and the read-only-`raw/` failure arm.
- `cli/ie.mjs` — one registration line in `COMMAND_MODULES`.
- `docs/agent-api.md` — the two `ie anim` rows plus the spec-source / ledger / global-flag paragraph.

## Decisions Made

- **The ledger merges from day one.** `stripKey` keys a Map, so a re-run replaces a row; the consumer's 17-rows-for-16-strips bug came from appending, and duplicating that shape would have been free to avoid here.
- **`--keep-going` / `--redo` are not declared.** A flag that parses but is ignored turns `--redo idle:2` into a silently full-priced run; a usage error is the honest state until 04-02 implements them.
- **`plan --go` is refused with the reason in the message**, because silently ignoring it turns "I *did* pass --go" into a misunderstanding about whether money was spent.
- **Failures stay plain this wave:** an op-level `meta.ok:false` is booked `ok:false` and stops the run (with the raw kept); everything else throws. Retry/backoff wrap the generation call only — never the pipeline, which would pay twice.
- **`writeManifest` deliberately stays non-atomic** (docblock note): it is a human-facing旁证, not a resume input; it gets the treatment when it has a second reader.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `forbidden()` seam spy lost its counter through the `||` default**

- **Found during:** Task 3 (writing the gate's zero-call arms)
- **Issue:** `ctxFor` built its seam default as `seams.api || forbidden(…)`, so when I started passing plain counter objects (`{ count: 0 }`) for the zero-call arms the `||` fell through and handed the command a real throwing stub with no reader — the counter could never be observed. The gate would then have asserted nothing.
- **Fix:** `forbidden(counter, what)` takes the caller's counter object and increments it; the arms pass named `apiCalls` / `serverCalls` / `bridgeCalls` counters and read `.count`. The fakes now throw *and* count, so "was it touched?" and "how many times?" are the same observation.
- **Files modified:** `cli/commands/__tests__/anim.test.mjs`
- **Verification:** the arm reads `apiCalls.count === 0 && serverCalls.count === 0 && bridgeCalls.count === 0`; the file-level gate also asserts the literals `apiCalls` and `serverCalls` exist, so a grep-the-source regression cannot pass.
- **Committed in:** `9ba3c02`

**2. [Rule 1 - Bug] The stub gateway answered instantly, so `seconds` booked as `0`**

- **Found during:** Task 3 (the ledger arm asserting `seconds > 0`)
- **Issue:** `stubApi` resolved synchronously, so `(Date.now() - started) / 1000` was genuinely `0`. The assertion was real — a run whose wall clock reads 0 is not a run — but the stub, not the runner, was the cause.
- **Fix:** the stub awaits 5 ms, standing in for a generation that really takes seconds; the runner is untouched.
- **Files modified:** `cli/commands/__tests__/anim.test.mjs`
- **Verification:** `strip.seconds > 0` passes with the delay and would fail without it.
- **Committed in:** `9ba3c02`

---

**Total deviations:** 2 auto-fixed (2 bugs — both in the test harness, none in shipped code)
**Impact on plan:** No scope creep, no shipped-behaviour change. Both fixes made the gate *able* to fail; the runner itself executed as written.

## Issues Encountered

Three assertions in the first draft of the gate encoded my expectation rather than the code's contract, and were corrected to the contract (not the reverse): `set.frames[].file` is the repo-relative `derived/<name>.png` path that Phase 2's `frameFile` produces; the filesystem enumerates `derived/` lexicographically, so direction *order* is proven by the ledger's `frames[]` rows rather than a directory listing; and `--profile` is a **global** flag that `ie.mjs` strips before the command's strict parse, so the test passes it through the context seam instead of as a command flag.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The single-strip pipeline is complete; 04-02 adds discipline to it (retry/backoff around the generation call only, `--keep-going`, `--redo`, uniqueness assertion) and 04-03 adds resume facts and the aspect gate — neither needs to rewrite what landed here.
- `writeFileAtomic` is in place, so 04-02/04-03 inherit the atomicity rather than re-deriving it.
- The gate's stub op returns the committed 2048×246 fixture against a 4096×512 request — a 4.065% drift, inside the `ASPECT_TOLERANCE = 0.05` that 04-03 will introduce. Whoever tightens that tolerance below 5% will redden this arm, which is the point.

## Self-Check: PASSED

- `cli/commands/anim.mjs` — FOUND
- `cli/commands/__tests__/anim.test.mjs` — FOUND
- `cli/lib/media.mjs` (modified) — FOUND
- `d1148fe` — FOUND
- `a956a90` — FOUND
- `9ba3c02` — FOUND

---

*Phase: 04-cli-runner*
*Completed: 2026-10-08*
