/**
 * i18n registry — locale list, message aggregation, and the key type.
 *
 * Messages live in one module per area (`app/i18n/messages/<area>.ts`) so the
 * vocabulary is greppable and no two areas share a file. Each module exports
 * `{ en, zh }`; this file flattens them into `messages[locale][key]`.
 *
 * Keys are flat dotted strings (`shell.topbar.newImage`). The Chinese map is
 * typed against the English key set, so a missing translation is a compile
 * error — not a silent English fallback.
 */

import { app } from './messages/app'
import { common } from './messages/common'
import { errors } from './messages/errors'
import { extender } from './messages/extender'
import { modals } from './messages/modals'
import { parallax } from './messages/parallax'
import { pixel } from './messages/pixel'
import { props } from './messages/props'
import { shell } from './messages/shell'
import { sprite } from './messages/sprite'
import { tile } from './messages/tile'


/** Values interpolated into `{placeholder}` slots of a message. */
export type TranslateParams = Record<string, string | number>

export type Locale = 'en' | 'zh'

/** One message module: the same keys in every locale. */
export type Namespace = {
  en: Record<string, string>
  zh: Record<string, string>
}

export const LOCALES: readonly Locale[] = ['en', 'zh']

/** Languages the switcher offers; the native name is never translated. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
}

export const DEFAULT_LOCALE: Locale = 'en'

export const LOCALE_STORAGE_KEY = 'extender:locale'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

const en = {
  ...app.en,
  ...common.en,
  ...errors.en,
  ...shell.en,
  ...modals.en,
  ...extender.en,
  ...parallax.en,
  ...sprite.en,
  ...tile.en,
  ...props.en,
  ...pixel.en,
}

/**
 * Every English key, plus its translation. Typed as a full record so an
 * untranslated key fails `tsc` instead of shipping English to a zh user.
 */
const zh: Record<keyof typeof en, string> = {
  ...app.zh,
  ...common.zh,
  ...errors.zh,
  ...shell.zh,
  ...modals.zh,
  ...extender.zh,
  ...parallax.zh,
  ...sprite.zh,
  ...tile.zh,
  ...props.zh,
  ...pixel.zh,
}

export const messages: Record<Locale, Record<string, string>> = { en, zh }

export type MessageKey = Extract<keyof typeof en, string>

/**
 * A known key (autocompleted and typo-checked) *or* any string, for keys built
 * at runtime from data ids (`common.artStyle.${option.value}`). Runtime keys are
 * covered by `app/i18n/__tests__/messages.test.ts`.
 */
export type AnyMessageKey = MessageKey | (string & {})
