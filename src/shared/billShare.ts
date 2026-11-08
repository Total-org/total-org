// A10 (audit 2026-11 PROD-7) — share a bill: the facts main returns about one printed document,
// and the plain message that goes with its PDF. Pure. The app itself sends nothing: WhatsApp is
// the existing `https://wa.me/` link opened in the OS browser (shared/simple/people.ts), e-mail is
// a `mailto:` draft in the user's mail app, the macOS share sheet is Electron's ShareMenu — all
// allowed by shared/externalLinks.ts / main's window-open handler. The PDF is saved in the
// company's exports folder and shown in Finder so the user can attach it.
import type { Translate } from './i18n'
import { formatPaise } from './money'
import { toPlainDate } from './dates'
import { whatsappLink } from './simple/people'

export const SHARE_VIAS = ['whatsapp', 'email', 'sheet', 'folder'] as const
export type ShareVia = (typeof SHARE_VIAS)[number]

export interface BillShareFacts {
  voucherId: number
  /** The voucher kind ('sales', 'credit_note' …); only sales bills and credit notes are shared. */
  kind: string
  shareable: boolean
  number: string
  date: string
  partyName: string | null
  /** The party's WhatsApp number, else its phone (null = WhatsApp asks whom to send it to). */
  whatsapp: string | null
  email: string | null
  totalPaise: number
  /** What is still due on the bill as on today (0 = nothing; a credit note: 0). */
  duePaise: number
  /** The business's UPI ID when set and something is due on a sales bill (said in the message). */
  upiId: string | null
  businessName: string
  /** Electron's share sheet is macOS only. */
  shareSheet: boolean
}

/** The message: "Hello Ramesh, here is bill 12 dated 1 October 2026 for ₹1,180.00. ₹680.00 is
 *  still due. You can pay by UPI to shop@ybl. — Sharma Stores". */
export function shareMessage(f: BillShareFacts, t: Translate): string {
  const vars = {
    name: f.partyName ?? '',
    number: f.number,
    date: toPlainDate(f.date, t.lang),
    amount: formatPaise(f.totalPaise, { symbol: true }),
    due: formatPaise(f.duePaise, { symbol: true }),
    upiId: f.upiId ?? '',
    business: f.businessName
  }
  const note = f.kind === 'credit_note'
  return [
    f.partyName ? t('simple.share.helloName', vars) : t('simple.share.hello'),
    note ? t('simple.share.noteBody', vars) : t('simple.share.body', vars),
    !note && f.duePaise > 0 && f.duePaise < f.totalPaise ? t('simple.share.stillDue', vars) : '',
    !note && f.duePaise > 0 && f.upiId ? t('simple.share.upi', vars) : '',
    note ? t('simple.share.noteAttached') : t('simple.share.attached'),
    t('simple.share.sign', vars)
  ].filter(Boolean).join(' ')
}

export function shareSubject(f: BillShareFacts, t: Translate): string {
  const vars = { number: f.number, business: f.businessName }
  return f.kind === 'credit_note' ? t('simple.share.noteSubject', vars) : t('simple.share.subject', vars)
}

export function shareWhatsappLink(f: BillShareFacts, text: string): string {
  return whatsappLink(f.whatsapp, text)
}

/** `mailto:<party e-mail>?subject=…&body=…` (no address = the mail app asks). */
export function shareMailto(f: BillShareFacts, subject: string, body: string): string {
  const to = f.email && /^[^\s@<>?&]+@[^\s@<>?&]+$/.test(f.email.trim()) ? encodeURIComponent(f.email.trim()).replace('%40', '@') : ''
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
