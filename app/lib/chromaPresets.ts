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
import type { ChromaKeyOptions } from '@/app/utils/imageProcessor'

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
