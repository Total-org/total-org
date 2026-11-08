// IPC channels for payroll salary TDS (WP 3.7): tax declarations, the salary TDS dues and
// payments, salary workings, Form 24Q data (served on the TDS screen's Returns tab) and data for
// Form 16. PF / ESI / PT (rates, PT return files, their dues and payments) were removed in audit
// A13b. Registered from ipc.ts with its `handle` (role gate + { ok, data | error } envelope);
// every payload is Zod-parsed here.
import { shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { DB } from './db/connection'
import type { CompanyInfo } from '@shared/domain'
import type { Role } from './services/roles'
import {
  form16InputSchema, payrollFySchema, statutoryPaymentInputSchema, taxDeclarationsSetSchema
} from '@shared/schemas'
import { todayISO } from '@shared/dates'
import { renderForm16Html } from '@shared/print/form16'
import * as st from './services/payrollStatutory'
import * as payroll from './services/payroll'
import { companyExportsDir, slugify } from './paths'
import { plexFontFaceCss } from './services/printFonts'
import { writeExportPdf } from './services/pdf'
import { writeAudit } from './services/audit'

type Handle = (channel: string, fn: (payload: unknown) => unknown, minRole?: Role) => void
interface Company { db: DB; info: CompanyInfo; slug: string }

const idSchema = z.object({ id: z.number().int().positive() })
const fySchema = z.number().int().min(2000).max(2100)
const quarterSchema = z.object({ fyStartYear: fySchema, quarter: z.number().int().min(1).max(4) })

const writeExport = (c: Company, filename: string, text: string, kind: string, detail: Record<string, unknown>): { path: string } => {
  const path = join(companyExportsDir(c.slug), filename)
  writeFileSync(path, text, 'utf8')
  writeAudit(c.db, 'export', 0, 'export', null, { kind, ...detail, path })
  shell.showItemInFolder(path)
  return { path }
}

export function registerPayrollStatutoryIpc(handle: Handle, company: () => Company): void {
  const db = (): DB => company().db

  // Declarations
  handle('payroll:declarations:get', (p) => {
    const { employeeId, fyStartYear } = z.object({ employeeId: z.number().int().positive(), fyStartYear: fySchema }).parse(p)
    return st.getDeclarations(db(), employeeId, fyStartYear)
  }, 'viewer')
  handle('payroll:declarations:set', (p) => st.setDeclarations(db(), taxDeclarationsSetSchema.parse(p)))
  handle('payroll:workings', (p) => {
    const { employeeId, fyStartYear } = z.object({ employeeId: z.number().int().positive(), fyStartYear: fySchema }).parse(p)
    return payroll.actualWorkings(db(), employeeId, fyStartYear)
  }, 'viewer')

  // Salary TDS dues + payments (old books' PF / ESI / PT rows stay in the tables — the cash
  // forecast reads them — but are no longer listed here).
  handle('payroll:dues', (p) => st.statutoryDues(db(), payrollFySchema.parse(p).fyStartYear, todayISO()).filter((d) => d.kind === 'tds'), 'viewer')
  handle('payroll:payments:list', (p) => st.listStatutoryPayments(db(), payrollFySchema.parse(p).fyStartYear).filter((r) => r.kind === 'tds'), 'viewer')
  handle('payroll:payments:record', (p) => st.recordStatutoryPayment(db(), statutoryPaymentInputSchema.parse(p)))
  handle('payroll:payments:delete', (p) => {
    st.deleteStatutoryPayment(db(), idSchema.parse(p).id)
    return null
  })

  // Form 24Q (TDS screen → Returns)
  const workingsFor = (d: DB, fy: number) => (employeeId: number) => payroll.actualWorkings(d, employeeId, fy)
  handle('tds:form24q', (p) => {
    const { fyStartYear, quarter } = quarterSchema.parse(p)
    return st.form24qData(db(), fyStartYear, quarter as 1 | 2 | 3 | 4, workingsFor(db(), fyStartYear))
  }, 'viewer')
  handle('tds:form24qCsv', (p) => {
    const { fyStartYear, quarter } = quarterSchema.parse(p)
    const c = company()
    const data = st.form24qData(c.db, fyStartYear, quarter as 1 | 2 | 3 | 4, workingsFor(c.db, fyStartYear))
    return writeExport(c, `form24q-data-${fyStartYear}-Q${quarter}.csv`, st.form24qCsv(data), 'tds_24q', { fyStartYear, quarter })
  }, 'viewer')

  // Data for Form 16 (Part B workings + Part A summary), through the print path
  handle('payroll:form16', (p) => {
    const { fyStartYear, employeeId } = form16InputSchema.parse(p)
    const c = company()
    return st.form16Data(c.db, c.info, fyStartYear, workingsFor(c.db, fyStartYear), employeeId)
  }, 'viewer')
  handle('payroll:form16Pdf', async (p) => {
    const { fyStartYear, employeeId } = form16InputSchema.parse(p)
    const c = company()
    const data = st.form16Data(c.db, c.info, fyStartYear, workingsFor(c.db, fyStartYear), employeeId)
    if (data.employees.length === 0) throw new Error('No posted pay runs in that year')
    const html = renderForm16Html(data, plexFontFaceCss)
    const who = employeeId != null && data.employees[0] ? `-${slugify(data.employees[0].name)}` : ''
    const path = await writeExportPdf(c.slug, `form16-data-${fyStartYear}${who}.pdf`, html, { pageSize: 'A4' })
    writeAudit(c.db, 'export', 0, 'export', null, { kind: 'payroll_form16', fyStartYear, employeeId: employeeId ?? null, path })
    shell.showItemInFolder(path)
    return { path }
  }, 'viewer')
}
