import { useEffect, useRef, type RefObject } from 'react'

/**
 * The dialog-layer stack shared by Modal and Drawer (and consulted by useKeyNav and Popover).
 * Only the topmost layer responds to Esc/Tab, so stacked layers (a ConfirmModal over a Drawer over
 * the screen) close one at a time, and keyboard lists behind the top layer are suspended.
 */

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let layerSeq = 0
const layerStack: number[] = []
/** Each mounted layer's element (by stack id), so lists and popovers can tell whether they live
 *  inside the topmost one. */
const layerElements = new Map<number, () => HTMLElement | null>()

/** Called with a layer's id once it closes (WP 8.5: the toasts it raised close with it). */
const closeListeners = new Set<(id: number) => void>()

/** Subscribe to layer closes; returns the unsubscribe. */
export function onLayerClose(listener: (id: number) => void): () => void {
  closeListeners.add(listener)
  return () => {
    closeListeners.delete(listener)
  }
}

/** The topmost open layer's id, or null with no dialog / drawer open (WP 8.5 toast scopes). */
export function topLayerId(): number | null {
  return layerStack[layerStack.length - 1] ?? null
}

/** True while any Modal or Drawer is mounted — screens use it to suppress their own global
 *  shortcuts (Gateway single-letter keys, VoucherEntry F-keys / ⌘↵) so keys aimed at a dialog
 *  never leak through to the screen underneath. useKeyNav already checks this internally. */
export function isAnyModalOpen(): boolean {
  return layerStack.length > 0
}

/** The topmost open layer's element (Modal dialog or Drawer panel), or null when none is open.
 *  Popovers portal into it (so they sit inside its focus trap and above its content); keyboard
 *  lists inside it keep working while everything behind it is suspended. */
export function topModalElement(): HTMLElement | null {
  const id = layerStack[layerStack.length - 1]
  return id === undefined ? null : (layerElements.get(id)?.() ?? null)
}

/**
 * Open "Esc layers" above dialogs — transient overlays (the table's filter/column/view popovers)
 * that must take Esc before the dialog does. A dialog's capture-phase key handler is registered
 * first, so it would otherwise close the whole dialog; while a layer is open it lets Esc through.
 * Returns the unregister function.
 */
let escapeLayers = 0
export function registerEscapeLayer(): () => void {
  escapeLayers++
  let done = false
  return () => {
    if (done) return
    done = true
    escapeLayers--
  }
}

/** An element (or an ancestor) marked `data-consumes-escape` handles Esc itself first — e.g. the
 *  table's quick filter clears its text — so a dialog doesn't close on that keypress. */
const consumesEscape = (t: EventTarget | null): boolean => t instanceof Element && t.closest('[data-consumes-escape]') !== null

/**
 * Phase 5 — ONE ⌘↵ / Ctrl+Enter rule in both modes: it presses the save of what is on top.
 * The button is the one marked `data-save-shortcut` (a screen marks its Save so), else — inside a
 * dialog / drawer — its one primary button. More than one candidate (or none, or disabled) = the
 * key does nothing, never a guess. It takes the key in the CAPTURE phase (review of #258: a field
 * whose own "Enter = do it" handler ignores ⌘ would otherwise run the action too — twice), except
 * from a picker (`[role=combobox]`, or a field marked `data-own-save-key`), which gets the key
 * first — a typed, unpicked name is picked, then the picker re-sends ⌘↵ (handled in the bubble
 * phase unless the picker kept it: `defaultPrevented`).
 */
export function saveActionIn(root: ParentNode, opts: { primary: boolean }): HTMLButtonElement | null {
  const usable = (b: HTMLButtonElement): boolean =>
    !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !b.closest('[hidden], [aria-hidden="true"], [data-no-save-shortcut]')
  const marked = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-save-shortcut]')).filter(usable)
  if (marked.length > 0) return marked.length === 1 ? marked[0]! : null
  if (!opts.primary) return null
  const primaries = Array.from(root.querySelectorAll<HTMLButtonElement>('button.t-btn-primary')).filter(usable)
  return primaries.length === 1 ? primaries[0]! : null
}

/** ⌘↵ / Ctrl+Enter, nothing else held. */
export const isSaveChord = (e: KeyboardEvent): boolean => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey

/** A field that handles ⌘↵ itself before the save rule (pickers). */
export const ownsSaveKey = (t: EventTarget | null): boolean => t instanceof Element && t.closest('[role="combobox"], [data-own-save-key]') !== null

/** Press `button` for this ⌘↵ in `phase` (capture: unless a picker has it; bubble: only a picker's). */
export function pressForSave(e: KeyboardEvent, phase: 'capture' | 'bubble', button: () => HTMLButtonElement | null): boolean {
  if (e.defaultPrevented || !isSaveChord(e)) return false
  if (ownsSaveKey(e.target) !== (phase === 'bubble')) return false
  const b = button()
  if (!b) return false
  e.preventDefault()
  e.stopPropagation()
  b.click()
  return true
}

