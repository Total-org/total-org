/**
 * Payroll statutory — server side (WP 3.7): tax declarations, tagged payable ledgers, the dues
 * list (salary TDS payable by month, paid / unpaid, due dates — and, for old books, the PF / ESI /
 * PT their runs deducted), salary TDS payments, salary TDS entries for the TDS screen (section
 * 192 / 2025 s.392), and the Form 24Q / Form 16 Part B data.
 *
 * PF / ESI / PT were removed for good in audit A13b (owner, 8 Nov 2026): the rates master
 * (statutory_rates, migration 029 — the table stays) and the ECR / ESI / PT files are gone, and
 * new runs deduct none of them. `statutoryDues` still lists what old runs deducted (the cash
 * forecast reads it, unchanged); a PF / ESI / PT due an old run left with something outstanding
 * can still be marked paid (`oldDuesLeft`, owner 8 Nov: "Let old dues be marked paid") and its
 * payments removed again — nothing else of those kinds is recorded.
 *
 * Every figure the dashboard shows is computed at query time from payroll_lines of runs whose
 * voucher is in the books, and from statutory_payments whose voucher is in the books — nothing is
 * denormalised.
 */
import type { DB } from '../db/connection'
import type { CompanyInfo } from '@shared/domain'
import type { StatutoryPaymentInput, StatutoryPaymentKind, TaxDeclarationsSetInput } from '@shared/schemas'
import type {
  DueStatus, Form16Data, Form16Employee, Form24qData, Form24qDeducteeRow, Form24qSalaryRow, StatutoryDueRow, StatutoryPayment, TaxDeclaration
} from '@shared/payrollStatutoryTypes'
import { fyFromStartYear } from '@shared/dates'
import { tdsQuarterBounds } from '@shared/tds'
import { DECLARATION_LABELS, esiDueDate, incomeTaxYear, pfDueDate, tdsDueDate, type DeclarationSection, type SalaryWorkings } from '@shared/payrollStatutory'
import { daysInMonth } from '@shared/payroll'
import { writeAudit } from './audit'
import { deleteVoucher, IN_BOOKS, NOT_DELETED, saveVoucher } from './vouchers'
import { ensureTdsPayableLedger } from './tds'
import { challanFromPayment } from './tdsWorkbench'

// ---------------------------------------------------------------------------------------------
// Tax declarations
// ---------------------------------------------------------------------------------------------

export function getDeclarations(db: DB, employeeId: number, fyStartYear: number): TaxDeclaration[] {
  const rows = db.prepare(
    'SELECT section, amount_paise AS amountPaise, proof_received AS proof FROM employee_tax_declarations WHERE employee_id = ? AND fy_start_year = ?'
  ).all(employeeId, fyStartYear) as { section: DeclarationSection; amountPaise: number; proof: number }[]
  return rows.map((r) => ({ section: r.section, label: DECLARATION_LABELS[r.section] ?? r.section, amountPaise: r.amountPaise, proofReceived: !!r.proof }))
}

export function declarationsMap(db: DB, employeeId: number, fyStartYear: number): Partial<Record<DeclarationSection, number>> {
  const out: Partial<Record<DeclarationSection, number>> = {}
  for (const d of getDeclarations(db, employeeId, fyStartYear)) out[d.section] = d.amountPaise
  return out
}

export function setDeclarations(db: DB, input: TaxDeclarationsSetInput): TaxDeclaration[] {
  if (!db.prepare('SELECT 1 FROM employees WHERE id = ?').get(input.employeeId)) throw new Error('Employee not found')
  const sections = new Set<string>()
  for (const r of input.rows) {
    if (sections.has(r.section)) throw new Error(`Section ${r.section} is listed twice`)
    sections.add(r.section)
  }
  const before = getDeclarations(db, input.employeeId, input.fyStartYear)
  db.transaction(() => {
    db.prepare('DELETE FROM employee_tax_declarations WHERE employee_id = ? AND fy_start_year = ?').run(input.employeeId, input.fyStartYear)
    const ins = db.prepare(
      'INSERT INTO employee_tax_declarations (employee_id, fy_start_year, section, amount_paise, proof_received) VALUES (?, ?, ?, ?, ?)'
    )
    for (const r of input.rows) if (r.amountPaise > 0) ins.run(input.employeeId, input.fyStartYear, r.section, r.amountPaise, r.proofReceived ? 1 : 0)
  })()
  const after = getDeclarations(db, input.employeeId, input.fyStartYear)
  writeAudit(db, 'employee', input.employeeId, 'update', { taxDeclarations: { fy: input.fyStartYear, rows: before } }, { taxDeclarations: { fy: input.fyStartYear, rows: after } })
  return after
}

