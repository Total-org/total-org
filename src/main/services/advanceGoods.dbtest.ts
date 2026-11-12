import { describe, it, expect } from 'vitest'
import { extractAdvances, goodsAdvanceIssue, gstValidate } from './gst'
import { seededDb, TEST_INFO } from '../db/testdb'
import { createLedger } from './masters'
import { saveVoucher, deleteVoucher } from './vouchers'
import type { DrCr } from '@shared/domain'

// WP 2d — advances for goods (Notification 66/2017-CT): a WARNING on the GSTR-1 checks; Table 11A
// itself is computed exactly as before.
const FROM = '2026-07-01'
const TO = '2026-07-31'

function setup() {
  const db = seededDb()
  const groupId = (name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
  const vtId = (kind: string): number => (db.prepare('SELECT id FROM voucher_types WHERE kind = ?').get(kind) as { id: number }).id
  const L = (input: Parameters<typeof createLedger>[1]): number => createLedger(db, input).id
  const cash = (db.prepare("SELECT id FROM ledgers WHERE name = 'Cash'").get() as { id: number }).id
  const goodsSales = L({ name: 'Sales goods', groupId: groupId('Sales Accounts'), gstRate: 18, hsn: '8471' })
  const serviceSales = L({ name: 'Sales services', groupId: groupId('Sales Accounts'), gstRate: 18, hsn: '998314' })
  const cgst = L({ name: 'CGST', groupId: groupId('Duties & Taxes'), taxType: 'cgst' })
  const sgst = L({ name: 'SGST', groupId: groupId('Duties & Taxes'), taxType: 'sgst' })
  const customer = (name: string): number => L({ name, groupId: groupId('Sundry Debtors'), stateCode: '27', gstRate: 18 })
  const post = (kind: string, date: string, party: number, lines: { ledgerId: number; drCr: DrCr; amount: number }[], ref?: string) =>
    saveVoucher(db, {
      voucherTypeId: vtId(kind), date, partyLedgerId: party,
      lines: lines.map((l) => ({ ...l, costAllocations: [] })),
      inventory: [], billRefs: ref ? [{ kind: 'new', name: ref, amount: lines[0]!.amount, dueDate: null }] : [], tds: null
    })
  // ₹1,000 + 18 % on a sales ledger — an earlier bill that tells goods from services.
  const sale = (party: number, ledgerId: number, date = '2026-06-10') =>
    post('sales', date, party, [
      { ledgerId: party, drCr: 'dr', amount: 118000 },
      { ledgerId, drCr: 'cr', amount: 100000 },
      { ledgerId: cgst, drCr: 'cr', amount: 9000 },
      { ledgerId: sgst, drCr: 'cr', amount: 9000 }
    ])
  const advance = (party: number, ref: string, date = '2026-07-20') =>
    post('receipt', date, party, [
      { ledgerId: cash, drCr: 'dr', amount: 118000 },
      { ledgerId: party, drCr: 'cr', amount: 118000 }
    ], ref)
  return { db, goodsSales, serviceSales, customer, sale, advance }
}

describe('advances for goods (WP 2d, N. 66/2017-CT)', () => {
  it('warns about a customer who buys goods, and Table 11A is unchanged', () => {
    const s = setup()
    const goodsBuyer = s.customer('Goods Buyer')
    const serviceBuyer = s.customer('Service Buyer')
    s.sale(goodsBuyer, s.goodsSales)
    s.sale(serviceBuyer, s.serviceSales)
    const a1 = s.advance(goodsBuyer, 'ADV-G')
    s.advance(serviceBuyer, 'ADV-S')

    const issue = goodsAdvanceIssue(s.db, TEST_INFO, FROM, TO)
    expect(issue).toMatchObject({ code: 'advance_goods', severity: 'warning', voucherIds: [a1.id] })
    expect(issue!.message).toMatch(/^1 advance in Table 11A is from customers you sell goods to \(Goods Buyer\)/)
    expect(gstValidate(s.db, TEST_INFO, FROM, TO).filter((i) => i.code === 'advance_goods')).toEqual([issue])

    // Both advances stay in 11A exactly as before: 2 × ₹1,18,000 → taxable 2 × ₹1,00,000, tax 2 × ₹18,000 (rule 35).
    expect(extractAdvances(s.db, TEST_INFO, FROM, TO)).toEqual([
      { pos: '27', supply: 'intra', rate: 18, taxable: 200000, cgst: 18000, sgst: 18000, igst: 0, cess: 0 }
    ])
  })

  it('a customer with no sale yet follows the business: goods only → warned; goods and services → silent', () => {
    const s = setup()
    const other = s.customer('Other Buyer')
    const fresh = s.customer('New Buyer')
    s.sale(other, s.goodsSales)
    const a = s.advance(fresh, 'ADV-N')
    expect(goodsAdvanceIssue(s.db, TEST_INFO, FROM, TO)?.voucherIds).toEqual([a.id])

    s.sale(other, s.serviceSales)
    expect(goodsAdvanceIssue(s.db, TEST_INFO, FROM, TO)).toBeNull()
  })

  it('a sale after the period end, a binned advance and a non-regular business say nothing', () => {
    const s = setup()
    const buyer = s.customer('Later Buyer')
    s.sale(buyer, s.goodsSales, '2026-08-05')
    const a = s.advance(buyer, 'ADV-L')
    // The only coded sale is after the period: no goods evidence as on the period end.
    expect(goodsAdvanceIssue(s.db, TEST_INFO, FROM, TO)).toBeNull()

    s.sale(buyer, s.goodsSales, '2026-07-05')
    expect(goodsAdvanceIssue(s.db, TEST_INFO, FROM, TO)?.voucherIds).toEqual([a.id])
    expect(goodsAdvanceIssue(s.db, { ...TEST_INFO, gstRegistrationType: 'composition' }, FROM, TO)).toBeNull()

    deleteVoucher(s.db, a.id)
    expect(goodsAdvanceIssue(s.db, TEST_INFO, FROM, TO)).toBeNull()
  })
})
