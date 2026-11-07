// Phase 3b — the approval queue screens: simple mode shows each proposal in plain words (en / hi /
// hinglish, banned-word free) with Approve / Edit / Discard and "Approve all" for proposals made
// together (an unrequested one is never part of it); accountant mode shows the accounts with
// Dr / Cr. Approve is ai:queue:approve only; Discard the proposal's own discard; Edit opens it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CompanyInfo } from '@shared/domain'
import type { QueueList, QueueProposal } from '@shared/aiQueue'
import { bannedWordsIn } from '@shared/simple/bannedWords'
import { translator } from '@shared/i18n'
import '@shared/i18n/all'
import { useNav, useSession } from '../state/stores'
import { ApprovalQueue, proposalSentence } from '../simple/queue/ApprovalQueue'
import { ApprovalQueueScreen } from '../screens/ApprovalQueue'

const invoke = vi.fn()
const base = (over: Partial<QueueProposal>): QueueProposal => ({
  key: 'draft:1', type: 'draft', id: 1, origin: 'chat', what: 'money_out', group: null, voucherKind: 'payment', date: '2026-10-14',
  partyName: 'Shop Rent', amount: 150_000, summary: 'Payment of ₹1,500.00 on 2026-10-14: Dr Shop Rent / Cr Cash', unrequested: false,
  lines: [{ ledgerId: 5, ledgerName: 'Shop Rent', drCr: 'dr', amount: 150_000 }, { ledgerId: 1, ledgerName: 'Cash', drCr: 'cr', amount: 150_000 }],
  assumptions: [], approve: 'voucher', createdAt: '2026-10-14T10:00:00Z', draftForm: 'accounting', ...over
})
const SALE = base({ key: 'draft:2', id: 2, what: 'sale', voucherKind: 'sales', group: 'message:9', partyName: 'Umbrella Retail', amount: 236_000, draftForm: 'invoice' })
const SALE2 = base({ key: 'draft:3', id: 3, what: 'sale', voucherKind: 'sales', group: 'message:9', partyName: 'Krishna Stores', amount: 118_000, draftForm: 'invoice' })
const ODD = base({ key: 'draft:4', id: 4, what: 'money_out', group: 'message:9', partyName: 'Unknown Co', amount: 999_900, unrequested: true })
const MEMORY = base({ key: 'memory:7', type: 'memory', id: 7, origin: 'memory', what: 'memory', voucherKind: null, date: null, partyName: null, amount: null, lines: [], approve: 'memory', memoryText: 'Pay rent from HDFC', summary: 'Pay rent from HDFC' })
const BILL = base({ key: 'capture:3', type: 'capture', id: 3, origin: 'capture', what: 'bill_to_read', voucherKind: null, lines: [], approve: 'capture', fileName: 'bill.pdf', captureStatus: 'needs_review', partyName: null, amount: null })

let list: QueueList
const calls = (ch: string): Record<string, unknown>[] => invoke.mock.calls.filter(([c]) => c === ch).map(([, p]) => p as Record<string, unknown>)

function renderUi(ui: React.JSX.Element): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  list = { proposals: [base({}), SALE, SALE2, ODD, MEMORY, BILL], waiting: 5, plans: [] }
  invoke.mockImplementation(async (channel: string, payload: { key?: string }) => {
    switch (channel) {
      case 'ai:queue': return { ok: true, data: list }
      case 'ai:queue:approve': return { ok: true, data: { key: payload.key, voucherIds: [50] } }
      case 'ai:draft:discard': return { ok: true, data: {} }
      case 'ai:memory:setStatus': return { ok: true, data: {} }
      case 'ai:plan:reminded': return { ok: true, data: { logId: 9 } }
      case 'ai:plan:discard': return { ok: true, data: null }
      default: return { ok: true, data: [] }
    }
  })
  window.total = { platform: 'test', invoke }
  act(() => {
    useSession.setState({ info: { name: 'Sharma Kirana', stateCode: '27', gstin: null, gstRegistrationType: 'unregistered', address: '', booksFrom: 2026, email: null, phone: null, pan: null, tan: null } as CompanyInfo, slug: 'sharma', ui: { mode: 'simple' }, user: null, workingDate: '2026-10-14', from: '2026-04-01', to: '2027-03-31' })
    useNav.setState({ stack: [{ name: 'simple-approvals' }] })
  })
})
afterEach(() => {
  cleanup()
  invoke.mockReset()
  localStorage.clear()
})

