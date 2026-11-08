// Worked examples for the payroll statutory engine (WP 3.7). Each block names the provision the
// figures come from (keys as in SOURCES_WP37 / migration 029; all accessed 2026-10-07).
import { describe, expect, it } from 'vitest'
import {
  ageBand, bonus, esiDueDate, gratuity, hraExemption, hraMetroCities, incomeTaxYear, monthlyTds, monthsRemainingInFy,
  pfDueDate, roundTenRupees, salaryWorkings, slabTax, taxOnTotalIncome, tdsDueDate
} from './payrollStatutory'

const R = (rupees: number): number => Math.round(rupees * 100)
const L = (lakh: number): number => R(lakh * 100_000)

describe('rounding', () => {
  it('income-tax amounts: nearest ₹10 (2025 Act s.516)', () => {
    expect(roundTenRupees(R(10_404))).toBe(R(10_400))
    expect(roundTenRupees(R(10_405))).toBe(R(10_410))
  })
})

// The EPF / EPS / EDLI / ESI / professional-tax computation was removed in audit A13b; only the
// due dates old runs' dues are dated by stay.
describe('EPF / ESI due dates (old runs only)', () => {
  it('EPF within 15 days of the close of the month (EPF Scheme 2026 para 20(1)); ESI by the 15th', () => {
    expect(pfDueDate('2025-12')).toBe('2026-01-15')
    expect(esiDueDate('2026-03')).toBe('2026-04-15')
  })
})

describe('income tax — slabs, rebate, surcharge, cess', () => {
  const fy25 = incomeTaxYear(2025)
  const fy26 = incomeTaxYear(2026)
  it('picks the year: FY 2025-26 = 1961 Act s.192; FY 2026-27 = 2025 Act s.392; later years carry forward', () => {
    expect(fy25).toMatchObject({ act: '1961', tdsSection: '192', cessBp: 400 })
    expect(fy26).toMatchObject({ act: '2025', tdsSection: '392' })
    expect(incomeTaxYear(2030).act).toBe('2025')
  })
  it('new regime (s.115BAC(1A) / 2025 s.202(1)): ₹12 lakh fully rebated (s.87A / s.156(2)(a))', () => {
    expect(taxOnTotalIncome(L(12), 'new', 'below60', fy25)).toMatchObject({ taxBeforeRebate: R(60_000), rebate: R(60_000), total: 0 })
  })
  it('marginal relief just above ₹12 lakh: tax limited to the excess (s.156(2)(b))', () => {
    // ₹12,10,000: slab tax 61,500; excess 10,000 → rebate 51,500; + 4% cess = 10,400.
    expect(taxOnTotalIncome(R(12_10_000), 'new', 'below60', fy26)).toMatchObject({ taxBeforeRebate: R(61_500), rebate: R(51_500), cess: R(400), total: R(10_400) })
    expect(taxOnTotalIncome(L(13), 'new', 'below60', fy25)).toMatchObject({ rebate: 0, total: R(78_000) })
  })
  it('new regime ₹24 lakh = ₹3,00,000 + cess; ₹30 lakh = ₹4,80,000 + cess', () => {
    expect(taxOnTotalIncome(L(24), 'new', 'below60', fy25).total).toBe(R(3_12_000))
    expect(taxOnTotalIncome(L(30), 'new', 'below60', fy25).total).toBe(R(4_99_200))
  })
  it('surcharge 10% above ₹50 lakh with marginal relief at the threshold', () => {
    // ₹55 lakh: tax 12,30,000; surcharge 1,23,000 (below the relief cap); cess 4%.
    expect(taxOnTotalIncome(L(55), 'new', 'below60', fy25)).toMatchObject({ surcharge: R(1_23_000), total: R(14_07_120) })
    // ₹50,10,000: tax 10,83,000; capped at tax on ₹50 lakh (10,80,000) + 10,000 → surcharge 7,000.
    expect(taxOnTotalIncome(R(50_10_000), 'new', 'below60', fy25)).toMatchObject({ taxAfterRebate: R(10_83_000), surcharge: R(7_000), total: R(11_33_600) })
  })
  it('old regime: ₹5 lakh rebated (₹12,500); ₹10 lakh = ₹1,12,500 + cess; senior / super-senior slabs (First Schedule Part III Para A)', () => {
    expect(taxOnTotalIncome(L(5), 'old', 'below60', fy25)).toMatchObject({ taxBeforeRebate: R(12_500), rebate: R(12_500), total: 0 })
    expect(taxOnTotalIncome(L(10), 'old', 'below60', fy25).total).toBe(R(1_17_000))
    expect(taxOnTotalIncome(L(10), 'old', 'senior', fy25).total).toBe(R(1_14_400))
    expect(taxOnTotalIncome(L(10), 'old', 'superSenior', fy25).total).toBe(R(1_04_000))
    expect(slabTax(L(15), fy26.regimes.old.slabs.below60)).toBe(R(2_62_500))
  })
})

