---
phase: 04-cli-runner
plan: 04
subsystem: cli
tags: [node, esm, cli, audit-closure, double-charge, provenance, ledger, redo, vitest, nyquist]

# Dependency graph
requires:
  - phase: 04-cli-runner
    provides: "the three wave plans (04-01 command surface, 04-02 retry + walk modes + ledger, 04-03 resume facts + aspect gate) and the two audits that ran against them: `04-REVIEW.md` (3 critical / 5 warning / 3 info, every finding measured) and `04-VALIDATION.md` (9/10 covered, CLI-01 uncovered)"
provides:
  - "a booked post-generation failure — `toDataUrl`/`dataUrlSize` can no longer escape the per-strip loop, so a strip that was paid for always has a ledger row and a resume never re-buys it (CR-01)"
  - "`--redo k` that walks only the named strips (CR-02) — the union `nextPending` returns stays inside the module as the reason machinery, and the CLI narrows it before spending"
  - "a ledger that records the model the run actually asked for, `--model` included (CR-03)"
  - "a ledger that survives a shrunk spec: rows the current plan no longer names are carried forward as orphans instead of being dropped while their bytes stay on disk (WR-04)"
  - "two suite arms for the Nyquist gaps: the `anim` registration in `cli/ie.mjs` (CLI-01) and 'one strip refused by the op costs exactly one POST' (GEN-06)"
affects: [05, 06]

actuals:
  tokens: 0
  tasks: 0

# Audit closure — an authorized post-audit gap-closure pass, not a planned wave
---

# Phase 4 Plan 04: Audit closure Summary

**Two audits ran after the three waves, and both found real defects that the plans'
own gates could not see. This pass closes them. It is not a planned wave: it edits
`cli/commands/anim.mjs` and `cli/commands/__tests__/anim.test.mjs` outside the plans'
declared `files_modified`, deliberately and with the orchestrator's authorization.**

## What closed, and the evidence that it is closed

Every item below is demonstrated **red without the fix, green with it** — the mutation
probe reverted all three source fixes at once and exactly three arms went red
(45 passed / 3 failed), then the fixes were restored and the file went 48/48.

| Finding | Fix | Arm | Before → after |
|---|---|---|---|
| **CR-01** (critical, money) — a post-generation failure escaped the ledger: no row for a strip that was paid for, the run dead even under `--keep-going`, the orphaned `raw/` unusable, and the next run bought it again | both post-generation steps are booked the way the retry-exhausted and `meta.ok:false` branches already were; the raw is kept (spec §8) and the note names the key | `describe('… a paid-for strip that cannot be decoded is booked, not lost')`, two arms | `run 1: calls=2, rows=[idle:0 ok=true]` → rows `[ok, ok:false]`; `run 2: calls=1` → `calls=1` re-buying strip 1 as `not-ok`, never as `missing` |
| **CR-02** (critical, regression introduced by 04-03) — `--redo k` re-ran every pending strip, contradicting the flag's docblock, `docs/agent-api.md` and 04-02's own implementation | `nextPending`'s union is narrowed to the named keys before the walk; the trailing note names the count actually walked | `… does not quietly run the other strips still pending when a redo names one` | measured `calls: 2`, notes naming `idle:1` **and** `idle:2` → `api2.calls === 1`, no note for `idle:2` |
| **CR-03** (critical, provenance) — `set.json` recorded the spec's model, so `--model` was invisible to Phase 5/6, the only readers of the ledger | `resolveSpec` carries the resolved model into the spec the ledger is built from; `planStrips`/`buildStripPrompt` still ignore the field | `… the ledger records the model the run actually asked for` | `body.model=OVERRIDE-MODEL` / `set.backend.model=SPEC-MODEL` → both `OVERRIDE-MODEL` |
| **WR-04** (warning, money-adjacent) — `commit` re-derived rows as `plan.map(...)`, so a shrunk spec dropped paid-for rows from `set.json` while their bytes stayed on disk | the ledger rewrite is lossless: rows the plan no longer names are carried forward as orphans, after the planned rows | `… the ledger survives a shrunk spec` | `pass 2 rows: [idle:0]`, `derived: 24 files still on disk` → 3 rows survive, frames `[0, 1, 2]` |
| **CLI-01** (Nyquist: uncovered) — deleting the `anim` registration from `cli/ie.mjs` left all 416 tests green | — (registration was already correct; the *guard* was missing) | `ie — the anim command is registered` runs the real `node cli/ie.mjs help` / `help anim` | suite green with the registration deleted → red |
| **GEN-06** (Nyquist: unguarded) — "the retry wraps the generation call only" rested on a source regex, so an extra paid call injected after an op-level `ok:false` survived 41/41 | — (behaviour was already correct; the *arm* was missing) | `… an op failure buys nothing more` | suite green with an injected extra `ctx.api('generate')` → red on `api.bodies.length === 1` |
| **IN-01** (info) — the `plan`/dry-run refusals were implemented but unasserted, and the arm's name promised the opposite of what it checked | the arm now drives the handler and asserts the refusal | same arm, three `rejects.toThrow` assertions | a dropped guard in the handler reddened nothing → red |
| **IN-02** (info) — an unused `one()` helper survived the `--keep-going` rewrite | deleted | — | — |
| **WR-03** (warning) — `collectFacts` took a `record` argument it never read | parameter and call-site argument dropped | — | dead parameter + misleading contract → gone |
| **WR-05** (warning) — the module docblock claimed the dry path touches no filesystem, but a cold `plan` writes the esbuild bundle cache | narrowed to what is true (no output path, no server, no network; `.ie/` cache is the only file, and the zero-write arms cover the output root and the seams, not it) | — | false claim → bounded claim |

