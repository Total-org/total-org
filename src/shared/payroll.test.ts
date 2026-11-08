import { describe, it, expect } from 'vitest'
import { computeMonthlyPay, withTds, type EmployeePayInput, type PayComputation, type PayHeadSpec } from './payroll'

const legacyEmp: EmployeePayInput = { basic: 20_000_00, hra: 8_000_00, special: 4_000_00 }

/** The same employee expressed as seeded pay heads (what migration 015 produces). */
const seededHeads: PayHeadSpec[] = [
  { name: 'Basic', kind: 'earning', calc: 'flat', value: 20_000_00 },
  { name: 'HRA', kind: 'earning', calc: 'flat', value: 8_000_00 },
  { name: 'Special Allowance', kind: 'earning', calc: 'flat', value: 4_000_00 }
]

const stripHeads = (p: PayComputation): Omit<PayComputation, 'headAmounts'> => {
  const { headAmounts: _heads, ...rest } = p
  return rest
}

const NO_STATUTORY = {
  pfEmp: 0, vpf: 0, pfEr: 0, epsEr: 0, epfEr: 0, pfAdmin: 0, edli: 0, epfWage: 0, epsWage: 0, edliWage: 0,
  esiEmp: 0, esiEr: 0, esiCovered: false, esiWage: 0, pt: 0
}

describe('pay heads backward compatibility', () => {
  it('seeded Basic/HRA/Special heads give the same result as the legacy shape', () => {
    const withHeads: EmployeePayInput = { ...legacyEmp, heads: seededHeads }
    for (const [payable, monthDays] of [[31, 31], [15.5, 31], [29, 30], [0, 30], [26, 31]] as const) {
      const a = computeMonthlyPay(legacyEmp, payable, monthDays)
      const b = computeMonthlyPay(withHeads, payable, monthDays)
      expect(stripHeads(b)).toEqual(stripHeads(a))
    }
  })

  it('a full month: gross = net = employer cost, no PF / ESI / PT (removed in audit A13b)', () => {
    // 20,000 + 8,000 + 4,000 = 32,000; nothing is deducted any more.
    const p = computeMonthlyPay(legacyEmp, 31, 31)
    expect(p).toMatchObject({ gross: 32_000_00, net: 32_000_00, employerCost: 32_000_00, otherEarnings: 0, otherDeductions: 0, tds: 0, ...NO_STATUTORY })
    expect(p.headAmounts).toEqual([])
  })

  it('a low wage (once ESI-covered) still deducts nothing', () => {
    const p = computeMonthlyPay({ basic: 12_000_00, hra: 4_000_00, special: 2_000_00 }, 30, 30)
    expect(p).toMatchObject({ gross: 18_000_00, net: 18_000_00, ...NO_STATUTORY })
  })

  it('computes custom flat + percent-of-basic earnings and flat deductions', () => {
    const emp: EmployeePayInput = {
      basic: 10_000_00, hra: 0, special: 0,
      heads: [
        { name: 'Basic', kind: 'earning', calc: 'flat', value: 10_000_00 },
        { name: 'Conveyance', kind: 'earning', calc: 'flat', value: 1_600_00 },
        { name: 'Performance Bonus', kind: 'earning', calc: 'percent_of_basic', value: 1000 }, // 10%
        { name: 'Canteen', kind: 'deduction', calc: 'flat', value: 500_00 }
      ]
    }
    const p = computeMonthlyPay(emp, 30, 30)
    expect(p.basic).toBe(10_000_00)
    expect(p.otherEarnings).toBe(1_600_00 + 1_000_00)
    expect(p.otherDeductions).toBe(500_00)
    expect(p.gross).toBe(12_600_00)
    // 12,600 − canteen 500 = 12,100
    expect(p.net).toBe(12_100_00)
    expect(p).toMatchObject(NO_STATUTORY)
    expect(p.headAmounts).toEqual([
      { name: 'Basic', kind: 'earning', amount: 10_000_00 },
      { name: 'Conveyance', kind: 'earning', amount: 1_600_00 },
      { name: 'Performance Bonus', kind: 'earning', amount: 1_000_00 },
      { name: 'Canteen', kind: 'deduction', amount: 500_00 }
    ])
  })

  it('prorates flat heads by attendance and percent heads off the prorated basic', () => {
    const emp: EmployeePayInput = {
      basic: 10_000_00, hra: 0, special: 0,
      heads: [
        { name: 'Basic', kind: 'earning', calc: 'flat', value: 10_000_00 },
        { name: 'Bonus', kind: 'earning', calc: 'percent_of_basic', value: 2000 } // 20%
      ]
    }
    const p = computeMonthlyPay(emp, 15, 30)
    expect(p.basic).toBe(5_000_00)
    expect(p.otherEarnings).toBe(1_000_00) // 20% of prorated basic
    expect(p.gross).toBe(6_000_00)
  })

  it('salary TDS comes off net, never past it', () => {
    const p = computeMonthlyPay(legacyEmp, 31, 31)
    expect(withTds(p, 2_500_00)).toMatchObject({ tds: 2_500_00, net: 29_500_00 })
    expect(withTds(p, 40_000_00)).toMatchObject({ tds: 32_000_00, net: 0 })
  })
})
