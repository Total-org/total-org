// Audit A3 (SEC-2): a lock (⌘L, the idle lock, Lock / sign-out) or a sign-in as ANOTHER user
// leaves nothing of the previous session on screen or in memory — the query cache, the screens
// (back to Home), kept hand-off forms, the AI panel and Ask Total conversations, toasts, open
// questions and drawers (bindQueryCacheToSession + lib/sessionEnd.ts, wired in main.tsx).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { CompanyInfo } from '@shared/domain'
import { bindQueryCacheToSession } from '../lib/companyCache'
import { useNav, useSession, useToasts } from '../state/stores'
import { confirmDialog, useDialogs } from '../lib/dialogs'
import { useAskTotal } from '../simple/AskTotal'
import { useAssistantPanel } from '../components/ai/AssistantPanel'
import { useDrill } from '../lib/drill'
import { useLinkedDocs } from '../components/LinkedDocs'
import { useAiScreenParams } from '../lib/aiContext'
import { useHelpPanel } from '../help/store'
import { hasKeptForm, keepForm, useLastSaved } from '../lib/handoff'
import type { SessionUser } from '../lib/client'

const INFO: CompanyInfo = {
  name: 'A', stateCode: '27', gstin: null, gstRegistrationType: 'regular', address: '',
  booksFrom: 2025, email: null, phone: null, pan: null, tan: null
}
const OWNER: SessionUser = { id: 1, name: 'Owner', role: 'owner' }
const VIEWER: SessionUser = { id: 2, name: 'Viewer', role: 'viewer', capabilities: { canSeeProfit: false } }

let client: QueryClient
let unbind: () => void

/** Fill every store the way an owner's session leaves it. */
function ownerSessionOnScreen(): void {
  client.setQueryData(['report', 'profitLoss'], { netProfit: 1_234_500 })
  useNav.setState({ stack: [{ name: 'gateway' }, { name: 'profit-loss' }] })
  useToasts.getState().push('error', 'Ramesh Traders owes ₹12,345.00')
  useAskTotal.setState({ owner: 'company-a:1', turns: [{ id: 1, text: 'what is my profit?' }], pending: { id: 2, text: 'and last month?' } })
  useAssistantPanel.setState({ open: true, owner: 'company-a:1', aiThreadId: 7, simpleView: 'ai', tab: 'queue', escalated: true })
  useDrill.setState({ ledgerEditId: 3, itemEditId: 4 })
  useLinkedDocs.setState({ target: { voucherId: 9 } })
  useAiScreenParams.getState().set('profit-loss', { ledgerId: 3 })
  useHelpPanel.getState().openArticle('getting-started')
  useLastSaved.getState().set({ name: 'voucher-entry', kind: 'sales' } as never, 11)
}

function expectNothingLeft(): void {
  expect(client.getQueryData(['report', 'profitLoss'])).toBeUndefined()
  expect(useNav.getState().stack).toEqual([{ name: 'gateway' }])
  expect(useToasts.getState().toasts).toEqual([])
  expect(useAskTotal.getState().turns).toEqual([])
  expect(useAskTotal.getState().pending).toBeNull()
  const panel = useAssistantPanel.getState()
  expect([panel.open, panel.aiThreadId, panel.simpleView, panel.tab, panel.escalated, panel.pending]).toEqual([false, null, 'ask', 'ask', false, null])
  expect(useDrill.getState()).toMatchObject({ ledgerEditId: null, itemEditId: null })
  expect(useLinkedDocs.getState().target).toBeNull()
  expect(useAiScreenParams.getState().byScreen).toEqual({})
  expect(useHelpPanel.getState().open).toBe(false)
  expect(useLastSaved.getState()).toMatchObject({ screen: null, id: null })
}

beforeEach(() => {
  useSession.getState().clearCompany()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  unbind = bindQueryCacheToSession(client)
  useSession.getState().setCompany('company-a', INFO)
  useSession.getState().setUser(OWNER)
})

