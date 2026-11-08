// Typed client for payroll salary TDS (WP 3.7) — the channels in src/main/ipcPayrollStatutory.ts
// (PF / ESI / PT removed in audit A13b bar the old dues still outstanding). Kept beside client.ts so that surface stays in one place.
import { call } from './client'
import type { Form16Data, Form24qData, Form24qSalaryRow, StatutoryDueRow, StatutoryPayment, TaxDeclaration } from '@shared/payrollStatutoryTypes'
import type { StatutoryPaymentInput, TaxDeclarationsSetInput } from '@shared/schemas'

export type { Form16Data, Form24qData, Form24qSalaryRow, StatutoryDueRow, StatutoryPayment, TaxDeclaration } from '@shared/payrollStatutoryTypes'

export const statApi = {
  declarations: (employeeId: number, fyStartYear: number) => call<TaxDeclaration[]>('payroll:declarations:get', { employeeId, fyStartYear }),
  setDeclarations: (input: TaxDeclarationsSetInput) => call<TaxDeclaration[]>('payroll:declarations:set', input),
  workings: (employeeId: number, fyStartYear: number) => call<Form24qSalaryRow | null>('payroll:workings', { employeeId, fyStartYear }),

  /** Salary TDS dues and payments, plus the old PF / ESI / PT dues still outstanding (`kind`) and
   *  their payments — the tab shows those under "Left from before". */
  dues: (fyStartYear: number) => call<StatutoryDueRow[]>('payroll:dues', { fyStartYear }),
  payments: (fyStartYear: number) => call<StatutoryPayment[]>('payroll:payments:list', { fyStartYear }),
  /** Wage months an (old) pay run deducted PF / ESI in (the compliance calendar's PF / ESI dates). */
  deductionMonths: () => call<{ pf: string[]; esi: string[] }>('payroll:deductionMonths'),
  recordPayment: (input: StatutoryPaymentInput) => call<StatutoryPayment>('payroll:payments:record', input),
  deletePayment: (id: number) => call<null>('payroll:payments:delete', { id }),

  form24q: (fyStartYear: number, quarter: 1 | 2 | 3 | 4) => call<Form24qData>('tds:form24q', { fyStartYear, quarter }),
  form24qCsv: (fyStartYear: number, quarter: 1 | 2 | 3 | 4) => call<{ path: string }>('tds:form24qCsv', { fyStartYear, quarter }),
  form16: (fyStartYear: number, employeeId?: number) => call<Form16Data>('payroll:form16', { fyStartYear, employeeId }),
  form16Pdf: (fyStartYear: number, employeeId?: number) => call<{ path: string }>('payroll:form16Pdf', { fyStartYear, employeeId })
}
