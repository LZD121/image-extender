import { APP_ERROR_MESSAGES, type AppErrorCode } from '@/app/lib/appErrors'
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

/**
 * Every app-authored message a route can put on the wire, with the key it
 * translates to. Exhaustive by type: adding a message to `APP_ERROR_MESSAGES`
 * without a key here does not compile.
 */
const KEY_BY_CODE: Record<AppErrorCode, MessageKey> = {
  missingFields: 'errors.missingFields',
  missingPreviewImage: 'errors.missingPreviewImage',
  missingAnchorPrompt: 'errors.missingAnchorPrompt',
  missingBiomePrompt: 'errors.missingBiomePrompt',
  noSceneBrief: 'errors.noSceneBrief',
  noPropIdeas: 'errors.noPropIdeas',
  noImageInResponse: 'errors.noImageInResponse',
  noImageGenerated: 'errors.noImageGenerated',
  noMessageInResponse: 'errors.noMessageInResponse',
  gatewayInvalidJson: 'errors.gatewayInvalidJson',
  invalidJsonBody: 'errors.invalidJsonBody',
  internal: 'errors.internal',
  missingRouteParams: 'errors.missingRouteParams',
  invalidAssetPath: 'errors.invalidAssetPath',
  invalidProject: 'errors.invalidProject',
  invalidKind: 'errors.invalidKind',
  invalidSlug: 'errors.invalidSlug',
  missingMeta: 'errors.missingMeta',
  missingFiles: 'errors.missingFiles',
  payloadTooLarge: 'errors.payloadTooLarge',
  assetNotFound: 'errors.assetNotFound',
  fileNotFound: 'errors.fileNotFound',
  saveFailed: 'errors.saveFailed',
  metaMissingIds: 'errors.metaMissingIds',
  notADataUrl: 'errors.notADataUrl',
  invalidFile: 'errors.invalidFile',
  descriptionRequired: 'errors.descriptionRequired',
  invalidCharacterId: 'errors.invalidCharacterId',
  invalidUrl: 'errors.invalidUrl',
  httpsOnly: 'errors.httpsOnly',
  unknownOp: 'errors.unknownOp',
  probeFailed: 'errors.probeFailed',
}

/**
 * Messages the browser's own canvas and loader helpers throw. They never cross
 * the wire, so they are authored where they are thrown rather than registered
 * in `app/lib/appErrors.ts` — but they share this toast, so they map here.
 */
const CLIENT_EXACT: Record<string, MessageKey> = {
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
  'no figure pixels found': 'errors.pixelNoFigure',
}

/** Wire text and client text, both read back as keys. First match wins. */
const EXACT: Record<string, MessageKey> = {
  ...Object.fromEntries(
    (Object.keys(APP_ERROR_MESSAGES) as AppErrorCode[]).map((code) => [
      APP_ERROR_MESSAGES[code],
      KEY_BY_CODE[code],
    ])
  ),
  ...CLIENT_EXACT,
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