## Deliberately NOT closed

- **WR-01** (`providerFor` labels an unresolvable profile `openrouter`). The server
  rejects an unknown profile outright, so the run would fail before writing — but the
  *plan payload* would name a provider that is not the one it would have asked. The
  honest fix is a contract change to the plan payload (`provider: null` +
  `providerWarning`), which no plan specified; guessing at a payload shape is worse
  than the current lie. Left for a phase that owns the plan payload's contract.
- **WR-02** (an undecodable gateway reply is enveloped as `code: 'error'` rather than a
  named `bad_image`). CR-01's fix already makes the failure *booked* and names the strip
  key; the remaining work is an error-code taxonomy across `toDataUrl`/`dataUrlSize`,
  which wants its own arm per code. Advisory only.
- **IN-03** (`nextPending`'s duplicate check is unreachable because the load already
  refuses a repeated key). Belt-and-braces, confirmed harmless; annotating it is a
  comment-only change with no behaviour to pin.

## Deviations

1. **Rule — authorized post-audit gap closure.** This pass edits
   `cli/commands/anim.mjs` and its test file outside every plan's declared
   `files_modified`. The orchestrator authorized it after `04-REVIEW.md` and
   `04-VALIDATION.md` (both committed before this pass) named defects the plans' gates
   could not see. Commit `262d558`; CR-01 landed separately as `87648a0`.
2. **A first attempt at this pass was interrupted** (provider quota) *after* landing
   CR-01 but before committing the other two source fixes, and it had reverted the
   working tree to build per-finding commits. CR-02/CR-03 were re-applied from the
   review text, and their arms re-written. Recorded because the interruption is why
   the commits are grouped as they are rather than one per finding.
3. **The CR-01 arm's ticket wording was not followed literally.** The ticket said the
   second run must show `calls === 0`; that contradicts GEN-04 / spec §8, where a
   strip booked `ok:false` stays pending and is finished by a resume or `--redo`. The
   arm asserts the invariant that actually holds — the second run books it from the
   ledger as `not-ok` and buys exactly one strip, never re-reading it as `missing`.

## Self-Check: PASSED

- `npx vitest run cli/commands/__tests__/anim.test.mjs` → 48/48
- `npm test` → 423/423 · `npm run test:cli` → 17/17 · `npx tsc --noEmit` → exit 0
- Mutation probe: three source fixes reverted → exactly 3 arms red, 45 green; restored → 48/48
