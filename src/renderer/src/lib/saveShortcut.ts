import { useEffect } from 'react'
import { isAnyModalOpen, pressForSave, saveActionIn } from '../components/kit/layers'

/**
 * Phase 5 — ⌘↵ / Ctrl+Enter saves on a SCREEN in both modes. Screens with their own key (the
 * voucher editors, the simple flows) handle it themselves; any other screen marks its one Save
 * button `data-save-shortcut` and this presses it — only with no dialog open (a dialog's own
 * ⌘↵ is the dialog layer's, kit/layers.ts), only when exactly one marked button is usable, only
 * for a key typed on the screen itself (never from a side panel's box — review of #258), and in
 * the phases of `pressForSave` (a field's own Enter handler never runs the save a second time).
 */
export function pageSaveShortcut(e: KeyboardEvent, phase: 'capture' | 'bubble' = 'capture', root: HTMLElement | null = document.getElementById('main')): boolean {
  if (isAnyModalOpen() || !root) return false
  const t = e.target
  const onScreen = !(t instanceof Node) || t === document.body || t === document.documentElement || root.contains(t)
  if (!onScreen) return false
  return pressForSave(e, phase, () => saveActionIn(root, { primary: false }))
}

export function usePageSaveShortcut(): void {
  useEffect(() => {
    const capture = (e: KeyboardEvent): void => void pageSaveShortcut(e, 'capture')
    const bubble = (e: KeyboardEvent): void => void pageSaveShortcut(e, 'bubble')
    window.addEventListener('keydown', capture, true)
    window.addEventListener('keydown', bubble)
    return () => {
      window.removeEventListener('keydown', capture, true)
      window.removeEventListener('keydown', bubble)
    }
  }, [])
}
