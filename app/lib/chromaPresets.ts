// app/lib/chromaPresets.ts
/**
 * Chroma-key tunings, in one place.
 *
 * Three surfaces key magenta — this page, the headless in-page program
 * (`cli/native/bridge.mjs`) and the CLI's own post-processing — and the numbers
 * are a judgement about the art, not about the caller. `bridge.mjs` used to
 * carry a private copy that only a human could keep in step.
 *
 * `default` restates `chromaKeyToAlpha`'s own defaults on purpose: naming it
 * here is what lets the bridge ask for "the conservative one" by name.
 */
export interface ChromaKeyOptions {
  /** Key color RGB. Default is pure magenta (255,0,255). */
  keyR?: number
  keyG?: number
  keyB?: number
  /**
   * Magenta-cast value at or above which a pixel becomes fully transparent.
   * Cast = max(0, min(r, b) - g). Range 0..255. Default 80 — comfortably
   * above the cast that natural warm/cool tones produce while still catching
   * blended-edge pixels.
   */
  castThreshold?: number
  /**
   * Width of the soft alpha falloff just below `castThreshold`. Pixels with
   * cast in `[castThreshold - castSoftness, castThreshold]` get partial
   * alpha so anti-aliased element borders feather cleanly. Default 30.
   */
  castSoftness?: number
  /**
   * How aggressively to neutralize magenta cast on every pixel that has
   * any. 0 = off (leaves a pink halo); 1 = fully subtract the cast from
   * R and B. Default 1.0 — natural images contain no real magenta, so any
   * cast is a blend artefact and should be removed.
   */
  despill?: number
  /**
   * Fraction of the despilled cast to add back into the green channel so
   * a desaturated edge pixel doesn't go dead grey. Default 0.5.
   */
  despillGreenBoost?: number
}

/** The tuning knobs, without the key colour (that is always magenta). */
export type ChromaPreset = Omit<ChromaKeyOptions, 'keyR' | 'keyG' | 'keyB'>

export const CHROMA_PRESETS = {
  /** Parallax layers: conservative, so warm reds in the art survive. */
  default: { castThreshold: 80, castSoftness: 30, despill: 1, despillGreenBoost: 0.5 },
  /** Tile material: aggressive — the model leaves faint pink at the cut edges. */
  tile: { castThreshold: 40, castSoftness: 35, despill: 1, despillGreenBoost: 0.6 },
  /** Props: moderate — decorations are colorful by nature. */
  prop: { castThreshold: 70, castSoftness: 30, despill: 1, despillGreenBoost: 0.5 },
  /** An opaque cell: never transparent, only neutralizes a magenta cast. */
  despill: { castThreshold: 256, castSoftness: 0, despill: 1, despillGreenBoost: 0.6 },
} as const satisfies Record<string, ChromaPreset>
