import { NextRequest, NextResponse } from 'next/server'
import { modelOrDefault } from '@/app/lib/llmServer'
import { generateKind, type GenerateBody } from '@/app/lib/generateRequest'
import { generateImage } from '@/app/lib/imageGeneration'
import { buildGeneratePrompt } from '@/app/lib/generatePrompt'

const SUPPORTED_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const

function aspectRatioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number)
  return w / h
}

function supportedAspectRatioForSize(width: number, height: number): string {
  const target = width / height
  return SUPPORTED_IMAGE_ASPECT_RATIOS
    .map((ratio) => ({
      ratio,
      // Compare in log space so 2:1 and 1:2 errors are symmetric.
      error: Math.abs(Math.log(aspectRatioValue(ratio) / target)),
    }))
    .sort((a, b) => a.error - b.error)[0].ratio
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateBody
    const {
      prompt,
      width,
      height,
      apiKey,
      model,
      tileGuideImage,
      spriteGuideImage,
      spritePoseGuide,
      spriteIdentityImage,
      propRefImage,
      provider,
      profile,
    } = body

    if (!prompt || !width || !height) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const modelId = modelOrDefault({ model, provider, profile, kind: 'image' })

    const kind = generateKind(body)

    // The prompt itself lives in lib/generatePrompt — pure, testable, and no
    // longer reachable only through this HTTP handler. `prompt` was narrowed
    // by the guard above, so the builder can require it.
    const fullPrompt = buildGeneratePrompt({ ...body, prompt })

    const messageContent: any[] = []
    if (
      kind === 'tileSheet' &&
      typeof tileGuideImage === 'string' &&
      tileGuideImage.startsWith('data:image/')
    ) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: tileGuideImage },
      })
    }
    // Props style reference — the existing library, so new batches / re-rolls
    // match palette + lighting while painting different decorations.
    if (
      (kind === 'propSheet' || kind === 'propMode') &&
      typeof propRefImage === 'string' &&
      propRefImage.startsWith('data:image/')
    ) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: propRefImage },
      })
    }
    // Sprite-sheet pass references, attached IN ORDER so the prompt's
    // "IMAGE 1 / IMAGE 2" labels line up:
    //   IMAGE 1 = identity reference (the anchor) — what the character looks
    //             like. Carries outfit/palette/proportions.
    //   IMAGE 2 = pose map — a grid of skeletal mannequins, one correct pose
    //             per frame. Carries the motion/structure.
    // Splitting identity from structure is the core of the pose-map fix: the
    // model skins a known character onto known-correct poses instead of
    // inventing either. (Legacy non-pose mode falls back to a single
    // structural guide image.)
    if (
      kind === 'spriteSheet' &&
      spritePoseGuide === true &&
      typeof spriteIdentityImage === 'string' &&
      spriteIdentityImage.startsWith('data:image/')
    ) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: spriteIdentityImage },
      })
    }
    if (
      kind === 'spriteSheet' &&
      typeof spriteGuideImage === 'string' &&
      spriteGuideImage.startsWith('data:image/')
    ) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: spriteGuideImage },
      })
    }
    messageContent.push({
      type: 'text',
      text: fullPrompt,
    })

    // One request either way: the dispatch resolves the credentials once and
    // picks the adapter this gateway needs — chat completions, or APIMart's
    // submit-and-poll task API.
    const image = await generateImage({
      provider,
      profile,
      apiKey,
      referer: request.headers.get('referer'),
      title: 'AI Image Extender - Generator',
      model: modelId,
      prompt: fullPrompt,
      width,
      height,
      // Low temperature on multi-cell sheet generation keeps the model
      // disciplined about the grid layout + per-cell consistency.
      // Sprite sheets need even lower temperature than tile sheets —
      // 8 keyframes of the SAME character on one canvas amplifies any
      // appearance drift between cells (flicker). 0.2 is the value
      // most 2026 sprite-AI pipelines converged on.
      temperature: kind === 'spriteSheet' ? 0.2 : kind === 'tileSheet' ? 0.35 : kind === 'propSheet' ? 0.6 : 0.7,
      references: messageContent
        .filter((part) => part.type === 'image_url')
        .map((part) => part.image_url.url as string),
      content: messageContent,
      extra: {
        modalities: ['image', 'text'],
        // GPT image models are especially literal about the requested canvas
        // aspect. If omitted, OpenRouter/model defaults can come back square;
        // the client then normalizes that square into e.g. a 2048×1024 sprite
        // sheet, visually stretching every frame. Always send the intended
        // reduced aspect ratio (sprites are 2:1, square anchors are 1:1).
        image_config: { aspect_ratio: supportedAspectRatioForSize(width, height) },
      },
    })
    if ('error' in image) return NextResponse.json({ error: image.error }, { status: image.status })

    // For props, the model also returns a text line naming each decoration
    // ("ITEMS: a | b | c"). We parse it so the client can keep a cheap TEXT
    // de-dup list instead of shipping the whole library back as images.
    let names: string[] = []
    if (kind === 'propSheet' || kind === 'propMode') {
      const m = image.text.match(/ITEMS?\s*:\s*(.+)/i)
      const raw = m ? m[1] : image.text
      names = raw
        .split(/[|\n,]+/)
        .map((s) => s.replace(/^[\s\-*\d.)]+/, '').trim().toLowerCase())
        .filter((s) => s.length > 0 && s.length <= 40)
        .slice(0, 64)
    }

    return NextResponse.json({
      imageUrl: image.imageUrl,
      names,
      cost: image.cost,
      provider: image.provider,
      model: image.model,
      ...(image.size ? { requestedSize: image.size } : {}),
    })
  } catch (error) {
    console.error('Error in generate route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