// ---------------------------------------------------------------------------------------------
// Tagged payable ledgers (ledgers.statutory_kind) and the salary TDS section
// ---------------------------------------------------------------------------------------------

export type { DueStatus, Form16Data, Form16Employee, Form24qData, Form24qDeducteeRow, Form24qSalaryRow, StatutoryDueRow, StatutoryPayment, TaxDeclaration }

export type StatutoryLedgerKind = 'pf' | 'esi' | 'pt' | 'salary'

const PAYABLE_DEFAULTS: Record<StatutoryLedgerKind, { name: string; group: string }> = {
  pf: { name: 'PF Payable', group: 'Provisions' },
  esi: { name: 'ESI Payable', group: 'Provisions' },
  pt: { name: 'Professional Tax Payable', group: 'Duties & Taxes' },
  salary: { name: 'Salaries Payable', group: 'Provisions' }
}

/** Find-or-create the ledger tagged `kind`: by tag first, else adopt an untagged ledger of the
 *  default name (tagging it), else create it under the default group, tagged. */
export function ensureStatutoryLedger(db: DB, kind: StatutoryLedgerKind): number {
  const tagged = db.prepare('SELECT id FROM ledgers WHERE statutory_kind = ? ORDER BY id LIMIT 1').get(kind) as { id: number } | undefined
  if (tagged) return tagged.id
  const def = PAYABLE_DEFAULTS[kind]
  const byName = db.prepare('SELECT id, statutory_kind AS k FROM ledgers WHERE name = ? COLLATE NOCASE').get(def.name) as { id: number; k: string | null } | undefined
  if (byName && byName.k == null) {
    db.prepare('UPDATE ledgers SET statutory_kind = ? WHERE id = ?').run(kind, byName.id)
    writeAudit(db, 'ledger', byName.id, 'update', { statutoryKind: null }, { statutoryKind: kind })
    return byName.id
  }
  const group = db.prepare('SELECT id FROM groups WHERE name = ?').get(def.group) as { id: number } | undefined
  if (!group) throw new Error(`Group ${def.group} missing`)
  const name = byName ? `${def.name} (${kind.toUpperCase()})` : def.name
  const res = db.prepare('INSERT INTO ledgers (name, group_id, is_system, statutory_kind) VALUES (?, ?, 0, ?)').run(name, group.id, kind)
  const id = Number(res.lastInsertRowid)
  writeAudit(db, 'ledger', id, 'create', null, { id, name, groupId: group.id, statutoryKind: kind })
  return id
}

/** tds_sections id of salary TDS (code '192'; 2025 Act s.392), seeded by migration 029. */
export function salaryTdsSectionId(db: DB): number {
  const r = db.prepare("SELECT id FROM tds_sections WHERE code = '192'").get() as { id: number } | undefined
  if (!r) throw new Error('Salary TDS section 192 is missing — it is seeded by migration 029')
  return r.id
}

export function ensureSalaryTdsPayable(db: DB): number {
  return ensureTdsPayableLedger(db, salaryTdsSectionId(db))
}

// ---------------------------------------------------------------------------------------------
// Dues dashboard
// ---------------------------------------------------------------------------------------------

interface RunLineAgg {
  runId: number; month: string; voucherId: number | null
  pfEmp: number; vpf: number; pfEr: number; pfAdmin: number; edli: number; pfMembers: number
  esiEmp: number; esiEr: number; esiMembers: number; tds: number; tdsMembers: number; adminTopUp: number
}

