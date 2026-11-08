import { describe, it, expect } from 'vitest'
import { seededDb } from '../db/testdb'
import type { DB } from '../db/connection'
import type { EmployeeInputPayload as EmployeeInput } from '@shared/schemas'
import { setLockDate } from './vouchers'
import {
  saveEmployee, listEmployees, listPayHeads, savePayHead, deletePayHead,
  getEmployeeHeads, setEmployeeHeads, previewRun, commitRun, getRun, deleteRun
} from './payroll'

const emp = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  name: 'Asha Kumar', code: null, designation: null, joined: null,
  pan: null, uan: null, esicNo: null,
  basic: 20_000_00, hra: 8_000_00, special: 4_000_00,
  pfEnabled: true, esiEnabled: true, ptEnabled: true, ptState: 'MH', active: true,
  ...over
})

describe('pay heads', () => {
  it('migration seeds Basic/HRA/Special; saveEmployee syncs their per-employee overrides', () => {
    const db = seededDb()
    expect(listPayHeads(db).map((h) => h.name)).toEqual(['Basic', 'HRA', 'Special Allowance'])

    const e = saveEmployee(db, emp())
    const heads = getEmployeeHeads(db, e.id)
    expect(heads.map((h) => [h.name, h.overrideValue])).toEqual([
      ['Basic', 20_000_00], ['HRA', 8_000_00], ['Special Allowance', 4_000_00]
    ])

    // Editing the employee's salary keeps the head overrides in lockstep.
    saveEmployee(db, emp({ basic: 25_000_00 }), e.id)
    expect(getEmployeeHeads(db, e.id).find((h) => h.name === 'Basic')!.overrideValue).toBe(25_000_00)
  })

  it('savePayHead creates/updates, deletePayHead refuses while assigned', () => {
    const db = seededDb()
    const head = savePayHead(db, { name: 'Conveyance', kind: 'earning', calc: 'flat', value: 1_600_00, active: true })
    expect(head.value).toBe(1_600_00)

    const updated = savePayHead(db, { name: 'Conveyance', kind: 'earning', calc: 'flat', value: 2_000_00, active: true }, head.id)
    expect(updated.value).toBe(2_000_00)

    const e = saveEmployee(db, emp())
    const assigned = getEmployeeHeads(db, e.id).map((h) => ({ payHeadId: h.payHeadId, overrideValue: h.overrideValue }))
    setEmployeeHeads(db, { employeeId: e.id, heads: [...assigned, { payHeadId: head.id, overrideValue: null }] })

    expect(() => deletePayHead(db, head.id)).toThrow(/assigned/)
    setEmployeeHeads(db, { employeeId: e.id, heads: assigned })
    deletePayHead(db, head.id)
    expect(listPayHeads(db).find((h) => h.id === head.id)).toBeUndefined()
  })

  it('previewRun consumes custom heads and per-employee overrides', () => {
    const db = seededDb()
    const e = saveEmployee(db, emp({ basic: 10_000_00, hra: 0, special: 0 }))
    const conveyance = savePayHead(db, { name: 'Conveyance', kind: 'earning', calc: 'flat', value: 1_600_00, active: true })
    const canteen = savePayHead(db, { name: 'Canteen', kind: 'deduction', calc: 'flat', value: 500_00, active: true })
    const assigned = getEmployeeHeads(db, e.id).map((h) => ({ payHeadId: h.payHeadId, overrideValue: h.overrideValue }))
    setEmployeeHeads(db, {
      employeeId: e.id,
      heads: [...assigned, { payHeadId: conveyance.id, overrideValue: null }, { payHeadId: canteen.id, overrideValue: 300_00 }]
    })

    const [line] = previewRun(db, '2026-07', [])
    expect(line!.otherEarnings).toBe(1_600_00)
    expect(line!.otherDeductions).toBe(300_00) // override wins over the head default
    expect(line!.gross).toBe(11_600_00)
    expect(line!.headAmounts.map((h) => h.name)).toEqual(['Basic', 'HRA', 'Special Allowance', 'Conveyance', 'Canteen'])
  })

  it('previewRun deducts no PF / ESI / PT whatever the stored flags say (audit A13b)', () => {
    const db = seededDb()
    saveEmployee(db, emp({ name: 'MH Emp', basic: 15_000_00, hra: 5_000_00, special: 0, ptState: 'MH' }))
    const [line] = previewRun(db, '2026-07', [])
    // Gross 20,000 used to lose PF 1,800 + PT 200; now net = gross (TDS nil: 1.8 lakh a year).
    expect(line).toMatchObject({ gross: 20_000_00, pfEmp: 0, pfEr: 0, esiEmp: 0, esiEr: 0, pt: 0, tds: 0, net: 20_000_00 })
  })
})

