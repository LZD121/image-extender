// app/lib/generateRequest.ts
/**
 * The /api/generate wire contract, in one place.
 *
 * The wire stays a bag of flags (`tileSheet: true`, …) because docs/agent-api.md
 * documents that shape and raw HTTP callers send it. Client and server share
 * this module so the kind is named once on the way out (`toWire`) and derived
 * once on the way in (`generateKind`), instead of the four ladders the route
 * used to carry.
 */
import { LAYER_ORDER, type LayerRole } from '@/app/lib/layerRoles'

export type GenerateKind =
  | 'plain'
  | 'parallax'
  | 'tileSheet'
  | 'tileMode'
  | 'spriteAnchor'
  | 'spriteSheet'
  | 'propSheet'
  | 'propMode'

/** Kinds that travel as a boolean flag on the wire. */
type FlagKind = Exclude<GenerateKind, 'plain' | 'parallax'>

/** The mode-specific fields of each kind. */
type KindFields = {
  plain: {}
  parallax: { layerRole: LayerRole }
  tileSheet: { tileGuideImage?: string; tileFixNotes?: string }
  tileMode: { tileRole?: string }
  spriteAnchor: { spriteBodyPlan?: string }
  spriteSheet: {
    spriteAnim?: string
    spriteBodyPlan?: string
    spriteFrameCount?: number
    spriteGridCols?: number
    spriteGridRows?: number
    spriteFrameSize?: number
    spriteGuideImage?: string
    spritePoseGuide?: boolean
    spriteIdentityImage?: string
    spriteFixNotes?: string
  }
  propSheet: { propCols?: number; propRows?: number; propCount?: number; propRefImage?: string; propList?: string[] }
  propMode: { propRole?: string; propRefImage?: string }
}
/** Fields every kind carries — including the BYOK / profile envelope the route reads off the same body. */
type Content = {
  prompt: string
  width: number
  height: number
  artStyle?: string
  sceneBrief?: string
  apiKey?: string
  provider?: string
  model?: string
  profile?: string
}

export type GenerateRequest = Content & { [K in GenerateKind]: { kind: K } & KindFields[K] }[GenerateKind]

/** What the route reads off a parsed body: the same fields, all optional. */
export type GenerateBody = Partial<Content> &
  Partial<
    KindFields['parallax'] &
      KindFields['tileSheet'] &
      KindFields['tileMode'] &
      KindFields['spriteAnchor'] &
      KindFields['spriteSheet'] &
      KindFields['propSheet'] &
      KindFields['propMode']
  > & { [K in FlagKind]?: boolean }

/** A client request as the wire body the route parses. */
export function toWire(request: GenerateRequest): Record<string, unknown> {
  const { kind, ...fields } = request
  return kind === 'plain' || kind === 'parallax' ? fields : { ...fields, [kind]: true }
}

/**
 * Which kind a wire body means. First match wins, in the order the route's
 * prompt ladder used: tileSheet → tileMode → spriteAnchor → spriteSheet →
 * propSheet → propMode → parallax → plain.
 */
export function generateKind(body: GenerateBody): GenerateKind {
  if (body.tileSheet === true) return 'tileSheet'
  if (body.tileMode === true) return 'tileMode'
  if (body.spriteAnchor === true) return 'spriteAnchor'
  if (body.spriteSheet === true) return 'spriteSheet'
  if (body.propSheet === true) return 'propSheet'
  if (body.propMode === true) return 'propMode'
  if (typeof body.layerRole === 'string' && (LAYER_ORDER as readonly string[]).includes(body.layerRole)) return 'parallax'
  return 'plain'
}

/** The message part for one data-URL image; null when the field is absent or not an image data URL. */
export function imageUrlPart(value: unknown): { type: 'image_url'; image_url: { url: string } } | null {
  return typeof value === 'string' && value.startsWith('data:image/')
    ? { type: 'image_url', image_url: { url: value } }
    : null
}
