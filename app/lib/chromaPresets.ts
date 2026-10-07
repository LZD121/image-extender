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
  /** An 8-direction strip's field: saturated magenta, and the model paints a
   *  magenta WASH behind some cells. Measured on the real strips, the creature's
   *  own cast tops out at 99 (11 or less at the p99.9 after a 6px erode) while the
   *  wash runs 132..219, so 128 splits them. Softness 0 is the point: a ramp would
   *  leave a translucent film across every cell -- measured 2595 partial-alpha
   *  pixels for `default` on the committed fixture, 0 here. Despill stays on; the
   *  wash's RGB really is magenta and has to come off the surviving edge pixels.
   *
   *  The field itself is sampled per strip (`sampleFieldRgb`), never assumed: the
   *  two real strips measure #FD05FA (cast 245) and #FC06FA (cast 244), and this
   *  threshold sits below both while staying above the creature. */
  binary: { castThreshold: 128, castSoftness: 0, despill: 1, despillGreenBoost: 0.5 },
} as const satisfies Record<string, ChromaPreset>
