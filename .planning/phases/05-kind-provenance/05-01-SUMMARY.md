---
phase: 05-kind-provenance
plan: 01
subsystem: library
tags: [typescript, node, esm, cli, library, asset-kind, i18n, provenance, vitest]

# Dependency graph
requires:
  - phase: 02-pure-core
    provides: "`SetJson` (the run ledger: `backend.{provider,model}`, `totals.{calls,cells,seconds}`, `states[]` with no `motion`) — read, never re-derived"
  - phase: 04-cli-runner
    provides: "the run directory this plan consumes (`derived/*.png` + `set.json`), whose CR-03 fix made `set.json` record the model the run actually asked for"
provides:
  - "`ASSET_KINDS` gains `'animations'` — one line, plus the panel's exhaustive `KIND_KEY` and both translations, so a missing label is a compile error rather than a blank row"
  - "`collectSetAsset` in `app/lib/libraryCollect.ts` — the set payload (derived frames + the ledger under `derived/set.json`), its spec-only manifest and its provenance read off the ledger"
  - "`ie library save <project> animations <slug> --set-json <f> --derived-dir <dir>` — the CLI entry point (CLI-03), dispatched before the `--sheet`/`--derived` guard"
affects: [05-02, 06]

actuals:
  tokens: 0
  tasks: 3

# Audit history — this plan was fixed once before execution
---

# Phase 5 Plan 01: kind 扩宽 + collector 分支 + 面板分组 Summary

**Three tasks, three commits, one authorized deviation from the plan's literal text.**

## What landed

| Task | Commit | Result |
|---|---|---|
| 1 — `'animations'` in `ASSET_KINDS` + `KIND_KEY` + en/zh labels | `11b17ed` | `tsc --noEmit` still proves the two label maps are exhaustive; `ASSET_KINDS` is 6 kinds and the new assertions pin both halves |
| 2 — `collectSetAsset` | `cdc17e3` | the payload, the spec-only manifest and the ledger-sourced provenance, all unit-tested |
| 3 — `ie library save … animations` | `51e304e` | the CLI branch, its tests, and a live end-to-end run |

## The deviation (Rule 1 — bug in the plan), and why it mattered

**The plan had `collectSetAsset` take file *paths* and call `readFileSync` / a CLI-side `dataUrlFromFile`.** That would have put `node:fs` into `app/lib/libraryCollect.ts`, which is imported by `app/page.tsx`, `LibraryPanel.tsx` and `PixelStudio.tsx` — i.e. it is bundled for **the browser** as well as the Node CLI. Two facts confirm the conflict:

- `dataUrlFromFile` lives in `cli/lib/media.mjs`; importing it from `app/lib` would invert the layering.
- `app/lib/**` has exactly two `node:fs` importers (`library.ts`, `ieConfig.ts`); the collector is not one of them.

**Fix:** `collectSetAsset` stayed **pure** — it takes the parsed `setJson`, the already-encoded `setJsonDataUrl`, and `derived: {name, dataUrl}[]` — and the CLI's `saveSet` does the reading and the encoding. The task's own semantics are unchanged: the payload is still `derived/*.png` + `derived/set.json` (D-42/D-50), the manifest is still spec-only (D-46), and the provenance still comes off the ledger (D-43).

A second, smaller addition: an unknown `setJson.backend.provider` now **throws** instead of being stamped through. `buildProvenance` requires a `BackendLabel`, so the type would have been satisfied only by a cast; LIB-03 is precisely about not recording a producer that is not the producer, so the cast was replaced by a checked stop.

## Evidence — observed, not asserted

- Task gates run **verbatim** from the plan: `npx tsc --noEmit` + `npx vitest run <file>`; the `tsc` half is load-bearing for Task 1, because the panel's `Record<AssetKind, string>` and the two message maps are compile-checked.
- `npm test` → **432/432** · `npm run test:cli` → **17/17** · `npx tsc --noEmit` → exit 0.
- **Live CLI**, `IE_ASSETS_DIR` pointed at a temp dir and a throwaway run directory:
  - `ie library save dungeon animations chaser-idle --set-json … --derived-dir … --json` → **exit 0**, 3 files written; on disk: `derived/idle_f1_east.png`, `derived/idle_f1_south.png`, `derived/set.json`, `meta.json` — **no `raw/`**.
  - `meta.kind === 'animations'`, `meta.files.sheet === null`, `meta.manifest.type === 'animation-set'`, `manifest.states[0]` = `{ name, frames, fps, durationsMs, loop }` (**no `motion`**).
  - `--set-json` omitted → `--set-json is required for the animations kind`; a non-animations save with no files → still `save needs at least one file` (the guard the audit flagged is intact for the kinds it was written for).
  - `ie library list --json` groups it: `dungeon → animations → chaser-idle`, with `derived` listing all three files.
- `derived/set.json` really lands where `libraryPath.ts`'s validator accepts it — asserted on the filesystem, not inferred (D-50).

## Not done here (by design)

Removing the `'openrouter'` default, the `cost`/`params` assertions and the payload-arithmetic guard are `05-02`. **Known follow-up for it:** `saveSet` currently leaves `--backend` unread for the animations kind (the backend comes from the ledger per D-43); `05-02` owns both the removal of the default for the other kinds and the `--backend`-ignored-for-animations assertion.

## Deviations

1. **Rule 1 (plan bug) — `collectSetAsset`'s signature.** Paths → parsed inputs; the reading moved to the CLI. Reason and evidence above. No task semantics changed.
2. **Rule 1 (plan bug, small) — unknown backend now throws.** The plan passed `setJson.backend.provider` (a `string`) where `BackendLabel` is required; a cast would have satisfied the compiler and violated LIB-03.
3. **Process — the plan's executor dispatches died twice on an upstream provider quota (HTTP 429), so this plan was executed inline by the orchestrator.** The two failed attempts left no commits (one left a `.bak` and a scratch `assets/` root; both were removed). Same three tasks, same gates, same commit scope.

## Self-Check: PASSED

- [x] All three tasks executed, each committed individually with the plan's scope
- [x] Every `<automated>` gate run verbatim and green; `tsc` green
- [x] `05-01-SUMMARY.md` created, matches the template, committed
- [x] No file touched outside the plan's `files_modified` (+ this SUMMARY)
