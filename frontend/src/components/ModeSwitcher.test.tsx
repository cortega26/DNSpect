// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/lib/i18n'

import { ModeSwitcher } from './ModeSwitcher'

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nProvider, null, children)
}

describe('ModeSwitcher', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders two tabs with the quick mode selected and in the tab order', () => {
    render(<ModeSwitcher mode="quick" onChange={vi.fn()} />, { wrapper: Wrapper })

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].textContent).toContain('Quick check')
    expect(tabs[1].textContent).toContain('Lab')
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].getAttribute('tabindex')).toBe('0')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')
    expect(tabs[1].getAttribute('tabindex')).toBe('-1')
  })

  it('fires the callback when a tab is clicked', () => {
    const onChange = vi.fn()
    render(<ModeSwitcher mode="quick" onChange={onChange} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('tab', { name: 'Lab' }))
    expect(onChange).toHaveBeenCalledWith('lab')

    fireEvent.click(screen.getByRole('tab', { name: 'Quick check' }))
    expect(onChange).toHaveBeenCalledWith('quick')
  })

  it('arrow keys move selection both ways', () => {
    const onChange = vi.fn()
    render(<ModeSwitcher mode="quick" onChange={onChange} />, { wrapper: Wrapper })

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Quick check' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('lab')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Lab' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledWith('quick')
  })

  it('Home and End jump to the first and last tab', () => {
    const onChange = vi.fn()
    render(<ModeSwitcher mode="lab" onChange={onChange} />, { wrapper: Wrapper })

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Lab' }), { key: 'Home' })
    expect(onChange).toHaveBeenCalledWith('quick')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Quick check' }), { key: 'End' })
    expect(onChange).toHaveBeenCalledWith('lab')
  })

  it('aria-selected follows the controlled mode prop on re-render', () => {
    const { rerender } = render(<ModeSwitcher mode="quick" onChange={vi.fn()} />, { wrapper: Wrapper })
    rerender(createElement(ModeSwitcher, { mode: 'lab', onChange: vi.fn() }))

    expect(screen.getByRole('tab', { name: 'Lab' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Quick check' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: 'Lab' }).getAttribute('tabindex')).toBe('0')
  })
})