afterEach(() => {
  unbind()
  client.clear()
  for (const t of useToasts.getState().toasts) useToasts.getState().dismiss(t.id)
})

describe('session end (audit A3)', () => {
  it('⌘L / the idle lock (user signed out, locked) forgets everything the owner saw', () => {
    ownerSessionOnScreen()
    // lib/sessionLock.ts showLocked: setUser(null) then setLocked(true).
    useSession.getState().setUser(null)
    useSession.getState().setLocked(true)
    expectNothingLeft()
  })

  it('the privacy lock of a business without people (no user at all) clears too', () => {
    useSession.getState().setUser(null)
    ownerSessionOnScreen()
    useSession.getState().setLocked(true)
    expectNothingLeft()
  })

  it('a sign-in as another user without a lock in between clears too', () => {
    ownerSessionOnScreen()
    useSession.getState().setUser(VIEWER)
    expectNothingLeft()
  })

  it('an open question is answered "no" and never shows over the lock screen', async () => {
    const answer = confirmDialog({ title: 'Delete the bill to Ramesh Traders?', message: '₹12,345.00' })
    expect(useDialogs.getState().queue).toHaveLength(1)
    useSession.getState().setLocked(true)
    expect(useDialogs.getState().queue).toEqual([])
    await expect(answer).resolves.toBe(false)
  })

  it('a hand-off form kept for the way back is dropped', () => {
    const sell = { name: 'simple-sell' } as const
    useNav.setState({ stack: [{ name: 'gateway' }, sell] })
    keepForm({ form: { party: 'Ramesh Traders', amount: '12345' } })
    expect(hasKeptForm(sell, 1)).toBe(true)
    useSession.getState().setLocked(true)
    // Even back on the very same nav entry after the next sign-in, nothing is handed back.
    useNav.setState({ stack: [{ name: 'gateway' }, sell] })
    expect(hasKeptForm(sell, 1)).toBe(false)
  })

  it('the same user signing in again after the lock starts on Home with an empty cache', () => {
    ownerSessionOnScreen()
    useSession.getState().setUser(null)
    useSession.getState().setLocked(true)
    useSession.getState().setUser(OWNER)
    useSession.getState().setLocked(false)
    expectNothingLeft()
  })

  it('keeps the cache for what is not a session end (a Company Info save, an unlock, the same user)', () => {
    client.setQueryData(['ledgers'], ['A ledger'])
    useSession.getState().setCompany('company-a', { ...INFO, name: 'A renamed' })
    useSession.getState().setUser({ ...OWNER, name: 'Owner renamed' })
    useSession.getState().setLocked(false)
    expect(client.getQueryData(['ledgers'])).toEqual(['A ledger'])
  })

  it('the viewer who signs in next never sees the owner’s P&L, even when the refetch is refused', async () => {
    let refuse = false
    function ProfitTile(): React.JSX.Element {
      const q = useQuery({
        queryKey: ['report', 'profitLoss'],
        queryFn: async () => {
          if (refuse) throw new Error('not_permitted')
          return { netProfit: 1_234_500 }
        }
      })
      return <p data-testid="profit">{q.data ? `₹${q.data.netProfit / 100}` : q.isError ? 'hidden' : '…'}</p>
    }
    const tree = (): React.JSX.Element => (
      <QueryClientProvider client={client}>
        <ProfitTile />
      </QueryClientProvider>
    )
    const { unmount } = render(tree())
    await waitFor(() => expect(screen.getByTestId('profit').textContent).toBe('₹12345'))
    // The lock screen replaces the shell (App.tsx), then the viewer signs in.
    unmount()
    useSession.getState().setUser(null)
    useSession.getState().setLocked(true)
    refuse = true
    useSession.getState().setUser(VIEWER)
    useSession.getState().setLocked(false)
    render(tree())
    expect(screen.getByTestId('profit').textContent).not.toContain('12345')
    await waitFor(() => expect(screen.getByTestId('profit').textContent).toBe('hidden'))
  })
})
