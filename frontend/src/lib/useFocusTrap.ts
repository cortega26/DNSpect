import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, isActive: boolean) {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isActive) return

    previousFocusRef.current = document.activeElement as HTMLElement | null

    const containerEl = containerRef.current
    if (!containerEl) return

    const focusableElements = containerEl.querySelectorAll<HTMLElement>(FOCUSABLE)
    const firstFocusable = focusableElements[0]

    firstFocusable?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      if (!containerEl) return
      const currentFocusableElements = containerEl.querySelectorAll<HTMLElement>(FOCUSABLE)
      const first = currentFocusableElements[0]
      const last = currentFocusableElements[currentFocusableElements.length - 1]

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [isActive, containerRef])
}
