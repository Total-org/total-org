// PROD-11: Settings → Bills & printing → "How do you print your bills?" (A4 / 80 mm / 58 mm).
// Main is mocked at window.total.invoke; the setting writes only through template:setDefault
// and counter:setConfig.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReceiptPaperSetting } from '../screens/settings/ReceiptPaperSetting'
import { useSession } from '../state/stores'

const invoke = vi.fn()
let salesDefault = 'classic'
let counterTemplate = 'receipt-80mm'
const COUNTER = { walkInLedgerId: null, salesLedgerId: null, voucherTypeId: null, receiptTypeId: null, cashLedgerId: null, upiLedgerId: null, cardLedgerId: null, godownId: null, autoPrint: false }
const wrap = (ui: React.JSX.Element): React.JSX.Element => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
)
const writes = (): [string, unknown][] => invoke.mock.calls.filter(([c]) => c === 'template:setDefault' || c === 'counter:setConfig') as [string, unknown][]

beforeEach(() => {
  salesDefault = 'classic'
  counterTemplate = 'receipt-80mm'
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, p: { kind?: string; id?: string; templateId?: string }) => {
    if (channel === 'template:list') return { ok: true, data: { templates: [], defaults: { sales: salesDefault } } }
    if (channel === 'template:setDefault') {
      salesDefault = p.id!
      return { ok: true, data: { templates: [], defaults: { sales: salesDefault } } }
    }
    if (channel === 'counter:config') return { ok: true, data: { config: { ...COUNTER, templateId: counterTemplate }, accounts: {} } }
    if (channel === 'counter:setConfig') {
      counterTemplate = p.templateId!
      return { ok: true, data: p }
    }
    return { ok: false, error: `unmocked ${channel}` }
  })
  window.total = { platform: 'test', invoke } as unknown as typeof window.total
  act(() => useSession.setState({ slug: 'shop', ui: { mode: 'simple' }, user: null }))
})
afterEach(() => cleanup())

const ready = async (): Promise<void> => {
  await waitFor(() => expect((screen.getByTestId('receipt-paper-58') as HTMLButtonElement).disabled).toBe(false))
}

describe('ReceiptPaperSetting (PROD-11)', () => {
  it('A4 is picked while sales print with Classic; choosing 58 mm sets the sales print and the counter receipt', async () => {
    render(wrap(<ReceiptPaperSetting />))
    await ready()
    expect(screen.getByTestId('receipt-paper-a4').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('How do you print your bills?')).toBeTruthy()
    fireEvent.click(screen.getByTestId('receipt-paper-58'))
    await waitFor(() => expect(screen.getByTestId('receipt-paper-58').getAttribute('aria-checked')).toBe('true'))
    expect(writes()).toEqual([
      ['template:setDefault', { kind: 'sales', id: 'receipt-58mm' }],
      ['counter:setConfig', { ...COUNTER, templateId: 'receipt-58mm' }]
    ])
    expect(screen.getByTestId('receipt-paper-note').textContent).toBe('Saved. Your next bill prints this way.')
  })

  it('back to A4 puts sales on Classic and leaves the counter receipt alone', async () => {
    salesDefault = 'receipt-58mm'
    counterTemplate = 'receipt-58mm'
    act(() => useSession.setState({ ui: { mode: 'accountant' } }))
    render(wrap(<ReceiptPaperSetting />))
    await ready()
    expect(screen.getByTestId('receipt-paper-58').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByTestId('receipt-paper-a4'))
    await waitFor(() => expect(screen.getByTestId('receipt-paper-a4').getAttribute('aria-checked')).toBe('true'))
    expect(writes()).toEqual([['template:setDefault', { kind: 'sales', id: 'classic' }]])
    // The full app says what the counter still prints.
    expect(screen.getByTestId('receipt-paper-counter').textContent).toBe('The counter still prints its receipts on 2-inch (58 mm) paper.')
  })

  it('A4 with a custom sales template writes nothing; a viewer cannot change it', async () => {
    salesDefault = 'my-a4'
    act(() => useSession.setState({ user: { id: 2, name: 'V', role: 'viewer' } as never }))
    render(wrap(<ReceiptPaperSetting />))
    await waitFor(() => expect(screen.getByTestId('receipt-paper-a4').getAttribute('aria-checked')).toBe('true'))
    expect((screen.getByTestId('receipt-paper-58') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Only someone who can make bills can change this.')).toBeTruthy()
    expect(writes()).toEqual([])
  })
})
