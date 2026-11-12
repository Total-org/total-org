// IPC channels for payroll (employees, pay heads, runs). Registered from ipc.ts with its `handle` (role
// gate + { ok, data | error } envelope); every payload is Zod-parsed here, every write channel is mapped in
// auditCoverage.ts. Split out of ipc.ts by audit A12 (HEALTH-4) — the handlers were moved, not rewritten
// (scripts/ipc-handlers-diff.mjs compares them with origin/main).
import { shell } from 'electron'
import { z } from 'zod'
import * as payroll from './services/payroll'
import { employeeInputSchema, payHeadInputSchema, employeeHeadsSetSchema } from '@shared/schemas'
import { auditExport, idSchema, type IpcContext, type IpcHandle } from './ipcCommon'

export function registerPayrollIpc(handle: IpcHandle, { requireCompany }: IpcContext): void {
  // ---------- payroll ----------
  const daysSchema = z.array(z.object({ employeeId: z.number().int().positive(), payableDays: z.number().min(0).max(31) }))
  const monthSchema = z.string().regex(/^\d{4}-\d{2}$/)
  handle('payroll:employees:list', () => payroll.listEmployees(requireCompany().db), 'viewer')
  handle('payroll:employees:save', (p) => {
    const { data, id } = z.object({ data: employeeInputSchema, id: z.number().int().positive().optional() }).parse(p)
    return payroll.saveEmployee(requireCompany().db, data, id)
  })
  handle('payroll:employees:delete', (p) => payroll.deleteEmployee(requireCompany().db, idSchema.parse(p).id))
  handle('payroll:preview', (p) => {
    const { month, days } = z.object({ month: monthSchema, days: daysSchema }).parse(p)
    return payroll.previewRun(requireCompany().db, month, days)
  })
  handle('payroll:commit', (p) => {
    const { month, days } = z.object({ month: monthSchema, days: daysSchema }).parse(p)
    return payroll.commitRun(requireCompany().db, month, days)
  })
  handle('payroll:runs', () => payroll.listRuns(requireCompany().db), 'viewer')
  handle('payroll:deleteRun', (p) => payroll.deleteRun(requireCompany().db, idSchema.parse(p).id))
  handle('payroll:payslip', async (p) => {
    const { runId, employeeId } = z.object({ runId: z.number().int().positive(), employeeId: z.number().int().positive() }).parse(p)
    const c = requireCompany()
    const path = await payroll.payslipPdf(c.db, c.info, c.slug, runId, employeeId)
    auditExport(c.db, 'payslip', { runId, employeeId, path })
    void shell.openPath(path)
    return { path }
  })
  // pay heads + per-employee assignments (lane Y, task Y1)
  handle('payroll:heads:list', () => payroll.listPayHeads(requireCompany().db), 'viewer')
  handle('payroll:heads:save', (p) => {
    const { data, id } = z.object({ data: payHeadInputSchema, id: z.number().int().positive().optional() }).parse(p)
    return payroll.savePayHead(requireCompany().db, data, id)
  })
  handle('payroll:heads:delete', (p) => {
    payroll.deletePayHead(requireCompany().db, idSchema.parse(p).id)
    return null
  })
  handle('payroll:employeeHeads:get', (p) => {
    const { employeeId } = z.object({ employeeId: z.number().int().positive() }).parse(p)
    return payroll.getEmployeeHeads(requireCompany().db, employeeId)
  }, 'viewer')
  handle('payroll:employeeHeads:set', (p) => payroll.setEmployeeHeads(requireCompany().db, employeeHeadsSetSchema.parse(p)))
  // PF ECR / ESI upload / PT summary + CSV went with payroll PF / ESI / PT (audit A13b).
}
