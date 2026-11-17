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
const summary = (id: string, name: string, style: string): Record<string, unknown> => ({ id, name, builtIn: !id.startsWith('tpl-'), style, kinds: ['sales'], customised: false })
const TEMPLATES = [
  summary('classic', 'Classic', 'classic'), summary('receipt-80mm', 'Receipt 80mm', 'receipt'), summary('receipt-58mm', 'Receipt 58mm', 'receipt'),
  summary('tpl-own', 'Shop receipt', 'receipt'), summary('tpl-a4', 'Letterhead', 'modern')
]
const wrap = (ui: React.JSX.Element): React.JSX.Element => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
)
const writes = (): [string, unknown][] => invoke.mock.calls.filter(([c]) => c === 'template:setDefault' || c === 'counter:setConfig') as [string, unknown][]

beforeEach(() => {
  salesDefault = 'classic'
  counterTemplate = 'receipt-80mm'
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, p: { kind?: string; id?: string; templateId?: string }) => {
    if (channel === 'template:list') return { ok: true, data: { templates: TEMPLATES, defaults: { sales: salesDefault } } }
    if (channel === 'template:setDefault') {
      salesDefault = p.id!
      return { ok: true, data: { templates: TEMPLATES, defaults: { sales: salesDefault } } }
    }
    if (channel === 'counter:config') return { ok: true, data: { config: { ...COUNTER, templateId: counterTemplate }, accounts: {} } }
    if (channel === 'counter:setConfig') {
      counterTemplate = p.templateId!
      return { ok: true, data: p }
    }
    return { ok: false, error: `unmocked ${channel}` }
  })
  window.total = { platform: 'test', invoke } as unknown as typeof window.total
  act(() => useSession.setState({ slug: 'shop', ui: { mode: 'simple' }, user: null, info: { gstRegistrationType: 'regular' } as never }))
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
    expect(screen.queryByTestId('receipt-paper-full-invoice')).toBeNull()
    fireEvent.click(screen.getByTestId('receipt-paper-58'))
    await waitFor(() => expect(screen.getByTestId('receipt-paper-58').getAttribute('aria-checked')).toBe('true'))
    expect(writes()).toEqual([
      ['template:setDefault', { kind: 'sales', id: 'receipt-58mm' }],
      ['counter:setConfig', { ...COUNTER, templateId: 'receipt-58mm' }]
    ])
    expect(screen.getByTestId('receipt-paper-note').textContent).toBe('Saved. Your next bill prints this way.')
    // A receipt choice says B2B / other-state bills still print as the full A4 invoice.
    expect(screen.getByTestId('receipt-paper-full-invoice').textContent).toContain('still print as the full A4 tax invoice')
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

  it("a shop's own receipt is named, no size picked; a size replaces it but never the counter's own template", async () => {
    salesDefault = 'tpl-own'
    counterTemplate = 'tpl-own'
    render(wrap(<ReceiptPaperSetting />))
    await ready()
    expect(screen.getByTestId('receipt-paper-own').textContent).toContain('“Shop receipt”')
    for (const v of ['a4', '80', '58']) expect(screen.getByTestId(`receipt-paper-${v}`).getAttribute('aria-checked')).toBe('false')
    // One tab stop (the first choice while none is picked); the arrow keys move and pick.
    expect(screen.getByTestId('receipt-paper-a4').tabIndex).toBe(0)
    expect(screen.getByTestId('receipt-paper-80').tabIndex).toBe(-1)
    screen.getByTestId('receipt-paper-a4').focus()
    fireEvent.keyDown(screen.getByTestId('receipt-paper-a4'), { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByTestId('receipt-paper-80').getAttribute('aria-checked')).toBe('true'))
    expect(document.activeElement).toBe(screen.getByTestId('receipt-paper-80'))
    expect(screen.getByTestId('receipt-paper-80').tabIndex).toBe(0)
    // The radios are never `disabled` while the save runs (Chromium would drop the focus).
    expect((screen.getByTestId('receipt-paper-80') as HTMLButtonElement).disabled).toBe(false)
    // A composition shop's B2B bills stay on the receipt, so it is not told otherwise.
    expect(screen.queryByTestId('receipt-paper-full-invoice')).not.toBeNull()
    act(() => useSession.setState({ info: { gstRegistrationType: 'composition' } as never }))
    expect(screen.queryByTestId('receipt-paper-full-invoice')).toBeNull()
    expect(writes()).toEqual([['template:setDefault', { kind: 'sales', id: 'receipt-80mm' }]])
  })

  it('A4 with a custom sales template writes nothing; a viewer cannot change it', async () => {
    salesDefault = 'tpl-a4'
    act(() => useSession.setState({ user: { id: 2, name: 'V', role: 'viewer' } as never }))
    render(wrap(<ReceiptPaperSetting />))
    await waitFor(() => expect(screen.getByTestId('receipt-paper-a4').getAttribute('aria-checked')).toBe('true'))
    expect((screen.getByTestId('receipt-paper-58') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Only someone who can make bills can change this.')).toBeTruthy()
    expect(writes()).toEqual([])
  })
})
