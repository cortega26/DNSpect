import { describe, expect, it } from 'vitest'

import { applyDocumentLanguage, resolveInitialLanguage } from './i18n-translations'

function memoryStorage(entries: Record<string, string>): Pick<Storage, 'getItem'> {
  return {
    getItem: (key) => entries[key] ?? null,
  }
}

describe('resolveInitialLanguage', () => {
  it('prefers a stored language', () => {
    expect(resolveInitialLanguage(memoryStorage({ 'dnspect-language': 'en' }), 'es-ES')).toBe('en')
    expect(resolveInitialLanguage(memoryStorage({ 'dnspect-language': 'pt' }), 'en-US')).toBe('pt')
    expect(resolveInitialLanguage(memoryStorage({ 'dnspect-language': 'es' }), 'pt-BR')).toBe('es')
  })

  it('falls back to a supported browser language', () => {
    expect(resolveInitialLanguage(null, 'pt-BR')).toBe('pt')
    expect(resolveInitialLanguage(memoryStorage({}), 'en-GB')).toBe('en')
  })

  it('falls back to Spanish for unsupported browser languages', () => {
    expect(resolveInitialLanguage(null, 'fr-FR')).toBe('es')
    expect(resolveInitialLanguage(null, '')).toBe('es')
    expect(resolveInitialLanguage(memoryStorage({}), 'de')).toBe('es')
  })

  it('ignores invalid stored values', () => {
    expect(resolveInitialLanguage(memoryStorage({ 'dnspect-language': 'xx' }), 'en-US')).toBe('en')
  })
})

describe('applyDocumentLanguage', () => {
  it('sets the document root language', () => {
    const root = { documentElement: { lang: 'es' } }
    applyDocumentLanguage(root, 'pt')
    expect(root.documentElement.lang).toBe('pt')
  })

  it('updates on a later language change', () => {
    const root = { documentElement: { lang: 'es' } }
    applyDocumentLanguage(root, 'en')
    applyDocumentLanguage(root, 'pt')
    expect(root.documentElement.lang).toBe('pt')
  })

  it('does not crash without a document root', () => {
    expect(() => applyDocumentLanguage(null, 'es')).not.toThrow()
  })
})
