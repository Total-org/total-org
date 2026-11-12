// Phase 5 (skeletons, no layout shift): while their data loads, Home's tiles and cards keep the
// shape they will have once it arrives. jsdom has no layout, so these pin the structure that holds
// the size (the measured shift is scripts/perf-launch.mjs + docs/perf-budgets.md "Phase 5").
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StatTile } from '../components/kit'
import { DashCard } from '../screens/gateway/parts'

afterEach(cleanup)

describe('StatTile while loading', () => {
  it('draws its value line in the figure’s own type (an invisible digit under the skeleton) and keeps the footer line', () => {
    const { rerender } = render(<StatTile size="lg" label="Cash & bank" testId="t" loading value={false} footer={false} reserveSparkline />)
    const line = screen.getByTestId('t').querySelector('#t-value > span') as HTMLElement
    expect(line.getAttribute('aria-hidden')).toBe('true')
    expect(line.className).toMatch(/text-brand/)
    expect(line.className).toMatch(/leading-tight/)
    expect(line.querySelector('.invisible')?.textContent).toBe('0')
    expect(line.querySelector('.t-skeleton')).toBeTruthy()
    // The footer placeholder is a no-break space: a plain space collapses the line to nothing.
    const footer = screen.getByTestId('t').lastElementChild as HTMLElement
    expect(footer.textContent).toBe(' ')
    rerender(<StatTile size="lg" label="Cash & bank" testId="t" value="1,000.00" footer="Cash ₹1K" reserveSparkline />)
    const ready = screen.getByTestId('t').querySelector('#t-value > span') as HTMLElement
    expect(ready.className).toMatch(/text-brand/)
    expect(ready.className).toMatch(/leading-tight/)
    expect(ready.textContent).toBe('1,000.00')
    expect((screen.getByTestId('t').lastElementChild as HTMLElement).textContent).toBe('Cash ₹1K')
  })
})

describe('DashCard loadingHeight', () => {
  it('holds the loaded height while loading and lets the content size it once ready', () => {
    const { rerender } = render(
      <DashCard title="Ageing" testId="c" card={{ state: 'loading' }} loadingHeight={300}>
        {() => <p>rows</p>}
      </DashCard>
    )
    const card = screen.getByTestId('c')
    expect(card.getAttribute('data-state')).toBe('loading')
    expect(card.style.minHeight).toBe('300px')
    rerender(
      <DashCard title="Ageing" testId="c" card={{ state: 'ready', data: 1 }} loadingHeight={300}>
        {() => <p>rows</p>}
      </DashCard>
    )
    expect(screen.getByTestId('c').style.minHeight).toBe('')
    expect(screen.getByText('rows')).toBeTruthy()
  })

  it('without loadingHeight the card is exactly as before', () => {
    render(
      <DashCard title="Top customers" testId="c" card={{ state: 'loading' }} skeletonRows={5}>
        {() => null}
      </DashCard>
    )
    expect(screen.getByTestId('c').getAttribute('style')).toBeNull()
    expect(screen.getByTestId('c').querySelectorAll('.t-skeleton')).toHaveLength(5)
  })
})
