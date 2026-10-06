// app/lib/layerRoles.ts
/**
 * The parallax depth bands, as a value the *server* can read.
 *
 * `parallax.ts` is a client module (`'use client'`), so a route handler cannot
 * call anything on it — Next replaces the module with a client proxy and
 * `LAYER_ORDER.includes(...)` throws. `generateRequest.ts` needs this list to
 * tell a parallax body from a plain one, so the role list lives here and
 * `parallax.ts` re-exports it for the studio.
 */

export type LayerRole = 'sky' | 'far' | 'mid' | 'near'

/** Visual / compositing order in the layer panel and preview (back → front). */
export const LAYER_ORDER: LayerRole[] = ['sky', 'far', 'mid', 'near']
