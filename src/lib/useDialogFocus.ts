import { useEffect, useRef } from 'react'

export function useDialogFocus<T extends HTMLElement>(open = true) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!open) return
    const dialog = ref.current
    if (!dialog) return
    const activeDialog: T = dialog
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

    activeDialog.querySelector<HTMLElement>(focusableSelector)?.focus()

    function trapFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      const focusable =
        activeDialog.querySelectorAll<HTMLElement>(focusableSelector)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (!activeDialog.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    activeDialog.addEventListener('keydown', trapFocus)
    return () => {
      activeDialog.removeEventListener('keydown', trapFocus)
      previous?.focus()
    }
  }, [open])

  return ref
}
