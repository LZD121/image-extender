import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROVIDER,
  isProviderId,
  looksLikeImageModel,
  pickableModels,
  vendorOf,
  type GatewayModel,
} from '@/app/lib/providers'

describe('isProviderId', () => {
  it('accepts only the supported gateways', () => {
    expect(isProviderId('openrouter')).toBe(true)
    expect(isProviderId('magpie')).toBe(true)
    expect(isProviderId('teamo')).toBe(false)
    expect(isProviderId(undefined)).toBe(false)
    expect(isProviderId('')).toBe(false)
  })

  it('defaults to OpenRouter', () => {
    expect(DEFAULT_PROVIDER).toBe('openrouter')
  })
})

describe('looksLikeImageModel', () => {
  it('recognises the image models the gateways actually expose', () => {
    for (const id of [
      'google/gemini-3.1-flash-image-preview',
      'google/gemini-2.5-flash-image',
      'teamo-router/gemini-3.1-flash-image',
      'google/gemini-3.1-flash-image',
      'teamo-router/gpt-image-2',
      'openai/gpt-image-1',
    ]) {
      expect(looksLikeImageModel(id), id).toBe(true)
    }
  })

  it('leaves chat and code models alone', () => {
    for (const id of [
      'commandcode/Qwen/Qwen3.7-Plus',
      'claude/sonnet-4.5',
      'group/auto-gpt-5-6-sol',
      'google/gemini-2.0-flash-001',
      'opencode-go/kimi-k2',
    ]) {
      expect(looksLikeImageModel(id), id).toBe(false)
    }
  })
})


/** The image ids the local magpie gateway reported on 2026-10-06. */
const MAGPIE_REPORTED: GatewayModel[] = [
  ['antigravity/gemini-3.1-flash-image', 'antigravity'],
  ['google/gemini-2.5-flash-image', 'google'],
  ['google/gemini-3.1-flash-image', 'google'],
  ['group/auto-gemini-3-1-flash-image', 'group'],
  ['teamo-router/gemini-3.1-flash-image', 'teamo-router'],
  ['teamo-router/gpt-image-2', 'teamo-router'],
  ['teamo-router/gpt-image-2.5-flare', 'teamo-router'],
  ['teamo-router/gpt-image-2.5-sunburst', 'teamo-router'],
  ['commandcode/Qwen/Qwen3.7-Plus', 'commandcode'],
  ['claude/sonnet-4.5', 'claude'],
].map(([id, vendor]) => ({ id, vendor, imageCapable: looksLikeImageModel(id) }))

describe('pickableModels', () => {
  it('offers only the magpie ids this project has verified, keeping the rest aside', () => {
    const pick = pickableModels('magpie', MAGPIE_REPORTED)
    expect(pick.curated).toBe(false)
    expect(pick.verifiedImage.map((m) => m.id)).toEqual(['teamo-router/gemini-3.1-flash-image'])
    // The three gpt-image ids refuse /v1/chat/completions, and the google /
    // antigravity / group ids need upstream credentials this gateway lacks.
    expect(pick.otherImage).toHaveLength(7)
    expect(pick.verifiedQa.map((m) => m.id)).toEqual(['commandcode/Qwen/Qwen3.7-Plus'])
    expect(pick.otherQa.map((m) => m.id)).toEqual(['claude/sonnet-4.5'])
  })

  it('treats a curated gateway as verified by construction', () => {
    const pick = pickableModels('openrouter', MAGPIE_REPORTED)
    expect(pick.curated).toBe(true)
    expect(pick.verifiedImage).toHaveLength(8)
    expect(pick.otherImage).toEqual([])
    expect(pick.verifiedQa.map((m) => m.id)).toEqual(['commandcode/Qwen/Qwen3.7-Plus', 'claude/sonnet-4.5'])
    expect(pick.otherQa).toEqual([])
  })

  it('offers nothing when the gateway reports nothing', () => {
    const pick = pickableModels('magpie', [])
    expect(pick.verifiedImage).toEqual([])
    expect(pick.otherImage).toEqual([])
  })
})

describe('vendorOf', () => {
  it('splits the vendor prefix off a gateway model id', () => {
    expect(vendorOf('teamo-router/gemini-3.1-flash-image')).toBe('teamo-router')
    expect(vendorOf('google/gemini-2.5-flash-image')).toBe('google')
    expect(vendorOf('local-model')).toBe('local-model')
  })
})
