import { NextRequest, NextResponse } from 'next/server'

import { llmTarget, modelOrDefault } from '@/app/lib/llmServer'
import { chatCompletion } from '@/app/lib/llmChat'
import { messageText } from '@/app/lib/llmResponse'
import { buildSceneBriefPrompt } from '@/app/lib/briefPrompt'

export async function POST(request: NextRequest) {
  try {
    const { anchorPrompt, artStyle, apiKey, model, provider, profile } = await request.json()

    if (!anchorPrompt || typeof anchorPrompt !== 'string' || !anchorPrompt.trim()) {
      return NextResponse.json(
        { error: 'Missing anchor prompt' },
        { status: 400 }
      )
    }

    const target = llmTarget({
      provider,
      profile,
      apiKey,
      referer: request.headers.get('referer'),
      title: 'AI Image Extender - Scene Brief',
    })
    if ('error' in target) return NextResponse.json({ error: target.error }, { status: 401 })

    const modelId = modelOrDefault({ model, provider, profile, kind: 'qa' })

    const { system, user } = buildSceneBriefPrompt({ anchorPrompt, artStyle })

    const reply = await chatCompletion({
      target,
      model: modelId,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 400,
      temperature: 0.4,
    })
    if (!reply.ok) return NextResponse.json({ error: reply.error }, { status: reply.status })

    const sceneBrief = messageText(reply.message.content).trim()
    if (!sceneBrief) {
      return NextResponse.json(
        { error: 'No scene brief returned from model' },
        { status: 500 }
      )
    }

    return NextResponse.json({ sceneBrief })
  } catch (error) {
    console.error('Error in scene-brief route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
