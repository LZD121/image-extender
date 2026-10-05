import { describe, expect, it } from 'vitest'
import { STORAGE_MODE } from '@/app/lib/app'

describe('test harness', () => {
  it('resolves the @ alias and imports app modules', () => {
    expect(STORAGE_MODE).toBe('extender:mode')
  })
})
