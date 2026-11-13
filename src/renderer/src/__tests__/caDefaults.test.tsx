// Audit A8 (CA defaults pack): reports stop at today inside the working period (UX-10), the trial
// balance's Group-wise switch, the comparative switch in the header, the GST returns' "month being
// filed" default (UX-4) and the bill's party picker order (UX-3). Defaults and order only — the
// figures asked for on any date are the service's, unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { BalanceSheet, ProfitAndLoss, TrialBalance } from '@shared/reports'
import type { Group, Ledger } from '@shared/domain'
import { TrialBalanceScreen } from '../screens/TrialBalance'
import { BalanceSheetScreen } from '../screens/BalanceSheet'
import { ProfitLossScreen } from '../screens/ProfitLoss'
import { Gstr3bScreen } from '../screens/GstReturns'
import { PartyPicker } from '../components/pickers'
import { screenOptionsKey } from '../components/ScreenOptions'
import { useNav, useSession } from '../state/stores'
import { screenContextFor, useAiScreenParams } from '../lib/aiContext'

const invoke = vi.fn()
const SLOW = { timeout: 10_000 }
vi.setConfig({ testTimeout: 30_000 })

const TB: TrialBalance = {
  rows: [
    { ledgerId: 5, ledgerName: 'Cash', groupName: 'Cash-in-Hand', debit: 150000, credit: 0, opening: 0, movementDebit: 150000, movementCredit: 0 },
    { ledgerId: 6, ledgerName: 'HDFC Bank', groupName: 'Bank Accounts', debit: 50000, credit: 0, opening: 0, movementDebit: 50000, movementCredit: 0 },
    { ledgerId: 7, ledgerName: 'Capital', groupName: 'Capital Account', debit: 0, credit: 200000, opening: -200000, movementDebit: 0, movementCredit: 0 }
  ],
  totalDebit: 200000,
  totalCredit: 200000,
  openingDebitTotal: 0,
  openingCreditTotal: 200000,
  movementDebitTotal: 200000,
  movementCreditTotal: 0
}
const BS = { asOn: '', liabilities: [], assets: [], totalAssets: 0, totalLiabilities: 0 } as unknown as BalanceSheet
const PNL = {
  tradingExpenses: [], tradingIncomes: [], indirectExpenses: [], indirectIncomes: [],
  openingStock: 0, closingStock: 0, grossProfit: 0, netProfit: 0
} as unknown as ProfitAndLoss

const g = (id: number, name: string, nature: string, parentId: number | null = null): Group =>
  ({ id, name, parentId, nature, affectsGrossProfit: false, isSystem: true }) as Group
const GROUPS: Group[] = [
  g(1, 'Current Assets', 'asset'), g(2, 'Sundry Debtors', 'asset', 1), g(3, 'Cash-in-Hand', 'asset', 1),
  g(4, 'Current Liabilities', 'liability'), g(5, 'Sundry Creditors', 'liability', 4), g(6, 'Duties & Taxes', 'liability', 4),
  g(7, 'Sales Accounts', 'income')
]
const l = (id: number, name: string, groupId: number, taxType: string | null = null): Ledger => ({ id, name, groupId, taxType }) as unknown as Ledger
const LEDGERS: Ledger[] = [
  l(1, 'Bharat Steel', 5), l(2, 'Cash', 3), l(3, 'CGST Output', 6, 'cgst'), l(4, 'Kumar Retail', 2), l(5, 'Sales', 7), l(6, 'Zenith Traders', 2)
]

