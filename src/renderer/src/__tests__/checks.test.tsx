// A13c (audit 2026-11 PROD-4): Analysis → Checks — ONE screen for the month-end close, anomalies,
// exception reports, stale documents (orders on) and GST 2B mismatches (registered). The old
// screen names open the matching tab; saved views and options keep their keys.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_FEATURES, type CompanyFeatures } from '@shared/features'
import { buildCloseChecklist, type CloseFacts } from '@shared/closeChecklist'
import type { ExceptionsReport } from '@shared/reports'
import type { StaleDocRow } from '@shared/tradeCycle/types'
import { ChecksScreen } from '../screens/checks/Checks'
import { routeNavigation } from '@shared/aiExplain'
import { resolveHelpLink } from '../help/links'
import { DialogHost } from '../components/dialogs'
import { useNav, useSession } from '../state/stores'
import { canonicalScreen } from '../lib/checksScreen'
import { ACCOUNTANT_NAV, SCREENS, screenDef } from '../lib/screens'
import { screenOptionsKey } from '../components/ScreenOptions'
import { tableViewStorageKey } from '../components/table/useTableView'
import { useExplain } from '../lib/explain'

const invoke = vi.fn()
let features: Partial<CompanyFeatures> = {}

const facts: CloseFacts = {
  bank: [], unallocated: [], overdue: [], gst: { gstr1ExportedAt: null, gstr3bExportedAt: null }, withholding: [], withholdingMissed: [],
  negativeStock: [], unbilled: [], suspense: [], pdcs: [], depreciation: null, accruals: [],
  blankNarration: [], roundOff: [], unbalanced: [], drafts: [], optionalVouchers: [], lockDate: null
}
const exceptions: ExceptionsReport = {
  sections: [
    { key: 'missingNarration', label: 'Vouchers without narration', count: 1, rows: [{ label: 'Journal 4', detail: 'no narration', voucherId: 4 }] },
    { key: 'negativeCash', label: 'Negative cash', count: 0, rows: [] }
  ]
}
const stale: StaleDocRow[] = [
  { key: 'q:3', kind: 'quotation', voucherId: null, tradeDocId: 3, number: 'Q-3', date: '2026-04-02', partyLedgerId: 9, partyName: 'Acme', why: 'expired', dueDate: '2026-04-30', daysStale: 40, pendingValue: 1000_00, status: 'open' } as StaleDocRow
]

