// WP 2d — a discount debited to an account under Sales Accounts on a sales bill: GSTR-1 reports the
// value before it (only the sales-side lines are read). A warning (`sales_discount_line`); no figure moves.
import { describe, expect, it } from 'vitest'
import { seededDb, TEST_INFO } from '../db/testdb'
import { createLedger } from './masters'
import { saveVoucher } from './vouchers'
import { extractOutwardDocs, gstValidate } from './gst'
import type { DrCr } from '@shared/domain'

const FROM = '2026-07-01'
const TO = '2026-07-31'

describe('discount booked on a Sales account (WP 2d)', () => {
  it('warns about the bill; the document is as before (value before the discount); a round off under ₹1 is not a discount', () => {
    const db = seededDb()
    const groupId = (name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
    const vt = (db.prepare("SELECT id FROM voucher_types WHERE kind = 'sales'").get() as { id: number }).id
    const L = (input: Parameters<typeof createLedger>[1]): number => createLedger(db, input).id
    const buyer = L({ name: 'Buyer', groupId: groupId('Sundry Debtors'), stateCode: '27', gstin: '27AAPFU0939F1ZV' })
    const sales = L({ name: 'Sales 18', groupId: groupId('Sales Accounts'), gstRate: 18, hsn: '8471' })
    const discount = L({ name: 'Discount allowed', groupId: groupId('Sales Accounts') })
    const roundOff = L({ name: 'Round Off', groupId: groupId('Indirect Incomes') })
    const cgst = L({ name: 'Output CGST', groupId: groupId('Duties & Taxes'), taxType: 'cgst' })
    const sgst = L({ name: 'Output SGST', groupId: groupId('Duties & Taxes'), taxType: 'sgst' })
    const sale = (lines: { ledgerId: number; drCr: DrCr; amount: number }[]) =>
      saveVoucher(db, { voucherTypeId: vt, date: '2026-07-05', partyLedgerId: buyer, lines: lines.map((l) => ({ ...l, costAllocations: [] })), inventory: [], billRefs: [], tds: null })
    // ₹1,000 sale, ₹100 discount on the bill, GST on ₹900 = ₹81 + ₹81: party ₹1,062.
    const withDiscount = sale([
      { ledgerId: buyer, drCr: 'dr', amount: 106200 },
      { ledgerId: discount, drCr: 'dr', amount: 10000 },
      { ledgerId: sales, drCr: 'cr', amount: 100000 },
      { ledgerId: cgst, drCr: 'cr', amount: 8100 },
      { ledgerId: sgst, drCr: 'cr', amount: 8100 }
    ])
    // ₹1,000 + ₹180 GST, 40 paise rounded down on a round-off account under Indirect Incomes.
    sale([
      { ledgerId: buyer, drCr: 'dr', amount: 117960 },
      { ledgerId: roundOff, drCr: 'dr', amount: 40 },
      { ledgerId: sales, drCr: 'cr', amount: 100000 },
      { ledgerId: cgst, drCr: 'cr', amount: 9000 },
      { ledgerId: sgst, drCr: 'cr', amount: 9000 }
    ])
    const issue = gstValidate(db, TEST_INFO, FROM, TO).find((i) => i.code === 'sales_discount_line')
    expect(issue).toMatchObject({ severity: 'warning', voucherIds: [withDiscount.id] })
    expect(issue!.message).toContain('s.15(3)(a)')
    // As before: the document carries the ₹1,000 sales line (the discount is not netted).
    expect(extractOutwardDocs(db, TEST_INFO, FROM, TO).find((d) => d.voucherId === withDiscount.id)!.items[0]!.taxable).toBe(100000)
  })
})
