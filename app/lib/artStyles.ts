import { Mode } from '@/app/lib/app'

/**
 * `id` is the stable identity of a group: it keys the translated optgroup label
 * (`common.artStyleGroup.<id>`) and it is what render sites compare against —
 * never the English `label`, which changes with the UI language.
 */
export const ART_STYLE_GROUPS: {
  id: string
  label: string
  options: { value: string; label: string }[]
}[] = [
  {
    id: 'match-original',
    label: 'Match original',
    options: [{ value: 'none', label: 'Match original style' }],
  },
  {
    id: 'photography',
    label: 'Photography',
    options: [
      { value: 'cinematic', label: 'Cinematic' },
      { value: 'vintage', label: 'Vintage film' },
      { value: 'black-white', label: 'Black & white' },
      { value: 'macro', label: 'Macro' },
    ],
  },
  {
    id: 'painting',
    label: 'Painting',
    options: [
      { value: 'oil-painting', label: 'Oil painting' },
      { value: 'watercolor', label: 'Watercolor' },
      { value: 'impressionism', label: 'Impressionism' },
      { value: 'abstract', label: 'Abstract' },
      { value: 'pop-art', label: 'Pop art' },
      { value: 'cubism', label: 'Cubism' },
      { value: 'minimalist', label: 'Minimalist' },
    ],
  },
  {
    id: 'digital',
    label: 'Digital',
    options: [
      { value: 'digital-art', label: 'Digital art' },
      { value: 'cyberpunk', label: 'Cyberpunk' },
      { value: 'vaporwave', label: 'Vaporwave' },
      // ★ = best measured stylized result; see docs/superpowers/plans/2026-10-05-stylized-assets.md
      { value: 'low-poly', label: 'Low poly ★' },
      { value: 'pixel-art', label: 'Pixel art' },
      { value: '3d-render', label: '3D render' },
    ],
  },
  {
    id: 'illustration',
    label: 'Illustration',
    options: [
      { value: 'anime', label: 'Anime' },
      { value: 'cartoon', label: 'Cartoon' },
      { value: 'comic-book', label: 'Comic book' },
      { value: 'sketch', label: 'Pencil sketch' },
      { value: 'ink', label: 'Ink drawing' },
    ],
  },
  {
    id: 'animation-studios',
    label: 'Animation studios',
    options: [
      { value: 'studio-ghibli', label: 'Studio Ghibli' },
      { value: 'pixar', label: 'Pixar' },
      { value: 'disney', label: 'Disney' },
      { value: 'dreamworks', label: 'DreamWorks' },
      { value: 'illumination', label: 'Illumination' },
      { value: 'laika', label: 'Laika' },
      { value: 'cartoon-network', label: 'Cartoon Network' },
      { value: 'nickelodeon', label: 'Nickelodeon' },
      { value: 'aardman', label: 'Aardman' },
      { value: 'blue-sky', label: 'Blue Sky' },
    ],
  },
  {
    id: 'fantasy-and-retro',
    label: 'Fantasy & retro',
    options: [
      { value: 'fantasy', label: 'Fantasy' },
      { value: 'sci-fi', label: 'Sci-fi' },
      { value: 'steampunk', label: 'Steampunk' },
      { value: 'surreal', label: 'Surreal' },
      { value: 'art-deco', label: 'Art Deco' },
      { value: 'art-nouveau', label: 'Art Nouveau' },
      { value: 'retro-80s', label: '80s retro' },
      { value: 'retro-50s', label: '50s vintage' },
    ],
  },
]


export const findStyleLabel = (value: string) => {
  for (const group of ART_STYLE_GROUPS) {
    const opt = group.options.find((o) => o.value === value)
    if (opt) return opt.label
  }
  return 'Match original'
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode — Extender (default), Parallax (sidescroller background builder),
// Tile (seamless 2D-tileable material textures), Sprite (character animations)
// ─────────────────────────────────────────────────────────────────────────────

/** Top-level tool the user is currently working in. Persisted to localStorage. */
