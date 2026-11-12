// WP 2d — several rate-less sales lines blended into ONE rate: a warning on the GSTR-1 checks
// (`blended_rate`); every document is extracted exactly as before.
import { describe, expect, it } from 'vitest'
import { seededDb, TEST_INFO } from '../db/testdb'
import { createLedger } from './masters'
import { saveVoucher } from './vouchers'
import { extractOutwardDocs, gstValidate, type OutwardExtractionNotes } from './gst'
import type { DrCr } from '@shared/domain'

const FROM = '2026-07-01'
const TO = '2026-07-31'

function setup() {
  const db = seededDb()
  const groupId = (name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
  const vt = (db.prepare("SELECT id FROM voucher_types WHERE kind = 'sales'").get() as { id: number }).id
  const L = (input: Parameters<typeof createLedger>[1]): number => createLedger(db, input).id
  const buyer = L({ name: 'Buyer', groupId: groupId('Sundry Debtors'), stateCode: '27', gstin: '27AAPFU0939F1ZV' })
  const salesA = L({ name: 'Sales A', groupId: groupId('Sales Accounts'), hsn: '8471' })
  const salesB = L({ name: 'Sales B', groupId: groupId('Sales Accounts'), hsn: '8471' })
  const sales18 = L({ name: 'Sales 18', groupId: groupId('Sales Accounts'), gstRate: 18, hsn: '8471' })
  const cgst = L({ name: 'Output CGST', groupId: groupId('Duties & Taxes'), taxType: 'cgst' })
  const sgst = L({ name: 'Output SGST', groupId: groupId('Duties & Taxes'), taxType: 'sgst' })
  const sale = (date: string, lines: { ledgerId: number; amount: number }[], tax: number) => {
    const taxable = lines.reduce((s, l) => s + l.amount, 0)
    return saveVoucher(db, {
      voucherTypeId: vt, date, partyLedgerId: buyer,
      lines: ([
        { ledgerId: buyer, drCr: 'dr', amount: taxable + tax },
        ...lines.map((l) => ({ ...l, drCr: 'cr' })),
        { ledgerId: cgst, drCr: 'cr', amount: tax / 2 },
        { ledgerId: sgst, drCr: 'cr', amount: tax / 2 }
      ] as { ledgerId: number; drCr: DrCr; amount: number }[]).map((l) => ({ ...l, costAllocations: [] })),
      inventory: [], billRefs: [], tds: null
    })
  }
  return { db, salesA, salesB, sales18, sale }
}

describe('several rate-less lines blended into one rate (WP 2d)', () => {
  it('warns, names the voucher, and leaves every document as it was', () => {
    const s = setup()
    // ₹600 at 5 % (₹30) + ₹700 at 18 % (₹126) = ₹156 posted on ₹1,300: reported at 12 % (a slab of an
    // earlier period) — no off-slab warning, only the new one.
    const blended = s.sale('2026-07-05', [{ ledgerId: s.salesA, amount: 60000 }, { ledgerId: s.salesB, amount: 70000 }], 15600)
    // One rate-less line beside a rated one: ₹1,000 at 18 % + ₹1,000 at 5 % — no warning.
    s.sale('2026-07-06', [{ ledgerId: s.sales18, amount: 100000 }, { ledgerId: s.salesA, amount: 100000 }], 23000)
    const notes: OutwardExtractionNotes = { blended: [] }
    const withNotes = extractOutwardDocs(s.db, TEST_INFO, FROM, TO, notes)
    expect(notes.blended).toEqual([blended.id])
    expect(withNotes).toEqual(extractOutwardDocs(s.db, TEST_INFO, FROM, TO))
    expect(withNotes[0]!.items).toEqual([{ rate: 12, taxable: 130000, cgst: 7800, sgst: 7800, igst: 0, cess: 0 }])
    const issues = gstValidate(s.db, TEST_INFO, FROM, TO)
    expect(issues.filter((i) => i.code === 'off_slab_rate')).toEqual([])
    expect(issues.find((i) => i.code === 'blended_rate')).toMatchObject({ severity: 'warning', voucherIds: [blended.id] })
    expect(issues.find((i) => i.code === 'blended_rate')!.message).toMatch(/^1 document with several sales lines that have no GST rate/)
  })
})
