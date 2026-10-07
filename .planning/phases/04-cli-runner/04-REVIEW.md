---
phase: 04-cli-runner
reviewed: 2026-10-07T17:44:38Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - cli/commands/__tests__/anim.test.mjs
  - cli/commands/anim.mjs
  - cli/ie.mjs
  - cli/lib/media.mjs
  - cli/lib/server.mjs
  - docs/agent-api.md
findings:
  critical: 3
  warning: 5
  info: 3
  total: 11
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-10-07T17:44:38Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Scope was `git diff 6a51339..HEAD` minus planning artifacts: `cli/commands/anim.mjs` (new, 611 lines),
`cli/commands/__tests__/anim.test.mjs` (new, 1116 lines), `cli/lib/media.mjs` (+44),
`cli/lib/server.mjs` (+7), `cli/ie.mjs` (+1 registration line), `docs/agent-api.md` (+27).

Reviewed against what the phase is *for*: a spend gate that cannot leak, a retry boundary that cannot
buy a second image, one completion judgement, and an aspect tolerance that refuses shapes without
refusing the pipeline's own output. Every finding below was reproduced by running the shipped code
against a stub gateway in this repo, not inferred from the summaries.

What holds up, verified rather than asserted: the retry wrapper genuinely wraps exactly the POST
(`anim.mjs:435-445`) and the tests observe the boundary from two independent angles (call counts plus
the `bridgeCalls === 1` reading); `routeError` owns the HTTP status on the error object
(`server.mjs:189-195`) and the arm at `anim.test.mjs:271-289` is a real regression for the
`detail.status` bug; `nextPending` is the only completion judgement — `grep` finds no `entry.ok`
re-derivation in `anim.mjs`; `decodesAsImage` (`media.mjs:80-87`) really does separate a truncated PNG
from `metadata()` (confirmed: `metadata()` reports 2048x246 on a 60%-truncated file while the full
decode throws `pngload: libspng read error`); and all writes on the anim path go through
`writeFileAtomic`. The `--go` gate is real for `plan`: it refuses `--go`/`--keep-going`/`--redo`
(exit 2, verified through the real CLI).

Three defects are worth blocking on. The headline is CR-01: a second post-generation failure class
(post-processing, not generation) escapes the per-strip ledger entirely, aborts the whole run even
under `--keep-going`, and leaves paid-for bytes on disk that the next run buys again. CR-02 and CR-03
are the two "the plan is the only key source" gaps.

## Critical Issues

### CR-01: A post-generation failure aborts the run and loses the paid-for strip — the next run buys it again

**File:** `cli/commands/anim.mjs:466` (and `:473`, `:496`)

**Issue:** Two post-generation steps sit outside every try/catch in the per-strip loop:

- `toDataUrl(res.imageUrl)` at line 466 — `media.mjs:57-66` throws `CliError('download_failed')` when
  the gateway answers with a remote URL nothing can fetch; it also throws `bad_payload`, and
  the `fetch` itself can reject.
- `dataUrlSize(dataUrl)` at line 473 — `media.mjs:94-99` runs `sharp(...).metadata()` unguarded, so a
  200 response whose body is not an image (an HTML error page behind a data URL, a truncated reply)
  throws a raw `Error`, not a `CliError`.

Neither is caught. The throw escapes `runStrips`, so the strip gets **no ledger row**, the run aborts
even with `--keep-going` set, and the `raw/` write at line 470 that already landed is left orphaned.

