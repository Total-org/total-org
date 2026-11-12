// Audit A8 / UX-12: ⌘O switches company without the full-screen round trip — the other companies
// last opened first, filtered as you type, Enter opens; the pick is opened by the company list's
// own path (so a passphrase prompt / integrity check still applies). The list screen puts the last
// opened first, filters a long list, and the setup wizard is no longer its main button.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CompanyInfo, CompanySummary } from '@shared/domain'
import { CompanySwitcher } from '../components/CompanySwitcher'
import { CompanySelect } from '../screens/CompanySelect'
import { filterCompanies, orderCompanies, useCompanySwitch } from '../lib/companySwitch'
import { useNav, useSession } from '../state/stores'

const invoke = vi.fn()
const SLOW = { timeout: 10_000 }
vi.setConfig({ testTimeout: 30_000 })

const co = (slug: string, name: string, lastOpenedAt: string | null, gstin: string | null = null, stateCode = '27'): CompanySummary => ({ slug, name, stateCode, gstin, lastOpenedAt })
const COMPANIES: CompanySummary[] = [
  co('alpha', 'Alpha Agencies', '2026-11-01T09:00:00.000Z'),
  co('mehta', 'Mehta & Sons', '2026-11-10T09:00:00.000Z', '29AABCM1234F1Z5', '29'),
  co('zeta', 'Zeta Traders', null),
  co('kumar', 'Kumar Retail', '2026-11-12T08:00:00.000Z'),
  co('bharat', 'Bharat Steel', null)
]

function renderUi(ui: React.JSX.Element): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
const calls = (channel: string): unknown[] => invoke.mock.calls.filter(([c]) => c === channel).map(([, p]) => p)

beforeEach(() => {
  localStorage.clear()
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, payload?: { slug?: string }) => {
    switch (channel) {
      case 'company:list':
        return { ok: true, data: { companies: COMPANIES } }
      case 'company:close':
        return { ok: true, data: null }
      case 'company:remembered':
        return { ok: true, data: [] }
      case 'company:open':
        return { ok: true, data: { slug: payload?.slug, info: { name: 'Mehta & Sons' } as CompanyInfo, locked: false, ui: { mode: 'accountant' }, integrity: { ok: true } } }
      default:
        return { ok: false, error: `unmocked channel ${channel}` }
    }
  })
  window.total = { platform: 'test', invoke }
  act(() => {
    useSession.setState({ slug: 'kumar', info: { name: 'Kumar Retail' } as CompanyInfo, locked: false })
    useNav.setState({ stack: [{ name: 'gateway' }] })
    useCompanySwitch.setState({ open: false, pendingSlug: null })
  })
})
afterEach(() => cleanup())

describe('ordering and filtering (pure)', () => {
  it('last opened first, never opened after by name', () => {
    expect(orderCompanies(COMPANIES).map((c) => c.slug)).toEqual(['kumar', 'mehta', 'alpha', 'bharat', 'zeta'])
  })
  it('every typed word must appear in the name, GSTIN or state', () => {
    const state = (c: CompanySummary): string => (c.stateCode === '29' ? 'Karnataka' : 'Maharashtra')
    expect(filterCompanies(COMPANIES, 'sons', state).map((c) => c.slug)).toEqual(['mehta'])
    expect(filterCompanies(COMPANIES, '29aabcm', state).map((c) => c.slug)).toEqual(['mehta'])
    expect(filterCompanies(COMPANIES, 'traders maha', state).map((c) => c.slug)).toEqual(['zeta'])
    expect(filterCompanies(COMPANIES, '  ', state)).toHaveLength(5)
  })
})

