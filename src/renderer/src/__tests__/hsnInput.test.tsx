// Phase 2c — the HSN field searches the GST portal's own HSN / SAC list (loaded lazily) by code
// or words, says what a code is, never suggests or fills a GST rate, and in simple mode speaks
// t() words (en / hi / hinglish) and refuses words or a wrong length as the code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CompanyInfo } from '@shared/domain'
import { translator } from '@shared/i18n'
import { bannedWordsIn } from '@shared/simple/bannedWords'
import { useSession } from '../state/stores'
import { ItemFormModal } from '../screens/Masters'
import { NewProductDialog } from '../simple/NewProductDialog'
import { HsnStatusLines, useHsnStatus } from '../components/HsnInput'
import { simpleHsnLabels } from '../simple/hsnLabels'
import { loadHsnIndex } from '../lib/hsnMaster'

const invoke = vi.fn()
const UNITS = [{ id: 4, name: 'Pieces', symbol: 'Pcs', decimals: 0, uqc: 'PCS' }]
const info: CompanyInfo = {
  name: 'Sharma Kirana', stateCode: '27', gstin: '27AAACT1234A1Z5', gstRegistrationType: 'regular',
  address: '', booksFrom: 2026, email: null, phone: null, pan: null, tan: null
}
function renderUi(ui: React.JSX.Element): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
const calls = (ch: string): unknown[] => invoke.mock.calls.filter(([c]) => c === ch).map(([, p]) => p)
const options = (): HTMLElement[] => within(screen.getByRole('listbox')).queryAllByRole('option')

beforeEach(async () => {
  await loadHsnIndex() // the real list, through the same dynamic import the app uses
  invoke.mockImplementation(async (channel: string, payload?: unknown) => {
    switch (channel) {
      case 'master:units:list': return { ok: true, data: UNITS }
      case 'master:stockItems:list': return { ok: true, data: [] }
      case 'master:stockItems:create': return { ok: true, data: { id: 78, ...(payload as object) } }
      case 'master:stockItems:update': return { ok: true, data: { id: 5 } }
      case 'master:stockItems:quickCreate': {
        const p = payload as { item: { name: string } }
        return { ok: true, data: { item: { id: 77, name: p.item.name }, priceLevelId: 1 } }
      }
      default: return { ok: true, data: [] }
    }
  })
  window.total = { platform: 'test', invoke }
  act(() => useSession.setState({ info, ui: { mode: 'accountant' }, workingDate: '2026-10-13' }))
})
afterEach(() => {
  cleanup()
  invoke.mockReset()
  act(() => useSession.setState({ ui: { mode: 'accountant' } }))
})

