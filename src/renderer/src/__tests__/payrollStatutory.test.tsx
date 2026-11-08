// WP 3.7 — payroll salary TDS screens (PF / ESI / PT removed in audit A13b): the Salary TDS tab
// (TDS dues with status, Pay… books a payment with the right payload, Form 16 data), no PF / ESI /
// PT tab, column or field any more, the declarations editor (saves one FY), the pay-run preview's
// TDS with the workings, and Form 24Q on the TDS Returns tab.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Employee, PayrollLine } from '@shared/domain'
import type { Form16Data, Form24qData, StatutoryDueRow } from '@shared/payrollStatutoryTypes'
import { useNav, useSession } from '../state/stores'
import { PayrollScreen } from '../screens/Payroll'
import { Form24qPanel } from '../screens/tds/Form24qPanel'

const invoke = vi.fn()
let handlers: Record<string, (payload: unknown) => unknown> = {}
const calls = (channel: string): unknown[] => invoke.mock.calls.filter((c) => c[0] === channel).map((c) => c[1])

function renderScreen(ui: React.JSX.Element): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
const bodyRows = (area: string): HTMLElement[] =>
  Array.from(screen.getByTestId(`rows-${area}`).querySelectorAll<HTMLElement>('tr.dt-row'))

const emp: Employee = {
  id: 1, name: 'Anil Mehta', code: 'E1', designation: 'Manager', joined: null, pan: 'ABCPM1234K', uan: '100100100100', esicNo: null,
  basic: 75_000_00, hra: 30_000_00, special: 45_000_00, pfEnabled: true, esiEnabled: true, ptEnabled: true, ptState: 'MH', active: true,
  pfNumber: null, gender: 'male', dob: null, taxRegime: 'new', vpfRateBp: 0, pfOnFullWage: false, epsEligible: true, disabled: false, metro: false, tdsEnabled: true
}

const due = (over: Partial<StatutoryDueRow>): StatutoryDueRow => ({
  key: 'tds:2026-07', kind: 'tds', period: '2026-07', state: null, runId: 5, voucherId: 50, employees: 1,
  employeePaise: 8_233_00, employerPaise: 0, payablePaise: 8_233_00, paidPaise: 0, outstandingPaise: 8_233_00,
  dueDate: '2026-08-07', status: 'overdue', ledgerId: 9, ...over
})

beforeEach(() => {
  localStorage.clear()
  handlers = {
    'payroll:employees:list': () => [emp],
    'payroll:runs': () => [],
    'payroll:preview': () => [],
    'master:ledgers:list': () => [{ id: 31, name: 'HDFC Current', groupId: 3 }],
    'master:groups:list': () => [{ id: 3, name: 'Bank Accounts', parentId: null, nature: 'asset', affectsGrossProfit: false, isSystem: true }]
  }
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, payload?: unknown) => {
    const h = handlers[channel]
    if (!h) return { ok: false, error: `unmocked channel ${channel}` }
    return { ok: true, data: h(payload) }
  })
  window.total = { platform: 'test', invoke }
  act(() => {
    useSession.setState({ slug: 'pay-co', from: '2026-04-01', to: '2027-03-31' })
    useNav.setState({ stack: [{ name: 'payroll' }] })
  })
})
afterEach(() => cleanup())