describe('the ⌘O switcher', () => {
  it('lists the other companies, last opened first; typing filters; Enter opens through the company list', async () => {
    act(() => useCompanySwitch.getState().setOpen(true))
    renderUi(<CompanySwitcher />)
    await waitFor(() => expect(screen.getByTestId('company-switch-mehta')).toBeTruthy(), SLOW)
    const ids = Array.from(screen.getByTestId('list-company-switch').querySelectorAll('[data-testid^="company-switch-"]')).map((e) => e.getAttribute('data-testid'))
    // The open company (Kumar Retail) is not offered; "All businesses…" is last.
    expect(ids).toEqual(['company-switch-mehta', 'company-switch-alpha', 'company-switch-bharat', 'company-switch-zeta', 'company-switch-all'])

    const box = screen.getByTestId('input-company-switch')
    fireEvent.change(box, { target: { value: 'mehta' } })
    expect(screen.queryByTestId('company-switch-alpha')).toBeNull()
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    await waitFor(() => expect(useSession.getState().slug).toBeNull(), SLOW)
    expect(calls('company:close')).toHaveLength(1)
    expect(useCompanySwitch.getState()).toMatchObject({ open: false, pendingSlug: 'mehta' })
    cleanup()

    // The company list (shown once the company closed) opens the pick through its own path.
    renderUi(<CompanySelect />)
    await waitFor(() => expect(calls('company:open')).toContainEqual({ slug: 'mehta' }), SLOW)
    expect(useCompanySwitch.getState().pendingSlug).toBeNull()
  })

  it('"All businesses…" closes the company and leaves the list screen with nothing to open', async () => {
    act(() => useCompanySwitch.getState().setOpen(true))
    renderUi(<CompanySwitcher />)
    const all = await screen.findByTestId('company-switch-all', undefined, SLOW)
    await act(async () => {
      fireEvent.mouseDown(all)
    })
    await waitFor(() => expect(useSession.getState().slug).toBeNull(), SLOW)
    expect(useCompanySwitch.getState()).toMatchObject({ open: false, pendingSlug: null })
  })
})

describe('the company list screen', () => {
  it('last opened first; the setup wizard is not the main button while companies exist', async () => {
    act(() => useSession.setState({ slug: null, info: null }))
    renderUi(<CompanySelect />)
    await waitFor(() => expect(screen.getByText('Kumar Retail')).toBeTruthy(), SLOW)
    const names = ['Kumar Retail', 'Mehta & Sons', 'Alpha Agencies', 'Bharat Steel', 'Zeta Traders']
    const positions = names.map((n) => document.body.innerHTML.indexOf(n.replace('&', '&amp;')))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(screen.getByTestId('btn-company-setup').className).not.toMatch(/primary/)
    // Five companies: no filter box yet (it comes with the sixth).
    expect(screen.queryByTestId('input-company-filter')).toBeNull()
  })

  it('a long list gets a filter; Enter in it opens the first match', async () => {
    const many = [...COMPANIES, co('nova', 'Nova Exports', null, null, '24')]
    invoke.mockImplementation(async (channel: string, payload?: { slug?: string }) =>
      channel === 'company:list'
        ? { ok: true, data: { companies: many } }
        : channel === 'company:remembered'
          ? { ok: true, data: [] }
          : channel === 'company:open'
            ? { ok: true, data: { slug: payload?.slug, info: { name: 'Nova Exports' } as CompanyInfo, locked: false, ui: { mode: 'accountant' }, integrity: { ok: true } } }
            : { ok: false, error: `unmocked channel ${channel}` }
    )
    act(() => useSession.setState({ slug: null, info: null }))
    renderUi(<CompanySelect />)
    const box = await screen.findByTestId('input-company-filter', undefined, SLOW)
    fireEvent.change(box, { target: { value: 'gujarat' } })
    expect(screen.queryByText('Kumar Retail')).toBeNull()
    expect(screen.getByText('Nova Exports')).toBeTruthy()
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    await waitFor(() => expect(calls('company:open')).toContainEqual({ slug: 'nova' }), SLOW)
    fireEvent.change(box, { target: { value: 'nothing like it' } })
    expect(screen.getByTestId('company-filter-none')).toBeTruthy()
  })
})