describe('accountant: the item master HSN field', () => {
  it('words search the list; ↓ + Enter picks a code; the rate is never suggested', async () => {
    renderUi(<ItemFormModal item={null} onClose={() => {}} />)
    const input = (await screen.findByTestId('input-item-hsn')) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'rice' } })
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    // Every offered code is a code a bill may carry, and its description says rice.
    for (const o of options()) expect(o.textContent).toMatch(/^\d{4}(\d{2}){0,2}.*rice/i)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    // Enter before an arrow keeps the typed text.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('rice')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const code = options()[0]!.getAttribute('data-code')!
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe(code)
    const status = screen.getByTestId('input-item-hsn-status').textContent ?? ''
    expect(status).toContain(code)
    expect(status).toContain('check the rate with your CA')
    // The GST % box is still blank — nothing filled it.
    expect(screen.queryByDisplayValue('5')).toBeNull()
    expect(screen.queryByDisplayValue('18')).toBeNull()
  })

  it('a code prefix lists codes; a code not in the list and 4 / chemical digits get notes, not errors', async () => {
    renderUi(<ItemFormModal item={null} onClose={() => {}} />)
    const input = (await screen.findByTestId('input-item-hsn')) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '9954' } })
    await waitFor(() => expect(options().length).toBeGreaterThan(1))
    expect(options().every((o) => o.getAttribute('data-code')!.startsWith('9954'))).toBe(true)
    expect(screen.getByTestId('input-item-hsn-status').textContent).toContain('Construction services')
    expect(screen.getByTestId('input-item-hsn-status').textContent).toContain('Above ₹5 crore turnover')

    fireEvent.change(input, { target: { value: '10069999' } })
    await waitFor(() => expect(screen.getByTestId('input-item-hsn-status').textContent).toContain("10069999 is not in the GST portal's HSN / SAC list"))
    expect(screen.queryByTestId('input-item-hsn-nomatch')).toBeTruthy()

    fireEvent.change(input, { target: { value: '2931' } })
    await waitFor(() => expect(screen.getByTestId('input-item-hsn-status').textContent).toContain('Notification 90/2020-CT'))
    // The structural rule shows as the field's error only once Save is tried (words search freely).
    fireEvent.change(input, { target: { value: 'rice' } })
    expect(screen.queryByText('HSN must be digits only')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBeNull()
    fireEvent.change(input, { target: { value: '10061' } })
    expect(screen.queryByText('HSN must be 4, 6 or 8 digits')).toBeNull()
    fireEvent.click(screen.getByTestId('btn-item-save'))
    expect(await screen.findByText('HSN must be 4, 6 or 8 digits')).toBeTruthy()
    expect(calls('master:stockItems:create')).toEqual([])
  })

  it('the status describes the box but is never part of its name', async () => {
    renderUi(<ItemFormModal item={null} onClose={() => {}} />)
    const input = (await screen.findByTestId('input-item-hsn')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '1006' } })
    await waitFor(() => expect(screen.getByTestId('input-item-hsn-status').textContent).toContain('RICE'))
    expect(screen.getByRole('combobox', { name: 'HSN' })).toBe(input)
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '')
    expect(describedBy.join(' ')).toContain('check the rate with your CA')
  })

  it('a code typed with a space is saved cleaned; an unchanged stored HSN is saved as stored', async () => {
    renderUi(<ItemFormModal item={null} onClose={() => {}} />)
    await screen.findByText('Pieces (Pcs)')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rice 1kg' } })
    fireEvent.change(screen.getByTestId('input-item-hsn'), { target: { value: '1006 30' } })
    fireEvent.change(screen.getByTestId('input-item-gst-rate'), { target: { value: '5' } })
    fireEvent.click(screen.getByTestId('btn-item-save'))
    await waitFor(() => expect(calls('master:stockItems:create').length).toBe(1))
    expect(calls('master:stockItems:create')[0]).toMatchObject({ hsn: '100630' })
    cleanup()

    // A stored HSN the old rule would refuse (e.g. from an import) is neither re-checked nor rewritten.
    const stored = { id: 5, name: 'Old', groupId: null, unitId: 4, hsn: '1006 30', gstRate: 5, cessRate: null, openingQtyMilli: 0, openingValue: 0, barcode: null, reorderLevelMilli: null } as never
    renderUi(<ItemFormModal item={stored} onClose={() => {}} />)
    await screen.findByText('Pieces (Pcs)')
    fireEvent.click(screen.getByTestId('btn-item-save'))
    await waitFor(() => expect(calls('master:stockItems:update').length).toBe(1))
    expect(calls('master:stockItems:update')[0]).toMatchObject({ data: { hsn: '1006 30' } })
  })
})

describe('Esc closes the open list, never the dialog around it', () => {
  it('item master (accountant)', async () => {
    const onClose = vi.fn()
    renderUi(<ItemFormModal item={null} onClose={onClose} />)
    const input = await screen.findByTestId('input-item-hsn')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'rice' } })
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    // The next Esc is the dialog's again.
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('new product (simple)', async () => {
    act(() => useSession.setState({ ui: { mode: 'simple' } }))
    const onClose = vi.fn()
    renderUi(<NewProductDialog name="Basmati" onClose={onClose} onCreated={() => {}} />)
    await screen.findByText('Pcs')
    const input = screen.getByTestId('input-product-hsn')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'rice' } })
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('dialog-new-product')).toBeTruthy()
  })
})

