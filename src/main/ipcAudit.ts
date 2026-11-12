// IPC channels for the edit log and its retention. Registered from ipc.ts with its `handle` (role gate + {
// ok, data | error } envelope); every payload is Zod-parsed here, every write channel is mapped in
// auditCoverage.ts. Split out of ipc.ts by audit A12 (HEALTH-4) — the handlers were moved, not rewritten
// (scripts/ipc-handlers-diff.mjs compares them with origin/main).
import { shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { companyExportsDir } from './paths'
import { todayISO } from '@shared/dates'
import * as configSvc from './services/config'
import { writeExportPdf } from './services/pdf'
import { reportHtml } from './services/reportHtml'
import { listAudit, redactAuditRowsForProfit, verifyAudit, editLogExport } from './services/audit'
import { rowsToCsv } from '@shared/csv'
import { auditListSchema, auditRetentionSchema, auditExportSchema, auditTrailRequiredSchema } from '@shared/schemas'
import { auditExport, type IpcContext, type IpcHandle } from './ipcCommon'

export function registerAuditIpc(handle: IpcHandle, { requireCompany, canSeeProfitNow }: IpcContext): void {
  // ---------- audit ----------
  // WP 3.8: the edit log is read-only from the UI — there is no channel that edits or deletes an
  // audit entry, and none that turns the trail off (only the owner-only retention settings below).
  handle('audit:list', (p) => {
    const db = requireCompany().db
    const r = listAudit(db, auditListSchema.parse(p))
    // Audit A3: the year-end close, manufacture and closing-journal rows state the profit.
    return canSeeProfitNow() ? r : { ...r, rows: redactAuditRowsForProfit(db, r.rows) }
  }, 'viewer')
  handle('audit:verify', () => verifyAudit(requireCompany().db), 'viewer')
  const editLogFilename = (q: { from?: string; to?: string }): string => `edit-log-${q.from ?? 'start'}_${q.to ?? todayISO()}`
  handle('audit:exportCsv', (p) => {
    const q = auditExportSchema.parse(p)
    const c = requireCompany()
    const r = editLogExport(c.db, c.info, q, { canSeeProfit: canSeeProfitNow() })
    const csv = rowsToCsv(['Edit log (audit trail)'], [...r.header.map((h) => [h]), [], r.columns, ...r.rows])
    const path = join(companyExportsDir(c.slug), `${editLogFilename(q)}.csv`)
    writeFileSync(path, csv, 'utf8')
    auditExport(c.db, 'edit_log_csv', { ...q, rows: r.rows.length, chainOk: r.verification.ok, path })
    shell.showItemInFolder(path)
    return { path, rows: r.rows.length, verification: r.verification }
  }, 'viewer')
  handle('audit:exportPdf', async (p) => {
    const q = auditExportSchema.parse(p)
    const c = requireCompany()
    const r = editLogExport(c.db, c.info, q, { diffMaxLen: 600, canSeeProfit: canSeeProfitNow() })
    const html = reportHtml({
      title: 'Edit log (audit trail)',
      company: c.info,
      periodLabel: r.header[1]!.replace(/^Period: /, ''),
      headerLines: r.header.slice(2, -1),
      columns: [
        { label: '#', align: 'r', width: 36 }, { label: 'Date/time', align: 'l', width: 118 }, { label: 'User', align: 'l', width: 76 },
        { label: 'Entity', align: 'l', width: 86 }, { label: 'Id / number', align: 'l', width: 86 }, { label: 'Action', align: 'l', width: 56 },
        { label: 'Field-level changes', align: 'l' }, { label: 'Version', align: 'l', width: 50 }, { label: 'Hash', align: 'l', width: 66 }
      ],
      rows: r.rows.map((cells) => ({ cells })),
      footNote: r.header[r.header.length - 1]
    })
    const path = await writeExportPdf(c.slug, `${editLogFilename(q)}.pdf`, html, { pageSize: 'A4', landscape: true, pageNumbers: true })
    auditExport(c.db, 'edit_log_pdf', { ...q, rows: r.rows.length, chainOk: r.verification.ok, path })
    shell.openPath(path)
    return { path, rows: r.rows.length, verification: r.verification }
  }, 'viewer')

  // ---------- audit retention (lane Q, task Q1 #92; WP 3.8: owner-only, rule 3(1) default) ----------
  handle('config:audit:get', () => configSvc.getAuditSettings(requireCompany().db), 'viewer')
  handle('config:audit:set', (p) => {
    const { keepDays } = auditRetentionSchema.parse(p)
    const db = requireCompany().db
    configSvc.setAuditKeepDays(db, keepDays)
    return configSvc.getAuditSettings(db)
  }, 'owner')
  handle('config:audit:required', (p) => {
    const { required } = auditTrailRequiredSchema.parse(p)
    const db = requireCompany().db
    // Turning the flag back on clears any retention window, so "required" always means "never pruned".
    if (required && configSvc.getAuditKeepDays(db) !== null) configSvc.setAuditKeepDays(db, null)
    configSvc.setAuditTrailRequired(db, required)
    return configSvc.getAuditSettings(db)
  }, 'owner')
}
