// R3 of the 1.0 readiness review (FIG-G-3, FIG-G-2): the GST return screens read the registration
// in force for the MONTH shown (registration.ts `returnRegistrationIn` — regular on any day of it),
// never today's. A month with no regular day says why there is no return instead of nil-rated rows
// and computes nothing; a regular month of a business that has since moved to composition (or
// cancelled) still shows its return. The GSTR-1 checks' advance warning carries its CA point.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CompanyInfo } from '@shared/domain'
import type { GstIssue } from '@shared/gst/validate'
import { useNav, useSession } from '../state/stores'
import { Gstr1Screen, Gstr3bScreen } from '../screens/GstReturns'
import { Gstr2bScreen } from '../screens/Gstr2b'
import { Gst2bTab } from '../screens/assistants/Gst2bTab'

const invoke = vi.fn()
let issues: GstIssue[] = []
let filing: 'monthly' | 'quarterly' = 'monthly'
const BASE: CompanyInfo = {
  name: 'Sharma Kirana', stateCode: '27', gstin: '27AAACT1234A1Z5', gstRegistrationType: 'regular',
  address: '', booksFrom: 2026, email: null, phone: null, pan: null, tan: null
}
const COMPOSITION: CompanyInfo = { ...BASE, gstRegistrationType: 'composition' }
// Regular until 31 Oct 2026, composition from 1 Nov (today's type is composition).
const MOVED_AWAY: CompanyInfo = { ...BASE, gstRegistrationType: 'composition', gstRegistrationSince: '2026-11-01', gstPreviousRegistrationType: 'regular' }
// Registration cancelled from 1 Nov 2026.
const CANCELLED: CompanyInfo = { ...BASE, gstin: null, gstRegistrationType: 'unregistered', gstRegistrationSince: '2026-11-01', gstPreviousRegistrationType: 'regular' }

const called = (ch: string): boolean => invoke.mock.calls.some(([c]) => c === ch)

function renderUi(ui: React.JSX.Element): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
function as(info: CompanyInfo): void {
  act(() => useSession.setState({ slug: 'k3', info, from: '2026-04-01', to: '2027-03-31' }))
}

beforeEach(() => {
  localStorage.clear()
  issues = []
  filing = 'monthly'
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'gstProfile:get') return { ok: true, data: { filing } }
    if (channel === 'gst:validate') return { ok: true, data: { issues, roundOff: [] } }
    if (channel === 'gst:gstr1') return { ok: true, data: { period: '102026', gstin: BASE.gstin, json: {}, summary: [] } }
    return { ok: false, error: `unmocked channel ${channel}` }
  })
  window.total = { platform: 'test', invoke }
  act(() => useNav.setState({ stack: [{ name: 'gateway' }] }))
})
afterEach(() => {
  cleanup()
  invoke.mockReset()
})

describe('GSTR-1 / GSTR-3B by the month’s registration', () => {
  it('a composition business: GSTR-1 says CMP-08 / GSTR-4, computes nothing, offers no export', async () => {
    as(COMPOSITION)
    renderUi(<Gstr1Screen initialMonth="2026-10" />)
    const banner = await screen.findByTestId('gstr1-composition')
    expect(banner.textContent).toContain('A composition dealer files CMP-08 and GSTR-4, not GSTR-1')
    expect(screen.queryByTestId('btn-gstr1-export')).toBeNull()
    expect(called('gst:gstr1') || called('gst:validate')).toBe(false)
  })

  it('moved to composition on 1 Nov: October’s GSTR-3B is computed, November’s says no return', async () => {
    as(MOVED_AWAY)
    renderUi(<Gstr3bScreen initialMonth="2026-10" />)
    await waitFor(() => expect(called('gst:gstr3b')).toBe(true))
    expect(screen.queryByTestId('gstr3b-composition')).toBeNull()
    expect(screen.getByTestId('btn-gstr3b-export')).toBeTruthy()

    fireEvent.change(screen.getByTestId('input-gstr3b-month'), { target: { value: '2026-11' } })
    expect((await screen.findByTestId('gstr3b-composition')).textContent).toContain('not GSTR-3B')
    expect(screen.queryByTestId('btn-gstr3b-export')).toBeNull()
    // The month picker stays, so October can be opened again.
    fireEvent.change(screen.getByTestId('input-gstr3b-month'), { target: { value: '2026-10' } })
    await waitFor(() => expect(screen.queryByTestId('gstr3b-composition')).toBeNull())
  })

  it('a cancelled registration: November’s GSTR-3B says no return and sends the final return to the CA', async () => {
    as(CANCELLED)
    renderUi(<Gstr3bScreen initialMonth="2026-11" />)
    const banner = await screen.findByTestId('gstr3b-unregistered')
    expect(banner.textContent).toContain('not registered for GST on any day of this period')
    expect(banner.textContent).toContain('Ask your CA about the final return after a cancellation')
  })

  it('review of #290: a quarterly filer’s July is part of a regular Jul–Sep return (regular from 15 Aug); a monthly filer’s July is not', async () => {
    const movedIn: CompanyInfo = { ...BASE, gstRegistrationSince: '2026-08-15', gstPreviousRegistrationType: 'composition' }
    as(movedIn)
    renderUi(<Gstr3bScreen initialMonth="2026-07" />)
    expect((await screen.findByTestId('gstr3b-composition')).textContent).toContain('not GSTR-3B')
    cleanup()
    invoke.mockClear()
    filing = 'quarterly'
    renderUi(<Gstr3bScreen initialMonth="2026-07" />)
    await waitFor(() => expect(called('gst:gstr3b')).toBe(true))
    expect(screen.queryByTestId('gstr3b-composition')).toBeNull()
  })

  it('review of #290: a month before a new registration says when the registration took effect — not a cancellation', async () => {
    as({ ...BASE, gstRegistrationSince: '2026-11-15', gstPreviousRegistrationType: 'unregistered' })
    renderUi(<Gstr1Screen initialMonth="2026-10" />)
    const banner = await screen.findByTestId('gstr1-unregistered')
    expect(banner.textContent).toContain('its registration took effect on 15-Nov-26 — so no GSTR-1 is due for it.')
    expect(banner.textContent).not.toContain('cancellation')
  })

  it('the advance-without-a-rate warning on the GSTR-1 checks carries its "check with your CA" badge', async () => {
    as(BASE)
    issues = [{ code: 'advance_no_rate', severity: 'warning', message: '1 advance received in this period is not in Table 11A …', voucherIds: [7] }]
    renderUi(<Gstr1Screen initialMonth="2026-10" />)
    await screen.findByTestId('rows-gstr1-issues')
    expect(screen.getByTestId('ca-check-gstr1-advanceNoRate')).toBeTruthy()
    expect(screen.queryByTestId('ca-check-gstReturns-notRegularDays')).toBeNull()
  })
})

describe('GSTR-2B by the month’s registration', () => {
  it('the reconciliation screen: a composition month has no credit to reconcile (s.10(4)) and no import', async () => {
    as(COMPOSITION)
    renderUi(<Gstr2bScreen />)
    expect((await screen.findByTestId('gstr2b-composition')).textContent).toContain('can’t claim GST credit on purchases (s.10(4) CGST Act)')
    expect(screen.queryByTestId('btn-2b-pick')).toBeNull()
  })

  it('Checks → GST 2B mismatches: the same for a composition month, nothing asked of the assistant', async () => {
    as(COMPOSITION)
    renderUi(<Gst2bTab initialPeriod="2026-10" />)
    expect(await screen.findByTestId('gstr2b-composition')).toBeTruthy()
    expect(called('assist:gst2b')).toBe(false)
  })
})
