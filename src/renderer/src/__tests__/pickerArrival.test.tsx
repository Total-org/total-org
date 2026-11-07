// Audit UX-7 (owner, 7 Nov): a picker focused on ARRIVAL (autoFocus) does not open its list over
// the form; typing, ↓, Enter, a click or any later focus opens it exactly as before.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TypeAhead, type PickerOption } from '../components/pickers'

const OPTIONS: PickerOption[] = [
  { id: 1, label: 'Krishna Enterprises' },
  { id: 2, label: 'Silverline Traders' },
  { id: 3, label: 'Umbrella Retail' }
]

function picker(autoFocus: boolean): HTMLInputElement {
  render(<TypeAhead options={OPTIONS} value={null} onPick={() => undefined} placeholder="Customer" autoFocus={autoFocus} testId="picker-x" />)
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
})
