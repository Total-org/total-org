// Phase 2b — "Check with your CA" badges: the kit badge shows the registry's points for its place
// and context (quarterly filer, the bill's date), in the user's language on simple places and in
// English on accountant ones, never opens the clickable row it sits in, and sits beside the
// figures / dates of the simple Taxes screen and Home's GST tile. The figures beside it are
// untouched (the screens' own tests still read them exactly).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CompanyInfo } from '@shared/domain'
import type { SimpleTaxes } from '@shared/simple/taxes'
import { bannedWordsIn } from '@shared/simple/bannedWords'
import { CaCheck } from '../components/CaCheck'
import { LANGUAGE_KEY } from '../lib/i18n'
import { useExplain } from '../lib/explain'
import { useNav, useSession } from '../state/stores'
import { TaxesScreen } from '../simple/taxes/TaxesScreen'

const invoke = vi.fn()
const info: CompanyInfo = { name: 'Mehta Traders', stateCode: '27', gstin: '27AAACT1234A1Z5', gstRegistrationType: 'regular', address: '', booksFrom: 2026, email: null, phone: null, pan: null, tan: null }
type Regular = Extract<SimpleTaxes, { kind: 'regular' }>
const SEP = { period: '2026-09', from: '2026-09-01', to: '2026-09-30', quarterly: false, soFar: false }
const REGULAR: Regular = {
  kind: 'regular', today: '2026-10-13', filing: 'monthly', period: SEP, periods: [SEP],
  figures: { collected: 18_000_00, reverseCharge: 0, onPurchases: 10_800_00, awaiting: 0, checked: 'all', toPay: 7_200_00, cashOnSales: 7_200_00, rcmCash: 0, creditUsed: 10_800_00, creditLeft: 0 },
  due: { gstr1: '2026-10-11', gstr3b: '2026-10-20', gstr3bUnverified: false, pmt06: [] },
  missing: [], supplierBills: [], prepared: { gstr1: null, gstr3b: null }, filesMonthly: false, filed: {}, withholding: []
}
let reply: SimpleTaxes

/** Opens the badge and returns the ids of the points it lists. */
function pointsOf(testId: string): string[] {
  fireEvent.click(screen.getByTestId(testId))
  const ids = screen.getByTestId(`${testId}-body`).getAttribute('data-points')!.split(' ')
  fireEvent.click(screen.getByTestId(testId)) // close again
  return ids
}

beforeEach(() => {
  reply = REGULAR
  invoke.mockImplementation(async (channel: string) => (channel === 'simple:taxes' ? { ok: true, data: reply } : { ok: true, data: [] }))
  window.total = { platform: 'test', invoke }
  act(() => {
    useSession.setState({ info, slug: 'mehta', ui: { mode: 'simple' }, workingDate: '2026-10-13', from: '2026-04-01', to: '2027-03-31', user: null })
    useNav.setState({ stack: [{ name: 'simple-taxes' }] })
    useExplain.setState({ ready: false, handler: null })
  })
})
afterEach(() => {
  cleanup()
  invoke.mockReset()
  localStorage.clear()
})

function renderTaxes(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TaxesScreen />
    </QueryClientProvider>
  )
}

describe('CaCheck badge', () => {
  it('lists the place’s points with their rule; nothing for a place with none in this context', () => {
    render(<CaCheck place="simple.taxes.dueGstr3b" />)
    const badge = screen.getByTestId('ca-check-simple-taxes-dueGstr3b')
    expect(badge.textContent).toBe('Check with your CA')
    expect(badge.getAttribute('aria-label')).toBe('Not confirmed yet — check with your CA')
    fireEvent.click(badge)
    const body = screen.getByTestId('ca-check-simple-taxes-dueGstr3b-body')
    expect(body.getAttribute('data-points')).toBe('gst-due-dates')
    expect(within(body).getByTestId('ca-check-simple-taxes-dueGstr3b-point-gst-due-dates').textContent).toContain('Rule: Notification 83/2020-CT')
    cleanup()
    // PMT-06 is a quarterly filer's only.
    const { container } = render(<CaCheck place="simple.taxes.pmt06" />)
    expect(container.textContent).toBe('')
  })

  it('the rate picker: the new slabs only for a date from 22 Sep 2025', () => {
    render(<CaCheck place="simple.ratePicker" date="2025-09-21" testId="before" />)
    render(<CaCheck place="simple.ratePicker" date="2025-09-22" testId="after" />)
    expect(pointsOf('before')).toEqual(['gst-slab-choice'])
    expect(pointsOf('after')).toEqual(['gst-slabs-new', 'gst-services-rates', 'gst-slab-choice'])
  })

  it('simple places speak Hindi / Hinglish; accountant places stay English', () => {
    localStorage.setItem(LANGUAGE_KEY, 'hi')
    render(<CaCheck place="simple.taxes.tds" testId="simple" />)
    render(<CaCheck place="tds.screen" testId="accountant" />)
    expect(screen.getByTestId('simple').textContent).toBe('अपने CA से पूछें')
    fireEvent.click(screen.getByTestId('simple'))
    const hi = screen.getByTestId('simple-body').textContent!
    expect(hi).toContain('TDS अगले महीने की 7 तारीख तक')
    expect(bannedWordsIn(hi)).toEqual([])
    expect(screen.getByTestId('accountant').textContent).toBe('Check with your CA')
    cleanup()
    localStorage.setItem(LANGUAGE_KEY, 'hinglish')
    render(<CaCheck place="simple.taxes.tds" testId="simple" />)
    expect(screen.getByTestId('simple').textContent).toBe('Apne CA se poochhein')
  })

  it('inside a clickable row, opening the badge does not open the row', () => {
    const onRow = vi.fn()
    render(
      <div onClick={onRow}>
        <CaCheck place="gateway.tds" />
      </div>
    )
    fireEvent.click(screen.getByTestId('ca-check-gateway-tds'))
    fireEvent.click(screen.getByTestId('ca-check-gateway-tds-point-tds-deposit-date'))
    expect(onRow).not.toHaveBeenCalled()
  })

  it('a focused badge leaves the app shortcuts alone (⌘K reaches the window)', () => {
    const onKey = vi.fn()
    window.addEventListener('keydown', onKey)
    try {
      render(<CaCheck place="gateway.tds" />)
      const badge = screen.getByTestId('ca-check-gateway-tds')
      badge.focus()
      fireEvent.keyDown(badge, { key: 'k', metaKey: true })
      fireEvent.keyDown(badge, { key: '?' })
      expect(onKey).toHaveBeenCalledTimes(2)
    } finally {
      window.removeEventListener('keydown', onKey)
    }
  })

  it('a heading next to a badge keeps its own name (the badge is not inside it)', async () => {
    renderTaxes()
    await screen.findByTestId('taxes-figures')
    for (const h of screen.getAllByRole('heading')) expect(h.textContent).not.toContain('Check with your CA')
  })
})

