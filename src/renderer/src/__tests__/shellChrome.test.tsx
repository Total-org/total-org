// UI overhaul (part b, review of #226): the simple header hides the period chip on entry flows —
// every intent's screen (INTENT_SCREEN) — and shows it everywhere else.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SimpleHeader } from '../simple/SimpleHeader'
import { useNav, useSession } from '../state/stores'
import { INTENT_SCREEN } from '@shared/simple/handoff'

const invoke = vi.fn(async () => ({ ok: true, data: null }))

function renderOn(name: string): void {
  act(() => useNav.setState({ stack: [{ name } as never] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SimpleHeader onOpenPalette={() => undefined} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  window.total = { platform: 'test', invoke, onAiEvent: () => () => undefined } as unknown as typeof window.total
  act(() => {
    useSession.setState({ slug: 'sharma', locked: false, user: null, info: { name: 'Sharma Kirana' }, ui: { mode: 'simple' }, from: '2026-04-01', to: '2027-03-31', workingDate: '2026-10-14' } as never)
  })
})
afterEach(() => cleanup())

describe('simple header: the period chip', () => {
  it.each(Object.values(INTENT_SCREEN))('is hidden while writing on %s', (name) => {
    renderOn(name)
    expect(screen.queryByTestId('btn-period')).toBeNull()
    // the rest of the header is still there
    expect(screen.getByTestId('btn-theme').getAttribute('aria-label')).toBeTruthy()
  })

  it.each(['gateway', 'simple-sales', 'simple-money', 'simple-section', 'simple-taxes'])('shows on %s', (name) => {
    renderOn(name)
    expect(screen.getByTestId('btn-period')).toBeTruthy()
  })
})
