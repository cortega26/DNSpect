import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { Language } from '@/lib/i18n-translations'
import { useI18n } from '@/lib/useI18n'

const languageOptions: Array<{ value: Language; code: string; srLabel: string }> = [
  { value: 'es', code: 'ES', srLabel: 'Español' },
  { value: 'en', code: 'EN', srLabel: 'English' },
  { value: 'pt', code: 'PT', srLabel: 'Português' },
]

export interface LocaleMenuProps {
  language: Language
  onLanguageChange: (language: Language) => void
}

export function LocaleMenu({ language, onLanguageChange }: LocaleMenuProps) {
  const { t } = useI18n()
  const [localeMenuOpen, setLocaleMenuOpen] = useState<boolean>(false)
  const localeMenuRef = useRef<HTMLDivElement>(null)
  const localeTriggerRef = useRef<HTMLButtonElement>(null)
  const localeOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeLanguage = languageOptions.find((option) => option.value === language) ?? languageOptions[0]
  const activeLanguageIndex = Math.max(0, languageOptions.findIndex((option) => option.value === language))

  useEffect(() => {
    if (!localeMenuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (localeMenuRef.current && !localeMenuRef.current.contains(event.target as Node)) {
        setLocaleMenuOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setLocaleMenuOpen(false)
      localeTriggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [localeMenuOpen])

  function closeLocaleMenu(restoreTriggerFocus = false) {
    setLocaleMenuOpen(false)
    if (restoreTriggerFocus) {
      requestAnimationFrame(() => {
        localeTriggerRef.current?.focus()
      })
    }
  }

  function focusLocaleOption(index: number) {
    if (languageOptions.length === 0) return
    const safeIndex = (index + languageOptions.length) % languageOptions.length
    localeOptionRefs.current[safeIndex]?.focus()
  }

  function openLocaleMenuAndFocus(index = activeLanguageIndex) {
    setLocaleMenuOpen(true)
    requestAnimationFrame(() => {
      focusLocaleOption(index)
    })
  }

  function onLocaleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (event.key === 'ArrowUp') {
        openLocaleMenuAndFocus(languageOptions.length - 1)
      } else {
        openLocaleMenuAndFocus(activeLanguageIndex)
      }
      return
    }

    if (event.key === 'Escape' && localeMenuOpen) {
      event.preventDefault()
      closeLocaleMenu(true)
    }
  }

  function onLocaleItemKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusLocaleOption(index + 1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusLocaleOption(index - 1)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      focusLocaleOption(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      focusLocaleOption(languageOptions.length - 1)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeLocaleMenu(true)
      return
    }

    if (event.key === 'Tab') {
      setLocaleMenuOpen(false)
    }
  }

  return (
    <div className="locale-menu" ref={localeMenuRef}>
      <button
        ref={localeTriggerRef}
        className={`select-inline locale-trigger${localeMenuOpen ? ' is-open' : ''}`}
        type="button"
        aria-label={`${t('header.language')}: ${activeLanguage.srLabel}`}
        aria-haspopup="menu"
        aria-controls="locale-menu-options"
        aria-expanded={localeMenuOpen}
        onClick={() => setLocaleMenuOpen((prev) => !prev)}
        onKeyDown={onLocaleTriggerKeyDown}
      >
        <span className="locale-current" aria-hidden="true">
          <span className="locale-code-badge">{activeLanguage.code}</span>
        </span>
        <span className="select-caret" aria-hidden="true">▾</span>
      </button>
      {localeMenuOpen ? (
        <div id="locale-menu-options" className="locale-dropdown" role="menu" aria-label={t('header.language')}>
          {languageOptions.map((option, index) => {
            const selected = option.value === language
            return (
              <button
                key={option.value}
                ref={(el) => { localeOptionRefs.current[index] = el }}
                className={`locale-item${selected ? ' is-active' : ''}`}
                type="button"
                role="menuitemradio"
                aria-label={option.srLabel}
                aria-checked={selected}
                onKeyDown={(event) => onLocaleItemKeyDown(event, index)}
                onClick={() => { onLanguageChange(option.value); closeLocaleMenu(true) }}
              >
                <span className="locale-code-badge">{option.code}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
