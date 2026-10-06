import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCALES, messages } from '@/app/i18n'
import { ART_STYLE_GROUPS } from '@/app/lib/artStyles'
import { BODY_PLANS } from '@/app/lib/bodyPlans'
import { LAYER_ROLES, PARALLAX_TARGET_PRESETS } from '@/app/lib/parallax'
import { SPRITE_ANIMATIONS, SPRITE_CHARACTER_PRESETS } from '@/app/lib/sprite'
import { TILESET_PRESETS, TILESET_SLOTS } from '@/app/lib/tileset'

/**
 * Guards the dictionary itself:
 *  • every locale carries every key (a missing zh translation is a bug, not a
 *    silent English fallback),
 *  • no entry is an empty string,
 *  • the keys built at runtime from data ids (`common.artStyle.<value>`,
 *    `common.anim.<type>`, …) actually exist for every id the libs ship.
 */

const en = messages.en
const zh = messages.zh

const keys = (dict: Record<string, string>) => Object.keys(dict).sort()

describe('message dictionaries', () => {
  it('has the same key set in every locale', () => {
    expect(keys(zh)).toEqual(keys(en))
  })

  for (const locale of LOCALES) {
    it(`${locale}: no empty values`, () => {
      const empty = Object.entries(messages[locale])
        .filter(([, value]) => value.trim().length === 0)
        .map(([key]) => key)
      expect(empty).toEqual([])
    })

    it(`${locale}: no value is a raw key`, () => {
      const selfNamed = Object.entries(messages[locale])
        .filter(([key, value]) => value === key)
        .map(([key]) => key)
      expect(selfNamed).toEqual([])
    })
  }
})

/** Every runtime-built key must resolve in both locales. */
const dataDriven: string[] = [
  ...ART_STYLE_GROUPS.flatMap((g) =>
    g.options.map((o) => `common.artStyle.${o.value}`)
  ),
  ...ART_STYLE_GROUPS.map((g) => `common.artStyleGroup.${g.id}`),
  'common.artStyle.fallback',
  ...Object.keys(LAYER_ROLES).flatMap((role) => [
    `common.layer.${role}.label`,
    `common.layer.${role}.short`,
    `common.layer.${role}.hint`,
  ]),
  ...PARALLAX_TARGET_PRESETS.flatMap((p) => [
    `common.parallaxTarget.${p.value}.label`,
    `common.parallaxTarget.${p.value}.hint`,
  ]),
  ...TILESET_SLOTS.map((s) => s.role).flatMap((role) => [
    `common.tileRole.${role}.label`,
    `common.tileRole.${role}.hint`,
  ]),
  ...TILESET_PRESETS.map((p) => `common.tilePreset.${p.id}`),
  ...Object.keys(SPRITE_ANIMATIONS).flatMap((anim) => [
    `common.anim.${anim}.label`,
    `common.anim.${anim}.hint`,
  ]),
  ...Object.keys(BODY_PLANS).flatMap((plan) => [
    `common.bodyPlan.${plan}.label`,
    `common.bodyPlan.${plan}.hint`,
  ]),
  ...Object.values(BODY_PLANS).flatMap((plan) =>
    plan.presets.map((preset: { id: string }) => `common.creature.${preset.id}`)
  ),
  ...SPRITE_CHARACTER_PRESETS.map((p) => `common.creature.${p.id}`),
  ...['extender', 'parallax', 'tile', 'props', 'sprite', 'pixel'].flatMap((mode) => [
    `common.mode.${mode}.label`,
    `common.mode.${mode}.hint`,
  ]),
]

describe('data-driven keys', () => {
  for (const locale of LOCALES) {
    it(`${locale}: every lib id has a message`, () => {
      const missing = dataDriven.filter((key) => !(key in messages[locale]))
      expect(missing).toEqual([])
    })
  }
})

/**
 * Keys written as literals in components must exist. Catches typos and keys an
 * unfinished namespace never received — static analysis cannot see the runtime
 * (`\`common.anim.${x}\``) form, which the block above covers instead.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== '.next') sourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry) && !full.includes('__tests__')) {
      out.push(full)
    }
  }
  return out
}

const LITERAL_CALL = /(?<![\w$.])t\(\s*(['"])([^'"]+)\1\s*[,)]/g

const ROOT = path.resolve(__dirname, '../../..')

const TRANSLATED_FILES = sourceFiles(path.join(ROOT, 'app')).filter(
  (f) => !f.startsWith(path.join(ROOT, 'app', 'i18n')) && !f.endsWith('lib/i18n.tsx')
)

const literalCalls = TRANSLATED_FILES.flatMap((file) =>
  Array.from(readFileSync(file, 'utf8').matchAll(LITERAL_CALL)).map((match) => ({
    file: path.relative(ROOT, file),
    key: match[2],
  }))
)

describe('literal t() keys', () => {
  it('all resolve to messages', () => {
    const unresolved = literalCalls
      .filter(({ key }) => !(key in en) || !(key in zh))
      .map(({ file, key }) => `${file}: ${key}`)
    expect(unresolved).toEqual([])
  })

  it('finds the call sites it is meant to check', () => {
    // A regex that matched nothing would make the assertion above vacuous, so
    // require the converted surfaces to be present.
    expect(literalCalls.length).toBeGreaterThan(50)
    expect(literalCalls.some(({ file }) => file.endsWith('page.tsx'))).toBe(true)
  })
})
