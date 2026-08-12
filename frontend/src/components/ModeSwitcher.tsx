import { useRef, type KeyboardEvent } from 'react'

import type { AppMode } from '@/lib/types'
import { useI18n } from '@/lib/useI18n'

export interface ModeSwitcherProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

const MODES: AppMode[] = ['quick', 'lab']

const LABEL_KEY: Record<AppMode, 'mode.quick' | 'mode.lab'> = {
  quick: 'mode.quick',
  lab: 'mode.lab',
}

export function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  const { t } = useI18n()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function select(nextMode: AppMode) {
    onChange(nextMode)
    const index = MODES.indexOf(nextMode)
    tabRefs.current[index]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 1 : -1
      select(MODES[(index + delta + MODES.length) % MODES.length])
    } else if (event.key === 'Home') {
      event.preventDefault()
      select(MODES[0])
    } else if (event.key === 'End') {
      event.preventDefault()
      select(MODES[MODES.length - 1])
    }
  }

  return (
    <div className="modeswitcher" role="tablist" aria-label={t('controls.mode')}>
      {MODES.map((appMode, index) => (
        <button
          key={appMode}
          ref={(element) => {
            tabRefs.current[index] = element
          }}
          type="button"
          role="tab"
          id={`mode-tab-${appMode}`}
          aria-selected={mode === appMode}
          tabIndex={mode === appMode ? 0 : -1}
          className={`mode-tab${mode === appMode ? ' is-active' : ''}`}
          onClick={() => onChange(appMode)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {t(LABEL_KEY[appMode])}
        </button>
      ))}
    </div>
  )
}