describe('salary workings and the monthly spread', () => {
  it('new regime ₹15 lakh: standard deduction ₹75,000 → ₹14.25 lakh → ₹97,500; ₹8,125 a month from April', () => {
    const w = salaryWorkings({
      fyStartYear: 2025, regime: 'new', age: 'below60', metro: true, grossPaise: L(15), basicPaise: L(7.5), hraPaise: L(3),
      ptPaise: R(2_500), employeePfPaise: R(21_600), declarations: { '80C': L(1.5), RENT: L(3) }
    })
    expect(w).toMatchObject({ hraExemption: 0, standardDeduction: R(75_000), professionalTax: 0, deductionsTotal: 0, totalIncome: R(14_25_000) })
    expect(w.taxOnIncome.total).toBe(R(97_500))
    expect(monthlyTds(w.taxPayableByEmployer, 0, '2025-04')).toBe(R(8_125))
  })
  it('old regime: HRA exemption, standard deduction ₹50,000, PT, 80C (incl. employee PF) capped, 80D', () => {
    const w = salaryWorkings({
      fyStartYear: 2025, regime: 'old', age: 'below60', metro: true, grossPaise: L(12), basicPaise: L(6), hraPaise: L(2.4),
      ptPaise: R(2_500), employeePfPaise: R(72_000), declarations: { '80C': L(1), '80D': R(25_000), RENT: L(2.4) }
    })
    // HRA: least of 2,40,000; 2,40,000 − 60,000; 50% × 6,00,000 → 1,80,000.
    expect(w.hraExemption).toBe(R(1_80_000))
    expect(w.incomeFromSalary).toBe(R(9_67_500))
    expect(w.deductions.map((d) => d.amount)).toEqual([L(1.5), R(25_000)])
    expect(w.totalIncome).toBe(R(7_92_500))
    expect(w.taxOnIncome.total).toBe(R(73_840))
  })
  it('previous employer (Form 12B / Form 122): salary added, its TDS deducted from what this employer owes', () => {
    const w = salaryWorkings({
      fyStartYear: 2026, regime: 'new', age: 'below60', metro: false, grossPaise: L(10), basicPaise: L(5), hraPaise: 0,
      ptPaise: 0, employeePfPaise: 0, declarations: { PREV_SALARY: L(5), PREV_TDS: R(20_000) }
    })
    expect(w.gross).toBe(L(15))
    expect(w.taxPayableByEmployer).toBe(R(97_500 - 20_000))
  })
  it('catch-up: what is still due is spread over the months left (s.392(5)(c))', () => {
    expect(monthsRemainingInFy('2025-04')).toBe(12)
    expect(monthsRemainingInFy('2026-01')).toBe(3)
    expect(monthsRemainingInFy('2026-03')).toBe(1)
    expect(monthlyTds(R(97_500), R(48_750), '2025-10')).toBe(R(8_125))
    expect(monthlyTds(R(97_500), 0, '2025-10')).toBe(R(16_250))
    expect(monthlyTds(R(97_500), R(1_00_000), '2026-02')).toBe(0)
  })
  it('HRA cities: four to FY 2025-26, eight from FY 2026-27 (Rules 2026 r.279)', () => {
    expect(hraMetroCities(2025)).toHaveLength(4)
    expect(hraMetroCities(2026)).toContain('Bengaluru')
    expect(hraExemption(L(2.4), 0, L(6), true)).toBe(0)
  })
  it('age band on 31 March; deposit by the 7th, March by 30 April (Rules 2026 r.218)', () => {
    expect(ageBand('1965-03-31', 2025)).toBe('senior')
    expect(ageBand('1966-04-01', 2025)).toBe('below60')
    expect(ageBand('1945-01-01', 2025)).toBe('superSenior')
    expect(ageBand(null, 2025)).toBe('below60')
    expect(tdsDueDate('2025-12')).toBe('2026-01-07')
    expect(tdsDueDate('2026-03')).toBe('2026-04-30')
  })
})

describe('gratuity (CoSS s.53) and bonus (Code on Wages s.26) — compute only', () => {
  it('15/26 × wages × years, part year over six months counts; five-year minimum', () => {
    expect(gratuity({ monthlyWagesPaise: R(26_000), years: 10, months: 7 })).toEqual({ eligible: true, serviceYears: 11, amountPaise: R(1_65_000) })
    expect(gratuity({ monthlyWagesPaise: R(26_000), years: 4, months: 11 }).eligible).toBe(false)
    expect(gratuity({ monthlyWagesPaise: R(26_000), years: 2, months: 0, fixedTerm: true }).amountPaise).toBe(R(30_000))
    expect(gratuity({ monthlyWagesPaise: R(5_00_000), years: 30, months: 0 }).amountPaise).toBe(L(20))
  })
  it('8.33% on salary capped at ₹7,000 (or the minimum wage); ineligible above ₹21,000 or under 30 days', () => {
    const year = Array(12).fill(R(10_000))
    expect(bonus({ monthlySalariesPaise: year, workingDays: 250 })).toEqual({ eligible: true, basePaise: R(84_000), amountPaise: R(6_997) })
    expect(bonus({ monthlySalariesPaise: year, workingDays: 250, minimumWagePaise: R(9_000) }).amountPaise).toBe(R(8_996))
    expect(bonus({ monthlySalariesPaise: year, workingDays: 250, rateBp: 2000 }).amountPaise).toBe(R(16_800))
    expect(bonus({ monthlySalariesPaise: year, workingDays: 20 }).eligible).toBe(false)
    expect(bonus({ monthlySalariesPaise: Array(12).fill(R(25_000)), workingDays: 250 }).eligible).toBe(false)
    expect(bonus({ monthlySalariesPaise: [R(1_000)], workingDays: 30 }).amountPaise).toBe(R(100)) // ₹100 minimum
  })
})
