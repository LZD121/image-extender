import type { MessageKey, TranslateParams } from '@/app/i18n'

/**
 * The client renders route errors (`{ error }` from the API routes) and the
 * canvas/loader failures thrown by `app/utils/*` verbatim in a toast. This
 * module maps those app-authored English messages back onto i18n keys so they
 * follow the UI language.
 *
 * A message that matches nothing is returned untouched: provider/gateway text
 * ("rate limit exceeded", …) is third-party and has no translation.
 */

const EXACT: Record<string, MessageKey> = {
  'Missing required fields': 'errors.missingFields',
  'No message in response': 'errors.noMessageInResponse',
  'The model responded without an image. It may not support image extension yet.':
    'errors.noImageInResponse',
  'No image generated. The model may not support pure image generation.':
    'errors.noImageGenerated',
  'Internal server error': 'errors.internal',
  'Failed to generate image': 'errors.failedGenerateImage',
  'Failed to generate scene brief': 'errors.failedGenerateSceneBrief',
  'Failed to review tileset': 'errors.failedReviewTileset',
  'Failed to review sprite sheet': 'errors.failedReviewSpriteSheet',
  'Failed to generate prop brief': 'errors.failedGeneratePropBrief',
  'Missing biome prompt': 'errors.missingBiomePrompt',
  'Missing anchor prompt': 'errors.missingAnchorPrompt',
  'Missing preview image': 'errors.missingPreviewImage',
  'Missing sprite sheet image': 'errors.missingSpriteSheetImage',
  'No scene brief returned from model': 'errors.noSceneBrief',
  'Art director returned no usable ideas': 'errors.noPropIdeas',
  'Invalid JSON body': 'errors.invalidJsonBody',
  'invalid JSON body': 'errors.invalidJsonBody',
  'missing route params': 'errors.missingRouteParams',
  'invalid asset path': 'errors.invalidAssetPath',
  'invalid project': 'errors.invalidProject',
  'invalid kind': 'errors.invalidKind',
  'invalid slug': 'errors.invalidSlug',
  'missing meta': 'errors.missingMeta',
  'missing files': 'errors.missingFiles',
  'payload too large': 'errors.payloadTooLarge',
  'asset not found': 'errors.assetNotFound',
  'file not found': 'errors.fileNotFound',
  'save failed': 'errors.saveFailed',
  'description is required': 'errors.descriptionRequired',
  'invalid character id': 'errors.invalidCharacterId',
  'invalid url': 'errors.invalidUrl',
  'https only': 'errors.httpsOnly',
  'unknown op': 'errors.unknownOp',
  // Client-side canvas/loader failures share the toast with route errors.
  '2d context unavailable': 'errors.context2dUnavailable',
  'Failed to get canvas context': 'errors.canvasContext',
  'Failed to get bbox source canvas': 'errors.bboxSourceCanvas',
  'Failed to get bbox destination canvas': 'errors.bboxDestCanvas',
  'Failed to get cell canvas context': 'errors.cellCanvasContext',
  'Failed to get final canvas context': 'errors.finalCanvasContext',
  'Failed to get rotation canvas context': 'errors.rotationCanvasContext',
  'Failed to get sheet canvas context': 'errors.sheetCanvasContext',
  'Failed to load image': 'errors.imageLoadFailed',
  'Failed to load original image': 'errors.originalImageLoadFailed',
  'Failed to load extended chunk': 'errors.extendedChunkLoadFailed',
  'Failed to load AI output for alignment': 'errors.alignSourceLoadFailed',
  'Failed to load image for corner reconcile': 'errors.cornerReconcileLoadFailed',
  'Failed to load image for normalization': 'errors.normalizeLoadFailed',
  'Failed to load image for rotation': 'errors.rotationLoadFailed',
  'Failed to load image for slicing': 'errors.sliceLoadFailed',
  'meta.json is missing slug/type': 'errors.metaMissingIds',
  'invalid file': 'errors.invalidFile',
  'probe failed': 'errors.probeFailed',
  'no figure pixels found': 'errors.pixelNoFigure',
}

