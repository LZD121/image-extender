# Coding Conventions

**Analysis Date:** 2026-10-06

## Naming Patterns

**Files:**
- `camelCase.ts` for every module in `app/lib/` (`generatePrompt.ts`, `libraryCollect.ts`, `chromaPresets.ts`). No kebab-case, no `index.ts` barrels — each module is imported by full path.
- `PascalCase.tsx` for React components in `app/components/` (`LibraryPanel.tsx`, `ParallaxStudio.tsx`).
- Next.js route files are the framework's convention: `app/api/<name>/route.ts`, catch-all as `app/api/library/[[...path]]/route.ts`.
- CLI uses `.mjs` (plain ESM, no build step): `cli/ie.mjs`, `cli/commands/library.mjs`, `cli/lib/args.mjs`.
- Tests: `*.test.ts` inside a sibling `__tests__/` directory; CLI tests `*.test.mjs` (`cli/lib/__tests__/args.test.mjs`); E2E specs `e2e/*.spec.ts`.

**Functions:**
- `camelCase`, no prefix for async; verb-first (`buildGeneratePrompt`, `saveAsset`, `collectStudioAsset`, `resolveAssetDir`).
- Predicate helpers are `isX(value): value is X` type guards: `isLocale` (`app/i18n/index.ts`), `isValidKind`/`isValidName`/`isValidRelPath` (`app/lib/libraryPath.ts`), `isPixelOp` (`app/lib/pixel.ts`).
- Route handlers export the HTTP verb itself: `export async function POST(request: NextRequest)` (`app/api/library/[[...path]]/route.ts:87`).
- Test helpers are local, unprefixed factory functions (`meta()`, `req()`, `ctx()`) inside the `__tests__` file.

**Variables:**
- `camelCase` locals; `SCREAMING_SNAKE_CASE` for module constants: `MAX_FILE_CHARS`, `UNUSABLE_FS_CODES` (`app/api/library/[[...path]]/route.ts:15,22`), `DATA_URL_RE`, `ORPHAN_RE` (`app/lib/library.ts:21,23`), `PIXFLUX_MIN` (`app/lib/pixel.ts:17`), `EXTENSION_PERCENT` (`app/lib/app.ts:35`).
- Storage/UI keys are namespaced strings with a `extender:` prefix: `STORAGE_KEY = 'extender:api_key'`, `LOCALE_STORAGE_KEY = 'extender:locale'`, `STORAGE_MODE = 'extender:mode'`.
- No underscore-prefixed private members; module privacy is achieved by not exporting.

**Types:**
- `PascalCase`, no `I` prefix: `AssetMeta`, `LibraryIndex`, `Provenance` (`app/lib/libraryTypes.ts`), `CollectedAsset`, `CollectorInput` (`app/lib/libraryCollect.ts`).
- Union sets are `as const` tuples with a derived type: `export const ASSET_KINDS = ['tiles','sprites',...] as const; export type AssetKind = (typeof ASSET_KINDS)[number]` (`app/lib/libraryTypes.ts:7`). Same pattern for `PIXEL_OPS`, `PIXEL_VIEWS`, `PROVIDER_IDS`.
- Discriminated unions over booleans; the `never` assignment in `default:` is the exhaustiveness guard (`app/lib/libraryCollect.ts:9`).
- Error-code unions are `SCREAMING_SNAKE` string literals: `type LibraryErrorCode = 'EEXISTS' | 'ENOTFOUND'` (`app/lib/library.ts:32`).

## Code Style

**Formatting:**
- No Prettier config and no `.editorconfig` — style is enforced by consistency, not tooling. Match the surrounding file.
- 2-space indentation, single quotes, **no semicolons**, trailing commas in multiline literals.
- Lines run long where a prompt string or a table needs it; there is no enforced column limit.
- Section dividers inside long modules use box-drawing comments: `// ─────────` (`app/lib/app.ts:38`).
- Files carrying client-only React state start with `'use client'` (`app/page.tsx:1`, `app/lib/i18n.tsx:1`).

