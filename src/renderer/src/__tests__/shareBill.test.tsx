// A10: Share a bill (WhatsApp / e-mail / share sheet / copy), the UPI ID setting and the AI
// costs' dollar rate field. Main is mocked at window.total.invoke.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { translator } from '@shared/i18n'
import type { BillShareFacts } from '@shared/billShare'
import { ShareBill } from '../components/ShareBill'
import { UsdRateField, usdRateFromText } from '../components/ai/UsdRateField'
import { UpiSetting } from '../screens/settings/UpiSetting'

const FACTS: BillShareFacts = {
  voucherId: 7, kind: 'sales', shareable: true, number: '12', date: '2026-10-01', partyName: 'Ramesh',
  whatsapp: '9876543210', email: 'ramesh@example.in', totalPaise: 118000, duePaise: 68000, upiId: 'sharma@ybl',
  businessName: 'Sharma Stores', shareSheet: true
}
const invoke = vi.fn()
const opened: string[] = []
const wrap = (ui: React.JSX.Element): React.JSX.Element => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
)

beforeEach(() => {
  opened.length = 0
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, payload: { via?: string; upiId?: string | null }) => {
    if (channel === 'invoice:shareFacts') return { ok: true, data: FACTS }
    if (channel === 'invoice:share') return { ok: true, data: { path: '/x/invoice-12.pdf', sheet: payload.via === 'sheet' } }
    if (channel === 'upi:get') return { ok: true, data: { upiId: null } }
    if (channel === 'upi:set') {
      if (payload.upiId === 'bad') return { ok: false, error: 'That is not a UPI ID', code: 'upi_invalid', field: 'upiId' }
      return { ok: true, data: { upiId: payload.upiId ? payload.upiId.toLowerCase() : null } }
    }
    return { ok: false, error: `unmocked ${channel}` }
  })
  window.total = { platform: 'test', invoke } as unknown as typeof window.total
  vi.spyOn(window, 'open').mockImplementation((u) => (opened.push(String(u)), null))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ShareBill', () => {
  it('WhatsApp: writes the PDF, then opens wa.me with the plain message (due + UPI ID)', async () => {
    render(wrap(<ShareBill voucherId={7} plain testId="share" />))
    fireEvent.click(screen.getByTestId('share'))
    await waitFor(() => expect(screen.getByTestId('share-ways')).toBeTruthy())
    fireEvent.click(screen.getByTestId('share-whatsapp'))
    await waitFor(() => expect(opened).toHaveLength(1))
    expect(invoke).toHaveBeenCalledWith('invoice:share', { voucherId: 7, via: 'whatsapp' })
    expect(opened[0]!.startsWith('https://wa.me/919876543210?text=')).toBe(true)
    const text = decodeURIComponent(opened[0]!.split('text=')[1]!)
    expect(text).toContain('₹680.00 is still due')
    expect(text).toContain('sharma@ybl')
    expect(screen.getByTestId('share-note').textContent).toContain('attach it in the chat')
  })
  it('E-mail opens a mailto draft; More ways hands the message to the share sheet', async () => {
    render(wrap(<ShareBill voucherId={7} plain={false} testId="share" />))
    fireEvent.click(screen.getByTestId('share'))
    await waitFor(() => expect(screen.getByTestId('share-email')).toBeTruthy())
    fireEvent.click(screen.getByTestId('share-email'))
    await waitFor(() => expect(opened[0]).toMatch(/^mailto:ramesh@example\.in\?subject=Bill%2012%20from%20Sharma%20Stores&body=/))
    fireEvent.click(screen.getByTestId('share-sheet'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('invoice:share', expect.objectContaining({ voucherId: 7, via: 'sheet', text: expect.stringContaining('Hello Ramesh') })))
  })
  it('no share sheet off macOS; Hindi words in a Hindi simple screen', async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === 'invoice:shareFacts' ? { ok: true, data: { ...FACTS, shareSheet: false } } : { ok: false, error: 'x' }
    )
    render(wrap(<ShareBill voucherId={7} plain testId="share" />))
    fireEvent.click(screen.getByTestId('share'))
    await waitFor(() => expect(screen.getByTestId('share-ways')).toBeTruthy())
    expect(screen.queryByTestId('share-sheet')).toBeNull()
    expect(translator('hi')('simple.share.button')).toBe('भेजें')
  })
})

describe('UpiSetting', () => {
  it('saves a UPI ID; a bad one stays under the field', async () => {
    render(wrap(<UpiSetting />))
    const input = (await screen.findByTestId('upi-id-input')) as HTMLInputElement
    await waitFor(() => expect(input.disabled).toBe(false))
    fireEvent.change(input, { target: { value: 'bad' } })
    fireEvent.click(screen.getByTestId('btn-upi-save'))
    await waitFor(() => expect(screen.getByTestId('field-error-upiId').textContent).toContain('UPI ID'))
    fireEvent.change(input, { target: { value: 'Sharma@YBL' } })
    fireEvent.click(screen.getByTestId('btn-upi-save'))
    await waitFor(() => expect(screen.getByTestId('upi-setting-note')).toBeTruthy())
    expect(invoke).toHaveBeenCalledWith('upi:set', { upiId: 'Sharma@YBL' })
    expect(input.value).toBe('sharma@ybl')
  })
})

describe('US dollar rate for AI costs', () => {
  it('reads "86.25" as ₹86.25 per dollar (×10⁶), empty = none, out of range refused', () => {
    expect(usdRateFromText('86.25')).toBe(86_250_000)
    expect(usdRateFromText('₹ 84')).toBe(84_000_000)
    expect(usdRateFromText('')).toBeNull()
    expect(usdRateFromText('0.5')).toBe('invalid')
    expect(usdRateFromText('abc')).toBe('invalid')
  })
  it('saves through onSave and says so', async () => {
    const onSave = vi.fn(async () => undefined)
    render(<UsdRateField t={translator('en')} rateMicro={null} canEdit onSave={onSave} />)
    fireEvent.change(screen.getByTestId('ai-usd-rate-input'), { target: { value: '86.25' } })
    fireEvent.click(screen.getByTestId('btn-ai-usd-rate-save'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(86_250_000))
    expect(screen.getByTestId('ai-usd-rate-note').textContent).toContain('rupees')
  })
})