describe('Salary TDS tab', () => {
  beforeEach(() => {
    handlers['payroll:dues'] = () => [
      due({ key: 'tds:2026-06', period: '2026-06', outstandingPaise: 0, paidPaise: 8_233_00, status: 'paid', dueDate: '2026-07-07' }),
      due({})
    ]
    handlers['payroll:payments:list'] = () => []
    handlers['payroll:form16'] = (): Form16Data => ({ deductor: { name: 'Co', address: '', pan: null, tan: null }, fyStartYear: 2026, yearLabel: '2026-27', act: '2025', formName: 'Form No. 130', employees: [] })
    handlers['payroll:payments:record'] = () => ({ id: 1 })
  })

  it('the tabs are Employees, Pay runs and Salary TDS — no PF / ESI / PT tabs', async () => {
    renderScreen(<PayrollScreen />)
    await screen.findByTestId('tab-payroll-tds')
    expect(screen.getByTestId('tab-payroll-tds').textContent).toBe('Salary TDS')
    for (const id of ['tab-payroll-statutory', 'tab-payroll-rates']) expect(screen.queryByTestId(id), id).toBeNull()
  })

  it('lists the TDS dues with status badges and totals; Pay… posts a TDS payment with the challan', async () => {
    renderScreen(<PayrollScreen />)
    fireEvent.click(await screen.findByTestId('tab-payroll-tds'))
    await waitFor(() => expect(bodyRows('payroll-dues')).toHaveLength(2))
    expect(screen.getByTestId('due-status-tds:2026-07').textContent).toBe('Overdue')
    expect(screen.getByTestId('due-status-tds:2026-06').textContent).toBe('Paid')
    expect(document.getElementById('payroll-due-tds-value')!.textContent).toContain('8,233.00')
    expect(screen.getByText(/Data for Form No\. 130/)).toBeTruthy()
    for (const id of ['payroll-due-pf', 'payroll-due-esi', 'payroll-due-pt']) expect(screen.queryByTestId(id), id).toBeNull()

    fireEvent.click(screen.getByTestId('btn-due-pay-tds:2026-07'))
    fireEvent.change(await screen.findByTestId('input-due-bsr'), { target: { value: '0510308' } })
    fireEvent.change(screen.getByTestId('input-due-challan'), { target: { value: '00042' } })
    await waitFor(() => expect((screen.getByTestId('input-due-bank') as HTMLSelectElement).value).toBe('31'))
    fireEvent.click(screen.getByTestId('btn-due-save'))
    await waitFor(() => expect(calls('payroll:payments:record')).toHaveLength(1))
    expect(calls('payroll:payments:record')[0]).toMatchObject({
      kind: 'tds', period: '2026-07', state: null, amountPaise: 8_233_00, bankLedgerId: 31, bsrCode: '0510308', challanNo: '00042'
    })
  })

  it('the gratuity helper computes 15/26 × wages × years', async () => {
    renderScreen(<PayrollScreen />)
    fireEvent.click(await screen.findByTestId('tab-payroll-tds'))
    // Defaults: ₹30,000 × 15 / 26 × 7 years = ₹1,21,153.85 → ₹1,21,154.
    expect((await screen.findByTestId('gratuity-result')).textContent).toContain('1,21,154.00')
  })
})

