// WP 2d — a discount debited to an account under Sales Accounts on a sales bill: GSTR-1 reports the
// value before it — since the owner's decision of 13 Nov it is taken off (s.15(3)(a)); the warning
// (`sales_discount_line`) says the e-invoice / print still show the value before it.
import { describe, expect, it } from 'vitest'
import { seededDb, TEST_INFO } from '../db/testdb'
import { createLedger } from './masters'
import { saveVoucher } from './vouchers'
import { extractOutwardDocs, gstValidate, lessDiscount } from './gst'
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
    // Owner, 13 Nov: the discount is taken off — ₹900 taxable, ₹81 + ₹81 (the bill posted GST on ₹900:
    // the value now ties — no val_mismatch).
    const docs = extractOutwardDocs(db, TEST_INFO, FROM, TO)
    expect(docs.find((d) => d.voucherId === withDiscount.id)!.items).toEqual([{ rate: 18, taxable: 90000, cgst: 8100, sgst: 8100, igst: 0, cess: 0 }])
    expect(docs.find((d) => d.voucherId === withDiscount.id)!.validation!.valDiff).toBe(0)
    // Tax on the gross (₹1,000 + ₹180 − ₹100 = ₹1,080 charged): ₹900 at 18 % is ₹1,062 — ₹18 over: the value check says so.
    expect(docs.find((d) => d.voucherId === onExpense.id)!.items[0]!.taxable).toBe(90000)
    expect(docs.find((d) => d.voucherId === onExpense.id)!.validation!.valDiff).toBe(1800)
    // The credit note's ₹50 income line comes off its ₹100: ₹50 taxable.
    expect(docs.find((d) => d.voucherId === noteWithIncome.id)!.items[0]!.taxable).toBe(5000)
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
