'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isLocale,
  messages,
  type AnyMessageKey,
  type Locale,
  type TranslateParams,
} from '@/app/i18n'

/** `t` — look up `key` in the active locale, then interpolate `params`. */
export type Translate = (
  key: AnyMessageKey,
  params?: TranslateParams,
  /** Shown when the key is missing — for keys built from data ids whose value
   *  may not be in the dictionary (a gateway-discovered model, say). */
  fallback?: string
) => string

type I18nValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
}

const I18nContext = createContext<I18nValue | null>(null)

/** Replace `{name}` slots; unknown slots are left alone rather than blanked. */
export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (slot, name: string) =>
    name in params ? String(params[name]) : slot
  )
}

/**
 * Holds the active locale. There is no routing: the app is one page, so the
 * locale is UI state persisted in localStorage (`extender:locale`), applied to
 * `<html lang>` and the document title, and read by every component through
 * `useI18n()`. First paint is always the default locale; the stored choice is
 * applied on mount, so server-rendered HTML never mismatches.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
      if (isLocale(stored)) setLocaleState(stored)
    } catch {
      // Private mode / storage disabled: the default locale is enough.
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    const title = messages[locale]['app.title']
    if (title) document.title = title
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      // Persisting the choice is best-effort.
    }
  }, [])

  const t = useCallback<Translate>(
    (key, params, fallback) =>
      interpolate(messages[locale][key] ?? fallback ?? key, params),
    [locale]
  )

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n() requires <I18nProvider> (app/layout.tsx)')
  return value
}

/** For components that only translate — same context, narrower surface. */
export function useT(): Translate {
  return useI18n().t
}
