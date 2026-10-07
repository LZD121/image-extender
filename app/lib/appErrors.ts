// app/lib/appErrors.ts
/**
 * The messages this app authors for its own HTTP errors — the ones that cross
 * the wire as `{ error }` and come back to the user through the toast.
 *
 * They are named here rather than spelled out at each throw because the client
 * has to map the English back onto an i18n key (`app/i18n/serverErrors.ts`), and
 * a message written in two places drifts: the mapper had grown seven entries
 * whose text no longer existed anywhere, and one that a deleted route had
 * authored. `serverErrors.test.ts` fails if a message here has no producer in
 * the source, or no key in both locales.
 *
 * Messages thrown by the browser's canvas and loader helpers are NOT here: they
 * never leave the page, so they stay authored where they are thrown.
 */
export const APP_ERROR_MESSAGES = {
  missingFields: 'Missing required fields',
  missingPreviewImage: 'Missing preview image',
  missingAnchorPrompt: 'Missing anchor prompt',
  missingBiomePrompt: 'Missing biome prompt',
  noSceneBrief: 'No scene brief returned from model',
  noPropIdeas: 'Art director returned no usable ideas',
  noImageInResponse:
    'The model responded without an image. It may not support image extension yet.',
  noImageGenerated: 'No image generated. The model may not support pure image generation.',
  noMessageInResponse: 'No message in response',
  gatewayInvalidJson: 'Gateway returned invalid JSON',
  invalidJsonBody: 'Invalid JSON body',
  internal: 'Internal server error',
  missingRouteParams: 'missing route params',
  invalidAssetPath: 'invalid asset path',
  invalidProject: 'invalid project',
  invalidKind: 'invalid kind',
  invalidSlug: 'invalid slug',
  missingMeta: 'missing meta',
  missingFiles: 'missing files',
  payloadTooLarge: 'payload too large',
  assetNotFound: 'asset not found',
  fileNotFound: 'file not found',
  saveFailed: 'save failed',
  metaMissingIds: 'meta.json is missing slug/type',
  notADataUrl: 'not a data URL (expected data:image/png|jpeg|webp;base64,…)',
  invalidFile: 'invalid file',
  descriptionRequired: 'description is required',
  invalidCharacterId: 'invalid character id',
  invalidUrl: 'invalid url',
  httpsOnly: 'https only',
  unknownOp: 'unknown op',
  probeFailed: 'probe failed',
} as const

export type AppErrorCode = keyof typeof APP_ERROR_MESSAGES
