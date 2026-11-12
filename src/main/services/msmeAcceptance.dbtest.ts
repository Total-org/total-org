// WP 2d — MSME day of acceptance (MSMED Act 2006 s.2(b) Explanation): a bill can carry the day its
// goods were delivered / services rendered, or the day a written objection was removed; the s.15
// period then runs from it everywhere (plan, MSME report, s.43B(h), Form 1, cash forecast). No
// recorded day = the bill date, exactly as before. Dates hand-worked: s.15 with no written agreement
// = acceptance + 15 days to pay (s.2(b) "appointed day" = the 16th day; General Clauses Act s.9(1)).
import { describe, it, expect } from 'vitest'
import { seededDb, TEST_INFO } from '../db/testdb'
import { createLedger } from './masters'
import { saveVoucher, deleteVoucher } from './vouchers'
import { msmeReport, payablesPlan, setMsmeAcceptance } from './payables'
import { forecastBase } from './cashForecast'

type DB = ReturnType<typeof seededDb>
const groupId = (db: DB, name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
const vt = (db: DB, kind: string): number => (db.prepare('SELECT id FROM voucher_types WHERE kind = ? ORDER BY id LIMIT 1').get(kind) as { id: number }).id
const TODAY = '2026-08-10'

function setup() {
  const db = seededDb()
  const creditors = groupId(db, 'Sundry Creditors')
  const micro = createLedger(db, { name: 'Micro Castings', groupId: creditors, creditDays: 60, msmeRegistered: true, msmeCategory: 'micro', udyamNo: 'UDYAM-MH-33-0012345', agreedCreditDays: null }).id
  const plain = createLedger(db, { name: 'Plain Supplies', groupId: creditors, creditDays: 10 }).id
  const expense = createLedger(db, { name: 'Raw Material Purchases', groupId: groupId(db, 'Purchase Accounts') }).id
  const bill = (party: number, date: string, name: string, amount: number): number =>
    saveVoucher(db, {
      voucherTypeId: vt(db, 'purchase'), date, partyLedgerId: party,
      lines: [{ ledgerId: expense, drCr: 'dr', amount }, { ledgerId: party, drCr: 'cr', amount }],
      billRefs: [{ kind: 'new', name, amount, dueDate: null }]
    }).id
  return { db, micro, plain, bill }
}
const audit = (db: DB, id: number) =>
  db.prepare("SELECT action, before_json AS b, after_json AS a FROM audit_log WHERE entity = 'msme_acceptance' AND entity_id = ? ORDER BY id").all(id) as { action: string; b: string | null; a: string | null }[]

describe('MSME day of acceptance (WP 2d)', () => {
  it('no recorded day = the bill date (as before); a delivery day moves the s.15 date in the plan, the report and the forecast', () => {
    const s = setup()
    // Bill of 10 Jul 2026, ₹50,000, no written agreement.
    const id = s.bill(s.micro, '2026-07-10', 'MC-7', 5_000_000)
    const row = () => msmeReport(s.db, { asOn: TODAY, today: TODAY }).rows.find((r) => r.voucherId === id)!
    // Accepted on the bill date: pay by 10 Jul + 15 = 25 Jul; late from 26 Jul; 10 Aug is 16 days late.
    expect(row()).toMatchObject({ acceptedOn: '2026-07-10', acceptance: null, s15: { payBy: '2026-07-25', interestFrom: '2026-07-26' }, daysLate: 16 })

    // The goods came in on 1 Jul (a GRN before the bill): pay by 16 Jul, late from 17 Jul, 25 days late on 10 Aug.
    const acc = setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-01', basis: 'delivered', note: 'GRN 14', today: TODAY })
    expect(acc).toEqual({ voucherId: id, acceptedOn: '2026-07-01', basis: 'delivered', note: 'GRN 14' })
    expect(row()).toMatchObject({ date: '2026-07-10', acceptedOn: '2026-07-01', acceptance: acc, s15: { payBy: '2026-07-16', interestFrom: '2026-07-17' }, daysLate: 25, bucket: 'late_1_30' })
    const plan = payablesPlan(s.db, TODAY).rows.find((r) => r.voucherId === id)!
    expect(plan).toMatchObject({ acceptedOn: '2026-07-01', s15: { payBy: '2026-07-16' }, payBy: '2026-07-16' })
    const flow = forecastBase(s.db, TEST_INFO, TODAY, '2026-10-31').flows.find((f) => f.source === 'payable' && f.voucherId === id)!
    expect(flow.msme).toMatchObject({ payBy: '2026-07-16', daysLate: 25, interestPaise: plan.interestIndicative })

    // A written objection removed on 20 Jul: pay by 4 Aug.
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-20', basis: 'objection_removed', note: '', today: TODAY })
    expect(row()).toMatchObject({ acceptedOn: '2026-07-20', s15: { payBy: '2026-08-04' }, daysLate: 6 })

    // Cleared: back to the bill date exactly.
    expect(setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: null, today: TODAY })).toBeNull()
    expect(row()).toMatchObject({ acceptedOn: '2026-07-10', acceptance: null, s15: { payBy: '2026-07-25' }, daysLate: 16 })
    expect(audit(s.db, id).map((a) => a.action)).toEqual(['create', 'update', 'delete'])
  })

  it('MSME Form 1 counts the 45 days from the day of acceptance', () => {
    const s = setup()
    // Bill of 10 Aug 2026; the half-year ends 30 Sep: 51 days from the bill → over 45.
    const id = s.bill(s.micro, '2026-08-10', 'MC-8', 1_000_000)
    const form = () => msmeReport(s.db, { asOn: '2026-10-05', formPeriodDate: '2026-09-30', today: '2026-10-05' }).form1
    expect(form().rows.map((r) => r.voucherId)).toEqual([id])
    expect(form().suppliers[0]).toMatchObject({ outstandingOver45: 1_000_000, outstandingUpTo45: 0 })
    // Services rendered on 20 Aug: 41 days to 30 Sep → not over 45.
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-08-20', basis: 'delivered', note: '', today: '2026-10-05' })
    expect(form().rows).toEqual([])
    expect(form().suppliers[0]).toMatchObject({ outstandingOver45: 0, outstandingUpTo45: 1_000_000 })
  })

  it('refuses a day after today, a bill that is not an MSME supplier’s, and a binned bill; the same answer writes nothing', () => {
    const s = setup()
    const id = s.bill(s.micro, '2026-07-10', 'MC-9', 100_000)
    const other = s.bill(s.plain, '2026-07-10', 'PS-1', 100_000)
    expect(() => setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-08-11', today: TODAY })).toThrow(/after today/)
    expect(() => setMsmeAcceptance(s.db, { voucherId: other, acceptedOn: '2026-07-01', today: TODAY })).toThrow(/MSME-registered/)
    expect(() => setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-01', today: TODAY, extra: 1 })).toThrow()
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-01', today: TODAY })
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-01', today: TODAY })
    expect(audit(s.db, id)).toHaveLength(1)
    deleteVoucher(s.db, id)
    expect(() => setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-02', today: TODAY })).toThrow(/not in the books/)
  })
})