describe('the employee form (PF / ESI / PT removed)', () => {
  it('asks only for salary and salary TDS facts, and sends no PF / ESI / PT field (an edit keeps the stored ones)', async () => {
    handlers['payroll:employees:save'] = () => emp
    renderScreen(<PayrollScreen />)
    await waitFor(() => expect(bodyRows('payroll-employees')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('btn-payroll-edit-employee'))
    await screen.findByTestId('input-employee-regime')
    for (const id of ['input-employee-pf-number', 'input-employee-esic', 'input-employee-pt-state', 'input-employee-gender', 'input-employee-vpf']) expect(screen.queryByTestId(id), id).toBeNull()
    for (const label of ['EPF', 'ESI', 'Professional tax', 'UAN']) expect(screen.queryByLabelText(label), label).toBeNull()
    fireEvent.click(screen.getByTestId('btn-payroll-save-employee'))
    await waitFor(() => expect(calls('payroll:employees:save')).toHaveLength(1))
    const { data } = calls('payroll:employees:save')[0] as { data: Record<string, unknown> }
    for (const k of ['pfEnabled', 'esiEnabled', 'ptEnabled', 'ptState', 'uan', 'esicNo', 'pfNumber', 'gender', 'vpfRateBp', 'pfOnFullWage', 'epsEligible', 'disabled']) expect(k in data, k).toBe(false)
    expect(data).toMatchObject({ name: 'Anil Mehta', basic: 75_000_00, taxRegime: 'new', tdsEnabled: true })
  })
})

describe('declarations and the pay-run preview', () => {
  it('saves the declarations for the chosen FY', async () => {
    handlers['payroll:declarations:get'] = () => [{ section: '80C', label: '80C', amountPaise: 50_000_00, proofReceived: false }]
    handlers['payroll:declarations:set'] = () => []
    renderScreen(<PayrollScreen />)
    await waitFor(() => expect(bodyRows('payroll-employees')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('btn-payroll-declarations'))
    const rent = await screen.findByTestId('input-decl-RENT')
    fireEvent.change(rent, { target: { value: '2,40,000' } })
    fireEvent.click(screen.getByTestId('btn-payroll-save-declarations'))
    await waitFor(() => expect(calls('payroll:declarations:set')).toHaveLength(1))
    const sent = calls('payroll:declarations:set')[0] as { employeeId: number; rows: { section: string; amountPaise: number }[] }
    expect(sent.employeeId).toBe(1)
    expect(sent.rows).toEqual([
      { section: '80C', amountPaise: 50_000_00, proofReceived: false },
      { section: 'RENT', amountPaise: 2_40_000_00, proofReceived: false }
    ])
  })

  it('preview shows gross, deductions, TDS and net (no PF / ESI / PT columns); the TDS figure opens its workings', async () => {
    const line: Omit<PayrollLine, 'id'> = {
      employeeId: 1, employeeName: 'Anil Mehta', payableDays: 31, monthDays: 31, basic: 75_000_00, hra: 30_000_00, special: 45_000_00,
      otherEarnings: 0, otherDeductions: 500_00, gross: 1_50_000_00, pfEmp: 0, pfEr: 0, epsEr: 0, pfAdmin: 0, edli: 0,
      esiEmp: 0, esiEr: 0, pt: 0, net: 1_41_267_00, headAmounts: [], vpf: 0, epfWage: 0, epsWage: 0, edliWage: 0,
      esiCovered: false, esiWage: 0, tds: 8_233_00,
      tdsWorkings: { regime: 'new', act: '2025', gross: 13_50_000_00, hraExemption: 0, standardDeduction: 75_000_00, professionalTax: 0, otherIncome: 0, housePropertyLoss: 0, deductionsTotal: 0, totalIncome: 12_75_000_00, annualTax: 74_100_00, previousEmployerTds: 0, deductedBefore: 0, monthsRemaining: 9 }
    }
    handlers['payroll:preview'] = () => [line]
    renderScreen(<PayrollScreen />)
    fireEvent.click(await screen.findByTestId('tab-payroll-runs'))
    const btn = await screen.findByTestId('btn-payroll-tds-workings')
    expect(btn.textContent).toContain('8,233.00')
    const row = screen.getByTestId('rows-payroll-preview').querySelector('tr[data-row-id="1"]')!
    // 1,50,000 − canteen 500 − TDS 8,233 = 1,41,267
    expect([...row.querySelectorAll('td')].slice(2).map((td) => td.textContent)).toEqual(['1,50,000.00', '500.00', '8,233.00', '1,41,267.00'])
    const heads = [...screen.getByTestId('rows-payroll-preview').closest('table')!.querySelectorAll('th')].map((th) => th.textContent)
    expect(heads).toEqual(['Employee', 'Days', 'Gross', 'Deductions', 'TDS', 'Net pay'])
    fireEvent.click(btn)
    const w = await screen.findByTestId('payroll-tds-workings')
    expect(w.textContent).toContain('74,100.00')
    expect(w.textContent).toContain('Income-tax Act 2025 · s.392')
  })
})

describe('Form 24Q panel', () => {
  it('lists salary TDS rows with the return section code and exports the CSV', async () => {
    const data: Form24qData = {
      fyStartYear: 2026, quarter: 2, layout: 'form138',
      deductees: [{ serial: 1, entryId: 3, voucherId: 50, employeeId: 1, employeeName: 'Anil Mehta', pan: 'ABCPM1234K', sectionCode: '1002', paymentDate: '2026-07-31', amountPaise: 1_50_000_00, tdsPaise: 8_233_00, deductionDate: '2026-07-31', challanSerial: null, bsrCode: null, challanDate: null, challanNo: null }],
      challans: [], salaries: [], totals: { amountPaise: 1_50_000_00, tdsPaise: 8_233_00, depositedPaise: 0 }
    }
    handlers['tds:form24q'] = () => data
    handlers['tds:form24qCsv'] = () => ({ path: '/x/form24q-data-2026-Q2.csv' })
    renderScreen(<Form24qPanel fyStartYear={2026} quarter={2} label="Q2 FY2026-27" />)
    await waitFor(() => expect(bodyRows('tds-24q')).toHaveLength(1))
    expect(bodyRows('tds-24q')[0]!.textContent).toContain('1002')
    expect(screen.getByTestId('tds-24q-layout').textContent).toContain('Form 138')
    fireEvent.click(screen.getByTestId('btn-tds-24q-export'))
    await waitFor(() => expect(calls('tds:form24qCsv')).toEqual([{ fyStartYear: 2026, quarter: 2 }]))
  })
})
