import { describe, expect, it } from 'vitest'
import { translator } from './i18n'
import './i18n/all'
import { allowedExternalUrl } from './externalLinks'
import { shareMailto, shareMessage, shareSubject, shareWhatsappLink, type BillShareFacts } from './billShare'

const F: BillShareFacts = {
  voucherId: 7, kind: 'sales', shareable: true, number: '12', date: '2026-10-01', partyName: 'Ramesh',
  whatsapp: '98765 43210', email: 'ramesh@example.in', totalPaise: 118000, duePaise: 68000, upiId: 'sharma@ybl',
  businessName: 'Sharma Stores', shareSheet: true
}
const en = translator('en')

describe('share message (A10)', () => {
  it('a part-paid bill: total, what is still due, the UPI ID', () => {
    expect(shareMessage(F, en)).toBe(
      'Hello Ramesh, here is bill 12 dated 1 Oct 2026 for ₹1,180.00. ₹680.00 is still due. You can pay by UPI to sharma@ybl. The bill is attached as a PDF. — Sharma Stores'
    )
  })
  it('nothing due → no due / UPI line; unpaid → no "still due" (the total is the due)', () => {
    expect(shareMessage({ ...F, duePaise: 0, upiId: null }, en)).toBe('Hello Ramesh, here is bill 12 dated 1 Oct 2026 for ₹1,180.00. The bill is attached as a PDF. — Sharma Stores')
    expect(shareMessage({ ...F, duePaise: 118000 }, en)).not.toContain('still due')
    expect(shareMessage({ ...F, duePaise: 118000 }, en)).toContain('sharma@ybl')
  })
  it('a return note and a walk-in', () => {
    expect(shareMessage({ ...F, kind: 'credit_note', duePaise: 0, upiId: null, partyName: null }, en)).toBe(
      'Hello, here is return note 12 dated 1 Oct 2026 for ₹1,180.00. The bill is attached as a PDF. — Sharma Stores'
    )
    expect(shareSubject({ ...F, kind: 'credit_note' }, en)).toBe('Return note 12 from Sharma Stores')
  })
  it('Hindi and Hinglish carry the same figures', () => {
    for (const lang of ['hi', 'hinglish'] as const) {
      const m = shareMessage(F, translator(lang))
      for (const fig of ['₹1,180.00', '₹680.00', 'sharma@ybl', 'Sharma Stores', '12']) expect(m, lang).toContain(fig)
    }
  })
  it('links: wa.me with the number (91 added) and the text; mailto with the address', () => {
    expect(shareWhatsappLink(F, 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye')
    expect(shareWhatsappLink({ ...F, whatsapp: null }, 'Hi')).toBe('https://wa.me/?text=Hi')
    expect(shareMailto(F, shareSubject(F, en), 'Body')).toBe('mailto:ramesh@example.in?subject=Bill%2012%20from%20Sharma%20Stores&body=Body')
    expect(shareMailto({ ...F, email: 'bad address?x' }, 'S', 'B')).toBe('mailto:?subject=S&body=B')
    // main's window-open handler lets both through (and nothing else).
    expect(allowedExternalUrl(shareWhatsappLink(F, shareMessage(F, en)))).not.toBeNull()
    expect(allowedExternalUrl(shareMailto(F, shareSubject(F, en), shareMessage(F, en)))).not.toBeNull()
  })
})
