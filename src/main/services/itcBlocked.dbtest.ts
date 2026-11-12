// WP 2d — blocked input tax per bill (CGST Act s.17(5)): a purchase / debit note marked
// `itc_blocked` keeps its input-tax lines (so GSTR-2B still matches) and its credit goes to the
// blocked bucket exactly as a blocked supplier's does — GSTR-3B 4(A)(5) + 4(B)(1) (Circular 170),
// out of the rule 37 list, out of the s.43B(h) deductible expense. Unmarked vouchers read as before.
import { describe, expect, it } from 'vitest'
import { seededDb, TEST_INFO } from '../db/testdb'
import { createLedger } from './masters'
import { getVoucher, saveVoucher } from './vouchers'
import { itcReversal } from './gstItcReversal'
import { itcDocsFor } from './gstAnnual'
import { msmeReport } from './payables'
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
  const bill = (itcBlocked?: boolean, date = '2026-07-10', ref = 'AC-1', party = caterer) =>
    saveVoucher(db, {
      voucherTypeId: vtId('purchase'), date, partyLedgerId: party, reference: ref,
      ...(itcBlocked !== undefined ? { itcBlocked } : {}),
      lines: ([
        { ledgerId: food, drCr: 'dr', amount: 100000 },
        { ledgerId: cgst, drCr: 'dr', amount: 2500 },
        { ledgerId: sgst, drCr: 'dr', amount: 2500 },
        { ledgerId: party, drCr: 'cr', amount: 105000 }
      ] as { ledgerId: number; drCr: DrCr; amount: number }[]).map((l) => ({ ...l, costAllocations: [] })),
      inventory: [], billRefs: [{ kind: 'new', name: ref, amount: 105000, dueDate: null }], tds: null
    })
  // A full return of `ref` (₹1,000 + ₹25 + ₹25) as a debit note against the bill.
  const ret = (ref: string, itcBlocked?: boolean, party = caterer) =>
    saveVoucher(db, {
      voucherTypeId: vtId('debit_note'), date: '2026-07-20', partyLedgerId: party, reference: ref,
      ...(itcBlocked !== undefined ? { itcBlocked } : {}),
      lines: ([
        { ledgerId: party, drCr: 'dr', amount: 105000 },
        { ledgerId: food, drCr: 'cr', amount: 100000 },
        { ledgerId: cgst, drCr: 'cr', amount: 2500 },
        { ledgerId: sgst, drCr: 'cr', amount: 2500 }
      ] as { ledgerId: number; drCr: DrCr; amount: number }[]).map((l) => ({ ...l, costAllocations: [] })),
      inventory: [], billRefs: [{ kind: 'against', name: ref, amount: 105000, dueDate: null }], tds: null
    })
  return { db, vtId, groupId, L, caterer, food, sales, buyer, bill, ret }
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

  it('review of #263: a return of a marked bill takes the mark — the net blocked credit is nil and ordinary credit is untouched', () => {
    const s = setup()
    s.bill(true)
    const note = s.ret('AC-1')
    expect(getVoucher(s.db, note.id)).toMatchObject({ itcBlocked: true })
    // ₹25 + ₹25 blocked on the bill, −₹25 − ₹25 on its return: nothing left, and nothing taken off ordinary credit.
    expect(itcBreakdown(s.db, TEST_INFO, FROM, TO)).toMatchObject({ oth: { cgst: 0, sgst: 0 }, blocked: { cgst: 0, sgst: 0 } })
    // A return of an unmarked bill stays ordinary; an explicit "not blocked" is kept.
    s.bill(undefined, '2026-07-11', 'AC-2')
    expect(getVoucher(s.db, s.ret('AC-2').id)).not.toHaveProperty('itcBlocked')
    expect(getVoucher(s.db, s.ret('AC-1', false).id)).not.toHaveProperty('itcBlocked')
  })

  it('review of #263: refused on a reverse-charge supplier’s bill and on other kinds; a kind change drops it', () => {
    const s = setup()
    const rcm = s.L({ name: 'Cab Hire (RCM)', groupId: s.groupId('Sundry Creditors'), stateCode: '27', rcm: true })
    expect(() => s.bill(true, '2026-07-12', 'CAB-1', rcm)).toThrow(expect.objectContaining({ code: 'itc_blocked_rcm' }))
    const id = s.bill(true).id
    const journal = { ...voucherToPayload(getVoucher(s.db, id)!), voucherTypeId: s.vtId('journal'), partyLedgerId: null, billRefs: [] }
    expect(() => saveVoucher(s.db, journal, id)).toThrow(expect.objectContaining({ code: 'itc_blocked_kind' }))
    const { itcBlocked: _x, ...unstated } = journal
    saveVoucher(s.db, unstated, id)
    expect((s.db.prepare('SELECT itc_blocked AS b FROM vouchers WHERE id = ?').get(id) as { b: number }).b).toBe(0)
  })

  it('review of #263: out of the rule 37 list, GSTR-9 Table 6 says blocked, s.43B(h) keeps its GST as expense', () => {
    const s = setup()
    // Bills of 10 Jan 2026, unpaid: day 180 = 9 Jul 2026, so rule 37 reverses in August 2026.
    const plain = s.bill(undefined, '2026-01-10', 'J-1').id
    const marked = s.bill(true, '2026-01-10', 'J-2').id
    const r37 = itcReversal(s.db, TEST_INFO, '2026-08-01', '2026-08-31', '082026').rule37.map((e) => e.bill.voucherId)
    expect(r37).toContain(plain)
    expect(r37).not.toContain(marked)
    const docs = itcDocsFor(s.db, TEST_INFO, '2025-04-01', '2026-03-31')
    expect(docs.find((d) => d.voucherId === marked)).toMatchObject({ source: 'blocked', cgst: 2500, sgst: 2500 })
    expect(docs.find((d) => d.voucherId === plain)).toMatchObject({ source: 'domestic' })
    // s.43B(h): a micro supplier's bills unpaid at 31 Mar 2026 — the claimable bill's ₹50 GST is out
    // of the figure, the marked bill's stays in (it is an expense).
    s.db.prepare("UPDATE ledgers SET msme_registered = 1, msme_category = 'micro', udyam_no = 'UDYAM-MH-33-0012345' WHERE id = ?").run(s.caterer)
    const bills = msmeReport(s.db, { asOn: '2026-04-30', fyStartYear: 2025, today: '2026-04-30' }).disallowance.bills
    expect(bills.find((b) => b.voucherId === plain)).toMatchObject({ pendingAtFyEnd: 105000, gstExcluded: 5000 })
    expect(bills.find((b) => b.voucherId === marked)).toMatchObject({ pendingAtFyEnd: 105000, gstExcluded: 0 })
  })
})