/**
 * Registers `ref` as a dialog layer while mounted: pushes it on the stack, traps Tab inside it,
 * routes Esc (when it is the top layer and no popover/field claims Esc) to `onEscape`, moves focus
 * in on mount (unless a child autoFocus already took it) and restores focus on unmount.
 */
export function useDialogLayer(ref: RefObject<HTMLElement | null>, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape
  // What had the keyboard when the layer was first rendered — before a child's autoFocus took it
  // (by the effect below `activeElement` is already inside the layer when a field autofocuses).
  const openerRef = useRef<HTMLElement | null>(null)
  if (openerRef.current === null && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    openerRef.current = document.activeElement
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = ref.current
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? el).focus()
    }
    return () => {
      // WP 10.5 (simple shell only — the full app restores exactly as before): an autofocused
      // dialog remembered its own field, which is gone by now, so the keyboard fell to <body>;
      // give it back to the control that opened the dialog.
      const opener = openerRef.current
      if (
        document.documentElement.dataset.shell === 'simple' &&
        (!previous || !previous.isConnected || el?.contains(previous)) &&
        opener?.isConnected &&
        !el?.contains(opener)
      ) {
        opener.focus()
        return
      }
      previous?.focus?.()
    }
  }, [ref])

  useEffect(() => {
    const id = ++layerSeq
    layerStack.push(id)
    layerElements.set(id, () => ref.current)
    const isTop = (): boolean => layerStack[layerStack.length - 1] === id
    const onKey = (e: KeyboardEvent): void => {
      if (!isTop()) return
      if (e.key === 'Escape') {
        // A popover (or a field that clears itself) inside the layer takes this Esc first.
        if (escapeLayers > 0 || consumesEscape(e.target)) return
        e.stopPropagation()
        onEscapeRef.current()
      } else if (e.key === 'Tab') {
        const el = ref.current
        if (!el) return
        const focusables = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (f) => f.offsetParent !== null || f === document.activeElement
        )
        if (focusables.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusables[0]!
        const last = focusables[focusables.length - 1]!
        const inside = el.contains(document.activeElement)
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    // Phase 5: ⌘↵ in the top dialog presses its save (saveActionIn; pressForSave's phases).
    const saveButton = (): HTMLButtonElement | null => (ref.current ? saveActionIn(ref.current, { primary: true }) : null)
    const onSaveCapture = (e: KeyboardEvent): void => void (isTop() && pressForSave(e, 'capture', saveButton))
    const onSaveBubble = (e: KeyboardEvent): void => void (isTop() && pressForSave(e, 'bubble', saveButton))
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keydown', onSaveCapture, true)
    window.addEventListener('keydown', onSaveBubble)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keydown', onSaveCapture, true)
      window.removeEventListener('keydown', onSaveBubble)
      const i = layerStack.indexOf(id)
      if (i >= 0) layerStack.splice(i, 1)
      layerElements.delete(id)
      for (const l of closeListeners) l(id)
    }
  }, [ref])
}

/** Number of open layers — for tests and for useKeyNav's "Enter belongs to the dialog's button". */
export function layerCount(): number {
  return layerStack.length
}

// ---------------------------------------------------------------------------------------------
// WP 10.5: docked panels as Esc layers in the simple shell. A DockedDrawer rendered under the
// simple shell's dock provider registers here while open; Esc then closes the topmost panel
// before anything below it sees the key (a form's "Esc asks before discarding", the app's
// "Esc goes back") — the order is dialog → panel → form → screen. A dialog layer, an open
// popover / picker list (aria-expanded), a field that clears itself, or an overlay marked
// `data-esc-layer` (the ⌘K palette — not a dialog layer) keeps its Esc. Phase 5: the full app's
// docked panels (the Ask / AI panel, the drill drawer) register too — Esc backs out one layer in
// both modes; their DOM and focus are unchanged there.

const panelStack: { close: () => void }[] = []

/** Registers an open panel; returns the unregister function. */
export function registerPanelLayer(close: () => void): () => void {
  const entry = { close }
  panelStack.push(entry)
  return () => {
    const i = panelStack.indexOf(entry)
    if (i >= 0) panelStack.splice(i, 1)
  }
}

/** True while a simple-shell panel (Help, Ask Total, the AI drawer) is open. */
export function isPanelOpen(): boolean {
  return panelStack.length > 0
}

/** The Esc router (true = it closed a panel). Installed on window in the capture phase when
 *  this module is first evaluated — before any component's effect adds its own listener — so it
 *  runs first. Exported for tests. */
export function routePanelEscape(e: KeyboardEvent): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented || panelStack.length === 0) return false
  if (layerStack.length > 0 || escapeLayers > 0 || consumesEscape(e.target)) return false
  const t = e.target instanceof Element ? e.target : null
  if (t?.matches('[role="combobox"][aria-expanded="true"]')) return false // an open picker list closes first
  // An overlay drawn over the panels that owns its Esc (the ⌘K palette) closes first.
  if (typeof document !== 'undefined' && document.querySelector('[data-esc-layer]')) return false
  e.preventDefault()
  e.stopImmediatePropagation()
  panelStack[panelStack.length - 1]!.close()
  return true
}

if (typeof window !== 'undefined') window.addEventListener('keydown', routePanelEscape, true)
