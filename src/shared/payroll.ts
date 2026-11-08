/**
 * Payroll computation. All amounts integer paise per month. Salary TDS is the service's
 * (payrollStatutory.ts holds the cited maths, applied by `withTds`).
 *
 * PF / ESI / professional tax were removed for good (audit A13b, owner 8 Nov 2026): a pay run no
 * longer deducts or books any of them, whatever an employee's stored flags say. The statutory
 * fields of a computation stay in its shape (always 0) because a posted line keeps the figures
 * old runs stored — those are read back exactly as saved (services/payroll.ts getRun).
 */
import { roundPaise } from './money'

/** The PT states an employee record could name (employees.pt_state). Kept only so old payloads
 *  and imports that carry one still parse — nothing computes professional tax any more. */
export const PT_STATES = ['MH', 'KA', 'WB', 'TN', 'GJ', 'AP', 'TS', 'MP'] as const
export type PtState = (typeof PT_STATES)[number]

// ---------- pay heads ----------

export interface PayHeadSpec {
  name: string
  kind: 'earning' | 'deduction'
  /** 'flat': `value` is monthly paise. 'percent_of_basic': `value` is percent × 100 (4000 = 40%). */
  calc: 'flat' | 'percent_of_basic'
  value: number
}

export interface PayHeadAmount {
  name: string
  kind: 'earning' | 'deduction'
  /** Prorated paise actually paid/deducted this month. */
  amount: number
}

export interface EmployeePayInput {
  basic: number
  hra: number
  special: number
  /**
   * Optional pay-head list. When present it fully defines earnings/deductions: the head named
   * 'Basic' is the basic (falling back to `basic` when absent), 'HRA'/'Special Allowance' map
   * onto the legacy hra/special fields, every other earning lands in otherEarnings and every
   * deduction head in otherDeductions. When absent, the legacy basic/hra/special columns drive
   * the computation unchanged.
   */
  heads?: PayHeadSpec[]
}

export interface PayComputation {
  basic: number
  hra: number
  special: number
  /** Custom earning heads beyond Basic/HRA/Special (prorated paise). */
  otherEarnings: number
  /** Custom deduction heads (canteen, advances, ...) — subtracted from net. */
  otherDeductions: number
  gross: number
  // PF / ESI / PT — always 0 since audit A13b (the shape of a stored line, see the file note).
  pfEmp: number
  vpf: number
  pfEr: number
  epfWage: number
  epsWage: number
  edliWage: number
  epsEr: number
  epfEr: number
  pfAdmin: number
  edli: number
  esiEmp: number
  esiEr: number
  esiCovered: boolean
  esiWage: number
  pt: number
  /** Salary TDS (s.192 / 2025 s.392), set by withTds. */
  tds: number
  net: number
  employerCost: number
  /** Per-head prorated amounts — empty for the legacy (no-heads) shape. */
  headAmounts: PayHeadAmount[]
}

const nameIs = (head: PayHeadSpec, n: string): boolean => head.name.trim().toLowerCase() === n

export function computeMonthlyPay(e: EmployeePayInput, payableDays: number, monthDays: number): PayComputation {
  if (monthDays <= 0 || payableDays < 0) throw new Error('Invalid attendance days')
  const ratio = Math.min(1, payableDays / monthDays)

  let basicFull: number
  let basic: number
  let hra = 0
  let special = 0
  let otherEarnings = 0
  let otherDeductions = 0
  const headAmounts: PayHeadAmount[] = []

  if (e.heads && e.heads.length > 0) {
    const basicHead = e.heads.find((h) => h.kind === 'earning' && nameIs(h, 'basic'))
    basicFull = basicHead ? basicHead.value : e.basic
    basic = roundPaise(basicFull * ratio)
    for (const h of e.heads) {
      if (h === basicHead) {
        headAmounts.push({ name: h.name, kind: h.kind, amount: basic })
        continue
      }
      const amount = h.calc === 'flat' ? roundPaise(h.value * ratio) : roundPaise((basic * h.value) / 10000)
      headAmounts.push({ name: h.name, kind: h.kind, amount })
      if (h.kind === 'earning') {
        if (nameIs(h, 'hra')) hra += amount
        else if (nameIs(h, 'special allowance') || nameIs(h, 'special')) special += amount
        else otherEarnings += amount
      } else {
        otherDeductions += amount
      }
    }
  } else {
    basic = roundPaise(e.basic * ratio)
    hra = roundPaise(e.hra * ratio)
    special = roundPaise(e.special * ratio)
  }

  const gross = basic + hra + special + otherEarnings
  return {
    basic, hra, special, otherEarnings, otherDeductions, gross,
    pfEmp: 0, vpf: 0, pfEr: 0, epsEr: 0, epfEr: 0, pfAdmin: 0, edli: 0, epfWage: 0, epsWage: 0, edliWage: 0,
    esiEmp: 0, esiEr: 0, esiCovered: false, esiWage: 0, pt: 0, tds: 0,
    net: gross - otherDeductions,
    employerCost: gross,
    headAmounts
  }
}

/** Apply this month's salary TDS (computed by the service from the year's projection). */
export function withTds(pay: PayComputation, tdsPaise: number): PayComputation {
  const tds = Math.max(0, Math.min(tdsPaise, pay.net + pay.tds))
  return { ...pay, tds, net: pay.net + pay.tds - tds }
}

/** Calendar days in 'YYYY-MM'. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
