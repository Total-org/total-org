import { z } from 'zod'
import { plainRupees } from './money'

/**
 * A10 (audit 2026-11, PROD-8) — the UPI "pay me" QR printed on a sales invoice. Pure: no DB, no
 * network; the QR itself is drawn locally by the print renderer (qrcode-generator, as the
 * e-invoice QR).
 *
 * Source: NPCI, "UPI Linking Specifications", version 1.6 (November 2017) — the deep-link form
 * `upi://pay?pa=<payee VPA>&pn=<payee name>&am=<amount>&tn=<note>&cu=INR` that every UPI app
 * scans (`pa` and `pn` mandatory; `am` decimal rupees; `cu` INR only; `tn` a short note). Read
 * from a copy of the 1.6 PDF (https://www.labnol.org/files/linking.pdf) and Google Pay's
 * developer page (https://developers.google.com/pay/india/api/android/in-app-payments), which
 * points at the same NPCI text. UNVERIFIED (not read on npci.org.in itself):
 *   - whether a newer version of the linking spec changes any of these parameters;
 *   - the exact VPA grammar and lengths (we accept `handle@provider` as below — every UPI app
 *     shows the ID in this shape; nothing here is a tax rule, so no "check with your CA" badge);
 *   - a length limit on `tn` (we keep it to the bill number, ≤ 50 characters).
 * A merchant code (`mc`) or a signed / dynamic QR (`tr`, `sign`) is NOT produced: those need a
 * bank-issued merchant ID; a plain person-to-merchant VPA works in every UPI app without them.
 */

/** A UPI ID (VPA): `name@bank` — letters, digits, `.` `-` `_` before the @, letters after. */
export const UPI_ID_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/

/** Cleans what the user typed (spaces dropped, lower-cased: VPAs are case-insensitive). */
export function cleanUpiId(raw: string): string {
  return raw.replace(/\s+/g, '').toLowerCase()
}

export function isUpiId(raw: string): boolean {
  return UPI_ID_RE.test(cleanUpiId(raw))
}

/** Company meta `upi` (owner-only, audited as a company update). Missing = no UPI QR. */
export interface UpiSettings {
  /** The business's UPI ID (VPA); null = none. */
  upiId: string | null
}

export const upiSettingsSchema = z
  .object({
    upiId: z
      .string()
      .max(320)
      .nullable()
      .transform((s) => (s == null || s.trim() === '' ? null : cleanUpiId(s)))
      .refine((s) => s == null || UPI_ID_RE.test(s), { message: 'upi_invalid' })
  })
  .strict()

export function normalizeUpiSettings(raw: unknown): UpiSettings {
  if (raw && typeof raw === 'object' && typeof (raw as { upiId?: unknown }).upiId === 'string') {
    const id = cleanUpiId((raw as { upiId: string }).upiId)
    if (UPI_ID_RE.test(id)) return { upiId: id }
  }
  return { upiId: null }
}

/** Percent-encoding for a query value (RFC 3986 unreserved kept; space as %20, never `+`). */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export interface UpiPayInput {
  upiId: string
  /** Payee name the app shows (the business's name). */
  payeeName: string
  /** What is due on the bill, paise (> 0). */
  amountPaise: number
  /** The bill number — the note the payer's app shows and the business sees on its statement. */
  billNo: string
}

/** The `upi://pay` link for a bill, or null when there is nothing to ask for. */
export function upiPayLink(input: UpiPayInput): string | null {
  const pa = cleanUpiId(input.upiId)
  if (!UPI_ID_RE.test(pa)) return null
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) return null
  const pn = input.payeeName.trim().slice(0, 99) || pa
  const tn = `Bill ${input.billNo}`.trim().slice(0, 50)
  // The @ of the VPA stays as is (every app's own QR prints it so; the grammar above has no
  // other character that needs encoding).
  return `upi://pay?pa=${enc(pa).replace('%40', '@')}&pn=${enc(pn)}&am=${plainRupees(input.amountPaise)}&tn=${enc(tn)}&cu=INR`
}
