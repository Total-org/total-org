// to-do §4 (PR #87 / #103 leftover): a toast never covers the Save bar — whatever its height, from
// its first paint — nor a docked / overlaid panel's question box (Ask Total at 1700 px). The
// stack's offsets are CSS (app.css, simple shell only) over two measured variables.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { SaveBar } from '../simple/SaveBar'
import { DockedDrawer, DockModeContext, type DockMode } from '../components/kit/Drawer'
import { clearanceOf } from '../components/kit/toastClearance'

const css = readFileSync(resolve(__dirname, '../app.css'), 'utf8')

/** Mocked layout: the Save bar is `barH` tall, a docked panel `panelW` wide. The bar's top sits
 *  `barH` above the window's bottom (stuck there), or at `barTop` when given (a short form). */
function mockLayout(barH: number, panelW: number, barTop?: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const isBar = this.getAttribute('data-testid') === 'save-bar'
    const isPanel = this.hasAttribute('data-docked')
    const w = isPanel ? panelW : isBar ? 1000 : 0
    const h = isBar ? barH : isPanel ? 850 : 0
    const top = isBar ? (barTop ?? window.innerHeight - barH) : 0
    return { x: 0, y: top, top, left: 0, right: w, bottom: top + h, width: w, height: h, toJSON: () => ({}) } as DOMRect
  })
}

const bar = (): React.JSX.Element => (
  <SaveBar total="₹1,180.00" preview="Bill ₹1,180.00 to Ramesh." previewTestId="p" shortcuts="⌘↵ saves">
    <button type="button">Save</button>
  </SaveBar>
)
const panel = (mode: DockMode | null, width: number): React.JSX.Element => (
  <DockModeContext.Provider value={mode}>
    <DockedDrawer title="Ask Total" width={width} onClose={() => {}} testId="ask-panel">
      <textarea aria-label="Question" />
    </DockedDrawer>
  </DockModeContext.Provider>
)

afterEach(() => vi.restoreAllMocks())

describe('toast clearance', () => {
  it('the Save bar reports its measured height before paint, and takes it back when it goes', () => {
    mockLayout(132, 0) // a bar wrapped to two rows (1024 px, long preview line)
    const { unmount } = render(bar())
    expect(clearanceOf('--t-save-bar-h')).toBe(132)
    unmount()
    expect(clearanceOf('--t-save-bar-h')).toBe(0)
  })

  it('a Save bar above the window bottom (a short form) keeps the whole space below its top clear', () => {
    mockLayout(83, 0, window.innerHeight - 209) // the bar 126 px above the bottom edge (Money in, 1280×800)
    const { unmount } = render(bar())
    expect(clearanceOf('--t-save-bar-h')).toBe(209)
    unmount()
    expect(clearanceOf('--t-save-bar-h')).toBe(0)
  })

  it('a docked panel (1700 px: dock) and an overlaid one report their width; the full app none', () => {
    mockLayout(0, 460)
    const docked = render(panel('dock', 460))
    expect(clearanceOf('--t-docked-w')).toBe(460)
    docked.rerender(panel('overlay', 460))
    expect(clearanceOf('--t-docked-w')).toBe(460)
    docked.unmount()
    expect(clearanceOf('--t-docked-w')).toBe(0)
    // No DockModeContext = the accountant shell: nothing moves.
    const full = render(panel(null, 460))
    expect(clearanceOf('--t-docked-w')).toBe(0)
    full.unmount()
  })

  it('app.css lifts the stack by the bar and moves it left of the panel — simple shell only', () => {
    expect(css).toMatch(
      /\[data-shell='simple'\]:has\(\[data-testid='save-bar'\]\) \[data-toasts\] \{\s*bottom: calc\(var\(--t-save-bar-h, [\d.]+rem\) \+ [\d.]+rem\);/
    )
    expect(css).toMatch(/\[data-shell='simple'\]:has\(aside\[data-docked\]\) \[data-toasts\] \{\s*right: calc\(var\(--t-docked-w, 380px\) \+ 1rem\);/)
    expect(css).not.toMatch(/^\[data-toasts\]/m)
  })

})
