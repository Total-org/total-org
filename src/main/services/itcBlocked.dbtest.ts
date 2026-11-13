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
import { bookedItcByVoucher, gstr3b, gstValidate, itcBreakdown } from './gst'
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
  const ret = (ref: string, itcBlocked?: boolean, party = caterer, date = '2026-07-20') =>
    saveVoucher(db, {
      voucherTypeId: vtId('debit_note'), date, partyLedgerId: party, reference: ref,
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

  it('owner, 13 Nov (COR2-1, Q2): re-marking a purchase names the debit notes saved against it that now disagree — and changes none of them', () => {
    const s = setup()
    const bill = s.bill()
    const note = s.ret('AC-1')
    expect(getVoucher(s.db, note.id)).not.toHaveProperty('itcBlocked')
    const noteNo = getVoucher(s.db, note.id)!.number
    // Re-saved unchanged: no warning.
    const same = saveVoucher(s.db, voucherToPayload(getVoucher(s.db, bill.id)!), bill.id)
    expect(same.warnings.taxFactsChanged ?? []).toEqual([])
    // Marked now: the note (unmarked) is named; it keeps its own mark, so its figures read as before.
    const marked = saveVoucher(s.db, { ...voucherToPayload(getVoucher(s.db, bill.id)!), itcBlocked: true }, bill.id)
    const w = (marked.warnings.taxFactsChanged ?? []).filter((m) => m.includes('GST credit blocked'))
    expect(w).toHaveLength(1)
    expect(w[0]).toContain(noteNo)
    expect(w[0]).toContain('still not marked')
    expect(getVoucher(s.db, note.id)).not.toHaveProperty('itcBlocked')
    // The hand-worked consequence the warning describes: blocked +₹25 + ₹25 on the bill, ordinary −₹25 − ₹25 on the note.
    expect(itcBreakdown(s.db, TEST_INFO, FROM, TO)).toMatchObject({ oth: { cgst: -2500, sgst: -2500 }, blocked: { cgst: 2500, sgst: 2500 } })
    // The user marks the note too: now the bill's next change names it again, the other way round.
    saveVoucher(s.db, { ...voucherToPayload(getVoucher(s.db, note.id)!), itcBlocked: true }, note.id)
    const again = saveVoucher(s.db, voucherToPayload(getVoucher(s.db, bill.id)!), bill.id)
    expect((again.warnings.taxFactsChanged ?? []).filter((m) => m.includes('GST credit blocked'))).toEqual([])
    const unmarked = saveVoucher(s.db, { ...voucherToPayload(getVoucher(s.db, bill.id)!), itcBlocked: false }, bill.id)
    const w2 = (unmarked.warnings.taxFactsChanged ?? []).filter((m) => m.includes('GST credit blocked'))
    expect(w2).toHaveLength(1)
    expect(w2[0]).toContain('is no longer marked')
    expect(w2[0]).toContain(noteNo)
    expect(getVoucher(s.db, note.id)).toMatchObject({ itcBlocked: true })
  })

  it('COR2-1: a note found only by the bill’s reference is named; a binned note and another supplier’s bill of the same number are not', () => {
    const s = setup()
    const other = s.L({ name: 'Other caterer', groupId: s.groupId('Sundry Creditors'), stateCode: '27' })
    const bill = s.bill(undefined, '2026-07-10', 'AC-9')
    s.bill(undefined, '2026-07-10', 'AC-9', other)
    const cgst = s.L({ name: 'Input CGST 2', groupId: s.groupId('Duties & Taxes'), taxType: 'cgst' })
    const sgst = s.L({ name: 'Input SGST 2', groupId: s.groupId('Duties & Taxes'), taxType: 'sgst' })
    // A debit note with the bill's reference but no bill refs (amount-only return, as Returns books it): ₹100 + ₹2.50 + ₹2.50.
    const byRef = saveVoucher(s.db, {
      voucherTypeId: s.vtId('debit_note'), date: '2026-07-21', partyLedgerId: s.caterer, reference: 'AC-9',
      lines: ([
        { ledgerId: s.caterer, drCr: 'dr', amount: 10500 },
        { ledgerId: s.food, drCr: 'cr', amount: 10000 },
        { ledgerId: cgst, drCr: 'cr', amount: 250 },
        { ledgerId: sgst, drCr: 'cr', amount: 250 }
      ] as { ledgerId: number; drCr: DrCr; amount: number }[]).map((l) => ({ ...l, costAllocations: [] })),
      inventory: [], billRefs: [], tds: null
    })
    s.ret('AC-9', undefined, other)
    const binned = s.ret('AC-9')
    s.db.prepare("UPDATE vouchers SET deleted_at = '2026-07-22' WHERE id = ?").run(binned.id)
    const res = saveVoucher(s.db, { ...voucherToPayload(getVoucher(s.db, bill.id)!), itcBlocked: true }, bill.id)
    const w = (res.warnings.taxFactsChanged ?? []).filter((m) => m.includes('GST credit blocked'))
    expect(w).toHaveLength(1)
    expect(w[0]?.match(/the debit note (\S+) of 21-Jul-26 saved against it/)?.[1]).toBe(getVoucher(s.db, byRef.id)!.number)
  })

  it('review of #276: last year’s note against an older bill of the same number is not named; nor a note without GST, nor a mixed note', () => {
    const s = setup()
    // FY 2025-26: bill AC-1 and a full return of it (with GST).
    s.bill(undefined, '2025-07-10', 'AC-1')
    s.ret('AC-1', undefined, s.caterer, '2025-07-20')
    // FY 2026-27: a new bill AC-1 from the same supplier, marked now — last year's note is not its return.
    const bill = s.bill(undefined, '2026-07-10', 'AC-1')
    const res = saveVoucher(s.db, { ...voucherToPayload(getVoucher(s.db, bill.id)!), itcBlocked: true }, bill.id)
    expect((res.warnings.taxFactsChanged ?? []).filter((m) => m.includes('GST credit blocked'))).toEqual([])
    expect(gstValidate(s.db, TEST_INFO, '2025-07-01', '2025-07-31').find((i) => i.code === 'itc_blocked_note_mismatch')).toBeUndefined()

    // A note set against two bills — AC-2 (marked) and AC-3 (unmarked) — fits no single mark: left out.
    const two = setup()
    two.bill(true, '2026-07-10', 'AC-2')
    const b3 = two.bill(undefined, '2026-07-11', 'AC-3')
    const mixed = saveVoucher(two.db, {
      voucherTypeId: two.vtId('debit_note'), date: '2026-07-20', partyLedgerId: two.caterer, reference: null,
      lines: ([
        { ledgerId: two.caterer, drCr: 'dr', amount: 210000 },
        { ledgerId: two.food, drCr: 'cr', amount: 200000 },
        { ledgerId: (two.db.prepare("SELECT id FROM ledgers WHERE name = 'Input CGST'").get() as { id: number }).id, drCr: 'cr', amount: 5000 },
        { ledgerId: (two.db.prepare("SELECT id FROM ledgers WHERE name = 'Input SGST'").get() as { id: number }).id, drCr: 'cr', amount: 5000 }
      ] as { ledgerId: number; drCr: DrCr; amount: number }[]).map((l) => ({ ...l, costAllocations: [] })),
      inventory: [], billRefs: [{ kind: 'against', name: 'AC-2', amount: 105000, dueDate: null }, { kind: 'against', name: 'AC-3', amount: 105000, dueDate: null }], tds: null
    })
    expect(getVoucher(two.db, mixed.id)).not.toHaveProperty('itcBlocked')
    const r3 = saveVoucher(two.db, { ...voucherToPayload(getVoucher(two.db, b3.id)!), itcBlocked: true }, b3.id)
    // Now both bills are marked: the note's purchases agree, so it is named.
    expect((r3.warnings.taxFactsChanged ?? []).filter((m) => m.includes('GST credit blocked'))).toHaveLength(1)
    const back = saveVoucher(two.db, { ...voucherToPayload(getVoucher(two.db, b3.id)!), itcBlocked: false }, b3.id)
    // Back to mixed: no single mark fits — not named, and not a validation warning.
    expect((back.warnings.taxFactsChanged ?? []).filter((m) => m.includes('GST credit blocked'))).toEqual([])
    expect(gstValidate(two.db, TEST_INFO, FROM, TO).find((i) => i.code === 'itc_blocked_note_mismatch')).toBeUndefined()
  })

  it('review of #276: a save that also changes the bill’s reference and name still names the note made against the old ones; GSTR-1 checks list it', () => {
    const s = setup()
    const bill = s.bill()
    const note = s.ret('AC-1')
    expect(gstValidate(s.db, TEST_INFO, FROM, TO).find((i) => i.code === 'itc_blocked_note_mismatch')).toBeUndefined()
    const p = voucherToPayload(getVoucher(s.db, bill.id)!)
    const res = saveVoucher(s.db, { ...p, reference: 'AC-1X', billRefs: [{ kind: 'new', name: 'AC-1X', amount: 105000, dueDate: null }], itcBlocked: true }, bill.id)
    const w = (res.warnings.taxFactsChanged ?? []).filter((m) => m.includes('GST credit blocked'))
    expect(w).toHaveLength(1)
    expect(w[0]).toContain(`${getVoucher(s.db, note.id)!.number} of 20-Jul-26`)
    // The persistent check: the note named AC-1 by bill and reference, which the bill no longer
    // carries, so the July checks find no purchase for it (nothing to compare).
    expect(gstValidate(s.db, TEST_INFO, FROM, TO).find((i) => i.code === 'itc_blocked_note_mismatch')).toBeUndefined()
    // Put the names back: the note's purchase is marked, the note is not → listed in the GSTR-1 checks.
    saveVoucher(s.db, { ...voucherToPayload(getVoucher(s.db, bill.id)!), reference: 'AC-1', billRefs: [{ kind: 'new', name: 'AC-1', amount: 105000, dueDate: null }] }, bill.id)
    expect(gstValidate(s.db, TEST_INFO, FROM, TO).find((i) => i.code === 'itc_blocked_note_mismatch')).toMatchObject({ severity: 'warning', voucherIds: [note.id] })
  })
})
