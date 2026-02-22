import { createContext } from 'react'

import type { Language, TranslationKey, TranslationParams } from './i18n-translations'

export interface I18nContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: TranslationKey, params?: TranslationParams) => string
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined)