/**
 * PT due date by state for a wage month — only for the PT old runs deducted (statutoryDues). Each state's rule and its citation live with the PT
 * rows in migration 029; this mirrors the employer's monthly-return due date:
 * MH last day of the following month (MH PT Rules r.11A, monthly enrolment liability
 * > ₹1 lakh a year — UNVERIFIED for smaller employers who pay annually by 31 March), KA 20th of the
 * following month (KTP Act s.6), WB 21st of the following month, AP/TS 10th of the following
 * month, GJ 15th of the following month, MP 10th of the following month, TN half-yearly (30 Sep /
 * 31 Mar). Every date here is on the UNVERIFIED list of the WP 3.7 report.
 */
export function ptDueDate(state: string, month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const nm = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const lastOf = (ym: string): string => `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`
  switch (state) {
    case 'MH': return lastOf(nm)
    case 'KA': return `${nm}-20`
    case 'WB': return `${nm}-21`
    case 'AP': case 'TS': case 'MP': return `${nm}-10`
    case 'GJ': return `${nm}-15`
    case 'TN': return m >= 4 && m <= 9 ? `${y}-09-30` : `${m >= 10 ? y + 1 : y}-03-31`
    default: return lastOf(nm)
  }
}

/** Every payable a posted run left, by month: salary TDS, and the PF / ESI / PT that runs posted
 *  before audit A13b deducted (new runs carry none). The cash forecast reads all of it; the
 *  Payroll → Salary TDS tab shows the TDS rows and, under "Left from before", the old PF / ESI /
 *  PT rows still outstanding (payroll:dues, `oldDuesLeft`). */
export function statutoryDues(db: DB, fyStartYear: number, today: string): StatutoryDueRow[] {
  const fy = fyFromStartYear(fyStartYear)
  const fromMonth = fy.from.slice(0, 7)
  const toMonth = fy.to.slice(0, 7)
  const runs = db.prepare(
    `SELECT r.id AS runId, r.month, r.voucher_id AS voucherId, r.pf_admin_topup AS adminTopUp,
            COALESCE(SUM(pl.pf_emp), 0) AS pfEmp, COALESCE(SUM(pl.vpf), 0) AS vpf, COALESCE(SUM(pl.pf_er), 0) AS pfEr,
            COALESCE(SUM(pl.pf_admin), 0) AS pfAdmin, COALESCE(SUM(pl.edli), 0) AS edli,
            SUM(CASE WHEN pl.pf_emp > 0 OR pl.pf_er > 0 THEN 1 ELSE 0 END) AS pfMembers,
            COALESCE(SUM(pl.esi_emp), 0) AS esiEmp, COALESCE(SUM(pl.esi_er), 0) AS esiEr,
            SUM(CASE WHEN pl.esi_emp > 0 OR pl.esi_er > 0 THEN 1 ELSE 0 END) AS esiMembers,
            COALESCE(SUM(pl.tds), 0) AS tds, SUM(CASE WHEN pl.tds > 0 THEN 1 ELSE 0 END) AS tdsMembers
       FROM payroll_runs r JOIN vouchers v ON v.id = r.voucher_id
       LEFT JOIN payroll_lines pl ON pl.run_id = r.id
      WHERE r.month BETWEEN ? AND ? AND ${IN_BOOKS}
      GROUP BY r.id ORDER BY r.month`
  ).all(fromMonth, toMonth) as RunLineAgg[]
  const pt = db.prepare(
    `SELECT pl.run_id AS runId, COALESCE(pl.pt_state, e.pt_state) AS state, SUM(pl.pt) AS pt, SUM(CASE WHEN pl.pt > 0 THEN 1 ELSE 0 END) AS n
       FROM payroll_lines pl JOIN employees e ON e.id = pl.employee_id
      WHERE pl.run_id = ? GROUP BY COALESCE(pl.pt_state, e.pt_state)`
  )
  const paid = statutoryPaidMap(db)
  const ledger = (k: StatutoryLedgerKind): number | null =>
    (db.prepare('SELECT id FROM ledgers WHERE statutory_kind = ? ORDER BY id LIMIT 1').get(k) as { id: number } | undefined)?.id ?? null
  const tdsSection = db.prepare("SELECT id FROM tds_sections WHERE code = '192'").get() as { id: number } | undefined
  const tdsLedger = tdsSection
    ? ((db.prepare('SELECT id FROM ledgers WHERE tds_payable_section_id = ? ORDER BY id LIMIT 1').get(tdsSection.id) as { id: number } | undefined)?.id ?? null)
    : null
  const out: StatutoryDueRow[] = []
  const push = (
    kind: StatutoryPaymentKind, run: RunLineAgg, state: string | null, employees: number, employee: number, employer: number,
    dueDate: string, ledgerId: number | null
  ): void => {
    const payable = employee + employer
    if (payable <= 0) return
    const key = `${kind}:${run.month}${state ? `:${state}` : ''}`
    const paidPaise = paid.get(key) ?? 0
    const outstanding = payable - paidPaise
    const status: DueStatus = outstanding <= 0 ? 'paid' : paidPaise > 0 ? 'part' : today > dueDate ? 'overdue' : 'unpaid'
    out.push({
      key, kind, period: run.month, state, runId: run.runId, voucherId: run.voucherId, employees,
      employeePaise: employee, employerPaise: employer, payablePaise: payable, paidPaise, outstandingPaise: Math.max(0, outstanding),
      dueDate, status, ledgerId
    })
  }
  for (const r of runs) {
    push('pf', r, null, r.pfMembers, r.pfEmp + r.vpf, r.pfEr + r.pfAdmin + r.edli + r.adminTopUp, pfDueDate(r.month), ledger('pf'))
    push('esi', r, null, r.esiMembers, r.esiEmp, r.esiEr, esiDueDate(r.month), ledger('esi'))
    for (const p of pt.all(r.runId) as { state: string; pt: number; n: number }[]) {
      push('pt', r, p.state, p.n, p.pt, 0, ptDueDate(p.state, r.month), ledger('pt'))
    }
    push('tds', r, null, r.tdsMembers, r.tds, 0, tdsDueDate(r.month), tdsLedger)
  }
  return out
}