Measured (stub gateway, 2-strip plan, strip 2's reply undecodable):
`run 1: threw "Input buffer contains unsupported image format"; calls=2; rows=[idle:0 ok=true];
raw on disk: idle_f1=true idle_f2=true` — i.e. strip 2 was paid for, its bytes are on disk, and the
ledger has no row for it. Then `run 2: calls=1` — the resume decision sees `missing`, so the same
strip is paid for a second time. The orphaned `raw/` is not even reused, because `nextPending`
requires a record that says `ok:true` before it will look at the raw.

This is the class the phase exists to prevent: a failure after the money was spent must be *booked*
so a resume never re-buys it. Its own summary claims the opposite ("Out of retries: the strip is a
failed row, not a dead run", `anim.mjs:452-453`) — that claim only holds for the generation call.

**Fix:** widen the per-strip guard so every step after the generation is booked the way the `bridge`
and `meta.ok:false` branches already are:

```js
let dataUrl
try {
  dataUrl = await toDataUrl(res.imageUrl)
} catch (err) {
  failed++
  ctx.note(`${key} failed: ${err.message}`)
  commit(recordFor(mods, item, spec, { ok: false, seconds: Number(((Date.now() - started) / 1000).toFixed(3)), size: null, meta: null }))
  if (!keepGoing) { ctx.note(`stopped after ${key} — pass --keep-going to run the rest`); break }
  continue
}

const rawPath = writeDataUrl(dataUrl, path.join(outRoot, mods.stripFile(item.state, item.frame, spec.dirs)))
written.push(rawPath)

let size = null
try {
  size = await dataUrlSize(dataUrl)
} catch (err) {
  failed++
  ctx.note(`${key} has undecodable bytes: ${err.message}`)
  commit(recordFor(mods, item, spec, { ok: false, seconds: Number(((Date.now() - started) / 1000).toFixed(3)), size: null, meta: null }))
  if (!keepGoing) { ctx.note(`stopped after ${key} — pass --keep-going to run the rest`); break }
  continue
}
```

Note the second branch must keep the raw (spec §8), so it books `ok:false` *after* line 470.

### CR-02: `--redo state:frame` re-runs every pending strip, not the named one — contradicting the flag's own docblock, the docs and the plan

**File:** `cli/commands/anim.mjs:397-421` (the `nextPending(..., { redo })` call and the loop over `pending`)

**Issue:** The redo keys are handed to `nextPending` as a *union* with everything else that is
pending, and the loop then walks the whole `pending[]`. So `--redo k` means "k plus whatever else
still needs doing", not "only k".

Measured, on the state a default-stopped run actually leaves behind (strip 0 done, strip 1 booked
`ok:false`, strip 2 never reached): `run --go --redo idle:1` →
`generation calls: 2; notes: ["[1/2] idle:1 · redo", "[2/2] idle:2 · missing"]; totals: {"calls":3}`.
The operator asked to redo one strip after a stop, and the run also re-ran strip 2 — a strip they may
have deliberately not wanted to spend on. The trailing note even says `--redo: 2 strip(s) re-done, the
other rows are untouched`.

Three places state the opposite contract: `anim.mjs:352-353` ("`--redo` redoes exactly the named
strips"), `docs/agent-api.md:278` ("re-does only the named strip"), and the plan's own arm text. The
`04-02` code had this right (`git show bc82d8a:cli/commands/anim.mjs` → `const todo = plan.filter((p) => !redo || redo.has(...))`);
`04-03` replaced the plan walk with `nextPending` and dropped the filter, so this is a regression
introduced inside this phase, not an unimplemented feature.

The test suite cannot see it: the only redo arm that counts calls (`anim.test.mjs:958-993`) sets up a
*fully complete* set first, where `pending` collapses to the one redo key. No arm exercises `--redo`
against a set that still has other pending strips.

**Fix:** when `--redo` names keys, walk only those (still via `nextPending` so the reason machinery
stays in the module):

```js
const result = mods.nextPending(spec, load.strips, facts, { redo: redo ? [...redo] : [] })
const pending = redo ? result.pending.filter((p) => redo.has(mods.stripKey(p.state, p.frame))) : result.pending
```

and change the note at line 543 to name the count actually walked.

### CR-03: `set.json` records the spec's model, not the model the run is actually asking — `--model` is invisible to every downstream reader

**File:** `cli/commands/anim.mjs:205` (the resolved `model`) vs `app/lib/animSet.ts:380` (`buildSetJson`)

**Issue:** `resolveSpec` resolves the run's model as `ctx.model || spec.model` and the POST body
correctly carries that value (`anim.mjs:440`). But `buildSetJson` is handed `spec` and writes
`backend: { provider, model: spec.model }`, so the ledger always records the *spec's* model. The plan
payload reports the resolved one (`anim.mjs:233`).

Measured with `--model OVERRIDE-MODEL` against a spec whose `model` is `SPEC-MODEL`:
`body.model = OVERRIDE-MODEL`, `plan.model = OVERRIDE-MODEL`, `set.backend = {"provider":"openrouter","model":"SPEC-MODEL"}`.

Why it matters beyond a cosmetic mismatch: spec §5.4 requires provenance honesty (R6 — "backend 与实际
服务方一致"), and Phase 5's library save and Phase 6's UI both read `set.json` as the only source.
An operator who re-ran a set with `--model` gets a ledger that names the model it did not use, and
resuming from that ledger reproduces the same lie.

**Fix:** carry the resolved model into the spec copy the ledger is built from — either pass it through
`buildSetJson` as an argument (`buildSetJson({ spec, strips, provider, model })`) or set
`spec.model = ctx.model || spec.model` in `resolveSpec` and have `planStrips`/`buildStripPrompt` keep
ignoring it. A test that asserts `set.backend.model === <the model in the POST body>` under `--model`
would pin it.

## Warnings

### WR-01: `providerFor` silently labels every unresolvable profile `openrouter`

**File:** `cli/commands/anim.mjs:131-133`

**Issue:** `(ctx.config.profiles[id] && ctx.config.profiles[id].provider) || 'openrouter'` falls back to
`openrouter` both when `id` is absent and when the profile id is present but unknown. The server does
not share that fallback: `app/lib/llmServer.ts:63-66` returns an explicit `unknown profile "x"` error,
which means the run would have failed before writing anything — but the *plan* payload would have
told the operator `openrouter`. This is the same honesty class R6/LIB-03 opens for (`docs/agent-api.md`
promises the plan shows the provider a run will ask).

**Fix:** `const profile = ctx.config.profiles[id]; if (!profile) return 'openrouter'; return profile.provider`
still hides the unknown case. Prefer surfacing it in the plan payload (`provider: null, providerWarning: 'unknown profile "x"'`)
rather than guessing — or resolve it once and reuse the same function the server uses.

### WR-02: An undecodable gateway reply is reported as `bridge_failed`, sending the operator to the wrong subsystem

**File:** `cli/commands/anim.mjs:466` (throw site) / `cli/lib/media.mjs:57-66`

**Issue:** `toDataUrl` throws `CliError('bad_payload')` for a non-URL value and `download_failed` for a
non-2xx fetch, but a 200 whose body is not an image is only caught later by `sharp`, whose raw
`Input buffer contains unsupported image format` error has no `code`, so it is enveloped as
`code: 'error'` (`cli/lib/args.mjs:86`). The operator sees neither the route, the strip key, nor the
fact that the bytes came from the gateway. Combined with CR-01 the run also dies without a ledger row.

**Fix:** wrap the decode in `dataUrlSize`/`toDataUrl` with a `CliError('bad_image', …)` that names the
source, and add the strip key at the call site (`ctx.fail('bad_image', `${key}: ${err.message}`)`).

### WR-03: `collectFacts` takes a `record` argument it never reads

**File:** `cli/commands/anim.mjs:330`

**Issue:** `async function collectFacts(spec, outRoot, record, mods)` — `record` is unused in the body
(it walks `mods.planStrips(spec)` and measures the filesystem only). `04-03-PLAN.md:133` names the
record as one of the two inputs the resume judgement combines, and a reader of this signature will
believe facts are derived from it. Dead parameter + misleading contract.

**Fix:** drop the parameter (call site at `:396` passes `load.strips`).

### WR-04: A shrunk spec silently discards paid-for rows from `set.json` while leaving the bytes on disk

**File:** `cli/commands/anim.mjs:385` (the `plan.map(...)` row filter in `commit`) and `:412`

**Issue:** `commit` re-derives `rows` as `plan.map(...)` — restricted to the *current* plan. Any ledger
row whose `(state, frame)` is no longer in the plan is dropped on the next ledger rewrite. The raw and
derived bytes stay in the run directory, so disk and ledger disagree.

Measured: a 3-frame set paid in full, then re-run with a 1-frame spec (no truncation, nothing pending
for strip 0) — `pass 2 rows: [idle:0]`, `frames[]: 8`, `derived: 24 files still on disk`, and
`set.json` no longer mentions `idle:1`/`idle:2`. Regrowing the spec to 3 frames does not restore them
either (`pass 3 calls=0 rows=idle:0`), because they are gone from the record — but their `derived/`
files and raw are still there, so a Phase 5 library save driven by `set.json` will silently ship an
incomplete set.

**Fix:** this is the one place the plan-order rewrite needs to be lossless — keep rows that are not in
the plan:

```js
const planned = plan.map((p) => merged.get(mods.stripKey(p.state, p.frame))).filter(Boolean)
const known = new Set(plan.map((p) => mods.stripKey(p.state, p.frame)))
const orphans = [...merged.entries()].filter(([k]) => !known.has(k)).map(([, v]) => v)
const rows = [...planned, ...orphans]
```

or refuse the run loudly when the ledger carries rows the plan does not (`ctx.fail('spec_shrank', …)`).

### WR-05: The dry path is not filesystem-free — a cold `plan` writes the module bundle into `.ie/cache/`

**File:** `cli/commands/anim.mjs:6-8` (the docblock promise) vs `:585` (`ctx.modules('anim', MODULES)`)

**Issue:** The module docblock states "Nothing on the dry path touches `ctx.server()`, `ctx.api` or the
filesystem: a preview that costs a request, or a file, is a preview nobody dares run twice." `ctx.modules`
is a filesystem operation by construction (`cli/lib/bundle.mjs:63-70`: `mkdirSync(CACHE_DIR)` + a
build/`writeFileSync` when the cached bundle is stale) — it must run before the subcommand can be
dispatched, because `planPayload` needs `planStrips`.

Measured: delete `.ie/cache/node-anim.mjs`, then `node cli/ie.mjs anim plan --spec …` →
`before=false after=true size=16218`.

The *spend* promise holds (the arms at `anim.test.mjs:321-348` count seams and assert `existsSync(out) === false`),
and `.ie/` is gitignored. But the docblock is a claim a reviewer will rely on, and "the dry path writes
nothing" is the sentence the test suite's zero-write arms are read as proving — they only cover the
output root.

**Fix:** narrow the docblock to what is true ("touches no output path, no server and no network; the
esbuild bundle cache is the only file it may write") and state which arm proves which half.

## Info

### IN-01: The `plan`/dry-run refusals for `--keep-going` and `--redo` are implemented but only partially covered

**File:** `cli/commands/__tests__/anim.test.mjs:387-398`

**Issue:** `anim.mjs:592-601` throws for `--keep-going`/`--redo` on `plan` and on a dry `run` (both
verified through the real CLI: exit 2 with the right message). The arm at `:387` asserts the opposite
of what its name promises — it asserts `parseCommand(['plan', ..., '--keep-going'])` does *not* throw,
and the comment explains why (the strict parser no longer refuses an undeclared flag). Nothing asserts
the refusal itself, so a future edit that drops lines 592-601 reddens nothing in vitest.

**Fix:** add three `rejects.toThrow(/never continues|only apply to a run/)` assertions, and rename the
arm (`declares the run-only flags, and lets the strict parse accept them`).

### IN-02: An unused test helper survived the `--keep-going` rewrite

**File:** `cli/commands/__tests__/anim.test.mjs:784-798`

**Issue:** `async function one(out, extra = {})` inside `describe('ie anim — the aspect gate')` is never
called (the arms in that block build their own `runCli` calls at `:806` and `:837`; the only textual
match for `one(` in the file is its own definition). It still constructs a `runCli` call whose contract
would drift from the arms that are actually run.

**Fix:** delete it.

### IN-03: The duplicate-row gate can never fire from `nextPending`'s `duplicates`, and two arms don't reach their intended branch

**File:** `cli/commands/anim.mjs:371-379` vs `:400-402`

**Issue:** The ledger load already refuses a repeated key while building `merged`, so by the time
`nextPending` runs, duplicates are impossible — the check at `:400` is unreachable. That is fine
(belt-and-braces), but it means `04-03-SUMMARY.md:158`'s claim that the duplicate gate is observed at
both points is only true of the load-time one. Not a bug; worth a one-line comment so the next reader
does not think the second gate is load-bearing.

**Fix:** annotate `:400` as defence-in-depth (unreachable while the `:375-378` load check stands), or
drop it.

---

### Verification notes (methods, so the findings can be re-derived)

- **Scope/depth:** `git diff 6a51339..HEAD -- cli/ app/` (6 non-planning files); depth resolved to
  `standard` (config `workflow.code_review_depth=standard`, no overrides, 6 files, no downgrade).
  `fallow_enabled=false` in this project, so no structural pre-pass.
- **Harness:** every runtime finding was reproduced with an in-process CLI context (stubbed `ctx.api`
  / `ctx.bridge`, real `anim.mjs`, real `app/lib` modules through `nodeBundle`, real `sharp`) or
  through the real CLI entry point (`node cli/ie.mjs …`). Scratch scripts were run from inside the repo
  and deleted afterwards; no source file was modified.
- **Not in scope of the checks:** no live gateway call and no Chromium launch were made — the
  `strip-frames` op and the network are stubbed in every reproduction, so findings about the op's own
  verdict (`meta.ok`) are read from its documented `meta` shape, not from a live cut.

---

_Reviewed: 2026-10-07T17:44:38Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
