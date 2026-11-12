// Audit A7 / UX-1 — Settings → Business details in plain words. It saves the business through
// company:updateInfo (the registration type, state and TAN carried over unchanged) and the logo /
// bank details on the template sales bills use (template:save); checks are plain and sit under
// their fields; only the owner (or anyone in a company without sign-ins) can save.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SimpleBusiness } from '../simple/SimpleBusiness'
import { useNav, useSession, useToasts } from '../state/stores'
import { printTemplateSchema } from '@shared/printTemplates'
import { bannedWordsIn } from '@shared/simple/bannedWords'
import type { CompanyInfo } from '@shared/domain'
import { gstinCheckChar } from '@shared/gst/validate'

const INFO: CompanyInfo = {
  name: 'Ramesh Stores', stateCode: '27', gstin: '27AAPFU0939F1ZV', gstRegistrationType: 'regular', address: '', booksFrom: 2026,
  booksBeginDate: '2026-11-07', email: null, phone: null, pan: null, tan: 'PNEA12345B'
}
const CLASSIC = printTemplateSchema.parse({ id: 'classic', name: 'Classic', builtIn: true })

function mount(info: CompanyInfo = INFO, user: unknown = null, refuse: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (channel: string, payload?: unknown) => {
    if (refuse[channel]) return { ok: false, ...(refuse[channel] as object) }
    if (channel === 'template:list') return { ok: true, data: { templates: [], defaults: { sales: 'classic' } } }
    if (channel === 'template:get') return { ok: true, data: CLASSIC }
    if (channel === 'template:save') return { ok: true, data: (payload as { template: unknown }).template }
    if (channel === 'company:updateInfo') return { ok: true, data: { ...info, ...(payload as object) } }
    return { ok: true, data: null }
  })
  window.total = { platform: 'test', invoke } as never
  useSession.setState({ info, slug: 'ramesh-stores', user: user as never })
  useNav.setState({ stack: [{ name: 'simple-business' }] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SimpleBusiness />
    </QueryClientProvider>
  )
  return invoke
}

afterEach(() => {
  cleanup()
  useSession.setState({ user: null })
})

const type = (id: string, value: string): void => {
  fireEvent.change(screen.getByTestId(id), { target: { value } })
}

