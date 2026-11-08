// WP 3.7 — payroll salary TDS against a real (in-memory) SQLite: migration 029, a run's postings
// (salary TDS, balanced), salary TDS on the TDS screen and in Form 24Q (not 26Q), dues and
// payments, Form 16 data. Audit A13b removed PF / ESI / PT: a new run deducts none of them
// whatever the employee's stored flags say, and an old book's PF / ESI / PT run still reads as
// it was saved (its lines, its payable balances, its dues for the cash forecast).
import { describe, expect, it } from 'vitest'
import { freshPartialDb, seededDb, TEST_INFO } from '../db/testdb'
import { migrate } from '../db/migrate'
import { MIGRATIONS } from '../db/migrations'
import type { DB } from '../db/connection'
import type { EmployeeInputPayload } from '@shared/schemas'
import { commitRun, deleteRun, getRun, listRuns, previewRun, saveEmployee, actualWorkings } from './payroll'
import {
  deleteStatutoryPayment, ensureStatutoryLedger, form16Data, form24qCsv, form24qData, getDeclarations, listStatutoryPayments, recordStatutoryPayment,
  setDeclarations, statutoryDues
} from './payrollStatutory'
import { findOrCreateLedger } from './masters'
import { trialBalance } from './reports'
import { form26qData, tdsDeducted, tdsLedgerSummary } from './tdsWorkbench'
import { getVoucher, saveVoucher } from './vouchers'
import { voucherToPayload } from '@shared/voucherEdit'

const R = (rupees: number): number => Math.round(rupees * 100)

const emp = (over: Partial<EmployeeInputPayload> = {}): EmployeeInputPayload => ({
  name: 'Anil Mehta', code: 'E1', designation: 'Manager', joined: null, pan: 'ABCPM1234K', uan: '100100100100', esicNo: null,
  basic: R(75_000), hra: R(30_000), special: R(45_000),
  pfEnabled: true, esiEnabled: true, ptEnabled: true, ptState: 'MH', active: true,
  ...over
})
const lowPaid = (over: Partial<EmployeeInputPayload> = {}): EmployeeInputPayload => emp({
  name: 'Bina Rao', code: 'E2', designation: 'Clerk', pan: 'ABCPR5678L', uan: '100100100200', esicNo: '3100123456',
  basic: R(12_000), hra: R(4_000), special: R(2_000), ...over
})

const linesOf = (db: DB, voucherId: number): Map<string, { drCr: string; amount: number }> =>
  new Map((db.prepare(
    `SELECT l.name, vl.dr_cr AS drCr, vl.amount FROM voucher_lines vl JOIN ledgers l ON l.id = vl.ledger_id WHERE vl.voucher_id = ?`
  ).all(voucherId) as { name: string; drCr: string; amount: number }[]).map(({ name, ...l }) => [name, l]))