**Linting:**
- `npm run lint` → `next lint`. There is no standalone `eslintrc`/`eslint.config.js` in the repo; the only other static check is `tsc` via `tsconfig.json` (`"strict": true`, `"noEmit": true`).
- Keep the compiler green: a missing zh translation or an unhandled union member is a **compile error**, and that is intended (`app/i18n/index.ts:60`, `app/lib/libraryCollect.ts:9`).

## Import Organization

**Order:**
1. Node builtins (`node:fs/promises`, `node:path`, `node:os`).
2. External packages (`react`, `next/server`, `jszip`, `sharp`).
3. Internal modules via the `@/` alias (`@/app/lib/...`, `@/app/i18n`).
4. Relative imports (`../[[...path]]/route`, `../../lib/bridge.mjs` in CLI/tests).
5. `import type` last or grouped with its siblings.

A typical header (`app/lib/library.ts:1`):
```ts
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertInsideRoot, isValidName, isValidRelPath, resolveAssetDir, resolveAssetFile } from '@/app/lib/libraryPath'
import { ASSET_KINDS, type AssetKind, type AssetMeta, type LibraryIndex, type LibraryProjectGroup } from '@/app/lib/libraryTypes'
```

**Grouping:**
- No blank lines between import statements; one block per module, then a blank line before the module docblock body.
- `type` specifiers are inlined with `import { X, type Y }`, not a separate statement.

**Path Aliases:**
- `@/*` → repo root, defined in both `tsconfig.json` (`"paths": { "@/*": ["./*"] }`) and mirrored in `vitest.config.ts`. Import as `@/app/lib/...`, never `../../lib/...` — the one exception is Next's catch-all route test (`../[[...path]]/route`).

## Error Handling

**Patterns:**
- Throw `Error` in pure/lib code; catch and translate to HTTP only at the route boundary. Routes wrap the body in `try/catch` and map error type → status code (`app/api/library/[[...path]]/route.ts:129`).
- Typed domain errors carry a machine-readable `code` and keep the human message in `super()`:
```ts
export type LibraryErrorCode = 'EEXISTS' | 'ENOTFOUND'
export class LibraryError extends Error {
  constructor(message: string, readonly code: LibraryErrorCode) {
    super(message); this.name = 'LibraryError'
  }
}
```
(`app/lib/library.ts:32-39`)
- Client-side wrappers use a **distinctly named** error so the two layers cannot be confused: `LibraryRequestError extends Error` carrying `readonly status: number` (`app/lib/libraryClient.ts:12`). The comment states why the name differs from the server's `LibraryError`.
- Routes return errors through one helper rather than building `NextResponse.json` by hand:
```ts
function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}
```
(`app/api/library/[[...path]]/route.ts:28`), then e.g. `if (!isValidName(project)) return bad('invalid project')`.
- Error shapes on the wire are always `{ error: string }`; fs-failure codes that mean "library unusable" are collected in a set and mapped to 500, everything else to 400 (`UNUSABLE_FS_CODES`, `app/api/library/[[...path]]/route.ts:22,136-141`).
- Validate the whole payload **before** side effects (`app/lib/library.ts:80`: decode every data URL before touching disk).
- The CLI has a parallel contract: `CliError` / `UsageError` with `USAGE_EXIT`, and `okEnvelope`/`errorEnvelope` result shapes (`cli/lib/args.mjs`, asserted in `cli/lib/__tests__/args.test.mjs`).

## Logging

**Framework:**
- No logging library. `console` only, and only in scripts/dev paths. There is no `lib/logger.ts` and no structured-logging convention to match.

**Patterns:**
- Server routes do not log; they return an error body. Provenance and cost are **stamped into data** (`meta.json` `provenance`, `app/lib/libraryTypes.ts:12`) rather than logged.
- Agent-facing feedback goes through the CLI's JSON envelope, not stdout prose.

## Comments

