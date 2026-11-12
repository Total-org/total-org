/**
 * Audit A7 / UX-1 — the simple "Business details" screen's pure half: what it shows, its checks
 * (plain `errors.business.*` / `errors.setup.*` keys) and the payloads it saves through the
 * EXISTING channels — `company:updateInfo` for the business (the registration TYPE, the state and
 * the TAN are carried over unchanged: those stay in the full form), `template:save` for the logo
 * and the bank details printed on the template sales bills use.
 */
import type { CompanyInfo } from '../domain'
import type { PrintTemplate } from '../printTemplates'
import type { CompanyCreateInput } from '../schemas'
import type { MessageKey } from '../i18n'
import { z } from 'zod'
import { validateGstin } from '../gst/validate'

/** The designer's limit for a logo (Settings → Bills & printing). */
export const MAX_LOGO_BYTES = 200 * 1024

export interface BusinessDraft {
  name: string
  address: string
  phone: string
  email: string
  gstin: string
  pan: string
  logoDataUrl: string | null
  bankName: string
  bankAccount: string
  bankIfsc: string
  bankBranch: string
}

export type BusinessField = keyof BusinessDraft

type BillPart = Pick<BusinessDraft, 'logoDataUrl' | 'bankName' | 'bankAccount' | 'bankIfsc' | 'bankBranch'>

/** The logo (only when the template prints it) and bank details the bill template holds. */
function billPart(template: PrintTemplate | null): BillPart {
  const bank = template?.footer.bankDetails ?? null
  return {
    logoDataUrl: template?.header.showLogo === false ? null : template?.header.logoDataUrl ?? null,
    bankName: bank?.name ?? '',
    bankAccount: bank?.account ?? '',
    bankIfsc: bank?.ifsc ?? '',
    bankBranch: bank?.branch ?? ''
  }
}

export function businessDraft(info: CompanyInfo, template: PrintTemplate | null): BusinessDraft {
  return {
    name: info.name,
    address: info.address ?? '',
    phone: info.phone ?? '',
    email: info.email ?? '',
    gstin: info.gstin ?? '',
    pan: info.pan ?? '',
    ...billPart(template)
  }
}

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/
/** The server's own check (companyCreateSchema's `.email()`), so a typed address is never
 *  accepted here and refused by company:updateInfo. */
const EMAIL = z.string().email()

/** A registered business (regular or composition) keeps a GSTIN; this screen never changes how
 *  the business is registered. */
export const isRegistered = (info: CompanyInfo): boolean => info.gstRegistrationType !== 'unregistered'

export function businessErrors(d: BusinessDraft, info: CompanyInfo): Partial<Record<BusinessField, MessageKey>> {
  const e: Partial<Record<BusinessField, MessageKey>> = {}
  if (!d.name.trim()) e.name = 'errors.setup.nameNeeded'
  if (d.address.trim().length > 500) e.address = 'errors.business.addressTooLong'
  if (d.phone.trim().length > 20) e.phone = 'errors.business.phoneTooLong'
  if (d.email.trim() && !EMAIL.safeParse(d.email.trim()).success) e.email = 'errors.business.emailInvalid'
  if (isRegistered(info)) {
    const g = d.gstin.trim().toUpperCase()
    if (!g) e.gstin = 'errors.business.gstinNeeded'
    else if (!validateGstin(g).valid) e.gstin = 'errors.setup.gstinInvalid'
    else if (g.slice(0, 2) !== info.stateCode) e.gstin = 'errors.business.gstinOtherState'
  }
  if (d.pan.trim() && !PAN_RE.test(d.pan.trim().toUpperCase())) e.pan = 'errors.business.panInvalid'
  const bankTyped = [d.bankName, d.bankAccount, d.bankIfsc, d.bankBranch].some((s) => s.trim())
  if (bankTyped) {
    if (!d.bankName.trim()) e.bankName = 'errors.business.bankNameNeeded'
    if (!d.bankAccount.trim()) e.bankAccount = 'errors.business.bankAccountNeeded'
    if (!IFSC_RE.test(d.bankIfsc.trim().toUpperCase())) e.bankIfsc = 'errors.business.ifscInvalid'
  }
  return e
}

/** What `company:updateInfo` gets: the typed fields; everything else as the books hold it. */
export function businessInfoPayload(info: CompanyInfo, d: BusinessDraft): CompanyCreateInput {
  return {
    name: d.name.trim(),
    stateCode: info.stateCode,
    gstin: isRegistered(info) ? d.gstin.trim().toUpperCase() : info.gstin,
    gstRegistrationType: info.gstRegistrationType,
    address: d.address.trim(),
    booksFrom: info.booksFrom,
    email: d.email.trim() || null,
    phone: d.phone.trim() || null,
    pan: d.pan.trim() ? d.pan.trim().toUpperCase() : null,
    tan: info.tan
  }
}

/** True when the business part differs from what the books hold. */
export function infoChanged(info: CompanyInfo, d: BusinessDraft): boolean {
  const a = businessInfoPayload(info, d)
  return (
    a.name !== info.name || a.address !== (info.address ?? '') || a.email !== (info.email ?? null) ||
    a.phone !== (info.phone ?? null) || a.pan !== (info.pan ?? null) || a.gstin !== (info.gstin ?? null)
  )
}

/** The bill template with the typed logo and bank details (null when nothing about them changed). */
export function templateWithBill(template: PrintTemplate, d: BusinessDraft): PrintTemplate | null {
  const bankTyped = [d.bankName, d.bankAccount, d.bankIfsc, d.bankBranch].some((s) => s.trim())
  const bankDetails = bankTyped
    ? { name: d.bankName.trim(), account: d.bankAccount.trim(), ifsc: d.bankIfsc.trim().toUpperCase(), branch: d.bankBranch.trim() }
    : null
  const was = billPart(template)
  const sameBank = was.bankName === d.bankName && was.bankAccount === d.bankAccount && was.bankIfsc === d.bankIfsc && was.bankBranch === d.bankBranch
  const sameLogo = was.logoDataUrl === d.logoDataUrl
  if (sameBank && sameLogo) return null
  return {
    ...template,
    header: sameLogo ? template.header : { ...template.header, logoDataUrl: d.logoDataUrl, showLogo: d.logoDataUrl != null },
    footer: sameBank ? template.footer : { ...template.footer, bankDetails }
  }
}
