// WP 2d — a discount debited to an account under Sales Accounts on a sales bill: GSTR-1 reports the
// value before it — since the owner's decision of 13 Nov it is taken off (s.15(3)(a)); the warning
// (`sales_discount_line`) says the e-invoice / print still show the value before it.
import { describe, expect, it } from 'vitest'
import { seededDb, TEST_INFO } from '../db/testdb'
import { createLedger, createStockItem, listUnits } from './masters'
import { saveVoucher } from './vouchers'
import { extractOutwardDocs, gstr3b, gstValidate, lessDiscount } from './gst'
import type { DrCr } from '@shared/domain'

const FROM = '2026-07-01'
const TO = '2026-07-31'

describe('discount booked on a Sales account (WP 2d)', () => {
  it('takes the discount off the taxable value (owner, 13 Nov) and says so; a round off under ₹1 is not a discount', () => {
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
    const discountGiven = L({ name: 'Discount given', groupId: groupId('Indirect Expenses') })
    const cnType = (db.prepare("SELECT id FROM voucher_types WHERE kind = 'credit_note'").get() as { id: number }).id
    const sale = (lines: { ledgerId: number; drCr: DrCr; amount: number }[], type = vt) =>
      saveVoucher(db, { voucherTypeId: type, date: '2026-07-05', partyLedgerId: buyer, lines: lines.map((l) => ({ ...l, costAllocations: [] })), inventory: [], billRefs: [], tds: null })
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
    // Review of #279: ₹1,180 rounded down to ₹1,175 (Tally's ₹5 rounding) on a "Rounding Off" account
    // (Indirect Expenses): ₹5, but a round off is never a discount — ₹1,000 / ₹90 + ₹90 as before.
    const roundOff5 = L({ name: 'Rounding Off', groupId: groupId('Indirect Expenses') })
    const rounded = sale([
      { ledgerId: buyer, drCr: 'dr', amount: 117500 },
      { ledgerId: roundOff5, drCr: 'dr', amount: 500 },
      { ledgerId: sales, drCr: 'cr', amount: 100000 },
      { ledgerId: cgst, drCr: 'cr', amount: 9000 },
      { ledgerId: sgst, drCr: 'cr', amount: 9000 }
    ])
    // Review of #269: the same discount debited to "Discount given" (Indirect Expenses, the setup
    // preset's account / Tally's "Discount Allowed"), tax on the gross: ₹1,000 + ₹180 − ₹100 = ₹1,080.
    const onExpense = sale([
      { ledgerId: buyer, drCr: 'dr', amount: 108000 },
      { ledgerId: discountGiven, drCr: 'dr', amount: 10000 },
      { ledgerId: sales, drCr: 'cr', amount: 100000 },
      { ledgerId: cgst, drCr: 'cr', amount: 9000 },
      { ledgerId: sgst, drCr: 'cr', amount: 9000 }
    ])
    // Credit notes: the other side is Cr. A plain accounting-mode note (Dr Sales + tax, Cr the buyer)
    // is not warned; one with ₹50 credited to an income account is.
    sale([
      { ledgerId: sales, drCr: 'dr', amount: 10000 },
      { ledgerId: cgst, drCr: 'dr', amount: 900 },
      { ledgerId: sgst, drCr: 'dr', amount: 900 },
      { ledgerId: buyer, drCr: 'cr', amount: 11800 }
    ], cnType)
    const noteWithIncome = sale([
      { ledgerId: sales, drCr: 'dr', amount: 10000 },
      { ledgerId: cgst, drCr: 'dr', amount: 900 },
      { ledgerId: sgst, drCr: 'dr', amount: 900 },
      { ledgerId: buyer, drCr: 'cr', amount: 6800 },
      { ledgerId: discount, drCr: 'cr', amount: 5000 }
    ], cnType)
    const issue = gstValidate(db, TEST_INFO, FROM, TO).find((i) => i.code === 'sales_discount_line')
    expect(issue).toMatchObject({ severity: 'warning', voucherIds: [withDiscount.id, onExpense.id, noteWithIncome.id] })
    expect(issue!.message).toContain('s.15(3)(a)')
    // Two of them charged GST on the value before the discount: said, and reported as charged.
    expect(issue!.message).toContain('2 charged GST on the value BEFORE it')
    // Owner, 13 Nov: the discount is taken off when the bill charged GST on the value after it —
    // ₹900 taxable, ₹81 + ₹81 (party ₹1,062 = ₹900 + ₹162: the value ties, no val_mismatch).
    const docs = extractOutwardDocs(db, TEST_INFO, FROM, TO)
    expect(docs.find((d) => d.voucherId === withDiscount.id)!.items).toEqual([{ rate: 18, taxable: 90000, cgst: 8100, sgst: 8100, igst: 0, cess: 0 }])
    expect(docs.find((d) => d.voucherId === withDiscount.id)!.invoiceValue).toBe(106200)
    expect(docs.find((d) => d.voucherId === withDiscount.id)!.validation!.valDiff).toBe(0)
    // Review of #279: tax on the gross (₹1,000 + ₹180 − ₹100 = ₹1,080 charged) — netting would report
    // ₹900 at 18 % with ₹180 of tax (less tax than collected is never reported): kept as charged,
    // ₹1,000 taxable, ₹90 + ₹90, value ₹1,180 (the party's ₹1,080 + the ₹100 discount line).
    expect(docs.find((d) => d.voucherId === onExpense.id)!.items).toEqual([{ rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0 }])
    expect(docs.find((d) => d.voucherId === onExpense.id)!.invoiceValue).toBe(118000)
    // The credit note's ₹50 income line: its tax (₹9 + ₹9) is 18 % of ₹100, not ₹50 — kept as charged.
    expect(docs.find((d) => d.voucherId === noteWithIncome.id)!.items[0]!.taxable).toBe(10000)
    expect(docs.find((d) => d.voucherId === rounded.id)!.items).toEqual([{ rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0 }])
    // A kept bill never blocks the export: only warnings.
    expect(gstValidate(db, TEST_INFO, FROM, TO).filter((i) => i.severity === 'blocking')).toEqual([])
  })

  it('shares the discount pro rata over several rates and item lines; GSTR-3B 3.1(a) carries the value after it', () => {
    const db = seededDb()
    const groupId = (name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
    const vt = (db.prepare("SELECT id FROM voucher_types WHERE kind = 'sales'").get() as { id: number }).id
    const L = (input: Parameters<typeof createLedger>[1]): number => createLedger(db, input).id
    const buyer = L({ name: 'Buyer', groupId: groupId('Sundry Debtors'), stateCode: '27', gstin: '27AAPFU0939F1ZV' })
    const s18 = L({ name: 'Sales 18', groupId: groupId('Sales Accounts'), gstRate: 18, hsn: '8471' })
    const s5 = L({ name: 'Sales 5', groupId: groupId('Sales Accounts'), gstRate: 5, hsn: '1006' })
    const plain = L({ name: 'Sales', groupId: groupId('Sales Accounts') })
    const discount = L({ name: 'Discount allowed', groupId: groupId('Sales Accounts') })
    const cgst = L({ name: 'Output CGST', groupId: groupId('Duties & Taxes'), taxType: 'cgst' })
    const sgst = L({ name: 'Output SGST', groupId: groupId('Duties & Taxes'), taxType: 'sgst' })
    const line = (ledgerId: number, drCr: DrCr, amount: number) => ({ ledgerId, drCr, amount, costAllocations: [] })
    // ₹600 at 18 % + ₹400 at 5 %, ₹100 off: ₹60 / ₹40 by value → ₹540 and ₹360.
    // Tax: ₹540 × 18 % = ₹97.20 (₹48.60 + ₹48.60); ₹360 × 5 % = ₹18 (₹9 + ₹9). Party ₹900 + ₹115.20 = ₹1,015.20.
    const mixed = saveVoucher(db, {
      voucherTypeId: vt, date: '2026-08-05', partyLedgerId: buyer,
      lines: [line(buyer, 'dr', 101520), line(discount, 'dr', 10000), line(s18, 'cr', 60000), line(s5, 'cr', 40000), line(cgst, 'cr', 5760), line(sgst, 'cr', 5760)],
      inventory: [], billRefs: [], tds: null
    })
    // Item mode: one laptop at ₹1,000 (18 %), ₹100 off on a Sales account: ₹900, ₹81 + ₹81, party ₹1,062.
    const unitId = listUnits(db)[0]!.id
    const laptop = createStockItem(db, { name: 'Laptop', groupId: null, unitId, hsn: '8471', gstRate: 18, cessRate: null, openingQtyMilli: 5000, openingValue: 400000, barcode: null, reorderLevelMilli: null })
    const item = saveVoucher(db, {
      voucherTypeId: vt, date: '2026-08-06', partyLedgerId: buyer,
      lines: [line(buyer, 'dr', 106200), line(discount, 'dr', 10000), line(plain, 'cr', 100000), line(cgst, 'cr', 8100), line(sgst, 'cr', 8100)],
      inventory: [{ stockItemId: laptop.id, godownId: null, qtyMilli: 1000, ratePaise: 100000, amount: 100000, direction: 'out' }],
      billRefs: [], tds: null
    })
    const docs = extractOutwardDocs(db, TEST_INFO, '2026-08-01', '2026-08-31')
    const byRate = (id: number) => [...docs.find((d) => d.voucherId === id)!.items].sort((a, b) => a.rate - b.rate)
    expect(byRate(mixed.id)).toEqual([
      { rate: 5, taxable: 36000, cgst: 900, sgst: 900, igst: 0, cess: 0 },
      { rate: 18, taxable: 54000, cgst: 4860, sgst: 4860, igst: 0, cess: 0 }
    ])
    expect(docs.find((d) => d.voucherId === mixed.id)!.validation!.valDiff).toBe(0)
    expect(byRate(item.id)).toEqual([{ rate: 18, taxable: 90000, cgst: 8100, sgst: 8100, igst: 0, cess: 0 }])
    expect(docs.find((d) => d.voucherId === item.id)!.validation!.valDiff).toBe(0)
    // 3.1(a): ₹900 + ₹900 taxable; CGST ₹48.60 + ₹9 + ₹81 = ₹138.60 (SGST the same).
    const r = gstr3b(db, TEST_INFO, '2026-08-01', '2026-08-31', '082026')
    expect(r.outward).toMatchObject({ taxable: 180000, cgst: 13860, sgst: 13860, igst: 0 })
  })

  it("a credit note's original carries the value GSTR-1 reported for it (review of #279)", () => {
    const db = seededDb()
    const groupId = (name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
    const vtOf = (kind: string): number => (db.prepare('SELECT id FROM voucher_types WHERE kind = ?').get(kind) as { id: number }).id
    const L = (input: Parameters<typeof createLedger>[1]): number => createLedger(db, input).id
    // An unregistered buyer in Karnataka (29): inter-state, IGST.
    const buyer = L({ name: 'Walk-in KA', groupId: groupId('Sundry Debtors'), stateCode: '29' })
    const sales = L({ name: 'Sales 18', groupId: groupId('Sales Accounts'), gstRate: 18, hsn: '8471' })
    const discount = L({ name: 'Discount allowed', groupId: groupId('Sales Accounts') })
    const igst = L({ name: 'Output IGST', groupId: groupId('Duties & Taxes'), taxType: 'igst' })
    const line = (ledgerId: number, drCr: DrCr, amount: number) => ({ ledgerId, drCr, amount, costAllocations: [] })
    // ₹1,00,000 less ₹20,000 = ₹80,000; IGST 18 % = ₹14,400; the buyer pays ₹94,400 (under the ₹1 lakh B2CL limit).
    const bill = saveVoucher(db, {
      voucherTypeId: vtOf('sales'), date: '2026-07-05', partyLedgerId: buyer,
      lines: [line(buyer, 'dr', 9_440_000), line(discount, 'dr', 2_000_000), line(sales, 'cr', 10_000_000), line(igst, 'cr', 1_440_000)],
      inventory: [], billRefs: [], tds: null
    })
    // ₹1,000 + ₹180 back, referencing the bill.
    const note = saveVoucher(db, {
      voucherTypeId: vtOf('credit_note'), date: '2026-07-20', partyLedgerId: buyer, reference: bill.number,
      lines: [line(sales, 'dr', 100_000), line(igst, 'dr', 18_000), line(buyer, 'cr', 118_000)],
      inventory: [], billRefs: [], tds: null
    })
    const docs = extractOutwardDocs(db, TEST_INFO, FROM, TO)
    expect(docs.find((d) => d.voucherId === bill.id)!.invoiceValue).toBe(9_440_000)
    // The bill went to B2CS at ₹94,400: its note is judged on the same ₹94,400 (not ₹1,14,400).
    expect(docs.find((d) => d.voucherId === note.id)!.original).toMatchObject({ invoiceValue: 9_440_000 })
  })

  it('lessDiscount shares a discount pro rata by value, in whole paise (largest remainders), never below nil', () => {
    // ₹100 off ₹600 + ₹400: ₹60 + ₹40.
    expect(lessDiscount([60_000, 40_000], 10_000)).toEqual([54_000, 36_000])
    // ₹1 off three equal ₹1 lines: 33.33… each → 34 / 33 / 33 paise (the first remainder wins the extra paisa).
    expect(lessDiscount([100, 100, 100], 100)).toEqual([66, 67, 67])
    // More discount than value: every line to nil.
    expect(lessDiscount([5_000, 5_000], 20_000)).toEqual([0, 0])
    // None: unchanged. Large values stay exact (BigInt): ₹1,00,00,000 lines, ₹33,33,333.33 off.
    expect(lessDiscount([7, 9], 0)).toEqual([7, 9])
    expect(lessDiscount([1_000_000_000, 2_000_000_000], 333_333_333).reduce((a, b) => a + b, 0)).toBe(3_000_000_000 - 333_333_333)
  })
})