**When to Comment:**
- Every `app/lib/*.ts` module opens with a block docblock stating *why the module exists* and what it owns. This is the repo's strongest convention — rationale and history, not a restatement of the code:
```ts
/**
 * The only module in the app that touches the filesystem. Everything else —
 * the route handler, the browser client, the UI — goes through these
 * functions, so the on-disk layout has exactly one owner.
 */
```
(`app/lib/library.ts:17-21`)
- Comments record measured decisions with their evidence, and name the prior bug when a move fixed one: "The table used to be inlined in `app/api/generate/route.ts`, where three of the four prompt branches reassigned `fullPrompt` and silently dropped it." (`app/lib/stylePrompt.ts:12`).
- Explain *why*/*where it came from* at the point of surprise: `// Decode everything BEFORE touching the disk so a bad payload cannot leave a stray temp directory behind.` (`app/lib/library.ts:81`).
- Deliberate simplifications are marked `ponytail:` with the rationale, e.g. `// ponytail: the body below is the route's text moved verbatim, so it sits one indent deeper than this file's style` (`app/lib/generatePrompt.ts:26`).

**JSDoc/TSDoc:**
- One-line `/** … */` on exported types, fields and functions where the name is not self-evident (`app/lib/libraryTypes.ts` documents nearly every field of `Provenance`).
- No `@param`/`@returns` tag style; prose sentences instead.
- A file that is moved/extracted keeps a header line naming its origin, e.g. `// app/lib/chromaPresets.ts` then the docblock (`app/lib/chromaPresets.ts:1-2`).

**TODO Comments:**
- None in shipped source. Deferred work is either done, deleted, or recorded in `docs/superpowers/plans/*.md`; there is no `TODO(username)` convention.

## Function Design

**Size:**
- Pure policy modules keep functions short and single-purpose (`slugify`, `resolveAssetDir`, `purityAt`).
- The route is allowed to be a long linear validator, and `app/page.tsx` (~4k lines) is a known, tolerated god-component — new pure logic is extracted **out** of it rather than growing it (see `app/lib/libraryCollect.ts`, `app/lib/studioDownload.ts`).

**Parameters:**
- Small positional signatures; optional behaviour goes in a trailing options object: `saveAsset(project, kind, slug, meta, files, opts: { overwrite?: boolean } = {})` (`app/lib/library.ts:70`).
- React/prompt builders take one body object and destructure inside (`buildGeneratePrompt(body: PromptBody)`).

**Return Values:**
- Pure functions are deterministic: "Pure: same body in, same prompt out. No framework, no network, no env." (`app/lib/generatePrompt.ts`).
- Return early with guard clauses for validation; return `null` (not throw) for "this mode has nothing to collect" (`collectStudioAsset` returns `CollectedAsset | null`).
- Prefer returning plain buffers/plain objects over DOM/canvas handles so a function is node-testable (`app/utils/pixelGrid.ts:4`).

## Module Design

**Exports:**
- Named exports only. No default exports except React page/components (`export default function Home()`, `app/page.tsx:36`).
- Constants are exported alongside their derived types so `isX` guards and tables stay in one module.

**Barrel Files:**
- No `index.ts` re-export barrels; every consumer imports the concrete module path. The one aggregation point is `app/i18n/index.ts`, which composes the message modules and exports the registry — and even that is deliberate, documented, and single-level.

**One home per fact (the load-bearing rule):**
- Every shared table/fact has exactly one module. Duplicating a value into a second file is treated as a bug: `ART_STYLE_PROMPTS` and `styleDirective()` exist only in `app/lib/stylePrompt.ts`; chroma tunings only in `app/lib/chromaPresets.ts` (whose docblock names the three surfaces that used to each carry a private copy); the on-disk layout only in `app/lib/library.ts`; the gateway table only in `app/lib/providers.ts`.
- Cross-layer field shapes live in a dedicated types module so a rename cannot drift: `app/lib/libraryTypes.ts` is imported by server, route, client and UI.
- Where a fact *is* intentionally duplicated, the comment says why: "Deliberately duplicates a few lines from the existing ZIP exporters rather than refactoring them: the exporters' byte-for-byte output is a tested invariant" (`app/lib/libraryCollect.ts:14`).

---

*Convention analysis: 2026-10-06*
*Update when patterns change*
