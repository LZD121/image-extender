/**
 * The single source of truth for art-style prompt text — every route that
 * mentions a style (generate, extend, prop-brief, scene-brief) now reads it.
 *
 * Scope note: the strengthened `pixel-art` / `low-poly` wording only reaches
 * the image generation paths (`generate`, `extend`). The two text brief routes
 * share the plain description as-is — they hand it to a reasoning model, where a
 * `RENDER STYLE` directive would address the wrong reader.
 *
 * The table used to be inlined in `app/api/generate/route.ts`, where three of
 * the four prompt branches reassigned `fullPrompt` and silently dropped it.
 */

export const ART_STYLE_PROMPTS: { [key: string]: string } = {
  'cinematic': 'cinematic photography with dramatic lighting and film grain',
  'vintage': 'vintage film photography with faded colors and retro feel',
  'black-white': 'black and white photography with rich contrast',
  'macro': 'macro photography with shallow depth of field',
  'oil-painting': 'oil painting style with visible brush strokes and rich textures',
  'watercolor': 'watercolor painting with soft washes and flowing colors',
  'impressionism': 'impressionist painting style with loose brushwork',
  'abstract': 'abstract art with bold shapes and colors',
  'pop-art': 'pop art style with bold colors and graphic elements',
  'cubism': 'cubist style with geometric shapes and multiple perspectives',
  'minimalist': 'minimalist art with simple forms and limited colors',
  'digital-art': 'digital art with smooth gradients and modern aesthetics',
  'cyberpunk': 'cyberpunk style with neon colors and futuristic elements',
  'vaporwave': 'vaporwave aesthetic with pastel colors and retro-futuristic vibes',
  // Strengthened after measuring that the old one-liners did not survive a long
  // structural prompt. See docs/superpowers/plans/2026-10-05-stylized-assets.md.
  'low-poly':
    'low-poly: flat geometric facets with straight visible edges, solid flat-shaded colour planes, crisp silhouettes. No texture detail, no gradients, no smooth or soft shading, no photographic realism',
  // Strengthened after measuring that the old one-liners did not survive a long
  // structural prompt. See docs/superpowers/plans/2026-10-05-stylized-assets.md.
  'pixel-art':
    'pixel art: crisp hard-edged pixel blocks, flat solid colours, thick dark outlines, a limited palette of roughly 16 colours, 16-bit console look. No anti-aliasing, no gradients, no soft shading, no photographic texture',
  '3d-render': '3D rendered look with realistic lighting and materials',
  'anime': 'anime/manga style with bold lines and vibrant colors',
  'cartoon': 'cartoon illustration with exaggerated features',
  'comic-book': 'comic book style with bold inking and halftone dots',
  'sketch': 'pencil sketch with cross-hatching and shading',
  'ink': 'ink drawing with bold black lines and dramatic contrast',
  'studio-ghibli': 'Studio Ghibli animation style with whimsical, hand-drawn aesthetics and rich environmental details',
  'pixar': 'Pixar animation style with smooth 3D rendering, expressive characters, and vibrant colors',
  'disney': 'Disney animation style with classic hand-drawn or modern 3D aesthetics and magical atmosphere',
  'dreamworks': 'DreamWorks animation style with dynamic expressions and cinematic lighting',
  'illumination': 'Illumination Entertainment style with bright colors, playful characters, and bold shapes',
  'laika': 'Laika Studios stop-motion style with intricate textures and handcrafted details',
  'cartoon-network': 'Cartoon Network style with bold outlines, simplified shapes, and vibrant colors',
  'nickelodeon': 'Nickelodeon animation style with energetic, expressive characters and bright color palettes',
  'aardman': 'Aardman claymation style with textured plasticine characters and British humor aesthetics',
  'blue-sky': 'Blue Sky Studios animation style with detailed 3D rendering and dynamic action sequences',
  'fantasy': 'fantasy art with magical and ethereal elements',
  'sci-fi': 'science fiction with futuristic technology and environments',
  'steampunk': 'steampunk style with Victorian-era and industrial elements',
  'surreal': 'surrealist style with dreamlike and impossible elements',
  'art-deco': 'Art Deco style with geometric patterns and elegant lines',
  'art-nouveau': 'Art Nouveau with flowing organic lines and natural motifs',
  'retro-80s': '1980s retro style with bright colors and bold graphics',
  'retro-50s': '1950s vintage style with pastel colors and classic aesthetics'
}

/**
 * The one place that turns an art-style key into prompt text.
 *
 * Leading position is deliberate: the sheet prompts run to hundreds of words of
 * grid/magenta/choreography rules, and the previous version — buried as
 * `Art style: …` or dropped entirely — measurably failed to survive them.
 *
 * Returns '' for 'none', for an absent style, and for an unknown key (never
 * invents a directive).
 */
export function styleDirective(artStyle: string | null | undefined): string {
  if (!artStyle || artStyle === 'none') return ''
  const description = ART_STYLE_PROMPTS[artStyle]
  if (!description) return ''
  return `RENDER STYLE (follow strictly, it outranks decorative wording elsewhere in this prompt): ${description}.\n\n`
}