describe('simple: the new-product dialog', () => {
  beforeEach(() => act(() => useSession.setState({ ui: { mode: 'simple' } })))

  it('searches by words in plain words, picks with the mouse, saves the code — the rate stays unpicked', async () => {
    const onCreated = vi.fn()
    renderUi(<NewProductDialog name="Basmati" onClose={() => {}} onCreated={onCreated} />)
    await screen.findByText('Pcs')
    const input = screen.getByTestId('input-product-hsn') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'rice' } })
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    expect(screen.getByRole('listbox').getAttribute('aria-label')).toBe('Codes in the GST list')
    const first = options()[0]!
    const code = first.getAttribute('data-code')!
    fireEvent.mouseDown(first)
    expect(input.value).toBe(code)
    expect(screen.getByTestId('input-product-hsn-status').textContent).toContain('Total does not know the GST rate for a code — check it with your CA.')
    expect(screen.getAllByRole('radio').some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false)
    fireEvent.click(screen.getByTestId('gst-rate-5'))
    fireEvent.click(screen.getByTestId('btn-product-create'))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(77))
    expect(calls('master:stockItems:quickCreate')[0]).toMatchObject({ item: { hsn: code, gstRate: 5 } })
  })

  it('words or a wrong length are refused under the field; spaces in a code are dropped', async () => {
    const onCreated = vi.fn()
    renderUi(<NewProductDialog name="Notebook" onClose={() => {}} onCreated={onCreated} />)
    await screen.findByText('Pcs')
    fireEvent.click(screen.getByTestId('gst-rate-18'))
    const input = screen.getByTestId('input-product-hsn')
    fireEvent.change(input, { target: { value: 'notebook' } })
    fireEvent.click(screen.getByTestId('btn-product-create'))
    expect((await screen.findByTestId('field-error-hsn')).textContent).toBe('Type the code in numbers only, or pick one from the list.')
    fireEvent.change(input, { target: { value: '48201' } })
    fireEvent.click(screen.getByTestId('btn-product-create'))
    expect((await screen.findByTestId('field-error-hsn')).textContent).toBe('A code has 4, 6 or 8 numbers.')
    fireEvent.change(input, { target: { value: '4820 10' } })
    fireEvent.click(screen.getByTestId('btn-product-create'))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(77))
    expect(calls('master:stockItems:quickCreate')[0]).toMatchObject({ item: { hsn: '482010', gstRate: 18 } })
  })
})

describe('simple words in every language', () => {
  for (const lang of ['en', 'hi', 'hinglish'] as const) {
    it(`${lang}: every label is translated, carries the ₹5 crore limit (money.ts compact), and is banned-word clean`, () => {
      const l = simpleHsnLabels(translator(lang))
      const words = [l.loading, l.list, l.noMatch('chawal'), l.rateNote, l.notInList('10069999'), l.fourDigits, l.eightDigits]
      for (const w of words) expect(w.trim().length).toBeGreaterThan(0)
      expect(l.fourDigits).toContain('₹5Cr')
      expect(l.notInList('10069999')).toContain('10069999')
      expect(l.noMatch('chawal')).toContain('chawal')
      if (lang === 'hi') expect(l.rateNote).toMatch(/[ऀ-ॿ]/)
      if (lang === 'hinglish') for (const w of words) expect(w).not.toMatch(/[ऀ-ॿ]/)
      for (const w of words) expect(bannedWordsIn(w)).toEqual([])
    })
  }

  it('the status speaks the simple words it is given', async () => {
    const Probe = (): React.JSX.Element => <HsnStatusLines lines={useHsnStatus('1006', simpleHsnLabels(translator('hinglish')))} testId="h-status" />
    renderUi(<Probe />)
    expect((await screen.findByTestId('h-status')).textContent).toContain('Total kisi code ka GST rate nahi jaanta')
  })
})