// The clock is pinned to 7 Nov 2026 (review of #249: literal dates, never re-derived from the rule).
const fy = { from: '2026-04-01', to: '2027-03-31' }
const pinClock = (iso: string): void => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${iso}T10:00:00`))
}

function renderScreen(ui: React.JSX.Element): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
const calls = (channel: string): unknown[] => invoke.mock.calls.filter(([c]) => c === channel).map(([, p]) => p)

beforeEach(() => {
  pinClock('2026-11-07')
  localStorage.clear()
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, payload?: unknown) => {
    switch (channel) {
      case 'report:trialBalance':
        return { ok: true, data: TB }
      case 'report:balanceSheet':
        return { ok: true, data: { ...BS, asOn: (payload as { asOn: string }).asOn } }
      case 'report:profitLoss':
        return { ok: true, data: PNL }
      case 'gst:duePeriod':
        return { ok: true, data: { period: '2026-05', quarterly: false, soFar: false } }
      case 'master:groups:list':
        return { ok: true, data: GROUPS }
      case 'master:ledgers:list':
        return { ok: true, data: LEDGERS }
      case 'voucher:recentParties':
        return { ok: true, data: [6] }
      default:
        return { ok: false, error: `unmocked channel ${channel}` }
    }
  })
  window.total = { platform: 'test', invoke }
  act(() => {
    useSession.setState({ slug: 'alpha-co', from: fy.from, to: fy.to })
    useNav.setState({ go: vi.fn() })
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('UX-10 — reports dated today', () => {
  it('the trial balance is as on today inside the working period, and says so', async () => {
    renderScreen(<TrialBalanceScreen />)
    await waitFor(() => expect(calls('report:trialBalance')).toContainEqual({ asOn: '2026-11-07' }), SLOW)
    expect(calls('report:trialBalance')).not.toContainEqual({ asOn: '2027-03-31' })
    expect(screen.getByTestId('trial-balance-up-to-today').textContent).toMatch(/entries dated after today are not included/)
    // The assistant is told the same date ("Explain this", the screen's data).
    expect(useAiScreenParams.getState().byScreen['trial-balance']).toEqual({ to: '2026-11-07' })
  })

  it('on the last day of the year, and after it, the year end itself (no note)', async () => {
    pinClock('2027-03-31')
    renderScreen(<TrialBalanceScreen />)
    await waitFor(() => expect(calls('report:trialBalance')).toContainEqual({ asOn: '2027-03-31' }), SLOW)
    expect(screen.queryByTestId('trial-balance-up-to-today')).toBeNull()
    cleanup()
    pinClock('2027-05-02')
    renderScreen(<TrialBalanceScreen />)
    await waitFor(() => expect(calls('report:trialBalance')).toContainEqual({ asOn: '2027-03-31' }), SLOW)
    expect(screen.queryByTestId('trial-balance-up-to-today')).toBeNull()
  })

  it('"Stop at today" off reads the period end; a past year is read whole', async () => {
    localStorage.setItem(screenOptionsKey('alpha-co', 'trial-balance'), JSON.stringify({ hideZeroClosing: false, upToToday: false }))
    renderScreen(<TrialBalanceScreen />)
    await waitFor(() => expect(calls('report:trialBalance')).toContainEqual({ asOn: fy.to }), SLOW)
    expect(screen.queryByTestId('trial-balance-up-to-today')).toBeNull()
    cleanup()
    localStorage.clear()
    act(() => useSession.setState({ from: '2020-04-01', to: '2021-03-31' }))
    renderScreen(<TrialBalanceScreen />)
    await waitFor(() => expect(calls('report:trialBalance')).toContainEqual({ asOn: '2021-03-31' }), SLOW)
    expect(screen.queryByTestId('trial-balance-up-to-today')).toBeNull()
  })

  it('Group-wise groups the ledgers by their group (and back)', async () => {
    renderScreen(<TrialBalanceScreen />)
    const rows = (): HTMLElement[] => Array.from(screen.getByTestId('rows-trial-balance').querySelectorAll<HTMLElement>('tr.dt-row'))
    await waitFor(() => expect(rows()).toHaveLength(3), SLOW)
    expect(rows().some((r) => r.classList.contains('dt-group'))).toBe(false)
    fireEvent.click(screen.getByTestId('input-trial-balance-grouped'))
    await waitFor(() => expect(rows().filter((r) => r.classList.contains('dt-group'))).toHaveLength(3), SLOW)
    fireEvent.click(screen.getByTestId('input-trial-balance-grouped'))
    await waitFor(() => expect(rows()).toHaveLength(3), SLOW)
  })

  it('the balance sheet is as on today and the P&L runs to today; Compare periods is in the header', async () => {
    const end = '2026-11-07'
    renderScreen(<BalanceSheetScreen />)
    await waitFor(() => expect(calls('report:balanceSheet')).toContainEqual({ asOn: end, comparePrior: undefined }), SLOW)
    expect(await screen.findByTestId('input-statement-compare', undefined, SLOW)).toBeTruthy()
    expect(useAiScreenParams.getState().byScreen['balance-sheet']).toEqual({ to: end })
    cleanup()
    renderScreen(<ProfitLossScreen />)
    await waitFor(() => expect(calls('report:profitLoss')).toContainEqual({ from: fy.from, to: end, comparePrior: undefined }), SLOW)
    expect(useAiScreenParams.getState().byScreen['profit-loss']).toEqual({ from: fy.from, to: end })
    // A link that asks for exact dates keeps them.
    cleanup()
    renderScreen(<ProfitLossScreen from={fy.from} to={fy.to} />)
    await waitFor(() => expect(calls('report:profitLoss')).toContainEqual({ from: fy.from, to: fy.to, comparePrior: undefined }), SLOW)
  })
})

describe('UX-4 — GST returns open on the month being filed', () => {
  it('GSTR-3B asks the service which period is due and computes only that month', async () => {
    renderScreen(<Gstr3bScreen />)
    const may = '2026-05'
    await waitFor(() => expect(calls('gst:gstr3b')).toContainEqual({ from: `${may}-01`, to: `${may}-31`, period: `05${may.slice(0, 4)}` }), SLOW)
    expect(calls('gst:gstr3b')).toHaveLength(1)
    expect((screen.getByTestId('input-gstr3b-month') as HTMLSelectElement).value).toBe(may)
  })

  it('a quarterly filer opens on the quarter\'s last month and is told the return covers the quarter', async () => {
    const base = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, payload?: unknown) =>
      channel === 'gst:duePeriod'
        ? { ok: true, data: { period: '2026-09', from: '2026-07-01', to: '2026-09-30', quarterly: true, soFar: false } }
        : base(channel, payload)
    )
    renderScreen(<Gstr3bScreen />)
    await waitFor(() => expect((screen.getByTestId('input-gstr3b-month') as HTMLSelectElement).value).toBe('2026-09'), SLOW)
    expect(screen.getByTestId('gst-due-quarter').textContent).toBe('Quarterly return Jul–Sep 2026 · one month at a time')
    // Another month outside that quarter: no note.
    fireEvent.change(screen.getByTestId('input-gstr3b-month'), { target: { value: '2026-11' } })
    await waitFor(() => expect(screen.queryByTestId('gst-due-quarter')).toBeNull(), SLOW)
  })

  it('owner Q2 (COR2-1): a debit note whose s.17(5) mark differs from its purchase is listed on GSTR-3B, with a link to it', async () => {
    const base = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, payload?: unknown) =>
      channel === 'gst:validate'
        ? { ok: true, data: { issues: [
            { code: 'itc_blocked_note_mismatch', severity: 'warning', message: '1 debit note with a "GST credit blocked" (s.17(5)) mark different from the purchase it returns.', voucherIds: [41] },
            { code: 'missing_hsn', severity: 'warning', message: 'HSN missing', voucherIds: [7] }
          ], roundOff: [] } }
        : base(channel, payload)
    )
    renderScreen(<Gstr3bScreen />)
    const box = await screen.findByTestId('gstr3b-note-marks', {}, SLOW)
    expect(box.textContent).toMatch(/GST credit blocked/)
    expect(box.textContent).not.toMatch(/HSN missing/)
  })

  it('a stored "This month" choice is kept', async () => {
    localStorage.setItem(screenOptionsKey('alpha-co', 'gstr3b'), JSON.stringify({ openOn: 'current' }))
    renderScreen(<Gstr3bScreen />)
    await waitFor(() => expect(calls('gst:gstr3b').length).toBeGreaterThan(0), SLOW)
    expect(calls('gst:duePeriod')).toHaveLength(0)
    expect((screen.getByTestId('input-gstr3b-month') as HTMLSelectElement).value).toBe('2026-11')
  })
})

describe('UX-3 — the party picker per voucher type', () => {
  const options = async (): Promise<string[]> => {
    const input = await screen.findByTestId('picker-party', undefined, SLOW)
    await waitFor(() => expect(calls('voucher:recentParties').length).toBeGreaterThan(0), SLOW)
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    return waitFor(() => {
      const opts = screen.getAllByRole('option').map((o) => o.textContent ?? '')
      expect(opts.length).toBeGreaterThan(0)
      return opts
    }, SLOW)
  }

  it('a sale lists customers (the last used first), then cash, then suppliers — never tax or income ledgers', async () => {
    renderScreen(<PartyPicker side="sales" value={null} onPick={() => {}} placeholder="Party ledger" />)
    await waitFor(async () => expect((await options()).map((o) => o.split(/Sundry|Cash-in/)[0])).toEqual(['Zenith Traders', 'Kumar Retail', 'Cash', 'Bharat Steel']), SLOW)
    expect(calls('voucher:recentParties')).toContainEqual({ side: 'sales' })
  })

  it('a purchase puts suppliers first', async () => {
    renderScreen(<PartyPicker side="purchase" value={null} onPick={() => {}} placeholder="Party ledger" />)
    await waitFor(async () => expect((await options())[0]).toMatch(/^Bharat Steel/), SLOW)
  })
})

describe('the AI context follows the dates a screen shows (review of #249)', () => {
  it('registered from / to replace the working period; other screens keep it', () => {
    expect(screenContextFor({ name: 'trial-balance' }, '2026-04-01', '2027-03-31', { to: '2026-11-07' })).toMatchObject({ from: '2026-04-01', to: '2026-11-07' })
    expect(screenContextFor({ name: 'profit-loss' }, '2026-04-01', '2027-03-31', { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    const banking = screenContextFor({ name: 'banking' }, '2026-04-01', '2027-03-31', { ledgerId: 7 })
    expect(banking).toMatchObject({ from: '2026-04-01', to: '2027-03-31', params: { ledgerId: 7 } })
    // A malformed value is never taken as a date (nor sent as a param).
    expect(screenContextFor({ name: 'trial-balance' }, '2026-04-01', '2027-03-31', { to: 'soon' })).toMatchObject({ to: '2027-03-31' })
  })
})
