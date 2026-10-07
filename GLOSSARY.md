# Glossary

The domain language of this repo, as the architecture reviews and the code use it. Add a term when a deepening names a concept the codebase does not already have a word for; keep entries short and honest about where the concept is currently spelled out.

## Finishing

The steps that turn a *raw* model output into an engine-ready file: panel fit, chroma key to alpha, frame border removal, slicing, sprite isolation, baseline alignment, cell centring. Finishing is what the product is sold on — the bytes a game engine imports.

Today the *order* of those steps is written in three callers rather than behind one interface: `app/page.tsx` (~760-782), `cli/native/bridge.mjs` (the extend-finalize op), and prose in `docs/agent-api.md`. The steps themselves live in `app/utils/imageProcessor.ts`, which is a toolbox with no composition layer.

## Sheet manifest

The JSON written next to an exported sheet that maps its grid cells to roles or frames — what an engine importer reads to know that cell *(col, row)* is the *top-cap* tile or frame 3 of *walk*.

It has two homes today: the builders inside `app/page.tsx` (`buildTileSetManifest`, `buildPropManifest`, `buildSpriteManifest`, reachable only from that module's closure) for the ZIP export and the asset library, and a second, independently-shaped manifest assembled in `cli/commands/studio.mjs` for the files the CLI writes to disk. The two agree on the artifact and disagree on its shape.
