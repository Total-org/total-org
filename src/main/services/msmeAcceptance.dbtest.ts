// WP 2d — MSME day of acceptance (MSMED Act 2006 s.2(b) Explanation): a bill can carry the day its
// goods were delivered / services rendered, or the day a written objection was removed; the s.15
// period then runs from it everywhere (plan, MSME report, s.43B(h), Form 1, cash forecast). No
// recorded day = the bill date, exactly as before. Dates hand-worked: s.15 with no written agreement
// = acceptance + 15 days to pay (s.2(b) "appointed day" = the 16th day; General Clauses Act s.9(1)).
import { describe, it, expect } from 'vitest'
import { seededDb, TEST_INFO } from '../db/testdb'
import { createLedger } from './masters'
import { saveVoucher, deleteVoucher, setLockDate } from './vouchers'
import { msmeForm1Csv, msmeReport, payablesPlan, setMsmeAcceptance } from './payables'
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
  const bank = createLedger(db, { name: 'HDFC Current', groupId: groupId(db, 'Bank Accounts'), openingBalance: 100_000_000 }).id
  const pay = (party: number, date: string, amount: number, against: string): number =>
    saveVoucher(db, {
      voucherTypeId: vt(db, 'payment'), date, partyLedgerId: party,
      lines: [{ ledgerId: party, drCr: 'dr', amount }, { ledgerId: bank, drCr: 'cr', amount }],
      billRefs: [{ kind: 'against', name: against, amount, dueDate: null }]
    }).id
  const bill = (party: number, date: string, name: string, amount: number): number =>
    saveVoucher(db, {
      voucherTypeId: vt(db, 'purchase'), date, partyLedgerId: party,
      lines: [{ ledgerId: expense, drCr: 'dr', amount }, { ledgerId: party, drCr: 'cr', amount }],
      billRefs: [{ kind: 'new', name, amount, dueDate: null }]
    }).id
  return { db, micro, plain, bill, pay, creditors }
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
    const acc = setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-01', basis: 'delivered', note: 'GRN 14' }, TODAY)
    expect(acc).toEqual({ voucherId: id, acceptedOn: '2026-07-01', basis: 'delivered', note: 'GRN 14' })
    expect(row()).toMatchObject({ date: '2026-07-10', acceptedOn: '2026-07-01', acceptance: acc, s15: { payBy: '2026-07-16', interestFrom: '2026-07-17' }, daysLate: 25, bucket: 'late_1_30' })
    const plan = payablesPlan(s.db, TODAY).rows.find((r) => r.voucherId === id)!
    expect(plan).toMatchObject({ acceptedOn: '2026-07-01', s15: { payBy: '2026-07-16' }, payBy: '2026-07-16' })
    const flow = forecastBase(s.db, TEST_INFO, TODAY, '2026-10-31').flows.find((f) => f.source === 'payable' && f.voucherId === id)!
    expect(flow.msme).toMatchObject({ payBy: '2026-07-16', daysLate: 25, interestPaise: plan.interestIndicative })

    // A written objection removed on 20 Jul: pay by 4 Aug.
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-20', basis: 'objection_removed', note: '' }, TODAY)
    expect(row()).toMatchObject({ acceptedOn: '2026-07-20', s15: { payBy: '2026-08-04' }, daysLate: 6 })

    // Cleared: back to the bill date exactly.
    expect(setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: null }, TODAY)).toBeNull()
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
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-08-20', basis: 'delivered', note: '' }, '2026-10-05')
    expect(form().rows).toEqual([])
    expect(form().suppliers[0]).toMatchObject({ outstandingOver45: 0, outstandingUpTo45: 1_000_000 })
  })

  it('refuses a day after today, a bill that is not an MSME supplier’s, and a binned bill; the same answer writes nothing', () => {
    const s = setup()
    const id = s.bill(s.micro, '2026-07-10', 'MC-9', 100_000)
    const other = s.bill(s.plain, '2026-07-10', 'PS-1', 100_000)
    expect(() => setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-08-11' }, TODAY)).toThrow(/after today/)
    expect(() => setMsmeAcceptance(s.db, { voucherId: other, acceptedOn: '2026-07-01' }, TODAY)).toThrow(/MSME-registered/)
    expect(() => setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-01', extra: 1 }, TODAY)).toThrow()
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-01' }, TODAY)
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-01' }, TODAY)
    expect(audit(s.db, id)).toHaveLength(1)
    deleteVoucher(s.db, id)
    expect(() => setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-02' }, TODAY)).toThrow(/not in the books/)
  })

  it('s.43B(h): a bill of 20 Mar paid on 8 Apr is late from the bill date, in time from an objection removed on 25 Mar', () => {
    const s = setup()
    // Bill 20 Mar 2026, ₹10,000, no GST, no agreement: pay by 4 Apr (20 Mar + 15). Paid 8 Apr → late,
    // unpaid at the FY end 31 Mar → disallowed for FY 2025-26 (paid after the s.15 date).
    const id = s.bill(s.micro, '2026-03-20', 'MC-3', 1_000_000)
    s.pay(s.micro, '2026-04-08', 1_000_000, 'MC-3')
    const bill = () => msmeReport(s.db, { asOn: '2026-04-30', fyStartYear: 2025, today: '2026-04-30' }).disallowance.bills.find((b) => b.voucherId === id)!
    expect(bill()).toMatchObject({ acceptedOn: '2026-03-20', payBy: '2026-04-04', status: 'disallowed', disallowed: 1_000_000 })
    // Objection removed 25 Mar: pay by 9 Apr → the 8 Apr payment is in time → allowed.
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-03-25', basis: 'objection_removed' }, '2026-04-30')
    expect(bill()).toMatchObject({ acceptedOn: '2026-03-25', payBy: '2026-04-09', status: 'allowed', disallowed: 0 })
  })

  it('Form 1: a payment 50 days after the bill but 40 after delivery is "paid within 45 days"; the CSV prints the day of acceptance', () => {
    const s = setup()
    const paid = s.bill(s.micro, '2026-06-01', 'MC-P', 300_000)
    s.pay(s.micro, '2026-07-21', 300_000, 'MC-P') // 50 days after 1 Jun
    const open = s.bill(s.micro, '2026-08-10', 'MC-O', 1_000_000)
    const q = { asOn: '2026-10-05', formPeriodDate: '2026-09-30', today: '2026-10-05' }
    const supplier = () => msmeReport(s.db, q).form1.suppliers[0]!
    expect(supplier()).toMatchObject({ paidAfter45: { count: 1, amount: 300_000 }, paidWithin45: { count: 0, amount: 0 } })
    setMsmeAcceptance(s.db, { voucherId: paid, acceptedOn: '2026-06-11', basis: 'delivered' }, '2026-10-05') // 40 days to 21 Jul
    expect(supplier()).toMatchObject({ paidAfter45: { count: 0, amount: 0 }, paidWithin45: { count: 1, amount: 300_000 } })
    // The open bill delivered on 1 Aug: 60 days to 30 Sep (over 45); due from 17 Aug (1 Aug + 15 + 1).
    setMsmeAcceptance(s.db, { voucherId: open, acceptedOn: '2026-08-01', basis: 'delivered' }, '2026-10-05')
    expect(msmeReport(s.db, q).form1.rows).toMatchObject([{ voucherId: open, date: '2026-08-10', acceptedOn: '2026-08-01', dueFrom: '2026-08-17', days: 60 }])
    const line = msmeForm1Csv(s.db, q).csv.split('\r\n').find((l) => l.includes('MC-O'))!
    expect(line).toContain(',2026-08-01,')
    expect(line).not.toContain('2026-08-10')
  })

  it('coverage follows the supply day: a removed objection never makes an earlier supply covered; a delivery day does', () => {
    const s = setup()
    const later = createLedger(s.db, { name: 'Late Registrant', groupId: s.creditors, msmeRegistered: true, msmeCategory: 'micro', udyamNo: 'UDYAM-MH-33-0054321', msmeRegisteredFrom: '2026-07-15' }).id
    const id = s.bill(later, '2026-07-10', 'LR-1', 200_000)
    const listed = () => msmeReport(s.db, { asOn: TODAY, today: TODAY }).rows.some((r) => r.voucherId === id)
    expect(listed()).toBe(false) // supplied before the registration
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-20', basis: 'objection_removed' }, TODAY)
    expect(listed()).toBe(false)
    setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-07-16', basis: 'delivered' }, TODAY)
    expect(listed()).toBe(true)
  })

  it('refuses a bill inside the locked period and a day more than a year from the bill date', () => {
    const s = setup()
    const id = s.bill(s.micro, '2026-03-20', 'MC-L', 100_000)
    const open = s.bill(s.micro, '2026-07-10', 'MC-Y', 100_000)
    setLockDate(s.db, '2026-03-31')
    expect(() => setMsmeAcceptance(s.db, { voucherId: id, acceptedOn: '2026-03-01' }, TODAY)).toThrow(/locked up to 2026-03-31/)
    expect(() => setMsmeAcceptance(s.db, { voucherId: open, acceptedOn: '2006-07-20' }, TODAY)).toThrow(/within 365 days/)
    expect(setMsmeAcceptance(s.db, { voucherId: open, acceptedOn: '2025-07-10' }, TODAY)).toMatchObject({ acceptedOn: '2025-07-10' })
  })
})