describe('Taxes screen (simple) carries the badges beside its figures and dates', () => {
  it('a monthly filer: GSTR-1 / GSTR-3B dates, the three figures, the prepare step — no quarterly points', async () => {
    renderTaxes()
    await screen.findByTestId('taxes-figures')
    expect(pointsOf('ca-check-simple-taxes-dueGstr1')).toEqual(['gst-due-dates'])
    expect(pointsOf('ca-check-simple-taxes-dueGstr3b')).toEqual(['gst-due-dates'])
    expect(pointsOf('ca-check-simple-taxes-collected')).toEqual(['posted-tax-rupee', 'gst-discount-net'])
    expect(pointsOf('ca-check-simple-taxes-onPurchases')).toEqual(['gstr2b-fields', 'itc-time-bar'])
    expect(pointsOf('ca-check-simple-taxes-toPay')).toEqual(['gstr3b-advances', 'gstr3b-negative'])
    expect(pointsOf('ca-check-simple-taxes-export')).toEqual(['gstr3b-schema-draft', 'hsn-table12'])
    expect(screen.queryByTestId('ca-check-simple-taxes-filing')).toBeNull()
    expect(screen.queryByTestId('ca-check-simple-taxes-pmt06')).toBeNull()
    // The dates themselves read exactly as before.
    expect(screen.getByTestId('taxes-due-gstr3b').textContent).toBe('GSTR-3B (the summary, with the payment): by 20 Oct 2026')
    expect(screen.getByTestId('tile-gst-to-pay-value').textContent).toBe('₹7,200.00')
  })

  it('a quarterly filer: the 22nd / 24th, IFF / files and PMT-06 points join in', async () => {
    const q = { period: '2026-09', from: '2026-07-01', to: '2026-09-30', quarterly: true, soFar: false }
    reply = { ...REGULAR, filing: 'quarterly', period: q, periods: [q], filesMonthly: true, due: { gstr1: '2026-10-13', gstr3b: '2026-10-22', gstr3bUnverified: false, pmt06: ['2026-08-25', '2026-09-25'] } }
    renderTaxes()
    await screen.findByTestId('taxes-figures')
    expect(pointsOf('ca-check-simple-taxes-dueGstr3b')).toEqual(['gst-due-dates', 'gstr3b-quarterly'])
    expect(pointsOf('ca-check-simple-taxes-filing')).toEqual(['qrmp-files'])
    expect(pointsOf('ca-check-simple-taxes-pmt06')).toEqual(['pmt06-amount'])
    expect(pointsOf('ca-check-simple-taxes-export')).toEqual(['qrmp-files', 'gstr3b-schema-draft', 'hsn-table12'])
    expect(screen.getByTestId('taxes-filing').textContent).toBe('You file GST every quarter.')
  })

  it('a composition business: the dates card carries the due-date and composition points', async () => {
    reply = { kind: 'composition', today: '2026-10-13', composition: { cmp08: { from: '2026-07-01', to: '2026-09-30', due: '2026-10-18' }, gstr4: { fyLabel: '2025-26', due: '2026-06-30' } }, withholding: [] } as unknown as SimpleTaxes
    renderTaxes()
    await screen.findByTestId('taxes-composition')
    expect(pointsOf('ca-check-simple-taxes-composition')).toEqual(['gst-due-dates', 'composition-rules'])
  })
})