describe('approval queue — simple mode', () => {
  it('says each proposal in plain words, banned-word free, in every language', async () => {
    renderUi(<ApprovalQueue />)
    await waitFor(() => expect(screen.getByTestId('queue-card-draft:1')).toBeTruthy())
    expect(screen.getByTestId('queue-card-draft:1').textContent).toContain('Money out to Shop Rent: ₹1,500.00')
    expect(screen.getByTestId('queue-card-draft:1').textContent).toContain('From your AI helper')
    expect(screen.getByTestId('queue-card-memory:7').textContent).toContain('Remember: “Pay rent from HDFC”')
    expect(screen.getByTestId('queue-card-capture:3').textContent).toContain('Waiting for your answers')
    expect(screen.getByTestId('queue-card-draft:4').textContent).toContain('Nobody asked for this')
    expect(bannedWordsIn(document.body.textContent ?? '')).toEqual([])
    for (const lang of ['hi', 'hinglish'] as const) {
      const t = translator(lang)
      for (const p of list.proposals) {
        const s = proposalSentence(p, t)
        expect(s).not.toMatch(/\{|\}/)
        expect(bannedWordsIn(s)).toEqual([])
      }
    }
    expect(proposalSentence(SALE, translator('hi'))).toBe('Umbrella Retail को ₹2,360.00 का बिल')
  })

  it('Approve sends ai:queue:approve with the working date; Discard uses the draft / memory discard', async () => {
    renderUi(<ApprovalQueue />)
    await waitFor(() => expect(screen.getByTestId('queue-approve-draft:1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('queue-approve-draft:1'))
    await waitFor(() => expect(calls('ai:queue:approve')).toEqual([{ key: 'draft:1', today: '2026-10-14' }]))
    fireEvent.click(screen.getByTestId('queue-discard-memory:7'))
    await waitFor(() => expect(calls('ai:memory:setStatus')).toEqual([{ id: 7, status: 'archived' }]))
    fireEvent.click(screen.getByTestId('queue-discard-draft:2'))
    await waitFor(() => expect(calls('ai:draft:discard')).toEqual([{ id: 2 }]))
    // A bill being read is opened, never approved or discarded here.
    expect(screen.queryByTestId('queue-approve-capture:3')).toBeNull()
    fireEvent.click(screen.getByTestId('queue-edit-capture:3'))
    await waitFor(() => expect(useNav.getState().stack.at(-1)).toEqual({ name: 'capture' }))
  })

  it('"Approve all" approves the set one by one and leaves out the one nobody asked for', async () => {
    renderUi(<ApprovalQueue />)
    const group = await screen.findByTestId('queue-group-message:9')
    expect(within(group).getByText('Prepared together (3)')).toBeTruthy()
    fireEvent.click(within(group).getByTestId('queue-approve-all-message:9'))
    await waitFor(() => expect(calls('ai:queue:approve').map((c) => c.key)).toEqual(['draft:2', 'draft:3']))
  })

  it('Edit opens a chat draft in its simple flow when it has one, else the full editor', async () => {
    list = { proposals: [base({ prefill: { screen: 'simple-money-out', who: 'expense', payee: 5, amount: 150_000 } }), SALE], waiting: 2, plans: [] }
    renderUi(<ApprovalQueue />)
    fireEvent.click(await screen.findByTestId('queue-edit-draft:1'))
    await waitFor(() => expect(useNav.getState().stack.at(-1)).toEqual({ name: 'simple-money-out', ask: { draftId: 1, prefill: { screen: 'simple-money-out', who: 'expense', payee: 5, amount: 150_000 } } }))
    fireEvent.click(screen.getByTestId('queue-edit-draft:2'))
    await waitFor(() => expect(useNav.getState().stack.at(-1)).toEqual({ name: 'voucher-entry', aiDraftId: 2, kindHint: 'sales' }))
  })

  it('a viewer sees the proposals without the buttons', async () => {
    act(() => useSession.setState({ user: { id: 3, name: 'Looker', role: 'viewer' } } as never))
    renderUi(<ApprovalQueue />)
    await waitFor(() => expect(screen.getByTestId('queue-card-draft:1')).toBeTruthy())
    expect(screen.queryByTestId('queue-approve-draft:1')).toBeNull()
  })

  it('a changed / flagged / already-matched proposal says why and offers no Approve; a captured bill is never in Approve all', async () => {
    const CHANGED = base({ key: 'draft:11', id: 11, approve: 'changed', group: 'message:5' })
    const FLAGGED = base({ key: 'draft:12', id: 12, origin: 'capture', what: 'purchase', approve: 'check', group: 'message:5' })
    const DONE = base({ key: 'draft:13', id: 13, origin: 'bank', approve: 'line_done', group: 'message:5' })
    const CLEAN_BILL = base({ key: 'draft:14', id: 14, origin: 'capture', what: 'purchase', group: 'message:5' })
    const OK1 = base({ key: 'draft:15', id: 15, group: 'message:5' })
    const OK2 = base({ key: 'draft:16', id: 16, group: 'message:5' })
    const TDS = base({ key: 'draft:17', id: 17, approve: 'tds', group: 'message:5', prefill: { screen: 'simple-money-out', who: 'supplier', party: 9, amount: 3_500_000 } })
    list = { proposals: [CHANGED, FLAGGED, DONE, CLEAN_BILL, OK1, OK2, TDS], waiting: 3, plans: [] }
    renderUi(<ApprovalQueue />)
    await waitFor(() => expect(screen.getByTestId('queue-card-draft:11')).toBeTruthy())
    expect(screen.getByTestId('queue-card-draft:11').textContent).toContain('The amounts changed since this was prepared')
    expect(screen.getByTestId('queue-card-draft:12').textContent).toContain('Check this bill against the file first')
    expect(screen.getByTestId('queue-card-draft:13').textContent).toContain('already sorted out elsewhere')
    expect(screen.getByTestId('queue-card-draft:17').textContent).toContain('tax deducted at source (TDS)')
    // TDS is deducted in the full editor: a chat draft that needs it opens there, not the simple flow.
    fireEvent.click(screen.getByTestId('queue-edit-draft:17'))
    await waitFor(() => expect(useNav.getState().stack.at(-1)).toEqual({ name: 'voucher-entry', aiDraftId: 17, kindHint: 'payment' }))
    for (const k of ['draft:11', 'draft:12', 'draft:13', 'draft:17']) expect(screen.queryByTestId(`queue-approve-${k}`)).toBeNull()
    expect(screen.queryByTestId('queue-edit-draft:13')).toBeNull()
    expect(screen.getByTestId('queue-approve-draft:14')).toBeTruthy()
    fireEvent.click(screen.getByTestId('queue-approve-all-message:5'))
    await waitFor(() => expect(calls('ai:queue:approve').map((c) => c.key)).toEqual(['draft:15', 'draft:16']))
  })

  it('a reminder plan: its task as the heading, each reminder in plain words; WhatsApp opens with the People message and is logged; copy; drop', async () => {
    const facts = { bucket: 'gentle' as const, bills: [{ name: '7', voucherId: 7, date: '2026-08-30', dueDate: '2026-08-31', amount: 1_200_000, pending: 1_200_000, overdueDays: 44 }], amount: 1_200_000, lastSent: null, allowed: true, nextAllowed: null }
    const R1 = base({ key: 'reminder:1', type: 'reminder', id: 1, origin: 'askTotal', what: 'reminder', group: 'plan:3', voucherKind: null, date: null, partyName: 'Ramesh Traders', amount: 1_200_000, lines: [], approve: 'reminder', reminder: { partyId: 10, phone: '9876543210', whatsapp: null, facts } })
    const R2 = base({ key: 'reminder:2', type: 'reminder', id: 2, origin: 'askTotal', what: 'reminder', group: 'plan:3', voucherKind: null, date: null, partyName: 'Sita Stores', amount: 300_000, lines: [], approve: 'reminder', reminder: { partyId: 11, phone: null, whatsapp: null, facts: { ...facts, amount: 300_000 } } })
    list = { proposals: [R1, R2], waiting: 0, plans: [{ key: 'plan:3', id: 3, task: 'remind_late', params: { minDays: 30 }, question: 'remind everyone 30 days late', source: 'ask-total', createdAt: '2026-10-14T10:00:00Z' }] }
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderUi(<ApprovalQueue />)
    const group = await screen.findByTestId('queue-group-plan:3')
    expect(group.textContent).toContain('Reminders to customers 30+ days late (2)')
    expect(group.textContent).toContain('You asked: “remind everyone 30 days late”')
    expect(screen.getByTestId('queue-card-reminder:1').textContent).toContain('Remind Ramesh Traders about ₹12,000.00 that is late')
    // Never "Approve all" for reminders (each one opens WhatsApp).
    expect(screen.queryByTestId('queue-approve-all-plan:3')).toBeNull()
    fireEvent.click(screen.getByTestId('queue-whatsapp-reminder:1'))
    await waitFor(() => expect(calls('ai:plan:reminded')).toEqual([{ itemId: 1, via: 'whatsapp', today: '2026-10-14' }]))
    expect(String(open.mock.calls[0]![0])).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/)
    expect(decodeURIComponent(String(open.mock.calls[0]![0]))).toContain('Ramesh Traders')
    fireEvent.click(screen.getByTestId('queue-copy-reminder:2'))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(calls('ai:plan:reminded')[1]).toEqual({ itemId: 2, via: 'copied', today: '2026-10-14' }))
    fireEvent.click(screen.getByTestId('queue-discard-reminder:2'))
    await waitFor(() => expect(calls('ai:plan:discard')).toEqual([{ itemId: 2 }]))
    fireEvent.click(screen.getByTestId('queue-edit-reminder:1'))
    await waitFor(() => expect(useNav.getState().stack.at(-1)).toEqual({ name: 'simple-person', id: 10 }))
    expect(bannedWordsIn(document.body.textContent ?? '')).toEqual([])
    open.mockRestore()
  })

  it('inside the reminder interval a card asks "Send again?" first, as the person\'s page does', async () => {
    const facts = { bucket: 'gentle' as const, bills: [{ name: '7', voucherId: 7, date: '2026-08-30', dueDate: '2026-08-31', amount: 1_200_000, pending: 1_200_000, overdueDays: 44 }], amount: 1_200_000, lastSent: '2026-10-12', allowed: false, nextAllowed: '2026-10-19' }
    const R = base({ key: 'reminder:5', type: 'reminder', id: 5, origin: 'askTotal', what: 'reminder', group: 'plan:4', voucherKind: null, date: null, partyName: 'Ramesh Traders', amount: 1_200_000, lines: [], approve: 'reminder', reminder: { partyId: 10, phone: null, whatsapp: null, facts } })
    list = { proposals: [R], waiting: 1, plans: [{ key: 'plan:4', id: 4, task: 'remind_late', params: { minDays: 1 }, question: 'remind everyone who is late', source: 'ask-total', createdAt: '2026-10-14T10:00:00Z' }] }
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
    renderUi(<ApprovalQueue />)
    expect((await screen.findByTestId('queue-group-plan:4')).textContent).toContain('Reminders to customers with late bills (1)')
    expect(screen.getByTestId('queue-card-reminder:5').textContent).toContain('Last reminded on')
    fireEvent.click(screen.getByTestId('queue-copy-reminder:5'))
    expect(screen.getByTestId('queue-again-reminder:5').textContent).toContain('You reminded them 2 days ago. Send again?')
    expect(calls('ai:plan:reminded')).toEqual([])
    fireEvent.click(screen.getByTestId('queue-again-no-reminder:5'))
    expect(screen.queryByTestId('queue-again-reminder:5')).toBeNull()
    fireEvent.click(screen.getByTestId('queue-copy-reminder:5'))
    fireEvent.click(screen.getByTestId('queue-again-yes-reminder:5'))
    await waitFor(() => expect(calls('ai:plan:reminded')).toEqual([{ itemId: 5, via: 'copied', today: '2026-10-14' }]))
  })

  it('an empty queue teaches what lands here', async () => {
    list = { proposals: [], waiting: 0, plans: [] }
    renderUi(<ApprovalQueue />)
    expect(await screen.findByTestId('simple-approvals-empty')).toBeTruthy()
  })
})

describe('approval queue — accountant mode', () => {
  it('shows the accounts with Dr / Cr; Approve all takes only what was asked for', async () => {
    act(() => useSession.setState({ ui: { mode: 'accountant' } } as never))
    renderUi(<ApprovalQueueScreen />)
    const row = await waitFor(() => {
      const r = document.querySelector('[data-key="draft:1"]')
      expect(r).toBeTruthy()
      return r as HTMLElement
    })
    fireEvent.click(row)
    const lines = await screen.findByTestId('queue-lines-draft:1')
    expect(lines.textContent).toContain('Shop Rent')
    expect(lines.textContent).toContain('Dr')
    expect(lines.textContent).toContain('1,500.00')
    fireEvent.click(screen.getByTestId('queue-approve-all'))
    // The unrequested draft is left out; the memory is accepted through its own channel.
    await waitFor(() => expect(calls('ai:queue:approve').map((c) => c.key)).toEqual(['draft:1', 'draft:2', 'draft:3']))
    await waitFor(() => expect(calls('ai:memory:setStatus')).toEqual([{ id: 7, status: 'active' }]))
  })

  it('a viewer sees the accounts but no Approve / Discard / Approve all', async () => {
    act(() => useSession.setState({ ui: { mode: 'accountant' }, user: { id: 3, name: 'Looker', role: 'viewer' } } as never))
    renderUi(<ApprovalQueueScreen />)
    const row = await waitFor(() => {
      const r = document.querySelector('[data-key="draft:1"]')
      expect(r).toBeTruthy()
      return r as HTMLElement
    })
    fireEvent.click(row)
    await screen.findByTestId('queue-lines-draft:1')
    expect(screen.queryByTestId('queue-approve-draft:1')).toBeNull()
    expect(screen.queryByTestId('queue-discard-draft:1')).toBeNull()
    expect(screen.queryByTestId('queue-approve-all')).toBeNull()
  })
})
