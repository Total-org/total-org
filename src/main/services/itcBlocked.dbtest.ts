// WP 2d — blocked input tax per bill (CGST Act s.17(5)): a purchase / debit note marked
// `itc_blocked` keeps its input-tax lines (so GSTR-2B still matches) and its credit goes to the
// blocked bucket exactly as a blocked supplier's does — GSTR-3B 4(A)(5) + 4(B)(1) (Circular 170),
// out of the rule 37 list, out of the s.43B(h) deductible expense. Unmarked vouchers read as before.
import { describe, expect, it } from 'vitest'
import { seededDb, TEST_INFO } from '../db/testdb'
import { createLedger } from './masters'
import { getVoucher, saveVoucher } from './vouchers'
import { bookedItcByVoucher, gstr3b, itcBreakdown } from './gst'
import { accountingStateFromVoucher, buildAccountingPayload, diffPayloads, voucherToPayload } from '@shared/voucherEdit'
import type { DrCr } from '@shared/domain'

const FROM = '2026-07-01'
const TO = '2026-07-31'

function setup() {
  const db = seededDb()
  const groupId = (name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
  const vtId = (kind: string): number => (db.prepare('SELECT id FROM voucher_types WHERE kind = ?').get(kind) as { id: number }).id
  const L = (input: Parameters<typeof createLedger>[1]): number => createLedger(db, input).id
  const caterer = L({ name: 'Annapurna Caterers', groupId: groupId('Sundry Creditors'), stateCode: '27' })
  const food = L({ name: 'Staff food', groupId: groupId('Indirect Expenses') })
  const cgst = L({ name: 'Input CGST', groupId: groupId('Duties & Taxes'), taxType: 'cgst' })
  const sgst = L({ name: 'Input SGST', groupId: groupId('Duties & Taxes'), taxType: 'sgst' })
  const sales = L({ name: 'Sales', groupId: groupId('Sales Accounts') })
  const buyer = L({ name: 'Buyer', groupId: groupId('Sundry Debtors'), stateCode: '27' })
  // ₹1,000 + CGST ₹25 + SGST ₹25 (5 % outdoor catering) = ₹1,050.
  const bill = (itcBlocked?: boolean) =>
    saveVoucher(db, {
      voucherTypeId: vtId('purchase'), date: '2026-07-10', partyLedgerId: caterer, reference: 'AC-1',
      ...(itcBlocked !== undefined ? { itcBlocked } : {}),
      lines: ([
        { ledgerId: food, drCr: 'dr', amount: 100000 },
        { ledgerId: cgst, drCr: 'dr', amount: 2500 },
        { ledgerId: sgst, drCr: 'dr', amount: 2500 },
        { ledgerId: caterer, drCr: 'cr', amount: 105000 }
      ] as { ledgerId: number; drCr: DrCr; amount: number }[]).map((l) => ({ ...l, costAllocations: [] })),
      inventory: [], billRefs: [], tds: null
    })
  return { db, vtId, caterer, food, sales, buyer, bill }
}

describe('blocked input tax per bill (WP 2d, s.17(5))', () => {
  it('a marked bill’s credit is blocked: 4(A)(5) + 4(B)(1), nothing in 4(A)(5) other; an unmarked one is ordinary credit', () => {
    const s = setup()
    const plain = s.bill()
    expect(getVoucher(s.db, plain.id)).not.toHaveProperty('itcBlocked')
    expect(itcBreakdown(s.db, TEST_INFO, FROM, TO)).toMatchObject({ oth: { cgst: 2500, sgst: 2500 }, blocked: { cgst: 0, sgst: 0 } })

    const marked = s.bill(true)
    expect(getVoucher(s.db, marked.id)).toMatchObject({ itcBlocked: true })
    expect(bookedItcByVoucher(s.db, FROM, TO).find((r) => r.voucherId === marked.id)).toMatchObject({ bucket: 'blocked', cgst: 2500, sgst: 2500 })
    expect(itcBreakdown(s.db, TEST_INFO, FROM, TO)).toMatchObject({ oth: { cgst: 2500, sgst: 2500 }, blocked: { cgst: 2500, sgst: 2500 } })
    // GSTR-3B (Circular 170): the blocked ₹25 + ₹25 is availed and reversed — net ITC is only the plain bill's.
    expect(gstr3b(s.db, TEST_INFO, FROM, TO, '072026').circular170.blocked).toMatchObject({ cgst: 2500, sgst: 2500 })
  })

  it('round-trips: an edit that does not state it keeps it; the accounting editor carries it; false clears it', () => {
    const s = setup()
    const id = s.bill(true).id
    const v = getVoucher(s.db, id)!
    // Re-save as stored, without the field: kept.
    const { itcBlocked: _drop, ...noField } = voucherToPayload(v)
    saveVoucher(s.db, noField, id)
    expect(getVoucher(s.db, id)).toMatchObject({ itcBlocked: true })
    // The accounting editor loads it and posts it back unchanged.
    const state = accountingStateFromVoucher(getVoucher(s.db, id)!)
    expect(state.itcBlocked).toBe(true)
    const built = buildAccountingPayload(state, { kind: 'purchase', voucherTypeId: v.voucherTypeId, derivedPartyId: s.caterer })
    if (!built.ok) throw new Error(built.error)
    expect(built.payload.itcBlocked).toBe(true)
    expect(diffPayloads(built.payload, voucherToPayload(getVoucher(s.db, id)!))).toEqual([])
    saveVoucher(s.db, { ...built.payload, itcBlocked: false }, id)
    expect(getVoucher(s.db, id)).not.toHaveProperty('itcBlocked')
    expect((s.db.prepare('SELECT itc_blocked AS b FROM vouchers WHERE id = ?').get(id) as { b: number }).b).toBe(0)
  })

  it('only a purchase or a debit note can be marked', () => {
    const s = setup()
    expect(() =>
      saveVoucher(s.db, {
        voucherTypeId: s.vtId('sales'), date: '2026-07-12', partyLedgerId: s.buyer, itcBlocked: true,
        lines: [
          { ledgerId: s.buyer, drCr: 'dr', amount: 1000, costAllocations: [] },
          { ledgerId: s.sales, drCr: 'cr', amount: 1000, costAllocations: [] }
        ],
        inventory: [], billRefs: [], tds: null
      })
    ).toThrow(/Only a purchase or a debit note/)
  })
})