/** Wage months 'YYYY-MM' whose in-books pay run deducted PF / ESI (any line with an employee or
 *  employer share) — only runs saved before audit A13b can. The compliance calendar
 *  (upcomingDeadlines `pfMonths` / `esiMonths`) lists a month's PF / ESI date only for these. */
export function payrollDeductionMonths(db: DB): { pf: string[]; esi: string[] } {
  const rows = db.prepare(
    `SELECT r.month,
            MAX(CASE WHEN pl.pf_emp + pl.pf_er > 0 THEN 1 ELSE 0 END) AS pf,
            MAX(CASE WHEN pl.esi_emp + pl.esi_er > 0 THEN 1 ELSE 0 END) AS esi
       FROM payroll_runs r JOIN vouchers v ON v.id = r.voucher_id JOIN payroll_lines pl ON pl.run_id = r.id
      WHERE ${IN_BOOKS}
      GROUP BY r.month ORDER BY r.month`
  ).all() as { month: string; pf: number; esi: number }[]
  return { pf: rows.filter((r) => r.pf).map((r) => r.month), esi: rows.filter((r) => r.esi).map((r) => r.month) }
}

/** The PF / ESI / PT dues old runs (saved before audit A13b) left with something still to pay,
 *  for the FY — the Salary TDS tab's "Left from before". New runs never add to it. */
export function oldDuesLeft(db: DB, fyStartYear: number, today: string): StatutoryDueRow[] {
  return statutoryDues(db, fyStartYear, today).filter((d) => d.kind !== 'tds' && d.outstandingPaise > 0)
}

/** FY start year of a wage month 'YYYY-MM' (April–March). */
const fyStartOfMonth = (month: string): number => {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return m >= 4 ? y : y - 1
}

function statutoryPaidMap(db: DB): Map<string, number> {
  const rows = db.prepare(
    `SELECT sp.kind, sp.period, sp.state, SUM(sp.amount_paise) AS paid
       FROM statutory_payments sp LEFT JOIN vouchers v ON v.id = sp.payment_voucher_id
      WHERE sp.payment_voucher_id IS NULL OR ${NOT_DELETED}
      GROUP BY sp.kind, sp.period, sp.state`
  ).all() as { kind: string; period: string; state: string | null; paid: number }[]
  return new Map(rows.map((r) => [`${r.kind}:${r.period}${r.state ? `:${r.state}` : ''}`, r.paid]))
}

