import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { I18nContext, type I18nContextValue } from './i18n-context'
import {
  applyDocumentLanguage,
  LANGUAGE_STORAGE_KEY,
  resolveInitialLanguage,
  type Language,
  type TranslationParams,
  translations,
} from './i18n-translations'

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, token: string) => {
    const value = params[token]
    return value === undefined ? '' : String(value)
  })
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() =>
    resolveInitialLanguage(window.localStorage, window.navigator.language),
  )

  useEffect(() => {
    applyDocumentLanguage(document, language)
  }, [language])

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => {
        setLanguage(nextLanguage)
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage)
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