beforeEach(() => {
  localStorage.clear()
  features = {}
  useSession.setState({
    slug: 'test', from: '2026-04-01', to: '2027-03-31', user: null,
    info: { name: 'Acme', stateCode: '27', gstin: null, gstRegistrationType: 'regular', address: '', booksFrom: 2025, email: null, phone: null, pan: null, tan: null } as never
  })
  useNav.setState({ stack: [{ name: 'gateway' }, { name: 'checks' }] })
  useExplain.setState({ ready: false, handler: null })
  invoke.mockImplementation(async (channel: string, payload: unknown) => {
    switch (channel) {
      case 'config:features:get': return { ok: true, data: { ...DEFAULT_FEATURES, ...features } }
      case 'assist:close': return { ok: true, data: buildCloseChecklist(facts, { period: '2026-09', today: '2026-10-05' }, new Map()) }
      case 'assist:anomalies': return { ok: true, data: { from: '2026-04-01', to: '2027-03-31', historyFrom: '2025-04-01', settings: {}, counts: { high: 0, medium: 0, low: 0, dismissed: 0 }, rows: [] } }
      case 'report:exceptions': return { ok: true, data: exceptions }
      case 'trade:staleDocuments': return { ok: true, data: stale }
      default: return { ok: false, error: `unmocked ${channel} ${JSON.stringify(payload)}` }
    }
  })
  window.total = { platform: 'test', invoke } as unknown as typeof window.total
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function wrap(ui: React.ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      {ui}
      <DialogHost />
    </QueryClientProvider>
  )
}

const tabIds = (): string[] => Array.from(document.querySelectorAll('[role="tab"]')).map((b) => b.getAttribute('data-testid') ?? '')
const featuresLoaded = (): Promise<void> => waitFor(() => expect(invoke.mock.calls.some((c) => c[0] === 'config:features:get')).toBe(true))

describe('Checks screen', () => {
  it('shows the five tabs (orders on, registered) and each tab is the screen it replaced', async () => {
    features = { orders: true, inventory: true }
    wrap(<ChecksScreen tab="exceptions" />)
    await waitFor(() => expect(tabIds()).toEqual(['tab-checks-close', 'tab-checks-anomalies', 'tab-checks-exceptions', 'tab-checks-stale', 'tab-checks-gst2b']))
    expect(screen.getByTestId('page-title').textContent).toBe('Checks')
    expect(screen.getByTestId('tab-checks-exceptions').getAttribute('aria-selected')).toBe('true')
    // The exception reports, with their old testids (rows-exceptions-<section>).
    expect((await screen.findByTestId('rows-exceptions-missingNarration')).textContent).toContain('Journal 4')
    // Switching a tab replaces the screen (no new history entry).
    fireEvent.click(screen.getByTestId('tab-checks-stale'))
    expect(useNav.getState().stack).toEqual([{ name: 'gateway' }, { name: 'checks', tab: 'stale' }])
  })

  it('Stale documents: its own rows, testids and options under Checks', async () => {
    features = { orders: true, inventory: true }
    wrap(<ChecksScreen tab="stale" />)
    const rows = await screen.findByTestId('rows-stale-documents')
    await waitFor(() => expect(rows.textContent).toContain('Q-3'))
    expect(screen.getByTestId('btn-close-stale-quotations')).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith('trade:staleDocuments', { asOn: '2027-03-31', orderAgeDays: 30, noteAgeDays: 30 })
  })

  it('without orders the Stale documents tab is hidden and a stale link opens the first tab', async () => {
    wrap(<ChecksScreen tab="stale" />)
    await featuresLoaded()
    await waitFor(() => expect(tabIds()).toEqual(['tab-checks-close', 'tab-checks-anomalies', 'tab-checks-exceptions', 'tab-checks-gst2b']))
    expect(screen.getByTestId('tab-checks-close').getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByTestId('rows-assistants-close')).toBeTruthy()
    expect(screen.queryByTestId('rows-stale-documents')).toBeNull()
  })

  it('a business never GST-registered sees no GST 2B tab, and a link to it says why', async () => {
    useSession.setState({ info: { ...useSession.getState().info!, gstRegistrationType: 'unregistered', gstPreviousRegistrationType: null } })
    wrap(<ChecksScreen tab="gst2b" />)
    await featuresLoaded()
    await waitFor(() => expect(tabIds()).not.toContain('tab-checks-gst2b'))
    expect(screen.getByTestId('tab-checks-close').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('checks-hidden-tab').textContent).toContain('only for a GST-registered business')
  })

  it('review of #245: a business whose registration was cancelled keeps the GST 2B tab', async () => {
    useSession.setState({ info: { ...useSession.getState().info!, gstRegistrationType: 'unregistered', gstPreviousRegistrationType: 'regular' } })
    wrap(<ChecksScreen tab="gst2b" />)
    await featuresLoaded()
    await waitFor(() => expect(tabIds()).toContain('tab-checks-gst2b'))
    expect(screen.getByTestId('tab-checks-gst2b').getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('checks-hidden-tab')).toBeNull()
  })

  it('saved options and table views keep their old keys', async () => {
    localStorage.setItem(screenOptionsKey('test', 'exceptions'), JSON.stringify({ hideClean: true, expandAll: false }))
    wrap(<ChecksScreen tab="exceptions" />)
    await screen.findByTestId('exceptions-toggle-missingNarration')
    expect(screen.queryByTestId('exceptions-toggle-negativeCash')).toBeNull() // hideClean read from the old key
    await screen.findByTestId('rows-exceptions-missingNarration')
    fireEvent.click(screen.getByTestId('sort-exceptions-missingNarration-label'))
    await waitFor(() => expect(localStorage.getItem(tableViewStorageKey('test', 'exceptions-missingNarration'))).not.toBeNull())
  })
})

describe('old screen names', () => {
  it('canonicalScreen maps each old name to its tab (Assistants keeps tab and period)', () => {
    expect(canonicalScreen({ name: 'assistants' })).toEqual({ name: 'checks' })
    expect(canonicalScreen({ name: 'assistants', tab: 'gst2b', period: '2026-05' })).toEqual({ name: 'checks', tab: 'gst2b', period: '2026-05' })
    expect(canonicalScreen({ name: 'exceptions' })).toEqual({ name: 'checks', tab: 'exceptions' })
    expect(canonicalScreen({ name: 'stale-documents' })).toEqual({ name: 'checks', tab: 'stale' })
    const tb = { name: 'trial-balance' } as const
    expect(canonicalScreen(tb)).toBe(tb)
  })

  it('nav.go / tryGo / replace open Checks for an old name', async () => {
    act(() => useNav.setState({ stack: [{ name: 'gateway' }] }))
    act(() => useNav.getState().go({ name: 'exceptions' }))
    await waitFor(() => expect(useNav.getState().stack.at(-1)).toEqual({ name: 'checks', tab: 'exceptions' }))
    await act(async () => void (await useNav.getState().tryGo({ name: 'assistants', tab: 'close', period: '2026-09' })))
    expect(useNav.getState().stack.at(-1)).toEqual({ name: 'checks', tab: 'close', period: '2026-09' })
    act(() => useNav.getState().replace({ name: 'stale-documents' }))
    expect(useNav.getState().stack.at(-1)).toEqual({ name: 'checks', tab: 'stale' })
  })

  it('the registry: Checks sits in Analysis where Assistants was; the old names have no sidebar row and open their tab', () => {
    const analysis = ACCOUNTANT_NAV.find((s) => s.id === 'analysis')!.items.map((i) => i.screen.name)
    expect(analysis.slice(-2)).toEqual(['ratios', 'checks'])
    expect(ACCOUNTANT_NAV.find((s) => s.id === 'trade')!.items.map((i) => i.screen.name)).not.toContain('stale-documents')
    expect(screenDef('assistants')).toMatchObject({ screen: { name: 'checks', tab: 'close' }, navSection: null })
    expect(screenDef('exceptions')).toMatchObject({ screen: { name: 'checks', tab: 'exceptions' }, navSection: null })
    // Stale documents' row (and its keywords) still needs the trade cycle, as before.
    expect(screenDef('stale-documents')).toMatchObject({ screen: { name: 'checks', tab: 'stale' }, navSection: null, feature: 'orders' })
    expect(screenDef('checks')?.keywords).not.toContain('expired quotations')
  })

  it('review of #245: "open exceptions" / "go to assistants" / "open stale documents" in the Ask panel open the tab, never the model', async () => {
    const nothing = (): { results: never[] } => ({ results: [] })
    expect(await routeNavigation('open exceptions', SCREENS, nothing as never)).toMatchObject({ to: 'screen', screen: { name: 'checks', tab: 'exceptions' } })
    expect(await routeNavigation('go to assistants', SCREENS, nothing as never)).toMatchObject({ to: 'screen', screen: { name: 'checks', tab: 'close' } })
    expect(await routeNavigation('open stale documents', SCREENS, nothing as never)).toMatchObject({ to: 'screen', screen: { name: 'checks', tab: 'stale' } })
  })

  it('review of #245: help links to the old names resolve to the tab', () => {
    expect(resolveHelpLink('total://screen/exceptions')).toMatchObject({ kind: 'screen', screen: { name: 'checks', tab: 'exceptions' } })
    expect(resolveHelpLink('total://screen/assistants')).toMatchObject({ kind: 'screen', screen: { name: 'checks', tab: 'close' } })
  })
})
