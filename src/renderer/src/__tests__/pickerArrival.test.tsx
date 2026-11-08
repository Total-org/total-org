// Audit UX-7 (owner, 7 Nov): a picker focused on ARRIVAL (autoFocus) does not open its list over
// the form; typing, ↓, Enter, a click or any later focus opens it exactly as before.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TypeAhead, type PickerOption } from '../components/pickers'

const OPTIONS: PickerOption[] = [
  { id: 1, label: 'Krishna Enterprises' },
  { id: 2, label: 'Silverline Traders' },
  { id: 3, label: 'Umbrella Retail' }
]

function picker(autoFocus: boolean, opts: { onPick?: (id: number | null) => void; openOnArrival?: boolean } = {}): HTMLInputElement {
  render(
    <TypeAhead
      options={OPTIONS}
      value={null}
      onPick={opts.onPick ?? (() => undefined)}
      placeholder="Customer"
      autoFocus={autoFocus}
      openOnArrival={opts.openOnArrival}
      testId="picker-x"
    />
  )
  return screen.getByTestId('picker-x') as HTMLInputElement
}

afterEach(() => cleanup())

describe('TypeAhead on arrival', () => {
  it('is focused but closed when it arrives focused', () => {
    const input = picker(true)
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it.each([
    ['typing', (i: HTMLInputElement) => fireEvent.change(i, { target: { value: 'Kri' } })],
    ['↓', (i: HTMLInputElement) => fireEvent.keyDown(i, { key: 'ArrowDown' })],
    ['Enter', (i: HTMLInputElement) => fireEvent.keyDown(i, { key: 'Enter' })],
    ['a click', (i: HTMLInputElement) => fireEvent.mouseDown(i)],
    ['leaving and coming back', (i: HTMLInputElement) => { fireEvent.blur(i); fireEvent.focus(i) }]
  ])('opens on %s', (_how, act) => {
    const input = picker(true)
    act(input)
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('a picker that was not focused on arrival opens on its first focus, as before', () => {
    const input = picker(false)
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('arrival → ↓ → Enter picks the row it always did (the second), arrival → ↓ ↓ → Enter the third', () => {
    for (const [downs, id] of [[1, 2], [2, 3]] as const) {
      const onPick = vi.fn()
      const input = picker(true, { onPick })
      for (let i = 0; i < downs; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onPick).toHaveBeenLastCalledWith(id)
      cleanup()
    }
  })

  it('arrival → Enter opens the list and picks nothing (it used to pick the first row silently)', () => {
    const onPick = vi.fn()
    const input = picker(true, { onPick })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a right click does not open it; openOnArrival opens it at once', () => {
    const input = picker(true)
    fireEvent.mouseDown(input, { button: 2 })
    expect(screen.queryByRole('listbox')).toBeNull()
    cleanup()
    picker(true, { openOnArrival: true })
    expect(screen.getByRole('listbox')).toBeTruthy()
  })
})