describe('Business details (audit A7 / UX-1)', () => {
  it('plain words, the GSTIN for a registered business, no accountant terms', async () => {
    mount()
    await screen.findByTestId('input-business-name')
    expect((screen.getByTestId('input-business-gstin') as HTMLInputElement).value).toBe('27AAPFU0939F1ZV')
    expect(screen.getByTestId('simple-business-gst').textContent).toBe('Your business is registered for GST. State: Maharashtra.')
    expect(bannedWordsIn(document.body.textContent ?? '')).toEqual([])
    expect(document.body.textContent).not.toMatch(/GSTR|IRN|e-invoicing applicability|ledger/i)
    // Save waits until something changed.
    expect((screen.getByTestId('btn-business-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('checks sit under their fields; a good answer saves the business and the bank details on bills', async () => {
    const invoke = mount()
    await screen.findByTestId('input-business-name')
    type('input-business-address', '4 Laxmi Road, Pune 411030')
    type('input-business-phone', '9822012345')
    type('input-business-pan', 'abcde')
    type('input-business-bank-name', 'HDFC Bank')
    type('input-business-bank-ifsc', 'HDFC12')
    fireEvent.click(screen.getByTestId('btn-business-save'))
    expect((await screen.findByTestId('field-error-pan')).textContent).toBe('A PAN is 5 letters, 4 numbers and a letter, like ABCDE1234F.')
    expect(screen.getByTestId('field-error-bankAccount').textContent).toBe('Type the account number, or clear all the bank details.')
    expect(screen.getByTestId('field-error-bankIfsc').textContent).toBe('An IFSC is 11 letters and numbers, like HDFC0001234.')
    expect(invoke.mock.calls.some(([c]) => c === 'company:updateInfo')).toBe(false)
    // The message goes as soon as its field changes.
    type('input-business-pan', 'abcde1234f')
    expect(screen.queryByTestId('field-error-pan')).toBeNull()
    type('input-business-bank-account', '50100012345678')
    type('input-business-bank-ifsc', 'hdfc0001234')
    fireEvent.click(screen.getByTestId('btn-business-save'))
    await waitFor(() => expect(invoke.mock.calls.some(([c]) => c === 'template:save')).toBe(true))
    const info = invoke.mock.calls.find(([c]) => c === 'company:updateInfo')![1]
    expect(info).toEqual({
      name: 'Ramesh Stores', stateCode: '27', gstin: '27AAPFU0939F1ZV', gstRegistrationType: 'regular', address: '4 Laxmi Road, Pune 411030',
      booksFrom: 2026, email: null, phone: '9822012345', pan: 'ABCDE1234F', tan: 'PNEA12345B'
    })
    const saved = (invoke.mock.calls.find(([c]) => c === 'template:save')![1] as { template: typeof CLASSIC }).template
    expect(saved.id).toBe('classic')
    expect(saved.footer.bankDetails).toEqual({ name: 'HDFC Bank', account: '50100012345678', ifsc: 'HDFC0001234', branch: '' })
    expect(saved.header).toEqual(CLASSIC.header) // the logo was not touched
    await waitFor(() => expect(useToasts.getState().toasts.map((x) => x.text)).toContain('Business details saved.'))
  })

  it('a GSTIN of another state is refused under the field; an unregistered business has no GSTIN box', async () => {
    mount()
    await screen.findByTestId('input-business-gstin')
    type('input-business-gstin', `29AAPFU0939F1Z${gstinCheckChar('29AAPFU0939F1Z')}`)
    fireEvent.click(screen.getByTestId('btn-business-save'))
    expect((await screen.findByTestId('field-error-gstin')).textContent).toContain('for another state')
    cleanup()
    mount({ ...INFO, gstin: null, gstRegistrationType: 'unregistered' })
    await screen.findByTestId('input-business-name')
    expect(screen.queryByTestId('input-business-gstin')).toBeNull()
    expect(screen.getByTestId('simple-business-gst').textContent).toContain('not registered for GST')
  })

  it('review: a refusal from main lands under its field in plain words; a bill-part failure says the business part was saved', async () => {
    const invoke = mount(INFO, null, {
      'company:updateInfo': { error: 'email: Invalid email address', code: 'invalid_input', issues: [{ code: 'zod.invalid_format', field: 'email', message: 'Invalid email address' }] }
    })
    await screen.findByTestId('input-business-name')
    type('input-business-email', 'ram@shop.in')
    fireEvent.click(screen.getByTestId('btn-business-save'))
    const under = await screen.findByTestId('field-error-email')
    expect(under.textContent).not.toMatch(/Invalid email address/)
    expect(useToasts.getState().toasts.some((x) => x.text.includes('Invalid email address'))).toBe(false)
    expect(invoke.mock.calls.some(([c]) => c === 'template:save')).toBe(false)
    cleanup()
    useToasts.setState({ toasts: [] })
    mount(INFO, null, { 'template:save': { error: 'disk full' } })
    await screen.findByTestId('input-business-name')
    type('input-business-phone', '9822012345')
    type('input-business-bank-name', 'SBI')
    type('input-business-bank-account', '1234')
    type('input-business-bank-ifsc', 'SBIN0000001')
    fireEvent.click(screen.getByTestId('btn-business-save'))
    await waitFor(() => expect(useToasts.getState().toasts.map((x) => x.text)).toContain('Your business details are saved, but the logo and bank details could not be saved. Try again, or set them in Bills & printing.'))
  })

  it('the rest of the company form is one click away', async () => {
    mount()
    fireEvent.click(await screen.findByTestId('btn-business-full-form'))
    await waitFor(() => expect(useNav.getState().stack.at(-1)).toEqual({ name: 'company-info' }))
  })

  it('only the owner saves: an accountant reads it with a note, a viewer gets the viewer note', async () => {
    mount(INFO, { id: 3, name: 'Asha', role: 'accountant' })
    expect(await screen.findByTestId('simple-business-owner-only')).toBeTruthy()
    expect(screen.queryByTestId('btn-business-save')).toBeNull()
    expect((screen.getByTestId('input-business-name') as HTMLInputElement).readOnly).toBe(true)
    cleanup()
    mount(INFO, { id: 2, name: 'Vee', role: 'viewer' })
    expect(await screen.findByTestId('viewer-note-top')).toBeTruthy()
    expect(screen.queryByTestId('btn-business-save')).toBeNull()
  })
})
