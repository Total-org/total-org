import { useEffect } from 'react'
import { isAnyModalOpen, isSaveChord, saveActionIn } from '../components/kit/layers'

/**
 * Phase 5 — ⌘↵ / Ctrl+Enter saves on a SCREEN in both modes. Screens with their own key (the
 * voucher editors, the simple flows) handle it themselves; any other screen marks its one Save
 * button `data-save-shortcut` and this presses it — only with no dialog open (a dialog's own
 * ⌘↵ is the dialog layer's, kit/layers.ts), only when exactly one marked button is usable, and
 * only after the screen's own handlers had the key (bubble phase, `defaultPrevented`).
 */
export function pageSaveShortcut(e: KeyboardEvent, root: ParentNode | null = document.getElementById('main')): boolean {
  if (e.defaultPrevented || !isSaveChord(e) || isAnyModalOpen() || !root) return false
  const button = saveActionIn(root, { primary: false })
  if (!button) return false
  e.preventDefault()
  button.click()
  return true
}

export function usePageSaveShortcut(): void {
  useEffect(() => {
    const h = (e: KeyboardEvent): void => void pageSaveShortcut(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}