// ---------------------------------------------------------------------------------------------
// Statutory payments
// ---------------------------------------------------------------------------------------------

export function listStatutoryPayments(db: DB, fyStartYear?: number): StatutoryPayment[] {
  const fy = fyStartYear != null ? fyFromStartYear(fyStartYear) : null
  const rows = db.prepare(
    `SELECT sp.id, sp.kind, sp.period, sp.state, sp.amount_paise AS amountPaise, sp.payment_voucher_id AS paymentVoucherId,
            v.number AS voucherNumber, sp.reference, sp.paid_on AS paidOn,
            (SELECT MIN(c.id) FROM tds_challans c WHERE c.payment_voucher_id = sp.payment_voucher_id) AS tdsChallanId
       FROM statutory_payments sp LEFT JOIN vouchers v ON v.id = sp.payment_voucher_id
      WHERE (sp.payment_voucher_id IS NULL OR v.deleted_at IS NULL) ${fy ? 'AND sp.period BETWEEN ? AND ?' : ''}
      ORDER BY sp.paid_on DESC, sp.id DESC`
  ).all(...(fy ? [fy.from.slice(0, 7), fy.to.slice(0, 7)] : [])) as StatutoryPayment[]
  return rows
}

const KIND_LABEL: Record<StatutoryPaymentKind, string> = { pf: 'EPF', esi: 'ESI', pt: 'Professional tax', tds: 'Salary TDS' }

/** Pay a month's salary TDS, or an old PF / ESI / PT due (audit A13b: only one an old run left
 *  with something outstanding — `oldDuesLeft`, same key kind + month + PT state). Books a Payment
 *  voucher (Dr the payable / Cr bank or cash). With a BSR code + challan serial a TDS challan is
 *  registered on the TDS screen too. */
