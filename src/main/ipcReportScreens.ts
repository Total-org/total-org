// IPC channels for reports (TB, P&L, BS, registers …), analysis, intelligence, report print / export.
// Registered from ipc.ts with its `handle` (role gate + { ok, data | error } envelope); every payload is
// Zod-parsed here, every write channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12
// (HEALTH-4) — the handlers were moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with
// origin/main).
import { writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { latestBackupCheck } from './services/backupVerify'
import { redactDashboard, redactDashboardSeries, redactHome } from '@shared/profitRedaction'
import { listBackupsIn } from './db/backup'
import { companyBackupsDir, companyExportsDir } from './paths'
import { exportCsvSchema, isoDate, periodSchema, reportPdfSchema } from '@shared/schemas'
import { todayISO } from '@shared/dates'
import * as reports from './services/reports'
import * as dashboard from './services/dashboard'
import { homeAsOn, simpleHome, simpleHomeAttention } from './services/simpleHome'
import * as intel from './services/intel'
import * as analysis from './services/analysis'
import { writeExportPdf } from './services/pdf'
import { reportHtml } from './services/reportHtml'
import { auditExport, type IpcContext, type IpcHandle } from './ipcCommon'

export function registerReportScreensIpc(handle: IpcHandle, { requireCompany, canSeeProfitNow }: IpcContext): void {
  // ---------- reports ----------
  handle('report:dayBook', (p) => {
    const { from, to, includeOutOfBooks } = periodSchema
      .extend({ includeOutOfBooks: z.boolean().optional() })
      .parse(p)
    return reports.dayBook(requireCompany().db, from, to, { includeOutOfBooks })
  }, 'viewer')
  handle('report:ledger', (p) => {
    const { ledgerId, from, to, groupBy } = periodSchema
      .extend({ ledgerId: z.number().int().positive(), groupBy: z.enum(['month']).optional() })
      .parse(p)
    return reports.ledgerStatement(requireCompany().db, ledgerId, from, to, groupBy)
  }, 'viewer')
  handle('report:trialBalance', (p) => {
    const { asOn } = z.object({ asOn: z.string() }).parse(p)
    // WP 7.2: without canSeeProfit the P&L ledgers, the computed P&L row and the totals go.
    return reports.trialBalanceFor(requireCompany().db, asOn, canSeeProfitNow())
  }, 'viewer')
  handle('report:profitLoss', (p) => {
    const { from, to, comparePrior } = periodSchema.extend({ comparePrior: z.boolean().optional() }).parse(p)
    return reports.profitAndLoss(requireCompany().db, from, to, comparePrior ? { comparePrior } : undefined)
  }, 'viewer')
  handle('report:balanceSheet', (p) => {
    const { asOn, comparePrior } = z.object({ asOn: z.string(), comparePrior: z.boolean().optional() }).parse(p)
    const c = requireCompany()
    return reports.balanceSheet(c.db, `${c.info.booksFrom}-04-01`, asOn, comparePrior)
  }, 'viewer')
  handle('report:dashboard', (p) => {
    const { today, fyFrom } = z.object({ today: z.string(), fyFrom: z.string() }).parse(p)
    const d = reports.dashboard(requireCompany().db, today, fyFrom)
    return canSeeProfitNow() ? d : redactDashboard(d)
  }, 'viewer')
  handle('report:dashboardSeries', (p) => {
    const { today, from, to } = periodSchema.extend({ today: isoDate }).refine((v) => v.from <= v.to, 'from must be on or before to').parse(p)
    const c = requireCompany()
    // Backup status comes from the backups folder (the service itself never touches files).
    const backups = listBackupsIn(companyBackupsDir(c.slug))
    const d = dashboard.dashboardSeries(c.db, c.info, { today, from, to, backups })
    return canSeeProfitNow() ? d : redactDashboardSeries(d)
  }, 'viewer')
  // Launch to Home: the accountant Gateway's four reads (report:dashboardSeries, report:dashboard,
  // payables:msmeDue, report:dashboardPromised) in ONE round trip and one read transaction — each
  // part exactly its channel's output (same redaction), a failing part fails only its card. The
  // four channels stay for their other callers.
  handle('dashboard:all', (p) => {
    const { today, from, to, parties } = z
      .object({ today: isoDate, from: isoDate, to: isoDate, parties: z.boolean().optional() })
      .strict()
      .refine((v) => v.from <= v.to, 'from must be on or before to')
      .parse(p)
    const c = requireCompany()
    const all = dashboard.dashboardAll(c.db, c.info, { today, from, to, parties, backups: listBackupsIn(companyBackupsDir(c.slug)) })
    if (canSeeProfitNow()) return all
    return {
      ...all,
      series: all.series.ok ? { ok: true as const, data: redactDashboardSeries(all.series.data) } : all.series,
      dashboard: all.dashboard.ok ? { ok: true as const, data: redactDashboard(all.dashboard.data) } : all.dashboard
    }
  }, 'viewer')
  // WP 8.6: the simple Home in one round trip — every figure as on today, from the services the
  // accountant screens use (services/simpleHome.ts). Read-only, any role. The as-on date is
  // clamped to today; the close checklist + anomalies come separately (simple:homeAttention).
  handle('simple:home', (p) => {
    const { today } = z.object({ today: isoDate.optional() }).strict().parse(p ?? {})
    const c = requireCompany()
    const home = { ...simpleHome(c.db, c.info, { today: homeAsOn(today, todayISO()), backups: listBackupsIn(companyBackupsDir(c.slug)) }), backupCheck: latestBackupCheck(c.db) }
    return canSeeProfitNow() ? home : redactHome(home)
  }, 'viewer')
  handle('simple:homeAttention', (p) => {
    const { today } = z.object({ today: isoDate.optional() }).strict().parse(p ?? {})
    const c = requireCompany()
    return simpleHomeAttention(c.db, c.info, homeAsOn(today, todayISO()))
  }, 'viewer')
  handle('report:cashFlow', (p) => {
    const { from, to } = periodSchema.parse(p)
    return reports.cashFlow(requireCompany().db, from, to)
  }, 'viewer')
  handle('report:stockAgeing', (p) => {
    const { asOn } = z.object({ asOn: z.string() }).parse(p)
    return reports.stockAgeing(requireCompany().db, asOn)
  }, 'viewer')
  handle('report:itemProfitability', (p) => {
    const { from, to } = periodSchema.parse(p)
    return reports.itemProfitability(requireCompany().db, from, to)
  }, 'viewer')
  handle('report:exceptions', (p) => {
    const { from, to } = periodSchema.parse(p)
    return reports.exceptions(requireCompany().db, from, to)
  }, 'viewer')

  // ---------- analysis ----------
  handle('analysis:register', (p) => {
    const { kind, from, to } = periodSchema.extend({ kind: z.enum(['sales', 'purchase']) }).parse(p)
    return analysis.registerByMonth(requireCompany().db, kind, from, to)
  }, 'viewer')
  handle('analysis:outstandings', (p) => {
    const { side, asOn } = z.object({ side: z.enum(['receivable', 'payable']), asOn: z.string() }).parse(p)
    return analysis.outstandings(requireCompany().db, side, asOn)
  }, 'viewer')

  // ---------- intelligence ----------
  handle('intel:suggestLedgers', (p) => {
    const { kind, query } = z.object({ kind: z.string(), query: z.string() }).parse(p)
    return intel.suggestLedgers(requireCompany().db, kind, query)
  }, 'viewer')
  handle('intel:anomaly', (p) => {
    const { ledgerId, amount } = z.object({ ledgerId: z.number().int().positive(), amount: z.number().int() }).parse(p)
    return intel.anomalyCheck(requireCompany().db, ledgerId, amount)
  }, 'viewer')

  // ---------- report print/export (task 3.6) ----------
  handle('report:pdf', async (p) => {
    const { title, periodLabel, columns, rows, footNote, filename, landscape } = reportPdfSchema.parse(p)
    const c = requireCompany()
    const html = reportHtml({ title, company: c.info, periodLabel, columns, rows, footNote })
    const path = await writeExportPdf(c.slug, `${filename}.pdf`, html, { pageSize: 'A4', landscape, pageNumbers: true })
    auditExport(c.db, 'report_pdf', { filename, path })
    return { path }
  }, 'viewer')
  handle('export:csv', (p) => {
    const { filename, csv } = exportCsvSchema.parse(p)
    const c = requireCompany()
    const path = join(companyExportsDir(c.slug), `${filename}.csv`)
    writeFileSync(path, csv, 'utf8')
    auditExport(c.db, 'csv', { filename, path })
    return { path }
  }, 'viewer')
}