/** Order matters: the first matching pattern wins. */
const PATTERNS: { re: RegExp; key: MessageKey; names: string[] }[] = [
  {
    re: /^(.+) API key missing\. Add one in Settings\.$/,
    key: 'errors.providerKeyMissing',
    names: ['provider'],
  },
  {
    re: /^asset library unavailable: ([\s\S]+)$/,
    key: 'errors.libraryUnavailable',
    names: ['message'],
  },
  { re: /^invalid file path: ([\s\S]+)$/, key: 'errors.invalidFilePath', names: ['path'] },
  { re: /^invalid payload for ([\s\S]+)$/, key: 'errors.invalidPayload', names: ['path'] },
  { re: /^file too large: ([\s\S]+)$/, key: 'errors.fileTooLarge', names: ['path'] },
  { re: /^width\/height must be integers in (.+)\.\.(.+)$/, key: 'errors.sizeOutOfRange', names: ['min', 'max'] },
  {
    re: /^image_size must be an integer in (.+)\.\.(.+)$/,
    key: 'errors.imageSizeOutOfRange',
    names: ['min', 'max'],
  },
  { re: /^template_id must be one of ([\s\S]+)$/, key: 'errors.templateInvalid', names: ['list'] },
  { re: /^view must be one of ([\s\S]+)$/, key: 'errors.viewInvalid', names: ['list'] },
  { re: /^missing ([\w-]+)$/, key: 'errors.pixelKeyMissing', names: ['header'] },
  { re: /^host (.+) is not a vendor host$/, key: 'errors.notVendorHost', names: ['host'] },
  { re: /^upstream (\d+)$/, key: 'errors.upstreamStatus', names: ['status'] },
  { re: /^could not load (.+)$/, key: 'errors.assetFileLoadFailed', names: ['url'] },
  { re: /^not a data URL/, key: 'errors.notADataUrl', names: [] },
  { re: /^invalid project name: (.+)$/, key: 'errors.invalidProjectNamed', names: ['name'] },
  { re: /^invalid kind: (.+)$/, key: 'errors.invalidKindNamed', names: ['kind'] },
  { re: /^invalid slug: (.+)$/, key: 'errors.invalidSlugNamed', names: ['name'] },
  { re: /^invalid asset file path: (.+)$/, key: 'errors.invalidAssetFilePath', names: ['path'] },
  {
    re: /^path resolves outside the asset library root: (.+)$/,
    key: 'errors.pathOutsideRoot',
    names: ['path'],
  },
  {
    re: /^figure ([\d.]+)px above the (.+) band$/,
    key: 'errors.pixelFigureAboveBand',
    names: ['px', 'band'],
  },
  {
    re: /^figure ([\d.]+)px below the (.+) band$/,
    key: 'errors.pixelFigureBelowBand',
    names: ['px', 'band'],
  },
  {
    re: /^cropToCell: figure (\S+) does not fit (\S+);/,
    key: 'errors.pixelCropTooLarge',
    names: ['figure', 'cell'],
  },
]

/** Resolve a server-authored message to a key + params, or null if unknown. */
export function serverErrorKey(
  message: string
): { key: MessageKey; params?: TranslateParams } | null {
  const exact = EXACT[message]
  if (exact) return { key: exact }
  for (const { re, key, names } of PATTERNS) {
    const match = re.exec(message)
    if (!match) continue
    const params: TranslateParams = {}
    names.forEach((name, i) => {
      params[name] = match[i + 1]
    })
    return { key, params }
  }
  return null
}

/** Render a server-authored error in the current locale; unknown text as-is. */
export function translateServerError(
  message: string,
  t: (key: string, params?: TranslateParams, fallback?: string) => string
): string {
  const resolved = serverErrorKey(message)
  return resolved ? t(resolved.key, resolved.params) : message
}
