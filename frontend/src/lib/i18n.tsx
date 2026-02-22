import { useMemo, useState, type ReactNode } from 'react'

import { I18nContext, type I18nContextValue } from './i18n-context'
import { type Language, type TranslationParams, translations } from './i18n-translations'

const STORAGE_KEY = 'dnspect-language'

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, token: string) => {
    const value = params[token]
    return value === undefined ? '' : String(value)
  })
}

function detectInitialLanguage(): Language {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'es' || stored === 'en' || stored === 'pt') return stored
  const candidate = window.navigator.language.slice(0, 2).toLowerCase()
  if (candidate === 'en' || candidate === 'pt') return candidate
  return 'es'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => detectInitialLanguage())

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => {
        setLanguage(nextLanguage)
        window.localStorage.setItem(STORAGE_KEY, nextLanguage)
      },
      t: (key, params) => {
        const localized = translations[language][key] ?? translations.es[key]
        return interpolate(localized, params)
      },
    }),
    [language],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