export function recordStatutoryPayment(db: DB, input: StatutoryPaymentInput): StatutoryPayment {
  if (input.kind === 'pt' && !input.state) throw new Error('Pick the state the professional tax is paid to')
  if (input.kind !== 'pt' && input.state) throw new Error('Only professional tax is paid per state')
  if (input.kind !== 'tds' && (input.bsrCode != null || input.challanNo != null)) throw new Error('A challan is registered for salary TDS only')
  if ((input.bsrCode == null) !== (input.challanNo == null)) throw new Error('Give both the BSR code and the challan serial, or neither')
  if (input.kind !== 'tds') {
    const key = `${input.kind}:${input.period}${input.state ? `:${input.state}` : ''}`
    const left = oldDuesLeft(db, fyStartOfMonth(input.period), input.paidOn).some((d) => d.key === key)
    if (!left) throw new Error(`No ${KIND_LABEL[input.kind]} is left to pay for ${input.period} — new pay runs deduct no PF, ESI or professional tax`)
  }
  const bank = db.prepare(
    `WITH RECURSIVE cb(id) AS (SELECT id FROM groups WHERE name IN ('Bank Accounts', 'Cash-in-Hand', 'Bank OD A/c')
       UNION ALL SELECT g.id FROM groups g JOIN cb ON g.parent_id = cb.id)
     SELECT id FROM ledgers WHERE id = ? AND group_id IN (SELECT id FROM cb)`
  ).get(input.bankLedgerId)
  if (!bank) throw new Error('Pay from a bank or cash ledger')
  const paymentType = db.prepare("SELECT id FROM voucher_types WHERE kind = 'payment' AND is_system = 1").get() as { id: number } | undefined
  if (!paymentType) throw new Error('Payment voucher type missing')
  const label = `${KIND_LABEL[input.kind]}${input.state ? ` (${input.state})` : ''} for ${input.period}`
  const created = db.transaction(() => {
    const payable = input.kind === 'tds' ? ensureSalaryTdsPayable(db) : ensureStatutoryLedger(db, input.kind)
    const v = saveVoucher(db, {
      voucherTypeId: paymentType.id, date: input.paidOn, number: undefined, partyLedgerId: null,
      narration: `${label} paid${input.reference ? ` — ${input.reference}` : ''}`,
      reference: input.reference, instrumentNo: null, instrumentDate: null, transporterId: null, vehicleNo: null,
      transportDistanceKm: null, currencyCode: null, exchangeRate: null,
      lines: [
        { ledgerId: payable, drCr: 'dr', amount: input.amountPaise, costAllocations: [] },
        { ledgerId: input.bankLedgerId, drCr: 'cr', amount: input.amountPaise, costAllocations: [] }
      ],
      inventory: [], billRefs: [], tds: null
    })
    const res = db.prepare(
      'INSERT INTO statutory_payments (kind, period, state, amount_paise, payment_voucher_id, reference, paid_on) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(input.kind, input.period, input.state, input.amountPaise, v.id, input.reference, input.paidOn)
    if (input.kind === 'tds' && input.bsrCode && input.challanNo) {
      challanFromPayment(db, { paymentVoucherId: v.id, bsrCode: input.bsrCode, challanNo: input.challanNo, autoAllocate: true })
    }
    return Number(res.lastInsertRowid)
  })()
  const row = listStatutoryPayments(db).find((p) => p.id === created)!
  writeAudit(db, 'statutory_payment', created, 'create', null, row)
  return row
}

export function deleteStatutoryPayment(db: DB, id: number): void {
  const row = listStatutoryPayments(db).find((p) => p.id === id)
  if (!row) throw new Error('Payment not found')
  // An old PF / ESI / PT payment may be removed too (as before audit A13b): its due opens again.
  db.transaction(() => {
    if (row.paymentVoucherId) {
      db.prepare('DELETE FROM tds_challans WHERE payment_voucher_id = ?').run(row.paymentVoucherId)
      deleteVoucher(db, row.paymentVoucherId)
    }
    db.prepare('DELETE FROM statutory_payments WHERE id = ?').run(id)
  })()
  writeAudit(db, 'statutory_payment', id, 'delete', row, null)
}

// ---------------------------------------------------------------------------------------------
// Form 24Q data (annexure I per quarter, annexure II in Q4) and Form 16 Part B
// ---------------------------------------------------------------------------------------------

/** Salary section code on the return for a date, for a non-Government employer: Form 24Q '92B'
 *  (Protean 24Q file format v7.5 Annexure 2) to FY 2025-26; Form 138 '1002' from 1-4-2026
 *  (Income-tax Rules 2026, Form 138 Annexure I note 1) [F24Q][R26]. */
export function salaryReturnCode(date: string): string {
  return date >= '2026-04-01' ? '1002' : '92B'
}

export function form24qData(db: DB, fyStartYear: number, quarter: 1 | 2 | 3 | 4, workingsFor: (employeeId: number) => Form24qSalaryRow | null): Form24qData {
  const { from, to } = tdsQuarterBounds(fyStartYear, quarter)
  const entries = db.prepare(
    `SELECT te.id AS entryId, v.id AS voucherId, v.date, te.employee_id AS employeeId, e.name AS employeeName,
            COALESCE(te.pan, e.pan) AS pan, te.base_amount AS amountPaise, te.tds_amount AS tdsPaise, tec.challan_id AS challanId
       FROM tds_entries te JOIN vouchers v ON v.id = te.voucher_id JOIN employees e ON e.id = te.employee_id
       LEFT JOIN tds_entry_challans tec ON tec.entry_id = te.id
      WHERE te.employee_id IS NOT NULL AND v.date BETWEEN ? AND ? AND ${IN_BOOKS}
      ORDER BY v.date, e.name`
  ).all(from, to) as { entryId: number; voucherId: number; date: string; employeeId: number; employeeName: string; pan: string | null; amountPaise: number; tdsPaise: number; challanId: number | null }[]
  const challanIds = [...new Set(entries.map((e) => e.challanId).filter((x): x is number => x != null))]
  const challans = challanIds.map((id) => db.prepare('SELECT id, bsr_code AS bsrCode, date, challan_no AS challanNo, amount_paise AS amountPaise FROM tds_challans WHERE id = ?').get(id) as
    { id: number; bsrCode: string; date: string; challanNo: string; amountPaise: number })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const serialOf = new Map(challans.map((c, i) => [c.id, i + 1]))
  const deductees: Form24qDeducteeRow[] = entries.map((e, i) => {
    const c = e.challanId != null ? challans.find((x) => x.id === e.challanId) : undefined
    return {
      serial: i + 1, entryId: e.entryId, voucherId: e.voucherId, employeeId: e.employeeId, employeeName: e.employeeName, pan: e.pan,
      sectionCode: salaryReturnCode(e.date), paymentDate: e.date, amountPaise: e.amountPaise, tdsPaise: e.tdsPaise, deductionDate: e.date,
      challanSerial: c ? serialOf.get(c.id)! : null, bsrCode: c?.bsrCode ?? null, challanDate: c?.date ?? null, challanNo: c?.challanNo ?? null
    }
  })
  let salaries: Form24qSalaryRow[] = []
  if (quarter === 4) {
    const fy = fyFromStartYear(fyStartYear)
    const ids = db.prepare(
      `SELECT DISTINCT pl.employee_id AS id FROM payroll_lines pl JOIN payroll_runs r ON r.id = pl.run_id JOIN vouchers v ON v.id = r.voucher_id
        WHERE r.month BETWEEN ? AND ? AND ${IN_BOOKS}`
    ).all(fy.from.slice(0, 7), fy.to.slice(0, 7)) as { id: number }[]
    salaries = ids.map((r) => workingsFor(r.id)).filter((x): x is Form24qSalaryRow => x != null).sort((a, b) => a.employeeName.localeCompare(b.employeeName))
  }
  return {
    fyStartYear, quarter, layout: from >= '2026-04-01' ? 'form138' : 'form24q',
    deductees,
    challans: challans.map((c, i) => ({ serial: i + 1, challanId: c.id, bsrCode: c.bsrCode, date: c.date, challanNo: c.challanNo, amountPaise: c.amountPaise })),
    salaries,
    totals: {
      amountPaise: deductees.reduce((s, d) => s + d.amountPaise, 0),
      tdsPaise: deductees.reduce((s, d) => s + d.tdsPaise, 0),
      depositedPaise: challans.reduce((s, c) => s + c.amountPaise, 0)
    }
  }
}

const csvCell = (v: string | number | null): string => {
  const s = v == null ? '' : String(v)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
const rupees = (p: number): string => (p / 100).toFixed(2)

/** 24Q data as CSV (annexure I rows, then — Q4 — annexure II rows), for the RPU by hand. */
export function form24qCsv(d: Form24qData): string {
  const lines: string[] = []
  lines.push(`Form ${d.layout === 'form138' ? '138 (24Q under the Income-tax Rules 2026)' : '24Q'} data,FY ${d.fyStartYear}-${String((d.fyStartYear + 1) % 100).padStart(2, '0')},Q${d.quarter}`)
  lines.push('Annexure I — deductee details')
  lines.push('Sl,Employee,PAN,Section code,Date of payment,Amount paid,TDS,Date of deduction,Challan Sl,BSR code,Challan date,Challan serial')
  for (const r of d.deductees) {
    lines.push([r.serial, r.employeeName, r.pan ?? 'PANNOTAVBL', r.sectionCode, r.paymentDate, rupees(r.amountPaise), rupees(r.tdsPaise), r.deductionDate,
      r.challanSerial, r.bsrCode, r.challanDate, r.challanNo].map(csvCell).join(','))
  }
  lines.push(['TOTAL', '', '', '', '', rupees(d.totals.amountPaise), rupees(d.totals.tdsPaise)].map(csvCell).join(','))
  if (d.quarter === 4) {
    lines.push('')
    lines.push('Annexure II — salary details for the year')
    lines.push('Employee,PAN,Regime (new = opted out of old),From,To,Gross salary,Exemptions s.10,Standard deduction,Professional tax,Income from salary,Other income,House property loss,Gross total income,Chapter VI-A,Total income,Tax on total income,Rebate,Surcharge,Cess,Tax payable,Previous employer TDS,TDS deducted,Shortfall (excess)')
    for (const s of d.salaries) {
      const w = s.workings
      lines.push([s.employeeName, s.pan ?? 'PANNOTAVBL', s.regime === 'new' ? 'Y' : 'N', s.periodFrom, s.periodTo, rupees(w.gross), rupees(w.hraExemption),
        rupees(w.standardDeduction), rupees(w.professionalTax), rupees(w.incomeFromSalary), rupees(w.otherIncome), rupees(w.housePropertyLoss),
        rupees(w.grossTotalIncome), rupees(w.deductionsTotal), rupees(w.totalIncome), rupees(w.taxOnIncome.taxBeforeRebate), rupees(w.taxOnIncome.rebate),
        rupees(w.taxOnIncome.surcharge), rupees(w.taxOnIncome.cess), rupees(w.taxOnIncome.total), rupees(w.previousEmployerTds),
        rupees(s.tdsDeductedPaise), rupees(s.shortfallPaise)].map(csvCell).join(','))
    }
  }
  return lines.join('\n')
}

export function form16Data(
  db: DB, company: CompanyInfo, fyStartYear: number, workingsFor: (employeeId: number) => Form24qSalaryRow | null, employeeId?: number
): Form16Data {
  const year = incomeTaxYear(fyStartYear)
  const fy = fyFromStartYear(fyStartYear)
  const ids = (db.prepare(
    `SELECT DISTINCT pl.employee_id AS id FROM payroll_lines pl JOIN payroll_runs r ON r.id = pl.run_id JOIN vouchers v ON v.id = r.voucher_id
      WHERE r.month BETWEEN ? AND ? AND ${IN_BOOKS}`
  ).all(fy.from.slice(0, 7), fy.to.slice(0, 7)) as { id: number }[]).map((r) => r.id).filter((id) => employeeId == null || id === employeeId)
  const employees: Form16Employee[] = []
  for (const id of ids) {
    const s = workingsFor(id)
    if (!s) continue
    const emp = db.prepare('SELECT designation FROM employees WHERE id = ?').get(id) as { designation: string | null }
    const quarters = ([1, 2, 3, 4] as const).map((q) => {
      const b = tdsQuarterBounds(fyStartYear, q)
      const r = db.prepare(
        `SELECT COALESCE(SUM(te.base_amount), 0) AS amount, COALESCE(SUM(te.tds_amount), 0) AS tds,
                COALESCE(SUM(CASE WHEN tec.challan_id IS NOT NULL THEN te.tds_amount ELSE 0 END), 0) AS deposited
           FROM tds_entries te JOIN vouchers v ON v.id = te.voucher_id LEFT JOIN tds_entry_challans tec ON tec.entry_id = te.id
          WHERE te.employee_id = ? AND v.date BETWEEN ? AND ? AND ${IN_BOOKS}`
      ).get(id, b.from, b.to) as { amount: number; tds: number; deposited: number }
      return { quarter: q, amountPaise: r.amount, tdsPaise: r.tds, depositedPaise: r.deposited }
    })
    const challans = db.prepare(
      `SELECT c.bsr_code AS bsrCode, c.date, c.challan_no AS challanNo, SUM(te.tds_amount) AS tdsPaise
         FROM tds_entries te JOIN vouchers v ON v.id = te.voucher_id JOIN tds_entry_challans tec ON tec.entry_id = te.id
         JOIN tds_challans c ON c.id = tec.challan_id
        WHERE te.employee_id = ? AND v.date BETWEEN ? AND ? AND ${IN_BOOKS}
        GROUP BY c.id ORDER BY c.date`
    ).all(id, fy.from, fy.to) as Form16Employee['challans']
    employees.push({
      employeeId: id, name: s.employeeName, pan: s.pan, designation: emp?.designation ?? null, address: null,
      periodFrom: s.periodFrom, periodTo: s.periodTo, regime: s.regime, workings: s.workings, quarters, challans,
      tdsDeductedPaise: s.tdsDeductedPaise, refs: year.refs
    })
  }
  return {
    deductor: { name: company.name, address: company.address, pan: company.pan, tan: company.tan },
    fyStartYear,
    // 1961 Act: the assessment year follows the FY; 2025 Act: the "tax year" IS the FY (s.3).
    yearLabel: year.act === '2025'
      ? `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`
      : `${fyStartYear + 1}-${String((fyStartYear + 2) % 100).padStart(2, '0')}`,
    act: year.act,
    formName: year.act === '2025' ? 'Form No. 130' : 'Form No. 16',
    employees: employees.sort((a, b) => a.name.localeCompare(b.name))
  }
}
