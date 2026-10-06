import type { Namespace } from '@/app/i18n/types'

/**
 * App chrome: the document title (applied on locale change by
 * `app/lib/i18n.tsx`) and the language switcher's own labels. The switcher
 * shows both languages by their native name, so those two values are the same
 * in every locale.
 */
export const app: Namespace = {
  en: {
    'app.title': 'Extender — AI Image Outpainting',
    'app.language.switch': 'Language',
    'app.language.en': 'English',
    'app.language.zh': '中文',
  },
  zh: {
    'app.title': 'Extender — AI 图像扩图',
    'app.language.switch': '语言',
    'app.language.en': 'English',
    'app.language.zh': '中文',
  },
}
