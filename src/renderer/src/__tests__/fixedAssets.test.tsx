// The fixed-asset register was removed (audit A13b): no screen in the registry, and the year-end
// close no longer warns that depreciation was not run (no screen could run it) — even though
// yearend:preview still returns the status for a book that used the register.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { YearEndScreen } from '../screens/YearEnd'
import { SCREENS } from '../lib/screens'
import { useSession } from '../state/stores'

const invoke = vi.fn()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('fixed-asset register removed (audit A13b)', () => {
  it('is not in the screen registry', () => {
    expect(SCREENS.some((s) => (s.name as string) === 'fixed-assets')).toBe(false)
  })

  it('the year-end close shows no depreciation warning', async () => {
    useSession.setState({
      slug: 'test', from: '2025-04-01', to: '2026-03-31', workingDate: '2026-03-31',
      info: { name: 'T', stateCode: '27', gstin: null, gstRegistrationType: 'regular', address: '', booksFrom: 2020, email: null, phone: null, pan: null, tan: null }
    })
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'yearend:preview') {
        return {
          ok: true,
          data: {
            rows: [], netProfit: 0, alreadyClosed: false,
            depreciation: { fyStartYear: 2025, assetsInService: 2, coveredThrough: null, missing: true },
            unbilled: { asOn: '2026-03-31', grni: { value: 10_000, notes: 1 }, gdni: { value: 0, notes: 0 } }
          }
        }
      }
      return { ok: false, error: `unmocked ${channel}` }
    })
    window.total = { platform: 'test', invoke } as unknown as typeof window.total
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><YearEndScreen /></QueryClientProvider>)
    // The preview has loaded (its other warning shows) …
    await screen.findByTestId('year-end-unbilled')
    // … and nothing about depreciation.
    expect(screen.queryByTestId('year-end-depreciation-missing')).toBeNull()
    expect(screen.queryByTestId('btn-year-end-run-depreciation')).toBeNull()
    expect(document.body.textContent).not.toMatch(/depreciation/i)
  })
})
