import { describe, expect, it } from 'vitest'
import { businessDraft, businessErrors, businessInfoPayload, infoChanged, templateWithBill } from './business'
import { printTemplateSchema } from '../printTemplates'
import type { CompanyInfo } from '../domain'

const INFO: CompanyInfo = {
  name: 'Asha Design', stateCode: '27', gstin: null, gstRegistrationType: 'unregistered', address: 'Pune', booksFrom: 2026,
  gstRegistrationSince: '2026-04-01', email: 'a@b.in', phone: null, pan: null, tan: null
}
const TPL = printTemplateSchema.parse({ id: 'classic', name: 'Classic', builtIn: true })

describe('simple Business details (audit A7 / UX-1)', () => {
  it('a draft sent back unchanged changes nothing', () => {
    const d = businessDraft(INFO, TPL)
    expect(infoChanged(INFO, d)).toBe(false)
    expect(templateWithBill(TPL, d)).toBeNull()
    expect(businessErrors(d, INFO)).toEqual({})
  })

  it('the registration type, state and TAN always go back as the books hold them', () => {
    const d = { ...businessDraft(INFO, TPL), name: ' Asha Design Studio ', gstin: '27AAPFU0939F1ZV' }
    expect(businessInfoPayload(INFO, d)).toEqual({
      name: 'Asha Design Studio', stateCode: '27', gstin: null, gstRegistrationType: 'unregistered', address: 'Pune', booksFrom: 2026,
      email: 'a@b.in', phone: null, pan: null, tan: null
    })
  })

  it('a logo is printed when given and switched off when removed; bank details cleared = none printed', () => {
    const withLogo = templateWithBill(TPL, { ...businessDraft(INFO, TPL), logoDataUrl: 'data:image/png;base64,aGVsbG8=' })!
    expect(withLogo.header).toMatchObject({ logoDataUrl: 'data:image/png;base64,aGVsbG8=', showLogo: true })
    expect(withLogo.footer).toEqual(TPL.footer)
    const banked = { ...TPL, footer: { ...TPL.footer, bankDetails: { name: 'SBI', account: '1', ifsc: 'SBIN0000001', branch: '' } } }
    const cleared = templateWithBill(banked, { ...businessDraft(INFO, banked), bankName: '', bankAccount: '', bankIfsc: '' })!
    expect(cleared.footer.bankDetails).toBeNull()
    const off = templateWithBill(withLogo, { ...businessDraft(INFO, withLogo), logoDataUrl: null })!
    expect(off.header).toMatchObject({ logoDataUrl: null, showLogo: false })
  })
})