const balanceByTag = (db: DB, kind: string): number =>
  (db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN vl.dr_cr = 'cr' THEN vl.amount ELSE -vl.amount END), 0) AS b
       FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id JOIN ledgers l ON l.id = vl.ledger_id
      WHERE l.statutory_kind = ? AND v.deleted_at IS NULL`
  ).get(kind) as { b: number }).b

function bank(db: DB): number {
  const g = db.prepare("SELECT id FROM groups WHERE name = 'Bank Accounts'").get() as { id: number }
  return Number(db.prepare("INSERT INTO ledgers (name, group_id, is_system) VALUES ('HDFC Current', ?, 0)").run(g.id).lastInsertRowid)
}

describe('migration 029', () => {
  it('is the 29th migration — appended after 027 (TCS) and 028 (GST expansion)', () => {
    const at = MIGRATIONS.findIndex((sql) => sql.includes('CREATE TABLE statutory_rates'))
    expect(at + 1).toBe(29)
    expect(at).toBeGreaterThan(MIGRATIONS.findIndex((sql) => sql.includes('CREATE TABLE gst_ims_actions')))
    expect(at).toBe(28)
  })

  it('seeds section 192; the statutory rates stay in the table, unread since audit A13b', () => {
    const db = seededDb()
    const rates = db.prepare('SELECT source FROM statutory_rates').all() as { source: string }[]
    expect(rates.length).toBeGreaterThan(0)
    expect(rates.every((r) => r.source.includes('accessed 2026-10-07'))).toBe(true)
    const s192 = db.prepare("SELECT code, legacy_code AS l, new_reference AS n FROM tds_sections WHERE code = '192'").get()
    expect(s192).toEqual({ code: '192', l: '192', n: '392' })
  })

  it('backfills payroll lines and tags the payable ledgers the app always created', () => {
    const before029 = MIGRATIONS.findIndex((sql) => sql.includes('CREATE TABLE statutory_rates'))
    const db = freshPartialDb(before029)
    const g = (name: string) => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number } | undefined)?.id
    // Seed just enough for the legacy rows: groups come from seedCompany normally — stage by SQL.
    db.exec(`INSERT INTO groups (name, nature, affects_gross_profit) VALUES ('Provisions', 'liability', 0)`)
    db.prepare("INSERT INTO ledgers (name, group_id) VALUES ('PF Payable', ?)").run(g('Provisions'))
    db.prepare("INSERT INTO employees (name, basic, pt_state) VALUES ('Old Hand', 2000000, 'KA')").run()
    db.exec(`INSERT INTO payroll_runs (month) VALUES ('2025-06')`)
    db.exec(`INSERT INTO payroll_lines (run_id, employee_id, payable_days, month_days, basic, hra, special, gross, pf_emp, pf_er, esi_emp, esi_er, pt, net, eps_er, edli)
             VALUES (1, 1, 30, 30, 2000000, 0, 0, 2000000, 180000, 180000, 0, 0, 20000, 1800000, 124950, 7500)`)
    migrate(db)
    expect(db.prepare("SELECT statutory_kind AS k FROM ledgers WHERE name = 'PF Payable'").get()).toEqual({ k: 'pf' })
    expect(db.prepare('SELECT epf_wage, eps_wage, edli_wage, esi_covered, pt_state FROM payroll_lines').get())
      .toEqual({ epf_wage: 1500000, eps_wage: 1500000, edli_wage: 1500000, esi_covered: 0, pt_state: 'KA' })
  })
})

describe('a pay run since audit A13b: salary TDS only, whatever the PF / ESI / PT flags say', () => {
  function setup() {
    const db = seededDb()
    // Both employees still carry pfEnabled / esiEnabled / ptEnabled = true (an old profile).
    const a = saveEmployee(db, emp())
    const b = saveEmployee(db, lowPaid())
    expect([a, b].every((e) => e.pfEnabled && e.esiEnabled && e.ptEnabled)).toBe(true)
    const run = commitRun(db, '2026-07', [])
    return { db, a, b, run }
  }

  it('posts no PF / ESI / PT line: gross, TDS and net worked by hand', () => {
    const { db, run } = setup()
    const l = linesOf(db, run.voucherId!)
    // Anil (new regime): gross 75,000 + 30,000 + 45,000 = 1,50,000 a month. TDS projected over the
    //   9 months July–March: 9 × 1,50,000 = 13,50,000 − standard deduction 75,000 = 12,75,000;
    //   tax 4–8 lakh 5% = 20,000 + 8–12 lakh 10% = 40,000 + 12–12.75 lakh 15% = 11,250 = 71,250
    //   (above the excess over 12 lakh? 71,250 < 75,000, so no marginal relief) + cess 4% 2,850
    //   = 74,100 ÷ 9 = 8,233.33 → ₹8,233. Net 1,50,000 − 8,233 = 1,41,767.
    // Bina: gross 12,000 + 4,000 + 2,000 = 18,000; 1.62 lakh a year → no TDS; net 18,000.
    // Journal: Salaries Dr 1,68,000 = TDS Payable 192 Cr 8,233 + Salaries Payable Cr 1,59,767.
    expect([...l.keys()].sort()).toEqual(['Salaries', 'Salaries Payable', 'TDS Payable 192'])
    expect(l.get('Salaries')).toEqual({ drCr: 'dr', amount: R(1_68_000) })
    expect(l.get('TDS Payable 192')).toEqual({ drCr: 'cr', amount: R(8_233) })
    expect(l.get('Salaries Payable')).toEqual({ drCr: 'cr', amount: R(1_59_767) })
    expect(run.pfAdminTopUp).toBe(0)
    expect(balanceByTag(db, 'salary')).toBe(R(1_59_767))
    for (const k of ['pf', 'esi', 'pt']) expect(balanceByTag(db, k)).toBe(0)
    const anil = run.lines.find((x) => x.employeeName === 'Anil Mehta')!
    expect(anil).toMatchObject({ gross: R(1_50_000), tds: R(8_233), net: R(1_41_767), pfEmp: 0, pfEr: 0, vpf: 0, pfAdmin: 0, edli: 0, esiEmp: 0, esiEr: 0, pt: 0, epfWage: 0, esiCovered: false })
    expect(anil.tdsWorkings).toMatchObject({ regime: 'new', act: '2025', annualTax: R(74_100), monthsRemaining: 9, professionalTax: 0 })
    const bina = run.lines.find((x) => x.employeeName === 'Bina Rao')!
    expect(bina).toMatchObject({ gross: R(18_000), tds: 0, net: R(18_000), pfEmp: 0, esiEmp: 0, esiEr: 0, esiCovered: false, pt: 0 })
    // The preview the screen shows is the same.
    expect(previewRun(db, '2026-08', []).map((x) => [x.employeeName, x.pfEmp + x.esiEmp + x.pt])).toEqual([['Anil Mehta', 0], ['Bina Rao', 0]])
  })

  it('records salary TDS in tds_entries under section 192: Deducted tab and 24Q, never 26Q', () => {
    const { db, a } = setup()
    const deducted = tdsDeducted(db, '2026-07-01', '2026-07-31')
    expect(deducted).toHaveLength(1)
    expect(deducted[0]).toMatchObject({ partyName: 'Anil Mehta', sectionCode: '192', pan: 'ABCPM1234K', tdsPaise: R(8_233), basePaise: R(1_50_000) })
    expect(form26qData(db, 2026, 2).deductees).toHaveLength(0)
    const q = form24qData(db, 2026, 2, (id) => actualWorkings(db, id, 2026))
    expect(q.layout).toBe('form138')
    expect(q.deductees[0]).toMatchObject({ employeeId: a.id, sectionCode: '1002', amountPaise: R(1_50_000), tdsPaise: R(8_233), challanSerial: null })
    expect(q.salaries).toHaveLength(0) // annexure II only in Q4
    const summary = tdsLedgerSummary(db, 2026, 2).find((r) => r.sectionCode === '192')!
    expect(summary).toMatchObject({ deductedPaise: R(8_233), entriesTdsPaise: R(8_233), deductees: 1 })
  })

  it('lists the TDS due only, and a challan payment clears it', () => {
    const { db } = setup()
    const dues = statutoryDues(db, 2026, '2026-08-10')
    expect(dues.map((d) => d.key)).toEqual(['tds:2026-07'])
    expect(dues[0]).toMatchObject({ payablePaise: R(8_233), dueDate: '2026-08-07', status: 'overdue' })
    const hdfc = bank(db)
    const tds = recordStatutoryPayment(db, { kind: 'tds', period: '2026-07', state: null, amountPaise: R(8_233), paidOn: '2026-08-06', bankLedgerId: hdfc, reference: null, bsrCode: '0510308', challanNo: '00042' })
    expect(tds.tdsChallanId).not.toBeNull()
    expect(statutoryDues(db, 2026, '2026-08-20')[0]!.status).toBe('paid')
    expect(listStatutoryPayments(db, 2026)).toHaveLength(1)
    // The TDS challan was auto-allocated: 24Q shows it.
    expect(form24qData(db, 2026, 2, () => null).deductees[0]).toMatchObject({ challanSerial: 1, bsrCode: '0510308', challanNo: '00042' })
    deleteStatutoryPayment(db, tds.id)
    expect(statutoryDues(db, 2026, '2026-08-20')[0]!.status).toBe('overdue')
  })

  it('refuses a payment from a non-bank ledger, mismatched challan details and any kind but TDS', () => {
    const { db } = setup()
    const salaries = (db.prepare("SELECT id FROM ledgers WHERE name = 'Salaries'").get() as { id: number }).id
    const pay = { kind: 'tds' as const, period: '2026-07', state: null, amountPaise: 100, paidOn: '2026-08-12', bankLedgerId: salaries, reference: null, bsrCode: null, challanNo: null }
    expect(() => recordStatutoryPayment(db, pay)).toThrow(/bank or cash/)
    expect(() => recordStatutoryPayment(db, { ...pay, bankLedgerId: bank(db), bsrCode: '0510308' })).toThrow(/BSR code/)
    expect(() => recordStatutoryPayment(db, { ...pay, kind: 'pf' as never })).toThrow(/Only salary TDS/)
    expect(listStatutoryPayments(db)).toHaveLength(0)
  })

  it('a pay run journal cannot be edited in the voucher editor; deleting the run drops its 24Q entries', () => {
    const { db, run } = setup()
    const v = getVoucher(db, run.voucherId!)!
    expect(() => saveVoucher(db, voucherToPayload(v), run.voucherId!)).toThrow(/pay run/)
    deleteRun(db, run.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM tds_entries').get()).toEqual({ n: 0 })
    expect(statutoryDues(db, 2026, '2026-08-10')).toHaveLength(0)
  })
})

describe('an old book: a PF / ESI / PT run and a PF payment saved before audit A13b', () => {
  // The rows exactly as the old commitRun / recordStatutoryPayment wrote them (no service writes
  // them any more): one employee, June 2026, basic 20,000 — PF 1,800 / 1,800 (EPS 1,250), EDLI
  // 75, admin 75 + the ₹500-minimum top-up 350, PT 200. Journal: Salaries Dr 20,000, Employer PF
  // Contribution Dr 1,800, PF Admin & EDLI Charges Dr 500 (75 + 75 + 350) = 22,300; PF Payable Cr
  // 4,100 (1,800 + 1,800 + 500), Professional Tax Payable Cr 200, Salaries Payable Cr 18,000
  // (20,000 − 1,800 − 200) = 22,300. Then PF 4,100 paid on 10 July 2026.
  function oldBook() {
    const db = seededDb()
    const e = saveEmployee(db, emp({ name: 'Old Hand', basic: R(20_000), hra: 0, special: 0, tdsEnabled: false }))
    const journal = (db.prepare("SELECT id FROM voucher_types WHERE kind = 'journal' AND is_system = 1").get() as { id: number }).id
    const blank = { number: undefined, partyLedgerId: null, reference: null, instrumentNo: null, instrumentDate: null, transporterId: null, vehicleNo: null, transportDistanceKm: null, currencyCode: null, exchangeRate: null, inventory: [], billRefs: [], tds: null }
    const line = (ledgerId: number, drCr: 'dr' | 'cr', amount: number) => ({ ledgerId, drCr, amount, costAllocations: [] })
    const pf = ensureStatutoryLedger(db, 'pf')
    const pt = ensureStatutoryLedger(db, 'pt')
    const v = saveVoucher(db, {
      ...blank, voucherTypeId: journal, date: '2026-06-30', narration: 'Salary for 2026-06 — 1 employee',
      lines: [
        line(findOrCreateLedger(db, 'Salaries', 'Indirect Expenses'), 'dr', R(20_000)),
        line(findOrCreateLedger(db, 'Employer PF Contribution', 'Indirect Expenses'), 'dr', R(1_800)),
        line(findOrCreateLedger(db, 'PF Admin & EDLI Charges', 'Indirect Expenses'), 'dr', R(500)),
        line(pf, 'cr', R(4_100)), line(pt, 'cr', R(200)), line(ensureStatutoryLedger(db, 'salary'), 'cr', R(18_000))
      ]
    })
    const runId = Number(db.prepare("INSERT INTO payroll_runs (month, voucher_id, pf_admin_topup) VALUES ('2026-06', ?, ?)").run(v.id, R(350)).lastInsertRowid)
    db.prepare(
      `INSERT INTO payroll_lines (run_id, employee_id, payable_days, month_days, basic, hra, special, gross, pf_emp, pf_er, esi_emp, esi_er, pt, net,
         other_earnings, other_deductions, eps_er, pf_admin, edli, vpf, epf_wage, eps_wage, edli_wage, esi_covered, esi_wage, tds, pt_state, tax_regime)
       VALUES (?, ?, 30, 30, ?, 0, 0, ?, ?, ?, 0, 0, ?, ?, 0, 0, ?, ?, ?, 0, ?, ?, ?, 0, 0, 0, 'MH', 'new')`
    ).run(runId, e.id, R(20_000), R(20_000), R(1_800), R(1_800), R(200), R(18_000), R(1_250), R(75), R(75), R(15_000), R(15_000), R(15_000))
    const paymentType = (db.prepare("SELECT id FROM voucher_types WHERE kind = 'payment' AND is_system = 1").get() as { id: number }).id
    const hdfc = bank(db)
    const pv = saveVoucher(db, { ...blank, voucherTypeId: paymentType, date: '2026-07-10', narration: 'EPF for 2026-06 paid', lines: [line(pf, 'dr', R(4_100)), line(hdfc, 'cr', R(4_100))] })
    const paymentId = Number(db.prepare(
      "INSERT INTO statutory_payments (kind, period, state, amount_paise, payment_voucher_id, reference, paid_on) VALUES ('pf', '2026-06', NULL, ?, ?, NULL, '2026-07-10')"
    ).run(R(4_100), pv.id).lastInsertRowid)
    return { db, runId, paymentId }
  }

  it('reads the old run with every PF / PT figure it stored', () => {
    const { db, runId } = oldBook()
    const run = getRun(db, runId)!
    expect(run.pfAdminTopUp).toBe(R(350))
    expect(run.lines[0]).toMatchObject({ gross: R(20_000), pfEmp: R(1_800), pfEr: R(1_800), epsEr: R(1_250), pfAdmin: R(75), edli: R(75), pt: R(200), net: R(18_000), epfWage: R(15_000) })
    expect(listRuns(db).map((r) => r.id)).toEqual([runId])
  })

  it('keeps the payable balances in the trial balance: PF paid off, PT still owed', () => {
    const { db } = oldBook()
    const row = (name: string) => trialBalance(db, '2026-07-31').rows.find((r) => r.ledgerName === name)
    // PF Payable: Cr 4,100 then Dr 4,100 paid → nil; PT Payable Cr 200.
    expect(row('PF Payable')).toMatchObject({ debit: 0, credit: 0, movementDebit: R(4_100), movementCredit: R(4_100) })
    expect(row('Professional Tax Payable')).toMatchObject({ debit: 0, credit: R(200) })
    expect(trialBalance(db, '2026-06-30').rows.find((r) => r.ledgerName === 'PF Payable')).toMatchObject({ credit: R(4_100) })
  })

  it('still lists its PF / PT dues (the cash forecast reads them) and keeps the PF payment', () => {
    const { db, paymentId } = oldBook()
    const dues = statutoryDues(db, 2026, '2026-07-20')
    expect(dues.find((d) => d.key === 'pf:2026-06')).toMatchObject({ payablePaise: R(4_100), employeePaise: R(1_800), employerPaise: R(2_300), paidPaise: R(4_100), status: 'paid', dueDate: '2026-07-15' })
    expect(dues.find((d) => d.key === 'pt:2026-06:MH')).toMatchObject({ payablePaise: R(200), status: 'unpaid' })
    expect(listStatutoryPayments(db, 2026).map((p) => [p.kind, p.amountPaise])).toEqual([['pf', R(4_100)]])
    // An old PF payment is not removed from the payroll screen any more (bin its entry instead).
    expect(() => deleteStatutoryPayment(db, paymentId)).toThrow(/Only salary TDS/)
    // A new run in the same book adds no PF / PT.
    const july = commitRun(db, '2026-07', [])
    expect(july.lines[0]).toMatchObject({ gross: R(20_000), pfEmp: 0, pt: 0, net: R(20_000) })
    expect(statutoryDues(db, 2026, '2026-08-20').filter((d) => d.period === '2026-07')).toEqual([])
  })
})

describe('declarations, regimes and Form 16', () => {
  it('old-regime declarations cut the projected TDS; Form 16 / 130 data carries the actual workings', () => {
    const db = seededDb()
    const a = saveEmployee(db, emp({ taxRegime: 'old', metro: true }))
    const before = previewRun(db, '2026-04', [])[0]!.tds
    setDeclarations(db, { employeeId: a.id, fyStartYear: 2026, rows: [
      { section: '80C', amountPaise: R(1_50_000), proofReceived: true }, { section: 'RENT', amountPaise: R(4_80_000), proofReceived: false }
    ] })
    expect(getDeclarations(db, a.id, 2026).map((d) => d.section).sort()).toEqual(['80C', 'RENT'])
    const after = previewRun(db, '2026-04', [])[0]!
    expect(after.tds).toBeLessThan(before)
    expect(after.tdsWorkings).toMatchObject({ regime: 'old' })
    commitRun(db, '2026-04', [])
    const f16 = form16Data(db, TEST_INFO, 2026, (id) => actualWorkings(db, id, 2026))
    expect(f16).toMatchObject({ act: '2025', formName: 'Form No. 130', yearLabel: '2026-27' })
    expect(f16.employees[0]!.workings.hraExemption).toBeGreaterThan(0)
    expect(f16.employees[0]!.quarters[0]!.tdsPaise).toBe(after.tds)
    // Q4 of the year: annexure II rows for every employee paid in the year.
    const q4 = form24qData(db, 2026, 4, (id) => actualWorkings(db, id, 2026))
    expect(q4.salaries.map((s) => s.employeeName)).toEqual(['Anil Mehta'])
    expect(form24qCsv(q4)).toContain('Annexure II')
  })
})