const voucherCount = (db: DB): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM vouchers').get() as { n: number }).n

describe('commitRun', () => {
  it('books salaries against Salaries Payable only — no PF / ESI / PT lines (audit A13b)', () => {
    const db = seededDb()
    saveEmployee(db, emp())
    const run = commitRun(db, '2026-07', [])
    expect(run.voucherId).not.toBeNull()

    const lines = db
      .prepare(
        `SELECT l.name, vl.dr_cr AS drCr, vl.amount FROM voucher_lines vl
         JOIN ledgers l ON l.id = vl.ledger_id WHERE vl.voucher_id = ? ORDER BY vl.line_order`
      )
      .all(run.voucherId) as { name: string; drCr: 'dr' | 'cr'; amount: number }[]
    // Gross 20,000 + 8,000 + 4,000 = 32,000; a year of 32,000 × 9 = 2.88 lakh is under the new
    // regime's rebate, so no TDS: Salaries Dr 32,000 / Salaries Payable Cr 32,000.
    expect(lines).toEqual([
      { name: 'Salaries', drCr: 'dr', amount: 32_000_00 },
      { name: 'Salaries Payable', drCr: 'cr', amount: 32_000_00 }
    ])
    expect(run.pfAdminTopUp).toBe(0)
    const stored = getRun(db, run.id)!.lines[0]!
    expect(stored).toMatchObject({ pfEmp: 0, pfEr: 0, epsEr: 0, pfAdmin: 0, edli: 0, esiEmp: 0, esiEr: 0, pt: 0, net: 32_000_00 })
    expect(stored.headAmounts.length).toBeGreaterThan(0)
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledgers WHERE statutory_kind IN ('pf', 'esi', 'pt')").get()).toEqual({ n: 0 })
  })

  it('is atomic: a failure while writing run rows also rolls back the salary voucher', () => {
    const db = seededDb()
    saveEmployee(db, emp())
    const before = voucherCount(db)
    db.exec(`CREATE TRIGGER fail_payroll_line BEFORE INSERT ON payroll_lines
             BEGIN SELECT RAISE(ABORT, 'boom'); END;`)
    expect(() => commitRun(db, '2026-07', [])).toThrow('boom')
    db.exec('DROP TRIGGER fail_payroll_line')

    expect(voucherCount(db)).toBe(before) // no orphaned voucher
    expect(db.prepare('SELECT COUNT(*) AS n FROM payroll_runs').get()).toEqual({ n: 0 })

    // and the month can still be posted afterwards
    const run = commitRun(db, '2026-07', [])
    expect(run.month).toBe('2026-07')
  })

  it('deleteRun in a locked period fails with a payroll-specific message and leaves the run intact', () => {
    const db = seededDb()
    saveEmployee(db, emp())
    const run = commitRun(db, '2026-07', [])
    setLockDate(db, '2026-08-31')
    expect(() => deleteRun(db, run.id)).toThrow(/Payroll for 2026-07 falls in a locked period/)
    expect(getRun(db, run.id)).not.toBeNull()
    setLockDate(db, null)
    deleteRun(db, run.id)
    expect(getRun(db, run.id)).toBeNull()
  })
})

describe('employees regression', () => {
  it('a new employee starts with PF / ESI / PT off; an edit that leaves them out keeps what is stored', () => {
    const db = seededDb()
    const e = saveEmployee(db, { name: 'New Hire', basic: 10_000_00 })
    expect(e).toMatchObject({ pfEnabled: false, esiEnabled: false, ptEnabled: false, ptState: 'MH', uan: null, esicNo: null })
    // An old book's employee with the old profile: an edit from today's form keeps it.
    const old = saveEmployee(db, emp({ name: 'Old Hand', uan: '100100100100', esicNo: '3100123456', ptState: 'KA', pfNumber: 'MH/123/45' }))
    const edited = saveEmployee(db, { name: 'Old Hand', basic: 21_000_00 }, old.id)
    expect(edited).toMatchObject({ pfEnabled: true, esiEnabled: true, ptEnabled: true, ptState: 'KA', uan: '100100100100', esicNo: '3100123456', pfNumber: 'MH/123/45', basic: 21_000_00 })
  })

  it('listEmployees surfaces ptState with the migration default', () => {
    const db = seededDb()
    db.prepare("INSERT INTO employees (name, basic) VALUES ('Raw Row', 1000000)").run()
    const e = listEmployees(db).find((x) => x.name === 'Raw Row')!
    expect(e.ptState).toBe('MH')
  })
})
